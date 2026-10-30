# Sprint 9.2 — Registre des risques et conditions de sortie

**Version :** `0.9.0-dev` · **Artefact :** `CBS Shield_0.9.0-dev_x64-setup.exe` (`d5a8b626…b1fd`)
**Date :** 2026-10-30 · **Statut :** ⚠️ **non production-ready**
**Principe :** un risque non prouvé n'est jamais requalifié en succès. Ce registre remplace `SPRINT6_UNRESOLVED_RISKS.md` comme état courant.

---

## 1. Anomalies issues de la QA native (A1 – A7)

Ces constats proviennent de sondes système réelles dans la VM `CBS-Shield-Sprint7`, pas d'une lecture d'écran.

| # | Anomalie | Gravité | Preuve observée | Impact | Correctif / décision |
| ---: | --- | --- | --- | --- | --- |
| **A1** | **Aucune persistance SQLite détectée** : `cbs-shield.db-wal` reste à 94 792 octets, mtime `2026-10-28 07:43:36`, inchangé après redémarrage, analyse terminée et ouverture du moniteur réseau ; seul le `-shm` bouge | **Critique** | Tailles et mtimes relevés à trois moments distincts ; permissions `FullControl` vérifiées, écriture du dossier OK, accès WAL RW-partagé OK | Historique d'analyses, quarantaine et réglages peuvent être perdus à la fermeture ; l'UI peut afficher un état non persisté | Reproduire hors VM avec un `CBS_SHIELD_DATA_DIR` temporaire, instrumenter `cbs-store` (journal + `PRAGMA wal_checkpoint`), puis corriger. **Non corrigé en 9.2.** |
| **A2** | **Quarantaine sans blob** : recherche complète de `C:\` → **0 fichier `*.cbsq`** ; `quarantine\` vide (mtime `2026-10-28 07:43:22`) ; le fichier source `cbs-eicar-check.txt` a disparu | **Critique** | Arborescence invité + recherche récursive | Si le fichier a été supprimé sans copie chiffrée, il y a **perte de données irréversible** ; l'attribution (CBS Shield vs Defender) n'est pas établie | Rejouer le parcours avec Defender temporairement neutralisé **dans la VM uniquement** et confirmation `confirm:true`, puis vérifier la présence du `.cbsq` **avant** de conclure. Décision propriétaire requise. |
| **A3** | **Défaut de code destructif** dans `cbs-quarantine::store()` (`crates/cbs-quarantine/src/lib.rs:195`) : si `fs::remove_file(source)` échoue, le blob chiffré qui vient d'être écrit est supprimé — y compris quand l'échec est `NotFound` (source déjà retirée par un antivirus concurrent) | **Critique** | Lecture du code ; chemin d'erreur inconditionnel | L'unique copie du fichier peut être détruite ; la quarantaine devient une suppression | Patch proposé : traiter `NotFound` comme un succès (la source n'existe plus, garder le blob) et ne faire le rollback que si `source.exists()`. **Non appliqué en 9.2** (QA sans modification de source). Décision propriétaire requise. |
| **A4** | **Signature personnalisée non appliquée par le scan in-app** : `custom.ndb` (`CBS_Test_Synthetic:0:*:414243444546`) détecte les fixtures sur Desktop via `clamscan --database=<dir>`, mais le scan lancé depuis l'application ne détecte que l'EICAR | **Majeure** | Deux exécutions `clamscan` directes positives ; un scan in-app négatif sur les mêmes fichiers | Couverture de détection réelle inférieure à celle annoncée ; risque de faux négatif | Vérifier la construction de la commande de scan (jeu de bases effectivement passé au moteur) et ajouter un test d'intégration avec signature synthétique. |
| **A5** | **Pas de garde mono-instance** : aucun plugin `single-instance` dans `src-tauri` | **Majeure** | `Cargo.toml` / `tauri.conf.json` | Deux instances peuvent ouvrir la même base et le même coffre ; accès concurrent, corruption possible (cohérent avec A1) | Ajouter `tauri-plugin-single-instance` ou un mutex nommé au démarrage ; tester le second lancement. |
| **A6** | **État d'accueil stocké uniquement dans le profil WebView2** | Mineure | Le renommage du profil `com.cybrense.cbsshield` réaffiche l'assistant | L'assistant peut réapparaître après nettoyage de cache ou changement de profil | Déplacer l'état d'onboarding dans le store applicatif (SQLite). |
| **A7** | **Horloge invitée décalée de −7 h** par rapport à l'hôte | Environnement | Comparaison hôte/invité au même instant | Horodatages faussés ; échecs TLS possibles côté `freshclam` (observés puis disparus) | Resynchroniser l'horloge de la VM (`VBoxManage guestproperty` / service de temps) avant toute nouvelle campagne ; ne pas attribuer les erreurs réseau à l'application. |

### Corrélation A1 / A2 / A5

Les trois anomalies convergent : sans garde mono-instance et sans persistance WAL visible, l'état de quarantaine n'est pas fiable. **Aucun parcours quarantaine → restauration ne peut être déclaré valide** tant que A1, A2 et A3 ne sont pas traités.

---

## 2. Écarts de couverture de la recette native

| # | Élément | État | Condition de sortie |
| ---: | --- | --- | --- |
| R1 | Installeur **non signé** (`NotSigned`) | Connu, accepté pour dev | Certificat Authenticode + hash publié |
| R2 | Désinstallation propre | **Non exécutée** | Désinstaller dans la VM, vérifier la suppression des fichiers et la conservation des données utilisateur selon la politique choisie |
| R3 | Mise à jour inter-versions | **Non exécutée** | Installer 0.8.0-dev puis 0.9.0-dev, vérifier migration et réglages |
| R4 | Analyse **complète** et analyse **personnalisée** de bout en bout | **Non exécutées** | Disque de test, annulation et reprise observées |
| R5 | Notifications Windows natives | Partiellement observé (code revu) | Déclencher une détection réelle hors VM Defender, vérifier le texte et le regroupement |
| R6 | Surveillance proactive avec consentement | Code + UI vérifiés, **cycle réel non observé** | Laisser tourner ≥ 1 cycle, vérifier l'analyse automatique et le résumé |
| R7 | Parcours ClamAV absent (installation officielle) | **Non exécuté** | VM sans ClamAV, consentement, annulation, échec, succès |
| R8 | Thème clair / FR-EN complets sur tous les écrans | Partiel | Parcours des 11 sections dans les deux langues et les deux thèmes |
| R9 | Accessibilité avec lecteur d'écran | **Non auditée** | Test Narrateur/NVDA, contraste, zoom 200 %, mouvement réduit |
| R10 | Web Guard / pare-feu en conditions réelles | Lecture seule vérifiée, aucune action de filtrage/blocage attendue | Documenter explicitement l'absence de filtrage global |
| R11 | Refonte UI | **Spécifiée, non approuvée, non implémentée** | Approbation du propriétaire (§ 9 de `SPRINT92_UI_UX_REDESIGN.md`) |
| R12 | Intrusion Guard | **Spécifié, non implémenté** | Validation de l'architecture puis implémentation par phases, lecture seule |

---

## 3. Risques acceptés explicitement pour cette version

- CBS Shield **ne fournit aucun temps réel** et **ne remplace pas** Microsoft Defender.
- Le pare-feu est **strictement en lecture seule** ; aucune règle n'est créée ni modifiée.
- Web Guard est un **proxy en boucle locale** ; il ne filtre pas un poste non configuré.
- L'installateur est **non signé** ; le SHA-256 est le seul contrôle d'intégrité.
- Aucun échantillon de malware réel n'a été utilisé (EICAR et signature synthétique uniquement).

---

## 4. Conditions de sortie vers une 0.9.0 « production »

1. A1, A2 et A5 investigués et corrigés ; parcours quarantaine → restauration → purge démontré avec blob vérifié.
2. A3 corrigé avec test de non-régression (source disparue ⇒ blob conservé).
3. A4 corrigé ; test d'intégration `custom.ndb` vert.
4. R2, R3, R4, R7 exécutés en VM.
5. R9 audité (accessibilité).
6. Installeur signé et hash publié.
7. Approbation UI explicite du propriétaire avant toute implémentation de la refonte.

Tant que ces sept conditions ne sont pas réunies, la version reste **`0.9.0-dev`** et aucune publication n'est autorisée.
