use std::path::PathBuf;

use cbs_core::{ScanEvent, ScanReport, ScanRequest, Scanner};
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

#[tauri::command]
pub async fn start_scan(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
    recursive: bool,
    include_pua: bool,
) -> Result<ScanResultPayload, CommandError> {
    if paths.is_empty() {
        return Err(CommandError::new(
            "noTargets",
            "Sélectionnez au moins un fichier ou un dossier à analyser.",
        ));
    }
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

    let report = scan_result?;

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
