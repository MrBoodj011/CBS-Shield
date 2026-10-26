//! Mission E validation tests executed against the real ClamAV binary.
//!
//! They extend `clamav_integration.rs` with the Sprint 2 scenarios:
//! - a large (multi-hundred files, recursive) directory scan using a local
//!   test signature database, so the test stays fast and malware-free;
//! - an inaccessible (exclusively locked) file, which must surface as a
//!   per-file scan error and a `completedWithErrors` outcome, never as a crash.
//!
//! Like the other integration tests they are skipped when ClamAV is absent.

#[cfg(windows)]
use std::os::windows::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use cbs_core::{detect_engine, ScanEvent, ScanOutcome, ScanRequest, Scanner};
use tokio::sync::Notify;

fn clamscan_path() -> Option<PathBuf> {
    let status = detect_engine(None, None, &[], 7);
    if status.installed {
        status.clamscan_path
    } else {
        eprintln!("ClamAV introuvable : test d'intégration ignoré.");
        None
    }
}

/// Local test signature database (benign marker only), same technique as the
/// Phase 1 integration tests, so a scan of hundreds of files takes seconds.
fn test_signature_db(dir: &std::path::Path) -> PathBuf {
    let database = dir.join("testdb");
    std::fs::create_dir(&database).unwrap();
    // The signature matches a benign marker, never real malware.
    std::fs::write(
        database.join("cbs-test.ndb"),
        "CBS-Shield-Test-Signature:0:*:4342535F534849454C445F42454E49474E5F54455354",
    )
    .unwrap();
    database
}

/// Mission E — large recursive directory (~200+ files, nested folders).
///
/// Verifies that the scanner handles volume and recursion without dropping
/// files (`files_scanned` must equal the number of regular files created) and
/// without errors.
#[tokio::test]
async fn scans_large_recursive_directory_completely() {
    let Some(clamscan) = clamscan_path() else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let database = test_signature_db(dir.path());
    // The scanned corpus lives in its own subfolder so the signature database
    // is never included in the scan itself.
    let corpus = dir.path().join("corpus");
    std::fs::create_dir(&corpus).unwrap();

    let mut expected = 0u64;
    // Root: 150 files, then 3 levels of nested folders with 30 files each.
    for index in 0..150 {
        let path = corpus.join(format!("root-file-{index:04}.txt"));
        std::fs::write(&path, format!("Texte de test inoffensif {index}.\n")).unwrap();
        expected += 1;
    }
    for folder in 0..3 {
        let sub = corpus.join(format!("sous-dossier-{folder}"));
        std::fs::create_dir(&sub).unwrap();
        for index in 0..30 {
            let path = sub.join(format!("nested-{folder}-{index:03}.txt"));
            std::fs::write(&path, format!("Contenu inoffensif n{folder}x{index}.\n")).unwrap();
            expected += 1;
        }
    }

    let events: Arc<Mutex<Vec<ScanEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let scanner = Scanner::new(clamscan).with_database_dir(Some(database));
    let request = ScanRequest {
        paths: vec![corpus],
        recursive: true,
        include_pua: false,
        ..ScanRequest::default()
    };

    let report = scanner
        .scan(
            "mission-e-volume",
            &request,
            move |event| sink.lock().unwrap().push(event),
            Arc::new(Notify::new()),
        )
        .await
        .expect("scan should complete");

    assert_eq!(report.outcome, ScanOutcome::Clean);
    assert_eq!(
        report.files_scanned, expected,
        "every regular file created must be scanned"
    );
    assert!(report.detections.is_empty());
    assert!(report.errors.is_empty(), "errors: {:?}", report.errors);
}

/// Mission E — inaccessible file. The test opens the file with no sharing
/// (`dwShareMode = 0`), which makes any read by another process fail with a
/// sharing violation until the handle is dropped.
#[cfg(windows)]
#[tokio::test]
async fn locked_file_reported_as_error_not_crash() {
    let Some(clamscan) = clamscan_path() else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let database = test_signature_db(dir.path());

    let locked_path = dir.path().join("locked.bin");
    std::fs::write(&locked_path, b"unreadable during the scan").unwrap();
    // Open with share mode 0: no other process may read it while held.
    let exclusive = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&locked_path)
        .unwrap();

    let scan_path = locked_path.clone();
    let scanner = Scanner::new(clamscan).with_database_dir(Some(database));
    let request = ScanRequest {
        paths: vec![scan_path],
        recursive: false,
        include_pua: false,
        ..ScanRequest::default()
    };

    let report = scanner
        .scan(
            "mission-e-locked",
            &request,
            |_| {},
            Arc::new(Notify::new()),
        )
        .await
        .expect("scan must finish, not crash");

    assert_eq!(report.outcome, ScanOutcome::CompletedWithErrors);
    assert!(
        report
            .errors
            .iter()
            .any(|error| error.path.contains("locked.bin")),
        "expected an error record for the locked file: {:?}",
        report.errors
    );
    assert_eq!(report.detections.len(), 0);
    assert_eq!(report.files_scanned, 0);

    drop(exclusive);
}
