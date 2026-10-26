mod commands;
mod error;
mod paths;
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
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Audit fix: canonicalize the data directory (also creates the
            // layout) so every containment check compares comparable paths.
            let paths = AppPaths::discover()?.canonicalized()?;

            let store = Arc::new(Store::open(&paths.history_db)?);
            let quarantine = Quarantine::new(paths.quarantine_dir.clone());
            quarantine.ensure_layout()?;

            app.manage(AppState::new(paths, store, quarantine));

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
            tray::set_tray_language,
        ])
        .run(tauri::generate_context!())
        .expect("échec du démarrage de CBS Shield");
}
