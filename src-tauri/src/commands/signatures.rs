//! Signature inventory, update logs and dependency provisioning status.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use cbs_core::{read_inventory, SignatureInventory};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::commands::engine::probe_with_settings;
use crate::error::CommandError;
use crate::paths::AppPaths;
use crate::state::AppState;

const MAX_LOG_LINES: usize = 200;

// Official ClamAV 1.5.4 portable archive. The version, byte size and SHA-256
// are pinned here so a redirected, truncated or modified download can never be
// extracted. This is the per-user fallback for machines without winget and
// without administrator rights.
const PORTABLE_VERSION: &str = "1.5.4";
const PORTABLE_ARCHIVE: &str = "clamav-1.5.4.win.x64.zip";
const PORTABLE_URL: &str =
    "https://github.com/Cisco-Talos/clamav/releases/download/clamav-1.5.4/clamav-1.5.4.win.x64.zip";
const PORTABLE_SIZE: u64 = 225_774_978;
const PORTABLE_SHA256: &str = "0d9e0228b2674137ea1a2853566c98a0278ad52ab2582c3d6dbd75373848c395";
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const EXTRACT_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const MAX_EXTRACTED_FILES: usize = 512;
const MAX_EXTRACTED_BYTES: u64 = 1_500_000_000;

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
    pub portable_available: bool,
    pub portable_version: String,
    pub portable_url: String,
    pub portable_sha256: String,
    pub portable_size: u64,
    pub portable_install_dir: String,
    /// `portable`, `winget` or `manual`.
    pub preferred_method: String,
}

fn command_available(program: &str) -> bool {
    let mut command = std::process::Command::new("where");
    command
        .arg(program)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
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

    let portable_available =
        cfg!(windows) && command_available("curl.exe") && command_available("tar.exe");
    let preferred_method = if portable_available {
        "portable"
    } else if winget_available {
        "winget"
    } else {
        "manual"
    };

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
        license_note: "ClamAV est publié sous licence GPLv2 par Cisco Talos. CBS Shield ne redistribue ni le moteur ni les bases de signatures : l'archive portable officielle est téléchargée depuis la release GitHub de Cisco Talos, vérifiée par taille et SHA-256, puis extraite dans le dossier de données de l'utilisateur.".to_string(),
        checked_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        portable_available,
        portable_version: PORTABLE_VERSION.to_string(),
        portable_url: PORTABLE_URL.to_string(),
        portable_sha256: PORTABLE_SHA256.to_string(),
        portable_size: PORTABLE_SIZE,
        portable_install_dir: state
            .paths
            .portable_engine_dir
            .display()
            .to_string(),
        preferred_method: preferred_method.to_string(),
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
    /// `winget`, `portable` or `none` (already installed).
    pub method: String,
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
            method: "none".to_string(),
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
        method: "winget".to_string(),
        engine: after,
    })
}

/// Official per-user ClamAV install from the pinned portable ZIP.
///
/// This path exists for machines without `winget` and without administrator
/// rights. The archive is downloaded with the Windows built-in `curl.exe`, its
/// exact byte size and SHA-256 are checked, then it is extracted below the
/// user's data directory. No elevation, service, PATH or system setting is
/// modified.
#[tauri::command]
pub async fn install_clamav_portable(
    state: State<'_, AppState>,
    confirm: bool,
) -> Result<ClamavInstallResult, CommandError> {
    if !confirm {
        return Err(CommandError::new(
            "confirmationRequired",
            "L'installation portable de ClamAV nécessite une autorisation explicite.",
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
            method: "none".to_string(),
            engine: before,
        });
    }

    let paths = state.paths.clone();
    let report = tokio::task::spawn_blocking(move || install_portable_sync(&paths))
        .await
        .map_err(|err| {
            CommandError::new(
                "installInterrupted",
                format!("installation portable interrompue : {err}"),
            )
        })??;

    let after = probe_with_settings(&state, &settings);
    let success = after.installed;
    let message = if success {
        format!(
            "ClamAV {PORTABLE_VERSION} portable a été installé dans le dossier de données utilisateur. Archive officielle vérifiée ({} octets, SHA-256).{}",
            PORTABLE_SIZE,
            if report.downloaded {
                " Téléchargement effectué pendant cette installation."
            } else {
                " Archive vérifiée déjà présente localement."
            }
        )
    } else {
        "L'archive a été vérifiée et extraite, mais ClamAV n'est pas encore détecté. Redémarrez CBS Shield ou localisez clamscan.exe manuellement.".to_string()
    };
    Ok(ClamavInstallResult {
        attempted: true,
        success,
        outcome: if success {
            "installed".to_string()
        } else {
            "notDetected".to_string()
        },
        exit_code: None,
        installed: after.installed,
        message,
        method: "portable".to_string(),
        engine: after,
    })
}

