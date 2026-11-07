//! Background analysis worker for CBS Proactive Monitor (Sprint 9.1).
//!
//! Safety model:
//! - **Explicit opt-in**: the worker only runs while the user consented
//!   (`proactiveAutoScan` persisted setting) AND the engine is available.
//! - **Bounded work**: at most `MAX_BATCH` files per ClamAV invocation,
//!   batches run strictly sequentially at low ClamAV priority.
//! - **Scope**: only paths the monitor queued (files inside the watched
//!   directories the user explicitly picked).
//! - **No duplicates**: the monitor already stamps files; an unchanged file
//!   is never enqueued twice, and the worker drains what it scans.
//! - **No automatic deletion or quarantine**: a detection is recorded in the
//!   local audit history and reported; the file stays untouched. Quarantine
//!   remains a separate, user-triggered workflow.
//! - **Cancellation**: disabling the consent notifies the cooperative cancel
//!   token; an in-flight batch aborts, its partial results are discarded.
//! - **Worker identity**: a generation counter guarantees that a fast
//!   disable/enable cycle can never leave two concurrent workers scanning.

use std::sync::Arc;
use std::time::Duration;

use cbs_core::{ScanLimits, ScanOutcome, ScanProfile, ScanReport, ScanRequest, Scanner};
use chrono::Utc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Notify;

use crate::commands::engine::{probe_with_settings, signatures_blocked};
use crate::state::{AppState, AutoScanState, BatchSummary};

/// How often the worker checks for new queued files when idle.
pub const POLL_INTERVAL: Duration = Duration::from_secs(4);
/// Bounded ClamAV invocation size (CPU / RAM / disk conservatism).
pub const MAX_BATCH: usize = 10;

/// Event emitted after every processed batch (successful or not).
pub const BATCH_EVENT: &str = "proactive:auto-scan";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchReportPayload {
    pub outcome: String,
    pub files: usize,
    pub files_scanned: u64,
    pub detections: Vec<DetectionPayload>,
    pub failures: usize,
    pub error: Option<String>,
    pub record_id: Option<i64>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DetectionPayload {
    path: String,
    threat_name: String,
}

fn outcome_name(outcome: ScanOutcome) -> &'static str {
    match outcome {
        ScanOutcome::Clean => "clean",
        ScanOutcome::Detected => "detected",
        ScanOutcome::Cancelled => "cancelled",
        ScanOutcome::CompletedWithErrors => "completedWithErrors",
        ScanOutcome::Failed => "failed",
    }
}

/// Start the worker if the persisted consent says so. Called at startup.
pub fn spawn_if_enabled(app: AppHandle) {
    let enabled = {
        let state = app.state::<AppState>();
        let settings = match state.store.settings() {
            Ok(settings) => settings,
            Err(_) => return,
        };
        settings
            .get("proactiveAutoScan")
            .map(|value| value == "true")
            .unwrap_or(false)
    };
    if enabled {
        start(app);
    }
}

/// Begin a new worker generation: enable consent, reset cancellation and
/// issue a fresh identity. Returns the new generation.
///
/// `enabled` MUST become `true` here: `run()` treats `enabled == false` as an
/// immediate exit, so leaving it unset makes the worker stop on its first poll
/// even though the caller persisted consent.
fn begin_worker(inner: &mut AutoScanState) -> u64 {
    inner.generation += 1;
    inner.enabled = true;
    inner.running = true;
    inner.cancel_requested = false;
    inner.cancel = Arc::new(Notify::new());
    inner.busy = None;
    inner.last_error = None;
    inner.generation
}

/// Mark the persisted consent off and request cooperative cancellation.
fn end_worker(inner: &mut AutoScanState) {
    inner.enabled = false;
    inner.cancel_requested = true;
    inner.busy = None;
}

/// Start (or restart) the worker. The caller must have persisted the consent.
pub fn start(app: AppHandle) {
    // Cancel any previous worker and issue a fresh identity.
    let generation = {
        let state = app.state::<AppState>();
        let mut inner = state
            .auto_scan
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        begin_worker(&mut inner)
    };
    tauri::async_runtime::spawn(async move {
        run(app, generation).await;
    });
}

/// Mark the persisted consent off and stop the cooperative worker.
pub fn stop(app: &AppHandle) {
    {
        let state = app.state::<AppState>();
        let mut inner = state
            .auto_scan
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        end_worker(&mut inner);
    }
    // The worker picks up either `enabled == false` or the (same-generation)
    // cancel notification within one poll interval and exits by itself.
    {
        let state = app.state::<AppState>();
        let inner = state
            .auto_scan
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner.cancel.notify_waiters();
    }
}

