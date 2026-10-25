use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Freshness of the local ClamAV signature database.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SignatureState {
    /// No usable signature database was found.
    Missing,
    /// A database exists but is older than the freshness threshold.
    Outdated,
    /// The database is recent enough to be used.
    UpToDate,
    /// The engine answered but the signature date could not be interpreted.
    #[default]
    Unknown,
}

impl SignatureState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Missing => "missing",
            Self::Outdated => "outdated",
            Self::UpToDate => "upToDate",
            Self::Unknown => "unknown",
        }
    }
}

/// Result of probing the external ClamAV installation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub installed: bool,
    pub clamscan_path: Option<PathBuf>,
    pub freshclam_path: Option<PathBuf>,
    pub engine_version: Option<String>,
    pub signature_version: Option<String>,
    pub signature_date: Option<String>,
    pub signature_age_days: Option<i64>,
    pub signature_state: SignatureState,
    pub database_path: Option<PathBuf>,
    pub database_file_count: usize,
    pub checked_at: String,
    pub message: String,
}

impl Default for EngineStatus {
    fn default() -> Self {
        Self {
            installed: false,
            clamscan_path: None,
            freshclam_path: None,
            engine_version: None,
            signature_version: None,
            signature_date: None,
            signature_age_days: None,
            signature_state: SignatureState::Missing,
            database_path: None,
            database_file_count: 0,
            checked_at: String::new(),
            message: String::new(),
        }
    }
}

/// Requested scan. `paths` are canonicalized by the engine before use.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRequest {
    pub paths: Vec<PathBuf>,
    #[serde(default = "default_true")]
    pub recursive: bool,
    /// Include possibly unwanted applications. Off by default.
    #[serde(default)]
    pub include_pua: bool,
}

fn default_true() -> bool {
    true
}

impl Default for ScanRequest {
    fn default() -> Self {
        Self {
            paths: Vec::new(),
            recursive: true,
            include_pua: false,
        }
    }
}

/// A single infected file reported by ClamAV.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub file_path: String,
    pub threat_name: String,
    pub file_size_bytes: Option<u64>,
    pub sha256: Option<String>,
}

/// A non-fatal error line (unreadable file, access denied, archive limit...).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanErrorRecord {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScanOutcome {
    Clean,
    Detected,
    Cancelled,
    CompletedWithErrors,
    Failed,
}

/// Authoritative counters parsed from ClamAV's `SCAN SUMMARY` block.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub scanned_files: Option<u64>,
    pub infected_files: Option<u64>,
    pub scanned_directories: Option<u64>,
    pub known_viruses: Option<u64>,
    pub data_scanned: Option<String>,
    pub elapsed_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub id: String,
    pub started_at: String,
    pub finished_at: String,
    pub duration_ms: u64,
    pub targets: Vec<String>,
    pub files_scanned: u64,
    pub infected_files: u64,
    pub error_count: u64,
    pub detections: Vec<Detection>,
    pub errors: Vec<ScanErrorRecord>,
    pub outcome: ScanOutcome,
    pub cancelled: bool,
    pub engine_version: Option<String>,
    pub signature_version: Option<String>,
    pub summary: Option<ScanSummary>,
    pub fatal_error: Option<String>,
}

/// Events streamed while a scan runs (forwarded to the UI as Tauri events).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ScanEvent {
    Started {
        scan_id: String,
        target_count: usize,
        engine_version: Option<String>,
        signature_version: Option<String>,
    },
    Progress {
        scan_id: String,
        files_scanned: u64,
        threats_found: u64,
        current_file: Option<String>,
    },
    Detection {
        scan_id: String,
        file_path: String,
        threat_name: String,
    },
    ScanError {
        scan_id: String,
        path: String,
        message: String,
    },
    Finished {
        scan_id: String,
        report: Box<ScanReport>,
    },
}
