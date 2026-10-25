# Architecture — CBS Shield Phase 1

CBS Shield est une application **Tauri 2** : un backend Rust natif expose des
commandes IPC à une interface React/TypeScript chargée dans WebView2. Toute la
logique sensible (processus ClamAV, SQLite, chiffrement) reste côté Rust.

## Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────────┐
│ WebView2 — ui/ (React 19 + TypeScript + Vite)                    │
│  App.tsx · Sidebar · six sections · Toasts · Modales             │
│  lib/api.ts ── invoke()/listen() ──┐                             │
└────────────────────────────────────┼─────────────────────────────┘
                                     │ IPC Tauri (commandes + événements)
┌────────────────────────────────────▼─────────────────────────────┐
│ src-tauri/ (shell Tauri, Rust)                                   │
│  commands/{engine,scans,vault,settings} · AppState · AppPaths    │
│         │                    │                  │                │
│         ▼                    ▼                  ▼                │
│   crates/cbs-core      crates/cbs-store   crates/cbs-quarantine  │
│   ClamAV, parsing      SQLite (WAL)       AES-256-GCM + DPAPI    │
└─────────┬────────────────────────────────────────────────────────┘
          │ processus enfant
          ▼
   clamscan.exe / freshclam.exe  (ClamAV externe, GPL-2.0)
```

## Crates Rust

### `crates/cbs-core` — moteur

Aucune dépendance à Tauri ni à SQLite ; réutilisable par un futur CLI.

- `engine.rs` — localise `clamscan.exe` / `freshclam.exe` (chemin configuré, PATH,
  `Program Files\ClamAV`, dossiers app-local), lance `--version`, lit la version
  moteur, la version de signatures et leur date, compte les fichiers `.cvd/.cld/.ndb`,
  calcule l'âge et l'état (`missing`, `outdated`, `upToDate`, `unknown`).
- `parser.rs` — parse la sortie `clamscan --stdout` :
  `path: SIGNATURE FOUND`, `path: OK`, `ERROR`, lignes de résumé
  (`Scanned files`, `Infected files`, `Known viruses`, `Data scanned`, `Time`).
- `scan.rs` — orchestration :
  - validation des cibles (`prepare_targets`), refus des chemins internes ;
  - construction de la commande : `--stdout`, `-r` optionnel, `--detect-pua=yes`
    optionnel, `--database=<dir>` optionnel, stdin fermé ;
  - lecture concurrente stdout/stderr, événements de progression limités à ~6,7 Hz ;
  - plafonds : 5 000 détections, 200 erreurs stockées, 64 Ko de stderr ;
  - annulation coopérative via `tokio::sync::Notify` → arrêt du processus ;
  - calcul SHA-256 et taille des fichiers détectés ;
  - rapport final avec `ScanOutcome` honnête (`clean`, `detected`, `cancelled`,
    `completedWithErrors`, `failed`).
- `fsutil.rs` — hachage, taille, helpers fichiers.
- `model.rs` — modèles sérialisés en `camelCase` pour l'IPC et SQLite.

### `crates/cbs-store` — persistance

SQLite embarqué (`rusqlite`, feature `bundled`), un seul `Connection` protégé par
un `Mutex`, mode WAL, clés étrangères activées.

Schéma v1 :

| Table | Rôle |
| --- | --- |
| `scans` | métadonnées du scan (cibles JSON, compteurs, résultat, versions, erreurs) |
| `detections` | détections par scan (chemin, signature, taille, SHA-256) |
| `quarantine` | métadonnées du coffre (statut `active/restored/deleted`, audit) |
| `settings` | paires clé/valeur locales |

Aucun blob chiffré n'est stocké en base : seul le chemin du fichier `.cbsq` l'est.
La base ne déplace ni ne supprime jamais un fichier utilisateur.

### `crates/cbs-quarantine` — coffre

- Un blob `<uuid>.cbsq` par élément.
- Chiffrement **AES-256-GCM** (crate `aes-gcm`) avec nonce aléatoire par fichier.
- L'identifiant de l'élément est utilisé comme **AAD**, ce qui lie le blob à son entrée.
- Clé de 32 octets générée par `getrandom`, stockée dans `quarantine.key`.
- Sur Windows, la clé est scellée/déscellée par **DPAPI** (`CryptProtectData` /
  `CryptUnprotectData`, portée utilisateur) via `windows-sys`.
- `store()` déplace le fichier source, `restore()` refuse d'écraser et vérifie le
  SHA-256 attendu, `purge()` supprime le blob.
- En cas d'échec de persistance SQLite, le shell Tauri restaure le fichier (rollback).

## Shell Tauri (`src-tauri`)

- `lib.rs` — plugin dialog, initialisation des chemins, ouverture SQLite et du coffre,
  enregistrement des commandes, `generate_context!`.
- `paths.rs` — racine de données `%LOCALAPPDATA%\Cybrense\CBS Shield`, surcharge
  `CBS_SHIELD_DATA_DIR`, chemins de la base, du coffre et de ClamAV.
- `state.rs` — état partagé ; **un seul scan simultané** via un slot + `ScanLease`
  (libération garantie par `Drop`), annulation par `Notify`.
- `commands/engine.rs` — diagnostic, `app_info`, `freshclam` avec journal diffusé,
  timeout 30 min, aucune élévation, conseils en cas d'erreur de permission.
- `commands/scans.rs` — démarrage/annulation des scans, historique, statistiques.
- `commands/vault.rs` — validation des chemins, confirmations obligatoires,
  vérification SHA-256, rollback, restauration/suppression.
- `commands/settings.rs` — lecture/écriture validée des réglages, ouverture du dossier.
- `error.rs` — `CommandError { code, message }` sérialisé pour le frontend.

## Contrat IPC

Commandes (`invoke`) :

| Commande | Paramètres | Retour |
| --- | --- | --- |
| `app_info` | — | `AppInfo` |
| `engine_status` | — | `EngineStatus` |
| `update_signatures` | `confirm` | `SignatureUpdateResult` |
| `start_scan` | `paths`, `recursive`, `includePua` | `ScanResultPayload` |
| `cancel_scan` | — | `boolean` |
| `list_scans` | `limit?` | `ScanRecord[]` |
| `get_scan_details` | `scanId` | `ScanDetails \| null` |
| `dashboard_stats` | — | `DashboardStats` |
| `quarantine_file` | `path`, `threatName`, `sha256`, `confirm` | `QuarantineRecord` |
| `list_quarantine` | — | `QuarantineRecord[]` |
| `restore_quarantine` | `id`, `confirm` | `string` (destination) |
| `delete_quarantine` | `id`, `confirm`, `phrase` | — |
| `get_settings` | — | `SettingsView` |
| `update_settings` | `patch` | `SettingsView` |
| `open_data_dir` | — | — |

Événements (`listen`) :

- `scan:event` → `started`, `progress`, `detection`, `scanError`, `finished`.
- `signatures:update` → `{ line, stream }` (journal `freshclam`).

Toutes les structures Rust portent `#[serde(rename_all = "camelCase")]` ;
`ui/src/types.ts` est la source de vérité TypeScript correspondante.

