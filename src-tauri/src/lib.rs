mod commands;
mod error;
mod paths;
mod state;

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
            let paths = AppPaths::discover()?;
            paths.ensure()?;

            let store = Arc::new(Store::open(&paths.history_db)?);
            let quarantine = Quarantine::new(paths.quarantine_dir.clone());
            quarantine.ensure_layout()?;

            app.manage(AppState::new(paths, store, quarantine));
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
            commands::vault::quarantine_file,
            commands::vault::list_quarantine,
            commands::vault::restore_quarantine,
            commands::vault::delete_quarantine,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::settings::open_data_dir,
        ])
        .run(tauri::generate_context!())
        .expect("échec du démarrage de CBS Shield");
}
