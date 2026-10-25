# État du développement — CBS Shield 0.2.0-dev (Phase 2, sprint 2)

**Date de vérification :** 25 octobre 2026
**Branche :** `sprint-2` (base `9a735e0`)
**Nature :** version expérimentale, scanner manuel + deux modules d'observation en lecture seule.

Ce document décrit ce qui a été **réellement implémenté et vérifié**, ce qui ne l'est
pas, et les limites connues. Aucune fonctionnalité non testée n'est présentée comme
opérationnelle.

---

## 1. Environnement de validation

| Élément | Valeur |
| --- | --- |
| Système | Windows 11 Home, build 26200 |
| Rust | 1.99.1, toolchain MSVC |
| Node.js / npm | 24.18 / 12 |
| WebView2 | Runtime 155 |
| ClamAV | 1.5.4 (installation `winget`, `Cisco.ClamAV`) |
| Base de signatures | version `28164`, publiée le dim. 25 oct. 2026 |
| Emplacement des signatures | `%LOCALAPPDATA%\Cybrense\CBS Shield\clamav\database` |
| Visual Studio | 2022 Build Tools (C++) |

> Les signatures sont mises à jour régulièrement : les numéros ci-dessus sont ceux
> observés lors de la validation, pas une exigence.

## 2. Composants livrés

### Backend Rust

| Crate | Contenu | État |
| --- | --- | --- |
| `cbs-core` | modèles, découverte ClamAV, parsing `clamscan`, orchestration, progression, annulation, extraction des erreurs par fichier (stderr) | Complet et testé |
| `cbs-store` | SQLite v2 (scans, détections, quarantaine, réglages, `netmon_snapshots`), migration v1→v2 testée, tableau de bord | Complet et testé |
| `cbs-quarantine` | AES-256-GCM, clé DPAPI, store/restore/purge, anti-écrasement, purge des blobs orphelins (crash) | Complet et testé |
| `cbs-netmon` | **Nouveau** : capture TCP/UDP via `GetExtendedTcpTable`/`GetExtendedUdpTable`, compteurs d'interface via `GetIfTable2`, noms de processus via `OpenProcess`+`QueryFullProcessImageNameW` | Complet et testé |
| `cbs-firewall` | **Nouveau** : observation lecture seule de la stratégie Windows Firewall (`windows-firewall 0.8` + COM direct `INetFwPolicy2`), empreinte SHA-256 du jeu de règles | Complet et testé |
| `src-tauri` | commandes IPC (`netmon_snapshot`, `netmon_history`, `firewall_status`, …), état partagé, chemins canonisés, événements, validation restaurations renforcée | Compilé et testé |

### Interface React

| Section | État |
| --- | --- |
| Dashboard | Fonctionnel : stats, dernier scan, état moteur ; cartes Firewall/Network passées en « Observation » (cliquables) |
| Antivirus | Fonctionnel : sélection, scan réel, progression, annulation, rapport, mise en quarantaine ; refus de mise à jour pendant un scan |
| Firewall | **Fonctionnel (lecture seule)** : profils (actif/état/défauts), 665 règles réelles listées avec recherche, bannière de détection de modification, garde-fous |
| Network Monitor | **Fonctionnel (lecture seule)** : TCP/UDP (63/95 connexions observées), recherche + filtre transport, rafraîchissement auto 5 s, historique local 2 000 lignes, deltas mesurés honnêtes |
| Quarantaine | Fonctionnel : liste, restauration (destination revalidée), suppression à double confirmation |
| Paramètres | Fonctionnel : thème, options, chemins ClamAV, seuil de fraîcheur, diagnostic |

Fonctions transverses : thème sombre/clair/système, notifications, bannière
d'avertissement, responsive, états vides, messages d'erreur explicites.

## 3. Tests et résultats

Commande : `cargo test --workspace` — **toutes les suites `ok`** (code de sortie 0).

| Suite | Tests | Résultat |
| --- | --- | --- |
| `cbs-core` (unitaires : parsing, moteur, scan, extract_file_errors) | 20 | ✅ 20 réussis |
| `cbs-core` (intégration ClamAV réelle) | 4 | ✅ 3 réussis, 1 ignoré (EICAR manuel) |
| `cbs-core` (mission E : volume 240 fichiers + fichier verrouillé) | 2 | ✅ 2 réussis |
| `cbs-firewall` (fingerprint, tri, COM réel) | 3 | ✅ 3 réussis |
| `cbs-netmon` (capture réelle, delta pur, bornes) | 4 | ✅ 4 réussis |
| `cbs-quarantine` (dont blobs orphelins crash) | 9 | ✅ 9 réussis |
| `cbs-shield` (chemins verbatim, gardes restaurations, classification mises à jour) | 12 | ✅ 12 réussis |
| `cbs-store` (schéma v2, migration v1→v2, historique netmon) | 7 | ✅ 7 réussis |
| **Total Rust** | **61** | **60 réussis, 0 échec, 1 ignoré** |

