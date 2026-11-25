//! Sprint 9.3 / A1 — SQLite persistence is proven end to end.
//!
//! The 9.2 VM report observed a WAL file whose size and mtime never changed and
//! concluded "no persistence". An unchanged WAL is not proof: a write can fail
//! before SQLite sees it, or the observed file can belong to another profile.
//! These tests write a uniquely identifiable record, close the connection the
//! way application shutdown does, reopen the database and read the exact row
//! back. They run against a real on-disk file, never `:memory:`.

use cbs_core::{Detection, ScanLimits, ScanOutcome, ScanReport};
use cbs_store::{NewQuarantine, QuarantineStatus, Store};
use rusqlite::Connection;

fn sample_report(uuid: &str, detections: Vec<Detection>) -> ScanReport {
    ScanReport {
        id: uuid.to_string(),
        started_at: "2026-10-30T10:00:00Z".to_string(),
        finished_at: "2026-10-30T10:00:05Z".to_string(),
        duration_ms: 5_000,
        targets: vec![r"C:\Users\cbs\Documents".to_string()],
        profile: "quick".to_string(),
        excluded: Vec::new(),
        indexed_files: Some(12),
        index_truncated: false,
        limits: ScanLimits::default(),
        files_scanned: 12,
        infected_files: detections.len() as u64,
        error_count: 0,
        detections,
        errors: Vec::new(),
        outcome: ScanOutcome::Detected,
        cancelled: false,
        engine_version: Some("ClamAV 1.5.4".to_string()),
        signature_version: Some("3 631 204".to_string()),
        summary: None,
        fatal_error: None,
    }
}

fn sample_detection() -> Detection {
    Detection {
        file_path: r"C:\Users\cbs\Documents\synthetic-fixture.txt".to_string(),
        threat_name: "CBS_Test_Synthetic".to_string(),
        file_size_bytes: Some(42),
        sha256: Some("a".repeat(64)),
    }
}

fn integrity_ok(path: &std::path::Path) -> bool {
    let connection = Connection::open(path).expect("open for integrity check");
    let result: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .expect("integrity_check");
    result == "ok"
}

#[test]
fn saved_scan_survives_close_and_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("cbs-shield.db");
    let uuid = format!("scan-{}", uuid::Uuid::new_v4());

    let record_id = {
        let store = Store::open(&db).unwrap();
        let id = store
            .save_scan(&sample_report(&uuid, vec![sample_detection()]))
            .unwrap();
        assert!(id > 0);
        id
        // `store` is dropped here: the connection closes exactly like a normal
        // application shutdown.
    };

    assert!(integrity_ok(&db));

    let store = Store::open(&db).unwrap();
    let scans = store.list_scans(10).unwrap();
    let saved = scans
        .iter()
        .find(|scan| scan.uuid == uuid)
        .expect("the scan written before the restart must still exist");
    assert_eq!(saved.id, record_id);
    assert_eq!(saved.files_scanned, 12);
    assert_eq!(saved.infected_files, 1);
    assert_eq!(saved.outcome, "detected");
    assert_eq!(saved.engine_version.as_deref(), Some("ClamAV 1.5.4"));
    assert_eq!(saved.targets, vec![r"C:\Users\cbs\Documents".to_string()]);

    let details = store.get_scan(record_id).unwrap().expect("details");
    assert_eq!(details.detections.len(), 1);
    assert_eq!(details.detections[0].threat_name, "CBS_Test_Synthetic");
    assert_eq!(details.detections[0].file_size_bytes, Some(42));
}

#[test]
fn settings_and_quarantine_metadata_survive_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("cbs-shield.db");
    let item_id = format!("item-{}", uuid::Uuid::new_v4());

    {
        let store = Store::open(&db).unwrap();
        store.set_setting("onboardingCompleted", "true").unwrap();
        store.set_setting("language", "fr").unwrap();
        store
            .insert_quarantine(&NewQuarantine {
                item_id: item_id.clone(),
                file_name: "synthetic-fixture.txt".to_string(),
                original_path: r"C:\Users\cbs\Documents\synthetic-fixture.txt".to_string(),
                stored_path: format!(r"C:\vault\{item_id}.cbsq"),
                sha256: "b".repeat(64),
                size_bytes: 42,
                threat_name: "CBS_Test_Synthetic".to_string(),
                source_scan_id: None,
            })
            .unwrap();
    }

    let store = Store::open(&db).unwrap();
    let settings = store.settings().unwrap();
    assert_eq!(
        settings.get("onboardingCompleted").map(String::as_str),
        Some("true")
    );
    assert_eq!(settings.get("language").map(String::as_str), Some("fr"));

    let items = store.list_quarantine().unwrap();
    let item = items
        .iter()
        .find(|entry| entry.item_id == item_id)
        .expect("quarantine row must survive a restart");
    assert_eq!(item.status, QuarantineStatus::Active);
    assert_eq!(item.sha256, "b".repeat(64));
}

#[test]
fn a_second_connection_sees_committed_rows_immediately() {
    // Simulates a second process (the missing single-instance guard, A5) that
    // reads the same database while the app holds its connection open. WAL
    // must expose committed data without requiring the first connection to
    // close.
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("cbs-shield.db");
    let uuid = format!("scan-{}", uuid::Uuid::new_v4());

    let store = Store::open(&db).unwrap();
    store.save_scan(&sample_report(&uuid, Vec::new())).unwrap();

    let reader = Connection::open(&db).unwrap();
    let count: i64 = reader
        .query_row(
            "SELECT COUNT(*) FROM scans WHERE uuid = ?1",
            [&uuid],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        count, 1,
        "committed rows must be visible to other connections"
    );

    let mode: String = reader
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .unwrap();
    assert_eq!(mode.to_ascii_lowercase(), "wal");
}

#[test]
fn reopening_keeps_a_single_schema_and_reports_the_version() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("cbs-shield.db");

    for _ in 0..3 {
        let store = Store::open(&db).unwrap();
        store.set_setting("probe", "1").unwrap();
    }

    let connection = Connection::open(&db).unwrap();
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert!(
        version >= 2,
        "schema version must be at least v2, got {version}"
    );

    let tables: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN
             ('scans','detections','quarantine','settings','netmon_snapshots')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(tables, 5);
    assert!(integrity_ok(&db));
}
