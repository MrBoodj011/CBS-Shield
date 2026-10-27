# CBS Shield — Design System

**Version 0.5.0-dev (Sprint 5)** · Dark-first "Midnight Navy" interface for Windows 11.

This document is the reference for every visual decision in the interface. It is
implemented twice:

| Layer | File | Role |
| --- | --- | --- |
| Legacy base | `ui/src/styles.css` | Layout primitives from phases 1–2 (kept to avoid regressions). |
| Sprint 3–5 layer | `ui/src/theme.css` | Design tokens, premium navy palette, new components, wizard, motion. |

`theme.css` is imported after `styles.css` in `ui/src/main.tsx` and overrides the
legacy palette through CSS custom properties. No component hard-codes a colour.

---

## 1. Principles

1. **Truth over reassurance.** The interface never shows a green "protected"
   state unless the backend reports a real, usable engine. Real-time protection
   is explicitly labelled as inactive (CBS Shield has none).
2. **Calm authority.** Deep navy surfaces, restrained accents, one primary
   action per screen. Colour is reserved for state, not decoration.
3. **Local-first.** Every value displayed is read from the local backend
   (`engine_status`, `dashboard_stats`, `list_scans`, `netmon_*`,
   `firewall_status`, `get_settings`). No placeholder data.
4. **Native feel.** Segoe UI Variable, 10 px scrollbars, sticky top bar,
   220 ms transitions, reduced-motion support, keyboard-first focus rings.
5. **Progressive disclosure.** Summary first (hero + metric cards), detail on
   demand (modals, tables, diagnostics page).

---

## 2. Colour tokens

All tokens are defined in `:root` (dark) and overridden in
`[data-theme="light"]`. Themes are applied by `data-theme` on `<html>`.

### Surfaces (dark)

| Token | Value | Usage |
| --- | --- | --- |
| `--bg` | `#050b16` | Application background |
| `--bg-soft` | `#070f1d` | Secondary background |
| `--bg-elevated` | `#0b1626` | Elevated surfaces |
| `--panel` | `rgba(11, 22, 39, 0.82)` | Glass panels |
| `--panel-solid` | `#0b1728` | Opaque panels |
| `--panel-hover` | `rgba(21, 38, 61, 0.92)` | Hover state |
| `--border` | `rgba(122, 158, 209, 0.14)` | Default border |
| `--border-strong` | `rgba(122, 158, 209, 0.26)` | Hover / focus border |
| `--hairline` | `rgba(122, 158, 209, 0.1)` | Table & list separators |

The body background is a three-layer gradient: a blue glow top-right, a teal
glow bottom-left, and a vertical navy gradient. It is `background-attachment:
fixed` so scrolling never reveals a seam.

### Text

| Token | Dark | Light | Usage |
| --- | --- | --- | --- |
| `--text` | `#eaf1fb` | `#0d1a2b` | Primary text |
| `--text-soft` | `#c4d3e7` | `#2b3e56` | Body copy |
| `--muted` | `#8ba0bb` | `#5a6d85` | Secondary labels |
| `--faint` | `#617592` | `#8394a9` | Metadata, captions |

### State & brand

| Token | Dark | Meaning |
| --- | --- | --- |
| `--accent` | `#4ea7ff` | Brand azure, primary actions, focus |
| `--accent-2` | `#3ee0c0` | Secondary brand (gradients, active rail) |
| `--accent-ink` | `#03121f` | Text on azure fills |
| `--ok` | `#3fe0a6` | Available / clean / fresh |
| `--warning` | `#ffb454` | Degraded / outdated / attention |
| `--danger` | `#ff6178` | Unavailable / threats / destructive |
| `--info` | `#74a9ff` | Read-only observation, neutral facts |

Each state colour also has a `-soft` variant (12 % alpha) for icon tiles and
tinted badges: `--accent-soft`, `--ok-soft`, `--warning-soft`, `--danger-soft`,
`--info-soft`.

**Contrast:** all text tokens exceed WCAG AA on their intended surface. State is
never conveyed by colour alone — badges always include a text label and a dot.

