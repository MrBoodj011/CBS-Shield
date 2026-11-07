# CBS Shield - Sprint 9.6 Final Report

**Product:** CBS Shield by Cybrense
**Version:** 0.9.0-dev
**Branch:** `sprint-9.3`
**Base commit at sprint start:** `b43a2a9`
**Source-fix commit:** `1a1d075`
**Documentation commit:** `0cc6711`
**Execution window:** 2026-11-06 -> 2026-11-07
**Guests:** VirtualBox `CBS-Shield-Sprint94-Fresh` (Clean/fresh image) and `CBS-Shield-Sprint7` (lab image with existing scan history), Windows 11 Enterprise Evaluation build 26300, guest user `cbs` (non-administrator)
**Method:** native Windows UI Automation, real guest screenshots, real ClamAV binaries, real installer. No mocked UI results are counted as PASS.

---

## 1. Verdict

| Question | Answer |
| --- | --- |
| Sprint 9.6 work items executed with real evidence? | **Yes** - all five phases ran; 44/44 UI cases and the full Proactive end-to-end were executed |
| FreshClam TLS defect closed? | **Yes** - RESOLVED, no TLS weakening |
| Security regressions introduced? | **None** |
| Installer verified? | **Yes** - install, upgrade, uninstall, reinstall, data preservation |
| Installer signed? | **No** - Authenticode `NotSigned`; no signed claim is made |
| Sprint 9.6 closure | **GO**, with documented limits |
| CBS Shield 1.0 production readiness | **NO-GO** (unsigned package, open VM risks R94-8/R94-9, two dialogs NOT EXECUTED, one documented layout limit) |

---

## 2. What counts as evidence in this report

A result is PASS only when **all** of the following exist:

1. a real interaction with the installed application in a real Windows guest
   (UI Automation invoke/toggle/keystroke, a real process, a real ClamAV run, or
   a real installer exit code);
2. a real screenshot or a machine-readable report in
   `target/sprint96-evidence/` or `target/sprint96-channel/inbox/`;
3. an artifact that can be re-read after the fact (accessibility dump, exit
   code, hash, SQL row, log line).

Screenshots alone are **not** counted as functional proof. Sections that were
never exercised are marked **NOT EXECUTED**; nothing untested is claimed.

Evidence channel: the guest wrote reports back over a guest-initiated HTTP POST;
the harness read them from `target/sprint96-channel/inbox/`. Guest control used
VirtualBox `keyboardputstring`/`keyboardputscancode`, `screenshotpng`, and
native Windows UI Automation. No agent-recovery loop was used.

---

## 3. Phase results

| Phase | Scope | Status |
| --- | --- | --- |
| A | FreshClam TLS repair and verification on a fresh guest | **PASS** |
| B | Native tray and Windows notifications | **PASS** |
| C | Proactive Monitor end-to-end with real ClamAV analysis | **PASS** |
| D | 44-case FR/EN x dark/light UI matrix, dialogs, keyboard, resize | **PASS** (all cases executed; 6 case-level FAILs, one open layout defect D96-05) |
| E | fmt, clippy `-D warnings`, Rust tests, UI tests, production build | **PASS** |
| F | Installer rebuild, hash, install/upgrade/uninstall, data preservation | **PASS** |

Phase order was respected: FreshClam first; no UI or packaging work was accepted
while the ClamAV trust defect was open.

---

## 4. Phase A - FreshClam TLS

**Status: PASS.** Full detail in `CBS_SHIELD_FRESHCLAM_TLS_FIX.md`.

### 4.1 Symptom

FreshClam failed only on `daily.cvd` with `Download failed (60)` / exit code 5.
Error 60 is curl `CURLE_PEER_FAILED_VERIFICATION`: the peer certificate chain did
not validate against the trust store.

### 4.2 Root cause

The guest trust store did not contain **GlobalSign ECC Root CA - R4**
(SHA-1 thumbprint `6BA0B098E171EF5AADFE4815807710F4BD6F0B28`, valid to
2038-01-19). `database.clamav.net` is served by Google Trust Services `WE1`,
which chains to R4. With the root missing, the chain could not be built.

