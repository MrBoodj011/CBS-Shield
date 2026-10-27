# Sprint 6 — Audit de l'installeur

**Version :** `0.6.0-dev`
**Date :** 27 octobre 2026
**Artefact :** `CBS Shield_0.6.0-dev_x64-setup.exe`
**Statut :** ✅ construit et testé sur l'hôte — ⛔ non signé, VM propre non exécutée.

---

## 1. Identité de l'artefact

| Propriété | Valeur |
| --- | --- |
| Chemin | `target\release\bundle\nsis\CBS Shield_0.6.0-dev_x64-setup.exe` |
| Taille | **2 658 926 octets** (2,54 Mio) |
| SHA-256 | `650A35AA5A6D59AAB1223D2B41644E5703936C1AE711462227B25112E8784BB8` |
| Authenticode | **NotSigned** |
| Signataire | aucun |
| Date du fichier | 27 octobre 2026 |
| Format | NSIS, x64 |
| Mode d'installation | `currentUser` |
| Langues | Français, English |
| Dossier Démarrer | `Cybrense` |
| Identifiant | `com.cybrense.cbsshield` |

Le manifeste embarqué de l'installeur déclare `requestedExecutionLevel level="asInvoker"`.
Aucune demande d'élévation n'a été observée pendant l'installation ou le lancement de
CBS Shield.

### 1.1 Binaires

| Binaire | Taille | SHA-256 |
| --- | ---: | --- |
| `target\release\cbs-shield.exe` (avant bundling) | 7 361 024 | `A3E9087EC72082C9795BD9ABFFC12363DEEDCE40269FFC1C7405794C72D7490B` |
| `%LOCALAPPDATA%\CBS Shield\cbs-shield.exe` (installé, patché NSIS) | 7 361 024 | `FC44D467DD0D185320B760F6F5D429F6D4D69EC41C2B05C95759786C1FF6F737` |

Le bundler NSIS ajoute des informations de bundle au binaire ; les deux hashes ne
doivent donc pas être confondus.

---

## 2. Configuration Tauri/NSIS

Extrait de `src-tauri/tauri.conf.json` :

- `productName` : `CBS Shield` ;
- `version` : `0.6.0-dev` ;
- `publisher` : `Cybrense` ;
- `targets` : `["nsis"]` ;
- `windows.nsis.installMode` : `currentUser` ;
- `displayLanguageSelector` : `true` ;
- `languages` : `["French", "English"]` ;
- `startMenuFolder` : `Cybrense` ;
- `licenseFile` : `../LICENSE` ;
- aucune signature Authenticode configurée.

Versions alignées :

| Fichier | Version |
| --- | --- |
| `Cargo.toml` / `Cargo.lock` | `0.6.0-dev` |
| `src-tauri/Cargo.toml` / `Cargo.lock` | `0.6.0-dev` |
| `package.json` | `0.6.0-dev` |
| `ui/package.json` / lock | `0.6.0-dev` |
| `src-tauri/tauri.conf.json` | `0.6.0-dev` |
| Interface (fallbacks) | `0.6.0-dev` |

---

## 3. Contenu observé après installation

Après installation silencieuse, le dossier `%LOCALAPPDATA%\CBS Shield` contenait :

- `cbs-shield.exe` ;
- `uninstall.exe`.

Aucun service Windows CBS Shield, aucune tâche planifiée et aucune règle de pare-feu
CBS Shield n'ont été observés. ClamAV et les signatures ne sont pas inclus dans
l'installeur ; ils restent dans `%LOCALAPPDATA%\Cybrense\CBS Shield\clamav` ou dans
l'installation officielle `C:\Program Files\ClamAV`.

La base, le WAL, la clé de quarantaine, les signatures et les snapshots sont hors du
dossier d'installation et ont survécu à la désinstallation.

---

## 4. Résultats d'installation

| Test | Résultat |
| --- | --- |
| Installation silencieuse depuis l'état désinstallé | ✅ code 0 |
| Réinstallation sur la même version | ✅ code 0 |
| Version enregistrée | ✅ `0.6.0-dev` |
| Raccourci Démarrer | ✅ créé |
| Lancement du binaire installé | ✅ interface WebView2 |
| Désinstallation silencieuse | ✅ code 0 |
| Dossier d'application supprimé | ✅ |
| Raccourci supprimé | ✅ |
| Entrée HKCU supprimée | ✅ |
| Données utilisateur conservées | ✅ |

---

## 5. Signature et réputation

L'installeur n'est **pas signé**. `Get-AuthenticodeSignature` retourne `NotSigned`.
Conséquences :

- SmartScreen peut afficher un avertissement sur une machine sans réputation ;
- l'identité de l'éditeur n'est pas garantie par Windows ;
- le SHA-256 publié est le seul contrôle d'intégrité fourni.

Le hash doit être vérifié avant exécution :

```powershell
Get-FileHash -Algorithm SHA256 `
  'target\release\bundle\nsis\CBS Shield_0.6.0-dev_x64-setup.exe'
```

Résultat attendu :
`650A35AA5A6D59AAB1223D2B41644E5703936C1AE711462227B25112E8784BB8`.

---

## 6. Limites de l'audit

- Aucune VM Windows propre : le comportement sur machine neuve n'est pas vérifié.
- Le sélecteur de langue graphique NSIS n'a pas été exercé ; installation en `/S`.
- Les scénarios d'échec (WebView2 absent, disque plein, réseau coupé, UAC refusé,
  interruption) ne sont pas exécutés.
- Aucune mise à niveau inter-versions 0.5 → 0.6.
- Aucun certificat de signature disponible.
- Le contenu interne de l'archive NSIS n'a pas été extrait avec un outil dédié ;
  le contenu a été observé après installation.

---

## 7. Verdict

L'installeur final est **reproductible et fonctionnel sur l'hôte**, avec un hash
publié et une séparation correcte des données. Il n'est **pas production-ready** :
signature absente, VM propre et matrice d'échec non exécutées.
