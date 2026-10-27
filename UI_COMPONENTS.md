# CBS Shield — UI Components

**Version 0.6.0-dev** · React 19 + TypeScript · `ui/src/components/` and
`ui/src/theme.css`.

Every component below is used by at least one shipped screen. There are no
demonstration-only components in the product.

Sprint 5 adds `components/SetupWizard.tsx` (five-step first-run assistant) and the
firewall alert / connection / management blocks in `sections/Firewall.tsx`.
Sprint 6 adds the shared `lib/useFocusTrap.ts` used by `Modal` and `SetupWizard`,
plus the service-health, reference-vs-decision, snapshot SHA-256 and recovery-plan
blocks. They reuse the tokens and rules below; no separate visual language was
introduced.

---

## 1. `Badge`

`ui/src/components/Badge.tsx`

Small status pill. Always paired with a text label; `dot` adds a coloured dot so
state is not conveyed by colour alone.

```tsx
<Badge tone="ok" dot>À jour</Badge>
<Badge tone="neutral">Lecture seule</Badge>
```

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `tone` | `"ok" \| "warning" \| "danger" \| "neutral" \| "info"` | `neutral` | Maps to `--ok`, `--warning`, `--danger`, `--muted`, `--info` |
| `dot` | `boolean` | `false` | Leading 6 px dot |
| `subtle` | `boolean` | `false` | Transparent background variant |
| `className` | `string` | `""` | Layout hook |

Tone semantics are fixed across the app: `ok` = verified available, `warning` =
degraded/outdated, `danger` = unavailable/threat, `info` = observation,
`neutral` = metadata.

---

## 2. Buttons — `.button`

Buttons are plain `<button>` elements with a CSS family. No wrapper component,
so native keyboard and screen-reader behaviour is preserved.

| Class | Use |
| --- | --- |
| `.button--primary` | One per screen: main action (azure gradient, dark ink) |
| `.button--ghost` | Secondary action (bordered, transparent) |
| `.button--danger` | Destructive confirmation |
| `.button--danger-ghost` | Destructive secondary action |
| `.button--subtle` | Low-emphasis inline action |
| `.button--icon` | Square icon-only control (requires `aria-label`) |
| `.button--small` / `.button--lg` | Density variants |
| `.button--full` | Stretch inside a panel |

Rules: never place two primaries side by side; disabled buttons keep their
width; every icon-only button has an `aria-label`; loading uses a `spin` icon
and `disabled`, never a layout swap.

---

## 3. `Panel`

CSS class (`.panel`) rather than a component; the markup contract is:

```tsx
<section className="panel">
  <div className="panel__head">
    <div>
      <span className="panel__eyebrow">Moteur</span>
      <h2>ClamAV</h2>
    </div>
    <Badge tone="ok" dot>À jour</Badge>
  </div>
  {/* body */}
</section>
```

- `--panel` gradient + 1 px border + `--shadow-md`, 20 px radius, 22 px padding.
- `.panel--muted` lowers the surface for read-only/diagnostic blocks.
- `.panel__note` is the muted explanatory paragraph (12 px, `--faint`).
- `.panel__eyebrow` is the 9.5 px uppercase label above the title.

---

## 4. Metric card — `.metric-card`

Used on the dashboard for the four real signals (engine, signatures, last scan,
quarantine). Can be a `<button class="metric-card metric-card--link">` when it
navigates.

```tsx
<button type="button" className="metric-card metric-card--link" onClick={…}>
  <div className="metric-card__top">
    <div className="metric-card__icon metric-card__icon--ok"><ShieldCheck size={17} /></div>
    <Badge tone="ok" dot>Disponible</Badge>
  </div>
  <span className="metric-card__label">Moteur antivirus</span>
  <span className="metric-card__value">1.4.3</span>
  <span className="metric-card__hint">ClamAV local, invocation explicite</span>
</button>
```

- Hover: 1 px lift + border contrast (no colour flood).
- Icon tiles: `--ok` / `--warn` / `--danger` backgrounds at 12 % alpha.
- Values truncate with ellipsis rather than wrapping.

