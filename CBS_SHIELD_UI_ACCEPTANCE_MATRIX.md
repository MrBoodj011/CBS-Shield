# CBS Shield - UI Acceptance Matrix (Sprint 9.6)

**Product:** CBS Shield by Cybrense
**Version:** 0.9.0-dev
**Branch:** sprint-9.3
**Test guest:** VirtualBox `CBS-Shield-Sprint7`, Windows 11, 1024x768 framebuffer
**App window during matrix:** forced to **1016x740** (fits the framebuffer at 125% DPI, ~813 CSS px)
**Matrix build:** installer SHA-256 `C3F3A39CB40464A0EEB0557BEE16BA6D21090218BCD632DABDAA65B0C01942AA`
**Matrix date:** 2026-11-07, 10:50-10:55 guest local time
**Method:** native Windows UI Automation (no mocked rendering), one screenshot per case
**Status:** 44/44 cases executed; 36 PASS, 6 FAIL (one open clipping defect), 2 PASS after fix.

---

## 1. Scope and method

The matrix is **11 sections x 4 presentation modes = 44 cases**:

- Languages: French (`fr`), English (`en`)
- Themes: dark, light

For every case the harness:

1. selected the language with the language toggle and the theme with the theme
   button, then saved the setting;
2. navigated to the section through the real navigation button;
3. scrolled to the top and dumped the full accessibility tree
   (`AX|ControlType|Name|enabled|offscreen|rect`);
4. captured a real screenshot of the 1024x768 guest screen;
5. computed screen luminance over the content area to prove the theme actually
   changed;
6. flagged horizontal control overflow (`right > 1020`) and vertical/horizontal
   scroll state.

Artifacts:

- Raw per-mode dumps: `target/sprint96-channel/inbox/out_matrix_{fr_dark,fr_light,en_light,en_dark}.txt`
- Summary: `target/sprint96-channel/inbox/out_matrix_summary.txt`
- Analyzer output: `target/sprint96-evidence/matrix-analysis.txt`
- Screenshots: `target/sprint96-evidence/mx_<lang>_<theme>_<section>.png`
- Post-fix screenshots: `mx2_*`, `mx3_*`, `d13_*`, `f3_*`

Theme proof (mean luminance, 0-255): dark cases **21.1-33.7**, light cases
**233.4-244.5**. There is no overlap, so every theme switch is visually real.

Language proof: `D1a` switched FR/light -> FR/dark -> EN/dark -> FR/dark and read
back the navigation labels each time:

- FR: `Dashboard ; Historique des scans ; Mises à jour ; Paramètres`
- EN: `Dashboard ; Scan history ; Updates ; Settings ; About & diagnostics`

---

## 2. 44-case result table

`Rendered` = expected section title/heading present in the accessibility tree.
`Overflow` = number of controls whose right edge exceeded the 1020 px window edge.
`Result` is PASS only when the case rendered correctly, had no untranslated
chrome, and had no clipping. Screenshot names are relative to
`target/sprint96-evidence/`.