Excluded causes, each with recorded evidence: clock/time zone (guest time
agreed with the host), DNS (Cloudflare CNAME and A records correct), TCP 443
(`TcpTestSucceeded = True`), TLS protocol (TLS 1.3 negotiated), server
certificate (`valid now = True`), proxy (WinHTTP/IE direct, no proxy env vars),
and product configuration (`DatabaseMirror database.clamav.net`, `Checks 1`, no
TLS overrides).

### 4.3 Resolution

The **supported Windows automatic root-certificate update** provisioned
`GlobalSign ECC Root CA - R4` into `LocalMachine\Root` and `CurrentUser\Root`.
No manual injection, no PEM override, no verification bypass. A separate
diagnostic attempt using a temporary `CACertificate` config was rejected by
FreshClam (`Unknown option CACertificate`) and played no part in the fix; the
product configuration on disk was never modified.

### 4.4 Verification

```
* SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384 / X25519MLKEM768
* OpenSSL verify result: 0
* SSL certificate verified via OpenSSL.
main.cvd updated     (version: 63,    sigs: 3287027)
bytecode.cvd updated (version: 339,   sigs: 80)
daily.cvd updated    (version: 28175, sigs: 355849)
```

- `sigtool --info`: `Verification OK` for `daily`, `main` and `bytecode`.
- `clamscan` on a real file: `ClamAV 1.5.4/28175`, file `OK`, exit `0`.
- Re-check run: all three databases already up to date.
- Evidence: `out_phaseA.txt`, `out_phaseA2.txt`, `out_phaseA3.txt`.

**Security regression: none.** No `--insecure`, no `-k`, no `NO_VERIFY`, no
certificate exception, no proxy/hosts/DNS override, no Defender change.

---

## 5. Phase B - Tray and notifications

**Status: PASS.**

| Check | Result | Evidence |
| --- | --- | --- |
| Tray icon present with app identity | PASS | `sprint7-tray-01.png`; tray item `Appid: com.cybrense.cbsshield` |
| Minimize to tray / restore | PASS | `sprint7-tray-relaunch.png`, `sprint7-tray-open.png` |
| Tray menu `Ouvrir CBS Shield` | PASS | `sprint7-tray-menu.png` |
| Tray menu `Ouvrir la quarantaine` | PASS | `sprint7-tray-quarantine.png` |
| Tray menu `Ouvrir le moniteur réseau` | PASS | `sprint7-tray-netmon.png` |
| Tray menu `Quitter` fully exits | PASS | `sprint7-tray-quit.png` |
| Single instance / no duplicate process | PASS | `sprint7-tray-second-launch.png`, process list in `out_phaseB3.txt` |
| Real scan-complete toast | PASS | `sprint7-toast.png`, `sprint7-scan-complete.png` |
| Notification centre entry from CBS Shield | PASS | `sprint7-notification-center.png` |

Notifications were produced by a real quick scan, not by a test hook.

---

## 6. Phase C - Proactive Monitor end-to-end

**Status: PASS.** Full detail: `out_phaseC1`..`out_phaseC8a`.

### 6.1 Scenario

Temp folder `C:\\Users\\cbs\\Desktop\\s96-e2e` with harmless synthetic files;
consent granted through the UI; folder added through the UI; baseline created;
a new file added after the baseline; real `clamscan` analysis; history
persistence; pause/resume/stop/start; app restart; directory add/remove.

### 6.2 Results

