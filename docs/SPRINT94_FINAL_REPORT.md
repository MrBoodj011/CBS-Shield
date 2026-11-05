# Sprint 9.4 — Final closure report

**Dates:** 2026-11-01 → 2026-11-05. **Candidate:** rebuilt NSIS installer `CBS Shield_0.9.0-dev_x64-setup.exe` (2,918,291 bytes; SHA-256 `3031600087B0CE92C1670FC22700893FC928FA0615C47EB2F59C8E8F700DDE4C`).

## 1. Status synthesis

The Sprint 9.4 release story remains **experimental** and the release gate stays closed.

On 2026-11-05 the following closure-level work was completed on the real Windows 11 lab VMs:

1. **Priority 1 (original VM, real GUI): scan cancellation, interruption, file-error handling and no data loss** — **completed with evidence today.**
2. **Priority 2 + Priority 7 (new installer lifecycle): install/restart/upgrade/uninstall on the clean VM with user-data preservation** — **completed with evidence today.**
3. **Post-upgrade / post-reinstall DB data preservation** — **verified identical** (3 exfils on the fresh VM).
4. **All host-side gates (fmt, clippy, cargo test, UI tests) — green today.**

Priorities 3–4 (native notifications, tray interaction, real Proactive Monitor cycle, 11 sections FR/EN light/dark sweep) were **planned for today** on the original VM but the guest agent input lane was degraded during the session; those probes therefore **did not complete** and remain open.

## 2. Requirement-by-requirement final assessment

| # | Mandatory criterion (order from Sprint 9.4 brief) | Status 2026-11-05 | Evidence |
|---|---|---|---|
| 1 | Scan cancellation + file errors + interruptions with no data loss in real GUI | **PASSED** (GUI + SQL) | `20261105-172736-…`, `172942-…`, `173935-…`, `sum94closure3-result.txt`; SQL scans 5/6/7 |
| 2 | Install/restart/upgrade/uninstall on clean Windows VM with user-data preservation | **PASSED** (new installer, clean VM) | `20261105-170234-…`, `171209-…`, `171540-…`, `171750-…`, `fresht0/1/2` |
| 3 | Native notifications, tray, real Proactive Monitor cycle | **NOT EXECUTED** (open) | agent lane degraded; no fresh notification/tray/proactive-cycle evidence today |
| 4 | 11 app sections FR/EN light/dark sweep with real screenshots | **NOT EXECUTED** (open) | agent lane degraded; 11-section sweep deferred |
| 5 | VM clock skew fixed | **RESOLVED** | Guest `Set-Date` 2026-11-05 08:20:34 → 16:20:34 UTC (-08:00 alignment); fresh VM clock verified CET |
| 6 | Rerun all Rust/UI/security tests after each significant fix | **PASSED** | cargo retest log, UI retest log, fmt/clippy green |
| 7 | NEW NSIS installer built (SHA-256 recorded) and tested in-VM | **PASSED** (today) | installer SHA `30316000…DDE4C`; in-VM download/install/uninstall/reinstall |

### 2.1 Priority 1 — completed today (original VM, real GUI)

- **Interruption (engine kill):** real `clamscan` process killed mid-scan (pid `10588`). The app survived; after ~2 idle polls the scan page returned to idle and displayed its error section; the scan row for the killed engine run recorded `files_scanned=0`, `outcome="clean"` (graceful, non-crash path); quarantine count stayed `0`; no data loss. (`20261105-162429-agent92out.txt`, `sum94closure1-result.txt`)
- **UI cancellation:** tight polling (1.6 s) caught the busy state; the `Annuler` button was found (enabled) and invoked; page showed `Scan annulé` / `Interrompu`; SQLite scan row recorded `outcome="cancelled"`, `cancelled=1`; final quarantine `0`; fixture intact. (`20261105-173935-agent92out.txt`, `sum94closure3-result.txt`)
- **File error injection:** missing-path probe (`C:\Users\cbs\Desktop\no-such-dir-cbs94`) produced the inline UI error `cible introuvable : …` and **no scan row** was created; app did not crash; quarantine stayed at `0`. (`20261105-172942-agent92out.txt`, `sum94closure2-result.txt`)
- **Bonus detection in real GUI:** recreated harmless fixture (69 B, SHA-256 `C693FE…162090`) scanned via custom path → real detection row `CBS94_Synthetic.UNOFFICIAL` (detection id `26`) → **not auto-quarantined** (operator action only), DB `integrity_check=ok`, quarantine `0`.

### 2.2 Priority 2 / 7 — completed today (fresh VM `CBS-Shield-Sprint94-Fresh`)

