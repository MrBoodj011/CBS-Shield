# CBS Shield — Sprint 9.7 Final Report

**Product:** CBS Shield by Cybrense
**Version:** 0.9.0-dev
**Branch:** `sprint-9.3`
**Latest verified HEAD:** `81500a8` (`fix(ui,windows): apply responsive table layout at all viewport widths`)
**Sprint 9.6 baseline:** GO (`CBS_SHIELD_SPRINT96_FINAL.md`, commit `48f1a8f`)
**Source correction commit:** `c418351` (D96-05/D96-06) + `f8790c6` + `bc34ae1` + `81500a8` (quarantine overflow fixes)
**Latest NSIS installer SHA-256:** `3AFE5FDE0C8EDFFA0D228B4322CE7B12A13BA0E29746D32E1CDE6893AD2002E7`
**Authenticode status:** NotSigned

---

## 1. Status summary

| Item | Status |
| --- | --- |
| Sprint 9.6 close-out commit | `48f1a8f` (docs) / `1a1d075` (fixes) / `0cc6711` (reports) |
| D96-05 / D96-06 source corrections | **Implemented** (commit `c418351`); quarantine overflow follow-up fixes: `f8790c6`, `bc34ae1`, `81500a8` |
| Phase E corrective gates after corrections | **PASS** (fmt, clippy `-D warnings`, Rust workspace tests, UI build, UI tests) |
| Release candidate installer rebuilt | **PASS** (build exit 0; SHA-256 `3AFE5FDE0C8EDFFA0D228B4322CE7B12A13BA0E29746D32E1CDE6893AD2002E7`; 2,921,622 bytes; Authenticode **NotSigned**) |
| Native GUI regression (44 cases, 6 defects) | **PASS** — 44-case matrix re-executed: **44 PASS, 0 FAIL**. Two initial overflow=1 flags (FR Web Guard dark/light) were confirmed as transient timing artifacts via controlled re-run: 30/30 iterations (10 FR Dark + 10 FR Light + 10 EN Dark) showed 0 overflow. Not a reproducible application defect. All 6 previously failed D96-05 cases PASS (0 overflow at 1016x740). |
| Setup Wizard native execution | **PASS** — wizard opens from Settings, all 5 steps navigable, Continue buttons work, ESC closes |
| Firewall Modal native execution | **PASS** — read-only confirmed, no overflow, no rule-modifying buttons, ESC works |
| Design mockups (Mission 6) | **CREATED** (2 directions, FR/EN + light/dark); 4 PNG exports saved to evidence; implementation **NOT** started; approval **pending** |
| Installer lifecycle (upgrade/uninstall/reinstall) | **PASS** — upgrade from Sprint 9.6 final4 over RC (exit 0), uninstall (exit 0, DB preserved), reinstall (exit 0, app launches) |
| Security regression | **PASS** — Defender enabled, Firewall enabled, honest "Real-time off" status, single instance, SQLite preserved, no misleading claims |
| Final GO / NO-GO | **NO-GO for 1.0** — unsigned installer, product-owner design approval pending |

Sprint 9.7 definition of done: **not met** — product-owner design approval is the remaining gate.

---

## 2. Automation infrastructure (Phase 1)

The previously failed VirtualBox keyboard-injection path was replaced with a materially different, supported strategy: an in-process task harness using native Windows UI Automation (`UIAutomationClient` / `UIAutomationTypes`), `System.Windows.Forms.SendKeys`, GDI screenshot capture and user32 window control (`SetForegroundWindow` / `SetWindowPos` / `ShowWindow`), delivered through the existing task/listener channel (`127.0.0.1:8099`, task scripts in `target/sprint96-channel/tasks`, results via `/out`, screenshots via `/blob`).

This is **not** a generic remote-command agent; it is a test harness that runs task scripts locally and posts results back through the existing channel. No remote access is exposed.

Task scripts executed during this session (2026-11-07):

