//! CBS Firewall foundation commands — strictly read-only inspection.
//!
//! Every read goes through `cbs_firewall::inspect` (documented COM API
//! `INetFwPolicy2`). Nothing is ever modified: this module only reads, and it
//! stores a local baseline fingerprint of the profile + rule configuration to
//! detect changes between observations. The baseline lives in the application
//! settings database; it is only advanced when the user explicitly acknowledges
//! it (or during the very first observation).
//!
//! Sprint 5 additions:
//! - composite profile + rule change detection with per-category details,
//! - security alerts derived from the real profile state,
//! - active TCP connections mapped to rules by executable path/name,
//! - read-only JSON snapshot export under the user data directory,
//! - a rule-management gate model that is permanently disabled until explicit
//!   authorization, isolated-VM tests and rollback validation are completed.

use std::path::{Path, PathBuf};

use cbs_firewall::{FirewallAlert, FirewallStatus, RuleSummary};
use cbs_netmon::{NetConnection, Transport};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::error::CommandError;
use crate::state::AppState;

const BASELINE_KEY: &str = "firewallBaselineV2";
const BASELINE_VERSION: u32 = 2;
const MAX_CONNECTION_ROWS: usize = 120;
const MAX_RULE_NAMES_PER_ROW: usize = 4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallObservation {
    pub status: FirewallStatus,
    /// RFC 3339 timestamp of the accepted baseline, if any.
    pub previous_checked_at: Option<String>,
    /// True when the profile/rule configuration differs from the baseline.
    pub changed_since_last: bool,
    /// Detailed, machine-readable changes since the baseline.
    pub changes: Vec<FirewallChange>,
    /// Honest security alerts derived from the live profile state.
    pub alerts: Vec<FirewallAlert>,
    /// State of the two Windows services the firewall depends on.
    pub service: FirewallServiceHealth,
    /// True when the displayed rule list is a bounded extract.
    pub listed_truncated: bool,
}

/// Read-only health of the Windows Firewall service stack.
///
/// `sc query` is used with a hidden console. The numeric state token is parsed
/// instead of localized text, so the result is stable on French and English
/// Windows installations. This never changes the service state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallServiceHealth {
    pub mps_svc: String,
    pub bfe: String,
    pub observed: bool,
    pub checked_at: String,
}

fn parse_service_state(output: &str) -> String {
    for line in output.lines() {
        let Some((_, value)) = line.split_once(':') else {
            continue;
        };
        let Some(code) = value.split_whitespace().next() else {
            continue;
        };
        let state = match code {
            "1" => "stopped",
            "2" => "startPending",
            "3" => "stopPending",
            "4" => "running",
            "5" => "continuePending",
            "6" => "pausePending",
            "7" => "paused",
            _ => continue,
        };
        return state.to_string();
    }
    "unknown".to_string()
}

fn query_service_state(name: &str) -> String {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let output = std::process::Command::new("sc")
            .args(["query", name])
            .creation_flags(0x0800_0000)
            .output();
        match output {
            Ok(output) => parse_service_state(&String::from_utf8_lossy(&output.stdout)),
            Err(_) => "unknown".to_string(),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = name;
        "unknown".to_string()
    }
}

