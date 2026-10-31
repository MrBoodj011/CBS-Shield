# État du développement — CBS Shield 0.9.0-dev

**Date de vérification :** 31 octobre 2026
**Branche :** `sprint-9.3` (Sprint 9.2 `758199f`, correctifs 9.3 `74b24b3`)
**Nature :** version expérimentale — antivirus manuel, assistant de préparation,
installation officielle de ClamAV, observation réseau et pare-feu strictement en
lecture seule, prototype Web Guard de filtrage DNS local, historique de sécurité,
surveillance proactive de fichiers (observateur, pas antivirus temps réel) et
analyse automatique optionnelle de la file d'observation.

Ce document décrit ce qui a été **réellement implémenté et vérifié**, ce qui
reste **bloqué ou non exécuté**, et les limites connues. Aucune fonctionnalité
non testée n'est présentée comme opérationnelle. Le détail de recette est dans
[`docs/SPRINT9_NATIVE_TEST_REPORT.md`](docs/SPRINT9_NATIVE_TEST_REPORT.md),
[`docs/SPRINT9_TEST_REPORT.md`](docs/SPRINT9_TEST_REPORT.md) et
[`docs/SPRINT9_PROACTIVE_INTEGRATION.md`](docs/SPRINT9_PROACTIVE_INTEGRATION.md).

---

## 0. Sprint 9.2 — QA finale (30 octobre 2026)

Sprint de **vérification et de conception uniquement** : aucun fichier source n'a
été modifié, l'artefact reste celui produit à `9b2c832`.

**Récupéré et prouvé :**

