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
    if !name.starts_with("clamscan") {
        return Err(CommandError::new(
            "invalidSetting",
            "Le fichier sélectionné doit être clamscan.exe (ou clamscan).",
        ));
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
    let spawned = std::process::Command::new("explorer.exe")
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
    fn accepts_a_real_clamscan_binary_name() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("clamscan.exe");
        std::fs::write(&exe, b"not really a binary").unwrap();
        assert!(validate_clamscan_path(&exe.display().to_string()).is_ok());
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
