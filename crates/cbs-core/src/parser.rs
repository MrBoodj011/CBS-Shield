//! Parsers for ClamAV console output.
//!
//! Only stable, documented output shapes are handled; anything unknown is
//! ignored rather than guessed. Windows paths containing `: ` are supported by
//! splitting on the last separator.

use crate::model::ScanSummary;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedLine {
    Clean { path: String },
    Found { path: String, threat: String },
    Error { path: String, message: String },
}

/// Parse one `clamscan` output line.
///
/// Examples:
/// - `C:\Users\me\file.txt: OK`
/// - `C:\Users\me\eicar.com: Win.Test.EICAR_HDB-1 FOUND`
/// - `C:\Users\me\locked.bin: Access denied ERROR`
pub fn parse_scan_line(line: &str) -> Option<ParsedLine> {
    let line = line.trim_end_matches(['\r', '\n']);
    let (path, suffix) = line.rsplit_once(": ")?;
    if path.is_empty() {
        return None;
    }

    if suffix == "OK" {
        return Some(ParsedLine::Clean {
            path: path.to_string(),
        });
    }

    if let Some(threat) = suffix.strip_suffix(" FOUND") {
        if threat.is_empty() {
            return None;
        }
        return Some(ParsedLine::Found {
            path: path.to_string(),
            threat: threat.to_string(),
        });
    }

    if suffix == "ERROR" || suffix.ends_with(" ERROR") {
        let message = suffix
            .strip_suffix(" ERROR")
            .unwrap_or(suffix)
            .trim()
            .to_string();
        let message = if message.is_empty() {
            "erreur ClamAV".to_string()
        } else {
            message
        };
        return Some(ParsedLine::Error {
            path: path.to_string(),
            message,
        });
    }

    None
}

/// Parse the `SCAN SUMMARY` block (available because `--stdout` is used).
pub fn parse_summary(lines: &[String]) -> Option<ScanSummary> {
    let mut in_summary = false;
    let mut summary = ScanSummary::default();
    let mut found_any = false;

    for line in lines {
        let trimmed = line.trim();
        if trimmed.contains("SCAN SUMMARY") {
            in_summary = true;
            continue;
        }
        if !in_summary {
            continue;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let value = value.trim();
        match key.trim() {
            "Scanned files" => {
                summary.scanned_files = parse_u64(value);
                found_any = true;
            }
            "Infected files" => {
                summary.infected_files = parse_u64(value);
                found_any = true;
            }
            "Scanned directories" => summary.scanned_directories = parse_u64(value),
            "Known viruses" => summary.known_viruses = parse_u64(value),
            "Data scanned" => summary.data_scanned = Some(value.to_string()),
            "Time" => {
                summary.elapsed_seconds = value
                    .split_whitespace()
                    .next()
                    .and_then(|raw| raw.parse::<f64>().ok());
            }
            _ => {}
        }
    }

    found_any.then_some(summary)
}

fn parse_u64(value: &str) -> Option<u64> {
    value.replace(',', "").trim().parse::<u64>().ok()
}

/// Extract engine and signature information from `clamscan --version`.
///
/// Typical output: `ClamAV 1.5.4/27900/Sun Oct 25 06:00:00 2026`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VersionInfo {
    pub engine_version: String,
    pub signature_version: Option<String>,
    pub signature_date: Option<String>,
}

pub fn parse_version_output(output: &str) -> Option<VersionInfo> {
    let line = output
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("ClamAV "))?;

    let rest = line.trim_start_matches("ClamAV ").trim();
    let mut parts = rest.splitn(3, '/');
    let engine_version = parts.next().unwrap_or_default().trim().to_string();
    if engine_version.is_empty() {
        return None;
    }

    let signature_version = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "0")
        .map(str::to_string);
    let signature_date = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    Some(VersionInfo {
        engine_version,
        signature_version,
        signature_date,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_clean_line_with_windows_path() {
        let parsed = parse_scan_line(r"C:\Users\me\Documents\hello.txt: OK");
        assert_eq!(
            parsed,
            Some(ParsedLine::Clean {
                path: r"C:\Users\me\Documents\hello.txt".to_string()
            })
        );
    }

    #[test]
    fn parses_detection_with_spaces_in_threat_name() {
        let parsed = parse_scan_line(r"C:\tmp\eicar.com: Win.Test.EICAR_HDB-1 FOUND");
        assert_eq!(
            parsed,
            Some(ParsedLine::Found {
                path: r"C:\tmp\eicar.com".to_string(),
                threat: "Win.Test.EICAR_HDB-1".to_string()
            })
        );
    }

    #[test]
    fn parses_access_denied_error() {
        let parsed = parse_scan_line(r"C:\System Volume Information\x: Access denied ERROR");
        assert_eq!(
            parsed,
            Some(ParsedLine::Error {
                path: r"C:\System Volume Information\x".to_string(),
                message: "Access denied".to_string()
            })
        );
    }

    #[test]
    fn ignores_summary_and_noise() {
        assert_eq!(parse_scan_line("Scanned files: 12"), None);
        assert_eq!(parse_scan_line("LibClamAV Warning: something"), None);
        assert_eq!(parse_scan_line(""), None);
    }

    #[test]
    fn parses_summary_block() {
        let lines: Vec<String> = [
            "----------- SCAN SUMMARY -----------",
            "Known viruses: 8700000",
            "Engine version: 1.5.4",
            "Scanned directories: 2",
            "Scanned files: 12",
            "Infected files: 1",
            "Data scanned: 0.02 MB",
            "Time: 0.123 sec (0 m 0 s)",
            "Start Date: 2026:10:25 10:00:00",
            "End Date: 2026:10:25 10:00:01",
        ]
        .iter()
        .map(|line| line.to_string())
        .collect();

        let summary = parse_summary(&lines).expect("summary");
        assert_eq!(summary.scanned_files, Some(12));
        assert_eq!(summary.infected_files, Some(1));
        assert_eq!(summary.scanned_directories, Some(2));
        assert_eq!(summary.known_viruses, Some(8_700_000));
        assert_eq!(summary.data_scanned.as_deref(), Some("0.02 MB"));
        assert_eq!(summary.elapsed_seconds, Some(0.123));
    }

    #[test]
    fn returns_none_without_summary() {
        assert!(parse_summary(&["file.txt: OK".to_string()]).is_none());
    }

    #[test]
    fn parses_version_with_signatures() {
        let info =
            parse_version_output("ClamAV 1.5.4/27900/Sun Oct 25 06:00:00 2026\n").expect("version");
        assert_eq!(info.engine_version, "1.5.4");
        assert_eq!(info.signature_version.as_deref(), Some("27900"));
        assert_eq!(
            info.signature_date.as_deref(),
            Some("Sun Oct 25 06:00:00 2026")
        );
    }

    #[test]
    fn parses_version_without_database() {
        let info = parse_version_output("ClamAV 1.5.4\n").expect("version");
        assert_eq!(info.engine_version, "1.5.4");
        assert!(info.signature_version.is_none());
        assert!(info.signature_date.is_none());
    }

    #[test]
    fn ignores_non_version_output() {
        assert!(parse_version_output("ERROR: Can't open file").is_none());
    }
}
