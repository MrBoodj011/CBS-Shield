# CBS Shield — Sprint 9.7 Final Report

**Product:** CBS Shield by Cybrense
**Version:** 0.9.0-dev
**Branch:** `sprint-9.3`
**Sprint 9.6 baseline:** GO (`CBS_SHIELD_SPRINT96_FINAL.md`, commit `48f1a8f`)
**Sprint 9.7 work start state:** HEAD `48f1a8f`, uncommitted Sprint 9.6 fixes `1a1d075`, docs `0cc6711`

---

## 1. Status summary

| Item | Status |
| --- | --- |
| Sprint 9.6 close-out commit | `48f1a8f` (docs) / `1a1d075` (fixes) / `0cc6711` (reports) |
| D96-05 / D96-06 source corrections | **Implemented** (commit `c418351`) |
| Phase E corrective gates after corrections | **PASS** (fmt, clippy `-D warnings`, Rust workspace tests, UI build, UI tests) |
| Release candidate installer rebuilt | **PASS** (build exit 0; SHA-256 `668BAE31210D33E19DE1ECC2962309F743D6432F0444E3051A98F5CD1150B341`; 2,920,878 bytes; Authenticode **NotSigned**) |
| Native GUI regression (44 cases, 6 defects) | **BLOCKED** — not re-executed (guest input channel unavailable) |
| Setup Wizard native execution | **NOT EXECUTED** (mission pending; guest input unavailable) |
| Firewall Modal native execution | **NOT EXECUTED** (mission pending; guest input unavailable) |
| Design mockups (Mission 6) | **CREATED** (2 directions, FR/EN + light/dark) — implementation **NOT** started; approval **pending** |
| Final GO / NO-GO | **NO-GO for 1.0** — unsigned installer, unresolved native evidence, design approval pending |

Sprint 9.7 definition of done: **not met** at the time of this report.

---

## 2. Mission 1 — Fix D96-05 and D96-06

### 2.1 Scope

- Narrow-window content clipping around ~813 CSS pixels.
- Minimum application window width.
- Responsive layout behaviour.
- Navigation accessibility on smaller screens.
- Modal positioning and overflow.
- French and English text expansion.
- Windows display scaling.

### 2.2 Corrections implemented (commit `c418351`)

| Defect | Root cause | Correction |
| --- | --- | --- |
| D96-05 (horizontal clipping) | `.app-shell` produced by `styles.css` collapsed the sidebar to a 76 px icon rail at `max-width: 860px`, but `theme.css` (loaded later) kept the sidebar at 232 px from its own `max-width: 1120px` query; at 1016 px physical / 125 % DPI (~813 CSS px) the 232 px rail left ~549 px for content, and panel headers / action rows did not wrap and history tables did not adapt. | `theme.css` overrides added at the end of the cascade: sidebar icon rail restored at `max-width: 880px` (later source order wins), labels clipped instead of `display:none` so accessible names survive, `panel__head { flex-wrap: wrap }`, `row-actions`/switch rows wrap at `max-width: 980px`, `.table--responsive` fixed layout + column proportions at `max-width: 980px`. History table marked responsive with `colgroup` (date/target/files/threats/duration/outcome/details). |
| D96-06 (minimum window width) | Declared minimum 1080 x 700 logical px, which is larger than a 1024 x 768 screen at 125 % Windows scaling (~819 x 582 logical px available). | `tauri.conf.json` minimum lowered to `minWidth: 800`, `minHeight: 560` (justified: 800 x 560 logical px still fits 1024 x 768 at 125 % with the icon-rail layout; below that the screen is the limit). `src-tauri/src/lib.rs` adds `fit_window_to_work_area` + pure `fit_size` that clamp the initial window to the monitor work area and lower the effective minimum on smaller screens; 4 unit tests cover large screens, the 1024 x 768 @ 125 % case, tiny screens and work-area bounds. |

### 2.3 Verified corrections (source level, host)

| Gate | Command | Result |
| --- | --- | --- |
| Formatting | `cargo fmt --all -- --check` | **PASS** (exit 0) |
| Lints | `cargo clippy --workspace --all-targets -- -D warnings` | **PASS** (exit 0) |
| Rust tests | `cargo test --workspace` | **PASS** (all suites ok; 140+ tests including 4 new `window_fit_tests`) |
| UI build | `npm run build` (tsc + vite) | **PASS** (exit 0) |
| UI tests | `npm test` (vitest) | **PASS** (37/37) |

### 2.4 Native regression not yet executed

The corrected layout could not be validated inside a Windows guest during this sprint because the guest keyboard injection path (`VBoxManage controlvm ... keyboardputscancode|keyboardputstring`) stopped delivering keystrokes to the guest after the VM was restarted in an unstable state (VM subsequently reported `powered off`; restarted and re-verified running, injection still non-functional). All native re-validation items below are therefore **BLOCKED** for the moment.