| # | Language | Theme | Section | Screenshot | Rendered | Luminance | Overflow | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | FR | Dark | Dashboard | `mx_fr_dark_dashboard.png` | yes | 25.9 | 0 | PASS |
| 2 | FR | Dark | Antivirus | `mx_fr_dark_antivirus.png` | yes | 32.9 | 0 | PASS |
| 3 | FR | Dark | Proactive Monitor | `mx_fr_dark_proactive.png` | yes | 21.1 | 0 | PASS |
| 4 | FR | Dark | Scan history | `mx_fr_dark_history.png` | yes | 23.5 | 0 | PASS |
| 5 | FR | Dark | Quarantine | `mx_fr_dark_quarantine.png` | yes | 24.4 | 0 | PASS |
| 6 | FR | Dark | Network monitor | `mx_fr_dark_network.png` | yes | 24.7 | 1 | **FAIL** |
| 7 | FR | Dark | Windows firewall | `mx_fr_dark_firewall.png` | yes | 23.9 | 0 | PASS |
| 8 | FR | Dark | Web Guard | `mx_fr_dark_webguard.png` | yes | 33.7 | 1 | **FAIL** |
| 9 | FR | Dark | Updates | `mx_fr_dark_updates.png` | yes | 26.9 | 0 | PASS |
| 10 | FR | Dark | Settings | `mx_fr_dark_settings.png` | yes | 32.3 | 0 | PASS |
| 11 | FR | Dark | About | `mx2_fr_dark_about.png` | yes (1) | 32.3 | 0 | PASS |
| 12 | FR | Light | Dashboard | `mx_fr_light_dashboard.png` | yes | 239.6 | 0 | PASS |
| 13 | FR | Light | Antivirus | `mx_fr_light_antivirus.png` | yes | 235.9 | 0 | PASS |
| 14 | FR | Light | Proactive Monitor | `mx_fr_light_proactive.png` | yes | 243.4 | 0 | PASS |
| 15 | FR | Light | Scan history | `mx_fr_light_history.png` | yes | 243.4 | 0 | PASS |
| 16 | FR | Light | Quarantine | `mx_fr_light_quarantine.png` | yes | 242.2 | 0 | PASS |
| 17 | FR | Light | Network monitor | `mx_fr_light_network.png` | yes | 241.6 | 1 | **FAIL** |
| 18 | FR | Light | Windows firewall | `mx_fr_light_firewall.png` | yes | 242.3 | 0 | PASS |
| 19 | FR | Light | Web Guard | `mx_fr_light_webguard.png` | yes | 233.4 | 1 | **FAIL** |
| 20 | FR | Light | Updates | `mx_fr_light_updates.png` | yes | 240.6 | 0 | PASS |
| 21 | FR | Light | Settings | `mx_fr_light_settings.png` | yes | 235.0 | 0 | PASS |
| 22 | FR | Light | About | `mx2_fr_light_about.png` | yes (1) | 235.0 | 0 | PASS |
| 23 | EN | Dark | Dashboard | `mx_en_dark_dashboard.png` | yes | 26.1 | 0 | PASS |
| 24 | EN | Dark | Antivirus | `mx_en_dark_antivirus.png` | yes | 31.6 | 0 | PASS |
| 25 | EN | Dark | Proactive Monitor | `mx_en_dark_proactive.png` | yes | 21.5 | 0 | PASS |
| 26 | EN | Dark | Scan history | `mx_en_dark_history.png` | yes | 25.6 | 5 | **FAIL** |
| 27 | EN | Dark | Quarantine | `mx_en_dark_quarantine.png` | yes | 23.2 | 0 | PASS |
| 28 | EN | Dark | Network monitor | `mx_en_dark_network.png` | yes | 25.2 | 0 | PASS |
| 29 | EN | Dark | Windows firewall | `mx_en_dark_firewall.png` | yes | 25.0 | 0 | PASS |
| 30 | EN | Dark | Web Guard | `mx_en_dark_webguard.png` | yes | 31.6 | 0 | PASS |
| 31 | EN | Dark | Updates | `mx_en_dark_updates.png` | yes | 27.5 | 0 | PASS |
| 32 | EN | Dark | Settings | `mx3_en_dark_settings_disclaimer.png` | yes (2) | 30.2 | 0 | PASS (fixed) |
| 33 | EN | Dark | About | `mx_en_dark_about.png` | yes | 24.8 | 0 | PASS |
| 34 | EN | Light | Dashboard | `mx_en_light_dashboard.png` | yes | 239.3 | 0 | PASS |
| 35 | EN | Light | Antivirus | `mx_en_light_antivirus.png` | yes | 237.3 | 0 | PASS |
| 36 | EN | Light | Proactive Monitor | `mx_en_light_proactive.png` | yes | 243.2 | 0 | PASS |
| 37 | EN | Light | Scan history | `mx_en_light_history.png` | yes | 243.5 | 5 | **FAIL** |
| 38 | EN | Light | Quarantine | `mx_en_light_quarantine.png` | yes | 243.5 | 0 | PASS |
| 39 | EN | Light | Network monitor | `mx_en_light_network.png` | yes | 240.7 | 0 | PASS |
| 40 | EN | Light | Windows firewall | `mx_en_light_firewall.png` | yes | 241.2 | 0 | PASS |
| 41 | EN | Light | Web Guard | `mx_en_light_webguard.png` | yes | 235.6 | 0 | PASS |
| 42 | EN | Light | Updates | `mx_en_light_updates.png` | yes | 240.2 | 0 | PASS |
| 43 | EN | Light | Settings | `mx3_en_light_settings_disclaimer.png` | yes (2) | 236.7 | 0 | PASS (fixed) |
| 44 | EN | Light | About | `mx_en_light_about.png` | yes | 244.5 | 0 | PASS |