---

## 3. Typography

| Role | Family | Size / weight |
| --- | --- | --- |
| Display / headings | `Segoe UI Variable Display` (`--font-display`) | 23 px / 720 (page title), 18–31 px / 750 (hero) |
| Body | `Segoe UI Variable Text` (`--font`) | 14 px / 400–520 |
| Section title | `--font-display` | 15.5 px / 680 |
| Eyebrow / nav group | `--font` | 9.5 px / 650, `0.17em` tracking, uppercase |
| Metric value | `--font-display` | 21 px / 720, tabular feel |
| Code / paths | `Cascadia Code` (`--mono`) | 11–12 px |

Body copy uses `-webkit-font-smoothing: antialiased` and OpenType features
`ss01`, `cv05` for a crisper Windows 11 feel.

Line height is 1.55 for body and 1.2 for headings. Headings use negative
letter-spacing (`-0.015em` to `-0.035em`) to read as a product, not a document.

---

## 4. Spacing, radius, elevation

- **Spacing scale:** 2, 4, 6, 8, 10, 12, 14, 16, 20, 26, 32 px (multiples of 2).
- **Radii:** `--radius-xs` 8 · `--radius-sm` 10 · `--radius` 14 ·
  `--radius-md` 16 · `--radius-lg` 20 · `--radius-xl` 26 px.
  Pills use `999px`.
- **Elevation:**
  - `--shadow-sm` subtle hover lift;
  - `--shadow-md` standard panels;
  - `--shadow-lg` hero, modals;
  - `--shadow-glow` focus/selected emphasis.

Panels combine a 1 px border, a diagonal gradient and a soft shadow — never a
flat grey box. Hover raises the border contrast, not the background brightness.

---

## 5. Motion

| Token | Value | Usage |
| --- | --- | --- |
| `--motion-fast` | `140 ms` | Hover, colour, border |
| `--motion` | `220 ms` | Buttons, badges, modal |
| `--motion-slow` | `380 ms` | Page transitions, freshness bar |
| `--ease` | `cubic-bezier(0.22, 0.61, 0.36, 1)` | Default easing |

Defined animations:

- `section-enter` — 10 px rise + fade when switching sections (`.section-view`).
- `cbs-spin` — refresh/loader icons.
- `pulse-dot` — engine status dot (2.6 s, only when online).
- `orbit` — dashed ring around the dashboard shield (26 s).
- `shimmer` — skeleton loading.
- `modal-in`, `fade-in`, `toast-in` — overlays.

**Reduced motion:** `@media (prefers-reduced-motion: reduce)` collapses every
animation/transition to `0.001ms` and disables smooth scrolling.

---

## 6. Layout

```
┌───────────────┬──────────────────────────────────────────────┐
│ Sidebar 268px │ TopBar (sticky, blurred, 1px hairline)       │
│ brand         ├──────────────────────────────────────────────┤
│ nav groups    │ Content (max 1560px, 30px gutter, 20px gap)  │
│  Protection   │  hero / metrics / panels / tables            │
│  Observation  │                                              │
│  System       │                                              │
│ engine card   │                                              │
└───────────────┴──────────────────────────────────────────────┘
```

- Sidebar: three labelled groups (Protection, Observation, Système), 11 px
  radius items, 3 px gradient active rail, engine status card pinned bottom.
- Top bar: 23 px page title, breadcrumb, subtitle, engine pill, refresh action.
- Content: fluid, `max-width: 1560px`, centred.
- Breakpoints: `1240px` (metrics 4→2, dashboard 2 cols→1), `1120px` (sidebar
  232px, update/about grids 2→1), `980px` (hero visual hidden).
- Window constraints: 1380×900 default, **1080×700 minimum** (native config).

Grids:

- `.metric-grid` — 4 equal cards (2 on narrow).
- `.dash-grid` — activity (1.5fr) + diagnostics (0.9fr).
- `.update-grid`, `.about-grid` — 2 equal columns, collapse to 1.
- `.info-grid` — 2×2 metadata cells.

---

