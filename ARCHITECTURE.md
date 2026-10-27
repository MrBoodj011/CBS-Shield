# Architecture - CBS Shield 0.7.0-dev

CBS Shield est une application **Tauri 2** : un backend Rust natif expose des
commandes IPC à une interface React/TypeScript chargée dans WebView2. Toute la
logique sensible (processus ClamAV, SQLite, chiffrement) reste côté Rust.

## Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────────┐
│ WebView2 — ui/ (React 19 + TypeScript + Vite)                    │
│  App.tsx · Sidebar · 9 sections · SetupWizard · Toasts · Modales │
│  lib/api.ts ── invoke()/listen() ──┐                             │
└────────────────────────────────────┼─────────────────────────────┘
                                     │ IPC Tauri (commandes + événements)
┌────────────────────────────────────▼─────────────────────────────┐
│ src-tauri/ (shell Tauri, Rust)                                   │
│  commands/{engine,scans,vault,settings,signatures,netmon,         │
│            firewall} · AppState · AppPaths                       │
│         │              │              │              │           │
│         ▼              ▼              ▼              ▼           │
│  cbs-core        cbs-store       cbs-quarantine   cbs-netmon     │
│  ClamAV/parse    SQLite (WAL)    AES-GCM/DPAPI    TCP/UDP        │
│                                                       │          │
│                                                  cbs-firewall    │
│                                                  lecture seule   │
└─────────┬────────────────────────────────────────────────────────┘
          │ processus enfant
          ▼
   clamscan.exe / freshclam.exe / winget  (externes)
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

Schéma v2 :

| Table | Rôle |
| --- | --- |
| `scans` | métadonnées du scan (cibles JSON, compteurs, résultat, versions, erreurs) |
| `detections` | détections par scan (chemin, signature, taille, SHA-256) |
| `quarantine` | métadonnées du coffre (statut `active/restored/deleted`, audit) |
| `settings` | paires clé/valeur locales, dont la baseline pare-feu et `onboardingCompleted` |
| `netmon_snapshots` | historique borné des captures réseau (2 000 lignes) |

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

### `crates/cbs-netmon` — observation réseau

- TCP via `GetExtendedTcpTable`, UDP via `GetExtendedUdpTable` ; aucun socket
  ouvert, aucune capture de contenu.
- Association PID → nom et **chemin d'image** (`QueryFullProcessImageNameW`).
- Volumes par interface via `GetIfTable2`, avec exclusion des sous-couches de
  filtres NDIS pour éviter les doubles comptages.

### `crates/cbs-firewall` — observation du pare-feu

- Lecture des profils et règles via `INetFwPolicy2` / `windows-firewall`.
- Empreintes SHA-256 des profils et des règles, hash composite.
- Alertes dérivées de l'état réel, sans remédiation.
- **Aucun appel `put_*`**, aucune mutation, aucun pilote. Voir
  [`FIREWALL_ARCHITECTURE.md`](FIREWALL_ARCHITECTURE.md).

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
- `commands/signatures.rs` — inventaire `sigtool`, journal de mise à jour,
  provisioning, installation officielle de ClamAV avec autorisation explicite.
- `commands/netmon.rs` — capture temps réel et historique réseau.
- `commands/firewall.rs` — observation, alertes, baseline, changements, mapping,
  export JSON, gates de gestion verrouillés.
- `error.rs` — `CommandError { code, message }` sérialisé pour le frontend.

## Contrat IPC

Commandes (`invoke`) :