#[derive(Debug)]
struct PortableReport {
    downloaded: bool,
}

fn install_portable_sync(paths: &AppPaths) -> Result<PortableReport, CommandError> {
    if !cfg!(windows) {
        return Err(CommandError::new(
            "platformUnsupported",
            "L'installation portable officielle est prise en charge sur Windows uniquement.",
        ));
    }
    let downloads = paths.clamav_dir.join("downloads");
    std::fs::create_dir_all(&downloads)?;
    let archive = downloads.join(PORTABLE_ARCHIVE);

    let mut downloaded = false;
    if archive.is_file() && verify_archive(&archive).is_ok() {
        // Reuse a previously verified archive; it is still re-verified below.
    } else {
        let _ = std::fs::remove_file(&archive);
        download_archive(&archive)?;
        downloaded = true;
    }
    verify_archive(&archive)?;

    let stamp = chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default();
    let extract_dir = paths
        .clamav_dir
        .join(format!("extract-{}-{stamp}", std::process::id()));
    if extract_dir.exists() {
        let _ = std::fs::remove_dir_all(&extract_dir);
    }
    std::fs::create_dir_all(&extract_dir)?;

    let extraction = extract_zip(&archive, &extract_dir);
    if let Err(error) = extraction {
        let _ = std::fs::remove_dir_all(&extract_dir);
        return Err(error);
    }

    let Some(root) = find_engine_root(&extract_dir) else {
        let _ = std::fs::remove_dir_all(&extract_dir);
        return Err(CommandError::new(
            "engineNotFound",
            "L'archive officielle ne contient pas le couple clamscan.exe / freshclam.exe attendu.",
        ));
    };

    let staging = paths
        .clamav_dir
        .join(format!("portable.new-{}", std::process::id()));
    if staging.exists() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    let mut budget = CopyBudget::default();
    if let Err(error) = copy_tree(&root, &staging, &mut budget) {
        let _ = std::fs::remove_dir_all(&staging);
        let _ = std::fs::remove_dir_all(&extract_dir);
        return Err(error);
    }
    if !staging.join("clamscan.exe").is_file() || !staging.join("freshclam.exe").is_file() {
        let _ = std::fs::remove_dir_all(&staging);
        let _ = std::fs::remove_dir_all(&extract_dir);
        return Err(CommandError::new(
            "engineNotFound",
            "Les binaires ClamAV attendus sont absents après extraction.",
        ));
    }

    let backup = paths
        .clamav_dir
        .join(format!("portable.previous-{}", std::process::id()));
    if backup.exists() {
        let _ = std::fs::remove_dir_all(&backup);
    }
    let had_previous = paths.portable_engine_dir.exists();
    if had_previous {
        if let Err(error) = std::fs::rename(&paths.portable_engine_dir, &backup) {
            let _ = std::fs::remove_dir_all(&staging);
            let _ = std::fs::remove_dir_all(&extract_dir);
            return Err(CommandError::new(
                "installFailed",
                format!("Impossible de remplacer l'installation portable existante : {error}"),
            ));
        }
    }
    if let Err(error) = std::fs::rename(&staging, &paths.portable_engine_dir) {
        if had_previous {
            let _ = std::fs::rename(&backup, &paths.portable_engine_dir);
        }
        let _ = std::fs::remove_dir_all(&staging);
        let _ = std::fs::remove_dir_all(&extract_dir);
        return Err(CommandError::new(
            "installFailed",
            format!("Impossible d'activer l'installation portable : {error}"),
        ));
    }
    if had_previous {
        let _ = std::fs::remove_dir_all(&backup);
    }

    let marker = serde_json::json!({
        "product": "CBS Shield",
        "component": "ClamAV",
        "version": PORTABLE_VERSION,
        "sourceUrl": PORTABLE_URL,
        "archiveSha256": PORTABLE_SHA256,
        "archiveBytes": PORTABLE_SIZE,
        "installedAt": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        "filesCopied": budget.files,
        "bytesCopied": budget.bytes,
        "license": "GPLv2 — Cisco Talos",
    });
    let _ = std::fs::write(
        paths.portable_engine_dir.join(".cbs-install.json"),
        serde_json::to_vec_pretty(&marker).unwrap_or_default(),
    );

    let _ = std::fs::remove_dir_all(&extract_dir);
    let _ = std::fs::remove_file(&archive);
    Ok(PortableReport { downloaded })
}