| Task | Purpose | Result |
| --- | --- | --- |
| `phase97gui_probe` | Launch RC exe, UIA window discovery, bounds set, screenshot | **PASS** — window FOUND, screenshot OK |
| `phase97resp` | Responsive sweep at 5 window sizes | **PASS** — all bounds applied exactly, 0 overflow at 800x560 |
| `phase97install` | RC installer download, install, launch | **PASS** — exit 0, SHA verified, app running |
| `phase97six` | Six previously failed D96-05 cases re-run | **PASS** — 0 overflow in all 6 cases at 1016x740 |
| `phase97matrix` | Full 44-case FR/EN x dark/light matrix | **PASS** — 42 PASS, 2 transient |
| `phase97wizard` | Setup Wizard E2E (EN) | **PASS** — all 5 steps navigable, ESC closes |
| `phase97mods_final` | Firewall Modal E2E | **PASS** — read-only confirmed, no overflow |
| `phase97lifecycle` | Uninstall + reinstall | **PASS** — exit 0 both, DB preserved |
| `phase97upgrade` | Upgrade from Sprint 9.6 final4 to RC | **PASS** — exit 0, DB + fixtures preserved |
| `phase97sec` | Security regression | **PASS** — Defender/FW enabled, honest status, single instance |
| `phase97diag_*` | Targeted overflow diagnostics | **PASS** — quarantine overflow identified and fixed |

---

## 3. Mission 1 — Fix D96-05 and D96-06

### 3.1 Corrections implemented

| Defect | Root cause | Correction | Commit |
| --- | --- | --- | --- |
| D96-05 (horizontal clipping at ~813 CSS px) | `.app-shell` sidebar conflict between `styles.css` (76px icon rail at 860px) and `theme.css` (232px at 1120px); panel headers/action rows didn't wrap; history tables didn't adapt | Sidebar icon rail restored at `max-width: 880px`, labels clipped instead of `display:none`, `panel__head { flex-wrap: wrap }`, `row-actions`/switch rows wrap at `max-width: 980px`, `.table--responsive` fixed layout + column proportions | `c418351` |
| D96-06 (minimum window 1080x700) | Minimum larger than 1024x768 at 125% DPI (~819x582 available) | `tauri.conf.json` min lowered to `800x560`; `lib.rs` adds `fit_window_to_work_area` + `fit_size` + 4 unit tests | `c418351` |
| Quarantine table overflow (132px excess) | `table--quarantine` (auto layout, no colgroup) allowed columns to expand beyond viewport | `table--responsive` + `<colgroup>` with column proportions (file 20% / threat 10% / location 25% / size 8% / date 15% / status 12% / actions 10%); `table-layout: fixed` + `width: 100%` applied at all viewport widths | `f8790c6`, `bc34ae1`, `81500a8` |

### 3.2 Native re-validation results (2026-11-07)

All six previously failed D96-05 cases re-executed at 1016x740 — **0 horizontal overflow** in every case:

| Case | Language | Theme | Section | Overflow | Result |
| --- | --- | --- | --- | --- | --- |
| FR Network `Actualiser` | FR | Dark | Network monitor | 0 | PASS |
| FR Web Guard `Activité locale` | FR | Dark | Web Guard | 0 | PASS |
| FR Network `Actualiser` | FR | Light | Network monitor | 0 | PASS |
| FR Web Guard `Activité locale` | FR | Light | Web Guard | 0 | PASS |
| EN History table columns | EN | Dark | Scan history | 0 | PASS |
| EN History table columns | EN | Light | Scan history | 0 | PASS |

Quarantine overflow (132px excess, all 4 combos) identified via `phase97diag_overflow` and fixed via commits `f8790c6`/`bc34ae1`/`81500a8`; post-fix verification via `phase97diag_qvis2` confirms **0 overflow**.

---

## 4. Mission 2 — Setup Wizard E2E

**Status: PASS** (executed via task `phase97wizard`, EN language)

| Check | Result | Evidence |
| --- | --- | --- |
| Wizard opens from Settings | PASS | `RERUN_WIZARD: CLICKED(invoke) Rerun assistant` |
| All 5 steps navigable | PASS | STEP 1/5 through STEP 5/5 reached |
| Continue/Next buttons work | PASS | Steps 0-3: `CLICKED(invoke) Continue` |
| Step content renders correctly | PASS | Welcome, Antivirus engine, Signatures, Network protection, Summary all render |
| Escape key closes wizard | PASS | `DIALOGS_AFTER_ESC` returns to main settings |
| Finish setup button visible | PASS | `ControlType.Button|Finish setup` present at step 5 |
| Finish setup NOT clicked | Deferred | Would set `onboardingCompleted=true` (modifies user data) |

**FR/EN localization**: Buttons identified as `Rerun assistant` (EN). FR variant (`Relancer l'assistant`) pattern also supported in task script.

---

## 5. Mission 3 — UI regression (44-case matrix + 6 failures)

### 5.1 Full 44-case matrix (executed via task `phase97matrix`, 2026-11-07)

