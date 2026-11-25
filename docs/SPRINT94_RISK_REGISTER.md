# Sprint 9.4 — risk register and exit conditions

**Dates:** 2026-11-01–05. **Candidate:** installed 9.3 installer SHA-256 `6AD6DCFDDDF57D502142B12DB6F5F78B865A56FC33C828B6FE7C70D9D0A92BFB`. **State:** experimental; release gate closed.

| ID | Severity | Evidence and current state | Exit condition |
| --- | --- | --- | --- |
| R94-1 | Resolved 2026-11-05 | Complete quarantine lifecycle executed natively on the recovered original VM: GUI quarantine → restart → byte-exact restore → second quarantine → approved explicit purge through the dialog (checkbox + typed `SUPPRIMER` + enabled confirm) with blob count 1→0, `0 actif`, and post-purge SQL row `status='deleted'`, first row `restored`, integrity ok (`sum94p3purge2-result.txt`, `20261105-154941-` / `20261105-155051-agent92out.txt`). The byte-verified separate recovery copy is retained. | Closed for the tested candidate. Keep a recovery copy before any production purge and re-run the sequence on the fresh guest if the release story requires it. |
| R94-2 | High | Separate access-denied and real disk-full injections were not executed. The locked-source, vanished-source, corrupted-blob, interruption cleanup and concurrency Rust tests passed. The 2026-11-05 GUI missing-path injection (closure2) produced the inline error `cible introuvable` and created no scan record, and the interruption/cancellation lifecycle passed with no data loss. | Run isolated ACL-denial and quota/disk-full cases; verify source or recoverable blob always survives. Retest the GUI injection after fixing UIA field discovery. |
| R94-3 | High | Resolved 2026-11-05. Original guest UTC was about 7 h 45 min ahead of host UTC after reboot; the 2026-11-05 guest clock correction aligned the original VM, and the fresh VM clock was re-verified (Central European Standard Time). The fresh guest initially agreed with host time, but its pinned ClamAV 1.5.4 `freshclam` attempt failed TLS certificate validation (`Download failed (60)`, exit 5) for `daily.cvd`; the custom `.ndb` signature still detected the harmless fixture directly. Official signatures are unavailable in that fresh guest. Guest timestamps in the 2026-11-05 purge/shutdown evidence follow this same offset. | Verify guest clock and trust store using supported Windows/ClamAV diagnostics; re-run the official update without weakening TLS. Keep time-based original-guest assertions provisional. |
| R94-4 | High | Uninstall/reinstall matrix now resolved 2026-11-05 (silent /S uninstall exit 0 with install-dir removal and full user-data preservation, silent /S reinstall exit 0). The full native monitor, tray, notification, FR/EN, theme, cancellation matrix are not yet evidenced. Network/Web Guard/Proactive page smoke checks passed. Clean shutdown now **passes** (2026-11-05: `CloseMainWindow` → exit within 1 s, `20261105-155051-agent92out.txt`) and the FR dashboard/antivirus/quarantine pages were rendered again during the purge session. | Finish the remaining native checks with data preservation and pass/fail evidence. |
| R94-5 | Medium | The local Sprint 9.4 rebuild was built and in-VM tested on 2026-11-05 (installer 2,918,291 bytes; SHA-256 `3031600087B0CE92C1670FC22700893FC928FA0615C47EB2F59C8E8F700DDE4C`; in-VM silent upgrade exit 0; installed exe SHA-256 `58FECCEF516D71FF7981F03FA544DF5F9674FD4776B5810D6733E7D4A8555223`; version `0.9.0-dev`). The artifact remains unsigned (`NotSigned`). | Sign intended release artifact and publish exact SHA-256; validate the exact signed artifact. |
| R94-6 | Medium | Original aborted-state log has no definitive crash/abort code; host interruption is inferred. Active VM uses a preserved working VDI copy. | Retain original logs/disks; do not claim root cause without a corresponding VirtualBox or host event record. |
| R94-7 | Resolved 2026-11-05 with limits | Earlier guest input/agent stall persisted after saved-state resume; ACPI shutdown did not complete. A full-hash-verified VDI copy of the saved state exists (`372945A0…2608A`). On 2026-11-05 the VM was reset through VirtualBox (owner-approved for this disposable lab VM), the guest returned to the signed-in desktop, the agent was re-bootstrapped, and the native purge/shutdown/session above completed against the preserved state — no data or credential bypass involved. Root cause of the earlier stall was never diagnosed from logs. | Root-cause diagnosis of the stall is optional for the lab; for any repeated occurrence, resume the protected-disk/session procedure rather than reusing the VM. |
| R94-8 | High | Owner-authorized isolated clone booted after Automatic Repair and Windows update rollback; candidate upgrade and direct synthetic ClamAV check passed, but the app window became unresponsive during the first GUI scan attempt. The clone was reset after ACPI shutdown failed; Windows returned, then input stalled again before a GUI result. The original and isolated clone are saved; original VM and source VDI were untouched. | Diagnose guest and app responsiveness on the isolated clone; rerun the complete native sequence with a unique fixture and SQL evidence. |
| R94-9 | High | Owner-authorized fresh 80 GB VDI completed standard Windows OOBE after two setup stalls and resets of only the disposable new VM. A local account signed in; Defender AV, real-time, and tamper protection were active, and guest time agreed with the host probe. The exact audited candidate installed with exit 0 and expected executable SHA-256. About 18 seconds later Windows bugchecked `0xA IRQL_NOT_LESS_OR_EQUAL` and auto-reset, before the first CBS launch command. The fresh guest returned to its desktop after one further reset; input/agent responses were delayed, but a reversible pause/resume restored the agent. Native first launch and five-step onboarding passed; SQLite contains `onboardingCompleted=true` and `integrity_check=ok`. Fresh-guest scan/quarantine and the wider native matrix remain unproved. VirtualBox uses its NEM/Hyper-V backend and logged clock catch-up lag. | Diagnose Windows/VirtualBox guest instability from preserved log and crash dump, then complete native scan, quarantine, and other open checks. Preserve original VM and its copied VDI. Do not attribute the bugcheck to CBS without process or dump evidence. |