async fn run(app: AppHandle, generation: u64) {
    loop {
        let (enabled, cancel) = {
            let state = app.state::<AppState>();
            let inner = state
                .auto_scan
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if inner.generation != generation {
                return; // A newer worker owns this state now.
            }
            (inner.enabled, inner.cancel.clone())
        };
        if !enabled {
            let state = app.state::<AppState>();
            let mut inner = state
                .auto_scan
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if inner.generation == generation {
                inner.running = false;
                inner.busy = None;
            }
            return;
        }

        tokio::select! {
            _ = tokio::time::sleep(POLL_INTERVAL) => {}
            _ = cancel.notified() => {
                // Consent revoked while idle.
                let state = app.state::<AppState>();
                let mut inner = state
                    .auto_scan
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if inner.generation == generation {
                    inner.running = false;
                    inner.busy = None;
                }
                return;
            }
        }

        process_cycle(&app, generation).await;
    }
}

fn still_current(app: &AppHandle, generation: u64) -> bool {
    let state = app.state::<AppState>();
    let inner = state
        .auto_scan
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    inner.generation == generation && inner.enabled
}

async fn process_cycle(app: &AppHandle, generation: u64) {
    let state = app.state::<AppState>();

    // Engine availability is re-checked every cycle: the user may move or
    // remove the portable ClamAV installation at any time.
    let settings = match state.store.settings() {
        Ok(settings) => settings,
        Err(err) => {
            record_error(app, generation, format!("Historique indisponible : {err}"));
            return;
        }
    };
    if !still_current(app, generation) {
        exit_because_replaced(app, generation);
        return;
    }
    let status = probe_with_settings(&state, &settings);
    if !status.installed {
        record_error(
            app,
            generation,
            "Moteur ClamAV indisponible : file conservée.".to_string(),
        );
        return;
    }
    if signatures_blocked(&status) {
        record_error(
            app,
            generation,
            "Signatures absentes : file conservée.".to_string(),
        );
        return;
    }
    let Some(executable) = status.clamscan_path.clone() else {
        record_error(
            app,
            generation,
            "Moteur ClamAV indisponible : file conservée.".to_string(),
        );
        return;
    };
    let include_pua = settings
        .get("includePua")
        .map(|value| value == "true")
        .unwrap_or(false);

    // Drain the monitor queue. Timestamp stamps guarantee each path is handed
    // over at most once per change; draining removes them whether or not the
    // batch succeeded, so a permanently failing file cannot pin the queue —
    // the audit trail records the failure instead.
    let queued = state.proactive.drain_queue().unwrap_or_default();
    if queued.is_empty() {
        return;
    }

    let scanner = Scanner::new(executable)
        .with_versions(
            status.engine_version.clone(),
            status.signature_version.clone(),
        )
        .with_database_dir(status.database_path.clone())
        .with_forbidden_root(Some(state.paths.quarantine_dir.clone()));

    for chunk in queued.chunks(MAX_BATCH) {
        if !still_current(app, generation) {
            exit_because_replaced(app, generation);
            return;
        }
        let cancel = {
            let mut inner = state
                .auto_scan
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            inner.busy = Some(chunk.iter().map(|p| p.display().to_string()).collect());
            inner.cancel.clone()
        };

        let scan_id = uuid::Uuid::new_v4().to_string();
        let request = ScanRequest {
            paths: chunk.to_vec(),
            recursive: false,
            include_pua,
            profile: ScanProfile::Custom,
            limits: ScanLimits::default().sanitized(),
            follow_symlinks: false,
            excluded_paths: Vec::new(),
        };
        let emit_app = app.clone();
        let sink = move |event: cbs_core::ScanEvent| {
            let _ = emit_app.emit("scan:event", &event);
        };
        let started_at = Utc::now().to_rfc3339();
        let scan_result = scanner.scan(&scan_id, &request, sink, cancel).await;

        let payload = match scan_result {
            Ok(report) => {
                let record_id = match state.store.save_scan(&report) {
                    Ok(id) => Some(id),
                    Err(err) => {
                        record_error(app, generation, format!("Audit impossible : {err}"));
                        None
                    }
                };
                notify_if_detection(app, &report, &settings);
                BatchReportPayload {
                    outcome: outcome_name(report.outcome).to_string(),
                    files: chunk.len(),
                    files_scanned: report.files_scanned,
                    detections: report
                        .detections
                        .iter()
                        .map(|detection| DetectionPayload {
                            path: detection.file_path.clone(),
                            threat_name: detection.threat_name.clone(),
                        })
                        .collect(),
                    failures: report.error_count as usize,
                    error: report.fatal_error.clone(),
                    record_id,
                    started_at: Some(started_at.clone()),
                    finished_at: Some(Utc::now().to_rfc3339()),
                }
            }
            Err(err) => {
                // Persist the audible failure so history keeps the trace.
                let failed = ScanReport {
                    id: scan_id.clone(),
                    started_at: started_at.clone(),
                    finished_at: Utc::now().to_rfc3339(),
                    duration_ms: 0,
                    targets: chunk.iter().map(|p| p.display().to_string()).collect(),
                    profile: "custom".to_string(),
                    excluded: Vec::new(),
                    indexed_files: None,
                    index_truncated: false,
                    limits: ScanLimits::default().sanitized(),
                    files_scanned: 0,
                    infected_files: 0,
                    error_count: chunk.len() as u64,
                    detections: Vec::new(),
                    errors: Vec::new(),
                    outcome: ScanOutcome::Failed,
                    cancelled: false,
                    engine_version: status.engine_version.clone(),
                    signature_version: status.signature_version.clone(),
                    summary: None,
                    fatal_error: Some(err.to_string()),
                };
                let record_id = state.store.save_scan(&failed).ok();
                BatchReportPayload {
                    outcome: "failed".to_string(),
                    files: chunk.len(),
                    files_scanned: 0,
                    detections: Vec::new(),
                    failures: chunk.len(),
                    error: Some(err.to_string()),
                    record_id,
                    started_at: Some(started_at.clone()),
                    finished_at: Some(Utc::now().to_rfc3339()),
                }
            }
        };

        update_last_batch(app, &payload);
        if !still_current(app, generation) {
            exit_because_replaced(app, generation);
            return;
        }
        let _ = app.emit(BATCH_EVENT, &payload);
    }

    {
        let mut inner = state
            .auto_scan
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if inner.generation == generation {
            inner.busy = None;
        }
    }
}

