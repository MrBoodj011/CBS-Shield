use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::engine::non_empty;
use crate::error::CommandError;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub theme: String,
    pub language: String,
    pub recursive: bool,
    pub include_pua: bool,
    pub clamscan_path: Option<String>,
    pub database_path: Option<String>,
    pub signature_max_age_days: i64,
    pub auto_update: bool,
    pub auto_update_hours: i64,
    pub onboarding_completed: bool,
    pub data_dir: String,
    pub history_path: String,
    pub quarantine_path: String,
    pub signature_db_path: String,
    pub freshclam_conf_path: String,
    pub app_version: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub theme: Option<String>,
    pub language: Option<String>,
    pub recursive: Option<bool>,
    pub include_pua: Option<bool>,
    pub clamscan_path: Option<String>,
    pub database_path: Option<String>,
    pub signature_max_age_days: Option<i64>,
    pub auto_update: Option<bool>,
    pub auto_update_hours: Option<i64>,
    pub onboarding_completed: Option<bool>,
}

/// Supported interface languages. Stored as a plain `settings` key/value entry:
/// no schema migration is needed, unknown values gracefully fall back to French.
pub(crate) fn normalize_language(raw: &str) -> Result<String, CommandError> {
    let language = raw.trim().to_ascii_lowercase();
    if matches!(language.as_str(), "fr" | "en") {
        Ok(language)
    } else {
        Err(CommandError::new(
            "invalidSetting",
            "Langue invalide (fr ou en attendu).",
        ))
    }
}

fn parse_bool(value: Option<&String>, default: bool) -> bool {
    match value.map(|value| value.as_str()) {
        Some("true") => true,
        Some("false") => false,
        _ => default,
    }
}

pub(crate) fn validate_clamscan_path(raw: &str) -> Result<PathBuf, CommandError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(CommandError::new(
            "invalidSetting",
            "Le chemin de clamscan.exe est vide.",
        ));
    }
    let path = PathBuf::from(trimmed);
    if !path.is_file() {
        return Err(CommandError::new(
            "invalidSetting",
            format!("clamscan.exe est introuvable : {}", path.display()),
        ));
    }
    let canonical = path.canonicalize().map_err(|err| {
        CommandError::new(
            "invalidSetting",
            format!("Chemin invalide ({}): {err}", path.display()),
        )
    })?;
    let name = canonical
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let expected = if cfg!(windows) {
        "clamscan.exe"
    } else {
        "clamscan"
    };
    if name != expected {
        return Err(CommandError::new(
            "invalidSetting",
            format!("Le fichier sélectionné doit s'appeler exactement {expected}."),
        ));
    }
    // This path is executed by manual scans and the proactive worker, so a
    // lone renamed program (e.g. `clamscan.exe` dropped in Downloads) must not
    // qualify. Official ClamAV builds are not Authenticode-signed, so instead
    // the binary must sit in a real ClamAV installation layout.
    #[cfg(windows)]
    {
        let dir = canonical
            .parent()
            .unwrap_or_else(|| std::path::Path::new(""));
        let missing: Vec<&str> = ["libclamav.dll", "freshclam.exe"]
            .into_iter()
            .filter(|sibling| !dir.join(sibling).is_file())
            .collect();
        if !missing.is_empty() {
            return Err(CommandError::new(
                "invalidSetting",
                format!(
                    "Ce dossier ne ressemble pas à une installation ClamAV (fichiers manquants : {}).",
                    missing.join(", ")
                ),
            ));
        }
    }
    Ok(canonical)
}

pub(crate) fn validate_database_path(raw: &str) -> Result<PathBuf, CommandError> {
    let path = PathBuf::from(raw.trim());
    if !path.is_dir() {
        return Err(CommandError::new(
            "invalidSetting",
            format!("Dossier de signatures introuvable : {}", path.display()),
        ));
    }
    path.canonicalize().map_err(|err| {
        CommandError::new(
            "invalidSetting",
            format!("Dossier invalide ({}): {err}", path.display()),
        )
    })
}