## Earlier A1–A7 disposition

- **A1 (SQLite):** prior WAL-size inference was wrong. Installed-app before/after SQL rows, `integrity_check=ok`, and post-restart onboarding/scan/quarantine records now pass.
- **A2/A3 (quarantine data loss):** the normal native quarantine/restart/restore/re-quarantine/purge path passes, with encrypted blobs, metadata, and a retained deleted audit row (2026-11-05). Failure injection remains R94-2.
- **A4 (custom signature):** unique `.ndb` detection passes direct ClamAV and the installed GUI, corroborated by SQLite detection row.
- **A5 (single instance):** second process exited 0, one primary process remained and regained focus.
- **A6 (onboarding):** explicit completion wrote `onboardingCompleted=true`; the wizard was absent after a full Windows restart. Closing the wizard without completion intentionally wrote no setting.
- **A7 (clock/TLS):** the guest UTC discrepancy was resolved on 2026-11-05 via the guest clock correction (R94-3); a past FreshClam success does not resolve the current state.

No UI redesign or Intrusion Guard implementation was undertaken. Previous general product limits remain: manual scanning only, read-only firewall observation, loopback-only Web Guard, and unsigned development installer.


---

## Sprint 9.5 final blocker resolution addendum (2026-11-05)

- R94-1 (Resolved): quarantine lifecycle, interruption, restore, purge � previously validated; preserved.
- R94-2 (High): access-denial / disk-full injections � GUI missing-path injection validated; isolated ACL/quota cases still open.
- R94-3 (High): guest clock corrected; FreshClam TLS `Download failed (60)` diagnosed but fix not applied in finalization; open.
- R94-4 (High): clean shutdown validated; full native monitor/tray/notification/FR/EN/theme matrix not executed in finalization; open.
- R94-5 (Medium): installer unsigned; rebuild not required (source unchanged); open for release signing.
- R94-6 (Medium): original abort-state log; open (retain).
- R94-7 (Resolved with limits): VM reset; input/agent stall root cause not fully diagnosed; open follow-up.
- R94-8 (High): isolated clone GUI unresponsive; open.
- R94-9 (High): fresh VM bugcheck 0xA IRQL_NOT_LESS_OR_EQUAL; open.

### Finalization actions and current dispositions

- Host disk recovered (regenerable build caches cleaned); free space recovered to approximately 11.6 GB.
- Automated regression gates: all PASS after recovery.
- Native Windows GUI acceptance, proactive end-to-end, UI 44-case matrix, FreshClam corrective fix: BLOCKED / NOT EXECUTED in finalization.
- Final release go / no-go: NO-GO for formal Sprint 9.4 closure; CBS Shield 1.0 production readiness not claimable.

### Final VM Repair & Windows Acceptance execution addendum (2026-11-06)

