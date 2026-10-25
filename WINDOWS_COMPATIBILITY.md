# Compatibilité Windows — CBS Shield 0.2.0-dev

**Date :** 25 octobre 2026 — validation sur Windows 11 Home build 26200 (x64),
Rust 1.99.1 MSVC, WebView2 Runtime 155, Node 24.

Ce document recense les API Windows utilisées, les contraintes de compatibilité
connues et les pièges concrets rencontrés (et testés) pendant les sprints.

---

## 1. API Windows utilisées (surface système complète)

| Besoin | API | Crate/type d'accès | Droits requis |
| --- | --- | --- | --- |
| Découverte du moteur | Lecture de fichiers sous `%LOCALAPPDATA%`, GAC, `/Program Files` | `std::fs` | aucun |
| Scan antivirus | processus `clamscan.exe` | `std::process::Command` (+ `CREATE_NO_WINDOW 0x08000000`) | aucun |
| Version moteur / signatures | `clamscan --database=… --version` sous timeout | même | aucun |
| Mise à jour signatures | processus `freshclam.exe` | même | aucun |
| Quarantaine chiffrée | **DPAPI** `CryptProtectData/CryptUnprotectData` | `windows-sys` | utilisateur courant |
| Stockage local | SQLite embarqué (`user_version`, migrations) | `rusqlite` (bundled) | aucun |
| Moniteur réseau (Phase 2) | **`GetExtendedTcpTable` / `GetExtendedUdpTable`** (tables owner-PID, IPv4+IPv6) | `windows-sys` 0.61 | aucun (mêmes droits que le processus destinataire) |
| Trafic d'interface | **`GetIfTable2` / `FreeMibTable`** (`MIB_IF_TABLE2`, octets RX/TX cumulés) | `windows-sys` 0.61 | aucun |
| Nom de processus | **`OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `QueryFullProcessImageNameW`** | `windows-sys` 0.61 | aucun pour systèmes protégés (retour `None` honnête) |
| Pare-feu (Phase 2) | **`INetFwPolicy2`** COM (`FwIsFirewallEnabled`, profils, défauts, énumération règles, `CurrentProfileTypes`) | `windows-firewall 0.8` + `windows 0.62` direct | **aucune élévation** (lecture) |

**Surface d'écriture système : aucune.** La Phase 2 ne comporte ni pilote, ni
service, ni hook, ni filtre WFP, ni modification de Defender. Les seules écritures
sont l'espace de données de l'application et les commandes de processus ClamAV
décrites ci-dessus.

## 2. Pièges Windows concrets (vérifiés par test)

### 2.1 Chemins verbatim `\\?\`

`std::fs::canonicalize()` renvoie des chemins uniques **avec préfixe `\\?\`** sous
Windows. Tout `starts_with` contre un chemin non-préfixé échoue silencieusement.
CBS Shield normalise désormais `\\?\` systématiquement (`normalized_path`) et
compare par composants (`is_inside`), casse-indépendant. (Audit A-1.)

### 2.2 Verrou d'un fichier avec `OpenOptionsExt::share_mode(0)`

Pour produire un fichier réellement verrouillé (tests : fichier illisible) :
`OpenOptions::new().read(true).share_mode(0)` donne un handle exclusif ; ClamAV
renvoie alors l'erreur win32 32 (partage) sur stderr. **Ne pas tenter `write_all`**
sur ce handle en lecture : `PermissionDenied` immédiat.

### 2.3 UTF-8 / console

Les sons de stderr de `clamscan` sont lus en octets et décodés `from_utf8_lossy` :
aucun plantage sur des noms de fichiers non-UTF-8 ; les lignes invalides sont
conservées tronquées dans les erreurs du rapport.

### 2.4 COM et appartements

- Les threads bloquants tokio sont **réutilisés** : un `CoInitializeEx` STA
  (`APARTMENTTHREADED`) y échoue en silence ou échoue aux appels `get_*` si la
  couche précédente a initialisé MTA. CBS Shield utilise désormais **MTA**
  (`COINIT_MULTITHREADED`) pour ses lectures COM de pare-feu, aligné sur le crate
  `windows-firewall`.
- `CoInitializeEx` peut échouer pour une raison tierce : CBS Shield ne fait jamais
  de `CoUninitialize` pour une initialisation qu'il ne possède pas.

### 2.5 Constantes msdn prudentes

Les constantes `NET_FW_PROFILE_TYPE2` sont figées (domaine 0x1, privé 0x2,
public 0x4, masque `& 0x7FFF`) ; une constante erronée (0x3 au lieu de 0x4,
corrigé audit A-8) provoque un échec COM **silencieux** du lot entier de détails.

### 2.6 Tables IP Helper

`GetExtendedTcpTable`/`GetExtendedUdpTable` exigent un buffer aligné 8 octets et
un double appel (taille via `ERROR_INSUFFICIENT_BUFFER`). Limites `cbs-netmon` :
20 000 lignes et 128 Mo par table, au-delà → erreur explicite, pas d'OOM.
`FreeMibTable` prend `*mut c_void` casté. Le PID 4 est mappé « System ».

### 2.7 WebView2 / développement

Pour tester la fenêtre Tauri via CDP (développement seulement) : la variable
d'environnement `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
doit être définie **dans la session qui lance** le binaire debug
(une session PowerShell `Start-Process` l'hérite ; les invocations séparées ne
l'héritent pas). React exige le générateur natif
(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'checked').set`)
avant `click` pour cocher une case contrôlée depuis CDP.

## 3. Matrice de compatibilité

| Composant | Windows 10 21H2+ | Windows 11 | Notes |
| --- | --- | --- | --- |
| Scan ClamAV manuel | ✅ | ✅ | ClamAV 1.5.4 (chef de file `Cisco.ClamAV` winget) |
| Quarantaine DPAPI | ✅ | ✅ | DPAPI utilisateur présent depuis XP |
| Moniteur réseau | ✅ | ✅ | IP Helper présent depuis Vista |
| Pare-feu lecture | ✅ | ✅ | `INetFwPolicy2` présent depuis Win7 |
| Installeur NSIS | ✅ | ✅ | `npm run build` (tauri build) |

Rust `rust-version = "1.85"` ; MSVC obligatoire (le GNU toolchain ne fournit pas
les import libs `windows-sys` utilisées).

## 4. Non supporté / non applicable

- **Aucun pilote noyau, aucun service Windows, aucun hook user-mode.** Les tentatives
  de filtre réseau (WFP, Portmaster) sont hors périmètre Phase 2 et documentées dans
  `FIREWALL_ARCHITECTURE.md`.
- Aucune modification de Microsoft Defender (état, exclusions, règles) — jamais.
- Les comptes sans profil utilisateur valide (sessions temporaires) ne sont pas
  certifiés : DPAPI dépend du profil.

## 5. Reproduire les vérifications de compatibilité

```powershell
cargo test --workspace        # 60 réussis, 1 ignoré (EICAR manuel)
npm run ui:test               # 10 tests
npm run ui:build              # tsc strict + vite
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check

# Vérification croisée pare-feu (à comparer avec la section Profils de l'app)
Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction
```
