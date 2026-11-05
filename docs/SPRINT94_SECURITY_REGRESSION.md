# Sprint 9.4 — security regression and release gate

**Candidate:** installed `0.9.0-dev` from installer SHA-256 `6AD6DCFDDDF57D502142B12DB6F5F78B865A56FC33C828B6FE7C70D9D0A92BFB`. **Current release decision:** **experimental; no release acceptance**.

## Automated checks executed on 2026-11-01

| Check | Result | Evidence |
| --- | --- | --- |
| `cargo test --workspace -- --test-threads=4` | **136 passed, 0 failed, 1 ignored** | `target/sprint94-validation/cargo-test.log` |
| `npm --prefix ui test` | **37 passed / 11 files** | `target/sprint94-validation/ui-test.log` |
| `cargo fmt --all -- --check` | Pass | `target/sprint94-validation/cargo-fmt.log` |
| `cargo clippy --workspace --all-targets -- -D warnings` | Pass | `target/sprint94-validation/cargo-clippy.log` |
| `npm --prefix ui run build` | Pass | `target/sprint94-validation/ui-build.log` |
| `npm run build` (Tauri release + NSIS) | Pass | `target/sprint94-validation/production-build.log` |

The 136 Rust passes reconcile the earlier 132 figure: the four new `cbs-store/tests/persistence.rs` integration tests are included. The one ignored test is not counted as a pass. The 37 UI tests remain 37. The new local NSIS build had a different hash (`D8771319…469F`) and was **not** the guest-tested installer; see [installer audit](SPRINT94_INSTALLER_AUDIT.md).

## Native installed-app matrix

| Area | Result | Scope and limits |
| --- | --- | --- |
| Synthetic `.ndb` direct ClamAV | **Pass** | Original guest and fresh guest each detected a unique harmless token as `CBS94_Synthetic.UNOFFICIAL FOUND`; fresh ClamAV 1.5.4 archive SHA matched while Defender stayed active (`20261103-180510-agent92out.txt`) |
| Synthetic `.ndb` through CBS Shield GUI | **Pass** | Custom scan of exact fixture; same threat in UI and SQLite detection row |
| Quarantine → app restart → restore | **Pass** | Encrypted blob, metadata, active item after restart, original SHA-256 after restore |
| Onboarding persistence | **Pass** | Completed wizard; `settings.onboardingCompleted=true` after full Windows restart; wizard absent |
| SQLite scan/quarantine persistence and integrity | **Pass** | Actual before/after SQL rows, `integrity_check=ok`, schema version 2 |
| Single instance and existing-window focus | **Pass (2026-11-05 re-verified)** | 2026-11-05: after instance A (`1 process / 1 window`), a second `Start-Process` left exactly `1` process with `1` window, stable after settling (`target/sprint94-vm-evidence/sum94singleinst-result.txt`); earlier 2026-11-01 probe (`inbox/20261101-202018-agent92out.txt`) had second PID exit 0 and primary regain focus |
| Source missing, locked source, corrupt blob, concurrent stores | **Pass in Rust tests** | 14 `cbs-quarantine` tests; no distinct installed-GUI failure injection |
| Access denied and isolated disk-full | **Not executed** | No dedicated ACL/quota failure environment used; do not infer pass from lock/truncation tests |
| Second quarantine | **Pass** | Same synthetic detection; new encrypted blob and separate active SQL row; original audit row retained |
| Explicit purge | **Pass (2026-11-05)** | Exact approved item `67469744-b7ee-4046-87dd-e15f792cb1eb` purged through the native dialog: checkbox `On`, phrase `SUPPRIMER` typed, confirm enabled and invoked; blob count 1→0, page `0 actif` with toast; post-purge SQL row `status='deleted'`, first row still `restored`, integrity ok (`target/sprint94-vm-evidence/sum94p3purge2-result.txt`, `20261105-154941-agent92out.txt`) |
| Scan cancellation | **Not executed in GUI** | 2026-11-05 GUI attempts did not reach a running scan (edit-field discovery failed before start); Rust cancellation tests pass. Still open natively |
| Clean shutdown | **Pass (2026-11-05)** | `CloseMainWindow()` → `True`, process exited within 1 s on the original VM (`20261105-155051-agent92out.txt`); DB/WAL/SHM then copied and decoded with integrity ok |
| GUI failure injection (missing/locked source) | **Pass in Rust tests; GUI not executed** | 2026-11-05 GUI attempts produced no scan record (UIA field discovery); cover the 14 `cbs-quarantine` tests |
| Network Monitor | **Pass, read-only smoke check** | Native page opened; 20 TCP connections, 24 UDP ports, Ethernet interface and local capture displayed; no packet/content test |
| Firewall Monitor | **Not executed in 9.4** | Follow-up native probe did not run because the VM stalled; historical evidence does not count as a new pass |
| Web Guard | **Pass, page smoke check** | Native page opened; prototype stopped, loopback `127.0.0.1:5353`, system DNS health and 5 configured resolvers displayed; no DNS filtering test |
| Proactive Monitor | **Pass, page smoke check** | Native page opened; stopped/opt-in state and resource controls displayed; no file-change cycle test |
| Tray and native notifications | **Not executed in 9.4** | Historical evidence does not count as a new pass |
| FR/EN and dark/light | **Partial** | FR/dark visible in current captures; queued switch to EN/light did not return evidence before VM stall |
| Installer upgrade | **Pass, limited** | In-place upgrade of pre-existing 0.9.0-dev to fixed 0.9.0-dev; hash match and preserved DB files |
| Isolated clone follow-up | **Partial** | Owner-authorized clone booted after Windows update rollback; exact candidate upgraded with matching hash, new direct ClamAV fixture detected; app GUI stalled before a scan result |
| Fresh Windows VM follow-up | **Partial** | Owner-authorized 80 GB blank VDI completed Windows OOBE with a standard local account. Defender AV, real-time, and tamper protection were active. The exact audited candidate installed with exit 0 and expected installed-exe SHA-256. Native first launch and five-step onboarding passed; a reopened SQLite snapshot has `onboardingCompleted=true` and `integrity_check=ok`. Fresh scan/quarantine remain open. Windows bugchecked `0xA` before first app launch, so VM stability is also open |
| Uninstall and reinstall | **Not executed** | Defer until other VM checks and app-data backup are complete |

No real malware was used. Defender real-time and tamper protection were both reported active before the fixture scan. The application remains a manual experimental scanner; the firewall monitor is read-only and Web Guard's DNS prototype is local and stopped by default.

## Release gate

The formerly mandatory purge with typed confirmation was **executed and verified on 2026-11-05** on the recovered original VM: the approved exact item was purged through the native dialog (checkbox + `SUPPRIMER` phrase + enabled confirm), the vault emptied, and the post-purge SQLite snapshot (taken after a verified clean shutdown) shows the audit row `status='deleted'`, the first row still `restored`, and `integrity_check=ok`. See [quarantine E2E](SPRINT94_QUARANTINE_E2E.md) and [SQLite evidence](SPRINT94_SQLITE_PERSISTENCE.md).

Still open, and therefore keeping the decision at **experimental: no release acceptance**: the fresh-VM guest's native scan/quarantine flow (that VM also has open stability risk after the `0xA` bugcheck), native scan-cancellation observation, GUI failure injection (access-denied and disk-full), the full monitor/tray/notification/FR-EN/theme matrix, and uninstall/reinstall. The guest-clock discrepancy (R94-3) still makes original-guest timestamps non-authoritative. **Do not label Sprint 9.4 complete or promote this build.** See [risk register](SPRINT94_RISK_REGISTER.md).
