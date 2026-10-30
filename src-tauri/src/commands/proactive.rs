//! Tauri mapping of CBS Proactive Monitor.
//!
//! The monitor is an observation layer only: it never claims real-time
//! antivirus protection and never changes any protection behaviour.

use tauri::{AppHandle, Manager, State};

use crate::commands::engine::{probe_with_settings, signatures_blocked};
use crate::error::CommandError;
use crate::state::{AppState, AutoScanStatus};
use cbs_proactive::{MonitorConfig, MonitorStatus};

impl From<cbs_proactive::MonitorError> for CommandError {
    fn from(error: cbs_proactive::MonitorError) -> Self {
        use cbs_proactive::MonitorError;
        let code = match &error {
            MonitorError::InvalidConfig(_) => "proactiveConfig",
            MonitorError::Internal(_) => "proactiveInternal",
        };
        Self::new(code, error.to_string())
    }
}

#[tauri::command]
pub fn proactive_snapshot(state: State<'_, AppState>) -> Result<MonitorStatus, CommandError> {
    state.proactive.snapshot().map_err(CommandError::from)
}

#[tauri::command]
pub fn proactive_set_directories(
    state: State<'_, AppState>,
    directories: Vec<String>,
) -> Result<MonitorStatus, CommandError> {
    state
        .proactive
        .set_directories(directories)
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn proactive_set_config(
    state: State<'_, AppState>,
    config: MonitorConfig,
) -> Result<MonitorStatus, CommandError> {
    state
        .proactive
        .set_config(config)
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn proactive_set_auto_watch(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<MonitorStatus, CommandError> {
    state
        .proactive
        .set_auto_watch(enabled)
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn proactive_start(state: State<'_, AppState>) -> Result<MonitorStatus, CommandError> {
    state.proactive.start().map_err(CommandError::from)
}

#[tauri::command]
pub fn proactive_pause(state: State<'_, AppState>) -> Result<MonitorStatus, CommandError> {
    state.proactive.pause().map_err(CommandError::from)
}

#[tauri::command]
pub fn proactive_resume(state: State<'_, AppState>) -> Result<MonitorStatus, CommandError> {
    state.proactive.resume().map_err(CommandError::from)
}

#[tauri::command]
pub fn proactive_stop(state: State<'_, AppState>) -> Result<MonitorStatus, CommandError> {
    state.proactive.stop().map_err(CommandError::from)
}

#[tauri::command]
pub fn proactive_drain(state: State<'_, AppState>) -> Result<Vec<String>, CommandError> {
    state
        .proactive
        .drain_queue()
        .map(|queue| {
            queue
                .into_iter()
                .map(|path| path.display().to_string())
                .collect()
        })
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn proactive_clear(state: State<'_, AppState>) -> Result<MonitorStatus, CommandError> {
    state.proactive.clear().map_err(CommandError::from)
}

#[tauri::command]
pub fn proactive_scan_status(state: State<'_, AppState>) -> AutoScanStatus {
    let inner = state
        .auto_scan
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    AutoScanStatus {
        enabled: inner.enabled,
        running: inner.running,
        cancel_requested: inner.cancel_requested,
        busy_files: inner.busy.clone(),
        last_error: inner.last_error.clone(),
        last_batch: inner.last_batch.clone(),
    }
}

/// Explicit user consent for automatic analysis of the proactive review
/// queue. The consent is persisted; the worker starts/stops cooperatively.
#[tauri::command]
pub async fn proactive_set_auto_scan(
    app: AppHandle,
    enabled: bool,
) -> Result<AutoScanStatus, CommandError> {
    let state = app.state::<AppState>();
    if enabled {
        // Consent requires a working engine: never start a worker that can
        // only produce failures.
        let settings = state.store.settings()?;
        let status = probe_with_settings(state.inner(), &settings);
        if !status.installed {
            return Err(CommandError::new("engineMissing", status.message));
        }
        if signatures_blocked(&status) {
            return Err(CommandError::new("signaturesMissing", status.message));
        }
    }
    state
        .store
        .set_setting("proactiveAutoScan", if enabled { "true" } else { "false" })?;
    if enabled {
        crate::proactive_worker::start(app.clone());
    } else {
        crate::proactive_worker::stop(&app);
    }
    let state = app.state::<AppState>();
    let inner = state
        .auto_scan
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Ok(AutoScanStatus {
        enabled: inner.enabled,
        running: inner.running,
        cancel_requested: inner.cancel_requested,
        busy_files: inner.busy.clone(),
        last_error: inner.last_error.clone(),
        last_batch: inner.last_batch.clone(),
    })
}
