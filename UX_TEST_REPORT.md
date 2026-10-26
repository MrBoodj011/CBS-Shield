# CBS Shield — UX Test Report

**Version tested:** 0.3.0-dev (Sprint 3)
**Date:** 26 October 2026
**Branch:** `sprint-3` (base `a2cc990`, Sprint 2 validated first)
**Tester:** automated agent session on the project workstation, driving the real
Tauri window through the WebView2 debugging protocol.

This report only records what was **actually executed**. Items that were not
tested are listed as limitations, never as passes.

---

## 1. Environment

| Element | Value |
| --- | --- |
| OS | Windows 11 Home, build 26200 |
| Runtime UI | WebView2 Runtime 155 |
| Rust / toolchain | 1.99.1, MSVC |
| Node.js / npm | 24.18 / 12 |
| ClamAV | 1.5.4 (`C:\Program Files\ClamAV`) |
| Signature base | version `28164`, age 1 day at test time |
| Window | 1380×900 default, minimum 1080×700 |
| Build under test | debug binary + Vite (live UI), then NSIS release build |

The UI was driven in the **native Tauri window** (`cbs-shield.exe`), not in a
browser. All screenshots in `SCREENSHOTS/` were produced by `Page.captureScreenshot`
on that window (CDP port 9222), at the real window size. The final set (01–15) was
recaptured from the **release binary** served at `http://tauri.localhost/` with no
Vite server running (§ 8).

---

## 2. Automated evidence

| Check | Command | Result |
| --- | --- | --- |
| Rust unit + integration | `cargo test --workspace` | **64 passed, 0 failed, 1 ignored** (EICAR manual) |
| Rust formatting | `cargo fmt --all -- --check` | Clean (exit 0) |
| Rust lints | `cargo clippy --workspace --all-targets -- -D warnings` | Clean (exit 0) |
| TypeScript + bundle | `npm run ui:build` | `tsc --noEmit` + Vite OK, 54.99 kB CSS / 361.86 kB JS |
| UI tests | `npm run ui:test` | **17 passed / 17**, 6 files |
| Native build | `npm run build` | NSIS installer 2.42 MiB, unsigned; release exe verified without Vite (§ 8) |

Rust test distribution:

- `cbs-core`: 20 unit + 3 integration (+1 ignored EICAR) + 2 mission E
- `cbs-firewall`: 3
- `cbs-netmon`: 7 (3 new filter-layer tests)
- `cbs-quarantine`: 9
- `cbs-shield`: 13 (language validation added)
- `cbs-store`: 7

New Sprint 3 UI tests:

- `ui/src/lib/i18n.test.ts` — FR/EN dictionaries, interpolation, unknown-key fallback.
- `ui/src/sections/Dashboard.test.tsx` — never claims full protection when ClamAV
  is absent; renders real engine/signature/quarantine/traffic values.
- `ui/src/sections/History.test.tsx` — persisted scans, filtering, details modal
  with stored detections.

---

## 3. Real-data integrity

Values observed on the test machine during the session (not fixtures):

| Signal | Observed |
| --- | --- |
| Antivirus engine | ClamAV **1.5.4**, `clamscan` + `freshclam` found |
| Signatures | **28164**, age **1 day**, state *Up to date* / *À jour* |
| Scans in history | **3** (1 clean, 2 detections from the benign NDB test) |
| Quarantine | 0 active / 0 restored at test time |
| Firewall (OS) | All three profiles **disabled** — confirmed independently |
| Network interfaces | `Tailscale`, `Wi-Fi` (NDIS filter layers excluded) |
| Network idle | ~13 KB per 5 s window |
| Product version | `0.3.0-dev` (backend `app_info`) |

**Firewall cross-check.** The app displayed “Pare-feu inactif” / all profiles
*Désactivé*. This is truthful: `Get-NetFirewallProfile` returned `Enabled=False`
for Domain, Private and Public, and `netsh advfirewall show allprofiles state`
returned `OFF` for all three. CBS Shield performed **no change** to the firewall.

**No false reassurance.** With ClamAV missing or signatures stale, the hero,
cards and diagnostics move to *degraded* / *unavailable*; “real-time off” is always
displayed. The dashboard test asserts that neither “entièrement protégé” nor
“fully protected” can appear.

**Network counter correction.** A controlled 20 MiB download measured **160 Mo**
before the NDIS sub-layer fix and **24.6 Mo** after (1.17× overhead). Before the
fix, seven filter layers duplicated the same bytes (see `SECURITY_AUDIT.md` A‑10).

---

## 4. Screenshot evidence (real window)