fn firewall_service_health() -> FirewallServiceHealth {
    let mps_svc = query_service_state("MpsSvc");
    let bfe = query_service_state("BFE");
    let observed = mps_svc != "unknown" || bfe != "unknown";
    FirewallServiceHealth {
        mps_svc,
        bfe,
        observed,
        checked_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FirewallChange {
    pub code: String,
    pub profile: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FirewallBaseline {
    version: u32,
    configuration_hash: String,
    rules_hash: String,
    profiles_hash: String,
    rules_total_count: u32,
    checked_at: String,
    profiles: Vec<cbs_firewall::ProfileStatus>,
}

impl FirewallBaseline {
    fn from_status(status: &FirewallStatus) -> Self {
        Self {
            version: BASELINE_VERSION,
            configuration_hash: status.configuration_hash.clone(),
            rules_hash: status.rules_hash.clone(),
            profiles_hash: status.profiles_hash.clone(),
            rules_total_count: status.rules_total_count,
            checked_at: status.checked_at.clone(),
            profiles: status.profiles.clone(),
        }
    }
}

fn load_baseline(state: &AppState) -> Option<FirewallBaseline> {
    let raw: Option<String> = state.store.setting(BASELINE_KEY).ok().flatten();
    raw.and_then(|raw| serde_json::from_str::<FirewallBaseline>(&raw).ok())
}

fn save_baseline(state: &AppState, baseline: &FirewallBaseline) -> Result<(), CommandError> {
    let raw = serde_json::to_string(baseline).map_err(|err| {
        CommandError::internal(format!("sérialisation de la référence pare-feu : {err}"))
    })?;
    state.store.set_setting(BASELINE_KEY, &raw)?;
    Ok(())
}

fn changes_since(status: &FirewallStatus, baseline: &FirewallBaseline) -> Vec<FirewallChange> {
    let mut changes = Vec::new();
    if baseline.rules_hash != status.rules_hash
        || baseline.rules_total_count != status.rules_total_count
    {
        changes.push(FirewallChange {
            code: "rules_changed".to_string(),
            profile: None,
        });
    }

    for current in &status.profiles {
        match baseline
            .profiles
            .iter()
            .find(|previous| previous.profile == current.profile)
        {
            Some(previous) if previous.enabled != current.enabled => {
                changes.push(FirewallChange {
                    code: "profile_state_changed".to_string(),
                    profile: Some(current.profile.clone()),
                });
            }
            None => changes.push(FirewallChange {
                code: "profile_missing_from_baseline".to_string(),
                profile: Some(current.profile.clone()),
            }),
            _ => {}
        }

        if let Some(previous) = baseline
            .profiles
            .iter()
            .find(|previous| previous.profile == current.profile)
        {
            if previous.inbound_default != current.inbound_default
                || previous.outbound_default != current.outbound_default
            {
                changes.push(FirewallChange {
                    code: "profile_defaults_changed".to_string(),
                    profile: Some(current.profile.clone()),
                });
            }
        }
    }

    changes
}

async fn inspect_status() -> Result<FirewallStatus, CommandError> {
    tokio::task::spawn_blocking(cbs_firewall::inspect)
        .await
        .map_err(|err| {
            CommandError::internal(format!("inspection du pare-feu interrompue : {err}"))
        })?
        .map_err(|err| CommandError::new("firewallUnavailable", err.to_string()))
}

fn observation(
    status: FirewallStatus,
    baseline: Option<FirewallBaseline>,
    changes: Vec<FirewallChange>,
) -> FirewallObservation {
    let listed_truncated = (status.rules.len() as u32) < status.rules_total_count;
    FirewallObservation {
        previous_checked_at: baseline.as_ref().map(|value| value.checked_at.clone()),
        changed_since_last: !changes.is_empty(),
        changes,
        alerts: cbs_firewall::security_alerts(&status),
        service: firewall_service_health(),
        status,
        listed_truncated,
    }
}

#[tauri::command]
pub async fn firewall_status(
    state: State<'_, AppState>,
) -> Result<FirewallObservation, CommandError> {
    let status = inspect_status().await?;
    let baseline = load_baseline(&state);

    let Some(baseline) = baseline else {
        // First observation after install/upgrade: accept the current state as
        // the baseline instead of inventing a change alert.
        let new_baseline = FirewallBaseline::from_status(&status);
        let _ = save_baseline(&state, &new_baseline);
        return Ok(observation(status, Some(new_baseline), Vec::new()));
    };

    let changes = changes_since(&status, &baseline);
    Ok(observation(status, Some(baseline), changes))
}

/// Explicitly accept the current configuration as the new baseline.
///
/// This changes **only** CBS Shield's local reference point; it never touches
/// the Microsoft Defender Firewall configuration.
#[tauri::command]
pub async fn firewall_acknowledge_baseline(
    state: State<'_, AppState>,
) -> Result<FirewallObservation, CommandError> {
    let status = inspect_status().await?;
    let baseline = FirewallBaseline::from_status(&status);
    save_baseline(&state, &baseline)?;
    Ok(observation(status, Some(baseline), Vec::new()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallSnapshotExport {
    pub path: String,
    pub rules_saved: u32,
    pub rules_total_count: u32,
    pub truncated: bool,
    pub checked_at: String,
    /// The file is an audit copy only: no restore path exists.
    pub read_only: bool,
    pub restore_supported: bool,
    /// SHA-256 of the exact bytes written to disk.
    pub sha256: String,
    /// Sidecar file containing the digest, when it could be written.
    pub sha256_sidecar: Option<String>,
}

/// Export a read-only JSON snapshot for audit/diagnostics.
///
/// No restore path is exposed: rollback must first be designed, tested in an
/// isolated VM and explicitly authorized (see the Sprint 5 architecture doc).
#[tauri::command]
pub async fn firewall_export_snapshot(
    state: State<'_, AppState>,
) -> Result<FirewallSnapshotExport, CommandError> {
    let status = inspect_status().await?;
    let path = snapshot_path(&state.paths.firewall_backups, &status.checked_at);
    let exported_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let snapshot = serde_json::json!({
        "product": "CBS Shield",
        "kind": "firewall-read-only-snapshot",
        "version": env!("CARGO_PKG_VERSION"),
        "exportedAt": exported_at,
        "readOnly": true,
        "restoreSupported": false,
        "note": "Read-only reference. Restoring firewall rules is intentionally not implemented.",
        "status": status,
    });
    let text = serde_json::to_string_pretty(&snapshot).map_err(|err| {
        CommandError::internal(format!("sérialisation de l'instantané pare-feu : {err}"))
    })?;
    let sha256 = format!("{:x}", Sha256::digest(text.as_bytes()));
    let path_clone = path.clone();
    let sidecar_path = sidecar_path(&path);
    let sidecar_path_clone = sidecar_path.clone();
    let sha_for_sidecar = sha256.clone();
    tokio::task::spawn_blocking(move || {
        if let Some(parent) = path_clone.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path_clone, text)?;
        // The sidecar is an integrity aid, not a restore path. If the sidecar
        // cannot be written, the snapshot remains a valid read-only audit copy
        // and the UI reports it as unverified instead of pretending otherwise.
        let file_name = path_clone
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_default();
        std::fs::write(
            &sidecar_path_clone,
            format!("{sha_for_sidecar}  {file_name}\n"),
        )
        .ok();
        Ok::<(), std::io::Error>(())
    })
    .await
    .map_err(|err| CommandError::internal(format!("écriture de l'instantané interrompue : {err}")))?
    .map_err(|err| {
        CommandError::new(
            "ioError",
            format!("Impossible d'écrire l'instantané pare-feu : {err}"),
        )
    })?;

    Ok(FirewallSnapshotExport {
        path: path.display().to_string(),
        rules_saved: status.rules.len() as u32,
        rules_total_count: status.rules_total_count,
        truncated: (status.rules.len() as u32) < status.rules_total_count,
        checked_at: status.checked_at,
        read_only: true,
        restore_supported: false,
        sha256,
        sha256_sidecar: sidecar_path
            .exists()
            .then(|| sidecar_path.display().to_string()),
    })
}

fn snapshot_path(dir: &Path, checked_at: &str) -> PathBuf {
    let stamp = DateTime::parse_from_rfc3339(checked_at)
        .map(|value| value.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
        .format("%Y%m%dT%H%M%SZ")
        .to_string();
    dir.join(format!("firewall-snapshot-{stamp}.json"))
}

fn sidecar_path(path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.sha256", path.display()))
}

const MAX_SNAPSHOT_FILES: usize = 50;
const MAX_SNAPSHOT_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallSnapshotInfo {
    pub path: String,
    pub file_name: String,
    pub bytes: u64,
    pub modified_at: String,
    pub checked_at: Option<String>,
    pub rules_saved: Option<u32>,
    pub rules_total_count: Option<u32>,
    pub truncated: bool,
    pub sha256: String,
    /// `matched`, `mismatch`, `unverified` or `invalid`.
    pub integrity: String,
    pub sidecar_present: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallSnapshotVerification {
    pub snapshot: FirewallSnapshotInfo,
    pub sidecar_sha256: Option<String>,
    pub integrity: String,
    pub structure_valid: bool,
}

fn digest_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn read_sidecar_digest(path: &Path) -> Option<String> {
    std::fs::read_to_string(sidecar_path(path))
        .ok()
        .and_then(|value| value.split_whitespace().next().map(str::to_string))
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
}

fn snapshot_info(path: &Path) -> Result<FirewallSnapshotInfo, std::io::Error> {
    let metadata = std::fs::metadata(path)?;
    if metadata.len() > MAX_SNAPSHOT_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "snapshot exceeds the read limit",
        ));
    }
    let bytes = std::fs::read(path)?;
    let sha256 = digest_bytes(&bytes);
    let sidecar_sha256 = read_sidecar_digest(path);
    let parsed = serde_json::from_slice::<serde_json::Value>(&bytes).ok();
    let structure_valid = parsed.as_ref().is_some_and(|value| {
        value.get("kind").and_then(|kind| kind.as_str()) == Some("firewall-read-only-snapshot")
            && value.get("readOnly").and_then(|flag| flag.as_bool()) == Some(true)
    });
    let integrity = if !structure_valid {
        "invalid"
    } else {
        match sidecar_sha256.as_deref() {
            Some(expected) if expected.eq_ignore_ascii_case(&sha256) => "matched",
            Some(_) => "mismatch",
            None => "unverified",
        }
    };
    let status = parsed.as_ref().and_then(|value| value.get("status"));
    let checked_at = status
        .and_then(|value| value.get("checkedAt"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let rules_saved = status
        .and_then(|value| value.get("rules"))
        .and_then(|value| value.as_array())
        .map(|rules| rules.len() as u32);
    let rules_total_count = status
        .and_then(|value| value.get("rulesTotalCount"))
        .and_then(|value| value.as_u64())
        .map(|value| value as u32);
    let truncated =
        matches!((rules_saved, rules_total_count), (Some(saved), Some(total)) if saved < total);
    let modified_at = metadata
        .modified()
        .map(|value| {
            let datetime: DateTime<Utc> = value.into();
            datetime.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
        })
        .unwrap_or_else(|_| Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true));

    Ok(FirewallSnapshotInfo {
        path: path.display().to_string(),
        file_name: path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default(),
        bytes: metadata.len(),
        modified_at,
        checked_at,
        rules_saved,
        rules_total_count,
        truncated,
        sha256,
        integrity: integrity.to_string(),
        sidecar_present: sidecar_sha256.is_some(),
    })
}

fn list_snapshots(dir: &Path) -> Vec<FirewallSnapshotInfo> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().and_then(|value| value.to_str()) == Some("json")
                && path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .is_some_and(|name| name.starts_with("firewall-snapshot-"))
        })
        .filter_map(|path| {
            std::fs::metadata(&path)
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .map(|modified| (modified, path))
        })
        .collect();
    files.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    files
        .into_iter()
        .take(MAX_SNAPSHOT_FILES)
        .filter_map(|(_, path)| snapshot_info(&path).ok())
        .collect()
}

/// List read-only audit snapshots, newest first. This never opens or applies a
/// snapshot and never writes to the firewall configuration.
#[tauri::command]
pub async fn firewall_snapshot_history(
    state: State<'_, AppState>,
) -> Result<Vec<FirewallSnapshotInfo>, CommandError> {
    let directory = state.paths.firewall_backups.clone();
    tokio::task::spawn_blocking(move || list_snapshots(&directory))
        .await
        .map_err(|err| {
            CommandError::internal(format!("lecture des instantanés interrompue : {err}"))
        })
}

fn contained_snapshot_path(root: &Path, candidate: &Path) -> Option<PathBuf> {
    let root = root.canonicalize().ok()?;
    let candidate = candidate.canonicalize().ok()?;
    if !candidate.starts_with(&root) {
        return None;
    }
    if candidate.extension().and_then(|value| value.to_str()) != Some("json") {
        return None;
    }
    Some(candidate)
}

/// Verify a read-only snapshot's structure and, when present, its SHA-256
/// sidecar. A sidecar is an integrity aid, not a signature or a restore path.
#[tauri::command]
pub fn firewall_verify_snapshot(
    state: State<'_, AppState>,
    path: String,
) -> Result<FirewallSnapshotVerification, CommandError> {
    let candidate = contained_snapshot_path(&state.paths.firewall_backups, Path::new(&path))
        .ok_or_else(|| {
            CommandError::new(
                "invalidSnapshotPath",
                "L'instantané demandé n'est pas dans le dossier d'audit CBS Shield.",
            )
        })?;
    let info = snapshot_info(&candidate).map_err(|err| {
        CommandError::new(
            "snapshotUnreadable",
            format!("Impossible de lire l'instantané pare-feu : {err}"),
        )
    })?;
    let sidecar_sha256 = read_sidecar_digest(&candidate);
    let structure_valid = info.integrity != "invalid";
    Ok(FirewallSnapshotVerification {
        integrity: info.integrity.clone(),
        snapshot: info,
        sidecar_sha256,
        structure_valid,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallConnectionRow {
    pub transport: String,
    pub local_endpoint: String,
    pub remote_endpoint: Option<String>,
    pub state: Option<String>,
    pub pid: u32,
    pub process_name: Option<String>,
    pub process_path: Option<String>,
    /// Rule names whose application path/name references this executable.
    /// This is a reference, not an effective allow/block verdict.
    pub matching_rules: Vec<String>,
    pub matching_rule_count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallConnections {
    pub captured_at: String,
    pub firewall_checked_at: Option<String>,
    pub mapping_available: bool,
    pub mapping_limited: bool,
    pub rules_listed: u32,
    pub rules_total_count: u32,
    pub tcp_total: u64,
    pub udp_total: u64,
    pub rows: Vec<FirewallConnectionRow>,
    pub rows_truncated: bool,
    pub mapped_rows: u64,
    pub unmapped_rows: u64,
}

/// Capture active TCP connections and map their owning executable to firewall
/// rules that reference the same path or file name.
#[tauri::command]
pub async fn firewall_connections(
    _state: State<'_, AppState>,
) -> Result<FirewallConnections, CommandError> {
    let (status, snapshot) = tokio::task::spawn_blocking(|| {
        (cbs_firewall::inspect().ok(), cbs_netmon::capture_snapshot())
    })
    .await
    .map_err(|err| CommandError::internal(format!("capture pare-feu interrompue : {err}")))?;
    let snapshot =
        snapshot.map_err(|err| CommandError::new("netmonUnavailable", err.to_string()))?;

    let mapping_status = status.as_ref();
    let mut mapped_rows = 0u64;
    let mut rows: Vec<FirewallConnectionRow> = snapshot
        .tcp_connections
        .iter()
        .map(|connection| {
            let matching_rules = mapping_status
                .map(|status| matching_rule_names(status, connection))
                .unwrap_or_default();
            if !matching_rules.is_empty() {
                mapped_rows += 1;
            }
            connection_row(connection, matching_rules)
        })
        .collect();

    rows.sort_by(|a, b| {
        b.matching_rule_count
            .cmp(&a.matching_rule_count)
            .then_with(|| {
                let a_established = a.state.as_deref() == Some("ESTABLISHED");
                let b_established = b.state.as_deref() == Some("ESTABLISHED");
                b_established.cmp(&a_established)
            })
            .then_with(|| a.process_name.cmp(&b.process_name))
            .then_with(|| a.remote_endpoint.cmp(&b.remote_endpoint))
    });
    let total_tcp = rows.len() as u64;
    let rows_truncated = rows.len() > MAX_CONNECTION_ROWS;
    rows.truncate(MAX_CONNECTION_ROWS);

    let rules_listed = status
        .as_ref()
        .map(|value| value.rules.len() as u32)
        .unwrap_or_default();
    let rules_total_count = status
        .as_ref()
        .map(|value| value.rules_total_count)
        .unwrap_or_default();
    let mapping_limited = status
        .as_ref()
        .is_some_and(|value| (value.rules.len() as u32) < value.rules_total_count);

    Ok(FirewallConnections {
        captured_at: snapshot.captured_at,
        firewall_checked_at: status.as_ref().map(|value| value.checked_at.clone()),
        mapping_available: status.is_some(),
        mapping_limited,
        rules_listed,
        rules_total_count,
        tcp_total: total_tcp,
        udp_total: snapshot.udp_bindings.len() as u64,
        rows,
        rows_truncated,
        mapped_rows,
        unmapped_rows: total_tcp.saturating_sub(mapped_rows),
    })
}

fn connection_row(
    connection: &NetConnection,
    mut matching_rules: Vec<String>,
) -> FirewallConnectionRow {
    let matching_rule_count = matching_rules.len() as u32;
    matching_rules.truncate(MAX_RULE_NAMES_PER_ROW);
    FirewallConnectionRow {
        transport: match connection.transport {
            Transport::Tcp => "tcp".to_string(),
            Transport::Udp => "udp".to_string(),
        },
        local_endpoint: endpoint(&connection.local_ip, connection.local_port),
        remote_endpoint: connection
            .remote_ip
            .as_ref()
            .zip(connection.remote_port)
            .map(|(ip, port)| endpoint(ip, port)),
        state: connection.state.clone(),
        pid: connection.pid,
        process_name: connection.process_name.clone(),
        process_path: connection.process_path.clone(),
        matching_rule_count,
        matching_rules,
    }
}

fn endpoint(ip: &str, port: u16) -> String {
    if ip.contains(':') {
        format!("[{ip}]:{port}")
    } else {
        format!("{ip}:{port}")
    }
}

fn normalized_name(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .replace('/', "\\")
        .to_ascii_lowercase()
}

fn file_name(value: &str) -> Option<String> {
    normalized_name(value)
        .rsplit('\\')
        .next()
        .filter(|name| !name.is_empty())
        .map(str::to_string)
}

fn rule_references_process(
    rule: &RuleSummary,
    process_path: Option<&str>,
    process_name: Option<&str>,
) -> bool {
    // Without a real image path, a rule name such as "System" cannot be
    // honestly tied to the kernel/system process. Never invent that mapping.
    let Some(path) = process_path else {
        return false;
    };
    let application = normalized_name(&rule.application_name);
    if application.is_empty() {
        return false;
    }
    if application == normalized_name(path) {
        return true;
    }
    let Some(rule_file) = file_name(&application) else {
        return false;
    };
    if let Some(name) = process_name {
        if rule_file == normalized_name(name) {
            return true;
        }
    }
    file_name(path).is_some_and(|path_file| path_file == rule_file)
}

fn matching_rule_names(status: &FirewallStatus, connection: &NetConnection) -> Vec<String> {
    let mut names: Vec<String> = status
        .rules
        .iter()
        .filter(|rule| {
            rule.enabled
                && rule_references_process(
                    rule,
                    connection.process_path.as_deref(),
                    connection.process_name.as_deref(),
                )
        })
        .map(|rule| rule.name.clone())
        .collect();
    names.sort_by_key(|name| name.to_lowercase());
    names
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleManagementGate {
    pub code: String,
    pub satisfied: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleRecoveryPlan {
    /// `designOnly` until every gate is satisfied in an isolated environment.
    pub state: String,
    pub snapshot_read_only: bool,
    pub restore_exposed: bool,
    pub rollback_rehearsed: bool,
    pub isolation_required: bool,
    pub designed_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleManagementStatus {
    /// Permanently false in Sprint 6: no mutation API is exposed.
    pub enabled: bool,
    pub mutation_api_exposed: bool,
    pub backup_directory: String,
    pub snapshot_count: u64,
    /// Snapshots whose .sha256 sidecar matches their bytes.
    pub verified_snapshot_count: u64,
    pub last_snapshot_at: Option<String>,
    pub gates: Vec<RuleManagementGate>,
    pub rollback_design_version: String,
    pub recovery: RuleRecoveryPlan,
}

#[tauri::command]
pub fn firewall_management_status(
    state: State<'_, AppState>,
) -> Result<RuleManagementStatus, CommandError> {
    let backups = &state.paths.firewall_backups;
    let snapshots = list_snapshots(backups);
    let snapshot_count = snapshots.len() as u64;
    let verified_snapshot_count = snapshots
        .iter()
        .filter(|snapshot| snapshot.integrity == "matched")
        .count() as u64;
    let last_snapshot_at = snapshots
        .first()
        .map(|snapshot| snapshot.modified_at.clone());

    Ok(RuleManagementStatus {
        enabled: false,
        mutation_api_exposed: false,
        backup_directory: backups.display().to_string(),
        snapshot_count,
        verified_snapshot_count,
        last_snapshot_at,
        gates: vec![
            RuleManagementGate {
                code: "explicit_authorization".to_string(),
                satisfied: false,
            },
            RuleManagementGate {
                code: "isolated_vm_test".to_string(),
                satisfied: false,
            },
            RuleManagementGate {
                code: "backup_snapshot".to_string(),
                satisfied: verified_snapshot_count > 0,
            },
            RuleManagementGate {
                code: "rollback_rehearsal".to_string(),
                satisfied: false,
            },
        ],
        rollback_design_version: "1".to_string(),
        recovery: RuleRecoveryPlan {
            state: "designOnly".to_string(),
            snapshot_read_only: true,
            restore_exposed: false,
            rollback_rehearsed: false,
            isolation_required: true,
            designed_version: "1".to_string(),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cbs_firewall::ProfileStatus;

    fn rule(name: &str, application: &str, enabled: bool) -> RuleSummary {
        RuleSummary {
            name: name.to_string(),
            grouping: String::new(),
            description: String::new(),
            application_name: application.to_string(),
            service_name: String::new(),
            direction: "entrant".to_string(),
            action: "autoriser".to_string(),
            enabled,
            protocol: "tcp".to_string(),
            local_ports: "443".to_string(),
            remote_ports: "tout".to_string(),
            profiles: "tous".to_string(),
        }
    }

    fn profile(label: &str, enabled: bool) -> ProfileStatus {
        ProfileStatus {
            profile: label.to_string(),
            enabled,
            inbound_default: "bloquer".to_string(),
            outbound_default: "autoriser".to_string(),
        }
    }

    fn status(
        profiles: Vec<ProfileStatus>,
        rules: Vec<RuleSummary>,
        rules_hash: &str,
    ) -> FirewallStatus {
        FirewallStatus {
            checked_at: "2026-10-26T09:00:00Z".to_string(),
            active_profiles: vec!["privé".to_string()],
            rules,
            rules_total_count: 1,
            rules_hash: rules_hash.to_string(),
            profiles_hash: "profiles".to_string(),
            configuration_hash: "configuration".to_string(),
            profiles,
        }
    }

    fn baseline(status: &FirewallStatus) -> FirewallBaseline {
        FirewallBaseline::from_status(status)
    }

    #[test]
    fn detects_rule_and_profile_changes() {
        let original = status(
            vec![profile("domaine", true), profile("privé", true)],
            vec![rule("A", "C:\\Apps\\a.exe", true)],
            "rules-1",
        );
        let stored = baseline(&original);
        assert!(changes_since(&original, &stored).is_empty());

        let mut changed = original.clone();
        changed.rules_hash = "rules-2".to_string();
        changed.profiles[1].enabled = false;
        let changes = changes_since(&changed, &stored);
        assert!(changes.iter().any(|change| change.code == "rules_changed"));
        assert!(changes.iter().any(|change| {
            change.code == "profile_state_changed" && change.profile.as_deref() == Some("privé")
        }));
    }

    #[test]
    fn detects_default_action_changes_per_profile() {
        let original = status(
            vec![profile("domaine", true), profile("privé", true)],
            vec![],
            "rules",
        );
        let stored = baseline(&original);
        let mut changed = original;
        changed.profiles[0].inbound_default = "autoriser".to_string();
        let changes = changes_since(&changed, &stored);
        assert!(changes.iter().any(|change| {
            change.code == "profile_defaults_changed"
                && change.profile.as_deref() == Some("domaine")
        }));
    }

    #[test]
    fn maps_rules_by_full_path_and_file_name() {
        let observed = status(
            vec![profile("privé", true)],
            vec![
                rule("Path match", "C:\\Program Files\\App\\app.exe", true),
                rule("Name match", "%SystemRoot%\\System32\\app.exe", true),
                rule("Disabled", "C:\\Program Files\\App\\app.exe", false),
                rule("Other", "C:\\Other\\other.exe", true),
            ],
            "rules",
        );
        let connection = NetConnection {
            transport: Transport::Tcp,
            local_ip: "127.0.0.1".to_string(),
            local_port: 50000,
            remote_ip: Some("93.184.216.34".to_string()),
            remote_port: Some(443),
            state: Some("ESTABLISHED".to_string()),
            pid: 42,
            process_name: Some("app.exe".to_string()),
            process_path: Some("C:\\Program Files\\App\\app.exe".to_string()),
        };
        let names = matching_rule_names(&observed, &connection);
        assert_eq!(names, vec!["Name match", "Path match"]);
        assert!(!names.contains(&"Disabled".to_string()));
        assert!(!names.contains(&"Other".to_string()));
    }

    #[test]
    fn keeps_total_matching_rule_count_when_names_are_capped() {
        let observed = status(
            vec![profile("privé", true)],
            (0..MAX_RULE_NAMES_PER_ROW + 2)
                .map(|index| {
                    rule(
                        &format!("Rule {index}"),
                        "C:\\Program Files\\App\\app.exe",
                        true,
                    )
                })
                .collect(),
            "rules",
        );
        let connection = NetConnection {
            transport: Transport::Tcp,
            local_ip: "127.0.0.1".to_string(),
            local_port: 50000,
            remote_ip: None,
            remote_port: None,
            state: None,
            pid: 42,
            process_name: Some("app.exe".to_string()),
            process_path: Some("C:\\Program Files\\App\\app.exe".to_string()),
        };
        let row = connection_row(&connection, matching_rule_names(&observed, &connection));
        assert_eq!(row.matching_rule_count, (MAX_RULE_NAMES_PER_ROW + 2) as u32);
        assert_eq!(row.matching_rules.len(), MAX_RULE_NAMES_PER_ROW);
    }

    #[test]
    fn unknown_processes_have_no_invented_mapping() {
        let observed = status(
            vec![profile("privé", true)],
            vec![
                rule("A", "C:\\Apps\\a.exe", true),
                rule("System", "System", true),
            ],
            "rules",
        );
        let connection = NetConnection {
            transport: Transport::Tcp,
            local_ip: "127.0.0.1".to_string(),
            local_port: 50000,
            remote_ip: None,
            remote_port: None,
            state: None,
            pid: 4,
            process_name: Some("System".to_string()),
            process_path: None,
        };
        assert!(matching_rule_names(&observed, &connection).is_empty());
    }

    #[test]
    fn snapshot_file_name_is_path_safe() {
        let path = snapshot_path(
            Path::new("C:\\data\\firewall-backups"),
            "2026-10-26T09:00:00Z",
        );
        let name = path.file_name().unwrap().to_string_lossy();
        assert_eq!(name, "firewall-snapshot-20261026T090000Z.json");
    }

    #[test]
    fn snapshot_history_verifies_digest_and_detects_tampering() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory
            .path()
            .join("firewall-snapshot-20261026T090000Z.json");
        let snapshot = serde_json::json!({
            "kind": "firewall-read-only-snapshot",
            "readOnly": true,
            "restoreSupported": false,
            "status": {
                "checkedAt": "2026-10-26T09:00:00Z",
                "rulesTotalCount": 3,
                "rules": [{ "name": "one" }, { "name": "two" }]
            }
        });
        let text = serde_json::to_vec_pretty(&snapshot).unwrap();
        std::fs::write(&path, &text).unwrap();
        let digest = digest_bytes(&text);
        std::fs::write(
            sidecar_path(&path),
            format!("{digest}  firewall-snapshot-20261026T090000Z.json\n"),
        )
        .unwrap();

        let info = snapshot_info(&path).unwrap();
        assert_eq!(info.integrity, "matched");
        assert!(info.sidecar_present);
        assert_eq!(info.rules_saved, Some(2));
        assert_eq!(info.rules_total_count, Some(3));
        assert!(info.truncated);
        assert_eq!(list_snapshots(directory.path()).len(), 1);

        let tampered = serde_json::json!({
            "kind": "firewall-read-only-snapshot",
            "readOnly": true,
            "status": { "checkedAt": "2026-10-26T09:00:00Z", "rules": [] }
        });
        std::fs::write(&path, serde_json::to_vec_pretty(&tampered).unwrap()).unwrap();
        assert_eq!(snapshot_info(&path).unwrap().integrity, "mismatch");

        std::fs::write(&path, b"not json").unwrap();
        assert_eq!(snapshot_info(&path).unwrap().integrity, "invalid");
    }

    #[test]
    fn snapshot_paths_are_contained_and_require_json() {
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let inside = directory
            .path()
            .join("firewall-snapshot-20261026T090000Z.json");
        std::fs::write(&inside, b"{}").unwrap();
        let outside_file = outside
            .path()
            .join("firewall-snapshot-20261026T090000Z.json");
        std::fs::write(&outside_file, b"{}").unwrap();

        assert!(contained_snapshot_path(directory.path(), &inside).is_some());
        assert!(contained_snapshot_path(directory.path(), &outside_file).is_none());
        assert!(contained_snapshot_path(directory.path(), directory.path()).is_none());
    }

    #[test]
    fn parses_real_sc_query_states_without_inventing_values() {
        let running = "SERVICE_NAME: MpsSvc\n        TYPE               : 30  WIN32\n        STATE              : 4  RUNNING\n";
        let stopped = "SERVICE_NAME: BFE\n        STATE              : 1  STOPPED\n";
        let pending = "        STATE              : 3  STOP_PENDING\n";
        assert_eq!(parse_service_state(running), "running");
        assert_eq!(parse_service_state(stopped), "stopped");
        assert_eq!(parse_service_state(pending), "stopPending");
        assert_eq!(parse_service_state("SERVICE_NAME: BFE"), "unknown");
        assert_eq!(
            parse_service_state("        STATE              : 42  MYSTERY\n"),
            "unknown"
        );
    }

    #[test]
    fn first_baseline_has_no_changes() {
        let observed = status(
            vec![profile("domaine", true), profile("privé", true)],
            vec![],
            "rules",
        );
        let stored = baseline(&observed);
        assert!(changes_since(&observed, &stored).is_empty());
        assert_eq!(stored.version, BASELINE_VERSION);
    }
}
