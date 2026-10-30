//! Tauri mapping of CBS Proactive Monitor.
//!
//! The monitor is an observation layer only: it never claims real-time
//! antivirus protection and never changes any protection behaviour.

use tauri::State;

use cbs_proactive::{MonitorConfig, MonitorStatus};

use crate::error::CommandError;
use crate::state::AppState;

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
