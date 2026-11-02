# Sprint 9.4 — SQLite persistence

**Status:** installed-app insert/commit, restart/reopen, and integrity validated. No conclusion is based on WAL file size or timestamps.

## Method

The guest agent copied `cbs-shield.db`, `cbs-shield.db-wal`, and `cbs-shield.db-shm` while the app was running and sent the copies to the host collector. The files from `20261101-200230-db94beforep3*` were decoded together into `target/sprint94-validation/db-before-p3/` and opened with Python `sqlite3`. `PRAGMA integrity_check` returned `ok`, and `PRAGMA user_version` returned `2`. This is a read of committed SQLite frames, including the WAL, rather than a filesystem metadata inference.

The synthetic test identifier is `cbs94-qz-43eeae00.txt`, with source SHA-256 `C693FE3234B88300D9CEB0A44935BB8F87A4FB012D684B09A4D8C1C928162090`. The following are the relevant SQL results from the installed application:

```sql
SELECT id, uuid, files_scanned, infected_files, outcome, cancelled
FROM scans WHERE id = 3;
-- 3 | 5d9b8936-a8dd-4527-bec2-d59309191f86 | 1 | 1 | detected | 0

SELECT id, scan_id, file_path, threat_name, file_size, sha256
FROM detections WHERE id = 24;
-- 24 | 3 | \\?\C:\Users\cbs\Desktop\cbs94-qz-43eeae00.txt
-- CBS94_Synthetic.UNOFFICIAL | 69 | c693fe3234b88300d9ceb0a44935bb8f87a4fb012d684b09a4d8c1c928162090

SELECT item_id, file_name, sha256, size_bytes, status, restored_at
FROM quarantine WHERE item_id = '2aba2cf0-3af6-45ba-b74f-99ba4a1b93b2';
-- 2aba2cf0-3af6-45ba-b74f-99ba4a1b93b2 | cbs94-qz-43eeae00.txt
-- c693fe3234b88300d9ceb0a44935bb8f87a4fb012d684b09a4d8c1c928162090
-- 69 | restored | 2026-11-01T21:59:45Z

SELECT key FROM settings ORDER BY key;
-- firewallBaselineV2

PRAGMA integrity_check;
-- ok
```

The first wizard attempt had actually **closed** the wizard, so absence of `onboardingCompleted` in the first snapshot was expected. On 2026-11-01 the real five-step wizard was advanced and “Terminer la préparation” invoked (`target/sprint7-vm/inbox/20261101-200558-agent92out.txt`); the wizard disappeared. After a normal Windows restart, `target/sprint7-vm/inbox/20261101-201545-agent92out.txt` records `WIZARD_PRESENT=False`, the same installed executable hash, the fixture still present with the same SHA-256, and the database present.

The second guest snapshot `20261101-201713-db94afterreboot*` was decoded into `target/sprint94-validation/db-after-reboot/` and queried after app relaunch:

```sql
SELECT key, value FROM settings WHERE key = 'onboardingCompleted';
-- onboardingCompleted | true

SELECT item_id, status, sha256 FROM quarantine
WHERE file_name = 'cbs94-qz-43eeae00.txt';
-- 2aba2cf0-3af6-45ba-b74f-99ba4a1b93b2 | restored
-- c693fe3234b88300d9ceb0a44935bb8f87a4fb012d684b09a4d8c1c928162090

SELECT id, uuid, files_scanned, infected_files FROM scans WHERE id = 3;
-- 3 | 5d9b8936-a8dd-4527-bec2-d59309191f86 | 1 | 1

PRAGMA integrity_check;
-- ok
PRAGMA user_version;
-- 2
```

The row persisted across the full Windows restart and database reopen. The original scan and quarantine audit records remained readable. The before/after SQL queries show an actual committed insert and subsequent read.

After the second GUI scan and quarantine, snapshot `20261101-202745-db94afterp3*` was decoded into `target/sprint94-validation/db-after-p3/`:

```sql
SELECT id, uuid, files_scanned, infected_files, outcome
FROM scans WHERE id = 4;
-- 4 | 39f6934c-5b5c-4ff2-822f-7acadd293f4e | 1 | 1 | detected

SELECT id, scan_id, threat_name, sha256 FROM detections WHERE id = 25;
-- 25 | 4 | CBS94_Synthetic.UNOFFICIAL
-- c693fe3234b88300d9ceb0a44935bb8f87a4fb012d684b09a4d8c1c928162090

SELECT item_id, status, sha256 FROM quarantine
WHERE file_name = 'cbs94-qz-43eeae00.txt' ORDER BY id;
-- 2aba2cf0-3af6-45ba-b74f-99ba4a1b93b2 | restored | c693fe...2090
-- 67469744-b7ee-4046-87dd-e15f792cb1eb | active   | c693fe...2090

PRAGMA integrity_check;
-- ok
```

The two scans and two quarantine transitions have separate IDs and preserve the first audit row. The owner later approved purging the second encrypted blob, but the VM stalled before the native purge; no post-purge record is claimed.

## Independent store regression tests

`cargo test --workspace` passed 136 tests, including `crates/cbs-store/tests/persistence.rs` (4 passing): unique scan insert/commit, close/reopen/read, settings and quarantine metadata reopen, a second connection seeing committed rows, schema version, and `integrity_check=ok`. These isolated store tests verify transaction behavior; the guest SQL above verifies records created by the installed application.

## Remaining check

After the approved purge can be safely executed, capture a final snapshot and verify the second row transitions to `purged` while the first remains `restored`. The guest's reported UTC was approximately 7 hours 45 minutes ahead of host UTC after reboot, so guest event timestamps are **not** reliable as wall-clock evidence until its timezone/time configuration is corrected.
