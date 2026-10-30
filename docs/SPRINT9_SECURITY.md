# Sprint 9 — Rapport de sécurité / Security report

**Version:** `0.9.0-dev` · Branche `sprint-9` (locale). Base `6656b55`.

## 1. Ce qui a été arrêté / revu

### Code : what ships with Sprint 9

| Zone | Résultat |
|---|---|
| Permissions de commandes Tauri | Aucune nouvelle permission runtime supplémentaire ; nouveau plugin notification uniquement Rust-side |
| Validation utilisateur | Dossiers canonisés (`canonicalize`), dédupliqués (1..=10), budgets bornés serveur (cycle 1..=30 s, fichiers 1..=1 000, taille 1..=256 MiB, profondeur 1..=8) |
| Chemins / accès disques | Lecture seule le long de l'arbre ; le module ne lit que des `metadata` + `read_dir` ; pas d'écriture dans les dossiers surveillés |
| Processus externes | Aucun appel de processus ajouté au module de surveillance ; l'analyse ClamAV reste dans le chemin manuel existant du même moteur |
| Stockage local | `proactive.json` limité aux préférences (chemins, entiers budget, consentement) — pas d'événements sensibles, pas de contenu de fichier |
| Historique versus vie privée | 120 événements max, journaux files bornés, aucune donnée du contenu de fichier persistée |
| Notifications | Anneau de dé-duplication : un même événement ne notifie pas à répétition (anti-spam) |
| Tray | Aucune action de sécurité démarrée silencieusement depuis le plateau |
| Defender / pare-feu | Invoqué **aucune** modification ; `sprint-9` n'ajoute ni exclusion ni règle |

### Conformité aux invariants du dépôt

- Le module **ne se describe jamais** comme antivirus temps réel, ni
  « équivalent Defender », ni bloqueur d'exécution.
- Aucune modification de Microsoft Defender, aucune exclusion.
- Aucun échantillon de malware : exécution délibérément hors périmètre (pas
  d'échantillon dans les tests, uniquement du contenu synthétique inoffensif).
- Aucun changement d'interface Disque hors `data_dir` utilisateur.

## 2. Ce qui n'a pas pu être validé ici

| Point | Explication |
|---|---|
| Validation VM isolée complète (installation, ClamAV portable, upgrade, désinstallation) | Bloqué depuis le Sprint 8 : VM instable. Aucun résultat n'est revendiqué ; règle = jamais déclaré réussi sans exécution réelle du parcours complet |
| Intégration DNS système expérimentale (Web Guard) | Approval isolation prerequisite non revalidé ; filtrage système reste **désactivé** |
| Mises à jour signées / Authenticode | Investigation uniquement (voir `SPRINT9_UPDATER.md`) ; aucune clé, aucun artefact signé |

## 3. Pistes ouvertes (à prioriser au sprint 10)

1. Analyse automatique sécurisée de la file (module dédié, confirmation
   utilisateur initiale, journalisation complet du scrutin).
2. Notification « signatures obsolètes » branchée sur la programmation
   FreshClam existante (module prêt, déclencheur à raccorder).
3. Empreintes de fichiers réservées en mémoire ; si la persistance des
   empreintes devient utile (anti-relecture après relance), chiffrer le cache.
