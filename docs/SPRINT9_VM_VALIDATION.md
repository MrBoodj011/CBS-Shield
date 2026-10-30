# Sprint 9.1 — VM validation

**VM:** `CBS-Shield-Sprint7` (VirtualBox, 6 GB RAM, Windows 11).
**State before:** poweroff · **State after:** poweroff (restored).

## 1. What was done

- Started the VM headless via `VBoxManage startvm ... --type headless`:
  succeeded, VM reached `running`.
- Captured a guest screenshot (`controlvm screenshotpng`): 1024×768, VM
  boots to a desktop.
- Powered the VM off cleanly (`controlvm poweroff`): returned to `poweroff`.

## 2. What was NOT done (and why)

The full installer validation matrix (fresh install, portable ClamAV
provisioning, signature updates, Quick/Custom scan, synthetic detection,
quarantine, restore/purge, restart, persistent settings, upgrade, uninstall,
recovery from failures) was **not executed** in the VM because:

- No guest credentials or Guest Additions control path is available from this
  host to drive the installer inside the guest programmatically.
- The VM is the same Sprint 7 VM with prior state; its stability history
  (Sprint 8) makes an unattended full run unreliable.
- The host-install rule forbids running the installer on the dev host.

## 3. Distinguishing successful host tests from missing clean-machine validation

| Validation | Where | Status |
|---|---|---|
| Production binary builds and launches | Host | Verified |
| Engine + signatures (3.6M viruses) | Host | Verified (ClamAV CLI) |
| Proactive Monitor unit tests (8) + workspace (148) | Host | Verified |
| UI build + vitest (34) + tsc | Host | Verified |
| Installer creation + SHA-256 + version | Host (build only) | Verified |
| Full installer install/uninstall on a clean machine | VM | **Not executed** |
| Portable ClamAV provisioning end-to-end | VM | **Not executed** |
| Native GUI E2E (scan, quarantine, notifications) | VM/Host | **Not executed** (host run was observation-only) |

## 4. Conclusion

Clean-machine validation remains **blocked**. The host-side evidence is real
but does not substitute for an isolated install/uninstall run. No success is
claimed for the unexecuted items.