---

## 5. `EmptyState`

`ui/src/components/EmptyState.tsx`

```tsx
<EmptyState
  icon={FileSearch}
  title="Aucun scan enregistré"
  description="Lancez une première analyse…"
  action={<button className="button button--primary">Lancer un scan</button>}
/>
```

| Prop | Type | Required |
| --- | --- | --- |
| `icon` | `LucideIcon` | yes |
| `title` | `string` | yes |
| `description` | `string` | yes |
| `action` | `ReactNode` | no |

Visual: dashed `--border-strong` border, 26 px icon in an azure tile, centred
copy, one action. Used for empty history, empty quarantine, filtered-out tables
and error fallbacks.

---

## 6. `Modal`

`ui/src/components/Modal.tsx`

Accessible dialog shell used by scan details, updates confirmation and
quarantine actions.

| Prop | Type | Default |
| --- | --- | --- |
| `open` | `boolean` | — |
| `title` | `string` | — |
| `eyebrow` | `string` | — |
| `tone` | `Tone` | `info` |
| `onClose` | `() => void` | — |
| `children` | `ReactNode` | — |
| `footer` | `ReactNode` | — |
| `busy` | `boolean` | `false` |
| `wide` | `boolean` | `false` |

Behaviour: closes on Escape and backdrop click (unless `busy`), `role="dialog"`,
`aria-modal`, labelled title, blurred backdrop, scale-in animation, localised
close button (`common.close`). `useFocusTrap` focuses the first control, traps
Tab/Shift+Tab, locks body scroll and restores the previous focus on close.

---

## 7. `ConfirmDialog`

`ui/src/components/ConfirmDialog.tsx`

Security-critical confirmation built on `Modal`. Supports an acknowledgement
checkbox and a typed phrase.

| Prop | Type | Notes |
| --- | --- | --- |
| `description` | `ReactNode` | Consequence explanation |
| `confirmLabel` | `string` | Explicit verb ("Supprimer", "Télécharger") |
| `tone` | `Tone` | `danger` switches the confirm button to destructive |
| `requireCheckbox` | `string` | Checkbox label; confirm disabled until checked |
| `requirePhrase` | `string` | Exact phrase; confirm disabled until typed |
| `busy` | `boolean` | Locks the dialog during the operation |

Used by quarantine restore/delete and update consent flows. The confirm button
is never pre-enabled for destructive actions.

---

## 8. `ToastProvider` / `useToast`

`ui/src/components/Toasts.tsx`

```tsx
const toast = useToast();
toast({ tone: "success", title: "Paramètres enregistrés" });
toast({ tone: "error", title: "Mise à jour échouée", message });
```

- Tones: `success`, `error`, `info` (fixed icon per tone).
- Auto-dismiss after a few seconds, manual close button, stacked bottom-right,
  no focus stealing.
- Wrapped around `<App />` in `main.tsx`.

---

## 9. `Sidebar`

`ui/src/components/Sidebar.tsx`

- Three labelled groups: **Protection** (Dashboard, Antivirus, Scan history,
  Quarantine), **Observation** (Network, Firewall), **System** (Updates,
  Settings, About).
- Active item: gradient background, azure border, 3 px animated rail,
  `aria-current="page"`.
- Footer: live engine card (online dot pulses only when ClamAV is detected) and
  `v{version} · Experimental` meta.
- Labels come from `useI18n()`; every item has a `title` for icon-only collapse
  scenarios.

---

## 10. `TopBar`

`ui/src/components/TopBar.tsx`

Sticky header: breadcrumb, page title, one-line subtitle, engine pill
(version + signature count + state badge, tooltip = backend message) and a
refresh button with spinner.

| Prop | Type |
| --- | --- |
| `title` / `subtitle` | `string` |
| `engine` | `EngineStatus \| null` |
| `engineLoading` | `boolean` |
| `onRefresh` | `() => void` |

