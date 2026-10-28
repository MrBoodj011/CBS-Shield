# Sprint 7 — Audit de l'installeur

**Version :** `0.7.0-dev`
**Date :** 28 octobre 2026
**Artefact :** `CBS Shield_0.7.0-dev_x64-setup.exe`
**Statut :** construit, testé sur l'hôte et installé dans la VM Windows 11 —
**non signé**. Les scénarios antivirus et pare-feu désactivé restent partiels.

---

## 1. Identité de l'artefact

| Propriété | Valeur |
| --- | --- |
| Chemin | `target\release\bundle\nsis\CBS Shield_0.7.0-dev_x64-setup.exe` |
| Taille | **2 674 869 octets** (2,55 Mio) |
| SHA-256 | `F09AAA014DCEE3DE875B6A1016A9B077887563353D706DFAFD08F3196B6AD4AF` |
| Authenticode | **NotSigned** |
| Signataire | aucun |
| Date du fichier | 27 octobre 2026 |
| Format | NSIS, x64 |
| Mode d'installation | `currentUser` |
| Langues | Français, English |
| Dossier Démarrer | `Cybrense` |
| Identifiant | `com.cybrense.cbsshield` |

Le manifeste NSIS conserve `requestedExecutionLevel level="asInvoker"`. Aucune
élévation administrateur n'est demandée pour installer ou lancer CBS Shield.

### 1.1 Binaires

| Binaire | Taille | SHA-256 |
| --- | ---: | --- |
| `target\release\cbs-shield.exe` | 7 401 984 | `5E56D043EAE518E1A29C18E5BF982598E2AADFADD9607C752EC2604ED01C1D88` |
| `%LOCALAPPDATA%\CBS Shield\cbs-shield.exe` | 7 401 984 | `2E0920B4E2753FEB203E7051E64E10F1B520E96678B3FBE10E4FF2DE8A9B97C7` |

Le binaire installé diffère du binaire de `target\release` : le bundler NSIS
patche l'exécutable avec les métadonnées du bundle. Les deux hash sont donc
publiés séparément.

### 1.2 Contenu

- binaire Tauri/WebView2 ;
- `uninstall.exe` NSIS ;
- ressources d'interface compilées ;
- aucune base ClamAV, aucun binaire ClamAV, aucune signature ;
- aucun service Windows, aucun pilote noyau, aucune règle de pare-feu.

---

## 2. Tests sur l'hôte

| Scénario | Résultat |
| --- | --- |
| Installation silencieuse 0.6 (`/S`) | ✅ code 0 |
| Mise à niveau silencieuse 0.6 → 0.7 (`/S`) | ✅ code 0 |
| Entrée HKCU après mise à niveau | ✅ `DisplayVersion = 0.7.0-dev` |
| Lancement de l'application installée | ✅ fenêtre `CBS Shield - Cybrense` |
| Interface anglaise | ✅ capture `sprint7-dashboard-en.png` |
| Interface française persistée après Enregistrer | ✅ vérifiée sur l'hôte |
| Désinstallation silencieuse (`/S`) | ✅ code 0, binaires/registre supprimés |
| Conservation des données après désinstallation | ✅ `%LOCALAPPDATA%\Cybrense\CBS Shield` intact |
| Réinstallation après désinstallation | ✅ code 0, version `0.7.0-dev` |
| Pare-feu lu sans élévation | ✅ 3 profils, 657 règles observées |
| Export d'instantané | ✅ JSON + sidecar `.sha256` |
| Vérification d'empreinte | ✅ interface « Empreinte vérifiée » |
| Gate `backup_snapshot` | ✅ disponible après l'export |
| Autres gates de mutation | ✅ toujours non satisfaites |
| Mutation de règle exécutée | ❌ aucune |
| Pare-feu/Defender de l'hôte modifiés | ❌ aucun changement effectué par CBS Shield |

### 2.1 Captures

Les captures publiées de l'application installée sont dans
[`docs/screenshots/`](screenshots/) :

