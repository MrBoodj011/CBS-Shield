# Sprint 9 — Rapport de tests / Test report

**Version:** `0.9.0-dev` · Branche `sprint-9` · Date: 2026-10-30

## 1. Commandes exécutées sur la machine de développement (Windows)

| Commande | Résultat |
|---|---|
| `cargo check --workspace` | Succès, sans avertissement |
| `cargo clippy --workspace` | Succès, sans avertissement |
| `cargo fmt --all --check` | Conforme |
| `cargo test --workspace` | **148 tests verts, 0 échec** |
| `npx tsc --noEmit` (ui/) | Succès |
| `npx vitest run` (ui/) | **10 fichiers, 34 tests verts** |
| `npm run build` (ui/) | Bundle produit ; avertissement > 500 kB (pré-existant) |

## 2. Nouveaux tests Sprint 9 (exécutés, verts)

| Test | Ce qu'il prouve |
|---|---|
| `baseline_pass_does_not_queue_existing_files` | Le contenu préexistant ne devient pas de l'activité ; une vraie modification passe exactement une fois en file ; inchangé ⇒ jamais relu |
| `queue_backpressure_is_bounded` | La file ne dépasse jamais 80 entrées et signale la surcharge |
| `oversized_files_are_rejected_not_queued` | Les fichiers hors budget sont exclus (événement distinct), pas mis en file |
| `per_cycle_limit_is_enforced` | Le budget fichiers/cycle est respecté ; cycle partiel signalé |
| `sanitize_rejects_missing_dir` / `sanitize_deduplicates_and_canonicalizes` | Aucun dossier invalide ; canonisation + dédup |
| `config_persists_across_reload` | dossiers + consentement persistés dans `proactive.json` |
| `duplicate_keys_are_suppressed_while_in_ring`, `old_keys_are_evicted_after_ring_capacity` | Notifications non répétitives |

## 3. Tests de compilation interface

- `SectionId` étendu (`proactive`) ; `SECTION_META` ; `nav.proactive`
  traduit FR/EN ; build Vite passe.

## 4. Non exécuté ici (blocages)

- **Validation VM isolée** : inhabilité connue depuis le Sprint 8 (instabilité
  CBS-Shield-Sprint7). Rien n'est revendiqué pour l'installation, ClamAV
  portable, upgrade, désinstallation, ni les tests GUI natifs machine réelle
  (aucun écran natif capturé dans ce sprint).
- L'exécution d'installation réelle NSIS `0.9.0-dev` n'a pas été faite sur
  machine de dev hôte (règle projet : jamais d'installation hôte).
- Benchmark performance dédié : non exécuté (module pas encore finalisé côté
  analyse automatique).
