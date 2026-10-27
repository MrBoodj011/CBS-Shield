# État du développement — CBS Shield 0.7.0-dev

**Date de vérification :** 27 octobre 2026
**Branche :** `sprint-7` (base Sprint 6 `888e0ac`)
**Nature :** version expérimentale — antivirus manuel, assistant de préparation,
installation officielle de ClamAV, observation réseau et pare-feu strictement en
lecture seule, avec historique d'instantanés vérifiable.

Ce document décrit ce qui a été **réellement implémenté et vérifié**, ce qui reste
**bloqué ou non exécuté**, et les limites connues. Aucune fonctionnalité non testée
n'est présentée comme opérationnelle. Le détail de recette est dans
[`docs/SPRINT7_TEST_REPORT.md`](docs/SPRINT7_TEST_REPORT.md). Les rapports Sprint 5
et 6 restent des preuves historiques.

---

## 0. Sprint 7 — état réel

### 0.1 Livré

- UI Pare-feu premium en lecture seule : vue d'ensemble, navigation par sections,
  alertes actives, profils, connexions regroupées par application, règles
  filtrables (direction, action, état, protocole, profil), détail de règle en
  modale, sauvegardes et diagnostic.
- Instantanés d'audit avec sidecar `.sha256`, historique borné à 50 fichiers,
  vérification par commande séparée et états honnêtes `matched`, `mismatch`,
  `unverified`, `invalid`.
- Gate `backup_snapshot` renforcée : un simple JSON ne suffit plus ; il faut une
  empreinte `.sha256` concordante.
- Matrice de capacités : lecture, export et vérification disponibles ; création,
  modification, restauration et rollback visiblement indisponibles.
- Version alignée `0.7.0-dev` (Cargo, Tauri, npm, lockfiles, interface).
- Tests Rust dédiés aux helpers d'instantanés et tests frontend des filtres, de
  l'historique et de la vérification.
- Suite locale complète : **95 tests Rust** et **28 tests frontend** réussis,
  `cargo fmt` et Clippy sans avertissement.
- Documentation Sprint 7 : rapport de test, revue de sécurité, audit d'installeur
  et plan VM mis à jour.

### 0.2 Non livré / bloqué

- **Aucune mutation de règle** : aucune API IPC, aucun bouton actif, aucun chemin
  de restauration. La décision reste volontairement bloquée.
- La VM Windows 11 isolée a été créée et démarrée, mais le cycle complet
  installation → sauvegarde → restauration → récupération n'est pas revendiqué
  comme validé à la date de ce document.
- Les scénarios pare-feu activé/désactivé dans la VM, l'installation NSIS 0.7,
  la mise à niveau depuis 0.6 et la désinstallation doivent être consignés dans le
  rapport VM dès qu'ils sont exécutés. Sans ces preuves, aucune affirmation de
  « validé VM » n'est autorisée.
- L'installeur 0.7.0-dev reste non signé Authenticode ; son SHA-256 doit être
  vérifié manuellement.

---

## 1. Environnement de validation

| Élément | Valeur |
| --- | --- |
| Système | Windows 11 Home, build 26200, x64 |
| Rust | 1.99.1, toolchain MSVC |
| Node.js / npm | 24.18 / 12 |
| WebView2 | Runtime 155 |
| ClamAV | 1.5.4 (`winget`, `Cisco.ClamAV`) |
| Base de signatures | `daily.cld` révision 28165, 3 642 895 signatures officielles |
| Pare-feu Windows | **désactivé sur les trois profils** — constaté, non modifié |
| Services pare-feu | `MpsSvc` et `BFE` en cours d'exécution, démarrage automatique |
| Microsoft Defender | Actif, protection temps réel active, aucune exclusion CBS Shield |
| Visual Studio | 2022 Build Tools (C++) |

---

## 2. Ce que le Sprint 6 a livré

### 2.1 Installation ClamAV sans terminal

- L'assistant peut lancer le paquet officiel `Cisco.ClamAV` du catalogue Windows
  après une **case d'autorisation explicite**. Aucune commande n'est demandée ni
  affichée dans le parcours principal.
- Source officielle, licence GPLv2, absence de redistribution et état réel sont
  affichés avant l'action. Une fenêtre visible et l'UAC Windows restent possibles ;
  CBS Shield ne s'élève jamais lui-même.
- Progression honnête : chronomètre et état animé, sans inventer un pourcentage que
  l'installateur ne fournit pas.
- Résultats stables et localisés : `alreadyInstalled`, `installed`, `notDetected`,
  `wingetFailed`. Les erreurs `wingetUnavailable`, `installInterrupted`,
  `installTimedOut` et `confirmationRequired` sont expliquées avec reprise ou
  localisation manuelle de `clamscan.exe`.
