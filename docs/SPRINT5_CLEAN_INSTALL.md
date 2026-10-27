# Sprint 5 — Installation propre et cycle de vie

**Version :** `0.5.0-dev`
**Date :** 27 octobre 2026
**Statut global :** ⛔ **validation VM Windows 11 propre non exécutée**
**Test hôte supplémentaire :** ✅ effectué, mais **non équivalent** à une VM propre.

Ce document sépare clairement :

1. la recette **VM propre**, qui reste bloquée ;
2. le test **hôte** réellement exécuté sur le poste de développement ;
3. la matrice d'échec / reprise, non exécutée.

---

## 1. Recette VM Windows 11 propre — non exécutée

### 1.1 Pourquoi

Aucune VM Windows 11 propre n'était provisionnée et aucune autorisation d'en créer
ou d'en cloner une n'a été donnée pendant le sprint. Le test sur l'hôte ne permet
pas de vérifier :

- l'absence de ClamAV, de WebView2, de Visual Studio et de Rust ;
- un profil Windows neuf sans données CBS Shield antérieures ;
- les stratégies de sécurité d'une machine gérée ;
- l'absence de dépendances ou de traces laissées par les builds de développement ;
- le comportement exact de SmartScreen et de l'UAC sur un binaire non signé ;
- la mise à niveau depuis une version 0.4.0 réellement installée ;
- une désinstallation propre après une session complète.

**La mission A du Sprint 5 n'est donc pas validée.**

### 1.2 Procédure prévue

Sur une VM Windows 11 x64 **neuve**, snapshot initial, sans ClamAV installé :

1. vérifier la version de Windows, WebView2, Defender actif, pare-feu actif ;
2. copier l'installeur et son SHA-256, vérifier le hash ;
3. exécuter l'installeur en mode graphique ;
4. choisir **Français**, vérifier le dossier `Cybrense` du menu Démarrer ;
5. vérifier l'absence d'élévation CBS Shield (l'UAC ne doit concerner que winget,
   et seulement après autorisation) ;
6. premier lancement sans outils de développement ni serveur Vite ;
7. vérifier l'assistant : moteur absent, proposition d'installation officielle,
   refus sans case cochée, console visible ;
8. installer ClamAV via l'assistant, vérifier la détection et les signatures ;
9. fermer/rouvrir : l'assistant ne doit plus s'ouvrir automatiquement ;
10. vérifier le pare-feu : profils réels, alertes, règles, export ;
11. fermer, redémarrer Windows, relancer : données et réglages conservés ;
12. installer une version 0.4.0 puis mettre à niveau vers 0.5.0 : données conservées ;
13. désinstaller : binaires, raccourci et registre supprimés ; données utilisateur
    conservées (comportement actuel) ;
14. refaire un cycle avec données supprimées manuellement, vérifier l'état neuf ;
15. consigner chaque échec et le comportement de reprise.

### 1.3 Scénarios d'échec à rejouer

| Scénario | Attendu | État |
| --- | --- | --- |
| WebView2 absent | message clair, aucune installation silencieuse | ⛔ non exécuté |
| Réseau coupé pendant winget | erreur visible, reprise possible | ⛔ non exécuté |
| Réseau coupé pendant FreshClam | erreur classée hors ligne, pas de faux succès | ⛔ non exécuté |
| UAC refusé | assistant reste utilisable, moteur marqué absent | ⛔ non exécuté |
| Disque plein | erreur d'écriture explicite | ⛔ non exécuté |
| Installation annulée | aucun état « installé » simulé | ⛔ non exécuté |
| Désinstallation pendant l'exécution | comportement documenté, pas de corruption | ⛔ non exécuté |
| Mise à niveau 0.4 → 0.5 | base et quarantaine préservées | ⛔ non exécuté |

---

## 2. Test hôte supplémentaire — exécuté

> ⚠️ Ce test a lieu sur le poste de développement, avec ClamAV, WebView2, Rust,
> Node et des données CBS Shield déjà présentes. Il ne remplace **pas** la VM.

### 2.1 Installation

- Installeur : `target\release\bundle\nsis\CBS Shield_0.5.0-dev_x64-setup.exe`.
- Mode utilisé : silencieux `/S` pour l'automatisation ; le sélecteur de langue et
  l'assistant graphique NSIS **ne sont donc pas exercés** par ce test.
- Code de sortie : **0**.
- Dossier d'installation : `%LOCALAPPDATA%\CBS Shield`.
- Raccourci : `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Cybrense\CBS Shield.lnk`.
- Entrée de désinstallation : HKCU, version `0.5.0-dev`.
- Aucune élévation administrateur nécessaire pour CBS Shield.

### 2.2 Lancement

- L'application installée a été lancée et a répondu.
- Version rapportée : `0.5.0-dev`.
- L'interface embarquée s'est chargée sans serveur Vite.
- Les données existantes (base SQLite, réglages) étaient visibles.

### 2.3 Désinstallation

- Mode silencieux, code de sortie : **0**.
- Dossier d'installation supprimé.
- Raccourci du menu Démarrer supprimé.
- Entrée HKCU de désinstallation supprimée.
- **Données utilisateur préservées** :
  `%LOCALAPPDATA%\Cybrense\CBS Shield\cbs-shield.db`, quarantaine, signatures et
  snapshots pare-feu restent en place.
- Aucune suppression automatique de données : c'est le comportement volontaire
  actuel. Le désinstalleur ne contient pas de hook de suppression du dossier de
  données.

## 2.4 Ce que ce test ne prouve pas

- Il ne prouve pas qu'une machine sans WebView2 peut installer l'application.
- Il ne prouve pas le comportement du sélecteur de langue NSIS.
- Il ne prouve pas la mise à niveau depuis 0.4.0.
- Il ne prouve pas la robustesse en cas d'échec réseau, disque plein ou UAC refusé.
- Il ne prouve pas la propreté d'une machine neuve.

---

## 3. Données et désinstallation

Le désinstalleur NSIS généré par Tauri propose une case « supprimer les données de
l'application » liée à l'identifiant du bundle, mais **le dossier de données réel**
est `%LOCALAPPDATA%\Cybrense\CBS Shield`, distinct de l'identifiant
`com.cybrense.cbsshield`. Aucun hook de suppression de ce dossier n'a été ajouté.

Conséquence volontaire : une désinstallation **préserve** l'historique, la
quarantaine, la clé DPAPI, les signatures et les snapshots. Une suppression
complète doit être faite manuellement, après sauvegarde de la clé de quarantaine si
nécessaire.

Une future suppression automatique devrait :

- être explicitement proposée, jamais silencieuse ;
- avertir que la clé de quarantaine sera perdue ;
- ne jamais supprimer un fichier utilisateur hors du dossier de données CBS Shield ;
- être testée sur VM avec restauration/sauvegarde.

---

## 4. Conclusion

Le cycle **installer → lancer → désinstaller** fonctionne sur l'hôte et préserve les
données. La validation **VM Windows 11 propre**, la mise à niveau depuis 0.4.0, le
sélecteur de langue graphique et la matrice d'échec restent **non exécutés**.

**Critère Mission A : non satisfait dans son intégralité.**