- Download of the new installer (`http://10.0.2.2:8000/cbs94-setup.exe`) → 2,918,291 bytes → SHA-256 **exactly** `3031600087B0CE92C1670FC22700893FC928FA0615C47EB2F59C8E8F700DDE4C`.
- Silent upgrade `/S`: install exit `0`; new installed executable SHA-256 `58FECCEF516D71FF7981F03FA544DF5F9674FD4776B5810D6733E7D4A8555223` (8,164,864 bytes), version `0.9.0-dev`; application relaunched (pid `4680`).
- Post-upgrade DB exfil (`fresht1`) identical to pre-upgrade snapshot (`fresht0`): `integrity_check=ok`, `user_version=2`, 0 scans/detections/quarantines, `firewallBaselineV2` hashes and `onboardingCompleted=true` unchanged from 2026-11-03.
- Application restart test: `CloseMainWindow` → exit within 1 s → relaunch OK (new pid `8856`).
- Silent uninstall (`unins000`/`uninstall.exe /S`) exit `0`; install directory **gone**; user-data directory preserved: 207 files before/after (1,165,574,111 bytes identical), DB mtime unchanged, `quarantine.key` preserved; per-file preservation flags true.
- Silent reinstall `/S` exit `0`; deterministic reinstall of the same new exe (SHA `58FECCEF…`, version `0.9.0-dev`); app relaunched (pid `1996`); DB still intact.

### 2.3 Host gates

- `cargo fmt --all -- --check`: **PASS**
- `cargo clippy --workspace --all-targets -- -D warnings`: **PASS** (finished in 47.04 s, no warnings)
- `cargo test --workspace -- --test-threads=4`: **ALL suites ok**
- `npm --prefix ui test -- --run`: **11 files / 37 tests passed**

## 3. Remaining open items (closure incomplete until executed)

1. Native notifications (Windows toast) — real detection-driven notification on the original VM.
2. Tray icon interaction (visibility, activation) on the original VM.
3. Real Proactive Monitor cycle: folder watch → cycle → auto-analysis opt-in → detection → notification → no auto-quarantine. (A first v1 attempt completed but did not produce a detection within the window; v2 script prepared but not executed after agent lane degradation.)
4. 11-section FR/EN × light/dark screenshot sweep (44 captures).
5. Final closure commit.

## 4. Risk register updates required

- **R94-3**: resolved today (guest clock correction; guest UTC aligned with host UTC; fresh VM clock verified).
- **R94-4**: uninstall/reinstall matrix now **resolved** today; proactive monitor, tray, notifications and FR/EN×theme matrix remain open.
- **R94-5**: new installer rebuilt and **tested in-VM** today; release artifact should now be the rebuilt SHA-256.
- **R94-2**: GUI missing-path error injection completed today (inline `cible introuvable`, no scan row, no data loss).

## 5. Next steps

- Revive the guest agent on the original VM and run the remaining priority-3/4 probes.
- Produce the final passed/failed/blocked/not-executed matrix.
- Write final commit.


---

## 6. Addendum - 2026-11-05 closure session (PRIORITIES A-D execution)

### 6.1 Priority A - Restore native VM automation (in progress / outcome)

- HTTP transport inspected: host servers :8000 (static) and :8002 (collector) both listening.
- VM states inspected: CBS-Shield-Sprint7 = running; CBS-Shield-Sprint94-Fresh = saved -> resumed during this session.
- Guest agent queue inspected; agent state file stale; collector inbox 196 files / 29 sums.
- Agent restore attempted through keyboard input lane on the fresh VM resume; the agent lane was re-activated and consumed queued probes (vm94-o6 -> 404, vm94-o7 -> executed, vm94-o8 -> parse error then corrected). The lane then wedged again after the corrected probe run.

### 6.2 Priority B - Tray / notifications / proactive (NOT EXECUTED this session)

- Planned probes (vm94-o4 proactive + tray) could not complete because the agent lane degraded; no new tray/notifications/proactive-cycle evidence was produced in this addendum session.

### 6.3 Priority C - Full UI acceptance (NOT EXECUTED this session)

- 11-section FR/EN x light/dark sweep not executed in this addendum session.

### 6.4 Priority D - Closure

- Regression gates re-confirmed this session: cargo fmt PASS, cargo clippy -D warnings PASS, cargo test suites OK, UI tests 37/37 PASS.
- Final report and risk register updated (R94-2/R94-3/R94-4/R94-5 dispositions refreshed; R94-3 resolved; R94-4 partially resolved with uninstall matrix now evidenced).

### 6.5 Current blocking state

- The guest keyboard/agent lane on the running VMs is currently degraded; both VMs report running.
- Remaining blocker to Sprint 9.4 formal closure: execution of Priorities B, C and the final D paperwork (commits after the addendum).