- Une installation déjà présente est vérifiée automatiquement ; aucun faux état
  « installé » n'est produit.

### 2.2 Pare-feu : diagnostic et récupération explicites

- Diagnostic des services `MpsSvc` et `BFE` via `sc query` masqué, sans démarrage ni
  arrêt de service. Un service non disponible ou illisible est signalé sans inventer
  son état.
- Distinction visuelle entre **référence lue** (profils, règles, empreintes) et
  **décision effective non calculée** (priorité Allow/Block, filtres WFP, IPsec,
  stratégie de groupe).
- Libellé clarifié : « Profil réseau » et non « Actif », pour ne pas confondre le
  profil de réseau courant avec un pare-feu actif.
- Export JSON en lecture seule avec métadonnées `exportedAt`, `readOnly: true`,
  `restoreSupported: false` et **SHA-256 des octets écrits**, affiché dans
  l'interface.
- Plan de récupération affiché comme **conception seulement / non actif** : snapshot
  conçu, restauration absente, répétition rollback non réalisée, autorisation
  distincte requise.
- Détection de changement conservée : la référence n'est mise à jour que sur première
  observation ou acquittement explicite, jamais silencieusement.

### 2.3 Accessibilité et cohérence FR/EN

- Piège de focus clavier dans les dialogues (`Modal`, `SetupWizard`) : focus initial,
  boucle Tab/Shift+Tab, restauration du focus et verrouillage du défilement.
- Libellés ARIA localisés, navigation d'étapes avec `aria-current`, fermeture
  `Échap` bloquée pendant une installation ou une mise à jour active.
- Statuts, toasts et messages de résultat localisés ; les journaux techniques et
  sorties d'outils externes peuvent rester dans leur langue d'origine, ce qui est
  expliqué dans **Paramètres**.
- L'assistant n'affiche plus de commande brute, de bouton « copier » ou d'état
  trompeur de protection en temps réel.

### 2.4 Installeur et version

- Installeur NSIS `0.6.0-dev`, mode `currentUser`, sélecteur **Français / English**,
  dossier `Cybrense` dans le menu Démarrer.
- Versions alignées : Cargo, Tauri, npm, lockfiles et interface.
- Les données utilisateur sont conservées hors du dossier d'installation.

---

## 3. Composants

### Backend Rust

| Crate | Contenu | État |
| --- | --- | --- |
| `cbs-core` | modèles, découverte ClamAV, parsing, orchestration, profils, progression, annulation | Complet et testé |
| `cbs-store` | SQLite v2 (scans, détections, quarantaine, réglages, `netmon_snapshots`) | Complet et testé |
| `cbs-quarantine` | AES-256-GCM, clé DPAPI, store/restore/purge, anti-écrasement | Complet et testé |
| `cbs-netmon` | TCP/UDP, compteurs d'interface filtrés, processus et chemins d'image | Complet et testé |
| `cbs-firewall` | profils, règles, empreintes, alertes — **lecture seule** | Complet et testé |
| `src-tauri` | IPC, assistant, installation ClamAV, diagnostic services, baseline, mapping, snapshot, plan de récupération | Compilé et testé |

### Interface React

| Section | État |
| --- | --- |
| Dashboard | Réel : posture, alertes pare-feu, moteur, signatures, activité |
| Antivirus | Fonctionnel : sélection, scan réel, profils, progression, rapport |
| Historique | Fonctionnel : 200 rapports, filtres, recherche |
| Quarantaine | Fonctionnel : restauration revalidée, suppression double confirmation |
| Moniteur réseau | Fonctionnel (lecture seule) |
| Pare-feu | Profils, règles, services, alertes, changements, décision non calculée, snapshot SHA-256, plan de récupération |
| Mises à jour | FreshClam, inventaire, assistant, source officielle |
| Paramètres | Thème, langue, chemins, options, assistant |
| À propos | Versions, chemins, diagnostic live |
| Assistant | 5 étapes FR/EN, installation ClamAV consentie, focus trap |

---

## 4. Tests et résultats

### Rust

Commande : `cargo test --workspace`
**93 réussis, 0 échec, 1 ignoré** (EICAR manuel).

| Suite | Tests | Résultat |
| --- | --- | --- |
| `cbs-core` unitaires | 30 | ✅ 30 |
| `cbs-core` intégration ClamAV | 4 | ✅ 3 + 1 ignoré |
| `cbs-core` mission E | 2 | ✅ 2 |
| `cbs-firewall` | 8 | ✅ 8 |
| `cbs-netmon` | 7 | ✅ 7 |
| `cbs-quarantine` | 9 | ✅ 9 |
| `cbs-shield` | 27 | ✅ 27 |
| `cbs-store` | 7 | ✅ 7 |
| **Total** | **94** | **93 réussis, 1 ignoré** |