Notes:

1. The FR About heading is `À propos & diagnostic`. The first analyzer pass
   searched the ASCII string `A propos & diagnostic` and reported a false
   negative; the section was recaptured with a loose selector and both FR themes
   are correct (`mx2_fr_dark_about.png`, `mx2_fr_light_about.png`). Test
   tooling issue, not a product defect.
2. EN Settings originally showed the Rust-supplied French disclaimer. It was
   localized in the UI, then re-captured and verified in both themes on the
   rebuilt installer. See defect D96-03.

**Totals: 36 PASS, 6 FAIL, 2 PASS-after-fix. All 44 cases executed.**

---

## 3. Translation triage

The automated marker scan produced 22 hits. Each was inspected against the raw
accessibility tree:

- **Genuine (2 cases):** EN/dark and EN/light Settings contained the French
  disclaimer from the backend `AppInfo.disclaimer` string. Fixed and re-verified.
- **False positives (20 cases):** the scan is case-insensitive substring
  matching. Examples:
  - FR Antivirus `Start` matched the real Windows folder `StartUp`;
  - EN Dashboard `Profil` matched `profile` and `Complet` matched `completed`;
  - FR Settings `settings`/`quarantine` matched lowercase technical module
    identifiers inside data, not visible UI chrome;
  - FR Updates `Updates` matched a module identifier.
  These are not untranslated UI strings.

Post-fix EN Settings verification (accessibility tree, both themes) shows only:

```
CBS Shield provides experimental manual antivirus scanning. It does not provide
real-time protection and does not replace Microsoft Defender. No kernel driver,
firewall rule or Defender modification is performed.
```

and the FR-locator scan returned no leak in EN mode.

---

## 4. Defect table

| ID | Severity | Description | Root cause | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| D96-01 | High | Proactive automatic analysis never scanned queued files even after explicit consent | `AutoScanState.enabled` was left `false` by `start()`, so `run()` exited on its first poll | **Fixed** (`begin_worker` sets consent + generation) | First real `clamscan` at t+3 s, max 1 concurrent, detection in UI: `out_phaseC6.txt`, `sprint96-e2e-scan-inflight.png` |
| D96-02 | High | After restart the Proactive page said surveillance was stopped while auto-watch cycles kept running | `ProactiveMonitor::load()` spawned the worker but did not set `running = true` | **Fixed** (state set before spawn) | `Surveillance active`, relaunch On, autoscan On after restart: `out_phaseC7.txt`, `sprint96-final-restart.png` |
| D96-03 | Medium | English UI showed a French confidentiality/disclaimer paragraph in Settings | Disclaimer came from a hardcoded French Rust string and bypassed the UI translator | **Fixed** (localized with `L(fr, en)`) | `mx3_en_dark_settings_disclaimer.png`, `mx3_en_light_settings_disclaimer.png`, `out_phaseD3_disclaimer.txt` |
| D96-04 | High | Modals were anchored to the scrolled section content, not the viewport (export dialog clipped below the window; history detail dialog mispositioned) | Section entry animation used `animation-fill-mode: both` with a final `transform`, creating a containing block for `position: fixed` | **Fixed** (final keyframe `transform: none` + modal rendered through a React portal to `document.body`) | Final build rects: export `x=171 y=170 w=675 h=430`, history `x=58 y=68 w=901 h=634`; `f3_export_modal_dark.png`, `d13_history_modal_fixed_dark.png` |
| D96-05 | Medium (open) | Horizontal clipping at 1016x740: FR Network `Actualiser` right=1066, FR Web Guard `Activité locale` right=1054, EN History table columns (`OUTCOME`, `Threats`, `Clean`) right=1064 | Page-level min-width assumptions exceed the effective 813 CSS px at 125% DPI | **Open** - documented, not fixed (would require layout work) | `matrix-analysis.txt` overflow section; `mx_fr_dark_network.png`, `mx_fr_dark_webguard.png`, `mx_en_dark_history.png` |
| D96-06 | Medium (limit) | App minimum width is 1080 px and default size is 1380x900; both exceed a 1024x768 guest at 125% DPI | Window sizing is designed for desktop resolutions above 1024x768 | **Open - documented limit** | `out_phaseD0.txt`: min `1080x700`, default `1380x900`; `sprint96-fit-1080x700.png`, `sprint96-fit-1380x900.png` |
| D96-07 | Low (tooling) | FR About reported missing title in the first analyzer pass | Accent mismatch (`À` vs `A`) in the test selector | **Resolved (test)** | `mx2_fr_dark_about.png`, `mx2_fr_light_about.png` |
| D96-08 | Low (tooling) | 20 false "translation leak" hits | Case-insensitive substring matching over data and identifiers | **Resolved (triage)** | Section 3 above |