| File | Content |
| --- | --- |
| `01-dashboard-fr.png` | Dashboard, FR, dark — real engine/signatures/scan/quarantine/firewall |
| `02-history-fr.png` | Scan history: 3 real reports, outcome filters, search |
| `03-history-details.png` | Stored report modal (targets, engine, detections) |
| `04-updates-fr.png` | Updates: engine paths, signature age meter, freshclam log area |
| `05-updates-confirm.png` | Explicit freshclam confirmation (not executed) |
| `06-about-fr.png` | About & diagnostics: versions, paths, live module states |
| `07-antivirus-fr.png` | Antivirus (legacy module, new design layer) |
| `08-quarantine-fr.png` | Quarantine: 2 historical items (0 active), restore/purge actions |
| `09-network-fr.png` | Network monitor after NDIS fix (Tailscale + Wi-Fi only) |
| `10-firewall-fr.png` | Firewall read-only, profiles truthfully disabled at OS level |
| `11-settings-fr.png` | Settings + interface language control |
| `12-dashboard-en-dark.png` | Dashboard, English, dark |
| `13-dashboard-en-light.png` | Dashboard, English, light theme |
| `14-dashboard-fr-1080.png` | Minimum window 1080×700, no overflow, full nav |
| `15-about-en.png` | About & diagnostics in English (release build) |

---

## 5. Manual checks performed

### 5.1 Window & navigation

- Native window title read from the OS: **`CBS Shield — Cybrense`**.
- All 9 sections opened through the real sidebar: Dashboard, Antivirus, Scan
  history, Quarantine, Network, Firewall, Updates, Settings, About.
- Active item exposes `aria-current="page"` (verified in the DOM).
- Section switches animate in (380 ms rise/fade) with no layout jump; scroll
  position resets to top.

### 5.2 Keyboard & focus

Three consecutive **real Tab key events** (CDP `Input.dispatchKeyEvent`) moved
focus through the dashboard metric cards. Each focused element reported:

```
outline: solid 2px rgb(78, 167, 255)
focusVisible: true
```

`Escape` closed both the scan-report modal and the freshclam confirmation;
focus returned to the page. Filter buttons expose `aria-pressed`. Row actions are
real `<button>` elements, so the table is operable without a mouse.

### 5.3 Language

- FR → EN switched **live**, without reload: nav groups, page titles/subtitles,
  dashboard, history, updates, about, badges and modal labels.
- The preference is stored in SQLite (`settings.language`) and re-applied after a
  full app restart (verified during the session).
- The native tray menu language is synchronised: `set_tray_language` returned
  **`true`** (tray exists and its menu was rebuilt).
- Legacy modules (Antivirus, Quarantine, Network, Firewall, Settings body) remain
  French by design — see limitations.

### 5.4 Theme

- Dark is the default; light theme is fully tokenised (no dark-only leftovers in
  the screenshots).
- Switching theme saves immediately through the same settings command as the
  language (persisted in SQLite); the language preference from that command was
  verified across a full app restart.

### 5.5 Minimum window size

At the configured minimum (1080×700, inner viewport 1064×661):

- `document.documentElement.scrollWidth === innerWidth` → **no horizontal overflow**;
- sidebar navigation fits without an internal scrollbar after the compact-height
  rules (`max-height: 780px`);
- top-bar subtitle remains visible;
- dashboard metrics fall back to a 2-column grid.

### 5.6 Native tray

- Tray icon created at startup with the window icon; menu contains *Ouvrir CBS
  Shield* / *Quitter* (or *Open CBS Shield* / *Quit*).
- The implementation focuses/restores the main window on left-click and never
  intercepts the close button (no close-to-tray).
- Existence and menu rebuild were verified programmatically (`true` result);
  clicking through the native menu was not automated (limitation).

---

## 6. Sprint 3 requirements — status

| Requirement | Status | Evidence |
| --- | --- | --- |
| Sprint 2 regression validation | Done | 64 Rust + 17 UI tests, real flows unchanged |
| Design system documented | Done | `DESIGN_SYSTEM.md` |
| Component catalogue | Done | `UI_COMPONENTS.md` |
| FR/EN architecture | Done (partial coverage documented) | `i18n.tsx`, screenshots 12/13 |
| Real-data dashboard | Done | screenshot 01, § 3 |
| No false “fully protected” | Done | dashboard test + degraded states |
| Redesigned pages | Done (9 sections) | screenshots 01–11 |
| Native UX polish | Done | title, tray, min size, transitions |
| QA with real screenshots | Done | 15 captures from the native window (release binary) |
| Updated tests | Done | 17 UI tests / 64 Rust |
| Release build | Done | see § 8 |
| Documentation & status | Done | README, DEVELOPMENT_STATUS, SECURITY_AUDIT |
| No Defender/firewall changes | Respected | read-only code paths, OS state unchanged |
| No remote push | Respected | commit only, on `sprint-3` |