Le test ajouté au Sprint 6 vérifie le parsing des codes réels de `sc query` et refuse
d'inventer un état inconnu.

### Frontend et qualité

| Commande | Résultat |
| --- | --- |
| `npm run ui:test` | ✅ **26 tests / 9 fichiers** |
| `npm run ui:build` | ✅ TypeScript strict + Vite (1 960 modules) |
| `cargo fmt --all -- --check` | ✅ propre |
| `cargo clippy --workspace --all-targets -- -D warnings` | ✅ aucun avertissement |
| `npm run build` | ✅ release + installeur NSIS final |

Les tests UI couvrent notamment le piège de focus du dialogue, le parcours assistant
sans commande brute, l'export de snapshot avec SHA-256, les alertes de service et la
distinction référence/décision.

### E2E natif

Binaire **release** installé puis piloté via CDP WebView2 :

- assistant complet en FR et EN, avec focus visible et `Échap` ;
- installation et réinstallation silencieuses : code 0 ;
- pare-feu réel : 3 profils désactivés, services `running`, 657 règles après
  changement détecté (659 → 657) ;
- le changement a été **affiché**, pas appliqué ; la nouvelle référence n'a été
  acceptée que par action explicite dans l'interface ;
- snapshot JSON réel : `readOnly: true`, `restoreSupported: false`, SHA-256 identique
  au fichier ;
- désinstallation : code 0, binaires/raccourci/registre supprimés, données intactes ;
- captures FR/EN dans [`docs/screenshots/`](docs/screenshots/).

---

## 5. Installation et distribution

### 5.1 Sprint 7 (courant)

- Installeur NSIS `CBS Shield_0.7.0-dev_x64-setup.exe`, **2 674 869 octets**,
  SHA-256 `F09AAA014DCEE3DE875B6A1016A9B077887563353D706DFAFD08F3196B6AD4AF`,
  **non signé (Authenticode : NotSigned)**.
- Binaire release : **7 401 984 octets**, SHA-256
  `5E56D043EAE518E1A29C18E5BF982598E2AADFADD9607C752EC2604ED01C1D88`.
- Mise à niveau hôte 0.6 → 0.7 : code 0, entrée HKCU passée à `0.7.0-dev`.
- Binaire installé : **7 401 984 octets**, SHA-256
  `2E0920B4E2753FEB203E7051E64E10F1B520E96678B3FBE10E4FF2DE8A9B97C7`
  (le binaire de `target\release` est patché par le bundler NSIS).
- Lancement de l'application installée : fenêtre `CBS Shield - Cybrense`,
  captures FR/EN dans [`docs/screenshots/`](docs/screenshots/).
- Désinstallation silencieuse : code 0, binaires et registre supprimés,
  **données utilisateur conservées** ; réinstallation 0.7 : code 0.
- Export d'un instantané réel : nouveau JSON + sidecar `.sha256`, interface
  « Empreinte vérifiée » ; gate `backup_snapshot` devenue disponible, les autres
  gates restant non satisfaites.
- Aucun appel de mutation pare-feu n'a été exécuté.
- Détails : [`docs/SPRINT7_INSTALLER_AUDIT.md`](docs/SPRINT7_INSTALLER_AUDIT.md).
- Cycle VM propre : **en cours / non terminé** ; voir
  [`docs/SPRINT7_TEST_REPORT.md`](docs/SPRINT7_TEST_REPORT.md).

### 5.2 Sprint 6 (historique)

- Installeur NSIS `CBS Shield_0.6.0-dev_x64-setup.exe`, **2 658 926 octets**,
  SHA-256 `650A35AA5A6D59AAB1223D2B41644E5703936C1AE711462227B25112E8784BB8`,
  **non signé (Authenticode : NotSigned)**.
- Binaire installé : **7 361 024 octets**, SHA-256
  `FC44D467DD0D185320B760F6F5D429F6D4D69EC41C2B05C95759786C1FF6F737`.
- Désinstallation : code 0, binaires/raccourci/registre supprimés, **données
  préservées** (base, WAL, clé de quarantaine, signatures, snapshots).
- Détails : [`docs/SPRINT6_INSTALLER_AUDIT.md`](docs/SPRINT6_INSTALLER_AUDIT.md).

---

## 6. Limites et vérifications non exécutées

### Bloqué

