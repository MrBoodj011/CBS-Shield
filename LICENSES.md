# Licences — CBS Shield

CBS Shield est distribué sous **Apache License 2.0**. Le texte complet se trouve dans
[LICENSE](LICENSE).

Copyright © 2026 **Cybrense**.

## Code du projet

| Composant | Licence |
| --- | --- |
| CBS Shield (crates Rust, shell Tauri, interface React, scripts) | Apache-2.0 |
| Logo et icônes CBS Shield (`assets/icon.svg`, `src-tauri/icons/`) | Apache-2.0 (marques Cybrense) |

« CBS Shield » et « Cybrense » sont des marques de Cybrense. La licence Apache-2.0
n'accorde aucun droit sur ces marques au-delà de l'usage raisonnable pour décrire
l'origine du logiciel.

## Composant externe principal

| Composant | Version testée | Licence | Distribution |
| --- | --- | --- | --- |
| ClamAV (`clamscan`, `freshclam`, signatures) | 1.5.4 | GPL-2.0 (avec exception de liaison OpenSSL) | **Non redistribué** : installé séparément par l'utilisateur |

CBS Shield invoque ClamAV comme **processus externe** via son interface en ligne de
commande. Aucun code ClamAV n'est lié statiquement ni inclus dans l'installeur. Le
texte de la licence ClamAV est fourni avec l'installation officielle de ClamAV et sur
<https://www.clamav.net/license>.

Les signatures téléchargées par `freshclam` sont fournies par le projet ClamAV selon
les conditions de ce projet.

## Interface et outillage frontend

| Dépendance | Licence |
| --- | --- |
| React, React DOM | MIT |
| `@tauri-apps/api`, `@tauri-apps/plugin-dialog` | MIT OR Apache-2.0 |
| Lucide (`lucide-react`) | ISC |
| Vite, `@vitejs/plugin-react`, Vitest | MIT |
| TypeScript | Apache-2.0 |
| jsdom | MIT |
| `@testing-library/react`, `@testing-library/jest-dom` | MIT |
| `@tauri-apps/cli` (outil de build) | MIT OR Apache-2.0 |

## Dépendances Rust

| Dépendance | Licence |
| --- | --- |
| Tauri, `tauri-build`, `tauri-plugin-dialog` | MIT OR Apache-2.0 |
| Serde, `serde_json` | MIT OR Apache-2.0 |
| `thiserror` | MIT OR Apache-2.0 |
| `chrono` | MIT OR Apache-2.0 |
| `sha2` | MIT OR Apache-2.0 |
| `uuid` | Apache-2.0 OR MIT |
| `tokio` | MIT |
| `rusqlite` | MIT |
| `tempfile` (tests) | MIT OR Apache-2.0 |
| `aes-gcm` | Apache-2.0 OR MIT |
| `getrandom` | MIT OR Apache-2.0 |
| `windows-sys` | MIT OR Apache-2.0 |

Les dépendances transitives conservent leurs licences respectives ; la liste complète
peut être régénérée avec `cargo metadata` / `cargo deny` ou `cargo license`.

## Composants système

| Composant | Licence / statut | Distribution |
| --- | --- | --- |
| Microsoft Edge WebView2 Runtime | Composant Microsoft propriétaire | Fourni par Windows / Microsoft, non redistribué par CBS Shield |
| SQLite (via la feature `bundled` de rusqlite) | Domaine public | Compilé dans le binaire |
| API Windows (via `windows-sys`) | MIT OR Apache-2.0 (bindings) | — |

## Notes de conformité

- Aucun binaire ClamAV ni base de signatures n'est inclus dans le dépôt ou l'installeur.
- L'installeur NSIS ne contient que CBS Shield et ses dépendances autorisées.
- Les scripts `scripts/setup-clamav-signatures.ps1` et
  `scripts/eicar-manual-test.ps1` téléchargent/exécutent des composants externes à la
  demande de l'utilisateur ; ils ne les redistribuent pas.
- Avant toute distribution commerciale, vérifier à nouveau les licences des versions
  exactes verrouillées dans `Cargo.lock` et `ui/package-lock.json`.

## Marques

ClamAV et Cisco sont des marques de Cisco Systems, Inc. ou de ses affiliés. CBS Shield
n'est ni affilié, ni approuvé, ni sponsorisé par Cisco ou le projet ClamAV.
Microsoft, Windows et Defender sont des marques de Microsoft Corporation.
