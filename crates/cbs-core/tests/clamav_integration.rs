//! Integration tests that execute the real ClamAV binary.
//!
//! They are skipped (with a message) when ClamAV is not installed, so the suite
//! stays green on machines without it. No malware is used:
//! - the detection test uses a local, clearly-named ClamAV test signature for a
//!   benign marker string;
//! - the clean test scans a harmless text file with the real signature database;
//! - the ignored EICAR test is a manual diagnostic and explains the Defender
//!   interference on Windows.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use cbs_core::{detect_engine, ScanEvent, ScanOutcome, ScanRequest, Scanner, SignatureState};
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

fn app_signature_db() -> Option<PathBuf> {
    let local = std::env::var_os("LOCALAPPDATA")?;
    let dir = PathBuf::from(local)
        .join("Cybrense")
        .join("CBS Shield")
        .join("clamav")
        .join("database");
    if cbs_core::engine::count_signature_files(&dir) > 0 {
        Some(dir)
    } else {
        eprintln!("Signatures ClamAV absentes : test d'intégration ignoré.");
        None
    }
}

#[test]
fn engine_probe_reports_signatures_from_the_local_database() {
    let Some(clamscan) = clamscan_path() else {
        return;
    };
    let Some(database) = app_signature_db() else {
        return;
    };

    let status = detect_engine(Some(clamscan), Some(database), &[], 7);
    assert!(status.installed);
    assert!(
        status.signature_version.is_some(),
        "signature version missing: {}",
        status.message
    );
    assert!(status.database_file_count >= 1);
    assert!(
        matches!(
            status.signature_state,
            SignatureState::UpToDate | SignatureState::Outdated
        ),
        "unexpected signature state: {:?} ({})",
        status.signature_state,
        status.message
    );
}

#[tokio::test]
async fn detects_benign_file_with_real_clamav_and_test_signature() {
    let Some(clamscan) = clamscan_path() else {
        return;
    };

    let dir = tempfile::tempdir().unwrap();
    let database = dir.path().join("testdb");
    std::fs::create_dir(&database).unwrap();
    // Target type 0 = any file, offset * = anywhere. The signature matches a
    // benign marker, not malware. ClamAV appends ".UNOFFICIAL" to local sigs.
    std::fs::write(
        database.join("cbs-test.ndb"),
        "CBS-Shield-Test-Signature:0:*:4342535F534849454C445F42454E49474E5F54455354",
    )
    .unwrap();
    let target = dir.path().join("benign.txt");
    std::fs::write(&target, b"prefix CBS_SHIELD_BENIGN_TEST suffix").unwrap();

    let events: Arc<Mutex<Vec<ScanEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink_events = events.clone();
    let scanner = Scanner::new(clamscan).with_database_dir(Some(database));
    let request = ScanRequest {
        paths: vec![target],
        recursive: false,
        include_pua: false,
    };

    let report = scanner
        .scan(
            "integration-test",
            &request,
            move |event| sink_events.lock().unwrap().push(event),
            Arc::new(Notify::new()),
        )
        .await
        .expect("scan should complete");

    assert_eq!(report.outcome, ScanOutcome::Detected);
    assert_eq!(report.infected_files, 1);
    assert_eq!(report.files_scanned, 1);
    assert!(report.errors.is_empty(), "errors: {:?}", report.errors);
    let detection = &report.detections[0];
    assert!(detection.threat_name.contains("CBS-Shield-Test-Signature"));
    assert!(detection.sha256.is_some());
    assert_eq!(detection.file_size_bytes, Some(36));

    let events = events.lock().unwrap();
    assert!(events
        .iter()
        .any(|event| matches!(event, ScanEvent::Started { .. })));
    assert!(events
        .iter()
        .any(|event| matches!(event, ScanEvent::Detection { .. })));
    assert!(events
        .iter()
        .any(|event| matches!(event, ScanEvent::Finished { .. })));
}

#[tokio::test]
async fn scans_a_harmless_file_clean_with_real_database() {
    let Some(clamscan) = clamscan_path() else {
        return;
    };
    let Some(database) = app_signature_db() else {
        return;
    };

    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("hello.txt");
    std::fs::write(
        &target,
        b"Bonjour depuis CBS Shield. Fichier totalement inoffensif.\n",
    )
    .unwrap();

    let scanner = Scanner::new(clamscan).with_database_dir(Some(database));
    let request = ScanRequest {
        paths: vec![target],
        recursive: false,
        include_pua: false,
    };

    let report = scanner
        .scan(
            "integration-clean",
            &request,
            |_| {},
            Arc::new(Notify::new()),
        )
        .await
        .expect("scan should complete");

    assert_eq!(report.outcome, ScanOutcome::Clean);
    assert!(report.files_scanned >= 1);
    assert!(report.detections.is_empty());
    assert_eq!(report.infected_files, 0);
}

/// Manual diagnostic only.
///
/// Run with: cargo test -p cbs-core --test clamav_integration -- --ignored eicar
///
/// On Windows with Defender real-time protection enabled, Defender blocks
/// ClamAV's read of the EICAR file (Win32 error 225). CBS Shield deliberately
/// does not disable Defender or add exclusions, so this test may fail on such a
/// machine; that is an environment limitation, not an engine failure.
#[tokio::test]
#[ignore = "manual EICAR diagnostic; may be blocked by Microsoft Defender"]
async fn eicar_manual_diagnostic() {
    let Some(clamscan) = clamscan_path() else {
        return;
    };
    let Some(database) = app_signature_db() else {
        return;
    };

    // EICAR bytes are decoded at runtime so the signature never appears as a
    // contiguous literal in the source or the test binary.
    let hex = "58354f2150254041505b345c505a58353428505e2937434329377d2445494341522d5354414e444152442d414e544956495255532d544553542d46494c452124482b482a";
    let bytes: Vec<u8> = (0..hex.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).unwrap())
        .collect();

    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("eicar-manual-test.com");
    std::fs::write(&target, &bytes).unwrap();

    let scanner = Scanner::new(clamscan).with_database_dir(Some(database));
    let request = ScanRequest {
        paths: vec![target],
        recursive: false,
        include_pua: false,
    };
    let report = scanner
        .scan(
            "integration-eicar",
            &request,
            |_| {},
            Arc::new(Notify::new()),
        )
        .await
        .expect("scan should complete");

    assert!(
        report
            .detections
            .iter()
            .any(|detection| detection.threat_name.contains("EICAR")),
        "expected EICAR detection, got {report:?}"
    );
}
