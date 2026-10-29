# Sprint 8 — Validation antivirus Windows 11

**Version :** `0.8.0-dev`
**Date de vérification :** 30 octobre 2026
**Branche :** `sprint-8`
**Statut global :** partiel — validation réelle faite sur l'hôte ; validation dans la VM Windows 11 isolée **non achevée** et ne doit pas être présentée comme prête pour la production.

## 1. Résumé exécutif

CBS Shield `0.8.0-dev` a été exercé avec le vrai moteur ClamAV officiel et sa base de signatures locale. Le flux antivirus manuel a été validé **de bout en bout sur l'hôte Windows 11** : détection du moteur, intégrité et fraîcheur des signatures officielles, scan personnalisé propre, détection synthétique produite par une signature de test **non officielle** importée dans une base jetable, quarantaine, restauration, second identifiant de quarantaine, purge et persistance après redémarrage de l'historique et de l'état.

Cette validation est un **repli hôte**, pas une validation VM isolée. La VM Windows 11 isolée (`CBS-Shield-Sprint7`) n'a pas été maintenue dans un état exploitable assez longtemps pour refaire ce cycle dans la VM pendant le Sprint 8. Cet écart est explicité ci-dessous.

## 2. Matrice d'état

| Élément | État |
| --- | --- |
| Détection du moteur officiel ClamAV 1.5.4 | Testé (hôte) |
| Intégrité/fraîcheur des signatures officielles | Testé (hôte) |
| Mise à jour des signatures via FreshClam | Testé (hôte) |
| Scan personnalisé propre (base officielle) | Testé (hôte) |
| Détection synthétique avec signature réservée `.ndb` | Testé (hôte, clairement non officiel) |
| Quarantaine / restauration / purge / persistance | Testé (hôte) |
| Installation portable de ClamAV `1.5.4` (ZIP, URL/taille/SHA-256 épinglés) | Implémenté et testé unitairement ; **non validé de bout en bout** |
| Installation propre dans la VM Windows 11 isolée | **Bloqué / non fait pour le Sprint 8** |
| Installation portable de ClamAV dans la VM | **Bloqué / non fait pour le Sprint 8** |
| Scan rapide/personnalisé dans la VM | **Bloqué / non fait pour le Sprint 8** |
| FreshClam dans la VM | **Bloqué / non fait pour le Sprint 8** |
| Cycle de quarantaine dans la VM | **Bloqué / non fait pour le Sprint 8** |
| Persistance après redémarrage de la VM | **Bloqué / non fait pour le Sprint 8** |
| Désactivation de Microsoft Defender | **Jamais tenté** |
| Ajout d'exclusions Defender | **Jamais tenté** |
| Utilisation d'échantillons malveillants réels | **Jamais tenté** |
| Distribution de binaires ClamAV | **Jamais fait** (la dépendance reste externe) |

## 3. Provenance du moteur et des signatures

L'hôte disposait déjà d'une installation officielle de ClamAV `1.5.4` sous `C:\Program Files\ClamAV\clamscan.exe`. CBS Shield a été pointé vers ce moteur officiel avec `CBS_SHIELD_DATA_DIR` utilisé uniquement pour un répertoire de données de test, et FreshClam a été exécuté en amont pour rafraîchir la base de signatures avant tout scan.

Composants officiels observés avant les scans propre et synthétique :

| Composant | Version CVD | Signatures |
| --- | ---: | ---: |
| `bytecode.cvd` | 339 | 80 |
| `daily.cvd` | 28168 | 355 838 |
| `main.cvd` | 63 | 3 287 027 |
| **Total des signatures officielles** | | **3 642 945** |

Les trois composants étaient tous signalés vérifiés dans l'UI ; aucune base tierce ou modifiée n'a été utilisé pour le scan propre.

## 4. Validation hôte réellement effectuée

### 4.1 Scan personnalisé propre

Un fixture texte inoffensif (`target\sprint8-fixtures\clean.txt`) a été scanné avec la base officielle.

- Résultat : `clean`
- Fichiers analysés : 1
- Détections : 0
- Dernier scan dans le dashboard : « Scan terminé — aucune menace », `1` fichier analysé, `0` détection, 0 erreur.

### 4.2 Détection synthétique par signature temporaire non officielle

Windows Defender a automatiquement supprimé une chaîne EICAR réelle du disque et, parce qu'il était interdit de désactiver Defender ou d'ajouter des exclusions, la voie de détection a été testée avec une **signature locale temporaire `.ndb`** dans un répertoire de base de signatures jetable :