| Criterion | Result | Evidence |
| --- | --- | --- |
| Monitor auto-starts with `autoWatch: true` | PASS | `proactive.json`, `sprint96-reboot-state.png` |
| Worker process active after start | PASS | `out_phaseC6.txt` `STATUS_WORKER` |
| Consent required and enforced | PASS | `sprint7-proactive-relaunch-consent.png`; D96-01 test |
| Baseline created | PASS | `BASELINE_CREATED` = 48 entries |
| New file detected after baseline | PASS | `out_phaseC6.txt` |
| Real ClamAV analysis, not a simulation | PASS | first scan at t+3 s, `clamscan` pid and CPU/memory observed |
| Detection surfaced in UI | PASS | `sprint96-e2e-detected.png`, fixture `CBS94_Synthetic.UNOFFICIAL` |
| Detections recorded in history | PASS | `sprint96-e2e-history.png`, `sprint96-e2e2-history.png` |
| History filter works | PASS | `out_phaseC6b.txt` `HISTORY_FILTERED` |
| Max 1 concurrent `clamscan` | PASS | `MAX_CONCURRENT_CLAMSCAN = 1` in `out_phaseC6.txt`, `out_phaseC6b.txt` |
| No duplicate app processes / workers | PASS | `APP_PROC_COUNT = 1` |
| Memory footprint | PASS | `APP_RAM_MB = 31.2`, observed range 31-41 MB |
| CPU delta while observing | PASS | `APP_CPU_DELTA_S = 0` over the sampled window |
| Pause | PASS | `sprint96-final-paused.png` |
| Resume | PASS | `out_phaseC7.txt` |
| Stop | PASS | `sprint96-final-stopped.png` |
| Restart persistence of monitor + autoscan | PASS | `sprint96-final-restart.png`, `sprint96-final-history-restart.png`, `out_phaseC7.txt` |
| Directory add | PASS | `sprint96-final-dir-add.png` |
| Directory remove | PASS | `sprint96-final-dir-remove.png` |
| Final state consistent | PASS | `sprint96-final-dir-final.png` |

### 6.3 Detection fixture

`custom.ndb` contains
`CBS94_Synthetic:0:*:4342533934515a2d3433454541453030` with marker
`CBS94QZ-43EEAE00`. This is a deliberate ClamAV test signature for a harmless
synthetic byte sequence; it is not malware.

### 6.4 Scope statement

The Proactive Monitor **observes and analyzes files after they appear on disk**.
It does not block execution and does not provide real-time protection. Microsoft
Defender remains the continuous antivirus throughout. No claim of pre-execution
blocking is made anywhere in this report.

---

## 7. Phase D - 44-case UI acceptance matrix

**Status: PASS as an execution gate**, with 6 case-level FAILs caused by one
documented layout defect (D96-05). Full detail:
`CBS_SHIELD_UI_ACCEPTANCE_MATRIX.md`.

### 7.1 Method

11 sections x {FR, EN} x {dark, light} = **44 cases**. For each case: select
language and theme through the real controls, save, navigate through the real
navigation button, scroll to top, dump the full accessibility tree, capture a
real screenshot, measure content-area luminance, and compute control overflow
(right edge > 1020 px).

- Window: forced to **1016x740** physical px (fits the 1024x768 framebuffer at
  125% DPI, effective content width ~813 CSS px).
- Theme proof: dark luminance **21.1-33.7**, light **233.4-244.5** - no overlap.
- Language proof: FR chrome `Dashboard ; Historique des scans ; Mises a jour ;
  Parametres`; EN chrome `Dashboard ; Scan history ; Updates ; Settings ; About
  & diagnostics`.
- Raw dumps: `out_matrix_fr_dark.txt`, `out_matrix_fr_light.txt`,
  `out_matrix_en_light.txt`, `out_matrix_en_dark.txt`.
- Analyzer: `target/sprint96-tools/analyze-matrix.ps1` ->
  `target/sprint96-evidence/matrix-analysis.txt`.

### 7.2 Result totals

| Result | Count |
| --- | --- |
| PASS | 36 |
| FAIL (open clipping defect D96-05) | 6 |
| PASS after fix | 2 |
| NOT EXECUTED | 0 |
| **Total** | **44** |

The six FAILs are all the same defect at the same width:

| Case | Offending control | Right edge |
| --- | --- | --- |
| FR dark Network monitor | `Actualiser` | 1066 |
| FR light Network monitor | `Actualiser` | 1066 |
| FR dark Web Guard | `Activite locale` | 1054 |
| FR light Web Guard | `Activite locale` | 1054 |
| EN dark Scan history | table `OUTCOME`/`Threats`/`Clean` | 1064 |
| EN light Scan history | table `OUTCOME`/`Threats`/`Clean` | 1064 |

Scope: 1016 physical px at 125% DPI is ~813 CSS px, well below the application's
declared 1080 logical-px minimum width. The FAILs therefore occur at an
unsupported window width; at the default 1380x900 window the layout is not
clipped. This is still reported as a real user-visible limit, because a
1024x768 / 125% DPI machine is a plausible deployment target.

### 7.3 Translation triage

22 automated "French leak" hits were inspected:

- **2 genuine**: EN Settings showed the French disclaimer from the backend
  `AppInfo.disclaimer` string. Fixed and re-verified in both themes
  (`mx3_en_dark_settings_disclaimer.png`, `mx3_en_light_settings_disclaimer.png`).
- **20 false positives**: case-insensitive substring matching over data values
  and module identifiers, e.g. FR `Start` matched the real Windows folder
  `StartUp`; EN `Profil` matched `profile` and `Complet` matched `completed`.

### 7.4 Matrix build provenance

The 44 cases were captured on installer
`C3F3A39CB40464A0EEB0557BEE16BA6D21090218BCD632DABDAA65B0C01942AA`.
Four source corrections followed. Cases affected by those corrections were
re-captured and re-verified on the rebuilt installers, ending with the final4
installer. The final4 build changed only modal CSS/portal behaviour, which does
not alter visible text or the matrix layout states; that is stated explicitly
rather than implied.

---

## 8. Defects

### 8.1 Fixed and re-verified

| ID | Severity | Defect | Root cause | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| D96-01 | High | Consented Proactive auto-analysis never scanned queued files | `start()` never set `AutoScanState.enabled`, so the worker exited on its first poll | `begin_worker` records consent + generation; `end_worker` clears them; regression tests added | Fixed - first real `clamscan` at t+3 s, max 1 concurrent, detection in UI |
| D96-02 | High | After restart the Proactive page said surveillance was stopped while auto-watch cycles kept running | `ProactiveMonitor::load()` spawned the worker but did not set `running = true` | state set before spawn; regression test added | Fixed - `Surveillance active` after restart |
| D96-03 | Medium | EN Settings showed a French confidentiality disclaimer | disclaimer came from a hardcoded French Rust string and bypassed the UI translator | localized in the UI with `L(fr, en)` | Fixed - verified in EN dark + light |
| D96-04 | High | Modals anchored to scrolled section content instead of the viewport (export dialog clipped, history detail mispositioned) | section entry animation kept a final `transform` with `animation-fill-mode: both`, creating a containing block for `position: fixed` | keyframes end at `transform: none`; `Modal` rendered through a React portal to `document.body` | Fixed - export rect `x=171 y=170 w=675 h=430`; history rect `x=58 y=68 w=901 h=634` |

### 8.2 Open

| ID | Severity | Defect | Status |
| --- | --- | --- | --- |
| D96-05 | Medium | Horizontal clipping at 1016x740: FR Network `Actualiser`, FR Web Guard `Activite locale`, EN History table columns | **Open** - documented; fixing it needs layout work beyond a Sprint 9.6 defect correction |
| D96-06 | Medium | App minimum width 1080 logical px and default 1380x900 exceed a 1024x768 guest at 125% DPI | **Open - documented design limit** (`sprint96-fit-1080x700.png`, `sprint96-fit-1380x900.png`) |

### 8.3 Tooling issues (not product defects)

| ID | Issue | Resolution |
| --- | --- | --- |
| D96-07 | FR About reported missing title | Accent mismatch (`À` vs `A`) in the test selector; recaptured with a loose selector |
| D96-08 | 20 false translation leaks | Case-insensitive substring matching; triaged case by case |

No visual redesign was implemented. No Intrusion Guard work was performed.

---