Frontend :

| Commande | Résultat |
| --- | --- |
| `npm run ui:build` | ✅ `tsc --noEmit` + Vite OK (1 953 modules, ~315 Ko JS) |
| `npm run ui:test` | ✅ 10 tests / 3 fichiers (format, `UnavailablePanel`, `NetworkMonitor` avec IPC simulé) |

Qualité Rust :

| Commande | Résultat |
| --- | --- |
| `cargo fmt --all -- --check` | ✅ propre |
| `cargo clippy --workspace --all-targets -- -D warnings` | ✅ aucun avertissement |
| `cargo test --workspace` | ✅ 60 réussis, 1 ignoré |

## 4. Vérifications fonctionnelles effectuées

### 4.1 Audit de sécurité et corrections (sprint 2)

Audit appliqué avec corrections immédiates (détail : `SECURITY_AUDIT.md`) :

- **(Critique)** `canonicalize()` Windows renvoie des chemins `\\?\C:\…` : **tous les
  gardes `starts_with` de la Phase 1 ne correspondaient jamais**. Corrections dans
  `vault.rs` (`normalized_path`/`is_inside`), garde quarantaine/répertoire de données
  effectivement fonctionnelle + revalidation des destinations de restauration (5 tests).
- **(Élevé)** `probe_version` sans limite de temps → `execute_with_timeout` avec
  arrêt du processus (`PROBE_TIMEOUT`).
- **(Élevé)** verrouillage OS : qu'une mise à jour de signatures ne démarre pas
  pendant un scan (`is_scanning`), classification pure des runs `freshclam`
  (6 tests).
- **(Moyen)** buffet de lecture stdout/stderr borné à 64 Ko par ligne + erreur explicite,
  purge des blobs `.<id>.tmp` orphelins après un crash de mise en quarantaine.
- **(Moyen)** base de données `/schema` migrée v1→v2 (`netmon_snapshots`,
  rétention 2 000 lignes) sans perte, migration testée.
- **(Moyen)** erreurs « Can't open file » de ClamAV (stderr) converties en enregistrements
  d'erreur **par fichier** : un fichier verrouillé donne `completedWithErrors` explicitant
  l'objet, pas un `failed` opaque (vérifié sur un vrai fichier verrouillé avec
  `share_mode(0)`).

### 4.2 Moniteur réseau — parcours réel

Validé sur la fenêtre Tauri, données système réelles :

1. Ouverture de la section : **63 connexions TCP, 95 ports UDP, 158 lignes** affichées,
   processus associés (chrome.exe, System, nvcontainer.exe…). ✅
2. **Rafraîchissement auto (5 s)** activé : comptes mis à jour (UDP 95 → 99), historique
   alimenté, captures espacées par une garde anti-recouvrement. ✅
3. **Deltas mesurés réels** : 174 Mo reçus / 450 Ko émis sur une fenêtre de 5 s
   (trafic navigateur réel) ; première capture marquée 0 o (aucun intervalle). ✅
4. Historique persisté en SQLite (2 000 lignes max, purge auto). ✅
5. Recherche + filtre transport (TCP/UDP/TCP établies) effectifs. ✅

### 4.3 Pare-feu — parcours réel

Validé sur la fenêtre Tauri, configuration réelle de la machine :

1. **Profils** : les trois profils rapportés « Désactivé », conforme à
   `Get-NetFirewallProfile` (tous `Enabled=False`) — viz la vérification croisée. ✅
2. **Défauts par profil** : `bloquer` en entrant / `autoriser` en sortant, lus via COM
   direct `INetFwPolicy2` (après correction du `NET_FW_PROFILE2_PUBLIC` : 0x4, pas 0x3 —
   voir audit). ✅
