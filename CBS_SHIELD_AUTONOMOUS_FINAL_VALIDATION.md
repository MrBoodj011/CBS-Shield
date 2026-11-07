# CBS Shield — Autonomous Final Validation Report

**Product:** CBS Shield by Cybrense
**Version:** 0.9.0-dev
**Branch:** `sprint-9.3`
**Latest verified HEAD:** `b610c4a` (`docs: sprint 9.7 final report, design mockups direction a/b, D96-05/06 correction record`)
**Source fix commit (Mission 1 corrections):** `c418351` (`fix(ui,windows): support 813px narrow windows and lower justified minimum to 800x560`)
**Latest NSIS installer SHA-256:** `668BAE31210D33E19DE1ECC2962309F743D6432F0444E3051A98F5CD1150B341`
**Authenticode status:** NotSigned
**Report period:** 2026-11-07 (autonomous final acceptance execution window)

---

## 1. Actual Git HEAD and branch

- Branch: `sprint-9.3`
- HEAD: `b610c4a` — full hash `b610c4a72598ceda02c1f1e4a5e75817b35a371c`
- History: `48f1a8f` (Sprint 9.6 final report) → `1a1d075` / `0cc6711` → `c418351` (D96-05/06 corrections) → `b610c4a` (Sprint 9.7 final report + design mockups)
- Working tree: clean (no pending changes at time of report; task artifacts under `target/` are git-ignored)
- No remote push performed during this validation window.

## 2. Exact source commit tested

- Source commit under test for GUI execution and installer artifacts: `c418351` (Mission 1 corrective source: responsive CSS, History table `table--responsive`, sidebar icon rail, `tauri.conf.json` min window 800x560, `lib.rs` window-fit logic + tests).
- Release candidate installer under test: `CBS Shield_0.9.0-dev_x64-setup.exe`
  - Size: 2,920,878 bytes
  - SHA-256: `668BAE31210D33E19DE1ECC2962309F743D6432F0444E3051A98F5CD1150B341`
  - Authenticode: **NotSigned**
  - Built from source commit `c418351` (frontend + Rust release build).
- Installed RC executable (post-install, produced during this session): `C:\Users\adjar\AppData\Local\CBS Shield\cbs-shield.exe`
  - Size: 8,165,888 bytes
  - Version: 0.9.0-dev
  - SHA-256: `05891D660F4CD1E101675264C53D5B8ECFADA3FC50FB63FEDB30879ECB16AF6B`

## 3. Automation framework implemented / selected

- **Approach selected:** in-process task-script harness using native Windows UI Automation (`UIAutomationClient` / `UIAutomationTypes`), `System.Windows.Forms.SendKeys`, GDI screenshot capture (`System.Drawing`), and user32 P/Invoke (`SetForegroundWindow` / `SetWindowPos` / `ShowWindow`), delivered through the existing task channel (HttpListener at `127.0.0.1:8099`, task scripts under `target/sprint96-channel/tasks`, results via `/out/<task>`, screenshots via `/blob/<name>.png` to `target/sprint96-evidence`).
- This is a materially different strategy from the abandoned `VBoxManage controlvm keyboardputscancode|keyboardputstring` injection path and is an established native Windows automation mechanism (UIA + input simulation).
- Task scripts executed during this session:
  - `phase97probe.ps1` — environment probe (posted `out_phase97probe`).
  - `phase97gui_probe.ps1` — app launch from RC exe, UIA window discovery, bounds set, GDI screenshot, posted `out_phase97gui_probe`, blob `phase97gui_probe.png`.
  - `phase97resp.ps1` — responsive window sweep (800x560, 813x600, 1024x768, 1366x768, 1920x1080), per-size bounds + overflow flags, GDI screenshots, posted `out_phase97resp`, blobs `phase97resp_*.png`.
  - `phase97install.ps1` — RC installer download via task endpoint, install `/S`, hashes, installed-exe checks, DB file checks, app relaunch, posted `out_phase97install`.
  - `phase97mods.ps1` — firewall nav click, dialog enumeration, GDI screenshots, SendKeys ESC, posted `out_phase97mods`, blobs `phase97mods_*.png`.

## 4. GUI tests actually executed (this session, 2026-11-07)

| Task | Result |
| --- | --- |
| `phase97probe` | Listener/task channel healthy (`/task/...` GET OK via `127.0.0.1:8099`; POST `/out/...` OK). |
| `phase97gui_probe` | App started from RC exe (pid 11148). UIA window `Tauri Window` **FOUND**. Window bounds set to 1016x740. GDI screenshot OK (95,911 bytes). Posted OK. |
| `phase97resp` | All five required window sizes applied via UIA `SetWindowPos`; after-bounds confirmed exact sizes; GDI screenshots OK for each size; overflow flags computed. |
| `phase97install` | RC installer downloaded (2,920,878 bytes) via task endpoint; SHA-256 `668B…B341`; Authenticode **NotSigned**; NSIS install exit code 0; installed exe verified (8,165,888 bytes, v0.9.0-dev); DB files checked; app relaunched (pid 28416) and running. |
| `phase97mods` | Window `FOUND` (pid 28416); clicked nav item `Pare-feu`; screenshot OK (337,952 bytes); post-ESC screenshot OK. |

## 5. Full 44-case UI matrix

- **NOT EXECUTED in this session** as a fresh consolidated run.
- Prior matrix evidence artifacts exist from the same sprint day (task outputs `inbox/out_matrix_{fr,en}_{dark,light}.txt` and screenshots under `target/sprint96-evidence/mx_*`), produced before the latest RC build window; per instruction, earlier evidence is not reused as proof for the current build.
- Status: **NOT EXECUTED** (BLOCKED prior to task-harness repair; task harness now operational, full matrix execution remains outstanding).