---

## 7. Known UX limitations

1. **Partial localisation.** Antivirus, Quarantine, Network, Firewall and the
   Settings body are still French; dates and numbers stay `fr-FR` in both
   languages. The shell, dashboard, history, updates, about and shared primitives
   are fully translated. This is deliberate: no half-translated screen ships.
2. **No real-time protection.** All states say so explicitly; Microsoft Defender
   remains the primary protection and is never modified.
3. **ClamAV is not bundled.** The installer is small; users install ClamAV via
   `winget install Cisco.ClamAV`. The app guides them and detects existing paths.
4. **Freshclam was not re-executed during this QA pass.** The confirmation modal
   was verified; the signature base was already 1 day old. The update path itself
   was validated in Sprint 2 and its unit/integration tests still pass.
5. **Firewall was disabled at OS level on this machine.** The app reports that
   truthfully. The read-only behaviour does not depend on the profile state, but
   an enabled-profile machine was not part of this session.
6. **Native tray interaction not automated.** Creation, menu language rebuild and
   the handlers were verified in code and via command result; visually clicking
   the notification-area menu was not scripted.
7. **Accessibility coverage is partial.** Focus rings, `aria-current`,
   `aria-pressed`, dialog semantics and keyboard operation were checked manually;
   NVDA/Narrator and Windows high-contrast mode were not tested.
8. **No clean-machine validation.** Everything ran on the existing development
   workstation. The installer was produced and inspected, not installed on a
   fresh VM.
9. **Installer is not code-signed** (no certificate configured); Windows
   SmartScreen may warn. This is unchanged from earlier phases.
10. **Dev vs release UI path.** A plain `cargo build --release` embeds the dev URL;
    only `npm run build` (Tauri) bundles `ui/dist`. The shipped installer was built
    with `npm run build` and the release binary was verified without Vite (§ 8).

---

## 8. Release build verification

**Build command:** `npm run build` (Tauri). `beforeBuildCommand` runs
`npm run ui:build`; `frontendDist` is `../ui/dist`, so the interface is embedded
in the executable. A plain `cargo build --release` would instead embed the dev URL
and was **not** used for the shipped artifact.

| Artifact | Value |
| --- | --- |
| Installer | `target\release\bundle\nsis\CBS Shield_0.3.0-dev_x64-setup.exe` |
| Installer size | **2,534,183 bytes (2.42 MiB)**, built 26 Oct 2026 12:03 |
| Installer SHA-256 | `58BBD3717367D7BA165CE29104578242322AA69CF31C0A2E7632EA764E460D27` |
| Code signature | **NotSigned** (`Get-AuthenticodeSignature` → `NotSigned`) |
| Executable | `target\release\cbs-shield.exe`, 7,033,856 bytes |
| Install mode | NSIS `currentUser` (no elevation) |

**Runtime verification without Vite.** The Vite listener on port 1420 was stopped
and confirmed absent (`Get-NetTCPConnection` → no listener). The release binary was
then started with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
(a test-only WebView2 flag, not a build feature). The live page reported:

```json
{"href":"http://tauri.localhost/","title":"CBS Shield — Cybrense"}
```

- navigation and hero rendered from the embedded bundle (no `localhost:1420`);
- live backend data present: ClamAV 1.5.4, signatures 28164, 3 scans, 0 active
  quarantine;
- language FR↔EN, theme dark↔light and the 1080×700 resize were re-exercised on
  this release instance;
- `set_tray_language` returned `true`;
- `aria-current="page"` present and `scrollWidth === innerWidth` at both sizes;
- screenshots 01–15 were recaptured from this instance, then the app was closed and
  the preference restored to French + dark.

**Not done:** the NSIS installer was built and inspected, but **not installed on a
clean machine/VM**. The release executable was run in place. Code signing is not
configured, so SmartScreen may warn.

---

## 9. Reproduce

```powershell
# Backend
cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings

# Frontend
npm run ui:build
npm run ui:test

# Live UI (debug app + Vite on 1420, CDP on 9222)
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
Start-Process target\debug\cbs-shield.exe
node target\shot.mjs SCREENSHOTS\capture.png

# Release
npm run build
```

`target/cdp.mjs`, `target/shot.mjs` and `target/key.mjs` are development-only
helpers and are git-ignored.