- Ligne de signature : `CBS_Test_Synthetic:0:*:414243444546`
- Contenu ciblé : les octets `ABCDEF`
- Nom de la détection : `CBS_Test_Synthetic.UNOFFICIAL`
- SHA-256 du fichier : `e9c0f830f7...` (consigné dans le diagnostic et l'historique de quarantaine)
- Taille : 6 octets

Le scan a correctement rapporté 1 fichier analysé, 1 détection, et la détection a été affichée avec le suffixe `.UNOFFICIAL`, marquant explicitement que la signature n'était pas officielle.

### 4.3 Quarantaine / restauration / purge

La quarantaine de `0.8.0-dev` a été éprouvée de bout en bout :

| Identifiant de quarantaine | Action | Résultat |
| --- | --- | --- |
| 1 | Quarantaine puis restauration | Le fichier a été remis à son chemin d'origine avec le même contenu. Statut enregistré : `restored`. |
| 2 | Quarantaine puis purge | Phrase confirmée ; fichier supprimé du disque. Statut enregistré : `deleted`. |

L'historique de quarantaine a bien conservé les deux statuts après redémarrage.

### 4.4 Persistance après redémarrage

L'application release dépaquetée a été redémarrée plusieurs fois pendant les tests. À chaque redémarrage :

- l'historique et les statuts de quarantaine restaient lisibles ;
- l'état du protocole/réglages restait intact ;
- aucun réglage DNS ou Defender système n'a été modifié par le module antivirus ;
- aucun élément actif ne restait dans la quarantaine après la purge.

## 5. Ce qui n'a pas été validé

### 5.1 VM isolée

La VM Windows 11 isolée utilisée pour la validation du Sprint 7 (`CBS-Shield-Sprint7`) a été réutilisée comme cible du Sprint 8. Elle est restée systématiquement instable dans l'environnement courant (état bloqué entre `aborted` et `poweroff` après des tentatives headless/VRDE), si bien que le cycle antivirus complet dans la VM n'a pas été achevé pour le Sprint 8. En conséquence :

- aucune installation propre de `0.8.0-dev` final (installeur final) n'est revendiquée dans la VM ;
- aucune installation portable de ClamAV dans la VM n'est revendiquée ;
- aucun scan rapide/personnalisé, aucune quarantaine, aucune mise à jour FreshClam, ni aucune persistance après redémarrage dans la VM n'est revendiqué.

L'installation antérieure de `0.8.0-dev` constatée dans la VM reste une preuve historique ; l'installeur final reconstruit le 30 octobre 2026 n'a **pas** été réinstallé dans la VM.

### 5.2 Installation portable de ClamAV de bout en bout

L'installation portable est implémentée dans `src-tauri/src/commands/signatures.rs` avec :

- confirmation explicite de l'utilisateur exigée ;
- téléchargement HTTPS unique d'un ZIP épinglé ;
- taille et SHA-256 attendus épinglés (`0d9e0228b2674137ea1a2853566c98a0278ad52ab2582c3d6dbd75373848c395`) ;
- vérification du hachage en streaming ;
- extraction bornée ;
- remplacement atomique avec marqueur et re-probe.

Ce chemin est couvert par des tests unitaires ciblés (validité de l'épingle, taille, SHA-256 en streaming, extraction bornée, confirmation de la commande d'installation, racine de moteur imbriquée). Il n'a **pas** été exécuté sur un hôte ou une VM propre, car l'hôte disposait déjà d'une installation officielle de ClamAV et la VM était inutilisable. Sur l'hôte, la commande d'installation a correctement renvoyé `alreadyInstalled`.

## 6. Règles de sécurité respectées

Les points suivants n'ont jamais été faits pendant le Sprint 8 :

- **Defender n'a jamais été désactivé** et aucune exclusion Defender n'a été ajoutée.
- **Aucun malware réel** n'a été téléchargé, extrait ou exécuté.
- **Aucun binaire ClamAV n'a été redistribué** ; l'installation officielle `1.5.4` est restée externe.
- **Aucun réglage DNS système, fichier hosts, VPN ou règle de pare-feu n'a été modifié.**
- La signature de test `.ndb` temporaire n'a été utilisée que dans un répertoire de base jetable et ne fait pas partie de l'installeur livré.

## 7. Preuves

- Screenshots du dashboard et de l'historique des scans : `docs/screenshots/sprint8-dashboard-fr.png`, `sprint8-scan-history-fr.png` (repli hôte, assainis).
- Screenshot de la quarantaine : `docs/screenshots/sprint8-quarantine-fr.png` (repli hôte, assaini).
- Screenshot de l'assistant de signatures : `docs/screenshots/sprint8-setup-03-signatures-fr.png` (repli hôte, assaini).
- Artefact installeur : `target\release\bundle\nsis\CBS Shield_0.8.0-dev_x64-setup.exe`, 2 773 391 octets, SHA-256 `9F0377C511AE1EAC8EE408120F17154756EB26E09889783D0FE1A0882131796E`, Authenticode `NotSigned`.

## 8. Risques résiduels

- **Écart de VM.** Les preuves antivirus du Sprint 8 sont issues de l'hôte, pas de la VM ; cela ne suffit pas pour déclarer la voie antivirus prête pour la production.
- **Écart d'installation portable.** L'installation portable est implémentée et testée unitairement, mais pas exercée de bout en bout sur une machine propre.
- **Risque d'interférence de Defender.** Defender restant actif, un test EICAR réel sur l'hôte n'est pas possible sans violer les règles de sécurité ; la signature synthétique non officielle est le contournement honnête.
- **Planification de FreshClam.** La planification automatique de FreshClam est manuelle/désactivée dans la configuration de test ; c'est un choix de produit, pas un défaut.

## 9. Revendication honnête

Le Sprint 8 livre `0.8.0-dev` avec un flux antivirus réel et testé sur l'hôte, et l'écart de validation VM explicitement marqué comme bloqué. La revendication est donc « implémenté et testé sur hôte, validation VM isolée à faire », pas « prêt pour la production ».
