# Sprint 6 — Limites de l'environnement de validation

**Version :** `0.6.0-dev`
**Date :** 27 octobre 2026
**Objet :** expliquer pourquoi certains tests de fiabilité et d'installation n'ont
pas été exécutés, sans les présenter comme des succès.

---

## 1. Hôte réel

| Élément | Valeur |
| --- | --- |
| Édition | Windows 11 **Home** |
| Build | 26200 |
| Architecture | x64 |
| Rust | 1.99.1, MSVC |
| Node.js / npm | 24.18 / 12 |
| WebView2 | Runtime 155 |
| ClamAV | 1.5.4 déjà installé |
| Pare-feu | 3 profils désactivés |
| Defender | Actif, temps réel actif |

L'hôte n'est **pas** une machine propre : il contient Windows, des outils de
développement, ClamAV, WebView2, un profil utilisateur et des données CBS Shield
antérieures. Les tests hôte prouvent le fonctionnement sur cette machine, pas sur un
profil neuf.

---

## 2. Pourquoi la VM Windows propre est bloquée

Windows 11 Home ne fournit pas Windows Sandbox ni une gestion Hyper-V utilisable dans
cette configuration sans modification de l'environnement de virtualisation de l'hôte.
Aucune autorisation n'a été donnée pour :

- activer/désactiver une fonctionnalité Windows liée à la virtualisation ;
- modifier Hyper-V, Windows Sandbox ou la configuration du BIOS/UEFI ;
- créer, cloner ou restaurer une VM ;
- modifier des stratégies de l'hôte.

Aucune VM propre n'était disponible. Les scénarios qui en dépendent sont donc
**bloqués**, pas « réussis par absence d'erreur ».

---

## 3. Scénarios bloqués ou non exécutés

### 3.1 Installation

| Scénario | Statut | Raison |
| --- | --- | --- |
| Windows 11 vierge, sans WebView2 | ⛔ non exécuté | pas de VM propre |
| Installation graphique avec sélecteur de langue | ⛔ non exécuté | installation hôte en `/S` |
| Réseau coupé pendant l'installation | ⛔ non exécuté | pas de VM jetable |
| Disque plein | ⛔ non exécuté | pas de VM jetable |
| UAC refusé | ⛔ non exécuté | scénario ClamAV non déclenché |
| Installation interrompue | ⛔ non exécuté | pas de VM jetable |
| Upgrade `0.5.0-dev` → `0.6.0-dev` | ⛔ non exécuté | pas de VM, données hôte conservées |
| Rétrogradation | ⛔ non exécuté | non supportée par NSIS/Tauri |
| Profil entreprise / stratégies | ⛔ non exécuté | hôte personnel |

### 3.2 ClamAV en absence de moteur

ClamAV 1.5.4 est installé sur l'hôte. La désinstallation n'a pas été autorisée. Le
parcours complet « moteur absent → consentement → winget → installation → détection »
n'a donc **pas** été observé de bout en bout.

Ce qui a été testé :

- présence de l'état installé et vérification automatique ;
- source officielle et consentement dans l'interface ;
- refus du backend sans confirmation ;
- mapping des erreurs et résultats dans les tests ;
- documentation de la fenêtre visible et de l'UAC potentiel.

Ce qui manque :

- l'absence réelle de `clamscan.exe` ;
- l'UAC réel de l'installation officielle ;
- le délai réel, l'échec `winget` réel et la reprise ;
- l'installation sur un profil sans ClamAV.

### 3.3 Pare-feu

Les trois profils sont désactivés. Aucune stratégie n'a été modifiée pour créer un
profil actif. Les scénarios suivants ne sont pas validés :

- profil actif avec règles bloquantes ;
- changement de profil réseau réel ;
- règles entrantes/sortantes contradictoires ;
- stratégie de groupe prioritaire ;
- filtres WFP/IPsec non exposés par `INetFwPolicy2` ;
- restauration de règles.

La validation a couvert : lecture des 657 règles, alertes de profils désactivés,
services, changement détecté, snapshot et plan de récupération.

### 3.4 Signature et réputation

Aucun certificat Authenticode n'est disponible. L'installeur final est `NotSigned`.
Le comportement SmartScreen sur une machine sans réputation n'a pas été observé.

### 3.5 Accessibilité

Les tests automatiques couvrent le focus clavier et les rôles ARIA de base. Aucun
audit réel avec NVDA/Narrateur, contraste élevé, zoom 200 % ou préférence de mouvement
réduit n'a été exécuté.

### 3.6 Malware

Aucun malware réel n'a été exécuté sur l'hôte. Le test EICAR de bout en bout est
ignoré car Defender peut bloquer sa lecture par ClamAV. Cette limite est volontaire et
ne doit pas être contournée sur la machine de travail.

---

## 4. Conséquence sur le statut

Ces limitations empêchent de qualifier le Sprint 6 de **production-ready**. Les
éléments réellement validés sont listés dans
[`SPRINT6_TEST_REPORT.md`](SPRINT6_TEST_REPORT.md). Les risques résiduels et les
conditions de sortie sont dans
[`SPRINT6_UNRESOLVED_RISKS.md`](SPRINT6_UNRESOLVED_RISKS.md).