## 7. Iconography

- Library: **Lucide** (`lucide-react`), tree-shaken.
- Sidebar: 18 px, stroke 1.9. Cards: 15–17 px. Hero orb: 56 px, stroke 1.25.
- Icons are always `aria-hidden` when paired with a visible label.
- Enabled-state icon tiles use the matching `-soft` background at 30×30 px,
  9 px radius.

Icon meanings are stable across the product: shield = antivirus/protection,
archive = quarantine, activity = network, flame = firewall, database =
signatures, refresh = updates, info = diagnostics.

---

## 8. Component states

| State | Treatment |
| --- | --- |
| Loading | `.skeleton` shimmer blocks; buttons keep width and show `spin` icon |
| Empty | `.empty` dashed panel, 26 px icon tile, title, explanation, one action |
| Error | `.banner--danger` with cause text and a single retry button |
| Degraded | amber badge + explanatory sentence from the backend |
| Read-only | `info` badge labelled explicitly, never a fake toggle |
| Disabled | 45 % opacity, no hover lift, `cursor: not-allowed` |

Status text comes from the backend. When the backend is unreachable a persistent
banner appears at the top of the content; individual modules keep their last
known value and mark it as unavailable.

---

## 9. Accessibility

- Visible focus ring: 2 px `--accent` + 2 px offset on every interactive element;
  inputs additionally receive a 3 px `--ring` halo.
- Sidebar items expose `aria-current="page"`; filters use `aria-pressed`.
- Modals are `role="dialog"`, `aria-modal`, labelled by their title, close on
  Escape and backdrop click (unless busy); focus returns to the page on close.
- All interactive elements are native `<button>` / `<input>` / `<a>` — no
  clickable `div`.
- Tables have a header row; row-level actions are real buttons reachable by Tab.
- Reduced-motion and Windows high-contrast colours are respected.
- Language, theme and viewport changes never reset the current section.

---

## 10. Localization architecture

- `ui/src/lib/i18n.tsx` — typed dictionaries (`fr`, `en`) and `I18nProvider`.
  Adding a key to `fr` is a compile error until it exists in `en`.
- `translate(language, key, vars)` is pure and unit-tested; `useI18n()` provides
  `{ language, t }` to components.
- The selected language is stored by the Rust backend (`settings.language`,
  values `fr` / `en`) so it survives restarts and is shared with the native tray
  menu (`set_tray_language`).
- Numbers and dates remain `fr-FR` formatted in both languages because scan
  reports are French-labour documents; this is documented as a known limitation.
- Coverage in 0.3.0: application shell, navigation, dashboard, history, updates,
  about/diagnostics, modal close label and common primitives. Antivirus,
  quarantine, network, firewall and settings keep their French copy until their
  migration — no half-translated screen is shipped.

---

## 11. Native experience

- Window: 1380×900, centred, minimum 1080×700, title `CBS Shield — Cybrense`,
  native decorations retained.
- Tray icon: left-click restores/focuses the window; right-click menu contains
  *Open CBS Shield* / *Quit* in the selected language. Closing the window keeps
  the normal Windows behaviour — the tray never hijacks close, minimise or
  startup behaviour.
- No console: release builds embed the compiled UI; no dev server, no DevTools
  panel, no terminal.
- Theme follows the stored preference (`dark` / `light` / `system`).

---

## 12. File map

| Path | Responsibility |
| --- | --- |
| `ui/src/theme.css` | Tokens + Sprint 3 component layer |
| `ui/src/styles.css` | Legacy layout and tables |
| `ui/src/lib/i18n.tsx` | Localization provider and dictionaries |
| `ui/src/components/` | Badge, Modal, ConfirmDialog, Toasts, Sidebar, TopBar, EmptyState, Logo |
| `ui/src/sections/` | Dashboard, Antivirus, History, Quarantine, NetworkMonitor, Firewall, Updates, Settings, About |
| `src-tauri/src/tray.rs` | Native tray integration |
| `src-tauri/src/commands/settings.rs` | Persisted preferences (theme, language, thresholds) |
