# État du développement — CBS Shield 0.1.0 (Phase 1)

**Date de vérification :** 25 octobre 2026
**Branche :** `main`
**Nature :** version expérimentale, scanner manuel uniquement.

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
| Base de signatures | version `28164`, publiée le dim. 25 oct. 2026 06:24:12 |
| Emplacement des signatures | `%LOCALAPPDATA%\Cybrense\CBS Shield\clamav\database` |
| Visual Studio | 2022 Build Tools (C++) |
| Espace disque libre | ~438 Go au moment de l'audit |

> Les signatures sont mises à jour régulièrement : les numéros ci-dessus sont ceux
> observés lors de la validation initiale, pas une exigence.

## 2. Composants livrés

### Backend Rust

| Crate | Contenu | État |
| --- | --- | --- |
| `cbs-core` | modèles, découverte ClamAV, parsing `clamscan`, orchestration, progression, annulation | Complet et testé |
| `cbs-store` | SQLite (scans, détections, quarantaine, réglages), tableau de bord | Complet et testé |
| `cbs-quarantine` | AES-256-GCM, clé DPAPI, store/restore/purge, anti-écrasement | Complet et testé |
| `src-tauri` | commandes IPC, état partagé, chemins, événements, validation | Compilé et testé |

### Interface React

| Section | État |
| --- | --- |
| Dashboard | Fonctionnel : stats, dernier scan, état moteur, modules |
| Antivirus | Fonctionnel : sélection, scan réel, progression, annulation, rapport, mise en quarantaine |
| Firewall | **Non disponible** (Phase 2), aucun accès système |
| Network Monitor | **Non disponible** (Phase 2), aucune capture |
| Quarantaine | Fonctionnel : liste, restauration, suppression à double confirmation |
| Paramètres | Fonctionnel : thème, options, chemins ClamAV, seuil de fraîcheur, diagnostic |

Fonctions transverses : thème sombre/clair/système, notifications, bannière
d'avertissement, responsive, états vides, messages d'erreur explicites.

## 3. Tests et résultats

Commande : `cargo test --workspace` — **code de sortie 0**.

| Suite | Tests | Résultat |
| --- | --- | --- |
| `cbs-core` (unitaires : parsing, moteur, scan) | 15 | ✅ 15 réussis |
| `cbs-core` (intégration ClamAV réelle) | 4 | ✅ 3 réussis, 1 ignoré (EICAR manuel) |
| `cbs-quarantine` | 7 | ✅ 7 réussis |
| `cbs-store` | 4 | ✅ 4 réussis |
| `cbs-shield` (validation des chemins) | 3 | ✅ 3 réussis |
| Doc-tests | 0 | — |
| **Total** | **33** | **32 réussis, 0 échec, 1 ignoré** |

Détail des tests d'intégration réels :

1. `engine_probe_reports_signatures_from_the_local_database` — vérifie que
   `clamscan --database=<base CBS Shield> --version` expose bien la version de
   signatures et un état cohérent. ✅
2. `detects_benign_file_with_real_clamav_and_test_signature` — crée une signature NDB
   locale inoffensive, scanne un fichier bénin et vérifie la détection, le SHA-256,
   la taille et les événements. ✅
3. `scans_a_harmless_file_clean_with_real_database` — scanne un fichier texte avec la
   vraie base de signatures (24,96 s pour l'ensemble des tests d'intégration). ✅
4. `eicar_manual_diagnostic` — marqué `#[ignore]`, diagnostic manuel. Non exécuté par
   défaut (voir section 5).

Frontend :

| Commande | Résultat |
| --- | --- |
| `npm --prefix ui run build` | ✅ `tsc --noEmit` + Vite OK (1 954 modules, ~300 Ko JS, ~34 Ko CSS) |
| `npm --prefix ui test` | ✅ 8 tests / 2 fichiers (helpers de format, `UnavailablePanel`) |

Qualité Rust :

| Commande | Résultat |
| --- | --- |
| `cargo fmt --all -- --check` | ✅ après formatage |
| `cargo clippy --workspace --all-targets -- -D warnings` | ✅ aucun avertissement |
| `cargo test --workspace` | ✅ 32 réussis, 1 ignoré |

## 4. Vérifications fonctionnelles effectuées

### 4.1 Moteur, bibliothèques et tests

- `clamscan --database=<base CBS Shield> --version` retourne bien ClamAV 1.5.4 et la
  version de signatures attendue.
- Une signature de test ClamAV personnalisée (`.ndb`) est détectée via le binaire
  réel : `CBS-Shield-Test-Signature.UNOFFICIAL FOUND`.
