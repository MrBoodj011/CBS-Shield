//! CBS Web Guard commands.
//!
//! The backend exposes a local classification engine and a loopback DNS
//! prototype. It never edits the system DNS configuration, hosts file,
//! firewall, proxy or TLS store. Import files are chosen by the user through
//! the native dialog; only bounded local content is read.

use std::path::PathBuf;
use std::sync::Arc;

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

/// Run blocking Web Guard work (DNS probes, `sc query`, joining the resolver
/// thread) on the blocking pool. Synchronous Tauri commands execute on the
/// main thread, so these calls used to freeze the whole window for seconds.
async fn off_ui_thread<T, F>(work: F) -> Result<T, CommandError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, CommandError> + Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|err| CommandError::internal(format!("tâche Web Guard interrompue : {err}")))?
}

#[tauri::command]
pub async fn webguard_snapshot(state: State<'_, AppState>) -> Result<WebGuardView, CommandError> {
    let guard = Arc::clone(&state.webguard);
    off_ui_thread(move || Ok(guard.view())).await
}

#[tauri::command]
pub async fn webguard_start_monitor(
    state: State<'_, AppState>,
) -> Result<WebGuardView, CommandError> {
    let guard = Arc::clone(&state.webguard);
    off_ui_thread(move || {
        guard.start_monitor().map_err(map_error)?;
        Ok(guard.view())
    })
    .await
}

#[tauri::command]
pub async fn webguard_stop_monitor(
    state: State<'_, AppState>,
) -> Result<WebGuardView, CommandError> {
    let guard = Arc::clone(&state.webguard);
    off_ui_thread(move || {
        guard.stop_monitor().map_err(map_error)?;
        Ok(guard.view())
    })
    .await
}

#[tauri::command]
pub async fn webguard_test_domain(
    state: State<'_, AppState>,
    domain: String,
) -> Result<DomainTestResult, CommandError> {
    let guard = Arc::clone(&state.webguard);
    off_ui_thread(move || guard.test_domain(&domain).map_err(map_error)).await
}

#[tauri::command]
pub fn webguard_import_filter(
    state: State<'_, AppState>,
    path: String,
    category: String,
    confirm: bool,
) -> Result<ImportResult, CommandError> {
    let path = PathBuf::from(path);
    // The file picker is UI-only: enforce on the backend that the import is
    // an absolute, regular file outside CBS Shield's own data directory.
    let resolved = crate::commands::vault::normalized_path(&path)
        .filter(|_| path.is_absolute() && path.is_file())
        .ok_or_else(|| {
            CommandError::new(
                "invalidImportPath",
                "Le fichier de liste doit être un fichier existant désigné par un chemin absolu.",
            )
        })?;
    let data_root = crate::commands::vault::normalized_path(&state.paths.data_dir)
        .unwrap_or_else(|| state.paths.data_dir.clone());
    if crate::commands::vault::path_is_inside(&resolved, &data_root) {
        return Err(CommandError::new(
            "forbiddenImportPath",
            "L'import depuis le dossier interne de CBS Shield est refusé.",
        ));
    }
    state
        .webguard
        .import_filter(&resolved, &category, confirm, None)
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
