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
| `16-clone-update-rollback.png` | Isolated clone reverting a failed Windows update | Boot diagnostic, not application acceptance |
| `17-clone-gui-unresponsive.png` | Clone's candidate app marked “Not Responding” | GUI scan result not obtained |
| `18-clone-after-reset.png` | Clone returned to signed-in desktop after reset | Does not establish app or database health |
| `19-fresh-empty-disk.png` | Newly created VM shows only an 80 GB unallocated disk at Windows Setup | Establishes clean disk selection, not completed installation |
| `20-fresh-first-boot.png` | Fresh VM reached Windows “Getting ready” | OS setup progress only |
| `21-fresh-oobe-wait.png` | Fresh VM at Windows “Just a moment...” | OOBE progress; later completed |
| `22-fresh-oobe-error.png` | OOBE update check displayed `OOBELOCAL` | Built-in retry subsequently succeeded |
| `23-fresh-desktop.png` | Standard local account signed in to fresh Windows desktop | Clean OS reached; application installed afterward |
| `24-fresh-first-run.png` | Exact candidate running on fresh Windows, showing dashboard after wizard dismissal | First native launch; SQL first-run snapshot gives database evidence |
| `25-purge-quarantine-page-1-active.jpg` | Quarantine page with `1 actif` before the approved purge (2026-11-05) | Blob identity is in guest filesystem output, not the image |
| `26-purge-dialog-opened.jpg` | Native purge dialog “Supprimer définitivement cet élément ?” | Caption matches `ui/src/components/ConfirmDialog.tsx` semantics |
| `27-purge-checkbox-and-typed-phrase.jpg` | Dialog with consent checkbox `On` and phrase input filled | Checkbox state and `PHRASE_VALUE=[SUPPRIMER]` echo are in guest output |
| `28-purge-after-confirm-zero-active.jpg` | Page after confirm: `0 actif` with purge toast | Blob removal = SQL decode in `target/sprint94-vm-evidence/db94afterpurge/` |

The guest clock was misconfigured; visible timestamps should not be used as an independent wall-clock reference.
