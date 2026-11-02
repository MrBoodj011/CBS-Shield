# Sprint 9.4 native VM screenshots

These are unmodified screenshots captured from the running `CBS-Shield-Sprint7` VirtualBox guest, not mockups. JPEGs were decoded from the guest agent's timestamped base64 posts in `target/sprint7-vm/inbox/`; PNGs came directly from `VBoxManage controlvm screenshotpng`. The original posts and current VM files remain in ignored `target/` evidence.

| File | Visible state | Limit |
| --- | --- | --- |
| `01-synthetic-detection.jpg` | Installed GUI after the custom scan | SQL and guest output establish exact detection and SHA-256 |
| `02-quarantine-confirmation.jpg` | Explicit GUI confirmation for the unique text fixture | Pre-action state |
| `03-quarantine-active.jpg` | Quarantine page with `1 actif` | Blob existence comes from guest filesystem output |
| `04-restart-item.jpg` | Unique item still present after app restart | GUI only; SQL snapshot corroborates |
| `05-restore-consent.jpg` | Restore warning and checkbox | The subsequent checkbox toggle and restore are in guest output |
| `06-restored.jpg` | Immediately after restore, with the onboarding wizard over the page | The actual byte equality is in guest hash output |
| `07-onboarding-finished.png` | Main quarantine page with restored audit row after finishing wizard | Captured after the restored file was verified |
| `08-single-instance-focused.png` | Existing window returned to the foreground after a second launch | Guest process probe establishes the one-process result |
| `09-second-detection.jpg` | Second custom scan result for restored fixture | SQL scan/detection rows corroborate |
| `10-second-quarantine-confirmation.jpg` | Second explicit quarantine confirmation | Pre-action state |
| `11-second-quarantined.jpg` | App after second quarantine | Guest filesystem and SQL verify new blob and active row |
| `12-network.jpg` | Network Monitor in installed GUI | Page smoke check; no packet capture assertion |
| `13-webguard.jpg` | Web Guard in installed GUI | Prototype stopped; no filtering assertion |
| `14-proactive.jpg` | Proactive Monitor in installed GUI | Monitor stopped; no observation assertion |
| `15-settings.jpg` | Settings page in installed GUI | FR/dark state; no language or theme change assertion |

The guest clock was misconfigured; visible timestamps should not be used as an independent wall-clock reference.
