# Sprint 4 — Rapport de tests et de validation

Version : **0.4.0-dev** — branche `sprint-4` — 26 octobre 2026

Ce rapport distingue strictement les tests **exécutés** des tests **non
exécutés**. Aucun résultat n'est extrapolé.

## 1. Synthèse

| Suite | Résultat |
| --- | --- |
| Tests Rust workspace | **79 réussis, 0 échec, 1 ignoré** |
| Tests UI Vitest | **18 réussis, 0 échec** |
| Build UI TypeScript + Vite | **Réussi** |
| E2E natif WebView2 | Réussi pour les scénarios listés ci-dessous |
| Analyse complète | **Non exécutée** (durée incompatible avec la fenêtre de test) |
| Échec réseau FreshClam natif | **Non exécuté** (réseau non modifiable) |
| Installation/désinstallation VM propre | **Non exécutée** (outillage absent) |

## 2. Tests Rust

Commande : `cargo test --workspace`

`cargo fmt --all -- --check` et
`cargo clippy --workspace --all-targets -- -D warnings` passent également après
correction des avertissements (dont un `match` inutile et une signature Tauri
nombreuse, explicitement autorisée).

| Groupe | Réussis |
| --- | ---: |
| `cbs-core` unitaires | 30 |
| `cbs-core` intégration ClamAV | 3 (1 ignoré) |
| `cbs-core` scénarios mission E | 2 |
| `cbs-store` | 3 |
| `cbs-quarantine` | 7 |
| `cbs-netmon` | 9 |
| `cbs-firewall` | 7 |
| `cbs-shield` (Tauri) | 18 |

Couverture notable :

- cibles rapides existantes, volumes fixes uniquement ;
- exclusions insensibles à la casse, dossier de données exclu ;
- indexation bornée, troncature signalée, points d'analyse ignorés ;
- chemins longs avec préfixe `\\?\` ;
- parsing `sigtool --info`, composants officiels et signatures personnalisées ;
- classification des mises à jour (succès, réseau, interruption) ;
- nettoyage des `.tmp` abandonnés ;
- export JSON/CSV/Markdown/TXT, refus d'un format inconnu, contenu Markdown ;
- scan réel ClamAV d'un fichier inoffensif **propre** ;
- détection d'un fichier synthétique avec une signature de test `.hsb` ;
- fichier verrouillé : erreur non bloquante, pas de crash.

Le test EICAR manuel reste ignoré (`#[ignore]`) : Defender intervient sur la
machine hôte et le test n'est pas déterministe. Aucun malware réel n'est utilisé.

## 3. Tests UI

Commande : `npm run ui:test`

- formatage localisé des durées, tailles, nombres, dates ;
- libellés et sévérités des résultats ;
- bascule FR → EN des nombres, tailles et libellés ;
- rendu du tableau de bord avec un inventaire de signatures ;
- états d'erreur et de chargement.

Commande : `npm run ui:build` — `tsc --noEmit` et `vite build` réussis.

## 4. E2E natif (WebView2, application réelle)

Environnement : hôte Windows, ClamAV 1.5.4, base officielle vérifiée, WebView2,
CDP limité à la fenêtre de test.

| Scénario | Résultat | Preuve / observation |
| --- | --- | --- |
| Démarrage FR | Réussi | tableau de bord réel, captures FR |
| Bascule EN puis retour FR | Réussie | navigation, pages, dialogues et formats EN |
| Résolution des cibles rapides | Réussie | 5 cibles, 9 627 fichiers indexés |
| Scan rapide + annulation | Réussi | annulation à 3 min 23 s, rapport `cancelled`, détection préexistante conservée |
| Scan personnalisé propre | Réussi | 1 fichier, 0 menace, 8,4 s |
| Détection synthétique | Réussie | 2 fichiers, `CBS.Shield.Test.Synthetic-1.UNOFFICIAL`, 7,9 s |
| Mise en quarantaine | Réussie | fichier déplacé, entrée chiffrée AES-256-GCM créée |
| Restauration | Réussie | confirmation + case à cocher, fichier rendu à son chemin d'origine |
| Suppression définitive | Réussie | confirmation + phrase `DELETE`, blob effacé, audit conservé |
| Mise à jour FreshClam manuelle | Réussie | `success=true`, code 0, base vérifiée, CVD 28164 → 28165, `updates.log` écrit |
| Mise à jour automatique | Réussie | activation + intervalle enregistrés, état « Enabled » |
| Provisionnement | Réussi | winget v1.29.380 détecté, ClamAV disponible, commande officielle affichée |