## 9. Phase D - dialogs, keyboard, resize

| Check | Status | Evidence |
| --- | --- | --- |
| History detail modal opens, traps focus, Tab reaches `Fermer`, Escape closes | PASS | `out_phaseD4_dialogs.txt`, `d4_history_modal_dark.png` |
| History modal viewport anchoring | PASS | `d13_history_modal_fixed_dark.png`, rect `x=58 y=68 w=901 h=634` |
| Updates confirm modal (`Lancer freshclam ?`), tab order `Fermer` -> `Annuler` -> `Telecharger`, `Annuler` closes | PASS | `out_phaseD5_modal2.txt`, `d5_updates_confirm_modal_dark.png` |
| Export modal content (title, eyebrow, body, format, `Annuler`/`Enregistrer`), focus, Escape | PASS | `out_phaseD11_export5.txt`, `f3_export_modal_dark.png` |
| Export modal viewport anchoring | PASS | rect `x=171 y=170 w=675 h=430` |
| Keyboard navigation `Dashboard` -> `Antivirus` -> `Surveillance proactive` -> `Historique des scans`, Enter activates | PASS | `out_phaseD5_modal2.txt`, `d4_keyboard_focus_dark.png`, `d5_keyboard_enter_dark.png` |
| Resize 1016x740 | PASS with clipping | `sprint96-fit-1016x740.png` |
| Resize 1080x700 | PASS with clipping | `sprint96-fit-1080x700.png` |
| Resize 1380x900 | PASS | `sprint96-fit-1380x900.png` |
| Firewall rule-detail modal | **NOT EXECUTED** | button exposes neither Invoke nor Focus; dialog never opened |
| Setup wizard | **NOT EXECUTED** | guest has `onboardingCompleted=true`; re-running would require resetting user data |

---

## 10. Phase F - installer verification

**Status: PASS.** Evidence: `out_phaseF1`, `out_phaseF2_install`,
`out_phaseF3_verify`, `out_phaseF4_uninstall`, `out_phaseF5_count`.

### 10.1 Artifact

| Property | Value |
| --- | --- |
| File | `CBS Shield_0.9.0-dev_x64-setup-final4.exe` |
| Size | 2,919,719 bytes |
| SHA-256 | `B527D3A9999774036961DD0B4EAEE13F1B8FF422F3D3F588533375F7CDA8E1F8` |
| Authenticode | **NotSigned** |
| Version | 0.9.0-dev |
| Installed exe SHA-256 | `4FFFCF9652B2D364EF0413B11BFCF1BC5E66F3ABA8ADB709DD8C54C894FB946A` |

The installer was rebuilt because the source changed four times. It was not
re-signed, and **no signature claim of any kind is made**.

### 10.2 Lifecycle

| Step | Status | Evidence |
| --- | --- | --- |
| Install over existing 0.9.0-dev | PASS, exit 0 | `out_phaseF2_install.txt` |
| Upgrade preserves app database DB/WAL/SHM | PASS, sizes and mtimes identical | `out_phaseF2_install.txt` |
| App launches, single process, window on screen | PASS (`ws=29.9 MB`) | `out_phaseF1.txt` |
| Uninstall | PASS, exit 0, install dir removed | `out_phaseF4_uninstall.txt` |
| Data preserved after uninstall | PASS, DB/WAL/SHM identical, quarantine 0 (was 0) | `out_phaseF4_uninstall.txt` |
| Reinstall | PASS, exit 0, exe restored with same SHA-256 | `out_phaseF4_uninstall.txt` |
| Scan history preserved | PASS, `15 scan(s) affiche(s) sur 15` | `out_phaseF5_count.txt`, `f5_history_after_reinstall_dark.png` |
| Post-reinstall dashboard consistent | PASS | `f5_dashboard_after_reinstall_dark.png` |

### 10.3 Remediation host state after install

```
cbs-shield.db      4096 bytes   2026-10-28T14:43:23Z   (unchanged)
cbs-shield.db-wal  1149512 bytes 2026-11-07T11:59:49Z  (unchanged)
cbs-shield.db-shm  32768 bytes   2026-11-07T11:58:42Z   (unchanged)
```