- Validation sur **VM Windows 11 propre** : Windows 11 Home ne fournit ni Windows
  Sandbox ni gestion Hyper-V utilisable sans modification non autorisée de
  l'environnement hôte.
- Matrice d'échec installeur : WebView2 absent, réseau coupé, disque plein, UAC
  refusé, mise à niveau inter-versions 0.5 → 0.6.
- Installation réelle de ClamAV en **absence de moteur** : ClamAV 1.5.4 est déjà
  installé ; sa désinstallation n'a pas été autorisée.
- Scenario de pare-feu avec profil actif : les trois profils sont désactivés sur
  l'hôte et les stratégies ne doivent pas être modifiées automatiquement.

### Non exécuté / limites

- Sélecteur de langue NSIS en mode graphique : installation hôte testée en `/S`.
- Restauration effective de règles de pare-feu : volontairement **non implémentée**.
- Scan **Complet** de bout en bout et échec réseau FreshClam natif.
- Accessibilité NVDA/Narrateur, contraste élevé et mouvement réduit visuel.
- Signature Authenticode de l'installeur : aucun certificat disponible.
- Gestion active des règles de pare-feu : **non implémentée, non autorisée**.
- Aucune protection temps réel, aucun pilote noyau.

Détail : [`docs/SPRINT6_ENVIRONMENT_LIMITATIONS.md`](docs/SPRINT6_ENVIRONMENT_LIMITATIONS.md)
et [`docs/SPRINT6_UNRESOLVED_RISKS.md`](docs/SPRINT6_UNRESOLVED_RISKS.md).

---

## 7. Sécurité — rappel

- CBS Shield **ne remplace pas Microsoft Defender** et ne le modifie pas ; Defender
  est resté actif avec protection temps réel.
- Le pare-feu est **strictement observé** ; aucune règle CBS Shield n'a été créée.
  La détection de changement n'est pas une mutation.
- ClamAV reste **externe GPL-2.0**, non embarqué, installé avec autorisation.
- Aucun malware réel n'a été exécuté sur l'hôte pendant le Sprint 6.
- Aucune télémétrie, aucun envoi de fichier ou de rapport.
- L'installeur n'est pas signé : son intégrité repose sur le SHA-256 publié et doit
  être vérifiée avant exécution.

Détail : [`SECURITY.md`](SECURITY.md) et
[`docs/SPRINT6_SECURITY_REGRESSION.md`](docs/SPRINT6_SECURITY_REGRESSION.md).

---

## 8. Feuille de route

| Phase / sprint | Contenu | Statut |
| --- | --- | --- |
| 1 | Scanner manuel ClamAV, historique, quarantaine chiffrée | ✅ |
| 2 | Observation réseau + pare-feu lecture seule | ✅ |
| 3 | Design system, dashboard réel, FR/EN, tray | ✅ |
| 4 | Antivirus avancé, profils, FreshClam, installeur | ✅ |
| 5 | Assistant, provisionnement ClamAV, pare-feu enrichi, installeur 0.5 | ✅ historique ; validation VM partielle |
| 6 | Fiabilité, installation propre, expérience sans terminal, diagnostic pare-feu | ⚠️ Code livré et tests locaux réussis ; VM propre et scénarios d'échec bloqués |
| 7 | Gestion active du pare-feu | Non engagée — autorisation, VM isolée, rollback, revue requis |
| 8 | YARA-X, planification, temps réel | Non commencée — service privilégié et revue requis |

---

## 9. Reproduire la validation

```powershell
# Dépendances
npm --prefix ui install

# Backend
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# Frontend
npm run ui:build
npm run ui:test

# Release + installeur
npm run build

# Hash et signature de l'installeur
Get-FileHash -Algorithm SHA256 `
  'target\release\bundle\nsis\CBS Shield_0.7.0-dev_x64-setup.exe'
Get-AuthenticodeSignature `
  'target\release\bundle\nsis\CBS Shield_0.7.0-dev_x64-setup.exe'
```

---

## 10. Avertissement final

CBS Shield 0.7.0-dev est un projet **expérimental**. Il ne remplace pas Microsoft
Defender, qui doit rester actif. Il ne fournit aucune protection en temps réel,
aucune modification de pare-feu, aucune capture de contenu réseau, et ne doit pas
être présenté comme un antivirus complet. Le Sprint 7 **n'est pas déclaré prêt pour
la production** tant que la VM Windows propre, l'installation en absence de ClamAV,
la mise à niveau depuis 0.6, la désinstallation, les scénarios pare-feu
activé/désactivé et la restauration de règles n'ont pas été validés dans un
environnement isolé. La présence d'un snapshot vérifié ne remplace pas ces preuves.
