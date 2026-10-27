# CBS Shield

> **Scanner de sécurité manuel, open source et local pour Windows 10/11.**
> Édité par **Cybrense** — version expérimentale **0.5.0-dev (Phase 5, sprint 5)**.

CBS Shield est une suite de sécurité modulaire pour Windows. La Phase 1 a livré
une fonctionnalité réellement utilisable de bout en bout : **l'analyse antivirus
manuelle de fichiers et de dossiers avec ClamAV**, l'historique local des rapports
dans SQLite et une **quarantaine chiffrée** avec confirmation explicite de chaque
action.

Le Sprint 2 ajoute deux modules **strictement observationnels, en lecture
seule** : un **Moniteur réseau** (connexions TCP/UDP, ports, processus, trafic
mesuré — métadonnées uniquement, aucune capture de contenu) et un **Pare-feu**
(lecture des profils et règles Windows Firewall, détection de modification par
empreinte). Aucune règle n'est jamais modifiée, aucun contenu réseau n'est lu.

Le Sprint 3 transforme l'interface en produit : **design system « Midnight
Navy »** (thèmes sombre/clair), **tableau de bord temps réel** alimenté
exclusivement par le backend local, **pages Historique, Mises à jour et À
propos & diagnostic**, **architecture de localisation FR/EN** (le shell, le
tableau de bord et les nouveaux modules sont traduits ; la couverture a été
étendue à toute l'interface au sprint 4), et **icône de zone de
notification** minimale (ouvrir/quitter). Les compteurs réseau ont été corrigés :
les sous-couches de filtres NDIS ne sont plus additionnées (mesure contrôlée de
20 Mio : 160 Mo avant, 24,6 Mo après).

Le Sprint 4 livre l'**antivirus avancé** : profils **Rapide / Complète /
Personnalisée**, cibles et exclusions documentées, progression mesurable,
annulation sans corruption, limites de ressources, gestion **FreshClam**
(manuelle et automatique, vérification, reprise, mode hors ligne), explication
du compteur CVD **28 164**, **interface entièrement FR/EN**, export de rapports
et **installeur NSIS 0.4.0-dev**. ClamAV reste un composant officiel externe
(GPLv2) : il n'est ni embarqué ni installé silencieusement. Les limites et les
tests non exécutés sont documentés dans
[SPRINT4_TEST_REPORT.md](docs/SPRINT4_TEST_REPORT.md) ; la validation sur VM
propre reste **non exécutée**.

Le Sprint 5 ajoute l'**assistant de premier lancement** (état réel du moteur,
installation officielle de ClamAV avec autorisation explicite, signatures
officielles, diagnostic), enrichit le **pare-feu en lecture seule** (alertes de
sécurité, détection de changement, mapping connexions → règles, export d'audit)
et livre un **installeur NSIS 0.5.0-dev** avec sélecteur de langue et dossier
`Cybrense` dans le menu Démarrer. Le pare-feu reste **strictement observationnel** :
aucune règle n'est créée, modifiée, activée ou désactivée. La validation sur VM
propre, les scénarios d'échec de l'installeur et l'installation réelle de ClamAV
depuis l'assistant restent **non exécutés** ; voir
[SPRINT5_TEST_REPORT.md](docs/SPRINT5_TEST_REPORT.md).

> CBS Shield **ne remplace pas Microsoft Defender**. Il ne désactive pas Defender,
> n'ajoute aucune exclusion, ne modifie aucune règle de pare-feu, n'installe aucun
> pilote noyau et ne fournit **aucune protection en temps réel**.

---

## Sommaire

- [État actuel](#état-actuel)
- [Fonctionnalités](#fonctionnalités)
- [Prérequis](#prérequis)
- [Installation de ClamAV et des signatures](#installation-de-clamav-et-des-signatures)
- [Démarrage en développement](#démarrage-en-développement)
- [Compilation d'un installeur](#compilation-dun-installeur)
- [Tests](#tests)
- [Où sont stockées les données](#où-sont-stockées-les-données)
- [Sécurité et limites](#sécurité-et-limites)
- [Test EICAR et Microsoft Defender](#test-eicar-et-microsoft-defender)
- [Documentation](#documentation)
- [Licences](#licences)

---

## État actuel

| Élément | État |
| --- | --- |
| Interface React/Tauri (9 sections) | Fonctionnelle, design system 0.5.0 |
| Moteur Rust (`cbs-core`) | Fonctionnel |
| Scan réel ClamAV (fichier/dossier) | Fonctionnel, vérifié |
| Profils Rapide / Complète / Personnalisée | Livrés ; Complète non exécutée de bout en bout |
| Progression, annulation, erreurs par fichier | Fonctionnelles, vérifiées |
| Export JSON / CSV / Markdown / TXT | Fonctionnel, testé |
| Assistant de premier lancement 5 étapes | Fonctionnel, vérifié en FR/EN |
| Installation ClamAV officielle avec autorisation | Conçue et testée par politique ; flux réel non exécuté |
| Mise à jour des signatures (`freshclam`) | Manuelle + automatique, vérifiée |
| Inventaire des signatures (`sigtool`) | Fonctionnel, vérifié (3 642 895 officielles + test séparé) |
| Historique SQLite + page dédiée | Fonctionnel |
| Quarantaine AES-256-GCM + clé DPAPI | Fonctionnelle (restauration et purge vérifiées) |
| Tableau de bord (données réelles) | Fonctionnel, vérifié |
| Localisation FR/EN | Complète (interface, dates, nombres, dialogues) |
| Icône de notification (ouvrir/quitter) | Fonctionnelle, vérifiée |
| Installeur NSIS `currentUser` | Généré pour 0.5.0-dev, sans ClamAV ni signatures |
| Firewall Windows | **Lecture seule** (profils, règles, alertes, changements, mapping) |
| Gestion des règles de pare-feu | **Désactivée** (architecture et prérequis seulement) |
| Network Monitor | **Lecture seule** (métadonnées, volumes mesurés) |
| Protection temps réel / pilote noyau | **Hors périmètre** |

Détail complet, y compris les limites connues : [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md).

## Fonctionnalités

### Antivirus (Phase 1, réel)

- Sélection de plusieurs fichiers et/ou dossiers via le sélecteur natif Windows.
- Analyse réelle avec `clamscan.exe`, options récursive et PUA.
- Progression en direct : fichiers analysés, fichier courant, détections, erreurs.
- Annulation d'un scan en cours (arrêt du processus ClamAV).
- Rapport final : cibles, fichiers analysés, menaces, erreurs non bloquantes,
  durée, version du moteur et des signatures, code de sortie.
- Calcul SHA-256 et taille des fichiers détectés.
- Diagnostic du moteur : `clamscan`, `freshclam`, base de signatures, âge et état
  des signatures. Absence de ClamAV ou de signatures = message explicite, pas de faux scan.
- Mise à jour des signatures via `freshclam`, journal en direct, délai maximal de 30 min.

### Assistant de premier lancement (Sprint 5)

- Ouvert automatiquement une seule fois tant que la configuration initiale n'est
  pas terminée ; réouvrable depuis **Paramètres** ou **Mises à jour**.
- Cinq étapes : accueil, état réel du moteur, signatures officielles, protection
  réseau observée, résumé.
- Si ClamAV manque : proposition d'installation **officielle** (`Cisco.ClamAV`
  via winget) ou de localisation d'une installation existante. L'installation
  exige une **case d'autorisation explicite**, affiche une console visible et
  n'utilise aucun mode silencieux.
- Aucun téléchargement de ClamAV depuis un site arbitraire, aucun binaire embarqué,
  aucune élévation automatique de CBS Shield.
- Si l'installation ou la mise à jour échoue, l'assistant affiche le code, la
  sortie et les étapes de reprise ; il ne prétend jamais que le moteur est prêt.
- La progression est enregistrée dans les réglages locaux (`onboardingCompleted`).

### Historique

- Chaque scan est enregistré dans `cbs-shield.db` (SQLite, mode WAL).
- Tableau de bord : nombre de scans, fichiers analysés, détections, quarantaine active.
- Les erreurs de persistance sont affichées ; le rapport reste consultable en mémoire.

### Quarantaine

- Déplacement **uniquement sur confirmation explicite** depuis un rapport de détection.
- Chiffrement **AES-256-GCM** par fichier, avec identifiant en données authentifiées.
- Clé aléatoire protégée par **Windows DPAPI** (portée utilisateur courant).
- Restauration vers le chemin d'origine uniquement, sans écrasement, avec vérification SHA-256.
- Suppression définitive du blob : case à cocher **et** saisie du mot `SUPPRIMER`.
- Aucune suppression automatique de fichier, aucune exécution de fichier.

### Firewall / Network Monitor (lecture seule)

- **Moniteur réseau** : connexions TCP/UDP, ports, PID et processus, volumes par
  interface mesurés via `GetIfTable2` ; métadonnées uniquement, aucun contenu,
  aucune socket ouverte par CBS Shield. Les couches de filtres NDIS sont exclues
  des compteurs (sprint 3).
- **Pare-feu** : profils et règles Windows lus via l'API documentée
  `INetFwPolicy2`, alertes de sécurité (profils désactivés, action entrante
  permissive), détection de changement par empreinte composite profils + règles,
  mapping indicatif des connexions TCP vers les règles via le chemin d'image réel
  du processus, export JSON en lecture seule. Aucune règle n'est créée, modifiée,
  activée ou désactivée ; aucun pilote installé.
- La **gestion des règles** est visible dans l'interface mais **verrouillée** :
  elle exige une autorisation explicite, une VM isolée et une restauration
  validée. Aucune commande de mutation n'est exposée.
- Ces deux modules n'exigent aucune élévation et n'ont aucun effet de bord.

## Prérequis

- Windows 10 1809+ ou Windows 11 (x64).
- [ClamAV pour Windows](https://www.clamav.net/downloads) 1.5.x (testé avec 1.5.4).
- WebView2 Runtime (préinstallé sur Windows 11 récent).
- Pour compiler : Rust ≥ 1.85 (MSVC), Node.js ≥ 20, npm, Visual Studio 2022 Build
  Tools avec la charge « Développement Desktop en C++ ».

## Installation de ClamAV et des signatures

ClamAV reste un composant externe **GPL-2.0**, installé séparément et **non
redistribué** avec CBS Shield.

Au premier lancement, l'assistant propose de lancer l'installation officielle
avec une autorisation explicite :

```powershell
winget install --id Cisco.ClamAV --exact
```

La commande est exécutée dans une **console visible**, sans option silencieuse et
sans élévation automatique de CBS Shield. L'UAC de Windows peut apparaître : son
acceptation reste un choix de l'utilisateur. Il est aussi possible d'ignorer cette
étape, de fermer l'assistant, puis d'installer ClamAV manuellement.

Le paquet MSI installe `clamscan.exe` et `freshclam.exe` dans
`C:\Program Files\ClamAV`. CBS Shield détecte automatiquement ces binaires (PATH et
emplacements standards) ; un chemin personnalisé peut être saisi dans **Paramètres**.

Comme le dossier `Program Files` exige des droits administrateur, CBS Shield maintient
sa base de signatures **dans le profil utilisateur** :

```
%LOCALAPPDATA%\Cybrense\CBS Shield\clamav\database
```

Deux moyens de la remplir :

1. **Depuis l'application** : section Antivirus → « Mettre à jour les signatures ».
2. **En ligne de commande**, sans élévation :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-clamav-signatures.ps1
```

Le script écrit un `freshclam.conf` local et lance `freshclam`. Le premier
téléchargement représente plus de 100 Mo.

> Si vous préférez la base système de ClamAV (mise à jour par un administrateur),
> renseignez son dossier dans **Paramètres → Dossier de signatures**.

## Démarrage en développement

Toutes les commandes se lancent **depuis la racine du dépôt** (le CLI Tauri y
recherche `src-tauri`) :

```powershell
# 1. Dépendances frontend
npm --prefix ui install

# 2. Lancer Tauri (compile le backend Rust et démarre Vite)
npm run dev
```

`npm run dev` appelle le CLI Tauri installé dans `ui/node_modules` et démarre
automatiquement Vite sur le port 1420. Équivalent direct :

```powershell
.\ui\node_modules\.bin\tauri.cmd dev
```

> Ne lancez pas `npm --prefix ui run tauri dev` : le CLI chercherait `src-tauri`
> sous `ui\` et ne le trouverait pas. Les scripts `npm run dev` et `npm run build`
> de la racine gèrent ce point.

Le premier build Rust peut prendre plusieurs minutes.

## Compilation d'un installeur

```powershell
npm run build
```

Cette commande compile l'interface, le backend en mode `release`, puis génère un
installeur **NSIS** :

```
target\release\bundle\nsis\CBS Shield_0.5.0-dev_x64-setup.exe
target\release\cbs-shield.exe
```

Artefact de référence vérifié le 27 octobre 2026 : **2 651 293 octets**
(2,53 Mio), SHA-256
`4D27F240511A8AE9563434706770AAA3BD3D63E61128B0E384E92A445067B226`,
**non signé**. Vérifiez ce hash avant exécution.

Le premier build télécharge l'outillage NSIS (mis en cache par Tauri). Comptez
plusieurs minutes pour la compilation `release`. L'installeur est en mode
`currentUser` : **aucune élévation administrateur** n'est nécessaire pour installer
CBS Shield.

## Tests

```powershell
# Rust : unitaires + intégration (ClamAV réel si installé)
cargo test --workspace

# Frontend : TypeScript + Vitest
npm --prefix ui run build
npm --prefix ui test
```

Les tests d'intégration ClamAV sont **ignorés automatiquement** (avec message) si
ClamAV ou la base de signatures est absent. Ils n'utilisent aucun malware :

- détection d'un fichier bénin via une signature de test ClamAV locale (NDB) ;
- scan propre d'un fichier texte avec la vraie base de signatures ;
- test EICAR marqué `#[ignore]`, réservé au diagnostic manuel.

Détail des résultats obtenus : [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md).

## Où sont stockées les données

Tout est local, dans le profil de l'utilisateur courant :

```
%LOCALAPPDATA%\Cybrense\CBS Shield\
├─ cbs-shield.db          # historique SQLite (scans, détections, quarantaine, réglages)
├─ quarantine\            # blobs chiffrés <uuid>.cbsq
├─ quarantine.key         # clé AES protégée par DPAPI (compte Windows courant)
├─ firewall-backups\      # snapshots JSON du pare-feu, en lecture seule
└─ clamav\
   ├─ database\           # signatures .cvd / .cld / .ndb
   ├─ freshclam.conf      # généré par CBS Shield
   └─ freshclam.log
```

Variable d'environnement pour déplacer la racine (tests, profil portable) :

```powershell
$env:CBS_SHIELD_DATA_DIR = "D:\CBS-Shield-Data"
```

Aucune télémétrie, aucun compte, aucun envoi de fichier. Le seul accès réseau est la
mise à jour explicite des signatures via `freshclam` vers `database.clamav.net`.

## Sécurité et limites

- **Protection manuelle uniquement** : pas de temps réel, pas de surveillance de
  processus, pas de blocage d'exécution.
- **Un scan propre ne prouve pas l'absence de malware** : seules les signatures
  chargées ont été appliquées.
- **Microsoft Defender reste actif** et demeure la protection principale. CBS Shield
  ne le désactive pas, ne le contourne pas et n'ajoute pas d'exclusion.
- Aucune règle de pare-feu modifiée, aucun pilote noyau, aucune élévation de
  privilèges de CBS Shield. L'assistant ClamAV peut déclencher l'UAC **de winget**
  après autorisation explicite ; CBS Shield ne s'élève pas lui-même.
- La gestion des règles de pare-feu est **désactivée** et aucune API de mutation
  n'existe. Les alertes et le mapping sont informatifs, pas des verdicts.
- Les fichiers en quarantaine ne sont **jamais** exécutés ni supprimés automatiquement.
- Un scan peut produire des erreurs non bloquantes (fichiers verrouillés, accès
  refusé, archives corrompues) : elles sont listées dans le rapport.
- Les limites de taille, de formats d'archives et de profondeur sont celles de ClamAV.

Voir [SECURITY.md](SECURITY.md) pour le modèle de menace et les signalements.

## Test EICAR et Microsoft Defender

Le test EICAR est le standard de fait pour vérifier un antivirus sans utiliser de
malware. Sur cette machine de développement, **Microsoft Defender bloque la lecture du
fichier EICAR par ClamAV** (`Win32 error 225`). Conformément aux contraintes du projet,
CBS Shield **ne désactive pas Defender** et **n'ajoute pas d'exclusion**.

Conséquence : la détection EICAR de bout en bout n'a pas pu être validée dans cet
environnement. La chaîne de détection réelle est néanmoins vérifiée avec une signature
ClamAV de test inoffensive (voir `crates/cbs-core/tests/clamav_integration.rs`).

Script de diagnostic manuel (à exécuter uniquement dans un dossier temporaire dédié,
avec votre accord explicite) :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\eicar-manual-test.ps1
```

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — crates, flux de données, IPC, schéma SQLite.
- [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) — jetons, typographie, mouvement, layout, accessibilité.
- [UI_COMPONENTS.md](UI_COMPONENTS.md) — inventaire et contrats des composants UI.
- [UX_TEST_REPORT.md](UX_TEST_REPORT.md) — validations réelles, captures et limites UX.
- [SECURITY_AUDIT.md](SECURITY_AUDIT.md) — constats de sécurité et corrections.
- [SECURITY.md](SECURITY.md) — modèle de menace, chiffrement, signalement de vulnérabilité.
- [LICENSES.md](LICENSES.md) — licences du code et des composants tiers.
- [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) — état vérifié, tests, limites, feuille de route.
- [SPRINT4_ANTIVIRUS.md](docs/SPRINT4_ANTIVIRUS.md) — profils, cibles, limites, signatures, mises à jour.
- [SPRINT4_INSTALLER_AUDIT.md](docs/SPRINT4_INSTALLER_AUDIT.md) — contenu NSIS, dépendances, provisionnement ClamAV.
- [SPRINT4_TEST_REPORT.md](docs/SPRINT4_TEST_REPORT.md) — tests exécutés, non exécutés et captures.
- [SPRINT4_SECURITY_REGRESSION.md](docs/SPRINT4_SECURITY_REGRESSION.md) — garanties sécurité et non-régression.
- [SPRINT4_CLEAN_INSTALL.md](docs/SPRINT4_CLEAN_INSTALL.md) — validation VM propre (non exécutée).
- [SPRINT5_TEST_REPORT.md](docs/SPRINT5_TEST_REPORT.md) — tests Sprint 5, E2E natif, limites.
- [SPRINT5_CLEAN_INSTALL.md](docs/SPRINT5_CLEAN_INSTALL.md) — installation hôte et VM (VM non exécutée).
- [SPRINT5_INSTALLER_AUDIT.md](docs/SPRINT5_INSTALLER_AUDIT.md) — contenu NSIS, langues, SHA-256.
- [SPRINT5_SECURITY_REGRESSION.md](docs/SPRINT5_SECURITY_REGRESSION.md) — garanties et risques résiduels.
- [SPRINT5_MALWARE_INVESTIGATION.md](docs/SPRINT5_MALWARE_INVESTIGATION.md) — détection `Win.Packed.Mikey`, analyse non destructive.

## Licences

- Code CBS Shield : **Apache-2.0** (voir [LICENSE](LICENSE)).
- ClamAV : **GPL-2.0**, composant externe installé séparément, **non redistribué**.
- Les autres dépendances sont détaillées dans [LICENSES.md](LICENSES.md).

« CBS Shield » et « Cybrense » sont des marques de Cybrense. Aucune affiliation avec
Cisco Talos / le projet ClamAV.