| Commande | Paramètres | Retour |
| --- | --- | --- |
| `app_info` | — | `AppInfo` |
| `engine_status` | — | `EngineStatus` |
| `update_signatures` | `confirm` | `SignatureUpdateResult` |
| `start_scan` | `paths`, `recursive`, `includePua`, `profile?`, `limits?`, `followSymlinks?` | `ScanResultPayload` |
| `cancel_scan` | — | `boolean` |
| `list_scans` | `limit?` | `ScanRecord[]` |
| `get_scan_details` | `scanId` | `ScanDetails \| null` |
| `dashboard_stats` | — | `DashboardStats` |
| `resolve_scan_targets` | `profile` | `ResolvedTargetsPayload` |
| `export_scan_report` | `scanId`, `format`, `path` | `ExportResult` |
| `quarantine_file` | `path`, `threatName`, `sha256`, `confirm` | `QuarantineRecord` |
| `list_quarantine` | — | `QuarantineRecord[]` |
| `restore_quarantine` | `id`, `confirm` | `string` (destination) |
| `delete_quarantine` | `id`, `confirm`, `phrase` | — |
| `signature_inventory` | — | `SignatureInventory` |
| `update_logs` | — | `UpdateLogs` |
| `provisioning_status` | — | `ProvisioningStatus` |
| `install_clamav` | `confirm` | `ClamavInstallResult` |
| `open_documentation` | `url` (allowlist) | — |
| `netmon_snapshot` | — | `NetmonSnapshotPayload` |
| `netmon_history` | `limit` | `NetmonSnapshotRecord[]` |
| `firewall_status` | — | `FirewallObservation` |
| `firewall_acknowledge_baseline` | — | `FirewallObservation` |
| `firewall_connections` | — | `FirewallConnectionsPayload` |
| `firewall_export_snapshot` | — | `SnapshotExportResult` (chemin, SHA-256, lecture seule) |
| `firewall_management_status` | — | gates verrouillés + plan de récupération |
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
- **Pare-feu sans mutation** : seules les lectures `INetFwPolicy2` sont exposées ;
  les gates de gestion restent fermés.
- **ClamAV externe** : installation officielle guidée avec autorisation, jamais
  silencieuse, jamais embarquée.
- **Assistant non bloquant** : l'application reste utilisable si ClamAV manque ;
  l'état est honnêtement marqué « incomplet ».

## Frontend

- `App.tsx` — état global (moteur, réglages, stats, scans, quarantaine, thème),
  navigation, rafraîchissement, assistant automatique au premier lancement,
  bannière si l'IPC natif est indisponible.
- `components/SetupWizard.tsx` — assistant 5 étapes, FR/EN, autorisation ClamAV.
- `sections/` — Dashboard, Antivirus, Firewall, NetworkMonitor, Quarantine, History,
  Updates, Settings, About (9 sections).
- `components/` — Sidebar, TopBar, Badge, Modal, ConfirmDialog, Toasts, EmptyState,
  UnavailablePanel, Logo, SetupWizard.
- `lib/api.ts` — appels typés et normalisation des erreurs.
- `lib/i18n.tsx` — dictionnaires FR/EN typés et synchronisation de `<html lang>`.
- `lib/format.ts` — formats localisés (nombres, tailles, durées, dates).
- `styles.css` / `theme.css` — thème sombre/clair, responsive jusqu'à 1080 px.

## Tests

- `cargo test --workspace` : **92 réussis, 1 ignoré** — core, store, quarantaine,
  réseau, pare-feu, commandes Tauri, intégration ClamAV.
- `npm run ui:test` : **23 tests / 8 fichiers**.
- `npm run ui:build` : TypeScript strict + build Vite.
- `cargo fmt --all -- --check` et `cargo clippy --workspace --all-targets -- -D warnings`.
- Les tests d'intégration réels sont ignorés si ClamAV/signatures sont absents.

## Évolutions prévues

- Phase 2 : observation réseau et pare-feu — livrée.
- Phase 3 : design system, dashboard réel, FR/EN, tray — livrée.
- Phase 4 : antivirus avancé, profils, FreshClam, installeur — livrée.
- Phase 5 : assistant de premier lancement, pare-feu enrichi en lecture seule,
  installeur 0.5 — code livré, validation VM bloquée.
- Gestion active des règles de pare-feu : **non engagée** ; exige autorisation,
  VM isolée, restauration validée et revue de sécurité.
- YARA-X, planification, protection temps réel : non commencées ; nécessiteraient
  un service privilégié et une revue dédiée.