- `sprint7-firewall-en.png` / `sprint7-firewall-fr.png` : vue d'ensemble FR/EN ;
- `sprint7-firewall-rules-en.png` : règles et filtres locaux.

Elles ont été produites sur l'hôte, pas dans la VM. Elles ne constituent donc pas
une preuve d'installation propre. Les captures contenant des chemins utilisateur
ont été conservées localement dans `target/sprint7-vm/` et ne sont pas versionnées.

---

## 3. Validation VM Windows 11

La VM `CBS-Shield-Sprint7` a été créée avec :

- Windows 11 Enterprise Evaluation 26H2, ISO officielle vérifiée ;
- 6 Go de RAM, 4 vCPU, EFI, TPM 2.0 ;
- NAT, VRDE local `127.0.0.1:3390` ;
- audio, USB, presse-papiers et glisser-déposer désactivés ;
- aucun dossier hôte partagé.

Windows 11 Enterprise Evaluation 26H2 a démarré avec le build `26300`, en français,
sous le compte local non administrateur `cbs`. `winget` et ClamAV sont absents.

### 3.1 Résultats exécutés

| Scénario | Résultat |
| --- | --- |
| SHA-256 de l'installeur 0.7 dans la VM | ✅ `F09AAA014DCEE3DE875B6A1016A9B077887563353D706DFAFD08F3196B6AD4AF` |
| Installation silencieuse 0.6 | ✅ code 0, version `0.6.0-dev` |
| Mise à niveau silencieuse 0.6 → 0.7 | ✅ code 0 |
| Version après mise à niveau | ✅ `0.7.0-dev` |
| Binaire installé | ✅ 7 401 984 octets, SHA-256 `2E0920B4…B97C7` |
| Lancement de l'interface | ✅ fenêtre `CBS Shield - Cybrense` |
| Absence de ClamAV | ✅ message « ClamAV n'est pas détecté sur ce poste » |
| Redémarrage Windows | ✅ base SQLite et instantané conservés, application relancée |
| Instantané + sidecar | ✅ `firewall-snapshot-20261028T150021Z.json`, SHA-256 concordant |
| Pare-feu observé | ✅ 3/3 profils activés, 450 puis 476 règles, aucune mutation |
| Désinstallation silencieuse | ✅ code 0, application et registre supprimés |
| Données après désinstallation | ✅ dossier conservé, 4 fichiers |
| Réinstallation 0.7 | ✅ code 0, application relancée |
| Pare-feu désactivé dans la VM | ⏳ non exécuté (non-admin/UAC non automatisé) |
| ClamAV/FreshClam/scan/quarantaine | ⏳ bloqués par l'absence de `winget` et de moteur |

Le premier script VM a été lancé deux fois en parallèle, ce qui a dupliqué quelques
lignes de journal et provoqué une erreur de verrou. Les valeurs uniques, les hashes
et les captures restent cohérents ; ce doublon n'est pas traité comme deux essais.

Les preuves détaillées sont dans `target/sprint7-vm/vm-result*.txt` et les captures
locales. Elles contiennent des chemins utilisateur et ne sont pas versionnées.

---

## 4. Signature et distribution

- Aucun certificat Authenticode n'est disponible dans cet environnement.
- L'installeur est **NotSigned** ; SmartScreen peut afficher un avertissement.
- Le SHA-256 publié ci-dessus doit être vérifié avant exécution.
- Aucun artefact n'a été poussé vers un dépôt distant.
- Le hash doit être recalculé après tout nouveau build ; ne pas réutiliser
  `F09AAA...` pour un binaire reconstruit.

---

## 5. Conclusion

L'installeur 0.7.0-dev est construit, son hash est stable, et les parcours
d'installation, de mise à niveau, de redémarrage et de désinstallation fonctionnent
sur l'hôte et dans la VM Windows 11 isolée. Le pare-feu est resté actif et aucune
règle n'a été modifiée.

La validation reste incomplète pour le provisionnement ClamAV, les signatures, le
scan, la quarantaine/restauration et le pare-feu désactivé dans la VM. L'absence de
signature Authenticode interdit également de présenter l'artefact comme prêt pour la
production.