The engine pill never invents a state: when `engine` is `null` it shows the
diagnostic spinner, not "protected".

---

## 11. Filter bar & segmented control

Markup used by Scan history and Network monitor:

```tsx
<div className="segmented" role="group" aria-label="Résultat">
  <button type="button" className="is-active" aria-pressed={true}>Tous</button>
  <button type="button" aria-pressed={false}>Propres</button>
</div>
```

- `.segmented` = pill container; `.is-active` = azure tint + inner ring.
- `.input` = 34 px search field with icon; placeholder text is localised.
- `.filter-bar` lays out filters left and count/search right; wraps on narrow
  windows.

---

## 12. Tables

`.table-wrap` + `.table` (legacy classes, retuned in `theme.css`).

- Sticky uppercase header (9.5 px, 0.12em tracking).
- Hairline row separators, hover tint, `.num` right-aligned numeric cells.
- `.is-clickable` rows open a detail modal; the row also contains a real
  "Détails" button so keyboard users never depend on the click target.
- Horizontal scroll is contained inside `.table-wrap`, never on the page.

---

## 13. Info grid & status rows

- `.info-grid` / `.info-cell` — 2×2 metadata blocks (label uppercase 10 px,
  value 12.5 px). Used in scan details and About.
- `.status-row` — label + badge line used by the diagnostics page and the
  dashboard side panel. First row has no top border.
- `.detail-list` — legacy definition list used by engine/settings panels.

---

## 14. Freshness meter

`.freshness-bar` + `.freshness-bar__fill` (Updates page).

- Width = `min(signatureAgeDays / threshold, 1) × 100 %`, minimum 4 % so a fresh
  database is still visible.
- `is-fresh` (green→azure), `is-aging` (amber, > 60 %), `is-stale` (red, 100 %).
- Purely presentational: the authoritative state is the badge/text from the
  backend.

---

## 15. Skeleton

`.skeleton` — shimmer block used while `list_scans`, firewall observation or
network history are loading. Always sized to the eventual content to avoid
layout shift. `aria-busy="true"` on the containing region.

---

## 16. Event row & quick link

- `.event-row` — dashboard activity: 30 px tinted icon, title + detail, right
  timestamp. Whole row is a `<button>` navigating to history/quarantine.
- `.quick-link` — 3-column action row (icon, label, chevron) used for quick
  actions and diagnostics shortcuts.

---

## 17. Localisation helper

`ui/src/lib/i18n.tsx`

```tsx
const { t, language } = useI18n();
t("dashboard.stat.scans");                       // "Scans réalisés"
t("dashboard.event.scanThreats", { count: 3 });  // "3 menace(s) détectée(s)"
```

- Dictionaries are typed: a missing English key is a `tsc` error.
- Unknown keys fall back to the key itself (tested), so a forgotten translation
  degrades gracefully instead of crashing.
- Language is persisted by the backend and pushed to the native tray menu.

---

## 18. CSS utility reference

| Class | Purpose |
| --- | --- |
| `.section-stack` | Vertical stack, 20 px gap (page content) |
| `.section-view` | Page transition wrapper (fade + rise) |
| `.stack-gap` | 10 px vertical stack (skeleton groups) |
| `.button-row` / `.button-col` | Button layout helpers |
| `.inline-code` | Azure monospace chip for commands |
| `.log-view` | Scrollable mono log (freshclam output) |
| `.mono` | Monospace text for paths/hashes |
| `.muted` / `.faint` | Secondary and tertiary text |
| `.spin` | Infinite rotation for loaders |
| `.divider` | 1 px hairline separator (legacy) |

---

## 19. Component rules

1. No component reads Tauri APIs directly; data comes from props or
   `ui/src/lib/api.ts`.
2. No component owns a colour literal; use tokens.
3. Every async region has loading, error and empty states.
4. Every destructive action goes through `ConfirmDialog`.
5. Every status has a text label; colour is reinforcement only.
6. New components must be added to this file and to `DESIGN_SYSTEM.md`.
