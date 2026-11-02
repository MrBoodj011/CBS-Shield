# Sprint 9.4 — risk register and exit conditions

**Dates:** 2026-11-01–02. **Candidate:** installed 9.3 installer SHA-256 `6AD6DCFDDDF57D502142B12DB6F5F78B865A56FC33C828B6FE7C70D9D0A92BFB`. **State:** experimental; release gate closed.

| ID | Severity | Evidence and current state | Exit condition |
| --- | --- | --- | --- |
| R94-1 | Critical | GUI quarantine → app restart → byte-exact restore → second quarantine passed. Owner approved exact-item purge, but a VM stall blocked it and the final audit check. A separate verified recovery copy exists. | Recover guest input safely; complete approved purge and post-purge SQL/integrity check. |
| R94-2 | High | Separate access-denied and real disk-full injections were not executed. The locked-source, vanished-source, corrupted-blob, interruption cleanup and concurrency Rust tests passed. | Run isolated ACL-denial and quota/disk-full cases; verify source or recoverable blob always survives. |
| R94-3 | High | Guest UTC was about 7 h 45 min ahead of host UTC after reboot. Earlier A7 analysis only established a timezone difference in a prior session. Current timestamps and TLS outcomes cannot be trusted without correction. | Set and verify guest timezone/clock through supported guest controls; re-run TLS update and compare UTC at one instant. Do not weaken TLS. |
| R94-4 | High | Uninstall/reinstall and full native monitor, tray, notification, FR/EN, theme, cancellation, shutdown matrix are not yet evidenced. Network/Web Guard/Proactive page smoke checks passed; the VM later stopped accepting input. | Safely recover the VM, then execute each remaining check with data preservation and pass/fail evidence. |
| R94-5 | Medium | The tested installer is unsigned (`NotSigned`). The local Sprint 9.4 rebuild differs in size/hash and was not installed. | Sign intended release artifact and publish exact SHA-256; validate the exact signed artifact. |
| R94-6 | Medium | Original aborted-state log has no definitive crash/abort code; host interruption is inferred. Active VM uses a preserved working VDI copy. | Retain original logs/disks; do not claim root cause without a corresponding VirtualBox or host event record. |
| R94-7 | High | Later guest input/agent stall persisted after saved-state resume; ACPI shutdown did not complete. A 40,761,294,848-byte saved-state VDI copy was full-hash verified against the active VDI at the saved point (`372945A0B5F1CA25EE688D3EBB7FA28554E14A5B6EF98F19913C959EBCA2608A`). No force reset was used. | Diagnose the guest/VirtualBox input stall using preserved logs and disk; resume native tests only when responsive. |

## Earlier A1–A7 disposition

- **A1 (SQLite):** prior WAL-size inference was wrong. Installed-app before/after SQL rows, `integrity_check=ok`, and post-restart onboarding/scan/quarantine records now pass.
- **A2/A3 (quarantine data loss):** the normal native quarantine/restart/restore/re-quarantine path passes, with encrypted blobs and metadata. Failure injection and purge remain R94-1/R94-2.
- **A4 (custom signature):** unique `.ndb` detection passes direct ClamAV and the installed GUI, corroborated by SQLite detection row.
- **A5 (single instance):** second process exited 0, one primary process remained and regained focus.
- **A6 (onboarding):** explicit completion wrote `onboardingCompleted=true`; the wizard was absent after a full Windows restart. Closing the wizard without completion intentionally wrote no setting.
- **A7 (clock/TLS):** the current guest UTC discrepancy is open as R94-3; a past FreshClam success does not resolve the current state.

No UI redesign or Intrusion Guard implementation was undertaken. Previous general product limits remain: manual scanning only, read-only firewall observation, loopback-only Web Guard, and unsigned development installer.
