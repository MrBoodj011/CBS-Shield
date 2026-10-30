# Sprint 9 — Rapport de surveillance proactive / Proactive Monitor report

**Version cible:** `0.9.0-dev` · **Branche:** `sprint-9` (locale, non publiée)
**Base:** `6656b55` (Sprint 8)

## 1. Périmètre livré / Delivered scope

### Conception

CBS Proactive Monitor est un **observateur de fichiers**, pas un antivirus.
Il observe des dossiers choisis explicitement par l'utilisateur, détecte les
fichiers créés ou modifiés, et place ces fichiers dans une **file d'analyse
bornée** que l'utilisateur relit lui-même. L'analyse ClamAV reste **manuelle**
(via l'onglet Antivirus). Aucune déclaration de protection temps réel, aucun
pilote noyau, aucun blocage d'exécution, aucune modification de Microsoft
Defender.

### Module Rust `crates/cbs-proactive`

| Caractéristique | Détail |
|---|---|
| Mécanisme | Scrutation (`poll`) périodique, pas d'injection système |
| Dossiers | 1 à 10, canonisés, dédupliqués (accès direct uniquement) |
| Deepth max | 1 à 8 sous-niveaux (configurable, borne serveur) |
| Files bornées | 80 entrées max (backpressure explicite), 120 événements max, 5 000 fichiers suivis max |
| Budget par cycle | 1 à 1 000 fichiers/cycle (configurable) ; cycle partiel signalé en `lastError` |
| Embedding baseline | Premier cycle silencieux : le contenu préexistant n'est ni signalé ni mis en file |
| Détection de changement | Empreinte (taille + mtime) ; un fichier inchangé n'est **jamais relu** |
| Verrous / liens | Fichiers verrouillés ignorés sans crash ; pas de lien symbolique suivi par le module |
| Paused / resume / stop | Contrôle explicite par l'utilisateur ; arrêt propre (join du thread) |
| Persistance | `proactive.json` dans le dossier de données de l'utilisateur (dossiers, budget, consentement « relance au démarrage ») |
| Bascule de relance | `autoWatch` = consentement explicite de reprise au lancement, jamais un démarrage invisible |
| Validation | Aucun démarrage de la surveillance sans dossier choisi |

### Backend Tauri

- État intégré : `AppState.proactive` ; configuration dans `paths.proactive_config`.
- Commandes : `proactive_snapshot`, `proactive_set_directories`,
  `proactive_set_config`, `proactive_set_auto_watch`, `proactive_start`,
  `proactive_pause`, `proactive_resume`, `proactive_stop`, `proactive_drain`,
  `proactive_clear`.
- Codes d'erreur dédiés : `proactiveConfig`, `proactiveInternal`.

## 2. Tests Rust / Rust tests

`cargo test --workspace` : **148 tests verts, 0 échec**, dont 8 tests
unitaires spécifiques au module (`cbs-proactive` + `notify`) :

- `sanitize_rejects_missing_dir`, `sanitize_deduplicates_and_canonicalizes`
- `baseline_pass_does_not_queue_existing_files` (création, modification, non-relecture)
- `queue_backpressure_is_bounded` (file jamais > 80)
- `oversized_files_are_rejected_not_queued`
- `per_cycle_limit_is_enforced` (cycle partiel signalé)
- `config_persists_across_reload` (JSON persisté : dossiers + consentement)
- `duplicate_keys_are_suppressed_while_in_ring`,
  `old_keys_are_evicted_after_ring_capacity` (notifications)

`cargo clippy --workspace` : sans avertissement. `cargo fmt --check` : conforme.

## 3. Interface / UI

- Nouvelle section `proactive` (groupe « Protection » de la navigation).
  - Bandeau permanent : « pas un antivirus temps réel — Defender reste votre protection continue ».
  - Démarrage / pause / reprise / arrêt explicites ; jamais automatique sans consentement.
  - Métriques réelles : dossiers, fichiers suivis, taille de file, dernier cycle.
  - Gestion des dossiers (sélecteur natif, ajout manuel, retrait) + limites de ressources éditables.
  - File d'analyse : vidage manuel affichant la liste des fichiers à passer à l'Antivirus.
- FR/EN complet via libellés inline bilingues (même mécanisme que Web Guard).
- CSS : classes existantes du design system ; nouveau bloc `proactive` dans `theme.css`.

## 4. Intégration Windows (extrait) / Tray & notifications

- Menu plateau étendu : `Ouvrir / Quarantaine / Moniteur réseau / Quitter`
  (FR/EN selon la langue sauvegardée). Les entrées de destination émettent
  `tray-navigate` et la navigation passe par l'état React normal.
- Notifications natives Windows via `tauri-plugin-notification` côté Rust :
  fin d'analyse, détection, échec moteur. Anneau de dé-duplication
  (`notify::NotifyRing`, 16 clés) : un même événement ne notifie pas deux fois.

## 5. Limites connues et honnêtes

| Point | Statut |
|---|---|
| Analyse automatique des fichiers de la file | **Non implémenté** : la relecture antivirus reste manuelle (décision : pas d'appel clamscan non-visible et non-confirmable depuis un thread d'observation) |
| Temps réel (création à l'instant t) | Granularité = intervalle de cycle (1–30 s), pas l'instant exact |
| Surveillance démarrée uniquement quand l'app tourne | Par conception ; celui qui promet un module persistant de fond ne le falsifie pas — CBS Shield ne le promet pas |
| Chiffrement du `proactive.json` | Non chiffré (contient uniquement des chemins et des budgets) |

## 6. Risques résiduels

1. La liste de fichiers affichée dans la file contient des chemins locaux ;
   ils restent sur la machine et ne sont transmis à aucun service externe.
2. Un dossier surveillé par l'utilisateur peut contenir des fichiers très
   volumineux ; seules les empreintes sont conservées en mémoire.
3. Le cycle initial de baseline sur un très grand arbre peut prendre du
   temps CPU ; le budget « fichiers/cycle » borne ce travail.
