//! Local SQLite persistence for scans, detections, quarantine metadata and settings.
//!
//! No file is ever deleted or moved by this crate: it only stores records.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use cbs_core::{ScanOutcome, ScanReport};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

const SCHEMA_VERSION: i64 = 2;

// v1: scans, detections, quarantine, settings.
// v2 (Sprint 2): adds `netmon_snapshots` — local history of Network Monitor
// summaries. `execute_batch` only uses `CREATE ... IF NOT EXISTS`, so the same
// batch safely migrates a v1 database (fresh file -> v2 directly).

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS scans (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid              TEXT    NOT NULL UNIQUE,
    started_at        TEXT    NOT NULL,
    finished_at       TEXT    NOT NULL,
    duration_ms       INTEGER NOT NULL,
    targets_json      TEXT    NOT NULL,
    files_scanned     INTEGER NOT NULL,
    infected_files    INTEGER NOT NULL,
    error_count       INTEGER NOT NULL,
    outcome           TEXT    NOT NULL,
    cancelled         INTEGER NOT NULL,
    engine_version    TEXT,
    signature_version TEXT,
    summary_json      TEXT,
    fatal_error       TEXT
);

CREATE TABLE IF NOT EXISTS detections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id     INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    file_path   TEXT    NOT NULL,
    threat_name TEXT    NOT NULL,
    file_size   INTEGER,
    sha256      TEXT,
    created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_detections_scan ON detections(scan_id);