The main DB file mtime is old because SQLite keeps the schema in `db` and writes
rows to the WAL; all three files being byte-identical before and after is the
relevant preservation proof.

---

## 11. Phase E - corrective gates on final source

| Gate | Command | Status | Result |
| --- | --- | --- | --- |
| Formatting | `cargo fmt --all -- --check` | PASS | no diff (`gate-fmt.log`) |
| Lints | `cargo clippy --workspace --all-targets -- -D warnings` | PASS | exit 0 (`gate-clippy.log`) |
| Rust tests | `cargo test --workspace` | PASS | **140 passed, 0 failed, 1 ignored** (`gate-test.log`) |
| UI tests | `npm test` (vitest) | PASS | **37/37** (`gate-ui-test.log`) |
| UI production build | `npm run build` | PASS | exit 0 (`gate-ui-build.log`) |

Rust breakdown: `cbs-core` 30, `clamav_integration` 3 (+1 ignored), `mission_e` 2,
`cbs-firewall` 8, `cbs-netmon` 7, `cbs-proactive` 8, `cbs-quarantine` 14,
`cbs-shield` 42, `cbs-store` 8, `persistence` 4, `cbs-webguard` 14.

The ignored test is the ClamAV integration test that requires a live database in
the build environment; it was exercised separately in the guest, not skipped
silently.

Additional real scan on the final build: quick scan of **410 files**,
**10 detections**, **2 unreadable-file errors**, **10 min 11 s**; screenshots
`d6_after_quick_scan.png`, `d8-state.png`. The detections come from the lab's
deliberate test signatures/fixtures, not from live malware.

---

## 12. Security posture

| Property | State |
| --- | --- |
| Microsoft Defender | Still enabled and continuous; never disabled, excluded or modified |
| Real-time protection | Not provided by CBS Shield; stated in UI and docs |
| Kernel driver | None |
| Firewall rules modified | None; firewall section is read-only inspection |
| Network traffic interception | None; IP Helper read-only observation |
| TLS verification | Fully enforced; FreshClam verified with `OpenSSL verify result: 0` |
| Certificate exceptions | None added |
| Signature verification | `sigtool` `Verification OK` on daily/main/bytecode |
| Pre-execution blocking claim | Not made anywhere |
| Installer signing | **Unsigned** - `NotSigned`; treated as a blocker for distribution, not a Sprint 9.6 code defect |

**Security regressions: none.**

---

## 13. Remaining limits and blockers

| Item | Status | Impact |
| --- | --- | --- |
| D96-05 horizontal clipping at ~813 CSS px | Open | Cosmetic/functional on 1024x768 @125% DPI only |
| D96-06 minimum window 1080 logical px | Open, documented | App cannot fully fit a 1024x768 @125% DPI screen |
| Firewall rule-detail modal | NOT EXECUTED | Read-only dialog unverified; no write path involved |
| Setup wizard | NOT EXECUTED | First-run onboarding unverified in this sprint |
| Installer unsigned | Open | Cannot be distributed as a trusted package |
| R94-8 (isolated clone GUI unresponsive) | Open | VM infrastructure risk, not a product defect |
| R94-9 (fresh VM bugcheck 0xA) | Open | VM infrastructure risk, not a product defect |
| Sprint7 lab VM signatures (28169, ~9 days) | Intentional | Dashboard correctly shows degraded manual analysis |

No item in this list is silently upgraded to PASS.

---

## 14. Evidence index

All paths are relative to the repository root.

### 14.1 Machine-readable reports

