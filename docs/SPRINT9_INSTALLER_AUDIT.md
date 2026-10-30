# Sprint 9.1 — Installer audit

**Version:** 0.9.0-dev · **Build:** `npm run build` (Tauri CLI) on Windows host.

## 1. Artefacts

| Artefact | Path | Size | SHA-256 |
|---|---|---|---|
| NSIS installer | `target/release/bundle/nsis/CBS Shield_0.9.0-dev_x64-setup.exe` | 2 903 396 bytes (2.77 MiB) | `D5A8B626A7797110AA8006F4AB69648A9A9F41581BA4BB08E32F33AE2F90B1FD` |
| Production executable | `target/release/cbs-shield.exe` | — | not separately hashed |

## 2. Executable metadata

- `FileVersion`: 0.9.0-dev
- `ProductVersion`: 0.9.0-dev
- `CompanyName`: Cybrense
- `ProductName`: CBS Shield (tauri.conf.json)

## 3. Authenticode

- Status: **NotSigned** (no code-signing certificate available in this
  environment). This is consistent with the Sprint 9 updater investigation:
  no unsigned release is published as trusted.
- No SmartScreen reputation; users will see the standard Windows warning.

## 4. What was verified vs. not

| Item | Status |
|---|---|
| Installer creation | Verified (bundle produced) |
| Executable version | Verified (0.9.0-dev) |
| Installer size + SHA-256 | Verified (above) |
| Authenticode signing status | Verified (NotSigned) |
| Installation + first launch | **Not executed** (host-install rule; VM validation blocked — see VM report) |
| Production UI without Vite/Node | Verified (production bundle runs standalone) |
| App restart | Not executed live |
| Uninstallation | Not executed |
| Preservation of user data | Not executed |
| No terminal/debug console | Production build (release profile, devtools off by default) |

## 5. Notes

- The production binary ran successfully on the host during native validation
  (window title `CBS Shield - Cybrense`, 1396×939).
- No installer was run on the host; the VM (`CBS-Shield-Sprint7`) was booted
  to confirm reachability but an in-VM install was not driven (no guest
  credentials/Guest Additions control path available from this host).
- SHA-256 is the trusted reference for any future installer distribution.