- Le scan d'un fichier bénin avec la base complète se termine `clean`, sans erreur.
- Les tests de quarantaine couvrent : chiffrement + suppression de la source,
  restauration avec contenu identique, refus d'écrasement, refus de mauvais hash,
  liaison AAD à l'identifiant, purge idempotente, refus des dossiers/liens.
- Les tests SQLite couvrent : sauvegarde/lecture des scans, agrégats du tableau de
  bord, audit de la quarantaine, upsert des réglages.
- L'application Tauri se compile et se lance (fenêtre native, IPC opérationnel).

### 4.2 Parcours complet dans l'interface native

Validé le 25/10/2026 sur la fenêtre Tauri, avec la base de signatures réelle
`28164` (3 fichiers de base) :

1. **Scan propre réel** : sélection de `README.md` via le sélecteur Windows, scan
   ClamAV → 1 fichier analysé, 0 menace, 0 erreur, 7,3 s, rapport « Aucune menace ».
2. **Détection réelle d'un marqueur de test** : une signature NDB de test
   **inoffensive** a été ajoutée temporairement à la base app-local, puis retirée. Le
   fichier bénin de 47 octets a été détecté comme `CBS-Shield-E2E-Test.UNOFFICIAL`,
   avec SHA-256 et taille affichés. Après retrait, le diagnostic moteur est revenu à
   3 fichiers de base.
3. **Quarantaine confirmée** : case à cocher obligatoire dans la boîte de dialogue,
   puis déplacement → source absente, blob `.cbsq` créé dans le coffre, entrée listée
   avec hash, origine, taille, date et statut « Isolé ».
4. **Restauration confirmée** : case à cocher, restauration vers le chemin d'origine
   → contenu identique à l'octet près, blob retiré, entrée conservée avec le statut
   « Restauré ».
5. **Purge confirmée** : nouvelle mise en quarantaine, puis suppression avec case à
   cocher **et** saisie de `SUPPRIMER` → blob effacé, coffre vide, entrée d'audit
   conservée avec le statut « Supprimé ».
6. **Persistance SQLite** : après trois scans, le tableau de bord affiche 3 scans,
   3 fichiers analysés, 2 détections historiques, 0 quarantaine active et la date du
   dernier scan. Les données survivent à la navigation entre sections.
7. **Sections non implémentées** : Firewall et Network Monitor affichent
   explicitement « Non disponible » et rappellent qu'aucune règle système n'est lue
   ou modifiée.
8. **Installeur** : `npm run build` produit l'exécutable release et l'installeur NSIS
   `CBS Shield_0.1.0_x64-setup.exe` (2,30 Mo).

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

- **Pas de protection en temps réel**, pas de surveillance de processus, pas de blocage
  d'exécution.
- **Pas de pare-feu** ni de moniteur réseau : sections « Non disponible ».
- **Pas de YARA-X** actif en Phase 1.
- Un scan propre **ne garantit pas** l'absence de malware (signatures uniquement).
- Les archives, tailles et formats supportés sont ceux de ClamAV.
- La base SQLite (chemins, hashes) n'est **pas chiffrée** ; elle est protégée par les
  permissions du profil Windows.
- La clé de quarantaine perdue rend les blobs irrécupérables (limite assumée du chiffrement).
- Les fichiers de plus de 512 Mo sont refusés par la quarantaine.
- Les liens symboliques ne sont pas mis en quarantaine.
- La restauration n'est possible que vers le chemin d'origine, si le fichier n'existe pas déjà.
- Un seul scan simultané ; maximum 64 cibles par scan.
- Le premier scan est lent car ClamAV charge toute la base en mémoire.

### Environnement

- EICAR bloqué par Defender (voir section 5).
- `freshclam` peut échouer si l'utilisateur configure un dossier système en écriture
  protégée ; le message d'erreur est affiché, aucune élévation n'est tentée.
- L'exécutable release et l'installeur NSIS (2,30 Mo) ont été générés ; l'exécutable
  release a été lancé avec succès avec les assets de production. L'installeur n'a pas
  été exécuté sur le poste de validation afin de ne pas créer de raccourcis ni
  d'entrée d'installation non demandés.

## 7. Feuille de route

| Phase | Contenu prévu | Statut |
| --- | --- | --- |
| 1 | Scanner manuel ClamAV, historique, quarantaine chiffrée | ✅ Livrée (expérimentale) |
| 2 | Pare-feu applicatif en observation, moniteur réseau | Non commencée |
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
```

## 9. Avertissement final

CBS Shield 0.1.0 est un projet **expérimental**. Il ne remplace pas Microsoft
Defender, qui doit rester actif. Il ne fournit aucune protection automatique et ne
doit pas être présenté comme un antivirus complet.
