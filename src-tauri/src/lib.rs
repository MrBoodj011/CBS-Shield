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

            // Sprint 9.7: fit the initial window inside the monitor work area.
            // Tauri sizes are logical pixels; on a 1024x768 screen at 125%
            // scaling only ~819x582 logical pixels are available, which is
            // smaller than the 1380x900 design default. Clamping here keeps
            // the window fully on-screen and lowers the effective minimum
            // instead of forcing an off-screen or clipped window.
            if let Some(window) = app.get_webview_window("main") {
                fit_window_to_work_area(&window);
            }

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

/// Design default for the main window, in logical pixels.
const TARGET_WINDOW_WIDTH: f64 = 1380.0;
const TARGET_WINDOW_HEIGHT: f64 = 900.0;
/// Smallest window CBS Shield supports. 800x560 logical pixels still fits a
/// 1024x768 panel at 125% Windows scaling (about 819x582 logical pixels).
const MIN_WINDOW_WIDTH: f64 = 800.0;
const MIN_WINDOW_HEIGHT: f64 = 560.0;
/// Breathing room so the frame and shadow stay inside the work area.
const SCREEN_MARGIN: f64 = 16.0;

fn fit_window_to_work_area(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let scale = monitor.scale_factor();
    if scale <= 0.0 {
        return;
    }
    let work_area = monitor.work_area();
    let work_width = work_area.size.width as f64 / scale;
    let work_height = work_area.size.height as f64 / scale;

    let (width, height, min_width, min_height) = fit_size(work_width, work_height);
    let _ = window.set_min_size(Some(tauri::LogicalSize::new(min_width, min_height)));
    let _ = window.set_size(tauri::LogicalSize::new(width, height));
    let _ = window.center();
}

/// Computes the initial window size and the effective minimum for a work area.
/// Returns `(width, height, min_width, min_height)` in logical pixels.
///
/// The window never exceeds the work area; when the screen is smaller than the
/// supported minimum the minimum is lowered to the screen instead of forcing a
/// clipped window.
fn fit_size(work_width: f64, work_height: f64) -> (f64, f64, f64, f64) {
    let available_width = (work_width - SCREEN_MARGIN).max(1.0);
    let available_height = (work_height - SCREEN_MARGIN).max(1.0);

    let min_width = MIN_WINDOW_WIDTH.min(available_width);
    let min_height = MIN_WINDOW_HEIGHT.min(available_height);

    let width = TARGET_WINDOW_WIDTH.min(available_width).max(min_width);
    let height = TARGET_WINDOW_HEIGHT.min(available_height).max(min_height);

    (width, height, min_width, min_height)
}

#[cfg(test)]
mod window_fit_tests {
    use super::fit_size;

    #[test]
    fn large_screen_keeps_the_design_default() {
        let (width, height, min_width, min_height) = fit_size(1920.0, 1040.0);
        assert_eq!((width, height), (1380.0, 900.0));
        assert_eq!((min_width, min_height), (800.0, 560.0));
    }

    #[test]
    fn scaled_1024x768_work_area_still_fits() {
        // 1024x768 at 125% -> about 819.2x582.4 logical pixels.
        let (width, height, min_width, min_height) = fit_size(819.2, 582.4);
        assert!((width - 803.2).abs() < 1e-9, "width was {width}");
        assert!((height - 566.4).abs() < 1e-9, "height was {height}");
        assert_eq!(min_width, 800.0);
        assert_eq!(min_height, 560.0);
        assert!(width <= 819.2);
        assert!(height <= 582.4);
    }

    #[test]
    fn tiny_screen_lowers_the_minimum_instead_of_overflowing() {
        let (width, height, min_width, min_height) = fit_size(640.0, 480.0);
        assert_eq!((width, height), (624.0, 464.0));
        assert_eq!((min_width, min_height), (624.0, 464.0));
    }

    #[test]
    fn window_never_exceeds_the_work_area() {
        for (work_width, work_height) in [
            (800.0, 600.0),
            (1024.0, 728.0),
            (1366.0, 728.0),
            (2560.0, 1400.0),
        ] {
            let (width, height, min_width, min_height) = fit_size(work_width, work_height);
            assert!(width <= work_width, "{width} > {work_width}");
            assert!(height <= work_height, "{height} > {work_height}");
            assert!(min_width <= width);
            assert!(min_height <= height);
        }
    }
}