## Flux d'un scan

1. L'utilisateur sélectionne des cibles (plugin dialog) et lance le scan.
2. `start_scan` vérifie le moteur et les signatures, réserve le slot unique.
3. `Scanner` prépare et valide les cibles, lance `clamscan`.
4. Les lignes stdout/stderr sont parsées et émises en événements ; la progression
   est agrégée pour éviter de saturer le WebView.
5. Le processus se termine ou est annulé ; un `ScanReport` est construit.
6. Le rapport est enregistré dans SQLite (échec non bloquant, remonté à l'UI).
7. L'interface affiche le rapport, les détections et propose la quarantaine.

## Flux de quarantaine

1. L'UI ouvre une modale de confirmation (case à cocher obligatoire).
2. `quarantine_file` canonicalise le chemin, refuse les dossiers, le coffre et les
   données internes, puis chiffre et déplace le fichier.
3. Si un SHA-256 attendu diffère, le fichier est remis en place et l'action échoue.
4. Les métadonnées sont insérées ; en cas d'échec, rollback vers l'emplacement d'origine.
5. La restauration vérifie le statut `active`, refuse l'écrasement, contrôle le hash.
6. La suppression exige `confirm=true` **et** `phrase="SUPPRIMER"`.

## Décisions de conception

- **Pas de redistribution de ClamAV** : binaire externe, licence GPL-2.0 respectée.
- **Base de signatures par utilisateur** : évite toute élévation de privilèges.
- **Un seul scan à la fois** : annulation simple, charge CPU prévisible.
- **Rapports en SQLite plutôt qu'en JSON** : requêtes de tableau de bord et audit.
- **Chiffrement + DPAPI** : un autre compte Windows ne peut pas lire le coffre.
- **Frontend sans accès disque direct** : tout passe par des commandes validées.
- **Modules non implémentés explicites** : aucune UI factice, badge « Non disponible ».
- **Pas de persistance du fichier courant** : minimise les données sensibles en base.

## Frontend

- `App.tsx` — état global (moteur, réglages, stats, scans, quarantaine, thème),
  navigation, rafraîchissement, bannière si l'IPC natif est indisponible.
- `sections/` — Dashboard, Antivirus, Firewall, NetworkMonitor, Quarantine, Settings.
- `components/` — Sidebar, TopBar, Badge, Modal, ConfirmDialog, Toasts, EmptyState,
  UnavailablePanel, Logo.
- `lib/api.ts` — appels typés et normalisation des erreurs.
- `lib/format.ts` — formats français (nombres, tailles, durées, dates).
- `styles.css` — thème sombre/clair, responsive jusqu'à 1080 px et en dessous.

## Tests

- `cargo test --workspace` : unités core (parsing, moteur, fsutil), store (SQLite),
  quarantaine (chiffrement, restore, purge, anti-écrasement) et intégration ClamAV.
- `npm --prefix ui run build` : vérification TypeScript stricte + build Vite.
- `npm --prefix ui test` : helpers de format et composant `UnavailablePanel`.
- Les tests d'intégration réels sont ignorés si ClamAV/signatures sont absents.

## Évolutions prévues (hors Phase 1)

- Phase 2 : pare-feu applicatif (WFP) en mode observation, moniteur réseau.
- Phase 3 : YARA-X, planification, protection temps réel — nécessiterait un service
  privilégié et une revue de sécurité dédiée.