No visual redesign was implemented. Only the functional defects above were
corrected.

---

## 5. Dialogs, keyboard and resize (Phase D)

| Check | Result | Evidence |
| --- | --- | --- |
| History detail modal opens, traps focus, Escape closes | PASS | Focus starts on the dialog window, Tab cycles to `Fermer`, Escape removes the dialog: `out_phaseD4_dialogs.txt` |
| History detail modal anchored to viewport | PASS | Final build rect `x=58 y=68 w=901 h=634`, `d13_history_modal_fixed_dark.png` |
| Updates confirmation modal (`Lancer freshclam ?`) | PASS | Tab order `Fermer` -> `Annuler` -> `Télécharger`; `Annuler` closes: `out_phaseD5_modal2.txt`, `d5_updates_confirm_modal_dark.png` |
| Export report modal content and footer | PASS | Title, eyebrow, body, format field, `Annuler`/`Enregistrer`; focus starts on dialog; Escape closes: `out_phaseD11_export5.txt`, `f3_export_modal_dark.png` |
| Export modal anchored to viewport | PASS | Final build rect `x=171 y=170 w=675 h=430`, body text visible at `y=289` |
| Keyboard traversal of main navigation | PASS | `Dashboard` -> `Antivirus` -> `Surveillance proactive` -> `Historique des scans`; Enter activates the section: `out_phaseD5_modal2.txt`, `d5_keyboard_enter_dark.png` |
| Resize 1016x740 | PASS | `sprint96-fit-1016x740.png`, `out_phaseD0.txt` |
| Resize 1080x700 (minimum) | PASS with clipping | `sprint96-fit-1080x700.png` |
| Resize 1380x900 (default) | PASS | `sprint96-fit-1380x900.png` |
| Firewall rule-detail modal | **NOT EXECUTED** | Button exists (`Détails de la règle ...`) but exposes neither Invoke nor Focus; dialog never opened |
| Setup wizard | **NOT EXECUTED** | Guest has `onboardingCompleted=true`; re-running it would require resetting user data |

---

## 6. Screenshot index

Base path: `target/sprint96-evidence/`

**44-case matrix**

- FR dark: `mx_fr_dark_{dashboard,antivirus,proactive,history,quarantine,network,firewall,webguard,updates,settings,about}.png`
- FR light: `mx_fr_light_{...}.png`
- EN dark: `mx_en_dark_{...}.png`
- EN light: `mx_en_light_{...}.png`

**Post-fix / recapture**

- `mx2_fr_dark_about.png`, `mx2_fr_light_about.png`
- `mx2_en_dark_settings.png`, `mx2_en_light_settings.png`
- `mx3_en_dark_settings_disclaimer.png`, `mx3_en_light_settings_disclaimer.png`
- `mx_after_restore.png`

**Language / theme proof**

- `probe-fr.png`, `probe-en.png`, `probe-dark.png`, `probe-light.png`
- `sprint96-fit-1016x740.png`, `sprint96-fit-1080x700.png`, `sprint96-fit-1380x900.png`

**Dialogs / keyboard**

- `d4_history_modal_dark.png`, `d13_history_modal_fixed_dark.png`
- `d5_updates_confirm_modal_dark.png`
- `d9_export_modal_dark.png`, `d11_export_modal_dark_a.png`, `f3_export_modal_dark.png`
- `d4_keyboard_focus_dark.png`, `d5_keyboard_enter_dark.png`
- `d9_firewall_rule_modal_dark.png` (attempt only; dialog NOT EXECUTED)

---

## 7. Verdict

- **44/44 cases executed** on real native UI with real screenshots.
- **36 PASS**, **6 FAIL** due to one open horizontal-clipping defect at
  1016x740, **2 PASS after fix**.
- All four source corrections were re-verified on the rebuilt installer.
- Remaining gaps are documented layout limits and two NOT EXECUTED dialogs; no
  untested case is claimed as PASS.

**Sprint 9.6 Phase D gate: PASS with documented open layout defect D96-05 and
the D96-06 resolution limit.**
