use std::path::{Path, PathBuf};

use cbs_store::{NewQuarantine, QuarantineRecord, QuarantineStatus};
use tauri::State;

use crate::error::CommandError;
use crate::state::AppState;

/// Canonicalize and strip the Windows verbatim prefix (`\\?\C:\…` → `C:\…`).
///
/// Audit fix (Sprint 2): `std::fs::canonicalize` on Windows returns verbatim
/// paths, whose components never prefix-match a plain drive path. Every
/// `contains`-style check built directly on `canonicalize().starts_with()`
/// therefore silently never triggered — including the pre-existing
/// quarantine-source guard. Normalizing both sides repairs the semantics.
pub fn normalized_path(path: &Path) -> Option<PathBuf> {
    let canonical = std::fs::canonicalize(path).ok()?;
    let text = canonical.as_os_str().to_string_lossy();
    let stripped = text.strip_prefix(r"\\?\").unwrap_or(&text);
    Some(PathBuf::from(stripped.to_string()))
}

fn is_inside(candidate: &Option<PathBuf>, root: &Path) -> bool {
    match candidate {
        Some(canonical) => canonical.starts_with(root),
        None => false,
    }
}

/// Pure validation of a restore destination (unit-testable).
///
/// Audit fix: `restore_quarantine` blindly used `record.original_path` from
/// SQLite. Even though only validated paths are written to that column, a
/// future bug or a tampered database must never be able to make the app write
/// into its own data area: restore is the only write-back operation, so the
/// destination is re-validated here. It must be an absolute path pointing
/// outside the vault and outside the app data directory (settings, history
/// database and ClamAV databases would otherwise be clobbered).
pub fn validate_restore_destination(
    vault_root: &Path,
    data_dir: &Path,
    original_path: &str,
) -> Result<PathBuf, CommandError> {
    if original_path.trim().is_empty() {
        return Err(CommandError::new(
            "invalidTarget",
            "Chemin d'origine vide dans l'entrée de quarantaine.",
        ));
    }
    let destination = PathBuf::from(original_path);
    if !destination.is_absolute() {
        return Err(CommandError::new(
            "invalidTarget",
            format!("Chemin d'origine non absolu : {original_path}"),
        ));
    }
    // Both roots have been canonicalized at startup (AppPaths::canonicalized).
    let canonical = std::fs::canonicalize(&destination).ok().map(|canonical| {
        let text = canonical.as_os_str().to_string_lossy();
        let stripped = text.strip_prefix(r"\\?\").unwrap_or(&text);
        PathBuf::from(stripped.to_string())
    });
    if is_inside(&canonical, vault_root) || is_inside(&canonical, data_dir) {
        return Err(CommandError::new(
            "forbiddenRestore",
            "La restauration vers une zone interne de CBS Shield est refusée.",
        ));
    }
    Ok(destination)
}

fn validate_source(state: &AppState, raw: &str) -> Result<PathBuf, CommandError> {
    if raw.trim().is_empty() {
        return Err(CommandError::new("invalidTarget", "Chemin vide."));
    }
    let path = PathBuf::from(raw);
    if !path.exists() {
        return Err(CommandError::new(
            "notFound",
            format!("Fichier introuvable : {}", path.display()),
        ));
    }
    let canonical = normalized_path(&path).ok_or_else(|| {
        CommandError::new(
            "invalidTarget",
            format!("Chemin invalide ({}): accès impossible", path.display()),
        )
    })?;
    if !canonical.is_file() {
        return Err(CommandError::new(
            "notAFile",
            "Seuls les fichiers détectés peuvent être mis en quarantaine.",
        ));
    }
    // Roots are normalized too, so the comparisons here are prefix-checks
    // between comparable strings (audit fix: this check previously compared a
    // verbatim path against a plain path and never matched).
    let quarantine_root = normalized_path(&state.paths.quarantine_dir)
        .unwrap_or_else(|| state.paths.quarantine_dir.clone());
    let data_root =
        normalized_path(&state.paths.data_dir).unwrap_or_else(|| state.paths.data_dir.clone());
    if canonical.starts_with(&quarantine_root) {
        return Err(CommandError::new(
            "invalidTarget",
            "Ce fichier se trouve déjà dans le coffre de quarantaine.",
        ));
    }
    if canonical.starts_with(&data_root) {
        return Err(CommandError::new(
            "invalidTarget",
            "Les données internes de CBS Shield (historique, signatures, clé) ne peuvent pas être mises en quarantaine.",
        ));
    }
    Ok(canonical)
}

/// Move one detected file into the encrypted vault. Requires an explicit
/// confirmation from the UI. No file is ever quarantined automatically.
#[tauri::command]
pub async fn quarantine_file(
    state: State<'_, AppState>,
    path: String,
    threat_name: String,
    sha256: Option<String>,
    confirm: bool,
) -> Result<QuarantineRecord, CommandError> {
    if !confirm {
        return Err(CommandError::confirmation_required(
            "le déplacement du fichier en quarantaine",
        ));
    }
    let source = validate_source(&state, &path)?;
    let threat = {
        let trimmed = threat_name.trim();
        if trimmed.is_empty() {
            "Détection ClamAV".to_string()
        } else {
            trimmed.chars().take(200).collect()
        }
    };

    let quarantine = state.quarantine.clone();
    let source_for_store = source.clone();
    let item = tokio::task::spawn_blocking(move || quarantine.store(&source_for_store))
        .await
        .map_err(|err| {
            CommandError::internal(format!("tâche de quarantaine interrompue : {err}"))
        })??;

    if let Some(expected) = sha256.as_deref() {
        if !expected.eq_ignore_ascii_case(&item.sha256) {
            // The file changed between detection and quarantine. Put it back
            // instead of storing an unexpected payload.
            let quarantine = state.quarantine.clone();
            let item_id = item.item_id.clone();
            let destination = source.clone();
            let restore = tokio::task::spawn_blocking(move || {
                quarantine.restore(&item_id, &destination, None)
            })
            .await;
            let rollback_note = match restore {
                Ok(Ok(_)) => "Le fichier a été remis à son emplacement d'origine.".to_string(),
                _ => format!(
                    "La copie chiffrée reste disponible sous l'identifiant {}.",
                    item.item_id
                ),
            };
            return Err(CommandError::new(
                "fileChanged",
                format!("Le fichier a changé depuis le scan ; mise en quarantaine refusée. {rollback_note}"),
            ));
        }
    }

    let record = state.store.insert_quarantine(&NewQuarantine {
        item_id: item.item_id.clone(),
        file_name: item.file_name.clone(),
        original_path: source.display().to_string(),
        stored_path: item.stored_path.display().to_string(),
        sha256: item.sha256.clone(),
        size_bytes: item.size_bytes,
        threat_name: threat,
        source_scan_id: None,
    });

    match record {
        Ok(record) => Ok(record),
        Err(store_error) => {
            // Metadata failed to persist: restore the file so the user is not
            // left with an untracked vault item.
            let quarantine = state.quarantine.clone();
            let item_id = item.item_id.clone();
            let destination = source.clone();
            let sha = item.sha256.clone();
            let rollback = tokio::task::spawn_blocking(move || {
                quarantine.restore(&item_id, &destination, Some(&sha))
            })
            .await;
            let rollback_ok = matches!(rollback, Ok(Ok(_)));
            Err(CommandError::new(
                "storageError",
                if rollback_ok {
                    format!("Enregistrement SQLite impossible : {store_error}. Le fichier a été restauré.")
                } else {
                    format!("Enregistrement SQLite impossible : {store_error}. Le fichier chiffré est conservé dans le coffre.")
                },
            ))
        }
    }
}

#[tauri::command]
pub fn list_quarantine(state: State<'_, AppState>) -> Result<Vec<QuarantineRecord>, CommandError> {
    Ok(state.store.list_quarantine()?)
}

#[tauri::command]
pub async fn restore_quarantine(
    state: State<'_, AppState>,
    id: i64,
    confirm: bool,
) -> Result<String, CommandError> {
    if !confirm {
        return Err(CommandError::confirmation_required(
            "la restauration d'un fichier",
        ));
    }
    let record = state
        .store
        .quarantine_by_id(id)?
        .ok_or_else(|| CommandError::new("notFound", "Entrée de quarantaine introuvable."))?;
    if record.status != QuarantineStatus::Active {
        return Err(CommandError::new(
            "notActive",
            "Cette entrée n'est plus active.",
        ));
    }

    // Audit fix: destination re-validated against vault/data roots before any
    // write happens.
    let destination = validate_restore_destination(
        &state.paths.quarantine_dir,
        &state.paths.data_dir,
        &record.original_path,
    )?;
    let quarantine = state.quarantine.clone();
    let item_id = record.item_id.clone();
    let sha = record.sha256.clone();
    let destination_for_restore = destination.clone();
    tokio::task::spawn_blocking(move || {
        quarantine.restore(&item_id, &destination_for_restore, Some(&sha))
    })
    .await
    .map_err(|err| {
        CommandError::internal(format!("tâche de restauration interrompue : {err}"))
    })??;

    state.store.mark_quarantine_restored(id)?;
    Ok(destination.display().to_string())
}

/// Permanently remove the encrypted blob. Requires both a boolean confirmation
/// and the typed phrase `SUPPRIMER`; the audit row is kept with status `deleted`.
#[tauri::command]
pub async fn delete_quarantine(
    state: State<'_, AppState>,
    id: i64,
    confirm: bool,
    phrase: String,
) -> Result<(), CommandError> {
    if !confirm {
        return Err(CommandError::confirmation_required(
            "la suppression définitive d'un élément de quarantaine",
        ));
    }
    if phrase.trim() != "SUPPRIMER" && phrase.trim() != "DELETE" {
        return Err(CommandError::new(
            "confirmationPhrase",
            "Saisissez exactement SUPPRIMER pour confirmer la suppression définitive.",
        ));
    }
    let record = state
        .store
        .quarantine_by_id(id)?
        .ok_or_else(|| CommandError::new("notFound", "Entrée de quarantaine introuvable."))?;
    if record.status != QuarantineStatus::Active {
        return Err(CommandError::new(
            "notActive",
            "Seul un élément actif peut être supprimé.",
        ));
    }

    let quarantine = state.quarantine.clone();
    let item_id = record.item_id.clone();
    tokio::task::spawn_blocking(move || quarantine.purge(&item_id))
        .await
        .map_err(|err| {
            CommandError::internal(format!("tâche de suppression interrompue : {err}"))
        })??;

    state.store.mark_quarantine_deleted(id)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_restore_destination;
    use std::fs;
    use std::path::Path;

    #[test]
    fn restore_destination_guard_rejects_protected_roots() {
        let dir = tempfile::tempdir().unwrap();
        let vault = dir.path().join("vault");
        let data = dir.path().join("data");
        fs::create_dir_all(&vault).unwrap();
        fs::create_dir_all(&data).unwrap();

        // Existing file inside the vault: refused even if the record claims it.
        fs::write(vault.join("blob.cbsq"), b"x").unwrap();
        assert!(validate_restore_destination(
            &vault,
            &data,
            &fs::canonicalize(vault.join("blob.cbsq"))
                .unwrap()
                .display()
                .to_string()
        )
        .is_err());

        // Path traversal inside the app data dir: refused.
        let target = data.join("settings for restore.txt");
        fs::write(&target, b"x").unwrap();
        assert!(
            validate_restore_destination(&vault, &data, &target.display().to_string()).is_err()
        );

        // Data dir root itself: refused.
        assert!(validate_restore_destination(&vault, &data, &data.display().to_string()).is_err());

        // Relative path: refused outright.
        assert!(validate_restore_destination(&vault, &data, "relative\\file.txt").is_err());
        assert!(validate_restore_destination(&vault, &data, "   ").is_err());

        // A legitimate user location: accepted.
        let outside = dir.path().join("elsewhere");
        fs::create_dir_all(&outside).unwrap();
        let valid = outside.join("document.docx");
        fs::write(&valid, b"x").unwrap();
        let ok = validate_restore_destination(&vault, &data, &valid.display().to_string()).unwrap();
        assert_eq!(ok.as_path(), Path::new(&valid));
    }

    #[test]
    fn restore_destination_guard_accepts_not_yet_existing_path() {
        // A destination that does not exist yet cannot be canonicalized: we
        // cannot prove it lies inside a protected root, and the pre-restore
        // overwrite refusal still applies downstream.
        let dir = tempfile::tempdir().unwrap();
        let vault = dir.path().join("vault");
        let data = dir.path().join("data");
        fs::create_dir_all(&vault).unwrap();
        fs::create_dir_all(&data).unwrap();
        assert!(validate_restore_destination(
            &vault,
            &data,
            &dir.path().join("user\\new.docx").display().to_string()
        )
        .is_ok());
    }
}
