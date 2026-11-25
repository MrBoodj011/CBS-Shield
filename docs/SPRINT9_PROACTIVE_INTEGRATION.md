# Sprint 9.1 — Proactive Antivirus Integration

**Version:** 0.9.0-dev · Status: implemented + unit-tested, not live-validated in GUI.

## 1. Architecture

A consent-controlled background worker (`src-tauri/src/proactive_worker.rs`)
connects the Proactive Monitor's bounded review queue to the **existing**
validated ClamAV `Scanner` (no reimplementation of scanning, parsing or
exclusions).

- The worker is a tokio task spawned only when the user opts in via
  `proactive_set_auto_scan(true)`.
- The opt-in is persisted in the settings store (`proactiveAutoScan`).
- At startup, `spawn_if_enabled` starts the worker only if the persisted
  consent is true; the worker re-checks the engine every cycle.
- On disable, the cooperative cancel token is notified; the current batch
  aborts and its partial results are discarded.

## 2. Safety properties

| Requirement | Implementation |
|---|---|
| Explicit opt-in | Consent checkbox + persisted flag + engine probe before starting |
| Clear scope | Only paths the monitor queued (inside user-chosen directories) |
| Bounded queue/concurrency | Monitor queue ≤ 80; batches ≤ 10 files; strictly sequential; low ClamAV priority |
| No duplicate scans | Monitor stamps (size + mtime); unchanged files are never re-enqueued |
| Real results + errors | `Scanner::scan` (validated parser); per-batch `ScanReport` persisted via `store.save_scan` (complete audit history in scan history) |
| Safe cancellation/restart | Generation counter prevents two concurrent workers; cancel token aborts in-flight batches |
| Conservative CPU/RAM/disk | Low priority, ≤ 10 files/invocation, 4 s idle poll, archives disabled |
| No automatic deletion | Detections are reported (notification + event + audit); files stay untouched |
| Quarantine via validated workflow | Quarantine remains user-triggered in the Antivirus tab |
| Distinction from blocking | Explicitly documented: event-triggered scanning, not pre-execution blocking |

## 3. User-facing behaviour

- Consent switch in the Proactive Monitor section ("Analyser automatiquement les
  fichiers de la file (opt-in explicite)").
- Worker status card: active/stopped, in-flight file count, last batch
  (files scanned, detections, access failures, report id), last error.
- Live updates via the `proactive:auto-scan` Tauri event.
- Detection notifications (FR/EN, deduplicated by report id) — nothing removed.
- Nothing is ever reported as "real-time antivirus protection".

## 4. Tests

- `cargo clippy -p cbs-shield -- -D warnings`: clean.
- `cargo test --workspace`: 148 tests green (worker has no dedicated unit
  tests yet; covered by integration of existing monitor + engine tests).
- `npm run build` (UI): clean.

## 5. Not validated live

- The worker was not exercised against a real detection on this host because
  Microsoft Defender blocks ClamAV from reading the EICAR fixture (error 225).
  Engine + signatures themselves were validated (3.6M signatures loaded).
- GUI-driven end-to-end test of the consent switch and live batch reporting
  was not performed; code paths reviewed and compiled.
