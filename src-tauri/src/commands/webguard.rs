//! CBS Web Guard commands.
//!
//! The backend exposes a local classification engine and a loopback DNS
//! prototype. It never edits the system DNS configuration, hosts file,
//! firewall, proxy or TLS store. Import files are chosen by the user through
//! the native dialog; only bounded local content is read.

use std::path::PathBuf;

use cbs_webguard::{DomainTestResult, ImportResult, WebGuardError, WebGuardView};
use tauri::State;

use crate::error::CommandError;
use crate::state::AppState;

fn map_error(error: WebGuardError) -> CommandError {
    let code = match &error {
        WebGuardError::InvalidDomain(_) => "invalidDomain",
        WebGuardError::InvalidCategory(_) => "invalidCategory",
        WebGuardError::ImportTooLarge(_) => "importTooLarge",
        WebGuardError::ImportEmpty => "importEmpty",
        WebGuardError::InvalidEncoding => "importInvalidEncoding",
        WebGuardError::ConfirmationRequired => "confirmationRequired",
        WebGuardError::ProxyAlreadyRunning => "proxyAlreadyRunning",
        WebGuardError::ProxyNotRunning => "proxyNotRunning",
        WebGuardError::ProxyStart(_) => "proxyStartFailed",
        WebGuardError::NoUpstreamResolver => "noUpstreamResolver",
        WebGuardError::Io(_) => "ioError",
        WebGuardError::Json(_) => "stateCorrupt",
    };
    CommandError::new(code, error.to_string())
}

#[tauri::command]
pub fn webguard_snapshot(state: State<'_, AppState>) -> WebGuardView {
    state.webguard.view()
}

#[tauri::command]
pub fn webguard_start_monitor(state: State<'_, AppState>) -> Result<WebGuardView, CommandError> {
    state.webguard.start_monitor().map_err(map_error)?;
    Ok(state.webguard.view())
}

#[tauri::command]
pub fn webguard_stop_monitor(state: State<'_, AppState>) -> Result<WebGuardView, CommandError> {
    state.webguard.stop_monitor().map_err(map_error)?;
    Ok(state.webguard.view())
}

#[tauri::command]
pub fn webguard_test_domain(
    state: State<'_, AppState>,
    domain: String,
) -> Result<DomainTestResult, CommandError> {
    state.webguard.test_domain(&domain).map_err(map_error)
}

#[tauri::command]
pub fn webguard_import_filter(
    state: State<'_, AppState>,
    path: String,
    category: String,
    confirm: bool,
) -> Result<ImportResult, CommandError> {
    let path = PathBuf::from(path);
    state
        .webguard
        .import_filter(&path, &category, confirm, None)
        .map_err(map_error)
}

#[tauri::command]
pub fn webguard_add_allowlist(
    state: State<'_, AppState>,
    domain: String,
    note: String,
) -> Result<WebGuardView, CommandError> {
    state
        .webguard
        .add_allowlist(&domain, &note)
        .map_err(map_error)?;
    Ok(state.webguard.view())
}

#[tauri::command]
pub fn webguard_remove_allowlist(
    state: State<'_, AppState>,
    domain: String,
) -> Result<WebGuardView, CommandError> {
    state
        .webguard
        .remove_allowlist(&domain)
        .map_err(map_error)?;
    Ok(state.webguard.view())
}

#[tauri::command]
pub fn webguard_clear_history(
    state: State<'_, AppState>,
    confirm: bool,
) -> Result<WebGuardView, CommandError> {
    state.webguard.clear_history(confirm).map_err(map_error)?;
    Ok(state.webguard.view())
}

#[tauri::command]
pub fn webguard_clear_blocklist(
    state: State<'_, AppState>,
    confirm: bool,
) -> Result<WebGuardView, CommandError> {
    state.webguard.clear_blocklist(confirm).map_err(map_error)?;
    Ok(state.webguard.view())
}
