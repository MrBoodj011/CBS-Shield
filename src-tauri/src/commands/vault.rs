use std::path::{Path, PathBuf};

use cbs_quarantine::QuarantineError;
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

/// Resolve a write destination that may not exist yet.
///
/// `canonicalize` fails on a missing file, which previously made every
/// containment check pass for exactly the paths that get written (a restore
/// or export target never exists beforehand). This canonicalizes the deepest
/// existing ancestor (following any symlink/junction in it) and re-appends the
/// remaining components. `..`/`.` components and relative paths are refused
/// (`None`), so the result can be compared against the protected roots.
pub fn normalized_destination(path: &Path) -> Option<PathBuf> {
    use std::path::Component;
    if !path.is_absolute() {
        return None;
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return None;
    }
    if let Some(existing) = normalized_path(path) {
        return Some(existing);
    }
    let mut missing: Vec<std::ffi::OsString> = Vec::new();
    let mut cursor = path;
    loop {
        missing.push(cursor.file_name()?.to_os_string());
        cursor = cursor.parent()?;
        if let Some(mut resolved) = normalized_path(cursor) {
            for part in missing.iter().rev() {
                resolved.push(part);
            }
            return Some(resolved);
        }
    }
}

/// Case-insensitive on Windows (NTFS paths are case-insensitive), exact
/// component match elsewhere.
pub fn path_is_inside(candidate: &Path, root: &Path) -> bool {
    #[cfg(windows)]
    {
        let lower = |path: &Path| PathBuf::from(path.to_string_lossy().to_lowercase());
        lower(candidate).starts_with(lower(root))
    }
    #[cfg(not(windows))]
    {
        candidate.starts_with(root)
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
    // The destination normally does not exist yet, so resolve it through its
    // nearest existing ancestor; an unresolvable path is refused.
    let canonical = normalized_destination(&destination).ok_or_else(|| {
        CommandError::new(
            "invalidTarget",
            format!("Chemin d'origine invalide : {original_path}"),
        )
    })?;
    let vault_root = normalized_path(vault_root).unwrap_or_else(|| vault_root.to_path_buf());
    let data_dir = normalized_path(data_dir).unwrap_or_else(|| data_dir.to_path_buf());
    if path_is_inside(&canonical, &vault_root) || path_is_inside(&canonical, &data_dir) {
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
    if path_is_inside(&canonical, &quarantine_root) {
        return Err(CommandError::new(
            "invalidTarget",
            "Ce fichier se trouve déjà dans le coffre de quarantaine.",
        ));
    }
    if path_is_inside(&canonical, &data_root) {
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
    let _vault_guard = state.vault_ops.lock().await;
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

    let source_key = source.display().to_string();
    if let Some(existing) = state.store.quarantine_by_original_path(&source_key)? {
        return Err(CommandError::new(
            "alreadyQuarantined",
            format!(
                "Ce fichier est déjà suivi par la quarantaine (statut {}). Traitez cette entrée avant de recommencer.",
                existing.status.as_str()
            ),
        ));
    }

    // Phase 1: encrypt into the vault without touching the source. The blob is
    // verified byte-for-byte (decrypt + SHA-256) before anything is deleted.
    let quarantine = state.quarantine.clone();
    let source_for_stage = source.clone();
    let item = tokio::task::spawn_blocking(move || quarantine.stage(&source_for_stage))
        .await
        .map_err(|err| {
            CommandError::internal(format!("tâche de quarantaine interrompue : {err}"))
        })??;

    if let Some(expected) = sha256.as_deref() {
        if !expected.eq_ignore_ascii_case(&item.sha256) {
            // The file changed between detection and quarantine. The source was
            // never touched, so we only drop the staged copy.
            let quarantine = state.quarantine.clone();
            let item_id = item.item_id.clone();
            let _ = tokio::task::spawn_blocking(move || quarantine.purge(&item_id)).await;
            return Err(CommandError::new(
                "fileChanged",
                "Le fichier a changé depuis le scan ; mise en quarantaine refusée. Le fichier d'origine est intact.",
            ));
        }
    }

    // Phase 2: durable metadata first, as `pending`. If the database write
    // fails, the source is still in place and the blob is removed.
    let record = match state.store.insert_quarantine_pending(&NewQuarantine {
        item_id: item.item_id.clone(),
        file_name: item.file_name.clone(),
        original_path: source_key,
        stored_path: item.stored_path.display().to_string(),
        sha256: item.sha256.clone(),
        size_bytes: item.size_bytes,
        threat_name: threat,
        source_scan_id: None,
    }) {
        Ok(record) => record,
        Err(store_error) => {
            let quarantine = state.quarantine.clone();
            let item_id = item.item_id.clone();
            let purged = tokio::task::spawn_blocking(move || quarantine.purge(&item_id))
                .await
                .map(|result| result.is_ok())
                .unwrap_or(false);
            return Err(CommandError::new(
                "storageError",
                format!(
                    "Enregistrement SQLite impossible : {store_error}. {}",
                    if purged {
                        "Le fichier d'origine est intact."
                    } else {
                        "Une copie chiffrée inutilisée subsiste dans le coffre."
                    }
                ),
            ));
        }
    };

    // Phase 3: remove the source only now that the blob and its metadata exist.
    let quarantine = state.quarantine.clone();
    let item_for_commit = item.clone();
    let source_for_commit = source.clone();
    let commit_result = tokio::task::spawn_blocking(move || {
        quarantine.commit(&item_for_commit, &source_for_commit)
    })
    .await;

    match commit_result {
        Ok(Ok(())) => {
            state.store.mark_quarantine_active(record.id)?;
            state
                .store
                .quarantine_by_id(record.id)?
                .ok_or_else(|| CommandError::new("notFound", "Entrée de quarantaine introuvable."))
        }
        Ok(Err(QuarantineError::SourceRetained { reason, .. })) => {
            // The blob and the pending row are kept: nothing is lost. The user
            // can retry, restore or purge after closing the locking program.
            Err(CommandError::new(
                "sourceLocked",
                format!(
                    "Le fichier est chiffré et conservé dans le coffre, mais il n'a pas pu être retiré de son emplacement d'origine ({reason}). Fermez le programme qui le verrouille puis utilisez l'entrée « récupérable » de la quarantaine."
                ),
            ))
        }
        Ok(Err(err)) => {
            // The blob could not be re-verified (vault tampering). Drop the
            // unusable copy and close the audit row; the source is untouched.
            let quarantine = state.quarantine.clone();
            let item_id = item.item_id.clone();
            let _ = tokio::task::spawn_blocking(move || quarantine.purge(&item_id)).await;
            let _ = state.store.mark_quarantine_deleted(record.id);
            Err(CommandError::new(
                "vaultVerifyFailed",
                format!(
                    "La copie chiffrée n'a pas pu être vérifiée ({err}). Le fichier d'origine est intact."
                ),
            ))
        }
        Err(join_error) => Err(CommandError::internal(format!(
            "tâche de quarantaine interrompue : {join_error}"
        ))),
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
    let _vault_guard = state.vault_ops.lock().await;
    if !confirm {
        return Err(CommandError::confirmation_required(
            "la restauration d'un fichier",
        ));
    }
    let record = state
        .store
        .quarantine_by_id(id)?
        .ok_or_else(|| CommandError::new("notFound", "Entrée de quarantaine introuvable."))?;
    if !matches!(
        record.status,
        QuarantineStatus::Active | QuarantineStatus::Pending
    ) {
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
    let _vault_guard = state.vault_ops.lock().await;
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
    if !matches!(
        record.status,
        QuarantineStatus::Active | QuarantineStatus::Pending
    ) {
        return Err(CommandError::new(
            "notActive",
            "Seul un élément actif ou récupérable peut être supprimé.",
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
        // A destination that does not exist yet (the normal restore case) is
        // resolved through its nearest existing ancestor and accepted when it
        // lies outside the protected roots.
        let dir = tempfile::tempdir().unwrap();
        let vault = dir.path().join("vault");
        let data = dir.path().join("data");
        fs::create_dir_all(&vault).unwrap();
        fs::create_dir_all(&data).unwrap();
        assert!(validate_restore_destination(
            &vault,
            &data,
            &dir.path()
                .join("user")
                .join("new.docx")
                .display()
                .to_string()
        )
        .is_ok());
    }

    #[test]
    fn restore_destination_guard_refuses_missing_files_inside_protected_roots() {
        // Regression: a not-yet-existing file inside the data directory used
        // to pass because canonicalize() failed and the check was skipped.
        let dir = tempfile::tempdir().unwrap();
        let vault = dir.path().join("vault");
        let data = dir.path().join("data");
        fs::create_dir_all(&vault).unwrap();
        fs::create_dir_all(&data).unwrap();
        for target in [
            data.join("quarantine.key"),
            data.join("sub").join("deeper").join("x.bin"),
            vault.join("new.cbsq"),
        ] {
            assert!(
                validate_restore_destination(&vault, &data, &target.display().to_string()).is_err(),
                "{target:?} must be refused"
            );
        }
        // `..` traversal is refused outright.
        let sneaky = dir.path().join("user").join("..").join("data").join("x");
        assert!(
            validate_restore_destination(&vault, &data, &sneaky.display().to_string()).is_err()
        );
    }
}