fn verify_archive(path: &Path) -> Result<(), CommandError> {
    let metadata = std::fs::metadata(path).map_err(|error| {
        CommandError::new(
            "downloadMissing",
            format!("Archive ClamAV introuvable : {error}"),
        )
    })?;
    if metadata.len() != PORTABLE_SIZE {
        return Err(CommandError::new(
            "sizeMismatch",
            format!(
                "Taille de l'archive incorrecte : {} octets au lieu de {PORTABLE_SIZE}. Le fichier est refusé.",
                metadata.len()
            ),
        ));
    }
    let actual = file_sha256(path)?;
    if !actual.eq_ignore_ascii_case(PORTABLE_SHA256) {
        return Err(CommandError::new(
            "checksumMismatch",
            format!(
                "SHA-256 de l'archive incorrect : {actual}. Le fichier est refusé avant toute extraction."
            ),
        ));
    }
    Ok(())
}

fn file_sha256(path: &Path) -> Result<String, CommandError> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn download_archive(archive: &Path) -> Result<(), CommandError> {
    let part = archive.with_extension("zip.part");
    let _ = std::fs::remove_file(&part);
    let mut command = std::process::Command::new("curl.exe");
    command.args([
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--retry",
        "2",
        "--retry-delay",
        "2",
        "--connect-timeout",
        "30",
        "--max-time",
        "1800",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--url",
        PORTABLE_URL,
        "--output",
    ]);
    command.arg(&part);
    hide_std_console(&mut command);
    let output = command
        .output_with_timeout(DOWNLOAD_TIMEOUT)
        .map_err(|error| {
            let code = match error.kind() {
                std::io::ErrorKind::NotFound => "downloadToolUnavailable",
                std::io::ErrorKind::TimedOut => "downloadTimedOut",
                _ => "downloadFailed",
            };
            CommandError::new(
                code,
                format!("Le téléchargement officiel de ClamAV a échoué : {error}"),
            )
        })?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&part);
        let detail = String::from_utf8_lossy(&output.stderr)
            .trim()
            .chars()
            .take(500)
            .collect::<String>();
        return Err(CommandError::new(
            "downloadFailed",
            if detail.is_empty() {
                format!(
                    "curl.exe a signalé un échec (code {:?}) sans détail.",
                    output.status.code()
                )
            } else {
                format!("Téléchargement officiel refusé : {detail}")
            },
        ));
    }
    if let Err(error) = std::fs::rename(&part, archive) {
        let _ = std::fs::remove_file(&part);
        return Err(CommandError::new(
            "downloadFailed",
            format!("Impossible de finaliser l'archive téléchargée : {error}"),
        ));
    }
    Ok(())
}

fn extract_zip(archive: &Path, destination: &Path) -> Result<(), CommandError> {
    let tar_error = {
        let mut command = std::process::Command::new("tar.exe");
        command.arg("-xf").arg(archive).arg("-C").arg(destination);
        hide_std_console(&mut command);
        match command.output_with_timeout(EXTRACT_TIMEOUT) {
            Ok(output) if output.status.success() => return Ok(()),
            Ok(output) => String::from_utf8_lossy(&output.stderr).trim().to_string(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                "tar.exe introuvable".to_string()
            }
            Err(error) => format!("tar.exe : {error}"),
        }
    };

    // Windows 11 always ships tar.exe, but keep a PowerShell fallback for
    // stripped-down images. The paths are app-owned and quoted defensively.
    let script = format!(
        "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
        ps_quote(&archive.display().to_string()),
        ps_quote(&destination.display().to_string())
    );
    let mut command = std::process::Command::new("powershell.exe");
    command.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    hide_std_console(&mut command);
    let output = command
        .output_with_timeout(EXTRACT_TIMEOUT)
        .map_err(|error| {
            CommandError::new(
                "extractionToolUnavailable",
                format!("Extraction ZIP impossible (tar.exe : {tar_error} ; PowerShell : {error})"),
            )
        })?;
    if output.status.success() {
        Ok(())
    } else {
        let detail = String::from_utf8_lossy(&output.stderr)
            .trim()
            .chars()
            .take(500)
            .collect::<String>();
        Err(CommandError::new(
            "extractFailed",
            if detail.is_empty() {
                format!("Extraction ZIP refusée (tar.exe : {tar_error}).")
            } else {
                format!("Extraction ZIP refusée : {detail}")
            },
        ))
    }
}

fn ps_quote(value: &str) -> String {
    value.replace('\'', "''")
}

fn find_engine_root(root: &Path) -> Option<PathBuf> {
    fn walk(directory: &Path, depth: usize) -> Option<PathBuf> {
        if directory.join("clamscan.exe").is_file() && directory.join("freshclam.exe").is_file() {
            return Some(directory.to_path_buf());
        }
        if depth >= 3 {
            return None;
        }
        let mut entries: Vec<PathBuf> = std::fs::read_dir(directory)
            .ok()?
            .flatten()
            .map(|entry| entry.path())
            .collect();
        entries.sort();
        for entry in entries {
            if entry.is_dir() {
                if let Some(found) = walk(&entry, depth + 1) {
                    return Some(found);
                }
            }
        }
        None
    }
    walk(root, 0)
}

