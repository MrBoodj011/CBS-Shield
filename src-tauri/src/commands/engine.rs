use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use cbs_core::{detect_engine, EngineStatus, SignatureState};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;

use crate::error::CommandError;
use crate::state::AppState;

const UPDATE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const MAX_LOG_LINES: usize = 400;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub product: String,
    pub version: String,
    pub vendor: String,
    pub phase: String,
    pub disclaimer: String,
    pub data_dir: String,
}

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        product: "CBS Shield".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        vendor: "Cybrense".to_string(),
        phase: "Phase 3 — interface produit (expérimental)".to_string(),
        disclaimer: "CBS Shield assure une protection manuelle expérimentale. Il ne fournit pas de protection en temps réel et ne remplace pas Microsoft Defender. Aucun pilote noyau, aucune règle de pare-feu et aucune modification de Defender ne sont effectués.".to_string(),
        data_dir: state.paths.data_dir.display().to_string(),
    }
}

pub(crate) fn non_empty(value: Option<&String>) -> Option<String> {
    value
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) fn signature_max_age(settings: &HashMap<String, String>) -> i64 {
    settings
        .get("signatureMaxAgeDays")
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| (1..=365).contains(value))
        .unwrap_or(7)
}

/// Probe ClamAV using the user's settings plus the application-local database.
pub(crate) fn probe_with_settings(
    state: &AppState,
    settings: &HashMap<String, String>,
) -> EngineStatus {
    let clamscan = non_empty(settings.get("clamscanPath")).map(PathBuf::from);
    let configured_database = non_empty(settings.get("databasePath")).map(PathBuf::from);

    // Prefer the user-scoped database maintained by CBS Shield when it holds
    // signatures, because the MSI default (Program Files) needs admin rights.
    let database = configured_database.or_else(|| {
        if cbs_core::engine::count_signature_files(&state.paths.signature_db) > 0 {
            Some(state.paths.signature_db.clone())
        } else {
            None
        }
    });

    detect_engine(
        clamscan,
        database,
        &state.paths.engine_search_dirs(),
        signature_max_age(settings),
    )
}