---

## 3. Mission 2 — Complete missing native GUI tests

### 3.1 Setup Wizard

Planned checks: first-run behaviour, ClamAV installation guidance, consent and cancellation, failure and retry states, restart persistence, FR/EN translations.

**Status: NOT EXECUTED** — guest input unavailable (see §2.4). Not claimed.

### 3.2 Firewall Modal

Planned checks: display and navigation, warning messages, keyboard accessibility, error handling, no unintended Windows Firewall changes; monitor remains read-only.

**Status: NOT EXECUTED** — guest input unavailable (see §2.4). Not claimed. The read-only nature of the firewall module is code-reviewed and previously covered by `Firewall.test.tsx` on the host (green in the 37/37 UI gate).

---

## 4. Mission 3 — UI regression (re-run failed cases, re-validate all 44)

Planned: re-run the six failed UI cases (`mx` matrix) after the D96-05/D96-06 corrections, then re-run all 44 FR/EN x light/dark cases.

**Status: BLOCKED** — not executed. The six prior FAILs (D96-05) and the two defects fixed in Sprint 9.6 (D96-01/D96-02/D96-03/D96-04) are documented in `CBS_SHIELD_UI_ACCEPTANCE_MATRIX.md`; the corrections are now in source but the corrected build has not yet been re-validated in a guest.

---

## 5. Mission 4 — Security regression

Scope: ClamAV scanning, quarantine/restore/purge, SQLite persistence, Proactive Monitor, notifications, tray, Web Guard, Network Monitor, Firewall Monitor.

Source-level status after corrections (commit `c418351`): the changed files (`theme.css`, `History.tsx`, `tauri.conf.json`, `lib.rs`) do **not** touch scanning, quarantine, TLS, or Defender logic. Gates re-run green: clippy `-D warnings`, Rust workspace tests, UI tests, UI build — **PASS**.

Runtime security re-verification in a guest: **BLOCKED** (guest input unavailable). No security regression is claimed.

Keep Microsoft Defender and Windows Firewall enabled; no TLS weakening; synthetic fixtures only — all unchanged in this sprint.

---

## 6. Mission 5 — Installer

Source changed → rebuild required (Mission 1 source corrections).

- Release build: `npm run build` exit 0.
- RC installer produced: `CBS Shield_0.9.0-dev_x64-setup.exe`.
- Size: 2,920,878 bytes.
- SHA-256: `668BAE31210D33E19DE1ECC2962309F743D6432F0444E3051A98F5CD1150B341`.
- Authenticode: **NotSigned**.
- Source commit for this build: `c418351`.

Native install/upgrade/uninstall/data-preservation verification in a guest: **BLOCKED** (guest input unavailable). Must be executed before this RC can be accepted.

---

## 7. Mission 6 — Product design preparation

**Status: MOCKUPS CREATED; IMPLEMENTATION STOPPED (as instructed).**

- Created `docs/sprint97-design/direction-a-sprint97.html` — Direction A « Calme & Souverain » refined for Sprint 9.7: single status headline, single prominent Quick Scan action, three category cards (Device / Internet / Network), clear limitations, FR/EN via toggle, light/dark via toggle.
- Created `docs/sprint97-design/direction-b-sprint97.html` — Direction B « Console compacte » refined: status strip, metric tiles, local log, three-domain table, quick scan entry, FR/EN via toggle, light/dark via toggle.

Both mockups were presented to the user in the Review pane via the browser tool.

- Design implementation in the React app: **NOT** started (explicitly out of scope for this sprint).
- Product-owner approval: **PENDING**.

---

## 8. Final deliverable

`CBS_SHIELD_SPRINT97_FINAL.md` is consolidated in this repository. It must be finalised with:

- Fresh native execution evidence for Missions 2–3 (Setup Wizard, Firewall Modal, six re-runs, 44-case matrix).
- Native installer lifecycle evidence for the rebuilt RC.
- Design approval outcome.

Until those are executed, the final GO/NO-GO cannot be re-issued other than the one below.

---

## 9. GO / NO-GO

- **Sprint 9.7 closure: NO-GO** (pending native re-validation).
- **CBS Shield 1.0 production readiness: NO-GO** (unchanged; unsigned installer).

Rationale: source corrections for D96-05/D96-06 and D96-04 follow-up were implemented and pass the source-level gates; the corrected release candidate was built and is unsigned; but native GUI evidence for the corrected build, installer lifecycle on the RC, and product-owner design approval are outstanding, so the sprint cannot be closed as complete.
