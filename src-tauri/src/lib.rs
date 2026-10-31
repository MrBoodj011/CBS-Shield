mod commands;
mod error;
mod notify;
mod paths;
mod proactive_worker;
mod state;
mod tray;

pub use error::CommandError;
pub use paths::AppPaths;
pub use state::AppState;

use std::sync::Arc;

use cbs_quarantine::Quarantine;
use cbs_store::Store;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch exits before any other
        // plugin initialises, so there is only ever one store owner, one
        // proactive worker and one quarantine vault.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Audit fix: canonicalize the data directory (also creates the
            // layout) so every containment check compares comparable paths.
            let paths = AppPaths::discover()?.canonicalized()?;

            let store = Arc::new(Store::open(&paths.history_db)?);
            let quarantine = Quarantine::new(paths.quarantine_dir.clone());
            quarantine.ensure_layout()?;

            app.manage(AppState::new(paths, store, quarantine));

            // Sprint 9.1: start the consent-controlled proactive scanning
            // worker only when the user previously opted in (persisted flag).
            // The worker itself re-checks the engine every cycle.
            crate::proactive_worker::spawn_if_enabled(app.handle().clone());

            // Sprint 3: optional native tray entry point. The stored language is
            // read here so the menu starts in the user's language.
            let language = app
                .state::<AppState>()
                .store
                .settings()
                .ok()
                .and_then(|map| map.get("language").cloned())
                .unwrap_or_else(|| "fr".to_string());
            tray::setup(app.handle(), &language);
            commands::engine::spawn_auto_update_scheduler(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::engine::app_info,
            commands::engine::engine_status,
            commands::engine::update_signatures,
            commands::scans::start_scan,
            commands::scans::cancel_scan,
            commands::scans::list_scans,
            commands::scans::get_scan_details,
            commands::scans::dashboard_stats,
            commands::scans::resolve_scan_targets,
            commands::reports::export_scan_report,
            commands::signatures::signature_inventory,
            commands::signatures::update_logs,
            commands::signatures::provisioning_status,
            commands::signatures::open_documentation,
            commands::signatures::install_clamav,
            commands::signatures::install_clamav_portable,
            commands::vault::quarantine_file,
            commands::vault::list_quarantine,
            commands::vault::restore_quarantine,
            commands::vault::delete_quarantine,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::settings::open_data_dir,
            commands::netmon::netmon_snapshot,
            commands::netmon::netmon_history,
            commands::firewall::firewall_status,
            commands::firewall::firewall_acknowledge_baseline,
            commands::firewall::firewall_connections,
            commands::firewall::firewall_export_snapshot,
            commands::firewall::firewall_snapshot_history,
            commands::firewall::firewall_verify_snapshot,
            commands::firewall::firewall_management_status,
            commands::webguard::webguard_snapshot,
            commands::webguard::webguard_start_monitor,
            commands::webguard::webguard_stop_monitor,
            commands::webguard::webguard_test_domain,
            commands::webguard::webguard_import_filter,
            commands::webguard::webguard_add_allowlist,
            commands::webguard::webguard_remove_allowlist,
            commands::webguard::webguard_clear_history,
            commands::webguard::webguard_clear_blocklist,
            commands::proactive::proactive_snapshot,
            commands::proactive::proactive_set_directories,
            commands::proactive::proactive_set_config,
            commands::proactive::proactive_set_auto_watch,
            commands::proactive::proactive_set_auto_scan,
            commands::proactive::proactive_scan_status,
            commands::proactive::proactive_start,
            commands::proactive::proactive_pause,
            commands::proactive::proactive_resume,
            commands::proactive::proactive_stop,
            commands::proactive::proactive_drain,
            commands::proactive::proactive_clear,
            tray::set_tray_language,
        ])
        .run(tauri::generate_context!())
        .expect("échec du démarrage de CBS Shield");
}
