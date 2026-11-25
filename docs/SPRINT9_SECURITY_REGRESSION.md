# Sprint 9.1 — Security regression

**Version:** 0.9.0-dev · No host security configuration was modified.

## 1. Controls revalidated (code + build)

| Control | Evidence |
|---|---|
| Microsoft Defender | Enabled throughout; no exclusion added; EICAR test confirms Defender still blocks suspicious reads (error 225) |
| Windows Firewall | Untouched; no rule added or modified |
| No real malware samples | Only the standard EICAR test string (harmless, universally recognized) was used; deleted immediately |
| No system-wide DNS changes | Web Guard remains loopback-only; system DNS untouched |
| No unauthorized Firewall rule modifications | None |
| No host network security changes | None |
| Tauri command permissions | Reviewed; new commands `proactive_set_auto_scan`, `proactive_scan_status` take only a boolean; no path input accepted from the UI for the worker |
| Path handling | Worker scans only paths drained from the monitor's already-canonicalized queue |
| External process invocation | Reuses the validated `Scanner` (same engine path as manual scans); no new process spawning logic |
| Quarantine isolation | Untouched; worker never calls quarantine |
| Sensitive log storage | Scan reports go through the existing `store.save_scan` (same as manual scans); no new secret material |
| Installer integrity | SHA-256 recorded; Authenticode status documented as NotSigned (no cert available) |

## 2. New code review notes

- `proactive_worker.rs` holds no persistent state of its own; all coordination
  goes through `AppState.auto_scan` (mutex-guarded) and the settings store.
- The worker cannot start without persisted consent AND a working engine.
- No automatic deletion or quarantine; detections are reported only.
- The generation counter prevents stale workers from racing a re-enabled one.

## 3. Residual risks

1. Automated analysis of the queue is opt-in but once enabled it runs without
   per-batch confirmation; the consent switch + banner make this explicit.
2. Scan reports from the worker appear in the normal scan history, which is
   local SQLite — same confidentiality profile as manual scans.
3. Host Defender blocked the EICAR fixture, so notification text for a real
   detection could not be observed live; the code path is reviewed only.
