//! ClamAV scan orchestration with streaming progress and cooperative cancel.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{SecondsFormat, Utc};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Notify;

use crate::error::{prepare_targets, CoreError};
use crate::model::{Detection, ScanErrorRecord, ScanEvent, ScanOutcome, ScanReport, ScanRequest};
use crate::parser::{parse_scan_line, parse_summary, ParsedLine};

const MAX_STORED_ERRORS: usize = 200;
const MAX_STDERR_BYTES: usize = 64_000;
const MAX_DETECTIONS: usize = 5_000;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(150);
/// Upper bound for one output line. ClamAV writes one line per file; a file
/// whose name is megabytes long would otherwise grow the read buffer without
/// limit (OOM risk on hostile filenames).
const MAX_LINE_BYTES: usize = 64 * 1024;

/// Runs `clamscan` against explicit targets.
#[derive(Debug, Clone)]
pub struct Scanner {
    executable: PathBuf,
    database_dir: Option<PathBuf>,
    engine_version: Option<String>,
    signature_version: Option<String>,
    forbidden_root: Option<PathBuf>,
}

impl Scanner {
    pub fn new(executable: PathBuf) -> Self {
        Self {
            executable,
            database_dir: None,
            engine_version: None,
            signature_version: None,
            forbidden_root: None,
        }
    }

    pub fn with_versions(
        mut self,
        engine_version: Option<String>,
        signature_version: Option<String>,
    ) -> Self {
        self.engine_version = engine_version;
        self.signature_version = signature_version;
        self
    }

    pub fn with_database_dir(mut self, database_dir: Option<PathBuf>) -> Self {
        self.database_dir = database_dir;
        self
    }

    /// Paths below this root (the quarantine vault) are refused as scan targets.
    pub fn with_forbidden_root(mut self, root: Option<PathBuf>) -> Self {
        self.forbidden_root = root;
        self
    }

    /// Execute a scan. `sink` receives progress events synchronously; the
    /// returned report is the durable result to persist.
    pub async fn scan<F>(
        &self,
        scan_id: &str,
        request: &ScanRequest,
        sink: F,
        cancel: Arc<Notify>,
    ) -> Result<ScanReport, CoreError>
    where
        F: Fn(ScanEvent),
    {
        if !self.executable.is_file() {
            return Err(CoreError::EngineNotFound);
        }

        let targets = prepare_targets(&request.paths, self.forbidden_root.as_deref())?;
        let started_at = Utc::now();
        let timer = Instant::now();
        let limits = request.limits.clone().sanitized();

        sink(ScanEvent::Preparing {
            scan_id: scan_id.to_string(),
            profile: request.profile.as_str().to_string(),
            target_count: targets.len(),
        });

        // Bound the pre-scan index so a multi-million-file volume can never
        // delay the actual scan. The count is used only as a progress
        // denominator when it is complete.
        let index_targets = targets.clone();
        let index_excluded = request.excluded_paths.clone();
        let index_budget = if request.profile == crate::model::ScanProfile::Full {
            Duration::from_secs(12)
        } else {
            Duration::from_secs(6)
        };
        let index = tokio::task::spawn_blocking(move || {
            crate::targets::index_files(&index_targets, &index_excluded, 500_000, index_budget)
        })
        .await
        .unwrap_or_default();
        let total_files = if index.truncated || index.total_files == 0 {
            None
        } else {
            Some(index.total_files)
        };

        let mut command = Command::new(&self.executable);
        command.arg("--stdout");
        command.arg(format!("--max-filesize={}", limits.max_file_size_bytes()));
        command.arg(format!("--max-scansize={}", limits.max_scan_size_bytes()));
        command.arg(format!("--max-files={}", limits.max_files));
        command.arg(format!("--max-recursion={}", limits.max_recursion));
        command.arg(format!(
            "--scan-archive={}",
            if limits.scan_archives { "yes" } else { "no" }
        ));
        command.arg(if request.follow_symlinks {
            "--follow-dir-symlinks=1"
        } else {
            "--follow-dir-symlinks=0"
        });
        command.arg(if request.follow_symlinks {
            "--follow-file-symlinks=1"
        } else {
            "--follow-file-symlinks=0"
        });
        if limits.max_duration_minutes > 0 {
            command.arg(format!(
                "--max-scantime={}",
                u64::from(limits.max_duration_minutes) * 60_000
            ));
        }
        for excluded in &request.excluded_paths {
            command.arg(format!(
                "--exclude-dir={}",
                regex_escape(&excluded.display().to_string())
            ));
        }
        if request.recursive {
            command.arg("-r");
        }
        if request.include_pua {
            command.arg("--detect-pua=yes");
        }
        if let Some(database_dir) = &self.database_dir {
            command.arg(format!("--database={}", database_dir.display()));
        }
        for target in &targets {
            command.arg(target);
        }
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console(&mut command, limits.low_priority);

        let mut child = command
            .spawn()
            .map_err(|err| CoreError::Spawn(format!("{} ({err})", self.executable.display())))?;

        sink(ScanEvent::Started {
            scan_id: scan_id.to_string(),
            target_count: targets.len(),
            engine_version: self.engine_version.clone(),
            signature_version: self.signature_version.clone(),
            profile: request.profile.as_str().to_string(),
            total_files,
            index_truncated: index.truncated,
        });

        let stdout = child.stdout.take().expect("stdout piped");
        let stderr = child.stderr.take();

        let stderr_task = tokio::spawn(async move {
            let mut collected = String::new();
            if let Some(stderr) = stderr {
                let mut reader = BufReader::new(stderr);
                let mut raw = Vec::new();
                loop {
                    raw.clear();
                    match reader.read_until(b'\n', &mut raw).await {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            if raw.len() > MAX_LINE_BYTES {
                                // Oversized line: keep draining the stream but
                                // never accumulate it in memory.
                                collected.push_str("[ligne ClamAV trop longue ignorée]\n");
                                continue;
                            }
                            let line = String::from_utf8_lossy(&raw);
                            if collected.len() < MAX_STDERR_BYTES {
                                collected.push_str(line.trim_end());
                                collected.push('\n');
                            }
                        }
                    }
                }
            }
            collected
        });

