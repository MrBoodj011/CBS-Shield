//! Signature inventory, update logs and dependency provisioning status.

use std::time::Duration;

use cbs_core::{read_inventory, SignatureInventory};
use serde::Serialize;
use tauri::State;

use crate::commands::engine::probe_with_settings;
use crate::error::CommandError;
use crate::state::AppState;

const MAX_LOG_LINES: usize = 200;

#[tauri::command]
pub fn signature_inventory(state: State<'_, AppState>) -> Result<SignatureInventory, CommandError> {
    let settings = state.store.settings()?;
    let status = probe_with_settings(&state, &settings);
    Ok(read_inventory(
        status.database_path.as_deref(),
        status.sigtool_path.as_deref(),
    ))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLogs {
    pub app_log_path: String,
    pub freshclam_log_path: String,
    pub app_lines: Vec<String>,
    pub freshclam_lines: Vec<String>,
}

#[tauri::command]
pub fn update_logs(state: State<'_, AppState>) -> UpdateLogs {
    let app_log = state.paths.data_dir.join("updates.log");
    UpdateLogs {
        app_log_path: app_log.display().to_string(),
        freshclam_log_path: state.paths.freshclam_log.display().to_string(),
        app_lines: tail_lines(&app_log, MAX_LOG_LINES),
        freshclam_lines: tail_lines(&state.paths.freshclam_log, MAX_LOG_LINES),
    }
}

fn tail_lines(path: &std::path::Path, limit: usize) -> Vec<String> {
    use std::io::BufRead;
    let Ok(file) = std::fs::File::open(path) else {
        return Vec::new();
    };
    let mut lines: Vec<String> = std::io::BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .collect();
    if lines.len() > limit {
        lines = lines.split_off(lines.len() - limit);
    }
    lines
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisioningStatus {
    pub winget_available: bool,
    pub winget_version: Option<String>,
    pub clamav_installed: bool,
    pub clamscan_path: Option<String>,
    pub database_path: Option<String>,
    pub install_command: String,
    pub probe_command: String,
    pub docs_url: String,
    pub license_note: String,
    pub checked_at: String,
}

#[tauri::command]
pub fn provisioning_status(state: State<'_, AppState>) -> Result<ProvisioningStatus, CommandError> {
    let settings = state.store.settings()?;
    let status = probe_with_settings(&state, &settings);

    let mut command = std::process::Command::new("winget");
    command
        .arg("--version")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let winget = command.output_with_timeout(Duration::from_secs(10));
    let winget_available = winget
        .as_ref()
        .map(|output| output.status.success())
        .unwrap_or(false);
    let winget_version = winget.ok().and_then(|output| {
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if text.is_empty() {
            None
        } else {
            Some(text.lines().next().unwrap_or_default().to_string())
        }
    });

    Ok(ProvisioningStatus {
        winget_available,
        winget_version,
        clamav_installed: status.installed,
        clamscan_path: status.clamscan_path.map(|path| path.display().to_string()),
        database_path: status.database_path.map(|path| path.display().to_string()),
        install_command:
            "winget install --id Cisco.ClamAV --exact --source winget --interactive --accept-package-agreements --accept-source-agreements"
                .to_string(),
        probe_command: "winget list --id Cisco.ClamAV --exact".to_string(),
        docs_url: "https://docs.clamav.net/".to_string(),
        license_note: "ClamAV est publié sous licence GPLv2 par Cisco Talos. CBS Shield ne redistribue ni le moteur ni les bases de signatures : l'installation officielle reste gérée par l'utilisateur et winget.".to_string(),
        checked_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClamavInstallResult {
    pub attempted: bool,
    pub success: bool,
    /// Stable UI outcome: `alreadyInstalled`, `installed`, `notDetected` or
    /// `wingetFailed`. The UI owns the French/English wording.
    pub outcome: String,
    pub exit_code: Option<i32>,
    pub installed: bool,
    pub message: String,
    pub engine: cbs_core::EngineStatus,
}

const INSTALL_TIMEOUT: Duration = Duration::from_secs(20 * 60);

fn winget_install_command() -> std::process::Command {
    // Official winget source only, no silent/skip-confirmation switch. The
    // installer is launched in a new visible console so the user sees winget
    // and any UAC prompt; CBS Shield never elevates itself.
    let mut command = std::process::Command::new("winget");
    command.args([
        "install",
        "--id",
        "Cisco.ClamAV",
        "--exact",
        "--source",
        "winget",
        "--interactive",
        "--accept-package-agreements",
        "--accept-source-agreements",
    ]);
    command.stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NEW_CONSOLE: visible progress, never a hidden installation.
        command.creation_flags(0x0000_0010);
    }
    command
}

fn wait_with_timeout(
    child: &mut std::process::Child,
    timeout: Duration,
) -> Result<std::process::ExitStatus, std::io::Error> {
    let started = std::time::Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "l'installation winget a dépassé le délai de 20 minutes",
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Guided, explicitly authorized official ClamAV installation.
///
/// The user must have ticked the authorization box in the setup wizard
/// (`confirm == true`). The command runs the official `Cisco.ClamAV` winget
/// package in a visible console; it never installs silently and never requests
/// administrator rights itself.
#[tauri::command]
pub async fn install_clamav(
    state: State<'_, AppState>,
    confirm: bool,
) -> Result<ClamavInstallResult, CommandError> {
    if !confirm {
        return Err(CommandError::new(
            "confirmationRequired",
            "L'installation de ClamAV nécessite une autorisation explicite.",
        ));
    }
    let settings = state.store.settings()?;
    let before = probe_with_settings(&state, &settings);
    if before.installed {
        return Ok(ClamavInstallResult {
            attempted: false,
            success: true,
            outcome: "alreadyInstalled".to_string(),
            exit_code: None,
            installed: true,
            message: "ClamAV est déjà détecté ; aucune installation n'a été lancée.".to_string(),
            engine: before,
        });
    }

    let started = tokio::task::spawn_blocking(|| {
        let mut child = winget_install_command().spawn()?;
        let status = wait_with_timeout(&mut child, INSTALL_TIMEOUT)?;
        Ok::<_, std::io::Error>(status)
    })
    .await
    .map_err(|err| {
        CommandError::new(
            "installInterrupted",
            format!("installation interrompue : {err}"),
        )
    })?;

    let status = match started {
        Ok(status) => status,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(CommandError::new(
                "wingetUnavailable",
                "winget est introuvable. Utilisez la page officielle ClamAV pour installer le moteur, puis revenez dans l'assistant.",
            ));
        }
        Err(err) if err.kind() == std::io::ErrorKind::TimedOut => {
            return Err(CommandError::new(
                "installTimedOut",
                "L'installation a dépassé le délai de 20 minutes. Vérifiez la console Windows et l'état de ClamAV, puis réessayez.",
            ));
        }
        Err(err) => {
            return Err(CommandError::new(
                "installFailed",
                format!("L'installation officielle n'a pas abouti : {err}"),
            ));
        }
    };

    let after = probe_with_settings(&state, &settings);
    let (outcome, message) = if after.installed {
        (
            "installed",
            "ClamAV est maintenant détecté. Vérifiez les signatures à l'étape suivante.",
        )
    } else if status.success() {
        (
            "notDetected",
            "L'installation s'est terminée, mais ClamAV n'est pas encore détecté. Redémarrez CBS Shield ou sélectionnez manuellement clamscan.exe.",
        )
    } else {
        (
            "wingetFailed",
            "L'installation n'a pas abouti. Consultez la fenêtre Windows et les journaux de diagnostic, puis réessayez.",
        )
    };
    Ok(ClamavInstallResult {
        attempted: true,
        success: status.success() && after.installed,
        outcome: outcome.to_string(),
        exit_code: status.code(),
        installed: after.installed,
        message: message.to_string(),
        engine: after,
    })
}

/// Open one of the two official documentation pages in the default browser.
/// The allowlist prevents the webview from launching arbitrary commands/URLs.
#[tauri::command]
pub fn open_documentation(url: String) -> Result<(), CommandError> {
    const ALLOWED: [&str; 3] = [
        "https://docs.clamav.net/",
        "https://www.clamav.net/downloads",
        "https://github.com/Cisco-Talos/clamav",
    ];
    if !ALLOWED.contains(&url.as_str()) {
        return Err(CommandError::new(
            "urlNotAllowed",
            "Cette adresse de documentation n'est pas autorisée.",
        ));
    }
    #[cfg(windows)]
    let result = std::process::Command::new("explorer").arg(&url).spawn();
    #[cfg(not(windows))]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();
    result
        .map(|_| ())
        .map_err(|err| CommandError::internal(format!("impossible d'ouvrir le navigateur : {err}")))
}

/// Small extension trait so the provisioning probe cannot hang forever.
trait OutputWithTimeout {
    fn output_with_timeout(&mut self, timeout: Duration) -> std::io::Result<std::process::Output>;
}

impl OutputWithTimeout for std::process::Command {
    fn output_with_timeout(&mut self, timeout: Duration) -> std::io::Result<std::process::Output> {
        let mut child = self
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;
        let started = std::time::Instant::now();
        loop {
            if child.try_wait()?.is_some() {
                return child.wait_with_output();
            }
            if started.elapsed() >= timeout {
                let _ = child.kill();
                let _ = child.wait();
                return Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "winget n'a pas répondu",
                ));
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_command_uses_the_official_interactive_package() {
        let command = winget_install_command();
        let args: Vec<String> = command
            .get_args()
            .map(|value| value.to_string_lossy().to_string())
            .collect();
        assert_eq!(command.get_program(), "winget");
        assert!(args.windows(2).any(|pair| pair == ["--id", "Cisco.ClamAV"]));
        assert!(args.windows(2).any(|pair| pair == ["--source", "winget"]));
        assert!(args.contains(&"--interactive".to_string()));
        assert!(!args.iter().any(|arg| arg == "--silent"));
        assert!(!args.iter().any(|arg| arg == "--disable-interactivity"));
    }
}
