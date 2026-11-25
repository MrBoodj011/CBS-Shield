# Sprint 9.1 — Native test report

**Version:** 0.9.0-dev · **Reference commit:** 0160f2f (pre-9.1) → this sprint's commit
**Host:** Windows 11 dev machine, real production build (`target/release/cbs-shield.exe`, 0.9.0-dev).

## 1. Build and launch

- `npm run build` produced the production NSIS bundle and `target/release/cbs-shield.exe` (0.9.0-dev, Cybrense).
- The production binary launched successfully; window title `CBS Shield - Cybrense`; main window 1396×939.
- No Vite/Node.js runtime needed at runtime (production bundle).

## 2. Screenshots captured (real release application)

Saved under `docs/screenshots/` (PNG, 1396×939):
`01-dashboard.png`, `02-antivirus.png`, `03-proactive.png`, `04-webguard.png`,
`05-firewall.png`, `06-network.png`, `07-quarantine.png`, `08-history.png`,
`09-settings.png`, `10-about.png`.

## 3. Navigation coverage (keyboard, Tab/Enter)

All 11 sections reachable via the sidebar through keyboard Tab/Enter and
rendered their real content (no blank/placeholder states observed):
Dashboard, Antivirus, Proactive Monitor, History, Quarantine, Network Monitor,
Firewall, Web Guard, Updates, Settings, About.

## 4. What was verified vs. not

| Item | Status |
|---|---|
| Complete navigation + functional controls | Partially verified: sections render, buttons enabled/disabled by state, metric cards populated |
| Dashboard real security statuses | Verified visually (engine/signature status cards) |
| Antivirus scan + quarantine | Not exercised end-to-end in the GUI this run (engine present on host; manual UI flow not driven) |
| Proactive Monitor folder selection / baseline / pause-resume-stop / persistence | Verified visually; behaviour covered by 8 unit tests + 148-test workspace suite |
| Web Guard / Firewall Monitor | Visually rendered; read-only |
| FR/EN translations | Both languages present in i18n; spot-checked via Settings segmented control |
| Dark/light themes | Theme toggle present in Settings; not visually toggled this run |
| Keyboard accessibility | Tab/Enter navigation works across the sidebar and buttons |

## 5. Blockers encountered

- **EICAR notification test blocked by Microsoft Defender**: Defender
  prevents ClamAV from reading the EICAR test file (Windows error 225). This
  is the documented environment limitation, not a defect. No Defender exclusion
  was added.
- **Notification live test not executed** in the app GUI (no engine-driven
  detection available on this host without weakening Defender).
- **Tray right-click menu not exercised** (requires interactive shell; code
  path reviewed and compiled).
- **Light theme not captured** (dark theme default; toggle not driven this run).
- **Antivirus scan + quarantine not executed in the GUI** (file-dialog driven;
  engine CLI validated separately).

## 6. Honest conclusion

Native GUI validation is **partial**: the production application builds,
launches, renders all sections with real data, and is keyboard-navigable. Full
interactive acceptance (scan, quarantine, notifications, theme toggle) was not
completed on this host and is recorded as not executed, not as passed.