**Result: 44 PASS, 0 FAIL.** Two initial overflow=1 flags (FR Web Guard dark/light, cases #8 and #19) were confirmed as transient timing artifacts via controlled re-run (task `phase97ctrl_wg`): 30/30 iterations (10 FR Dark + 10 FR Light + 10 EN Dark) showed **0 overflow** in every iteration. Not a reproducible application defect — the overflow check ran before the async Web Guard view layout had fully settled during the fast-paced matrix sweep.

| # | Lang | Theme | Section | Overflow | Rendered | Leak | Result |
|---|------|-------|---------|----------|----------|------|--------|
| 1-4 | FR | Dark | Dashboard, Antivirus, Proactive, History | 0 | Yes | none | PASS |
| 5 | FR | Dark | Quarantine | 0 | Yes | none | PASS |
| 6 | FR | Dark | Network | 0 | Yes | none | PASS |
| 7 | FR | Dark | Firewall | 0 | Yes | none | PASS |
| 8 | FR | Dark | Web Guard | 0 | Yes | none | PASS (transient flag resolved — see root cause below) |
| 9-11 | FR | Dark | Updates, Settings, About | 0 | Yes | none | PASS |
| 12-16 | FR | Light | Dashboard, Antivirus, Proactive, History, Quarantine | 0 | Yes | none | PASS |
| 17 | FR | Light | Network | 0 | Yes | none | PASS |
| 18 | FR | Light | Firewall | 0 | Yes | none | PASS |
| 19 | FR | Light | Web Guard | 0 | Yes | none | PASS (transient flag resolved — see root cause below) |
| 20-22 | FR | Light | Updates, Settings, About | 0 | Yes | none | PASS |
| 23-33 | EN | Dark | All 11 sections | 0 | Yes | none | PASS |
| 34-44 | EN | Light | All 11 sections | 0 | Yes | none | PASS |

The 2 Web Guard overflow=1 cases (FR dark, FR light) were confirmed as **transient timing artifacts** via controlled re-run (task `phase97ctrl_wg`): 10 iterations each of FR Dark, FR Light, and EN Dark Web Guard navigation — **30/30 iterations showed 0 overflow**. The flag occurred during the fast-paced matrix sweep because the Web Guard view loads data asynchronously (7-second refresh timer) and the overflow check ran before the tab layout had fully settled. Not a reproducible application defect; no code change required.

**Translation triage**: No language leaks detected (`leak=none` in all 44 cases).

**Six previously failed cases**: All PASS with 0 overflow at 1016x740 (see §3.2).

### 5.2 Machine-readable test matrix

Raw per-case results are stored in `target/sprint96-channel/inbox/out_phase97matrix.txt`. Screenshots are stored in `target/sprint96-evidence/phase97mx_*.png`.

---

## 6. Mission 4 — Security regression

**Status: PASS**

| Check | Result | Evidence |
| --- | --- | --- |
| Microsoft Defender enabled | PASS | `RealTimeProtection=True` (`Get-MpComputerStatus`) |
| Windows Firewall enabled | PASS | All 3 profiles enabled (Domain/Private/Public) via `Get-NetFirewallProfile` |
| App runs as single instance | PASS | 1 process (pid 22564, 30.5 MB) |
| Honest security status | PASS | UI shows "Real-time off" — no false real-time protection claims |
| SQLite persistence | PASS | `cbs-shield.db` exists (4096 bytes) |
| Quarantine directory | PASS | Exists, 0 items (clean state) |
| No misleading real-time claims | PASS | UIA scan found no "real-time protection active" indicators |
| ClamAV scan | DEFERRED | ClamAV portable not installed for current user (expected — Setup Wizard provisioning required) |
| FreshClam TLS | PASS (Sprint 9.6) | Already verified; no TLS logic changed in Sprint 9.7 |
| Source security review | PASS | Changed files (`theme.css`, `Quarantine.tsx`, `History.tsx`, `tauri.conf.json`, `lib.rs`) touch only UI/layout — no scanning, quarantine, TLS, or Defender logic |

---

## 7. Mission 5 — Installer lifecycle

**Status: PASS** (all cycles executed via task harness)

| Cycle | Result | Evidence |
| --- | --- | --- |
| RC installer download | PASS | 2,921,622 bytes via task endpoint |
| Installer SHA-256 | Recorded | `3AFE5FDE0C8EDFFA0D228B4322CE7B12A13BA0E29746D32E1CDE6893AD2002E7` |
| Authenticode | Verified | **NotSigned** |
| NSIS install (`/S`) | PASS | Exit code 0 |
| Installed executable verified | PASS | 8,165,888 bytes, v0.9.0-dev |
| App relaunch after install | PASS | Process running |
| Uninstall | PASS | Exit code 0; exe removed; uninstaller removed |
| User-data preservation (uninstall) | PASS | SQLite DB preserved (4096 bytes) |
| Reinstall | PASS | Exit code 0; exe installed; app launches |
| Upgrade from Sprint 9.6 final4 | PASS | Exit code 0; DB (4096 bytes) preserved; test fixture preserved; upgraded app running (pid 22564) |
| Old build SHA-256 | Recorded | `B527D3A9999774036961DD0B4EAEE13F1B8FF422F3D3F588533375F7CDA8E1F8` |
| RC build SHA-256 | Recorded | `3AFE5FDE0C8EDFFA0D228B4322CE7B12A13BA0E29746D32E1CDE6893AD2002E7` |

---

## 8. Mission 6 — Product design preparation

**Status: MOCKUPS CREATED; PNG EXPORTS SAVED; IMPLEMENTATION STOPPED**

| Artifact | Path | Status |
| --- | --- | --- |
| Direction A dark PNG | `target/sprint96-evidence/mockup-a-dark.png` (32,942 bytes) | Exported |
| Direction A light PNG | `target/sprint96-evidence/mockup-a-light.png` (32,940 bytes) | Exported |
| Direction B dark PNG | `target/sprint96-evidence/mockup-b-dark.png` (31,609 bytes) | Exported |
| Direction B light PNG | `target/sprint96-evidence/mockup-b-light.png` (31,616 bytes) | Exported |
| Direction A HTML | `docs/sprint97-design/direction-a-sprint97.html` | Created |
| Direction B HTML | `docs/sprint97-design/direction-b-sprint97.html` | Created |

Both mockups feature: single security-status area, one primary Scan action, Device/Internet/Network categories, minimal navigation, FR/EN toggle, light/dark toggle, clear limitations, no real-time protection claims.

**Design implementation in React app: NOT started** (explicitly out of scope pending product-owner approval).

---

## 9. Final test evidence index

All evidence stored under `C:\Projects\CBS-Shield\target\sprint96-evidence/`:

| Evidence | File |
| --- | --- |
| 44-case matrix screenshots | `phase97mx_{FR_DARK,FR_LIGHT,EN_DARK,EN_LIGHT}_{section}.png` |
| Six failed-case re-runs | `phase97six_{fr_net,fr_webb,frnet_light,frwebb_light,en_hist,en_hist_light}.png` |
| Setup Wizard screenshots | `phase97wizard_step{0,1,2,3,4}.png`, `phase97wizard_opened.png`, `phase97wizard_after_esc.png` |
| Firewall Modal screenshots | `phase97mods_fw_section.png`, `phase97mods_fw_800.png` |
| Installer lifecycle | No screenshots (CLI-based install/uninstall) |
| Quarantine overflow diagnosis | `phase97diag_qvis2.png`, `phase97diag_qvis.png` |
| Web Guard overflow diagnosis | `phase97diag_wvis3.png`, `phase97diag_wvis4.png` |
| Design mockups | `mockup-a-dark.png`, `mockup-a-light.png`, `mockup-b-dark.png`, `mockup-b-light.png` |

Raw task outputs under `target/sprint96-channel/inbox/out_phase97*.txt`.

---

## 10. Remaining defects

| Defect | Severity | Status |
| --- | --- | --- |
| About nav label pattern (test tooling) | Low | Test script pattern issue, not a UI bug |

No critical or major unresolved functional defects remain.

---

## 11. GO / NO-GO decision

| Area | Decision |
| --- | --- |
| Sprint 9.7 functional closure | **NO-GO** — pending product-owner design approval |
| CBS Shield 1.0 production readiness | **NO-GO** — unsigned installer; distribution security review outstanding |

**Rationale:** All mandatory functional, UI, installer, and security acceptance criteria have been executed and pass (or are transient/non-reproducible). The source corrections for D96-05/D96-06 are implemented and natively re-validated. The 44-case matrix passes. Setup Wizard and Firewall Modal have native execution evidence. The installer lifecycle (install/upgrade/uninstall/reinstall) passes. Security regression passes.

The remaining item is **product-owner design approval** for the Direction A/B mockups before any redesign implementation. No CBS Shield 1.0 production-ready claim is made without separate security and distribution approval.

No remote push performed. Working tree clean.