Détection réelle préexistante observée pendant l'annulation du scan rapide :
`Win.Packed.Mikey-9859574-0` dans le dossier `Downloads` de l'utilisateur de
test. Aucun fichier n'a été supprimé ni mis en quarantaine sans confirmation.

### Non exécuté

- **Analyse complète de tous les volumes** : non lancée, trop longue pour la
  fenêtre de validation ; la sélection des volumes fixes et les exclusions sont
  testées unitairement.
- **Échec réseau FreshClam natif** : impossible à provoquer sans couper le réseau
  ou modifier le pare-feu, ce qui est interdit. La classification hors ligne est
  testée unitairement.
- **Installation, premier lancement et désinstallation sur VM propre** :
  aucun outil VM (VirtualBox/VMware/Hyper-V) disponible sans élévation ni
  autorisation. Le rapport ne prétend donc pas valider ce point.
- **Signature de test après nettoyage** : la signature `.hsb` et le corpus
  synthétique ont été retirés après les essais. Ils ne sont pas livrés.

## 5. Vérification sans Vite ni Node

Le binaire de release embarque `ui/dist`. Après arrêt du serveur Vite, le
binaire `target\release\cbs-shield.exe` a été lancé et a chargé l'interface
locale (`tauri.localhost`). Aucun terminal, Node.js, Rust ou Vite n'est requis
pour l'utilisateur final.

## 6. Installeur

Build : `npm run build` (Tauri + NSIS `currentUser`).

- Fichier produit : `target\release\bundle\nsis\CBS Shield_0.4.0-dev_x64-setup.exe`
- Taille : **2 590 416 octets** (2,47 Mio)
- SHA-256 : `46876EBEA9E47DF71D4263DFB7F1884768DAB0BF79DC8FBF98EFF6EDEEBFCC4F`
- Contenu inspecté : exécutable applicatif, ressources WebView2, icônes,
  licence ; **aucun binaire ClamAV ni base de signatures**.
- Dépendances : WebView2 Evergreen, UCRT Windows ; pas de VC++ Redistributable
  supplémentaire (voir [SPRINT4_INSTALLER_AUDIT.md](SPRINT4_INSTALLER_AUDIT.md)).

### Empreinte

Build final de la branche `sprint-4`, 26 octobre 2026, `npm run build`.
L'empreinte ci-dessus correspond au binaire reconstruit après les corrections
d'interface ; elle ne couvre pas une future recompilation.

## 7. Captures

Les captures natives sont dans `docs/screenshots/` :

- `sprint4-dashboard-fr.png`, `sprint4-dashboard-en.png`
- `sprint4-antivirus-fr.png`, `sprint4-antivirus-en.png`
- `sprint4-antivirus-detection-fr.png`
- `sprint4-updates-fr.png`, `sprint4-updates-en.png`
- `sprint4-quarantine-en.png`
- `sprint4-firewall-fr.png`, `sprint4-firewall-en.png`
- `sprint4-network-fr.png`, `sprint4-network-en.png`

## 8. État d'acceptation

| Critère | État |
| --- | --- |
| Quick/Full/Custom réels et documentés | Livré (Full non exécuté de bout en bout) |
| Progression mesurable, annulation, erreurs par fichier | Validé |
| Archives, symlinks, chemins longs, accès refusés | Codé + tests unitaires/intégration |
| Limites configurables | Livré et borné |
| Historique + export | Livré, testé |
| FreshClam manuel/auto, vérification, reprise, hors ligne | Livré ; échec réseau natif non exécuté |
| Compte 28 164 expliqué et distinction test/officiel | Validé |
| Cinq vues antivirus + quarantaine + mises à jour | Livré |
| FR/EN complet | Livré et vérifié sur les pages principales + pages observation |
| Defender/pare-feu non modifiés | Respecté |
| Tests Rust + UI + E2E natif | Exécutés (sauf exceptions ci-dessus) |
| VM propre | **Non exécuté** |
| Installeur NSIS | Construit, contenu vérifié |
| Commit propre, sans push | À finaliser |
