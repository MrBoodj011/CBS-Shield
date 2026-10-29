# Sprint 8 — Audit de l'installeur

**Version :** `0.8.0-dev`
**Date de vérification :** 30 octobre 2026
**Artefact :** `CBS Shield_0.8.0-dev_x64-setup.exe`
**Statut :** final rebuild rebuilt at 12:51, installer hash recorded. **Not re-installed in the VM**; the earlier `0.8.0-dev` VM install is historical evidence only.

## 1. Identité de l'artefact

| Propriété | Valeur |
| --- | --- |
| Chemin | `target\release\bundle\nsis\CBS Shield_0.8.0-dev_x64-setup.exe` |
| Taille | **2 773 391 octets** (2,64 Mio) |
| SHA-256 | `9F0377C511AE1EAC8EE408120F17154756EB26E09889783D0FE1A0882131796E` |
| Authenticode | **NotSigned** |
| Signataire | aucun |
| Date du fichier | 30 octobre 2026 |
| Format | NSIS, x64 |
| Mode d'installation | `currentUser` |
| Langues | Français, English |
| Dossier Démarrer | `Cybrense` |
| Identifiant | `com.cybrense.cbsshield` |

Le manifeste NSIS conserve `requestedExecutionLevel level="asInvoker"`. Aucune élévation administrateur n'est demandée pour installer ou lancer CBS Shield.

## 1.1 Binaires

| Binaire | Taille | SHA-256 |
| --- | ---: | --- |
| `target\release\cbs-shield.exe` | 7 680 000 | `BAF8CAB6B539DCD114532B906FF3BC420E5C93940D6293FAF1F71A41096CAEFC` |

## 2. Ce que l'installeur embarque / n'embarque pas

- **Ne distribue pas** ClamAV, FreshClam ou ces bases de signatures ; le moteur reste une dépendance externe téléchargée/installée par l'utilisateur.
- **Embarque** l'application Tauri compressée, la UI compilée et l'icône.
- **Ne contient pas** de puzzle de détection, de chromedriver, de service de télémétrie ou de driver noyau.
- **Ne contient pas** de malware réel ou d'EICAR rédactionnel.

## 3. État d'exécution

Les tests d'installeur du Sprint 7 (install/uninstall, uninstall conservant les données, lancement headless) ont été exécutés historiquement, mais pour le Sprint 8 **l'installeur final n'a pas été réinstallé dans la VM**, et l'hôte n'a pas servi de cible d'installation permanente. L'application release `0.8.0-dev` a néanmoins été exécutée directement pour la validation Web Guard.

## 4. Risques résiduels

- **Installation VM non rerun** : le comportement NSIS du build final n'est donc pas confirmé par une installation réelle dans la VM.
- **Signature Authenticode absente** ; le paquet reste non signé.
- **Pas de support Windows 32 bits** ; l'installeur est x64 uniquement.

## 5. Recommandation

Considérer l'installeur comme **construit mais non certifié** tant qu'une validation VM isolée du cycle complet n'aura pas été relancée.