#[derive(Debug, Default)]
struct CopyBudget {
    files: usize,
    bytes: u64,
}

fn copy_tree(
    source: &Path,
    destination: &Path,
    budget: &mut CopyBudget,
) -> Result<(), CommandError> {
    std::fs::create_dir_all(destination)?;
    let mut entries: Vec<_> = std::fs::read_dir(source)?.flatten().collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let file_type = entry.file_type()?;
        let target = destination.join(entry.file_name());
        if file_type.is_symlink() {
            return Err(CommandError::new(
                "extractFailed",
                "L'archive contient un lien symbolique ; extraction refusée.",
            ));
        }
        if file_type.is_dir() {
            copy_tree(&entry.path(), &target, budget)?;
        } else if file_type.is_file() {
            budget.files += 1;
            let size = entry.metadata()?.len();
            budget.bytes = budget.bytes.saturating_add(size);
            if budget.files > MAX_EXTRACTED_FILES || budget.bytes > MAX_EXTRACTED_BYTES {
                return Err(CommandError::new(
                    "extractTooLarge",
                    "Le contenu extrait dépasse les limites de sécurité de CBS Shield.",
                ));
            }
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn hide_std_console(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000);
}

#[cfg(not(windows))]
fn hide_std_console(_command: &mut std::process::Command) {}

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

    #[test]
    fn portable_archive_pin_is_internal_consistent() {
        assert_eq!(PORTABLE_VERSION, "1.5.4");
        assert_eq!(PORTABLE_ARCHIVE, "clamav-1.5.4.win.x64.zip");
        assert!(PORTABLE_URL.ends_with(PORTABLE_ARCHIVE));
        assert!(PORTABLE_URL.starts_with("https://github.com/Cisco-Talos/clamav/releases/"));
        assert_eq!(PORTABLE_SIZE, 225_774_978);
        assert_eq!(PORTABLE_SHA256.len(), 64);
        assert!(PORTABLE_SHA256
            .chars()
            .all(|character| character.is_ascii_hexdigit()));
        assert_eq!(PORTABLE_SHA256.to_ascii_lowercase(), PORTABLE_SHA256);
    }

    #[test]
    fn powershell_quote_doubles_single_quotes() {
        assert_eq!(
            ps_quote("C:\\Users\\O'Brien\\data"),
            "C:\\Users\\O''Brien\\data"
        );
        assert_eq!(ps_quote("plain"), "plain");
    }

    #[test]
    fn sha256_is_streamed_for_empty_and_non_empty_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let empty = dir.path().join("empty");
        std::fs::write(&empty, []).expect("write empty");
        assert_eq!(
            file_sha256(&empty).expect("empty hash"),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );

        let text = dir.path().join("text");
        std::fs::write(&text, b"abc").expect("write text");
        assert_eq!(
            file_sha256(&text).expect("text hash"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn archive_verification_rejects_a_wrong_byte_size_before_hashing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let archive = dir.path().join(PORTABLE_ARCHIVE);
        std::fs::write(&archive, b"not the official archive").expect("write archive");
        let error = verify_archive(&archive).expect_err("size must be rejected");
        assert_eq!(error.code, "sizeMismatch");
        assert!(error.message.contains("Taille"));
    }

    #[test]
    fn engine_root_is_found_in_the_nested_official_layout() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("clamav-1.5.4.win.x64");
        std::fs::create_dir_all(root.join("bin")).expect("nested dir");
        std::fs::write(root.join("bin").join("clamscan.exe"), b"scan").expect("scan");
        std::fs::write(root.join("bin").join("freshclam.exe"), b"fresh").expect("fresh");
        assert_eq!(find_engine_root(dir.path()), Some(root.join("bin")));
    }

    #[test]
    fn engine_root_requires_both_scan_and_update_binaries() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("clamscan.exe"), b"scan").expect("scan");
        assert_eq!(find_engine_root(dir.path()), None);
    }

    #[test]
    fn copy_tree_is_bounded_and_preserves_nested_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let source = dir.path().join("source");
        std::fs::create_dir_all(source.join("nested")).expect("source");
        std::fs::write(source.join("clamscan.exe"), b"scan").expect("scan");
        std::fs::write(source.join("nested").join("freshclam.exe"), b"fresh").expect("fresh");
        let destination = dir.path().join("destination");
        let mut budget = CopyBudget::default();
        copy_tree(&source, &destination, &mut budget).expect("copy");
        assert_eq!(budget.files, 2);
        assert_eq!(budget.bytes, 9);
        assert!(destination.join("clamscan.exe").is_file());
        assert!(destination.join("nested").join("freshclam.exe").is_file());
    }
}
