# Sprint 4 — Audit de l'installeur et provisionnement ClamAV

Version : **0.4.0-dev** — 26 octobre 2026

## 1. Ce que contient l'installeur NSIS

Configuration vérifiée dans `src-tauri/tauri.conf.json` :

- cible : **NSIS x64**, mode `currentUser` (aucune élévation administrateur) ;
- application Tauri : `cbs-shield.exe` et ressources intégrées ;
- interface compilée dans le binaire (aucun serveur Vite, aucun Node.js) ;
- WebView2 : mode Tauri par défaut (`downloadBootstrapper`) ; le runtime
  Evergreen est déjà présent sur Windows 10/11 à jour, sinon le bootstrapper
  Microsoft est téléchargé au moment de l'installation ;
- icônes, licence Apache-2.0, métadonnées Cybrense.

### Ce que l'installeur ne contient pas

- **Aucun binaire ClamAV** : ni `clamscan.exe`, ni `freshclam.exe`, ni
  `sigtool.exe`.
- **Aucune base de signatures** (`main.cvd`, `daily.cvd`, `bytecode.cvd`).
- Aucun runtime Node.js, Rust, Vite ou compilateur.
- Aucun service Windows, pilote noyau ou tâche planifiée.

ClamAV est publié sous **GPLv2** par Cisco Talos. Pour éviter une
redistribution non maîtrisée, un alourdissement de l'installeur et des
obligations de mise à jour tierces, CBS Shield détecte l'installation officielle
et guide l'utilisateur. Il ne l'installe pas silencieusement et n'élève jamais
ses privilèges.

## 2. Dépendances d'exécution vérifiées

`dumpbin /dependents` sur le binaire de release (build MSVC) :

```
bcryptprimitives.dll  ntdll.dll  kernel32.dll  ole32.dll  oleaut32.dll
user32.dll  gdi32.dll  dwmapi.dll  imm32.dll  shell32.dll  combase.dll
comctl32.dll  shlwapi.dll  advapi32.dll  propsys.dll  bcrypt.dll
crypt32.dll  iphlpapi.dll  api-ms-win-crt-*.dll  api-ms-win-core-*.dll
```

- Toutes ces DLL sont des composants de Windows 10/11 ou de l'Universal C
  Runtime fourni par Windows.
- **Aucune dépendance à `vcruntime140.dll` / `msvcp140.dll`** n'apparaît : la
  redistribution Visual C++ n'est pas requise pour ce binaire.
- WebView2 Evergreen reste la seule dépendance externe runtime, gérée par
  l'installeur Tauri.
- ClamAV est une dépendance fonctionnelle **optionnelle mais nécessaire aux
  scans** : sans lui, l'application reste utilisable et affiche honnêtement un
  moteur indisponible.

## 3. Données créées au premier lancement

Sous `%LOCALAPPDATA%\Cybrense\CBS Shield\` :

| Élément | Rôle |
| --- | --- |
| `cbs-shield.db` | historique, préférences, observations, quarantaine (métadonnées) |
| `quarantine/` | coffre chiffré AES-256-GCM, clé protégée par DPAPI |
| `clamav/database/` | base utilisateur téléchargée par FreshClam (si utilisée) |
| `updates.log` | journal des tentatives de mise à jour |
| `freshclam.log` | sortie FreshClam |

Aucune écriture dans le dossier d'installation, aucun compte, aucune
télémétrie.

## 4. Provisionnement officiel recommandé

1. Vérifier la présence de `winget`.
2. Exécuter la commande officielle affichée dans **Mises à jour → ClamAV** :

   ```powershell
   winget install --id Cisco.ClamAV --exact --accept-package-agreements --accept-source-agreements
   ```

3. Lancer **Mises à jour → Mettre à jour les signatures** (FreshClam).
4. Vérifier l'inventaire : composants officiels, versions, intégrité, âge.
5. Si ClamAV est installé ailleurs, renseigner les chemins `clamscan.exe` et le
   dossier de signatures dans **Paramètres**.

L'application ne lance **pas** cette commande à la place de l'utilisateur et ne
demande pas d'élévation. La documentation officielle est ouverte via une URL
autorisée explicitement.

### Vérification de l'installation ClamAV

- `clamscan.exe`, `freshclam.exe` et `sigtool.exe` sont recherchés dans
  `C:\Program Files\ClamAV` et le `PATH`.
- L'état du moteur n'est affiché comme opérationnel que si les trois éléments
  nécessaires existent et si une base exploitable est trouvée.
- Une base absente, corrompue ou trop ancienne est signalée ; aucun statut
  « protégé » n'est inventé.

## 5. Résultat de l'audit installeur

| Point | Résultat |
| --- | --- |
| ClamAV embarqué | Non (choix documenté) |
| Signatures embarquées | Non |
| Node.js / Vite / Rust requis chez l'utilisateur | Non |
| WebView2 | Bootstrapper Tauri, runtime Windows |
| VC++ Redistributable | Non requis (dumpbin) |
| Élévation à l'installation | Non (`currentUser`) |
| Service / tâche planifiée | Aucun |
| Installation silencieuse de ClamAV | Aucune |
| Validation sur VM propre | **Non exécutée** (outillage VM indisponible) |

L'installeur final a été reconstruit avec `npm run build`. Son nom, sa taille et
son empreinte SHA-256 sont consignés dans
[SPRINT4_TEST_REPORT.md](SPRINT4_TEST_REPORT.md).