#[tauri::command]
pub fn engine_status(state: State<'_, AppState>) -> Result<EngineStatus, CommandError> {
    let settings = state.store.settings()?;
    Ok(probe_with_settings(&state, &settings))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureUpdateEvent {
    pub line: String,
    pub stream: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureUpdateResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub message: String,
    pub log: Vec<String>,
    pub engine: EngineStatus,
}

#[tauri::command]
pub async fn update_signatures(
    app: AppHandle,
    state: State<'_, AppState>,
    confirm: bool,
) -> Result<SignatureUpdateResult, CommandError> {
    if !confirm {
        return Err(CommandError::confirmation_required(
            "la mise à jour des signatures ClamAV",
        ));
    }
    // Audit fix (Sprint 2): freshclam rewrites the signature database while
    // clamscan reads it. Running both at the same time produced hard-to-
    // diagnose scan errors; an update is now refused while a scan is active.
    if state.is_scanning() {
        return Err(CommandError::new(
            "scanInProgress",
            "Un scan est en cours : attendez la fin du scan avant de mettre à jour les signatures.",
        ));
    }

    let settings = state.store.settings()?;
    let status = probe_with_settings(&state, &settings);
    let Some(freshclam) = status.freshclam_path.clone() else {
        return Err(CommandError::new(
            "freshclamMissing",
            "freshclam.exe est introuvable. Il est normalement installé avec ClamAV.",
        ));
    };

    let target_db = non_empty(settings.get("databasePath"))
        .map(PathBuf::from)
        .unwrap_or_else(|| state.paths.signature_db.clone());
    std::fs::create_dir_all(&target_db)?;
    std::fs::create_dir_all(&state.paths.clamav_dir)?;

    // freshclam requires a configuration file on Windows. It lives inside the
    // application data directory and is regenerated on every update.
    let config = format!(
        "# Généré par CBS Shield — mise à jour des signatures ClamAV\n\
         DatabaseDirectory {}\n\
         UpdateLogFile {}\n\
         DatabaseMirror database.clamav.net\n\
         Checks 1\n",
        target_db.display(),
        state.paths.freshclam_log.display()
    );
    std::fs::write(&state.paths.freshclam_conf, config)?;

    let mut command = Command::new(&freshclam);
    command
        .arg(format!(
            "--config-file={}",
            state.paths.freshclam_conf.display()
        ))
        .arg("--stdout")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    hide_console(&mut command);

    let mut child = command.spawn().map_err(|err| {
        CommandError::new(
            "engineError",
            format!("impossible de lancer freshclam : {err}"),
        )
    })?;

    let log: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let stdout_task = child
        .stdout
        .take()
        .map(|stdout| tokio::spawn(stream_output(stdout, "stdout", app.clone(), log.clone())));
    let stderr_task = child
        .stderr
        .take()
        .map(|stderr| tokio::spawn(stream_output(stderr, "stderr", app.clone(), log.clone())));

    let wait_result = tokio::time::timeout(UPDATE_TIMEOUT, child.wait()).await;
    let mut timed_out = false;
    let mut exit_code = None;
    match wait_result {
        Ok(Ok(status)) => exit_code = status.code(),
        Ok(Err(err)) => {
            return Err(CommandError::new(
                "engineError",
                format!("freshclam a échoué : {err}"),
            ))
        }
        Err(_) => {
            timed_out = true;
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
    }

    if let Some(task) = stdout_task {
        let _ = task.await;
    }
    if let Some(task) = stderr_task {
        let _ = task.await;
    }

    let lines = log.lock().map(|guard| guard.clone()).unwrap_or_default();
    // Classification is a pure function so the failure paths (network down,
    // permission denied, interruption) are unit-tested without a real run.
    let (success, summary) = summarize_update_run(&lines, timed_out, exit_code);
    let message = if success {
        format!(
            "Signatures téléchargées dans {}. Relancez le diagnostic pour vérifier la date.",
            target_db.display()
        )
    } else {
        summary
    };

    let engine = probe_with_settings(&state, &settings);
    let log_tail = lines
        .into_iter()
        .rev()
        .take(120)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();

    Ok(SignatureUpdateResult {
        success,
        exit_code,
        message,
        log: log_tail,
        engine,
    })
}

async fn stream_output<R>(
    reader: R,
    stream: &'static str,
    app: AppHandle,
    log: Arc<Mutex<Vec<String>>>,
) where
    R: AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();
    let mut last_progress = Instant::now() - Duration::from_secs(10);
    while let Ok(Some(line)) = lines.next_line().await {
        let trimmed = line.trim_end_matches('\r').trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with("Time:") {
            if last_progress.elapsed() < Duration::from_secs(2) {
                continue;
            }
            last_progress = Instant::now();
        }
        if let Ok(mut guard) = log.lock() {
            if guard.len() < MAX_LOG_LINES {
                guard.push(trimmed.clone());
            }
        }
        let _ = app.emit(
            "signatures:update",
            SignatureUpdateEvent {
                line: trimmed,
                stream: stream.to_string(),
            },
        );
    }
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.as_std_mut().creation_flags(0x0800_0000);
}

/// Classify one freshclam run (pure function, unit-tested).
///
/// Returns `(success, final message)`. The message names the observed cause:
/// interruption by timeout, missing write permission, unreachable network, or
/// the last explicit error line from freshclam itself.
pub fn summarize_update_run(
    lines: &[String],
    timed_out: bool,
    exit_code: Option<i32>,
) -> (bool, String) {
    let joined = lines.join("\n");
    let lower = joined.to_ascii_lowercase();
    let success = !timed_out
        && (exit_code == Some(0)
            || lower.contains("database is up to date")
            || lower.contains("database updated"));
    let permission_hint = lower.contains("permission denied")
        || lower.contains("can't open")
        || lower.contains("access denied")
        || lower.contains("write error");
    let network_hint = lower.contains("can't connect")
        || lower.contains("connection refused")
        || lower.contains("ip address not resolvable")
        || lower.contains("connection timed out")
        || lower.contains("can't resolve");

    if timed_out {
        return (
            false,
            "Délai dépassé (30 minutes) : la mise à jour a été interrompue.".to_string(),
        );
    }
    if success {
        return (true, "Mise à jour réussie.".to_string());
    }
    let detail = lines
        .iter()
        .rev()
        .find(|line| line.to_ascii_lowercase().contains("error"))
        .or_else(|| lines.iter().rev().find(|line| !line.trim().is_empty()))
        .cloned()
        .unwrap_or_else(|| format!("freshclam a renvoyé le code {:?}.", exit_code));
    if permission_hint {
        (
            false,
            format!("{detail} — le dossier de signatures n'est pas accessible en écriture."),
        )
    } else if network_hint {
        (
            false,
            format!("{detail} — vérifiez la connexion réseau ; database.clamav.net doit être accessible."),
        )
    } else {
        (false, detail)
    }
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

/// Kept for the UI: explicit reminder that outdated signatures still allow a
/// scan but should be refreshed.
pub fn signatures_blocked(status: &EngineStatus) -> bool {
    matches!(status.signature_state, SignatureState::Missing)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str) -> String {
        text.to_string()
    }

    #[test]
    fn classifies_up_to_date_database_as_success() {
        let (success, _) = summarize_update_run(
            &[line(
                "daily database is up to date (version: 27413, sigs: 28164, f-level: 90)",
            )],
            false,
            Some(0),
        );
        assert!(success);
    }

    #[test]
    fn classifies_updated_database_as_success() {
        let (success, _) = summarize_update_run(
            &[line(
                "daily.cvd updated (version: 27414, sigs: 28189, f-level: 90)",
            )],
            false,
            Some(0),
        );
        assert!(success);
    }

    #[test]
    fn classifies_unreachable_network() {
        let lines = vec![
            line("Trying to retrieve database.clamav.net..."),
            line("Error: Can't connect to port 80 of host database.clamav.net (IP: 104.16.219.84)"),
        ];
        let (success, message) = summarize_update_run(&lines, false, Some(1));
        assert!(!success);
        assert!(message.contains("connexion réseau"), "message: {message}");
    }

    #[test]
    fn classifies_unresolvable_host() {
        let lines = vec![line(
            "Error: Can't get information about database.clamav.net: IP address not resolvable",
        )];
        let (success, message) = summarize_update_run(&lines, false, Some(1));
        assert!(!success);
        assert!(message.contains("connexion réseau"), "message: {message}");
    }

    #[test]
    fn classifies_missing_write_permission() {
        let lines = vec![line(
            "ERROR: Can't open file: C:\\data\\daily.cvd.tmp (Permission denied)",
        )];
        let (success, message) = summarize_update_run(&lines, false, Some(1));
        assert!(!success);
        assert!(
            message.contains("dossier de signatures"),
            "message: {message}"
        );
    }

    #[test]
    fn classifies_timeout_interruption() {
        let (success, message) =
            summarize_update_run(&[line("Trying to download daily.cvd")], true, None);
        assert!(!success);
        assert!(message.contains("interrompue"), "message: {message}");
    }
}