        let mut reader = BufReader::new(stdout);
        let mut raw = Vec::with_capacity(8 * 1024);
        let mut detections: Vec<Detection> = Vec::new();
        let mut errors: Vec<ScanErrorRecord> = Vec::new();
        let mut counted_files: u64 = 0;
        let mut recent_lines: VecDeque<String> = VecDeque::with_capacity(96);
        let mut cancelled = false;
        let mut last_emit = Instant::now() - PROGRESS_INTERVAL;
        let mut warned_line_overflow = false;

        loop {
            raw.clear();
            let read_result = tokio::select! {
                _ = cancel.notified() => {
                    cancelled = true;
                    None
                }
                result = reader.read_until(b'\n', &mut raw) => Some(result),
            };

            let Some(read_result) = read_result else {
                break;
            };
            let read = match read_result {
                Ok(read) => read,
                Err(err) => {
                    errors.push(ScanErrorRecord {
                        path: String::new(),
                        message: format!("flux de sortie ClamAV illisible : {err}"),
                    });
                    break;
                }
            };
            if read == 0 {
                break;
            }

            if raw.len() > MAX_LINE_BYTES {
                // Keep draining the stream; never parse or retain the line.
                if !warned_line_overflow {
                    warned_line_overflow = true;
                    errors.push(ScanErrorRecord {
                        path: String::new(),
                        message: format!(
                            "une ligne de sortie ClamAV dépasse {MAX_LINE_BYTES} octets (nom de fichier extrêmement long ?) et a été ignorée"
                        ),
                    });
                    sink(ScanEvent::ScanError {
                        scan_id: scan_id.to_string(),
                        path: String::new(),
                        message: "une ligne de sortie ClamAV anormalement longue a été ignorée"
                            .to_string(),
                    });
                }
                // Drop the grown buffer so its capacity is not retained.
                raw = Vec::with_capacity(8 * 1024);
                continue;
            }

            let line = String::from_utf8_lossy(&raw)
                .trim_end_matches(['\r', '\n'])
                .to_string();
            if recent_lines.len() == 96 {
                recent_lines.pop_front();
            }
            recent_lines.push_back(line.clone());

            match parse_scan_line(&line) {
                Some(ParsedLine::Clean { path }) => {
                    counted_files += 1;
                    if last_emit.elapsed() >= PROGRESS_INTERVAL {
                        sink(ScanEvent::Progress {
                            scan_id: scan_id.to_string(),
                            files_scanned: counted_files,
                            threats_found: detections.len() as u64,
                            current_file: Some(path),
                        });
                        last_emit = Instant::now();
                    }
                }
                Some(ParsedLine::Found { path, threat }) => {
                    counted_files += 1;
                    let duplicate = detections
                        .iter()
                        .any(|d| d.file_path == path && d.threat_name == threat);
                    if !duplicate && detections.len() < MAX_DETECTIONS {
                        detections.push(Detection {
                            file_path: path.clone(),
                            threat_name: threat.clone(),
                            file_size_bytes: None,
                            sha256: None,
                        });
                    }
                    sink(ScanEvent::Detection {
                        scan_id: scan_id.to_string(),
                        file_path: path.clone(),
                        threat_name: threat,
                    });
                    sink(ScanEvent::Progress {
                        scan_id: scan_id.to_string(),
                        files_scanned: counted_files,
                        threats_found: detections.len() as u64,
                        current_file: Some(path),
                    });
                    last_emit = Instant::now();
                }
                Some(ParsedLine::Error { path, message }) => {
                    if errors.len() < MAX_STORED_ERRORS {
                        errors.push(ScanErrorRecord {
                            path: path.clone(),
                            message: message.clone(),
                        });
                    }
                    sink(ScanEvent::ScanError {
                        scan_id: scan_id.to_string(),
                        path,
                        message,
                    });
                }
                None => {}
            }
        }

