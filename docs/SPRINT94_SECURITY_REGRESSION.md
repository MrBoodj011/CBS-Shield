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
| Synthetic `.ndb` direct ClamAV | **Pass** | Unique harmless token, `CBS94_Synthetic.UNOFFICIAL FOUND` |
| Synthetic `.ndb` through CBS Shield GUI | **Pass** | Custom scan of exact fixture; same threat in UI and SQLite detection row |
| Quarantine → app restart → restore | **Pass** | Encrypted blob, metadata, active item after restart, original SHA-256 after restore |
| Onboarding persistence | **Pass** | Completed wizard; `settings.onboardingCompleted=true` after full Windows restart; wizard absent |
| SQLite scan/quarantine persistence and integrity | **Pass** | Actual before/after SQL rows, `integrity_check=ok`, schema version 2 |
| Single instance and existing-window focus | **Pass** | Second PID exited 0; one process remained; minimized primary window restored and focused (`inbox/20261101-202018-agent92out.txt`) |
| Source missing, locked source, corrupt blob, concurrent stores | **Pass in Rust tests** | 14 `cbs-quarantine` tests; no distinct installed-GUI failure injection |
| Access denied and isolated disk-full | **Not executed** | No dedicated ACL/quota failure environment used; do not infer pass from lock/truncation tests |
| Second quarantine | **Pass** | Same synthetic detection; new encrypted blob and separate active SQL row; original audit row retained |
| Explicit purge | **Approved, not executed** | Owner approved exact item `67469744-b7ee-4046-87dd-e15f792cb1eb`; VM stalled before native action; verified separate recovery copy retained |
| Scan cancellation and clean shutdown | **Not executed** | Must be observed in installed app |
| Network Monitor | **Pass, read-only smoke check** | Native page opened; 20 TCP connections, 24 UDP ports, Ethernet interface and local capture displayed; no packet/content test |
| Firewall Monitor | **Not executed in 9.4** | Follow-up native probe did not run because the VM stalled; historical evidence does not count as a new pass |
| Web Guard | **Pass, page smoke check** | Native page opened; prototype stopped, loopback `127.0.0.1:5353`, system DNS health and 5 configured resolvers displayed; no DNS filtering test |
| Proactive Monitor | **Pass, page smoke check** | Native page opened; stopped/opt-in state and resource controls displayed; no file-change cycle test |
| Tray and native notifications | **Not executed in 9.4** | Historical evidence does not count as a new pass |
| FR/EN and dark/light | **Partial** | FR/dark visible in current captures; queued switch to EN/light did not return evidence before VM stall |
| Installer upgrade | **Pass, limited** | In-place upgrade of pre-existing 0.9.0-dev to fixed 0.9.0-dev; hash match and preserved DB files |
| Uninstall and reinstall | **Not executed** | Defer until other VM checks and app-data backup are complete |

No real malware was used. Defender real-time and tamper protection were both reported active before the fixture scan. The application remains a manual experimental scanner; the firewall monitor is read-only and Web Guard's DNS prototype is local and stopped by default.

## Release gate

The mandatory end-to-end sequence is not complete until the approved explicit purge, retained audit row, and post-action database integrity are proven. A later VM stall blocked that action and the remaining native matrix; saved-state recovery and a hash-verified VDI copy are documented in [VM validation](SPRINT94_VM_VALIDATION.md). Native failure injection and the wider monitor/installer matrix also remain open. The guest clock is about 7 hours 45 minutes ahead of host UTC, making time-based TLS and audit assertions unreliable. **Do not label Sprint 9.4 complete or promote this build.** See [risk register](SPRINT94_RISK_REGISTER.md).