3. **Profil actif** : badge `Actif : privé + public` (masque 6 lu via
   `CurrentProfileTypes()`, cas que l'API mono-profil ne représente pas). ✅
4. **Règles** : 665 règles annoncées, liste bornée avec recherche par nom/programme/
   protocole/port — règles réelles du poste (Intel, Clipchamp, Microsoft.AAD…). ✅
5. **Aucune écriture** : aucune règle ajoutée, supprimée, activée ou désactivée
   (aucun appel `put_*` dans tout le crate `cbs-firewall`). ✅

### 4.4 Parcours Phase 1 (non régressés)

1. Scan propre réel (1 fichier analysé, 0 menace) via IPC + ClamAV réel. ✅
2. Détection de marqueur de test inoffensive + hash/taille affichés. ✅
3. Quarantaine/restauration/purge à confirmations multiples inchangées. ✅
4. Persistance SQLite après rescan. ✅

## 5. Limite EICAR / Microsoft Defender

Le test EICAR de bout en bout **n'a pas pu être validé sur la machine de
développement** : Microsoft Defender bloque la lecture du fichier EICAR par ClamAV
(`Win32 error 225`). Conformément aux contraintes du projet :

- Defender **n'a pas été désactivé** ;
- **aucune exclusion** n'a été ajoutée ;
- aucun malware réel n'a été téléchargé ou exécuté.

La chaîne de détection est donc validée avec une signature ClamAV de test inoffensive,
ce qui exerce le même chemin de code (lancement, parsing, détection, hash, événements),
sans dépendre du fichier EICAR.

Le script `scripts/eicar-manual-test.ps1` permet de refaire le diagnostic sur une
machine où Defender ne bloque pas la lecture, avec confirmation explicite. Un échec
lié à Defender est une limite de l'environnement, pas une preuve de défaut du moteur.

## 6. Limites connues

### Sécurité / fonctionnel

- **Pas de protection en temps réel** : le moniteur réseau observe, il ne bloque rien ;
  aucune interrogation de processus en continu entre deux captures explicites.
- **Pare-feu et moniteur réseau en lecture seule** : aucune écriture système n'existe ;
  la détection de modification du pare-feu dépend d'une observation préalable locale
  (empreinte SHA-256 des règles).
- La liste des règles du pare-feu est **bornée à l'affichage** (compteur complet
  disponible) ; l'empreinte porte sur l'intégralité.
- **Pas de YARA-X** planifié en sprint 2 (Phase 3).
- Un scan propre **ne garantit pas** l'absence de malware (signatures uniquement).
- Les archives, tailles et formats supportés sont ceux de ClamAV.
- La base SQLite (chemins, hashes, résumés réseau) n'est **pas chiffrée** ; elle est
  protégée par les permissions du profil Windows.
- La clé de quarantaine perdue rend les blobs irrécupérables (limite assumée du chiffrement).
- Les fichiers de plus de 512 Mo sont refusés par la quarantaine.
- Les liens symboliques ne sont pas mis en quarantaine.
- La restauration n'est possible que vers le chemin d'origine ou un chemin explicite
  hors du coffre et du répertoire de données (refus validation) ; jamais d'écrasement.
- Un seul scan simultané ; maximum 64 cibles par scan ; mise à jour de signatures
  refusée pendant un scan.
- Le premier scan est lent car ClamAV charge toute la base en mémoire.
- Le moniteur réseau n'identifie pas tous les processus (processus système protégés,
  PID 0/4) ; le nom manquant est affiché « inconnu », jamais inventé.
- Les deltas réseau mesurent les **compteurs cumulés d'interface** entre deux captures :
  toute capture survolée manuellement par une capture auto invalide l'intervalle
  (garde anti-recouvrement côté UI).

### Environnement

- EICAR bloqué par Defender (voir section 5).
- `freshclam` peut échouer si l'utilisateur configure un dossier système en écriture
  protégée ; le message d'erreur est affiché, aucune élévation n'est tentée. Une
  interruption forcée de `freshclam` (kill) laisse des fichiers temporaires dans le
  dossier de signatures ; ils sont ignorés par le compteur de fichiers de base
  (`daily.cvd`/`main.cvd`/`bytecode.cvd`) et remplacés par la mise à jour suivante.
- L'installeur NSIS n'a pas été exécuté sur le poste de validation (voir plan de test
  machine propre : `VM_TEST_PLAN.md`).

## 7. Feuille de route

| Phase | Contenu | Statut |
| --- | --- | --- |
| 1 | Scanner manuel ClamAV, historique, quarantaine chiffrée | ✅ Livrée (expérimentale) |
| 2 | Observation réseau + fondation pare-feu lecture seule | ✅ Sprint 2 livré (strictement observationnel) |
| 3 | YARA-X, planification, protection temps réel | Non commencée |

Toute fonctionnalité de sécurité active (temps réel, pilote, filtrage réseau) exigera
une conception dédiée, des privilèges adaptés, une réversibilité et une revue de
sécurité — jamais une activation silencieuse.

## 8. Reproduire la validation

```powershell
# Dépendances (depuis la racine du dépôt)
npm --prefix ui install

# Backend
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# Frontend
npm run ui:build
npm run ui:test

# Application (dev)
npm run dev

# Installeur NSIS + exécutable release
npm run build

# Diagnostic EICAR manuel (optionnel, confirmation requise)
powershell -ExecutionPolicy Bypass -File .\scripts\eicar-manual-test.ps1

# Plan de validation machine propre (consentement explicite requis)
powershell -ExecutionPolicy Bypass -File .\scripts\vm-validate.ps1
```

## 9. Avertissement final

CBS Shield 0.2.0-dev est un projet **expérimental**. Il ne remplace pas Microsoft
Defender, qui doit rester actif. Il ne fournit aucune protection automatique, aucune
modification de configuration pare-feu, aucune capture de contenu réseau et ne doit
pas être présenté comme un antivirus complet.