fn build_view(state: &AppState, map: &HashMap<String, String>) -> SettingsView {
    SettingsView {
        theme: map
            .get("theme")
            .cloned()
            .unwrap_or_else(|| "dark".to_string()),
        language: map
            .get("language")
            .cloned()
            .filter(|value| matches!(value.as_str(), "fr" | "en"))
            .unwrap_or_else(|| "fr".to_string()),
        recursive: parse_bool(map.get("recursive"), true),
        include_pua: parse_bool(map.get("includePua"), false),
        clamscan_path: non_empty(map.get("clamscanPath")),
        database_path: non_empty(map.get("databasePath")),
        signature_max_age_days: map
            .get("signatureMaxAgeDays")
            .and_then(|value| value.parse::<i64>().ok())
            .filter(|value| (1..=365).contains(value))
            .unwrap_or(7),
        auto_update: parse_bool(map.get("autoUpdate"), false),
        auto_update_hours: map
            .get("autoUpdateHours")
            .and_then(|value| value.parse::<i64>().ok())
            .filter(|value| (6..=168).contains(value))
            .unwrap_or(24),
        onboarding_completed: parse_bool(map.get("onboardingCompleted"), false),
        data_dir: state.paths.data_dir.display().to_string(),
        history_path: state.paths.history_db.display().to_string(),
        quarantine_path: state.paths.quarantine_dir.display().to_string(),
        signature_db_path: state.paths.signature_db.display().to_string(),
        freshclam_conf_path: state.paths.freshclam_conf.display().to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<SettingsView, CommandError> {
    let map = state.store.settings()?;
    Ok(build_view(&state, &map))
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> Result<SettingsView, CommandError> {
    let mut updates: Vec<(&str, String)> = Vec::new();

    if let Some(theme) = patch.theme {
        let theme = theme.trim().to_ascii_lowercase();
        if !matches!(theme.as_str(), "dark" | "light" | "system") {
            return Err(CommandError::new(
                "invalidSetting",
                "Thème invalide (dark, light ou system attendu).",
            ));
        }
        updates.push(("theme", theme));
    }

    if let Some(language) = patch.language {
        updates.push(("language", normalize_language(&language)?));
    }

    if let Some(recursive) = patch.recursive {
        updates.push(("recursive", recursive.to_string()));
    }
    if let Some(include_pua) = patch.include_pua {
        updates.push(("includePua", include_pua.to_string()));
    }
    if let Some(auto_update) = patch.auto_update {
        updates.push(("autoUpdate", auto_update.to_string()));
    }
    if let Some(onboarding_completed) = patch.onboarding_completed {
        updates.push(("onboardingCompleted", onboarding_completed.to_string()));
    }
    if let Some(hours) = patch.auto_update_hours {
        if !(6..=168).contains(&hours) {
            return Err(CommandError::new(
                "invalidSetting",
                "L'intervalle de mise à jour doit être compris entre 6 et 168 heures.",
            ));
        }
        updates.push(("autoUpdateHours", hours.to_string()));
    }

    if let Some(raw) = patch.clamscan_path {
        if raw.trim().is_empty() {
            updates.push(("clamscanPath", String::new()));
        } else {
            let path = validate_clamscan_path(&raw)?;
            updates.push(("clamscanPath", path.display().to_string()));
        }
    }

    if let Some(raw) = patch.database_path {
        if raw.trim().is_empty() {
            updates.push(("databasePath", String::new()));
        } else {
            let path = validate_database_path(&raw)?;
            updates.push(("databasePath", path.display().to_string()));
        }
    }

    if let Some(max_age) = patch.signature_max_age_days {
        if !(1..=365).contains(&max_age) {
            return Err(CommandError::new(
                "invalidSetting",
                "Le seuil de fraîcheur doit être compris entre 1 et 365 jours.",
            ));
        }
        updates.push(("signatureMaxAgeDays", max_age.to_string()));
    }

    for (key, value) in updates {
        state.store.set_setting(key, &value)?;
    }

    let map = state.store.settings()?;
    Ok(build_view(&state, &map))
}

#[tauri::command]
pub fn open_data_dir(state: State<'_, AppState>) -> Result<(), CommandError> {
    let path = state.paths.data_dir.clone();
    if !path.is_dir() {
        return Err(CommandError::new(
            "notFound",
            format!("Dossier de données introuvable : {}", path.display()),
        ));
    }

    #[cfg(windows)]
    let spawned = std::process::Command::new(cbs_core::fsutil::windows_tool("explorer.exe"))
        .arg(&path)
        .spawn();
    #[cfg(not(windows))]
    let spawned = std::process::Command::new("xdg-open").arg(&path).spawn();

    spawned.map(|_| ()).map_err(|err| {
        CommandError::new("ioError", format!("Impossible d'ouvrir le dossier : {err}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_clamscan_inside_a_clamav_layout() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("clamscan.exe");
        std::fs::write(&exe, b"not really a binary").unwrap();
        std::fs::write(dir.path().join("libclamav.dll"), b"x").unwrap();
        std::fs::write(dir.path().join("freshclam.exe"), b"x").unwrap();
        assert!(validate_clamscan_path(&exe.display().to_string()).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn rejects_a_lone_clamscan_outside_a_clamav_installation() {
        // Regression: any file whose name merely started with "clamscan"
        // (e.g. dropped in Downloads) became the executed engine.
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("clamscan.exe");
        std::fs::write(&exe, b"x").unwrap();
        assert!(validate_clamscan_path(&exe.display().to_string()).is_err());

        let renamed = dir.path().join("clamscan-helper.exe");
        std::fs::write(&renamed, b"x").unwrap();
        std::fs::write(dir.path().join("libclamav.dll"), b"x").unwrap();
        std::fs::write(dir.path().join("freshclam.exe"), b"x").unwrap();
        assert!(validate_clamscan_path(&renamed.display().to_string()).is_err());
    }

    #[test]
    fn rejects_unrelated_binary_names() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("notepad.exe");
        std::fs::write(&exe, b"x").unwrap();
        assert!(validate_clamscan_path(&exe.display().to_string()).is_err());
    }

    #[test]
    fn normalizes_supported_languages_only() {
        assert_eq!(normalize_language(" FR ").unwrap(), "fr");
        assert_eq!(normalize_language("en").unwrap(), "en");
        assert!(normalize_language("de").is_err());
        assert!(normalize_language("").is_err());
    }

    #[test]
    fn validates_database_directory() {
        let dir = tempfile::tempdir().unwrap();
        assert!(validate_database_path(&dir.path().display().to_string()).is_ok());
        assert!(validate_database_path(&dir.path().join("missing").display().to_string()).is_err());
    }
}
