//! Native Windows tray integration (Sprint 3, extended in Sprint 9).
//!
//! Scope is deliberately safe: the tray is an *additional* entry point. It
//! never intercepts the window close button, never hides the window on its
//! own and never changes protection behaviour. Menu entries only focus the
//! window and navigate the UI to an existing section; no scan is ever
//! triggered silently from the tray because security actions require the
//! visible, explicit UI. If the tray cannot be created the application keeps
//! working exactly as before.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::error::CommandError;

const TRAY_ID: &str = "cbs-shield-tray";
/// Event name emitted to the webview when the user picks a destination that
/// is not the plain "open" action.
const NAVIGATE_EVENT: &str = "tray-navigate";

/// Menu labels follow the interface language (fr by default).
fn menu<R: Runtime>(app: &AppHandle<R>, language: &str) -> tauri::Result<Menu<R>> {
    let (open, quarantine, network, quit) = if language == "en" {
        (
            "Open CBS Shield",
            "Open Quarantine",
            "Open Network Monitor",
            "Quit",
        )
    } else {
        (
            "Ouvrir CBS Shield",
            "Ouvrir la quarantaine",
            "Ouvrir le moniteur réseau",
            "Quitter",
        )
    };
    let open_item = MenuItem::with_id(app, "open", open, true, None::<&str>)?;
    let quarantine_item = MenuItem::with_id(app, "quarantine", quarantine, true, None::<&str>)?;
    let network_item = MenuItem::with_id(app, "network", network, true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", quit, true, None::<&str>)?;
    Menu::with_items(
        app,
        &[&open_item, &quarantine_item, &network_item, &quit_item],
    )
}

fn focus_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Focus the main window and ask the React UI to navigate to a section.
/// Navigation happens through the normal UI state machine: the tray never
/// mutates application state directly.
fn navigate<R: Runtime>(app: &AppHandle<R>, section: &'static str) {
    focus_main(app);
    let _ = app.emit(NAVIGATE_EVENT, section);
}

/// Create the tray icon. Best effort: a missing icon or a shell rejection must
/// never prevent the application from starting.
pub fn setup<R: Runtime>(app: &AppHandle<R>, language: &str) {
    let Some(icon) = app.default_window_icon().cloned() else {
        return;
    };

    let Ok(built_menu) = menu(app, language) else {
        return;
    };

    let _ = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("CBS Shield")
        .menu(&built_menu)
        // Right-click opens the menu; left-click focuses the window.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => focus_main(app),
            "quarantine" => navigate(app, "quarantine"),
            "network" => navigate(app, "network"),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                focus_main(tray.app_handle());
            }
        })
        .build(app);
}

/// Rebuild the tray menu when the user switches language.
/// Returns `true` when the tray exists and its menu was updated (used by the
/// frontend smoke test and to keep the UI honest if the shell refuses a tray).
#[tauri::command]
pub fn set_tray_language(app: AppHandle, language: String) -> Result<bool, CommandError> {
    let language = crate::commands::settings::normalize_language(&language)?;
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(false);
    };
    let rebuilt = menu(&app, &language)
        .map_err(|err| CommandError::new("trayError", format!("Menu système : {err}")))?;
    tray.set_menu(Some(rebuilt))
        .map_err(|err| CommandError::new("trayError", format!("Menu système : {err}")))?;
    Ok(true)
}
