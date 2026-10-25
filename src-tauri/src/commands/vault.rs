use std::path::PathBuf;

use cbs_store::{NewQuarantine, QuarantineRecord, QuarantineStatus};
use tauri::State;

use crate::error::CommandError;
use crate::state::AppState;

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
    let canonical = path.canonicalize().map_err(|err| {
        CommandError::new(
            "invalidTarget",
            format!("Chemin invalide ({}): {err}", path.display()),
        )
    })?;
    if !canonical.is_file() {
        return Err(CommandError::new(
            "notAFile",
            "Seuls les fichiers détectés peuvent être mis en quarantaine.",
        ));
    }
    if canonical.starts_with(&state.paths.quarantine_dir) {
        return Err(CommandError::new(
            "invalidTarget",
            "Ce fichier se trouve déjà dans le coffre de quarantaine.",
        ));
    }
    if canonical.starts_with(&state.paths.data_dir) {
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

    let destination = PathBuf::from(&record.original_path);
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
    if phrase.trim() != "SUPPRIMER" {
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