        if cancelled {
            let _ = child.start_kill();
        }
        let status = child.wait().await?;
        let stderr_text = stderr_task.await.unwrap_or_default();

        let summary = parse_summary(&recent_lines.iter().cloned().collect::<Vec<_>>());
        let mut finished_at = Utc::now();

        // Fingerprint detections (SHA-256 + size) without loading whole files in
        // memory. A cancelled scan must return promptly: hashing hundreds of
        // large files after the user pressed Stop would look like a hang.
        if !cancelled {
            for detection in &mut detections {
                let path = PathBuf::from(&detection.file_path);
                if let Some((size, hash)) = fingerprint_file(&path).await {
                    detection.file_size_bytes = Some(size);
                    detection.sha256 = Some(hash);
                }
            }
        }

        let files_scanned = summary
            .as_ref()
            .and_then(|summary| summary.scanned_files)
            .unwrap_or(counted_files);
        let infected_files = detections.len() as u64;
        let exit_code = status.code();
        let has_stderr_error = stderr_text.to_ascii_lowercase().contains("can't open file")
            || stderr_text.to_ascii_lowercase().contains("no such file");

        // Audit/Mission-E fix: turn "can't open file" stderr warnings into
        // explicit per-file error records so an inaccessible file is an
        // honest `completedWithErrors` with the path, not an opaque failure.
        for record in extract_file_errors(&stderr_text) {
            if errors.len() >= MAX_STORED_ERRORS {
                break;
            }
            let duplicate = errors
                .iter()
                .any(|existing| existing.path == record.path && existing.message == record.message);
            if !duplicate {
                errors.push(record);
            }
        }

        let outcome = if cancelled {
            ScanOutcome::Cancelled
        } else if infected_files > 0 {
            ScanOutcome::Detected
        } else if files_scanned == 0
            && errors.is_empty()
            && (exit_code == Some(2) || exit_code.is_none() || has_stderr_error)
        {
            // ClamAV produced nothing at all and no per-file error record
            // exists: the run is truly fatal. (Audit fix: when explicit
            // per-file error records exist they are a valid scan result —
            // an inaccessible file — so the outcome is
            // `completedWithErrors`, not `failed`.)
            ScanOutcome::Failed
        } else if !errors.is_empty() || exit_code == Some(2) {
            ScanOutcome::CompletedWithErrors
        } else {
            ScanOutcome::Clean
        };

        let fatal_error = if outcome == ScanOutcome::Failed {
            let detail = stderr_text
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            Some(if detail.is_empty() {
                format!(
                    "ClamAV s'est arrêté sans résultat exploitable (code {:?}).",
                    exit_code
                )
            } else {
                truncate(&detail, 500)
            })
        } else {
            None
        };

        if cancelled {
            finished_at = Utc::now();
        }

        let report = ScanReport {
            id: scan_id.to_string(),
            started_at: started_at.to_rfc3339_opts(SecondsFormat::Secs, true),
            finished_at: finished_at.to_rfc3339_opts(SecondsFormat::Secs, true),
            duration_ms: timer.elapsed().as_millis() as u64,
            targets: targets
                .iter()
                .map(|path| path.display().to_string())
                .collect(),
            profile: request.profile.as_str().to_string(),
            excluded: request
                .excluded_paths
                .iter()
                .map(|path| path.display().to_string())
                .collect(),
            indexed_files: total_files,
            index_truncated: index.truncated,
            limits,
            files_scanned,
            infected_files,
            error_count: errors.len() as u64,
            detections,
            errors,
            outcome,
            cancelled,
            engine_version: self.engine_version.clone(),
            signature_version: self.signature_version.clone(),
            summary,
            fatal_error,
        };

        sink(ScanEvent::Finished {
            scan_id: scan_id.to_string(),
            report: Box::new(report.clone()),
        });

        Ok(report)
    }

    pub fn executable(&self) -> &std::path::Path {
        &self.executable
    }

    pub fn database_dir(&self) -> Option<&std::path::Path> {
        self.database_dir.as_deref()
    }
}

async fn fingerprint_file(path: &std::path::Path) -> Option<(u64, String)> {
    if !path.is_file() {
        return None;
    }
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || crate::fsutil::sha256_file(&path).ok())
        .await
        .ok()
        .flatten()
}

