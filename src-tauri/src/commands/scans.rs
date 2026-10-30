use std::path::PathBuf;

use cbs_core::{
    default_exclusions, resolve_profile, ScanEvent, ScanLimits, ScanProfile, ScanReport,
    ScanRequest, Scanner,
};
use cbs_store::{DashboardStats, ScanDetails, ScanRecord};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::commands::engine::{probe_with_settings, signatures_blocked};
use crate::error::CommandError;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResultPayload {
    pub report: ScanReport,
    pub record_id: Option<i64>,
    pub persistence_error: Option<String>,
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn start_scan(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
    recursive: bool,
    include_pua: bool,
    profile: Option<String>,
    limits: Option<ScanLimits>,
    follow_symlinks: Option<bool>,
) -> Result<ScanResultPayload, CommandError> {
    let profile = match profile.as_deref() {
        Some("quick") => ScanProfile::Quick,
        Some("full") => ScanProfile::Full,
        _ => ScanProfile::Custom,
    };

    let resolved = resolve_profile(profile, &state.paths.data_dir);
    let (paths, excluded) = match profile {
        ScanProfile::Custom => {
            if paths.is_empty() {
                return Err(CommandError::new(
                    "noTargets",
                    "Sélectionnez au moins un fichier ou un dossier à analyser.",
                ));
            }
            (paths, Vec::new())
        }
        _ => {
            if resolved.targets.is_empty() {
                return Err(CommandError::new(
                    "noTargets",
                    "Aucune cible n'a pu être résolue pour ce profil.",
                ));
            }
            (
                resolved.targets.clone(),
                default_exclusions(&state.paths.data_dir),
            )
        }
    };
    if paths.len() > 64 {
        return Err(CommandError::new(
            "tooManyTargets",
            "Trop de cibles simultanées (maximum 64).",
        ));
    }

    let settings = state.store.settings()?;
    let status = probe_with_settings(&state, &settings);

    if !status.installed {
        return Err(CommandError::new("engineMissing", status.message));
    }
    if signatures_blocked(&status) {
        return Err(CommandError::new("signaturesMissing", status.message));
    }
    let Some(executable) = status.clamscan_path.clone() else {
        return Err(CommandError::new("engineMissing", status.message));
    };

    let request = ScanRequest {
        paths: paths.into_iter().map(PathBuf::from).collect(),
        recursive,
        include_pua,
        profile,
        limits: limits.unwrap_or_default().sanitized(),
        follow_symlinks: follow_symlinks.unwrap_or(false),
        excluded_paths: excluded,
    };

    let (scan_id, cancel, lease) = state.begin_scan()?;

    let scanner = Scanner::new(executable)
        .with_versions(
            status.engine_version.clone(),
            status.signature_version.clone(),
        )
        .with_database_dir(status.database_path.clone())
        .with_forbidden_root(Some(state.paths.quarantine_dir.clone()));

    let emit_app = app.clone();
    let sink = move |event: ScanEvent| {
        let _ = emit_app.emit("scan:event", &event);
    };

    let scan_result = scanner.scan(&scan_id, &request, sink, cancel).await;
    drop(lease);

    let report = match scan_result {
        Ok(report) => report,
        Err(err) => {
            // Native notification (deduplicated by engine-failure key).
            if let Ok(mut ring) = state.notify_ring.lock() {
                if ring.admit("scan-engine-failure") {
                    crate::notify::show(
                        &app,
                        "CBS Shield",
                        "Échec du moteur antivirus (ClamAV). Vérifiez les mises à jour. / Antivirus engine failure. Check updates.",
                    );
                }
            }
            return Err(CommandError::from(err));
        }
    };

    // Native notification for completed scans; detections get a dedicated,
    // non-repeatable key so one scan can never spam the same alert.
    {
        let (title, body, key) = if report.detections.is_empty() {
            (
                "CBS Shield".to_string(),
                "Analyse terminée : aucun fichier malveillant détecté. / Scan completed: no malware detected.".to_string(),
                format!("scan-done-{}", scan_id),
            )
        } else {
            (
                "CBS Shield".to_string(),
                format!(
                    "Menace détectée : {} fichier(s) signalé(s). Ouvrez la quarantaine. / Threat detected: {} file(s) flagged. Open quarantine.",
                    report.detections.len(),
                    report.detections.len()
                ),
                format!("scan-detections-{}", scan_id),
            )
        };
        if let Ok(mut ring) = state.notify_ring.lock() {
            if ring.admit(&key) {
                crate::notify::show(&app, &title, &body);
            }
        }
    }

    let (record_id, persistence_error) = match state.store.save_scan(&report) {
        Ok(id) => (Some(id), None),
        Err(err) => (
            None,
            Some(format!(
                "Le rapport n'a pas pu être enregistré dans l'historique : {err}"
            )),
        ),
    };

    Ok(ScanResultPayload {
        report,
        record_id,
        persistence_error,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTargetsPayload {
    pub profile: String,
    pub targets: Vec<String>,
    pub excluded: Vec<String>,
}

#[tauri::command]
pub fn resolve_scan_targets(state: State<'_, AppState>, profile: String) -> ResolvedTargetsPayload {
    let profile = match profile.as_str() {
        "quick" => ScanProfile::Quick,
        "full" => ScanProfile::Full,
        _ => ScanProfile::Custom,
    };
    let resolved = resolve_profile(profile, &state.paths.data_dir);
    ResolvedTargetsPayload {
        profile: resolved.profile,
        targets: resolved.targets,
        excluded: resolved.excluded,
    }
}

#[tauri::command]
pub fn cancel_scan(state: State<'_, AppState>) -> Result<bool, CommandError> {
    state.cancel_scan()
}

#[tauri::command]
pub fn list_scans(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<ScanRecord>, CommandError> {
    Ok(state.store.list_scans(limit.unwrap_or(20))?)
}

#[tauri::command]
pub fn get_scan_details(
    state: State<'_, AppState>,
    scan_id: i64,
) -> Result<Option<ScanDetails>, CommandError> {
    Ok(state.store.get_scan(scan_id)?)
}

#[tauri::command]
pub fn dashboard_stats(state: State<'_, AppState>) -> Result<DashboardStats, CommandError> {
    Ok(state.store.dashboard_stats()?)
}