## 6. Responsive-test results

- Executed via task `phase97resp` against the RC application:
  - `800x560` → window bounds applied exactly; `OVERFLOW_COUNT 0` (no flagged overflow at minimum size).
  - `813x600` (≈813 CSS px) → window bounds applied exactly; flagged elements recorded (heuristic overflow list produced).
  - `1024x768` → applied exactly; overflow flags recorded (51).
  - `1366x768` → applied exactly; overflow flags recorded (54).
  - `1920x1080` → applied exactly; overflow flags recorded (70).
- GDI screenshots per size captured to `target/sprint96-evidence/phase97resp_*.png`.
- Conclusion: window sizing through the native automation path works at all required sizes; final defect verdict for D96-05 requires the six previously failed cases to be re-executed with conclusive evidence (in progress).

## 7. Setup Wizard results

- **NOT EXECUTED** in this session via task harness.
- Status: **NOT EXECUTED**.

## 8. Firewall Modal results

- Executed via task `phase97mods` on the running RC app (pid 28416):
  - Window found; navigation click on `Pare-feu` executed (`CLICKED Pare-feu`); post-click screenshot OK; ESC interaction executed; screenshots posted to evidence.
  - Dialog-state enumeration was inconclusive from the task side; visual/screenshot evidence captured.
- Status: **PARTIALLY EXECUTED / INCONCLUSIVE** for full keyboard-error-handling-close assertions; screenshot evidence captured.

## 9. Security regression results

- Source-level gates after Mission 1 corrections (`c418351`): `cargo fmt --check` PASS, `cargo clippy -D warnings` PASS, `cargo test --workspace` PASS, UI build PASS, UI tests 37/37 PASS — all re-run and green earlier in the sprint.
- Runtime security regression re-run against the freshly launched RC application in this session: **NOT FULLY EXECUTED** (defender/firewall/TLS/quarantine runtime checks outstanding).
- Status: **PENDING**.

## 10. Installer SHA-256 and lifecycle

- Installer SHA-256: `668BAE31210D33E19DE1ECC2962309F743D6432F0444E3051A98F5CD1150B341`
- Authenticode: **NotSigned**
- Lifecycle executed via task `phase97install` this session:
  - RC installer download: OK (2,920,878 bytes)
  - NSIS install (`/S`): exit 0
  - Installed exe present: True (8,165,888 bytes, v0.9.0-dev, SHA `05891D66F4CD1E101675264C53D5B8ECFADA3FC50FB63FEDB30879ECB16AF6B`)
  - DB files checked post-install; app relaunched and running (pid 28416).
- Upgrade/restart/persistence/uninstall/reinstall cycles for this RC: **NOT FULLY EXECUTED** in this session (earlier Sprint 9.6 installer artifacts must not be reused as proof for this build).

## 11. Real screenshot evidence index

Captured during this session via automated task harness (all under `C:\Projects\CBS-Shield\target\sprint96-evidence`):
- `phase97gui_probe.png` (95,911 bytes) — RC app window capture after bounds set.
- `phase97resp_800_560.png`, `phase97resp_813_600.png`, `phase97resp_1024_768.png`, `phase97resp_1366_768.png`, `phase97resp_1920_1080.png` — responsive sweep captures.
- `phase97mods_firewall.png`, `phase97mods_firewall_after_esc.png` (337,952 bytes each) — firewall interaction captures.

Pre-existing artifacts: `f3_*`, `d6_*`, `d9_*`, `d10_*`, `d11_*`, `d12_*`, `d13_*`, `mx_*`, installer/setup artifacts under `target/sprint96-evidence` and `target/sprint96-channel`.

## 12. Remaining defects

- D96-05 / D96-06 source corrections implemented at `c418351`; native re-validation pending conclusive six-failure re-run.
- Setup Wizard native execution pending.
- Full 44-case matrix re-run pending.
- Installer lifecycle re-run (upgrade/restart/persistence/uninstall/reinstall) pending for this RC.
- Design mockups pending product-owner approval (implementation not started).

## 13. Corrective changes implemented

- Responsive fixes (D96-05/D96-06): `ui/src/theme.css`, `ui/src/sections/History.tsx`, `src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs` — implemented at commit `c418351`; source gates green; RC installer rebuilt (SHA `668B…B341`, NotSigned).

## 14. Final Sprint 9.7 GO / NO-GO decision

- **Sprint 9.7 final closure: NO-GO** — mandatory acceptance criteria not fully satisfied at report time:
  - Responsive defect corrections implemented and source-verified; native conclusive re-validation pending.
  - Native Setup Wizard execution pending.
  - Native Firewall Modal full validation pending.
  - Full 44-case matrix re-run pending.
  - Rebuilt RC installer lifecycle re-run pending (install/launch executed this session).
  - Security regression re-run pending.
  - Design approval pending.

## 15. Remaining requirements for a production release

- Complete native acceptance per `CBS_SHIELD_SPRINT97_FINAL.md` and the Final Acceptance mission (Steps 1–7).
- Obtain product-owner approval on design directions A/B before any redesign implementation.
- Obtain separate security and distribution approval before any 1.0 production claim.
- Do not push remotely; commit locally with clean working tree.

---

**Blocker resolution note (2026-11-07):** the previously failed VirtualBox keyboard-injection path was set aside per mission instruction; a materially different supported automation strategy (task-script harness with native Windows UI Automation + GDI screenshots, served through the existing task/listener channel) was evaluated and brought online during this autonomous session; GUI automation now executes successfully end-to-end (window discovery, interaction, screenshot capture, installer lifecycle) producing real, posted evidence.