- `target/sprint96-channel/inbox/out_phaseA.txt`, `out_phaseA2.txt`, `out_phaseA3.txt` - FreshClam TLS diagnosis, root store, download, verify, sigtool, clamscan
- `out_phaseB1.txt`..`out_phaseB10.txt` - install/launch, tray, scan, toast, notification centre, page dumps
- `out_phaseC1.txt`..`out_phaseC8a.txt` - Proactive consent, baseline, detection, concurrency, resource use, pause/resume/stop, restart, directories
- `out_phaseD0.txt`, `out_phaseD1a.txt`, `out_phaseD4_dialogs.txt`, `out_phaseD5_modal2.txt`, `out_phaseD11_export5.txt`, `out_phaseD3_disclaimer.txt` - dialogs, keyboard, resize, disclaimer fix
- `out_phaseF1.txt`, `out_phaseF2_install.txt`, `out_phaseF3_verify.txt`, `out_phaseF4_uninstall.txt`, `out_phaseF5_count.txt` - installer lifecycle
- `out_matrix_fr_dark.txt`, `out_matrix_fr_light.txt`, `out_matrix_en_dark.txt`, `out_matrix_en_light.txt`, `out_matrix_summary.txt` - 44-case matrix
- `target/sprint96-evidence/matrix-analysis.txt` - PASS/FAIL, luminance, overflow
- `target/sprint96-evidence/gate-fmt.log`, `gate-clippy.log`, `gate-test.log`, `gate-ui-test.log`, `gate-ui-build.log` - Phase E gates

### 14.2 Screenshots - FreshClam / VM (Phase A)

`fresh-login-01.png`, `fresh-login-02.png`, `fresh-desktop-01.png`..`04.png`,
`fresh-runtask-01.png`..`04.png`, `fresh-cmd-01.png`..`03.png`,
`fresh-state-01.png`, `fresh-state-02.png`.

### 14.3 Screenshots - tray and notifications (Phase B)

`sprint7-tray-01.png`, `sprint7-tray-menu.png`, `sprint7-tray-open.png`,
`sprint7-tray-quarantine.png`, `sprint7-tray-netmon.png`,
`sprint7-tray-quit.png`, `sprint7-tray-relaunch.png`,
`sprint7-tray-second-launch.png`, `sprint7-toast.png`,
`sprint7-scan-complete.png`, `sprint7-notification-center.png`.

### 14.4 Screenshots - Proactive E2E (Phase C)

`sprint7-proactive-relaunch-consent.png`, `sprint7-proactive-started.png`,
`sprint7-proactive-detected-ui.png`, `sprint7-proactive-detection.png`,
`sprint7-proactive-history.png`, `sprint7-proactive-paused.png`,
`sprint7-proactive-stopped.png`, `sprint7-proactive-center.png`,
`sprint96-e2e-detected.png`, `sprint96-e2e-scan-inflight.png`,
`sprint96-e2e-history.png`, `sprint96-e2e-notification-center.png`,
`sprint96-e2e2-clam-inflight.png`, `sprint96-e2e2-history.png`,
`sprint96-e2e2-worker-after.png`, `sprint96-e2e2-notification-center.png`,
`sprint96-final-restart.png`, `sprint96-final-history-restart.png`,
`sprint96-final-paused.png`, `sprint96-final-stopped.png`,
`sprint96-final-dir-add.png`, `sprint96-final-dir-remove.png`,
`sprint96-final-dir-final.png`, `sprint96-newbuild-proactive-state.png`,
`sprint96-reboot-state.png`, `sprint96-restart-boot.png`.

### 14.5 Screenshots - 44-case matrix (Phase D)

- FR dark: `mx_fr_dark_{dashboard,antivirus,proactive,history,quarantine,network,firewall,webguard,updates,settings,about}.png`
- FR light: `mx_fr_light_{...}.png`
- EN dark: `mx_en_dark_{...}.png`
- EN light: `mx_en_light_{...}.png`
- Recaptures: `mx2_fr_dark_about.png`, `mx2_fr_light_about.png`,
  `mx2_en_dark_settings.png`, `mx2_en_light_settings.png`,
  `mx3_en_dark_settings_disclaimer.png`, `mx3_en_light_settings_disclaimer.png`,
  `mx_after_restore.png`
- Theme/language proof: `probe-fr.png`, `probe-en.png`, `probe-dark.png`,
  `probe-light.png`