CREATE TABLE IF NOT EXISTS quarantine (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id        TEXT    NOT NULL UNIQUE,
    file_name      TEXT    NOT NULL,
    original_path  TEXT    NOT NULL,
    stored_path    TEXT    NOT NULL,
    sha256         TEXT    NOT NULL,
    size_bytes     INTEGER NOT NULL,
    threat_name    TEXT    NOT NULL,
    status         TEXT    NOT NULL DEFAULT 'active',
    created_at     TEXT    NOT NULL,
    restored_at    TEXT,
    source_scan_id INTEGER REFERENCES scans(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_quarantine_status ON quarantine(status);

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS netmon_snapshots (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    captured_at        TEXT    NOT NULL,
    tcp_total          INTEGER NOT NULL,
    tcp_established    INTEGER NOT NULL,
    udp_total          INTEGER NOT NULL,
    rx_bytes_delta     INTEGER NOT NULL,
    tx_bytes_delta     INTEGER NOT NULL,
    top_processes_json TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_netmon_captured ON netmon_snapshots(captured_at);
"#;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("erreur SQLite : {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("erreur de sérialisation : {0}")]
    Json(#[from] serde_json::Error),
    #[error("erreur d'entrée/sortie : {0}")]
    Io(#[from] std::io::Error),
    #[error("base de données indisponible : {0}")]
    Lock(String),
    #[error("enregistrement invalide : {0}")]
    Invalid(String),
}

fn lock_err<T>(err: std::sync::PoisonError<T>) -> StoreError {
    StoreError::Lock(err.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRecord {
    pub id: i64,
    pub uuid: String,
    pub started_at: String,
    pub finished_at: String,
    pub duration_ms: u64,
    pub targets: Vec<String>,
    pub files_scanned: u64,
    pub infected_files: u64,
    pub error_count: u64,
    pub outcome: String,
    pub cancelled: bool,
    pub engine_version: Option<String>,
    pub signature_version: Option<String>,
    pub fatal_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredDetection {
    pub id: i64,
    pub scan_id: i64,
    pub file_path: String,
    pub threat_name: String,
    pub file_size_bytes: Option<u64>,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanDetails {
    pub scan: ScanRecord,
    pub detections: Vec<StoredDetection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStats {
    pub total_scans: u64,
    pub total_detections: u64,
    pub total_files_scanned: u64,
    pub active_quarantine: u64,
    pub restored_quarantine: u64,
    pub last_scan: Option<ScanRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewQuarantine {
    pub item_id: String,
    pub file_name: String,
    pub original_path: String,
    pub stored_path: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub threat_name: String,
    pub source_scan_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QuarantineStatus {
    Active,
    Restored,
    Deleted,
}

impl QuarantineStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Restored => "restored",
            Self::Deleted => "deleted",
        }
    }

    fn from_db(value: &str) -> Self {
        match value {
            "restored" => Self::Restored,
            "deleted" => Self::Deleted,
            _ => Self::Active,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuarantineRecord {
    pub id: i64,
    pub item_id: String,
    pub file_name: String,
    pub original_path: String,
    pub stored_path: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub threat_name: String,
    pub status: QuarantineStatus,
    pub created_at: String,
    pub restored_at: Option<String>,
    pub source_scan_id: Option<i64>,
}

pub struct Store {
    connection: Mutex<Connection>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        Self::configure(&connection)?;
        let store = Self {
            connection: Mutex::new(connection),
        };
        store.migrate()?;
        Ok(store)
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        let connection = Connection::open_in_memory()?;
        Self::configure(&connection)?;
        let store = Self {
            connection: Mutex::new(connection),
        };
        store.migrate()?;
        Ok(store)
    }

    fn configure(connection: &Connection) -> Result<(), StoreError> {
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        // WAL improves UI responsiveness while scans write history. It is
        // ignored for in-memory databases.
        let _ = connection.pragma_update(None, "journal_mode", "WAL");
        Ok(())
    }

    fn migrate(&self) -> Result<(), StoreError> {
        let connection = self.connection.lock().map_err(lock_err)?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version < SCHEMA_VERSION {
            connection.execute_batch(SCHEMA_SQL)?;
            connection.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }
        Ok(())
    }

    fn conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, StoreError> {
        self.connection.lock().map_err(lock_err)
    }

    pub fn save_scan(&self, report: &ScanReport) -> Result<i64, StoreError> {
        let mut connection = self.conn()?;
        let transaction = connection.transaction()?;
        let outcome = outcome_as_str(report.outcome);
        let targets_json = serde_json::to_string(&report.targets)?;
        let summary_json = report
            .summary
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        transaction.execute(
            r#"INSERT INTO scans (
                uuid, started_at, finished_at, duration_ms, targets_json,
                files_scanned, infected_files, error_count, outcome, cancelled,
                engine_version, signature_version, summary_json, fatal_error
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)"#,
            params![
                report.id,
                report.started_at,
                report.finished_at,
                report.duration_ms as i64,
                targets_json,
                report.files_scanned as i64,
                report.infected_files as i64,
                report.error_count as i64,
                outcome,
                report.cancelled as i64,
                report.engine_version,
                report.signature_version,
                summary_json,
                report.fatal_error,
            ],
        )?;
        let scan_id = transaction.last_insert_rowid();

        for detection in &report.detections {
            transaction.execute(
                r#"INSERT INTO detections (scan_id, file_path, threat_name, file_size, sha256, created_at)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
                params![
                    scan_id,
                    detection.file_path,
                    detection.threat_name,
                    detection.file_size_bytes.map(|size| size as i64),
                    detection.sha256,
                    report.finished_at,
                ],
            )?;
        }

        transaction.commit()?;
        Ok(scan_id)
    }

    pub fn list_scans(&self, limit: u32) -> Result<Vec<ScanRecord>, StoreError> {
        let connection = self.conn()?;
        let limit = limit.clamp(1, 500) as i64;
        let mut statement = connection.prepare(
            r#"SELECT id, uuid, started_at, finished_at, duration_ms, targets_json,
                      files_scanned, infected_files, error_count, outcome, cancelled,
                      engine_version, signature_version, fatal_error
               FROM scans ORDER BY id DESC LIMIT ?1"#,
        )?;
        let rows = statement.query_map([limit], map_scan_row)?;
        let mut scans = Vec::new();
        for row in rows {
            scans.push(row?);
        }
        Ok(scans)
    }

    pub fn get_scan(&self, scan_id: i64) -> Result<Option<ScanDetails>, StoreError> {
        let connection = self.conn()?;
        let scan = connection
            .query_row(
                r#"SELECT id, uuid, started_at, finished_at, duration_ms, targets_json,
                          files_scanned, infected_files, error_count, outcome, cancelled,
                          engine_version, signature_version, fatal_error
                   FROM scans WHERE id = ?1"#,
                [scan_id],
                map_scan_row,
            )
            .optional()?;
        let Some(scan) = scan else {
            return Ok(None);
        };

        let mut statement = connection.prepare(
            r#"SELECT id, scan_id, file_path, threat_name, file_size, sha256
               FROM detections WHERE scan_id = ?1 ORDER BY id"#,
        )?;
        let rows = statement.query_map([scan_id], |row| {
            Ok(StoredDetection {
                id: row.get(0)?,
                scan_id: row.get(1)?,
                file_path: row.get(2)?,
                threat_name: row.get(3)?,
                file_size_bytes: row.get::<_, Option<i64>>(4)?.map(|v| v.max(0) as u64),
                sha256: row.get(5)?,
            })
        })?;
        let mut detections = Vec::new();
        for row in rows {
            detections.push(row?);
        }

        Ok(Some(ScanDetails { scan, detections }))
    }

    pub fn dashboard_stats(&self) -> Result<DashboardStats, StoreError> {
        let connection = self.conn()?;
        let total_scans: i64 =
            connection.query_row("SELECT COUNT(*) FROM scans", [], |row| row.get(0))?;
        let total_detections: i64 =
            connection.query_row("SELECT COUNT(*) FROM detections", [], |row| row.get(0))?;
        let total_files_scanned: i64 = connection.query_row(
            "SELECT COALESCE(SUM(files_scanned), 0) FROM scans",
            [],
            |row| row.get(0),
        )?;
        let active_quarantine: i64 = connection.query_row(
            "SELECT COUNT(*) FROM quarantine WHERE status = 'active'",
            [],
            |row| row.get(0),
        )?;
        let restored_quarantine: i64 = connection.query_row(
            "SELECT COUNT(*) FROM quarantine WHERE status = 'restored'",
            [],
            |row| row.get(0),
        )?;

        let last_scan = connection
            .query_row(
                r#"SELECT id, uuid, started_at, finished_at, duration_ms, targets_json,
                          files_scanned, infected_files, error_count, outcome, cancelled,
                          engine_version, signature_version, fatal_error
                   FROM scans ORDER BY id DESC LIMIT 1"#,
                [],
                map_scan_row,
            )
            .optional()?;

        Ok(DashboardStats {
            total_scans: total_scans.max(0) as u64,
            total_detections: total_detections.max(0) as u64,
            total_files_scanned: total_files_scanned.max(0) as u64,
            active_quarantine: active_quarantine.max(0) as u64,
            restored_quarantine: restored_quarantine.max(0) as u64,
            last_scan,
        })
    }

    pub fn insert_quarantine(&self, item: &NewQuarantine) -> Result<QuarantineRecord, StoreError> {
        let created_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let connection = self.conn()?;
        connection.execute(
            r#"INSERT INTO quarantine (
                item_id, file_name, original_path, stored_path, sha256, size_bytes,
                threat_name, status, created_at, source_scan_id
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8, ?9)"#,
            params![
                item.item_id,
                item.file_name,
                item.original_path,
                item.stored_path,
                item.sha256,
                item.size_bytes as i64,
                item.threat_name,
                created_at,
                item.source_scan_id,
            ],
        )?;
        let id = connection.last_insert_rowid();
        drop(connection);

        self.quarantine_by_id(id)?
            .ok_or_else(|| StoreError::Invalid("entrée de quarantaine introuvable".to_string()))
    }

    pub fn list_quarantine(&self) -> Result<Vec<QuarantineRecord>, StoreError> {
        let connection = self.conn()?;
        let mut statement = connection.prepare(
            r#"SELECT id, item_id, file_name, original_path, stored_path, sha256, size_bytes,
                      threat_name, status, created_at, restored_at, source_scan_id
               FROM quarantine ORDER BY (status = 'active') DESC, id DESC"#,
        )?;
        let rows = statement.query_map([], map_quarantine_row)?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    }

    pub fn quarantine_by_id(&self, id: i64) -> Result<Option<QuarantineRecord>, StoreError> {
        let connection = self.conn()?;
        Ok(connection
            .query_row(
                r#"SELECT id, item_id, file_name, original_path, stored_path, sha256, size_bytes,
                          threat_name, status, created_at, restored_at, source_scan_id
                   FROM quarantine WHERE id = ?1"#,
                [id],
                map_quarantine_row,
            )
            .optional()?)
    }

    pub fn mark_quarantine_restored(&self, id: i64) -> Result<(), StoreError> {
        let restored_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let connection = self.conn()?;
        let updated = connection.execute(
            "UPDATE quarantine SET status = 'restored', restored_at = ?1 WHERE id = ?2 AND status = 'active'",
            params![restored_at, id],
        )?;
        if updated == 0 {
            return Err(StoreError::Invalid(
                "cette entrée n'est plus active".to_string(),
            ));
        }
        Ok(())
    }

    pub fn mark_quarantine_deleted(&self, id: i64) -> Result<(), StoreError> {
        let connection = self.conn()?;
        let updated = connection.execute(
            "UPDATE quarantine SET status = 'deleted' WHERE id = ?1 AND status = 'active'",
            [id],
        )?;
        if updated == 0 {
            return Err(StoreError::Invalid(
                "cette entrée n'est plus active".to_string(),
            ));
        }
        Ok(())
    }

    pub fn settings(&self) -> Result<HashMap<String, String>, StoreError> {
        let connection = self.conn()?;
        let mut statement = connection.prepare("SELECT key, value FROM settings")?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get(1)?)))?;
        let mut map = HashMap::new();
        for row in rows {
            let (key, value) = row?;
            map.insert(key, value);
        }
        Ok(map)
    }

    pub fn setting(&self, key: &str) -> Result<Option<String>, StoreError> {
        let connection = self.conn()?;
        Ok(connection
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), StoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let connection = self.conn()?;
        connection.execute(
            r#"INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"#,
            params![key, value, now],
        )?;
        Ok(())
    }

    /// Persist one Network Monitor snapshot summary (Sprint 2).
    pub fn insert_netmon_snapshot(&self, snapshot: &NewNetmonSnapshot) -> Result<i64, StoreError> {
        let top_json = serde_json::to_string(&snapshot.top_processes)?;
        let connection = self.conn()?;
        connection.execute(
            r#"INSERT INTO netmon_snapshots (
                captured_at, tcp_total, tcp_established, udp_total,
                rx_bytes_delta, tx_bytes_delta, top_processes_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
            params![
                snapshot.captured_at,
                snapshot.tcp_total as i64,
                snapshot.tcp_established as i64,
                snapshot.udp_total as i64,
                snapshot.rx_bytes_delta as i64,
                snapshot.tx_bytes_delta as i64,
                top_json,
            ],
        )?;
        // Bounded local history: older summaries are trimmed automatically so
        // the table cannot grow forever during long monitoring sessions.
        connection.execute(
            r#"DELETE FROM netmon_snapshots WHERE id <= (
                SELECT MAX(id) FROM (SELECT id FROM netmon_snapshots
                                     ORDER BY id DESC LIMIT 1 OFFSET ?1)
            )"#,
            [NETMON_SNAPSHOT_RETENTION],
        )?;
        Ok(connection.last_insert_rowid())
    }

    /// Newest-first list of stored Network Monitor summaries.
    pub fn list_netmon_snapshots(
        &self,
        limit: u32,
    ) -> Result<Vec<NetmonSnapshotRecord>, StoreError> {
        let connection = self.conn()?;
        let mut statement = connection.prepare(
            r#"SELECT id, captured_at, tcp_total, tcp_established, udp_total,
                      rx_bytes_delta, tx_bytes_delta, top_processes_json
               FROM netmon_snapshots ORDER BY id DESC LIMIT ?1"#,
        )?;
        let rows = statement.query_map([limit], |row| {
            let top_json: String = row.get(7)?;
            Ok(NetmonSnapshotRecord {
                id: row.get(0)?,
                captured_at: row.get(1)?,
                tcp_total: row.get::<_, i64>(2)?.max(0) as u64,
                tcp_established: row.get::<_, i64>(3)?.max(0) as u64,
                udp_total: row.get::<_, i64>(4)?.max(0) as u64,
                rx_bytes_delta: row.get::<_, i64>(5)?.max(0) as u64,
                tx_bytes_delta: row.get::<_, i64>(6)?.max(0) as u64,
                top_processes: serde_json::from_str(&top_json).unwrap_or_default(),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }

    pub fn netmon_snapshot_count(&self) -> Result<u64, StoreError> {
        let connection = self.conn()?;
        Ok(connection
            .query_row("SELECT COUNT(*) FROM netmon_snapshots", [], |row| {
                row.get::<_, i64>(0)
            })?
            .max(0) as u64)
    }
}

/// Maximum number of Network Monitor summaries kept on disk (bounded history).
pub const NETMON_SNAPSHOT_RETENTION: i64 = 2_000;

/// Aggregated process connection counts stored with a snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NetmonProcessCount {
    pub name: String,
    pub connections: u64,
}

/// New Network Monitor summary row (i64-free input form).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewNetmonSnapshot {
    pub captured_at: String,
    pub tcp_total: u64,
    pub tcp_established: u64,
    pub udp_total: u64,
    /// Measured incoming-interface counter delta since the previous capture
    /// (0 when this is the first capture or the counter could not be read).
    pub rx_bytes_delta: u64,
    pub tx_bytes_delta: u64,
    /// Top processes by active connection count (at most a small bounded list).
    pub top_processes: Vec<NetmonProcessCount>,
}

/// A stored Network Monitor summary as returned to the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetmonSnapshotRecord {
    pub id: i64,
    pub captured_at: String,
    pub tcp_total: u64,
    pub tcp_established: u64,
    pub udp_total: u64,
    pub rx_bytes_delta: u64,
    pub tx_bytes_delta: u64,
    pub top_processes: Vec<NetmonProcessCount>,
}

fn outcome_as_str(outcome: ScanOutcome) -> &'static str {
    match outcome {
        ScanOutcome::Clean => "clean",
        ScanOutcome::Detected => "detected",
        ScanOutcome::Cancelled => "cancelled",
        ScanOutcome::CompletedWithErrors => "completedWithErrors",
        ScanOutcome::Failed => "failed",
    }
}

fn map_scan_row(row: &Row<'_>) -> rusqlite::Result<ScanRecord> {
    let targets_json: String = row.get(5)?;
    let targets: Vec<String> = serde_json::from_str(&targets_json).unwrap_or_default();
    Ok(ScanRecord {
        id: row.get(0)?,
        uuid: row.get(1)?,
        started_at: row.get(2)?,
        finished_at: row.get(3)?,
        duration_ms: row.get::<_, i64>(4)?.max(0) as u64,
        targets,
        files_scanned: row.get::<_, i64>(6)?.max(0) as u64,
        infected_files: row.get::<_, i64>(7)?.max(0) as u64,
        error_count: row.get::<_, i64>(8)?.max(0) as u64,
        outcome: row.get(9)?,
        cancelled: row.get::<_, i64>(10)? != 0,
        engine_version: row.get(11)?,
        signature_version: row.get(12)?,
        fatal_error: row.get(13)?,
    })
}

fn map_quarantine_row(row: &Row<'_>) -> rusqlite::Result<QuarantineRecord> {
    let status: String = row.get(8)?;
    Ok(QuarantineRecord {
        id: row.get(0)?,
        item_id: row.get(1)?,
        file_name: row.get(2)?,
        original_path: row.get(3)?,
        stored_path: row.get(4)?,
        sha256: row.get(5)?,
        size_bytes: row.get::<_, i64>(6)?.max(0) as u64,
        threat_name: row.get(7)?,
        status: QuarantineStatus::from_db(&status),
        created_at: row.get(9)?,
        restored_at: row.get(10)?,
        source_scan_id: row.get(11)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cbs_core::Detection;

    /// Exact Phase 1 (schema v1) layout, used to prove in-place migration.
    const LEGACY_V1_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS scans (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid              TEXT    NOT NULL UNIQUE,
    started_at        TEXT    NOT NULL,
    finished_at       TEXT    NOT NULL,
    duration_ms       INTEGER NOT NULL,
    targets_json      TEXT    NOT NULL,
    files_scanned     INTEGER NOT NULL,
    infected_files    INTEGER NOT NULL,
    error_count       INTEGER NOT NULL,
    outcome           TEXT    NOT NULL,
    cancelled         INTEGER NOT NULL,
    engine_version    TEXT,
    signature_version TEXT,
    summary_json      TEXT,
    fatal_error       TEXT
);
CREATE TABLE IF NOT EXISTS detections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id     INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    file_path   TEXT    NOT NULL,
    threat_name TEXT    NOT NULL,
    file_size   INTEGER,
    sha256      TEXT,
    created_at  TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS quarantine (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id        TEXT    NOT NULL UNIQUE,
    file_name      TEXT    NOT NULL,
    original_path  TEXT    NOT NULL,
    stored_path    TEXT    NOT NULL,
    sha256         TEXT    NOT NULL,
    size_bytes     INTEGER NOT NULL,
    threat_name    TEXT    NOT NULL,
    status         TEXT    NOT NULL DEFAULT 'active',
    created_at     TEXT    NOT NULL,
    restored_at    TEXT,
    source_scan_id INTEGER REFERENCES scans(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"#;

    fn sample_report() -> ScanReport {
        ScanReport {
            id: "scan-uuid-1".to_string(),
            started_at: "2026-10-25T10:00:00Z".to_string(),
            finished_at: "2026-10-25T10:00:02Z".to_string(),
            duration_ms: 2000,
            targets: vec![r"C:\Users\me\Downloads".to_string()],
            profile: "quick".to_string(),
            excluded: vec![],
            indexed_files: Some(43),
            index_truncated: false,
            limits: cbs_core::ScanLimits::default(),
            files_scanned: 42,
            infected_files: 1,
            error_count: 0,
            detections: vec![Detection {
                file_path: r"C:\Users\me\Downloads\eicar.com".to_string(),
                threat_name: "Win.Test.EICAR_HDB-1".to_string(),
                file_size_bytes: Some(68),
                sha256: Some("abc123".to_string()),
            }],
            errors: vec![],
            outcome: ScanOutcome::Detected,
            cancelled: false,
            engine_version: Some("1.5.4".to_string()),
            signature_version: Some("27900".to_string()),
            summary: None,
            fatal_error: None,
        }
    }

    #[test]
    fn saves_and_reads_scan_history() {
        let store = Store::open_in_memory().unwrap();
        let id = store.save_scan(&sample_report()).unwrap();
        assert!(id > 0);

        let scans = store.list_scans(10).unwrap();
        assert_eq!(scans.len(), 1);
        assert_eq!(scans[0].infected_files, 1);
        assert_eq!(scans[0].outcome, "detected");

        let details = store.get_scan(id).unwrap().expect("details");
        assert_eq!(details.detections.len(), 1);
        assert_eq!(details.detections[0].sha256.as_deref(), Some("abc123"));
    }

    #[test]
    fn dashboard_aggregates_history() {
        let store = Store::open_in_memory().unwrap();
        store.save_scan(&sample_report()).unwrap();
        let stats = store.dashboard_stats().unwrap();
        assert_eq!(stats.total_scans, 1);
        assert_eq!(stats.total_detections, 1);
        assert_eq!(stats.total_files_scanned, 42);
        assert!(stats.last_scan.is_some());
    }

    fn netmon_sample(captured_at: &str, tcp: u64, rx: u64, tx: u64) -> NewNetmonSnapshot {
        NewNetmonSnapshot {
            captured_at: captured_at.to_string(),
            tcp_total: tcp,
            tcp_established: tcp / 2,
            udp_total: 3,
            rx_bytes_delta: rx,
            tx_bytes_delta: tx,
            top_processes: vec![NetmonProcessCount {
                name: "chrome.exe".to_string(),
                connections: tcp,
            }],
        }
    }

    #[test]
    fn netmon_snapshots_roundtrip_newest_first() {
        let store = Store::open_in_memory().unwrap();
        store
            .insert_netmon_snapshot(&netmon_sample("2026-10-25T10:00:00Z", 10, 0, 0))
            .unwrap();
        store
            .insert_netmon_snapshot(&netmon_sample("2026-10-25T10:00:05Z", 12, 1024, 512))
            .unwrap();

        let list = store.list_netmon_snapshots(10).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].captured_at, "2026-10-25T10:00:05Z");
        assert_eq!(list[0].tcp_total, 12);
        assert_eq!(list[0].rx_bytes_delta, 1024);
        assert_eq!(list[0].tx_bytes_delta, 512);
        assert_eq!(list[0].top_processes[0].connections, 12);
        assert_eq!(list[1].captured_at, "2026-10-25T10:00:00Z");
        assert_eq!(store.netmon_snapshot_count().unwrap(), 2);

        let limited = store.list_netmon_snapshots(1).unwrap();
        assert_eq!(limited.len(), 1);
    }

    #[test]
    fn netmon_snapshot_history_is_trimmed() {
        // Retention + 60 extra rows: only the newest `retention` rows remain.
        let store = Store::open_in_memory().unwrap();
        let total = (NETMON_SNAPSHOT_RETENTION as u64 + 60) as i64;
        for index in 1..=total {
            let snapshot = netmon_sample("2026-10-25T10:00:00Z", index as u64, 0, 0);
            store.insert_netmon_snapshot(&snapshot).unwrap();
        }
        assert_eq!(
            store.netmon_snapshot_count().unwrap(),
            NETMON_SNAPSHOT_RETENTION as u64
        );
        let newest = store.list_netmon_snapshots(1).unwrap();
        assert_eq!(newest[0].tcp_total, total as u64);
    }

    #[test]
    fn legacy_v1_database_is_migrated_to_v2() {
        // Build a real SQLite file stamped as schema v1 (Phase 1 layout),
        // without the netmon_snapshots table.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.db");
        {
            let connection = rusqlite::Connection::open(&path).unwrap();
            connection.execute_batch(LEGACY_V1_SCHEMA_SQL).unwrap();
            connection
                .execute(
                    "INSERT INTO scans (uuid, started_at, finished_at, duration_ms, targets_json, files_scanned, infected_files, error_count, outcome, cancelled)
                     VALUES ('legacy-1', '2026-10-01T00:00:00Z', '2026-10-01T00:00:01Z', 1000, '[]', 1, 0, 0, 'clean', 0)",
                    [],
                )
                .unwrap();
            connection.pragma_update(None, "user_version", 1).unwrap();
        }

        // Opening must keep every existing capability and add the new table.
        let store = Store::open(&path).unwrap();
        let scans = store.list_scans(10).unwrap();
        assert_eq!(scans.len(), 1);
        assert_eq!(store.netmon_snapshot_count().unwrap(), 0);
        store
            .insert_netmon_snapshot(&netmon_sample("2026-10-25T10:00:00Z", 7, 0, 0))
            .unwrap();
        assert_eq!(store.netmon_snapshot_count().unwrap(), 1);
        assert_eq!(store.list_netmon_snapshots(1).unwrap()[0].tcp_total, 7);

        let migrated_version = Store::open(&path).unwrap();
        assert!(migrated_version.list_netmon_snapshots(10).unwrap().len() == 1);
    }

    #[test]
    fn quarantine_records_are_auditable() {
        let store = Store::open_in_memory().unwrap();
        let record = store
            .insert_quarantine(&NewQuarantine {
                item_id: "item-1".to_string(),
                file_name: "eicar.com".to_string(),
                original_path: r"C:\tmp\eicar.com".to_string(),
                stored_path: r"C:\vault\item-1.cbsq".to_string(),
                sha256: "deadbeef".to_string(),
                size_bytes: 68,
                threat_name: "Win.Test.EICAR_HDB-1".to_string(),
                source_scan_id: None,
            })
            .unwrap();
        assert_eq!(record.status, QuarantineStatus::Active);

        store.mark_quarantine_restored(record.id).unwrap();
        let restored = store.list_quarantine().unwrap();
        assert_eq!(restored[0].status, QuarantineStatus::Restored);
        assert!(restored[0].restored_at.is_some());

        assert!(store.mark_quarantine_restored(record.id).is_err());
    }

    #[test]
    fn settings_are_upserted() {
        let store = Store::open_in_memory().unwrap();
        store.set_setting("theme", "dark").unwrap();
        store.set_setting("theme", "light").unwrap();
        assert_eq!(store.setting("theme").unwrap().as_deref(), Some("light"));
        assert_eq!(store.settings().unwrap().len(), 1);
    }
}
