# Sprint 6 — Installation et cycle de vie

**Version :** `0.6.0-dev`
**Date :** 27 octobre 2026
**Statut global :** ⛔ **validation VM Windows propre non exécutée**
**Test hôte :** ✅ installation, réinstallation, lancement et désinstallation réels —
mais **non équivalent** à une machine propre.

Ce document sépare :

1. la recette **VM Windows 11 propre**, bloquée ;
2. le test **hôte** réellement exécuté ;
3. les scénarios d'échec, non exécutés.

---

## 1. Recette VM Windows 11 propre — non exécutée

### 1.1 Pourquoi elle est bloquée

L'hôte est **Windows 11 Home build 26200**. Windows Sandbox et la gestion Hyper-V
ne sont pas disponibles dans cette configuration sans modification de
l'environnement de virtualisation de l'hôte. Aucune autorisation n'a été donnée pour
activer une fonctionnalité, modifier Hyper-V, ou créer/cloner une VM. Aucune VM
Windows propre n'était provisionnée.

Conséquence : les éléments suivants ne sont **pas vérifiés** :

- absence de WebView2, de ClamAV, de Visual Studio, de Rust et de Node.js ;
- profil Windows réellement neuf, sans données CBS Shield antérieures ;
- comportement SmartScreen sur un binaire non signé et sans réputation ;
- refus/acceptation UAC dans un contexte neuf ;
- réseau coupé, disque plein, WebView2 absent ;
- installation réelle de ClamAV en absence de moteur ;
- mise à niveau 0.5 → 0.6 et rétrogradation ;
- stratégies d'entreprise, contrôle d'application, antivirus tiers.

### 1.2 Recette à exécuter plus tard

1. Snapshot VM Windows 11 x64 vierge, sans outils de développement.
2. Vérifier l'absence de ClamAV, WebView2, CBS Shield et données utilisateur.
3. Vérifier le SHA-256 de `CBS Shield_0.6.0-dev_x64-setup.exe`.
4. Exécuter l'installeur graphiquement, choisir **Français**, puis recommencer en
   **English**.
5. Vérifier l'absence d'élévation pour CBS Shield, puis l'UAC éventuel de
   l'installation ClamAV.
6. Vérifier le raccourci, le dossier `%LOCALAPPDATA%\CBS Shield`, l'entrée HKCU et
   la version `0.6.0-dev`.
7. Lancer l'assistant en absence de ClamAV, tester consentement, annulation,
   `winget` absent, délai, échec, reprise et installation réussie.
8. Tester réseau coupé, disque plein, WebView2 absent, UAC refusé.
9. Créer quelques scans, quarantaines et snapshots, puis désinstaller et vérifier
   la conservation des données.
10. Réinstaller, vérifier la reprise des données, puis tester une mise à niveau
    depuis `0.5.0-dev`.

---

## 2. Test hôte réellement exécuté

### 2.1 Artefact

| Propriété | Valeur |
| --- | --- |
| Fichier | `CBS Shield_0.6.0-dev_x64-setup.exe` |
| Taille | **2 658 926 octets** |
| SHA-256 | `650A35AA5A6D59AAB1223D2B41644E5703936C1AE711462227B25112E8784BB8` |
| Signature | **NotSigned** |
| Mode | `currentUser` |
| Langues déclarées | Français, English |
| Dossier Démarrer | `Cybrense` |

### 2.2 Séquence

1. L'installation précédente a été désinstallée ; le dossier d'application était
   absent, les données utilisateur existaient encore.
2. Installation silencieuse finale :

   ```powershell
   Start-Process `
     'target\release\bundle\nsis\CBS Shield_0.6.0-dev_x64-setup.exe' `
     -ArgumentList '/S' -Wait
   ```

   **Code de sortie : 0.**

3. Vérifications après installation :

   | Élément | Résultat |
   | --- | --- |
   | `%LOCALAPPDATA%\CBS Shield\cbs-shield.exe` | présent, 7 361 024 octets |
   | SHA-256 du binaire installé | `FC44D467DD0D185320B760F6F5D429F6D4D69EC41C2B05C95759786C1FF6F737` |
   | `uninstall.exe` | présent |
   | Version HKCU | `0.6.0-dev` |
   | Raccourci `Cybrense\CBS Shield.lnk` | présent |
   | Données `%LOCALAPPDATA%\Cybrense\CBS Shield` | présentes |

4. Réinstallation du même installeur sur la version déjà installée : **code 0**,
   version `0.6.0-dev`, données toujours présentes.
5. Lancement réel du binaire installé, sans Vite, avec WebView2 en mode debug :
   interface chargée, version `0.6.0-dev`, assistant et pare-feu fonctionnels.
6. Désinstallation silencieuse :

   ```powershell
   Start-Process "$env:LOCALAPPDATA\CBS Shield\uninstall.exe" `
     -ArgumentList '/S' -Wait
   ```

   **Code de sortie : 0.**

7. Vérifications après désinstallation :

   | Élément | Résultat |
   | --- | --- |
   | Dossier `%LOCALAPPDATA%\CBS Shield` | supprimé |
   | Raccourci Démarrer | supprimé |
   | Entrée HKCU | supprimée |
   | Dossier de données | **présent** |
   | Snapshots pare-feu | **8 fichiers conservés** |
   | Fichiers ClamAV locaux | **8 fichiers conservés** |

### 2.3 Preuve de conservation des données

Hashes relevés juste après la fermeture de l'application et **identiques après
désinstallation** :

| Fichier | Taille | SHA-256 |
| --- | ---: | --- |
| `cbs-shield.db` | 4 096 | `89A2318C76452BE80E1D743F163F3DD96623B2B05604AA06985C6B5501238362` |
| `cbs-shield.db-wal` | 2 047 672 | `5860575C6A7BDAD24439B9F726ED8BFE11C923960B5CC6C8089B41E32F72B699` |
| `cbs-shield.db-shm` | 32 768 | `C92100B5DC1457C498E28D45263BD856362B4EB9E4D80124C26ADCD7C76C3C09` |
| `quarantine.key` | 262 | `368CE2791D3E655D7731A1EE76397F4704B790CDA377291D36A6EC829ED005DB` |
| `updates.log` | 252 | `0B7F997C8E649836016818B40AD4323A305700AF63C9E36511B4890373425D7E` |

La clé de quarantaine et les signatures ont donc survécu à la désinstallation. La
désinstallation ne doit **pas** être présentée comme un effacement de données.

---

## 3. Scénarios d'échec — non exécutés

| Scénario | Statut |
| --- | --- |
| WebView2 absent | ⛔ non exécuté |
| Téléchargement/réseau indisponible | ⛔ non exécuté |
| Disque plein | ⛔ non exécuté |
| UAC refusé | ⛔ non exécuté |
| Installation CBS Shield interrompue | ⛔ non exécuté |
| Désinstallation interrompue | ⛔ non exécuté |
| Mise à niveau inter-versions | ⛔ non exécuté |
| Profil Windows neuf | ⛔ non exécuté |
| Sélecteur de langue graphique NSIS | ⛔ non exécuté (installation en `/S`) |

---

## 4. Conclusion

Le cycle **hôte** est réussi : installation, réinstallation, lancement, désinstallation
et conservation des données. Ce résultat ne vaut **pas** validation de production :
il existe déjà des données et des composants sur la machine. La recette VM propre et
les scénarios d'échec restent obligatoires avant toute déclaration de fiabilité de
production.