### 14.6 Screenshots - dialogs, keyboard, resize

`d4_history_modal_dark.png`, `d13_history_modal_fixed_dark.png`,
`d12_history_modal_fixed_dark.png`, `d5_updates_confirm_modal_dark.png`,
`d4_export_modal_dark.png`, `d9_export_modal_dark.png`,
`d11_export_modal_dark_a.png`, `d12_export_modal_fixed_dark.png`,
`f3_export_modal_dark.png`, `d4_keyboard_focus_dark.png`,
`d5_keyboard_enter_dark.png`, `sprint96-fit-1016x740.png`,
`sprint96-fit-1080x700.png`, `sprint96-fit-1380x900.png`.
Attempt only (dialog NOT EXECUTED): `d10_firewall_rule_modal_dark.png`,
`d9_firewall_rule_modal_dark.png`.

### 14.7 Screenshots - installer (Phase F)

`f2-run.png`, `f2-install-state.png`, `f2-install-state2.png`, `f2-unfreeze.png`,
`post-upgrade-dashboard.png`, `f5_history_after_reinstall_dark.png`,
`f5_dashboard_after_reinstall_dark.png`.

---

## 15. Reproducibility notes

- FreshClam guest: `CBS-Shield-Sprint94-Fresh`; lab guest: `CBS-Shield-Sprint7`.
- Guest app data: `C:\\Users\\cbs\\AppData\\Local\\Cybrense\\CBS Shield`.
- Install dir: `C:\\Users\\cbs\\AppData\\Local\\CBS Shield`.
- Guest account: `cbs` (no local admin).
- Matrix window forced with Win32 `SetWindowPos` to 1016x740; DPI 125%.
- Theme switches were verified by measured luminance, not by trusting the
  button label.
- Guest control used `VBoxManage controlvm ... keyboardputstring`,
  `keyboardputscancode`, `screenshotpng`; the guest posted results over a
  guest-initiated HTTP channel to the host listener.
- Display freezes were recovered with `VBoxManage controlvm <vm> pause` then
  `resume`; screenshots taken before a pause/resume can be stale and were
  discarded when necessary.

---

## 16. Commit record

| Commit | Contents |
| --- | --- |
| `b43a2a9` | Sprint 9.5 finalization (sprint start point) |
| `1a1d075` | Source fixes: proactive consent worker, running state after restart, EN disclaimer localization, modal portal + keyframe fix, regression tests |
| `0cc6711` | `CBS_SHIELD_FRESHCLAM_TLS_FIX.md`, `CBS_SHIELD_UI_ACCEPTANCE_MATRIX.md`, `docs/SPRINT94_RISK_REGISTER.md` Sprint 9.6 addendum |
| this document | `CBS_SHIELD_SPRINT96_FINAL.md` |

All commits are local on `sprint-9.3`. **Nothing was pushed to a remote.**

---

## 17. Go / No-Go

### Sprint 9.6 closure: **GO**

Rationale:

- All five phases were executed with real evidence; no phase was substituted by
  a plan or a mock.
- FreshClam works with full TLS verification; the root cause is understood and
  fixed at the operating-system trust-store level, not by weakening security.
- Tray, notifications and the Proactive Monitor end-to-end all pass, including
  restart persistence and the single-concurrency guarantee.
- 44/44 UI cases were executed; the only case-level FAILs are one documented
  narrow-window clipping defect, and all four functional defects found were
  fixed and re-verified.
- Phase E gates are clean on the final source, and the final4 installer was
  exercised through install, upgrade, uninstall, reinstall and data
  preservation.

### CBS Shield 1.0 production readiness: **NO-GO**

Reason: the installer is unsigned (`NotSigned`), D96-05/D96-06 remain open,
the firewall rule-detail modal and setup wizard were NOT EXECUTED, and the
VM-level risks R94-8/R94-9 are still open. Sprint 9.6 closes the sprint scope;
it does not certify a distributable, signed 1.0 product.
