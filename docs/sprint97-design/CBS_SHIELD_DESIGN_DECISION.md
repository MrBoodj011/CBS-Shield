# CBS Shield — Sprint 9.7 Design Decision Package

**Product:** CBS Shield by Cybrense
**Version:** 0.9.0-dev
**Date:** 2026-11-07
**Status:** For product-owner review — no redesign implemented pending approval

---

## 1. Design Artifacts

| Artifact | Path |
| --- | --- |
| Direction A — Dark PNG | `docs/sprint97-design/previews/direction-a-dark.png` |
| Direction A — Light PNG | `docs/sprint97-design/previews/direction-a-light.png` |
| Direction B — Dark PNG | `docs/sprint97-design/previews/direction-b-dark.png` |
| Direction B — Light PNG | `docs/sprint97-design/previews/direction-b-light.png` |
| Combined comparison board | `docs/sprint97-design/previews/CBS_SHIELD_DESIGN_COMPARISON.png` |
| Direction A mockup HTML | `docs/sprint97-design/direction-a-sprint97.html` |
| Direction B mockup HTML | `docs/sprint97-design/direction-b-sprint97.html` |

All four PNG variants and the combined comparison board are stored durably under `docs/sprint97-design/previews/` (not in a build-cache or ignored directory).

---

## 2. Design Direction Comparison

### Direction A — « Calme & Souverain » (Calm & Sovereign)

**Visual concept:** A single, calm dashboard with one large truthful security-status area, one prominent Scan action, and three category cards.

**Key characteristics:**
- **Status area:** One large hero panel with a status dot/label, headline ("Pas de protection en temps réel"), supporting text, and clear limitations
- **Primary action:** One large "Analyser maintenant" (Scan now) button — the only prominent call-to-action
- **Categories:** Three cards — Device (Appareil), Internet, Network (Réseau) — each with state, status chip, and description
- **Navigation:** Minimal — language/theme toggle bar only; no tab navigation
- **Tone:** Reassuring, minimalist, emphasizes what CBS Shield does NOT do (no real-time protection, no firewall changes)
- **Layout:** Panel-based, soft borders, generous whitespace, radial gradient background accents

### Direction B — « Console compacte » (Compact Console)

**Visual concept:** A denser, information-rich console with metric tiles, a status strip, a local log, and tab-based navigation across five sections.

**Key characteristics:**
- **Status area:** A status strip at the top with "Temps réel non disponible" chip
- **Primary action:** "Analyser maintenant" button in the dashboard card — prominent but one of several actions
- **Metrics:** Four metric tiles (Engine, Last scan, Quarantine, etc.) with large numbers
- **Navigation:** Five-tab navigation (Synthèse, Antivirus, Protection, Réseau, Réglages)
- **Additional panels:** Local log, three-domain table (Device/Internet/Network), shortcuts
- **Tone:** Informational, dashboard-like, exposes more detail at a glance
- **Layout:** Card-based grid, alert banners, compact spacing, orange accent banner

---

## 3. Comparison by Criterion

| Criterion | Direction A | Direction B | Assessment |
| --- | --- | --- | --- |
| **Simplicity** | One headline, one CTA, three cards, minimal chrome | Multiple tiles, tabs, log, table, 5 navigation tabs | **A wins** — far less cognitive load |
| **Navigation** | Language/theme toggle only; no section tabs | 5-section tab navigation | **A wins** — fewer paths to get lost in |
| **Clarity of protection status** | Single honest headline ("No real-time protection") + limitations paragraph | Status strip chip + metric tiles; status less prominent | **A wins** — truthfulness is unmistakable |
| **Accessibility** | Fewer interactive elements, high contrast, clear hierarchy | More controls, tabs, smaller text in tiles | **A wins** — simpler to navigate via keyboard/screen reader |
| **Visual coherence** | Consistent panel language, radial gradient accents, unified color system | Mix of alert banners, chips, tiles, tables, tabs | **A wins** — more cohesive visual system |
| **Light/Dark consistency** | Full light/dark theme system with adjusted accents | Full light/dark theme system | **Tie** — both implement both themes |
| **French/English readability** | Full FR/EN toggle with translated strings | Full FR/EN toggle with translated strings | **Tie** — both support both languages |
| **Technical implementation effort** | Lower — fewer components, simpler layout | Higher — tabs, tiles, log, table, 5 nav sections | **A wins** — faster to build, easier to maintain |

---

## 4. Recommendation

**Recommended: Direction A — « Calme & Souverain »**

**Reasoning:**

Direction A better aligns with CBS Shield's actual capabilities and the product's stated design principles:

1. **Truthful status communication:** CBS Shield is an experimental manual scanner with no real-time protection. Direction A's single prominent "No real-time protection" headline makes this limitation impossible to miss, whereas Direction B buries it in a status chip among metric tiles.

2. **Minimal navigation:** Direction A eliminates the 5-tab navigation that Direction B introduces. With few actual features in v0.9.0-dev, tab navigation would surface mostly empty or placeholder sections.

3. **One primary action:** "Scan now" is the only meaningful user action in the current version. Direction A makes it the sole prominent CTA; Direction B competes it with "View alerts", "Import list", "Start prototype", etc.

4. **Lower implementation risk:** Direction A's simpler layout requires fewer components and less CSS/JS, reducing the chance of introducing new responsive defects (the very issues Sprint 9.7 just fixed).

5. **Consumer-security-suite simplicity:** The product owner asked for an interface "comparable to the usability of mainstream consumer security suites." Direction A's hero + CTA + categories pattern is closer to that model than Direction B's dense console.

**Direction B is not rejected outright** — it could be reconsidered if CBS Shield adds more features (real-time monitoring, firewall configuration, etc.) in a future release. For v0.9.0-dev, Direction A is the stronger fit.

---

## 5. Implementation Note

Per the Sprint 9.7 directive: **no redesign implementation begins before explicit product-owner approval.** The HTML mockups and PNG previews exist solely for review. The React application continues to use its current UI unchanged.

---

## 6. Decision Required From Product Owner

- [ ] Approve Direction A for implementation
- [ ] Approve Direction B for implementation
- [ ] Request revisions to one or both directions
- [ ] Defer design decision to a future sprint
