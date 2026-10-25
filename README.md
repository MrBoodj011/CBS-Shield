# CBS Shield

> **Scanner de sécurité manuel, open source et local pour Windows 10/11.**
> Édité par **Cybrense** — version expérimentale **0.1.0 (Phase 1)**.

CBS Shield est une suite de sécurité modulaire pour Windows. La Phase 1 livre une
fonctionnalité réellement utilisable de bout en bout : **l'analyse antivirus manuelle
de fichiers et de dossiers avec ClamAV**, l'historique local des rapports dans SQLite
et une **quarantaine chiffrée** avec confirmation explicite de chaque action.

Le reste de la suite (pare-feu, moniteur réseau) est **volontairement absent** et
affiché comme « Non disponible » dans l'interface. Rien n'est simulé.

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
| Interface React/Tauri (6 sections) | Fonctionnelle |
| Moteur Rust (`cbs-core`) | Fonctionnel |
| Scan réel ClamAV (fichier/dossier) | Fonctionnel, vérifié |
| Mise à jour des signatures (`freshclam`) | Fonctionnelle, sans élévation |
| Historique SQLite | Fonctionnel |
| Quarantaine AES-256-GCM + clé DPAPI | Fonctionnelle |
| Installeur NSIS `currentUser` | Généré (2,30 Mo), build release OK |
| Firewall | **Non disponible** (Phase 2) |
| Network Monitor | **Non disponible** (Phase 2) |
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

### Firewall / Network Monitor

- Sections présentes, clairement marquées **« Non disponible »**.
- Aucune lecture ni modification des règles Windows Firewall.
- Aucune capture réseau, aucune socket ouverte par ces modules.

## Prérequis

- Windows 10 1809+ ou Windows 11 (x64).
- [ClamAV pour Windows](https://www.clamav.net/downloads) 1.5.x (testé avec 1.5.4).
- WebView2 Runtime (préinstallé sur Windows 11 récent).
- Pour compiler : Rust ≥ 1.85 (MSVC), Node.js ≥ 20, npm, Visual Studio 2022 Build
  Tools avec la charge « Développement Desktop en C++ ».

## Installation de ClamAV et des signatures

ClamAV reste un composant externe **GPL-2.0**, installé séparément et **non
redistribué** avec CBS Shield.

```powershell
winget install --id Cisco.ClamAV --exact
```

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
target\release\bundle\nsis\CBS Shield_0.1.0_x64-setup.exe
target\release\cbs-shield.exe
```

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
- Aucune règle de pare-feu, aucun pilote noyau, aucune élévation de privilèges.
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
- [SECURITY.md](SECURITY.md) — modèle de menace, chiffrement, signalement de vulnérabilité.
- [LICENSES.md](LICENSES.md) — licences du code et des composants tiers.
- [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) — état vérifié, tests, limites, feuille de route.

## Licences

- Code CBS Shield : **Apache-2.0** (voir [LICENSE](LICENSE)).
- ClamAV : **GPL-2.0**, composant externe installé séparément, **non redistribué**.
- Les autres dépendances sont détaillées dans [LICENSES.md](LICENSES.md).

« CBS Shield » et « Cybrense » sont des marques de Cybrense. Aucune affiliation avec
Cisco Talos / le projet ClamAV.