fn notify_if_detection(
    app: &AppHandle,
    report: &ScanReport,
    settings: &std::collections::HashMap<String, String>,
) {
    if report.detections.is_empty() {
        return;
    }
    let english = settings
        .get("language")
        .map(|value| value == "en")
        .unwrap_or(false);
    let count = report.detections.len();
    let title = "CBS Shield";
    let body = if english {
        format!(
            "Proactive monitor detected {count} suspicious file(s). Nothing was removed: review it in the Antivirus tab."
        )
    } else {
        format!(
            "La surveillance proactive a détecté {count} fichier(s) suspect(s). Aucune suppression automatique : examinez-les dans l'onglet Antivirus."
        )
    };
    let key = format!("proactive-detection-{}", report.id);
    let matched = {
        let app_state = app.state::<AppState>();
        let mut ring = app_state.notify_ring.lock().unwrap();
        ring.admit(&key)
    };
    if matched {
        crate::notify::show(app, title, &body);
    }
}

fn record_error(app: &AppHandle, generation: u64, message: String) {
    let state = app.state::<AppState>();
    let mut inner = state
        .auto_scan
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if inner.generation == generation {
        inner.last_error = Some(message);
    }
}

fn update_last_batch(app: &AppHandle, payload: &BatchReportPayload) {
    let state = app.state::<AppState>();
    let mut inner = state
        .auto_scan
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    inner.last_batch = Some(BatchSummary {
        files: payload.files,
        files_scanned: payload.files_scanned,
        detections: payload.detections.len(),
        failures: payload.failures,
        outcome: payload.outcome.clone(),
        record_id: payload.record_id,
        started_at: payload.started_at.clone(),
        finished_at: payload.finished_at.clone(),
        error: payload.error.clone(),
    });
    if payload.outcome == "failed" {
        inner.last_error = Some(
            payload
                .error
                .clone()
                .unwrap_or_else(|| "Échec du lot.".to_string()),
        );
    } else {
        inner.last_error = None;
    }
    inner.busy = None;
}

fn exit_because_replaced(app: &AppHandle, generation: u64) {
    // Nothing to record: a newer worker owns the state. Only make sure this
    // task does not touch state further.
    let state = app.state::<AppState>();
    let inner = state
        .auto_scan
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    debug_assert!(
        inner.generation != generation || !inner.enabled,
        "exit_because_replaced called on a current worker"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression: `start()` used to leave `enabled = false`, so `run()` exited
    /// on its first poll and automatic proactive analysis never scanned a file
    /// even though the user had consented.
    #[test]
    fn starting_worker_enables_consent_and_bumps_generation() {
        let mut inner = AutoScanState::default();
        assert!(!inner.enabled);

        let first = begin_worker(&mut inner);
        assert_eq!(first, 1);
        assert!(inner.enabled, "start must enable the worker");
        assert!(inner.running);
        assert!(!inner.cancel_requested);
        assert!(inner.busy.is_none());
        assert!(inner.last_error.is_none());

        // Restarting issues a fresh identity and keeps consent enabled.
        let second = begin_worker(&mut inner);
        assert_eq!(second, 2);
        assert!(inner.enabled);
        assert!(inner.running);
    }

    #[test]
    fn stopping_worker_revokes_consent_and_requests_cancel() {
        let mut inner = AutoScanState::default();
        begin_worker(&mut inner);
        end_worker(&mut inner);
        assert!(!inner.enabled);
        assert!(inner.cancel_requested);
        assert!(inner.busy.is_none());
    }

    #[test]
    fn worker_requires_enabled_after_start() {
        // `run()` treats `enabled == false` as an immediate exit. This is the
        // exact invariant that regressed in Sprint 9.6.
        let mut inner = AutoScanState::default();
        assert!(!inner.enabled, "default state must not auto-start");
        begin_worker(&mut inner);
        assert!(inner.enabled, "worker would exit immediately otherwise");
    }
}
