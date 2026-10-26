//! Discovery and health probing of the external ClamAV installation.
//!
//! CBS Shield never embeds or redistributes ClamAV. It locates the official
//! installation, executes it as a child process, and reports honestly when the
//! engine or its signatures are missing.

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use chrono::{DateTime, NaiveDateTime, Utc};

use crate::model::{EngineStatus, SignatureState};
use crate::parser::{parse_version_output, VersionInfo};

/// Default freshness threshold for the signature database.
pub const SIGNATURE_MAX_AGE_DAYS: i64 = 7;

/// Environment overrides, useful for portable installs and CI.
pub const ENV_CLAMSCAN: &str = "CBS_CLAMSCAN_PATH";
pub const ENV_CLAMDB: &str = "CBS_CLAMDB_PATH";

#[derive(Debug, Clone, Default)]
pub struct EnginePaths {
    pub clamscan: Option<PathBuf>,
    pub freshclam: Option<PathBuf>,
    pub database_dir: Option<PathBuf>,
}

fn exe_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

fn configured_exe(explicit: Option<&Path>, env_key: &str) -> Option<PathBuf> {
    if let Some(path) = explicit {
        if path.is_file() {
            return Some(path.to_path_buf());
        }
    }
    if let Some(value) = env::var_os(env_key) {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

fn find_in_path(base: &str) -> Option<PathBuf> {
    let file_name = exe_name(base);
    let paths = env::var_os("PATH")?;
    for dir in env::split_paths(&paths) {
        let candidate = dir.join(&file_name);
        if candidate.is_file() {
            return Some(candidate);
        }
        if cfg!(windows) {
            let candidate = dir.join(base);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn standard_install_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for key in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        if let Some(value) = env::var_os(key) {
            let dir = PathBuf::from(value).join("ClamAV");
            if !dirs.contains(&dir) {
                dirs.push(dir);
            }
        }
    }
    if cfg!(windows) {
        let fallback = PathBuf::from(r"C:\Program Files\ClamAV");
        if !dirs.contains(&fallback) {
            dirs.push(fallback);
        }
    }
    dirs
}

/// Locate `clamscan` (setting, `CBS_CLAMSCAN_PATH`, app-local bin, PATH, standard dirs).
pub fn locate_clamscan(explicit: Option<&Path>, extra_dirs: &[PathBuf]) -> Option<PathBuf> {
    if let Some(path) = configured_exe(explicit, ENV_CLAMSCAN) {
        return Some(path);
    }
    for dir in extra_dirs {
        let candidate = dir.join(exe_name("clamscan"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if let Some(path) = find_in_path("clamscan") {
        return Some(path);
    }
    for dir in standard_install_dirs() {
        let candidate = dir.join(exe_name("clamscan"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Locate `freshclam` next to `clamscan`, in the app-local bin, PATH or standard dirs.
pub fn locate_freshclam(
    explicit: Option<&Path>,
    extra_dirs: &[PathBuf],
    clamscan: Option<&Path>,
) -> Option<PathBuf> {
    if let Some(path) = configured_exe(explicit, "CBS_FRESHCLAM_PATH") {
        return Some(path);
    }
    if let Some(clamscan) = clamscan {
        if let Some(parent) = clamscan.parent() {
            let candidate = parent.join(exe_name("freshclam"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    for dir in extra_dirs {
        let candidate = dir.join(exe_name("freshclam"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if let Some(path) = find_in_path("freshclam") {
        return Some(path);
    }
    for dir in standard_install_dirs() {
        let candidate = dir.join(exe_name("freshclam"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Locate `sigtool` next to `clamscan`, in the app-local bin, PATH or standard dirs.
pub fn locate_sigtool(
    explicit: Option<&Path>,
    extra_dirs: &[PathBuf],
    clamscan: Option<&Path>,
) -> Option<PathBuf> {
    if let Some(path) = configured_exe(explicit, "CBS_SIGTOOL_PATH") {
        return Some(path);
    }
    if let Some(clamscan) = clamscan {
        if let Some(parent) = clamscan.parent() {
            let candidate = parent.join(exe_name("sigtool"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    for dir in extra_dirs {
        let candidate = dir.join(exe_name("sigtool"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if let Some(path) = find_in_path("sigtool") {
        return Some(path);
    }
    for dir in standard_install_dirs() {
        let candidate = dir.join(exe_name("sigtool"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

pub fn count_signature_files(dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| {
            entry.file_type().map(|t| t.is_file()).unwrap_or(false)
                && entry
                    .path()
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "cvd" | "cld" | "cud"))
                    .unwrap_or(false)
        })
        .count()
}

fn has_signature_files(dir: &Path) -> bool {
    count_signature_files(dir) > 0
}

/// Locate the ClamAV database directory.
pub fn locate_database(
    explicit: Option<&Path>,
    extra_dirs: &[PathBuf],
    clamscan: Option<&Path>,
) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(dir) = explicit {
        if dir.is_dir() {
            candidates.push(dir.to_path_buf());
        }
    }
    if let Some(value) = env::var_os(ENV_CLAMDB) {
        let dir = PathBuf::from(value);
        if dir.is_dir() {
            candidates.push(dir);
        }
    }
    for dir in extra_dirs {
        candidates.push(dir.join("database"));
    }
    if let Some(clamscan) = clamscan {
        if let Some(parent) = clamscan.parent() {
            candidates.push(parent.join("database"));
        }
    }
    if let Some(value) = env::var_os("ProgramData") {
        candidates.push(PathBuf::from(value).join("ClamAV").join("database"));
    }
    for dir in standard_install_dirs() {
        candidates.push(dir.join("database"));
    }

    let mut existing = candidates
        .iter()
        .find(|dir| has_signature_files(dir))
        .cloned();
    if existing.is_none() {
        existing = candidates.into_iter().find(|dir| dir.is_dir());
    }
    existing.map(|dir| dir.canonicalize().unwrap_or(dir))
}

fn parse_signature_date(value: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(value, "%a %b %e %H:%M:%S %Y").ok()
}

fn signature_age_days(date: &str, now: DateTime<Utc>) -> Option<i64> {
    let parsed = parse_signature_date(date)?;
    Some((now.naive_utc().date() - parsed.date()).num_days().max(0))
}

fn probe_version(executable: &Path, database: Option<&Path>) -> Result<VersionInfo, String> {
    let mut command = Command::new(executable);
    // Without --database, clamscan reports only the engine version and no
    // signature information, which would make a valid local database look
    // missing. Always pass the resolved database when there is one.
    if let Some(database) = database {
        command.arg(format!("--database={}", database.display()));
    }
    command.arg("--version");

    match execute_with_timeout(&mut command, PROBE_TIMEOUT) {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let combined = format!("{stdout}\n{stderr}");
            parse_version_output(&combined).ok_or_else(|| {
                let detail = first_meaningful_line(&combined)
                    .unwrap_or_else(|| format!("code de sortie {:?}", output.status.code()));
                format!("réponse inattendue de clamscan --version : {detail}")
            })
        }
        Err(err) => Err(err),
    }
}

/// Run a child process to completion, but never wait longer than `timeout`.
///
/// Previously `probe_version` used `Command::output()`, which blocks until the
/// child exits: a hung or wedged `clamscan --version` (locked antivirus
/// exclusion, broken pipe, slow network drive) would freeze the UI probe
/// forever. The declared `PROBE_TIMEOUT` was never actually enforced. This
/// helper polls `try_wait` and kills the child once the deadline is reached.
pub(crate) fn execute_with_timeout(
    command: &mut Command,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    use std::io::Read;
    use std::process::Stdio;

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(command);

    let mut child = command
        .spawn()
        .map_err(|err| format!("impossible d'exécuter le programme : {err}"))?;

    let started = Instant::now();
    let poll_interval = Duration::from_millis(25);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if started.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "le moteur n'a pas répondu dans le délai imparti ({:?}) ; processus interrompu",
                        timeout
                    ));
                }
                std::thread::sleep(poll_interval);
            }
            Err(err) => return Err(format!("échec de l'attente du processus : {err}")),
        }
    }

    // The child has exited; the pipes hold its remaining buffered output.
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    if let Some(mut pipe) = child.stdout.take() {
        let _ = pipe.read_to_end(&mut stdout);
    }
    if let Some(mut pipe) = child.stderr.take() {
        let _ = pipe.read_to_end(&mut stderr);
    }
    let status = child
        .wait()
        .map_err(|err| format!("échec de l'attente du processus : {err}"))?;
    Ok(std::process::Output {
        status,
        stdout,
        stderr,
    })
}

fn first_meaningful_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| truncate(line, 240))
}

fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        value.to_string()
    } else {
        let truncated: String = value.chars().take(max).collect();
        format!("{truncated}…")
    }
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    // CREATE_NO_WINDOW: avoid flashing a console when probing/scanning.
    command.creation_flags(0x0800_0000);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

/// Full probe used by the UI. Never panics, never blocks for long.
pub fn detect_engine(
    explicit_clamscan: Option<PathBuf>,
    explicit_database: Option<PathBuf>,
    extra_dirs: &[PathBuf],
    max_signature_age_days: i64,
) -> EngineStatus {
    let clamscan = locate_clamscan(explicit_clamscan.as_deref(), extra_dirs);
    let freshclam = locate_freshclam(None, extra_dirs, clamscan.as_deref());
    let sigtool = locate_sigtool(None, extra_dirs, clamscan.as_deref());
    let database = locate_database(
        explicit_database.as_deref(),
        extra_dirs,
        clamscan.as_deref(),
    );
    let database_file_count = database.as_deref().map(count_signature_files).unwrap_or(0);
    let checked_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let Some(clamscan) = clamscan else {
        return EngineStatus {
            installed: false,
            freshclam_path: freshclam,
            sigtool_path: sigtool,
            database_path: database,
            database_file_count,
            checked_at,
            message: "ClamAV n'est pas détecté sur ce poste. Installez l'outil officiel Cisco ClamAV, puis relancez le diagnostic. CBS Shield ne redistribue pas ClamAV.".to_string(),
            ..EngineStatus::default()
        };
    };

    let version = probe_version(&clamscan, database.as_deref());
    let mut status = EngineStatus {
        installed: true,
        clamscan_path: Some(clamscan),
        freshclam_path: freshclam,
        sigtool_path: sigtool,
        database_path: database,
        database_file_count,
        checked_at,
        ..EngineStatus::default()
    };

    match version {
        Ok(info) => {
            status.engine_version = Some(info.engine_version);
            status.signature_version = info.signature_version.clone();
            status.signature_date = info.signature_date.clone();

            if info.signature_version.is_none() {
                status.signature_state = SignatureState::Missing;
                status.message = "Le moteur ClamAV fonctionne mais aucune signature utilisable n'a été trouvée. Exécutez freshclam (droits administrateur généralement requis) avant de scanner.".to_string();
            } else if let Some(date) = info.signature_date.as_deref() {
                match signature_age_days(date, Utc::now()) {
                    Some(age) => {
                        status.signature_age_days = Some(age);
                        if age > max_signature_age_days {
                            status.signature_state = SignatureState::Outdated;
                            status.message = format!(
                                "Signatures ClamAV datées de {age} jours (seuil de fraîcheur : {max_signature_age_days} jours). Mettez-les à jour avec freshclam."
                            );
                        } else {
                            status.signature_state = SignatureState::UpToDate;
                            status.message = format!(
                                "Signatures ClamAV à jour (âge : {age} jour(s), seuil : {max_signature_age_days})."
                            );
                        }
                    }
                    None => {
                        status.signature_state = SignatureState::Unknown;
                        status.message =
                            "Signatures présentes mais leur date n'a pas pu être interprétée."
                                .to_string();
                    }
                }
            } else {
                status.signature_state = SignatureState::Unknown;
                status.message = "Signatures présentes, date de publication inconnue.".to_string();
            }
        }
        Err(err) => {
            status.signature_state = SignatureState::Missing;
            status.message =
                format!("clamscan.exe a été trouvé mais ne répond pas correctement : {err}");
        }
    }

    status
}

/// Minimal probe with a short-lived child process, used to validate readiness
/// right before a scan (the engine can change while the app is open).
pub fn quick_engine_check(
    explicit_clamscan: Option<PathBuf>,
    extra_dirs: &[PathBuf],
) -> Result<VersionInfo, String> {
    let Some(executable) = locate_clamscan(explicit_clamscan.as_deref(), extra_dirs) else {
        return Err("moteur ClamAV introuvable".to_string());
    };
    let database = locate_database(None, extra_dirs, Some(&executable));
    probe_version(&executable, database.as_deref())
}

/// Timeout helper used by callers that need to bound engine probing.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_signature_age() {
        let now = DateTime::parse_from_rfc3339("2026-10-25T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(signature_age_days("Sun Oct 25 06:00:00 2026", now), Some(0));
        assert_eq!(signature_age_days("Wed Oct 21 06:00:00 2026", now), Some(4));
        assert_eq!(signature_age_days("not a date", now), None);
    }

    #[test]
    fn count_signature_files_ignores_other_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("main.cvd"), b"x").unwrap();
        std::fs::write(dir.path().join("daily.cld"), b"x").unwrap();
        std::fs::write(dir.path().join("bytecode.cud"), b"x").unwrap();
        std::fs::write(dir.path().join("freshclam.conf"), b"x").unwrap();
        assert_eq!(count_signature_files(dir.path()), 3);
    }

    #[test]
    fn explicit_missing_clamscan_falls_back_to_none_or_installed() {
        // A non-existent explicit path must not panic; result depends on the host.
        let found = locate_clamscan(Some(Path::new(r"C:\does\not\exist\clamscan.exe")), &[]);
        assert!(found.is_none() || found.unwrap().is_file());
    }

    #[test]
    fn locate_database_prefers_directory_with_signatures() {
        let dir = tempfile::tempdir().unwrap();
        let empty = dir.path().join("database_empty");
        std::fs::create_dir(&empty).unwrap();
        let db = dir.path().join("database");
        std::fs::create_dir(&db).unwrap();
        std::fs::write(db.join("main.cvd"), b"x").unwrap();

        let found = locate_database(None, &[dir.path().to_path_buf()], None).unwrap();
        assert_eq!(count_signature_files(&found), 1);
        assert_eq!(found.file_name().unwrap(), "database");
    }

    #[cfg(windows)]
    #[test]
    fn execute_with_timeout_completes_fast_commands() {
        let mut command = Command::new("cmd.exe");
        command.args(["/c", "echo probe-ok"]);
        let output = execute_with_timeout(&mut command, Duration::from_secs(10)).unwrap();
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("probe-ok"));
    }

    #[cfg(windows)]
    #[test]
    fn execute_with_timeout_kills_hung_child() {
        // `ping -n 30` blocks well past the 300 ms budget: before the fix
        // (plain `Command::output()`) this would have hung until completion.
        let mut command = Command::new("cmd.exe");
        command.args(["/c", "ping", "-n", "30", "127.0.0.1"]);
        let started = Instant::now();
        let result = execute_with_timeout(&mut command, Duration::from_millis(300));
        let elapsed = started.elapsed();
        assert!(result.is_err(), "a hung child must be reported as an error");
        assert!(result.unwrap_err().contains("délai imparti"));
        assert!(
            elapsed < Duration::from_secs(5),
            "the helper must give up near the deadline, not after the child (elapsed {elapsed:?})"
        );
    }
}