/// Extract per-file error records from stderr lines such as
/// `LibClamAV Warning: Can't open file \\?\C:\dir\file: 32`.
///
/// ClamAV reports unreadable files on stderr (warnings), not in the parsed
/// stdout stream; without this extraction pass the user sees a vague
/// `failed` outcome instead of an honest `completedWithErrors` naming the
/// inaccessible path (Mission E / Sprint 2 fix).
fn extract_file_errors(stderr_text: &str) -> Vec<ScanErrorRecord> {
    let mut records = Vec::new();
    for raw_line in stderr_text.lines() {
        let line = raw_line.trim();
        let lower = line.to_ascii_lowercase();
        if !lower.contains("can't open file") && !lower.contains("no such file") {
            continue;
        }
        let Some(marker_end) = lower
            .find("can't open file")
            .map(|start| start + "can't open file".len())
        else {
            // "No such file" lines without the canonical marker cannot be
            // reliably attributed to one path; skip rather than guess.
            continue;
        };
        let mut path_tail = line[marker_end..].trim();
        if let Some(rest) = path_tail.strip_prefix("or directory") {
            path_tail = rest.trim_start();
        }
        if let Some(rest) = path_tail.strip_prefix(r"\\?\") {
            path_tail = rest;
        }
        if let Some(index) = lower.rfind("no such file or directory") {
            // Keep only the leading path portion of the message.
            path_tail = path_tail[..index.min(path_tail.len())].trim_end();
        }
        // Drop the trailing ": <error code>" that ClamAV appends (e.g. ": 32").
        let path = match path_tail.rfind(':') {
            Some(index)
                if path_tail[index + 1..]
                    .trim()
                    .chars()
                    .all(|c| c.is_ascii_digit()) =>
            {
                path_tail[..index].trim_end()
            }
            _ => path_tail.trim_end(),
        };
        if path.is_empty() {
            continue;
        }
        records.push(ScanErrorRecord {
            path: path.to_string(),
            message: line.to_string(),
        });
    }
    records
}

fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        value.to_string()
    } else {
        value.chars().take(max).collect::<String>() + "…"
    }
}

/// Escape a Windows path for ClamAV's `--exclude-dir=REGEX` option.
fn regex_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 8);
    for character in value.chars() {
        if "\\^$.|?*+()[]{}".contains(character) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

#[cfg(windows)]
fn hide_console(command: &mut Command, low_priority: bool) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const IDLE_PRIORITY_CLASS: u32 = 0x0000_0040;
    let flags = if low_priority {
        CREATE_NO_WINDOW | IDLE_PRIORITY_CLASS
    } else {
        CREATE_NO_WINDOW
    };
    command.as_std_mut().creation_flags(flags);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command, _low_priority: bool) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_missing_target() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("clamscan.exe");
        std::fs::write(&exe, b"fake").unwrap();

        let scanner = Scanner::new(exe);
        let request = ScanRequest {
            paths: vec![PathBuf::from(r"C:\definitely\does\not\exist.txt")],
            ..ScanRequest::default()
        };
        let result = scanner
            .scan("test", &request, |_| {}, Arc::new(Notify::new()))
            .await;
        assert!(matches!(result, Err(CoreError::TargetNotFound(_))));
    }

    #[tokio::test]
    async fn rejects_missing_engine_before_target_validation() {
        let scanner = Scanner::new(PathBuf::from(r"C:\nope\clamscan.exe"));
        let request = ScanRequest {
            paths: vec![PathBuf::from(".")],
            ..ScanRequest::default()
        };
        let result = scanner
            .scan("test", &request, |_| {}, Arc::new(Notify::new()))
            .await;
        assert!(matches!(result, Err(CoreError::EngineNotFound)));
    }

    #[test]
    fn extracts_locked_file_path_from_stderr() {
        // Real-world sample (observed in Mission E validation): a file locked
        // with an exclusive handle produces this stderr warning.
        let stderr = "LibClamAV Warning: Can't open file \\\\?\\C:\\corpus\\locked.bin: 32\n";
        let records = extract_file_errors(stderr);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].path, r"C:\corpus\locked.bin");
        assert!(records[0].message.contains("Can't open file"));
    }

    #[test]
    fn extracts_missing_file_path_from_stderr() {
        let stderr = "LibClamAV Warning: Can't open file or directory C:\\gone\\file.txt: 2\n";
        let records = extract_file_errors(stderr);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].path, r"C:\gone\file.txt");
    }

    #[test]
    fn ignores_unrelated_stderr_noise() {
        let stderr = "some unrelated log line\nLoading signatures\n";
        assert!(extract_file_errors(stderr).is_empty());
    }
}