- Accès VM `CBS-Shield-Sprint7` rétabli (agent de file, pilote souris DPI-aware,
  réveil d'affichage) ; méthodes Sprint 7 reprises sans modification.
- Installeur invité **byte-identique** au bundle hôte (`D5A8B626…B1FD`) :
  c'est bien l'artefact `0.9.0-dev` qui a été testé.
- ClamAV portable provisionné et vérifié (225 774 978 o, SHA-256 conforme,
  moteur chargé, 3 631 204 signatures).
- Analyse rapide **in-app** exécutée deux fois : 145 fichiers, 0 erreur, 1 détection réelle.
- Échec `freshclam` (curl 60) requalifié **transitoire** : le même binaire a
  ensuite réussi, corrélé à une dérive d'horloge invitée de −7 h.
- Suites locales rejouées : `cargo fmt --check` et Clippy propres,
  **125 tests Rust réussis + 1 ignoré**, **34 tests frontend réussis**,
  build Vite propre, installeur re-haché.
  *Le chiffre « 148 tests Rust » annoncé en 9.1 n'est pas reproduit sur l'arbre
  courant ; le décompte 9.2 (10 binaires de test) fait foi.*

**Anomalies ouvertes (détail : `docs/SPRINT92_RISK_REGISTER.md`) :**

- A1 — aucune persistance SQLite détectée (WAL immobile) · **critique**
- A2 — quarantaine sans blob `.cbsq`, source disparue · **critique**
- A3 — `store()` détruit l'unique copie si la suppression de la source échoue · **critique**
- A4 — signature `custom.ndb` non appliquée par le scan in-app · **majeure**
- A5 — pas de garde mono-instance · **majeure**
- A6 — état d'accueil uniquement dans le profil WebView2 · mineure
- A7 — horloge invitée décalée de −7 h · environnement

**Conception livrée (non implémentée) :**

- [`docs/SPRINT92_UI_UX_REDESIGN.md`](docs/SPRINT92_UI_UX_REDESIGN.md) + deux
  directions de maquettes dans `docs/sprint92-mockups/` — **en attente d'approbation**.
- [`docs/SPRINT92_INTRUSION_GUARD.md`](docs/SPRINT92_INTRUSION_GUARD.md) —
  architecture défensive en lecture seule, non implémentée.
- [`docs/SPRINT92_VM_VALIDATION.md`](docs/SPRINT92_VM_VALIDATION.md),
  [`docs/SPRINT92_NATIVE_TEST_REPORT.md`](docs/SPRINT92_NATIVE_TEST_REPORT.md),
  [`docs/SPRINT92_SECURITY_REGRESSION.md`](docs/SPRINT92_SECURITY_REGRESSION.md).

---

## 0.1 Sprint 9.3 — Correctifs de suivi (30-31 octobre 2026)

Suite aux anomalies du registre 9.2, le code a été corrigé et testé
unitairement. **Aucun de ces correctifs n'a encore été revalidé dans la VM
avec un installeur reconstruit.**

- **A1 requalifié** en faux positif de mesure : la WAL est bien écrite ; les
  scans et détections sont présents après rejeu. Tests d'intégration ajoutés
  (`crates/cbs-store/tests/persistence.rs`).
- **A2/A3 corrigés** : quarantaine en deux phases `pending → active`, blob
  chiffré vérifié avant suppression de la source, `NotFound` traité comme
  succès, `SourceRetained` si la source est verrouillée.
- **A4 requalifié** en faux positif de test : une signature discriminante est
  bien appliquée par le scan intégré.
- **A5 corrigé** : `tauri-plugin-single-instance` enregistré en premier.
- **A7** : diagnostic TLS/heure explicite, vérification TLS jamais désactivée.
- **A6** : non corrigé (état d'accueil toujours dans le profil WebView2).

Suites : 136 tests Rust / 0 échec, 37 tests frontend, Clippy et fmt propres,
build Vite et installeur NSIS reconstruits. Détails :
[`docs/SPRINT92_FINAL_EVIDENCE.md`](docs/SPRINT92_FINAL_EVIDENCE.md),
[`docs/SPRINT93_ROOT_CAUSE_ANALYSIS.md`](docs/SPRINT93_ROOT_CAUSE_ANALYSIS.md).

---

## 1. Livré (Sprint 9 + 9.1)

- Module **CBS Proactive Monitor** (crate `cbs-proactive`) : scrutation bornée,
  file d'analyse bornée, backpressure, baseline silencieuse, pause/reprise/arrêt,
  persistance `proactive.json`, consentement explicite de relance.
- Analyse automatique optionnelle de la file d'observation via un ouvrier
  consenti qui réutilise le `Scanner` ClamAV validé (aucune suppression ni
  quarantaine automatique ; audit complet dans l'historique).
- Plateau Windows étendu : Ouvrir / Quarantaine / Moniteur réseau / Quitter
  (FR/EN) avec navigation via `tray-navigate`.
- Notifications natives Windows dédupliquées (scan terminé, détection,
  échec moteur) avec anneau de 16 clés.
- Interface : nouvelle section `proactive` (groupe Protection), métriques
  réelles, gestion des dossiers, limites de ressources, statut de l'ouvrier.
- Version alignée `0.9.0-dev` (Cargo, Tauri, npm, lockfiles, interface).
- Suite locale : **148 tests Rust** + **34 tests frontend** réussis,
  `cargo fmt` et Clippy sans avertissement, `tsc` et build Vite propres.
- Production NSIS : `CBS Shield_0.9.0-dev_x64-setup.exe`, 2 903 396 octets,
  SHA-256 `D5A8B626A7797110AA8006F4AB69648A9A9F41581BA4BB08E32F33AE2F90B1FD`.
- Documentation : rapports natif, intégration proactive, régression sécurité,
  audit installeur, validation VM, captures d'écran (10 PNG).

## 2. Non livré / bloqué

- Validation VM complète : **partiellement exécutée en 9.2** (accès rétabli,
  installeur vérifié, ClamAV provisionné, analyse in-app réelle). Restent
  **non exécutés** : upgrade inter-versions, désinstallation, parcours ClamAV
  absent, analyse complète, cycle de surveillance proactive observé, et le
  parcours quarantaine → restauration invalidé par A1/A2/A3.
- Notifications live non observées (Microsoft Defender bloque la lecture EICAR
  par ClamAV, erreur 225) — aucune exclusion ajoutée.
- Plateau Windows non exercé en interaction réelle (code compilé et revu).
- Thème clair non capturé ; scan rapide **exécuté en 9.2** dans l'interface
  graphique de la VM, mais quarantaine/restauration non valides (A1/A2/A3).
- Installeur non signé (Authenticode : NotSigned) — volontaire, pas de
  certificat disponible.

## 3. Limites connues et honnêtes

- Le moniteur proactif est un **observateur**, pas un antivirus temps réel ;
  granularité = intervalle de cycle (1–30 s).
- L'analyse automatique reste **opt-in** et ne supprime ni ne met en
  quarantaine automatiquement.
- La surveillance ne fonctionne que pendant l'exécution de l'application.
- Aucune modification de Microsoft Defender, aucune exclusion, aucune règle
  pare-feu, aucune modification DNS système.
- Aucun échantillon de malware réel ; seul le fichier de test EICAR standard
  (inoffensif) a été utilisé en ligne de commande.

## 4. Prochaines étapes suggérées (Sprint 10)

1. Exécuter la recette complète sur la VM (ou une nouvelle VM stable) avec
   le SHA-256 de référence.
2. Piloter l'interface graphique (scan, quarantaine, notifications) en
   capturant les résultats.
3. Obtenir un certificat de signature de code et signer l'installeur.
4. Raccorder les notifications « signatures obsolètes » à la programmation
   FreshClam existante.
5. Éventuellement chiffrer le cache d'empreintes si la persistance devient
   utile.
