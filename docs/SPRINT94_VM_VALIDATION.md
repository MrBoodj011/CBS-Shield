# Sprint 9.4 — Windows VM validation

**VM:** `CBS-Shield-Sprint7`, VirtualBox. **Dates:** 2026-11-01–02. **Status:** incomplete; release remains experimental.

## Recovery and preservation

The VM had been reported `aborted` on 2026-10-31 11:20:35 after host restart/sleep. Pre-recovery `VBox.log` (111,038 bytes) and `VBoxHardening.log` (546,741 bytes) were preserved in `target/sprint94-vm-evidence/Logs/`. `VBox.log` shows normal VM creation, power-on, and EFI boot but no definitive abort cause or Guru Meditation. `VBoxHardening.log` includes NVIDIA certificate-time warnings and a `dxgi.dll` open error, but does not establish them as the cause of the later abort. Host interruption is a plausible explanation from the prior evidence dossier, **not a proven log diagnosis**.

The original `target/sprint7-vm/CBS-Shield-Sprint7/CBS-Shield-Sprint7.vdi` (17,405,313,024 bytes) and `CBS-Shield-Sprint7-clean.vdi` (34,800,140,288 bytes) remain present. The registered VM currently uses `target/sprint94-vm-evidence/CBS-Shield-Sprint7-clean-backup.vdi` as its active disk; the separate `CBS-Shield-Sprint7-repair.vhd` also remains. No disk or snapshot was deleted. No host security or VirtualBox hardening setting was changed.

The registered VM was `running` at the start of this pass. The existing authenticated Windows session and the documented Sprint 9.2 HTTP queue/collector, guest PowerShell agent, VirtualBox keyboard scancodes, and `screenshotpng` capture were reused. A normal Windows restart was performed through the guest's **Shut down or sign out → Restart** menu. The VM rebooted and returned to the signed-in desktop; no credential or authentication bypass was used. The guest agent did not auto-relaunch, so the existing local `q92.ps1` was started again in that session. The post-restart agent and application checks completed.

## Installed artifact and native flow

The VM installer hash matched the Sprint 9.3 candidate `6AD6DCFDDDF57D502142B12DB6F5F78B865A56FC33C828B6FE7C70D9D0A92BFB`; install exit was 0. Installed `cbs-shield.exe` SHA-256 was `F45E91BBA007F8EE867ADF2BE0971BA408FEB15CD7990FFCFD264E4BA0E643BA` before and after reboot. See [installer audit](SPRINT94_INSTALLER_AUDIT.md).

The harmless `cbs94-qz-43eeae00.txt` fixture (69 bytes; SHA-256 `C693FE3234B88300D9CEB0A44935BB8F87A4FB012D684B09A4D8C1C928162090`) was detected by direct ClamAV and the installed app's custom GUI scan. The GUI quarantine confirmation was accepted, an encrypted 102-byte `.cbsq` blob appeared, and the source disappeared. After app restart, the GUI displayed one active item and the same blob. Explicit restore consent produced a file with the original SHA-256 and removed the blob. The SQL snapshot confirms the detection, scan, and restored audit row. See [quarantine E2E](SPRINT94_QUARANTINE_E2E.md) and [SQLite evidence](SPRINT94_SQLITE_PERSISTENCE.md).

The onboarding wizard had initially been closed, not completed. It was then taken through all five steps and “Finish setup” invoked. A full Windows restart followed; the reopened app had no wizard, and `settings.onboardingCompleted = 'true'` was read from the actual database. The restored fixture still had its original hash after reboot.

After reboot, a second native GUI scan found the same synthetic signature and an explicitly confirmed second quarantine created a distinct encrypted `.cbsq` blob and active SQLite row. The first, restored audit row remained. A separate byte-verified recovery copy of the harmless fixture was retained before any purge decision.

## Later VM stall and recovery limit

After the Network/Web Guard/Proactive/Settings page sweep, the guest agent stopped returning commands and the native desktop stopped responding to VirtualBox keyboard input. The guest clock continued to advance. `VBox.log` later recorded `VERR_PDM_NO_QUEUE_ITEMS` on two attempted keyboard operations; this is an input-queue error, not a proven cause of the guest stall. The next appearance/firewall probe never returned evidence, so it is not counted as passing.

`VBoxManage controlvm savestate` eventually completed. While the VM was suspended, the active 40,761,294,848-byte VDI was copied. The first concurrent copy had a mismatching hash, so it was replaced **after** the VM reached `saved`. Full SHA-256 of both the saved VM's active VDI and `target/sprint94-vm-evidence/CBS-Shield-Sprint7-pre-recovery-20261101.vdi` then matched: `372945A0B5F1CA25EE688D3EBB7FA28554E14A5B6EF98F19913C959EBCA2608A`. The current `VBox.log` and `VBoxHardening.log` were also copied into `target/sprint94-vm-evidence/` before the resume. The earlier pre-recovery logs and original disks remain untouched.

The saved VM resumed to `running`, but neither keyboard input nor the guest command agent recovered. A normal ACPI power-button request did not cause a shutdown within the observed interval. No forced power-off, reset, authentication change, or disk replacement was performed. The VM remains registered and running with its active disk intact. The verified VDI copy captures the disk at the saved-state point; later writes after resume are not asserted to be in that copy.

## Current limitations

- The guest reported `2026-11-02T04:01:19Z` while the host collector timestamp was 2026-11-01 20:15 UTC, about **7 hours 45 minutes ahead**. Guest audit timestamps and TLS update outcomes need a corrected guest timezone/clock before they can be used as time evidence.
- The later guest stall blocks the approved native purge, firewall/appearance probe, scan cancellation, shutdown, and uninstall checks. The VM was preserved rather than forcibly reset. Recovery now needs a controlled guest/VirtualBox diagnosis before these checks can continue.
- Explicit purge, scan cancellation, full monitor/theme/language/tray matrix, and uninstall are tracked in the [security regression report](SPRINT94_SECURITY_REGRESSION.md); no unexecuted check is counted as passing. Single-instance/focus passed in the installed app.
- Real native captures are in [`sprint94-screenshots/`](sprint94-screenshots/README.md). They are supporting visual evidence; file hashes and SQL rows are the primary evidence for data integrity.