- R94-3 (High): FreshClam TLS `Download failed (60)` — corrective fix NOT applied; disposable VM `CBS-Shield-Sprint94-Fresh` started for follow-up; acceptance NOT met; remains OPEN.
- R94-4 (High): Native Windows GUI acceptance (tray/notifications/proactive) and UI 44-case matrix — NOT EXECUTED / BLOCKED during final execution; real VM boot evidence acquired (Sprint7 booted, screenshots `boot-clean-sprint7-01.png`, `boot-clean-sprint7-02.png`); manual product-owner/authorized-tester interactions required; remains open.
- Storage cleanup executed: three confirmed-unnecessary VM files removed (pre-recovery VDI ≈38.76 GB, repair VHD ≈32.55 GiB, Sprint7 VDI ≈16.58 GB); ≈93.1 GB recovered; stale VirtualBox media registrations safely closed via `closemedium disk` (no `--delete`); both obsolete entries removed; active VM disks remain healthy.
- Final host disk measurement: free ≈230.86 GB after final cleanup.
- Final release go / no-go: NO-GO; CBS Shield 1.0 production readiness not claimable.



### Sprint 9.6 execution addendum (2026-11-06 -> 2026-11-07)

Executed on real VirtualBox guests with native Windows UI Automation and real
screenshots. Evidence: `target/sprint96-channel/inbox/out_phase*` and
`target/sprint96-evidence/`. Detailed reports: `CBS_SHIELD_FRESHCLAM_TLS_FIX.md`,
`CBS_SHIELD_UI_ACCEPTANCE_MATRIX.md`, `CBS_SHIELD_SPRINT96_FINAL.md`.

- **R94-3 (High) - RESOLVED.** Root cause was an incomplete Windows trust store:
  `GlobalSign ECC Root CA - R4` (thumbprint `6BA0B098E171EF5AADFE4815807710F4BD6F0B28`)
  was absent, and `database.clamav.net` chains to it through Google Trust
  Services `WE1`. The supported Windows automatic root update provisioned R4;
  `freshclam` then downloaded `daily` 28175 / `main` 63 / `bytecode` 339
  with `OpenSSL verify result: 0`, `sigtool --info` reported `Verification OK`
  for all three, and `clamscan` loaded `ClamAV 1.5.4/28175` (exit 0). No TLS
  option was disabled, no certificate exception was added, the product
  `freshclam.conf` was not weakened, and Defender was untouched. A temporary
  `CACertificate` diagnostic config was rejected by FreshClam and played no
  part in the success. Exit condition met on guest `CBS-Shield-Sprint94-Fresh`.
- **R94-4 (High) - RESOLVED with documented limits.** Native GUI acceptance
  executed: tray (open app, open quarantine, open network monitor, quit, single
  process), notifications (real toast plus Windows notification centre entry
  from a real quick scan), Proactive Monitor end-to-end (consent, baseline,
  new-file detection, real ClamAV analysis, history persistence, pause/resume/
  stop/start, restart persistence, max 1 concurrent `clamscan`, ~31-41 MB RAM,
  no duplicate workers), 44/44 UI cases (11 sections x FR/EN x dark/light) with
  real screenshots, and Phase D dialogs/keyboard/resize. Four functional defects
  were fixed and re-verified: proactive consent never enabled the worker,
  auto-watch reported stopped after restart while cycles ran, the EN Settings
  disclaimer leaked French, and modals were positioned relative to scrolled
  content instead of the viewport. Residual limits: open horizontal clipping at
  1016x740 (D96-05), app minimum width 1080 px / default 1380x900 greater than a
  1024x768 guest (D96-06), firewall rule-detail modal and setup wizard NOT
  EXECUTED. No visual redesign and no Intrusion Guard work was performed.
- **R94-5 (Medium) - superseded hash, unpackaged status unchanged.** The final
  Sprint 9.6 installer is `CBS Shield_0.9.0-dev_x64-setup-final4.exe`,
  SHA-256 `B527D3A9999774036961DD0B4EAEE13F1B8FF422F3D3F588533375F7CDA8E1F8`
  (2,919,719 bytes), Authenticode `NotSigned`. Install/upgrade/uninstall were
  exercised in the guest with exit code 0; the app database, WAL/SHM and the 15
  recorded scans were byte-identical after upgrade and survived uninstall plus
  reinstall. The package remains unsigned and no signed claim is made.
- **Phase E gates on final source: PASS.** `cargo fmt` clean,
  `cargo clippy --workspace --all-targets -- -D warnings` clean, Rust
  workspace tests pass (1 ignored ClamAV integration test), UI production build
  succeeds, UI tests 37/37.
- **Sprint 9.6 go / no-go: GO with documented open layout defect and the two
  NOT EXECUTED dialogs.** CBS Shield 1.0 production readiness is still not
  claimed: the installer is unsigned, R94-8 and R94-9 remain open, and Defender
  remains the continuous antivirus.
