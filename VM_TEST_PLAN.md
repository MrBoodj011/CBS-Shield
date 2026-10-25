# Plan de test machine propre (VM) — CBS Shield 0.2.0-dev

**Date :** 25 octobre 2026 — plan d'exécution sur une **machine propre** (VM
Windows 11 ou restauration à l'image), sans DevTools, sans ClamAV présent à
l'avance. Objectif : prouver qu'un utilisateur réel obtient un produit fonctionnel
sans environnement de développement.

> **Consentement obligatoire.** Le script `scripts/vm-validate.ps1` refuse de
> s'exécuter sans confirmation explicite interactive (il doit être lancé
> volontairement sur le poste de test : il crée des fichiers de diagnostic, lance
> les étapes de build et inspecte le système ; il ne modifie toutefois ni Defender,
> ni le pare-feu, ni aucune règle système).

---

## 1. Préparation de la VM

| Étape | Contenu |
| --- | --- |
| VM1 | Windows 11 x64 (build 22H2+), 2 CPU / 4 Go / 60 Go, pas de mise à jour d'état |
| VM2 | Node.js LTS 20+ (`winget install OpenJS.NodeJS.LTS`), Rust MSVC (`winget install Rustlang.Rustup` + Visual Build Tools C++) |

Ne pas installer ClamAV à l'avance : la machine doit montrer le démarrage sans
ClamAV et guider l'installation (comme un utilisateur réel).

## 2. Déroulé humain

### A. Sans moteur ClamAV

1. **Lancement** `npm run build && npm run tauri dev` (ou installeur) — l'UI doit
   charger sans erreur ; « Moteur : non détecté » au Dashboard ; un message guide
   vers l'installation. ✅ attendu
2. Le scan Antivirus est indisponible (pas de clamscan) : message explicite,
   jamais un spinner infini.
3. `engine_status` affiche l'état `unknown/missing`, jamais forgé.

### B. Installation ClamAV par l'utilisateur

4. `winget install Cisco.ClamAV` — passer la langue FR ; la découverteCBS Shield
   trouve `clamscan/freshclam` au démarrage suivant (ou via Paramètres → chemin).
5. **Mise à jour des signatures** dans l'UI (bouton) : `freshclam` réel → base
   `daily/main/bytecode` dans le dossier app-locale ; état passe `upToDate`.
6. Interruption volontaire : tuer `freshclam` en cours (via gestionnaire) :
   état reste honnête (`outdated` ou « en échec » selon la base), pas de corruption,
   nouveau smoothie/`freshclam` repartant proprement — voir `CLAMAV_INTEGRATION.md` §5.

### C. Fonctionnalités

7. **Scan réel** : sélectionner un dossier, scan terminé `clean`, progression
   lisible, annulation optionnelle testée sur un second scan.
8. **Détection via marqueur de test** (optionnel, méthode NDB inoffensive décrite
   dans `DEVELOPMENT_STATUS.md` § 4.1) : quarantaine → restauration → purge.
9. **Quarantaine** : case à cocher obligatoire ; restauration refusée si écrasement ;
   suppression à double confirmation (`SUPPRIMER`).
10. **Moniteur réseau** : 1 capture → valeurs réelles ; 5 s auto-rérafraîchissement ;
    deltas non-zéros après trafic réel ; filtre TCP/UDP ; recherche ; historique
    purgé quand > 2 000 lignes (facultatif, sinon cohérence des nombres).
11. **Pare-feu** : état de profils conforme à `Get-NetFirewallProfile` (comparer) ;
    comptage des règles cohérent avec `Get-NetFirewallRule` ; bannière de
    modification abs au premier affichage, présente après une modification externe
    (via `netsh` made par le testeur, **jamais par CBS Shield**).
12. **SQLite** : les données persistent après un redémarrage de l'app (scans,
    quarantaine, historique réseau).

### D. Installeur NSIS

13. `npm run build` : `target\release\bundle\nsis\CBS Shield_0.2.0_x64-setup.exe`
    doit construire sans erreur.
14. Exécuter l'installeur sur la VM : raccourcis, désinstalleur, version correcte
    ; désinstallation propre sans restes (coffre et base conservés ou supprimés
    selon le choix explicite — à TOUJOURS laisser le choix).

## 3. Script automatisé

`scripts/vm-validate.ps1` :

- **consentement obligatoire** au préambule (`-Confirm` forcé, aucun `-Y` pipé) ;
- vérifie l'environnement (`node`, `cargo`, `clamscan` — échec propre sinon) ;
- exécute diagnostics : `cargo fmt/clippy/test`, `npm ui:test/ui:build` ;
- **build de l'installeur** optionnel (`-Installer`) — long (8–13 min) ;
- écrit un rapport `target\vm-report-<date>.txt` avec les sorties brutes ;
- **ne modifie jamais** Defender, les règles de pare-feu, ni les exclusions ;
  aucun malware réel à aucun stade.

## 4. Journal des exécutions

| Machine | Date | Version | Résultat | Notes |
| --- | --- | --- | --- | --- |
| VM à exécuter | — | 0.2.0-dev | — | plan fourni, non encore exécuté |
| Machine de dev | 25/10/2026 | 0.2.0-dev | ✅ backend 60 tests + UI 10 tests + parcours réels | voir `DEVELOPMENT_STATUS.md` § 4 |

> Les parcours sur machine propre restent à exécuter avant de parler de
> « installable éprouvé » : sans cette validation, ne pas publier d'affirmation
> de compatibilité d'installeur.
