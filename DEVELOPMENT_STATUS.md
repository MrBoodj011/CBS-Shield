# État du développement — CBS Shield 0.4.0-dev (Phase 4, sprint 4)

**Date de vérification :** 26 octobre 2026
**Branche :** `sprint-4` (base `b2033a3`, sprint 3 validé avant modification)
**Nature :** version expérimentale — antivirus manuel avancé, profils de scan,
signatures FreshClam, localisation FR/EN complète, observation réseau et pare-feu
en lecture seule.

Ce document décrit ce qui a été **réellement implémenté et vérifié**, ce qui ne l'est
pas, et les limites connues. Aucune fonctionnalité non testée n'est présentée comme
opérationnelle. Les détails de recette et les captures sont dans
[`UX_TEST_REPORT.md`](UX_TEST_REPORT.md).

---

## 1. Environnement de validation

| Élément | Valeur |
| --- | --- |
| Système | Windows 11 Home, build 26200 |
| Rust | 1.99.1, toolchain MSVC |
| Node.js / npm | 24.18 / 12 |
| WebView2 | Runtime 155 |
| ClamAV | 1.5.4 (`winget`, `Cisco.ClamAV`) |
| Base de signatures | CVD `28165` après mise à jour réelle ; `28164` au début de la recette |
| Emplacement des signatures | `%LOCALAPPDATA%\Cybrense\CBS Shield\clamav\database` |
| Pare-feu Windows (OS) | **désactivé sur les 3 profils** — état constaté, non modifié par CBS Shield |
| Visual Studio | 2022 Build Tools (C++) |

> Les signatures évoluent : les numéros ci-dessus sont ceux observés à la validation.

---

## 2. Ce que le sprint 4 a livré

- Profils **Rapide / Complète / Personnalisée** avec cibles et exclusions
  résolues côté backend ; analyse complète limitée aux volumes fixes locaux.
- Progression réelle indexée, annulation, erreurs par fichier, limites de
  ressources bornées, priorité basse, chemins longs, points d'analyse ignorés.
- Export JSON / CSV / Markdown / TXT et rapport enrichi.
- Inventaire `sigtool` (officiel vs signatures personnalisées), explication de
  la révision CVD `28 164` / `28 165`, total officiel **3 642 895** signatures.
- FreshClam manuel et automatique (application ouverte uniquement), vérification,
  nettoyage des `.tmp`, classification hors ligne, journal persistant.
- Interface antivirus en cinq vues et localisation FR/EN de toute l'interface,
  y compris dates, nombres, dialogues et notifications.
- Installeur NSIS `0.4.0-dev` sans ClamAV ni signatures ; provisionnement officiel
  guidé par winget.
- Tests : **79 Rust réussis, 1 ignoré ; 18 UI réussis** ; E2E natif pour scan,
  annulation, détection synthétique, quarantaine, restauration, purge, mise à jour
  et bascule EN. Détail et limites : [SPRINT4_TEST_REPORT.md](docs/SPRINT4_TEST_REPORT.md).

**Non exécuté :** analyse complète de bout en bout, échec réseau FreshClam natif,
installation/désinstallation sur VM propre. Voir
[SPRINT4_CLEAN_INSTALL.md](docs/SPRINT4_CLEAN_INSTALL.md).

---

## 3. Ce que le sprint 3 a livré

### 2.1 Design system « Midnight Navy » et interface

- Nouvelle couche de design `ui/src/theme.css` (jetons de couleur, typographie,
  rayons, élévations, mouvement, composants), chargée après la base historique
  `styles.css` — aucune régression des modules existants.
- **9 sections** : Dashboard, Antivirus, Historique des scans, Quarantaine,
  Moniteur réseau, Pare-feu, Mises à jour, Paramètres, À propos & diagnostic.
- Navigation en trois groupes (Protection / Observation / Système), rail actif,
  carte moteur en pied de sidebar, transitions de page, squelettes de chargement.
- Thèmes **sombre (défaut)** et **clair** entièrement tokenisés, préférence
  persistée ; mode `system` conservé.
- Fenêtre native 1380×900, minimum **1080×700** sans débordement horizontal.
- Documentation : [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md),
  [`UI_COMPONENTS.md`](UI_COMPONENTS.md).

### 2.2 Tableau de bord alimenté par le backend réel

Chaque valeur provient d'une commande IPC, sans donnée fictive :

| Bloc | Source |
| --- | --- |
| Moteur / signatures / fraîcheur | `engine_status` |
| Scans, fichiers, détections, quarantaine | `dashboard_stats` |
| Dernière analyse + activité récente | `list_scans` (rapports SQLite) |
| Éléments en quarantaine | `list_quarantine` |
| Pare-feu (profils actifs) | `firewall_status` (lecture seule) |
| Trafic observé | `netmon_history` (dernière capture persistée) |
| Version / phase | `app_info` |

Règles d'honnêteté appliquées :

- l'état « **Protection manuelle opérationnelle** » n'apparaît que si ClamAV est
  détecté **et** les signatures à jour ; sinon « incomplète » ou « indisponible » ;
- « **Temps réel inactif** » est toujours affiché et Microsoft Defender est
  explicitement désigné comme protection principale ;
- aucune formulation « entièrement protégé » n'existe dans les dictionnaires ;
  un test UI l'interdit.

### 2.3 Localisation FR/EN

- Dictionnaires typés `fr`/`en` dans `ui/src/lib/i18n.tsx` : une clé manquante en
  anglais est une erreur `tsc`.
- Langue persistée côté Rust (`settings.language`, `fr` | `en`), sans migration de
  schéma (table clé/valeur existante).
- Couverture 0.3.0 : shell, navigation, tableau de bord, historique, mises à jour,
  à propos/diagnostic, primitives partagées (fermeture de modale, badges, dates de
  mise à jour).
- Les modules Antivirus, Quarantaine, Réseau, Pare-feu et le corps des Paramètres
  restent en français jusqu'à leur migration : choix explicite pour ne pas livrer
  d'écran à moitié traduit. Les dates et nombres restent au format `fr-FR`.
- Changement de langue **à chaud**, sans rechargement ; synchronisation du menu de
  la zone de notification (`set_tray_language` renvoie `true` quand le menu est mis
  à jour).

### 2.4 Icône de notification (tray)

- `src-tauri/src/tray.rs` : icône système minimale, menu **Ouvrir CBS Shield /
  Quitter**, clic gauche = restaurer et focaliser la fenêtre.
- Aucune interception de la fermeture, aucune réduction automatique, aucun
  démarrage automatique : le comportement Windows natif est conservé.
- Création en « best effort » : si la zone de notification refuse l'icône,
  l'application démarre normalement.

### 2.5 Correction des compteurs réseau (finding A‑10)

`GetIfTable2` expose les sous-couches de filtres NDIS (WFP, Npcap, QoS, filtre
Wi‑Fi virtuel) comme des interfaces distinctes ; le moniteur additionnait leurs
octets, comptant chaque paquet 6 à 8 fois.

- **Correction** : `keep_interface_row()` exclut les lignes dont
  `InterfaceAndOperStatusFlags.FilterInterface` est positionné, en conservant les
  adaptateurs réels (Wi‑Fi, Ethernet, Tailscale, vEthernet WSL).
- **Mesure contrôlée** : téléchargement unique de 20 Mio → **160 Mo avant**,
  **24,6 Mo après** (1,17×, surcoût protocolaire inclus) ; fenêtre inactive 5 s
  ≈ **13 Ko**.
- **Interfaces visibles** après correction : `Tailscale`, `Wi‑Fi`.
- 3 tests unitaires ajoutés (`cbs-netmon` : 7 tests).
- Limite résiduelle documentée : un flux encapsulé VPN apparaît sur le tunnel et
  sur l'adaptateur physique (mesures par interface, jamais des estimations).

### 2.6 Pages Historique, Mises à jour, À propos & diagnostic

- **Historique** : liste SQLite (200 rapports), filtres (tous/propres/détections/
  erreurs), recherche par chemin, modale de rapport avec cibles, moteur,
  signatures, détections et erreurs réelles.
- **Mises à jour** : état moteur/signatures, chemins `clamscan`/`freshclam`, base
  de signatures, jauge d'âge réelle vs seuil configuré, mise à jour explicite avec
  confirmation et journal `freshclam`, guide d'installation ClamAV (`winget`) si
  le moteur est absent.
- **À propos & diagnostic** : produit, version, phase, chemins de données, coffre,
  signatures, `freshclam.conf`, états live moteur/quarantaine/pare-feu/réseau,
  avertissement Defender, ouverture du dossier de données.

### 2.7 Version et packaging

- Version `0.3.0-dev` alignée : `Cargo.toml`, `src-tauri/tauri.conf.json`,
  `package.json`, `ui/package.json`, `Cargo.lock`.
- `app_info.phase` et la description longue de l'installeur ne mentionnent plus la
  « phase 1 ».
- Installeur NSIS `currentUser` généré par `npm run build`, **2,42 Mo**
  (`CBS Shield_0.3.0-dev_x64-setup.exe`), **non signé** ; l'interface est
  embarquée depuis `ui/dist` (aucun serveur Vite en production).

---

## 3. Composants

### Backend Rust

| Crate | Contenu | État |
| --- | --- | --- |
| `cbs-core` | modèles, découverte ClamAV, parsing `clamscan`, orchestration, progression, annulation, erreurs par fichier | Complet et testé |
| `cbs-store` | SQLite v2 (scans, détections, quarantaine, réglages, `netmon_snapshots`), migration v1→v2 | Complet et testé |
| `cbs-quarantine` | AES-256-GCM, clé DPAPI, store/restore/purge, anti-écrasement, purge des orphelins | Complet et testé |
| `cbs-netmon` | TCP/UDP via `GetExtendedTcpTable`/`GetExtendedUdpTable`, compteurs d'interface filtrés (NDIS), noms de processus | Complet et testé |
| `cbs-firewall` | observation lecture seule (`INetFwPolicy2`), empreinte SHA-256 des règles | Complet et testé |
| `src-tauri` | IPC, état partagé, chemins canonisés, langue persistée, tray, gardes de restauration | Compilé et testé |

### Interface React

| Section | État |
| --- | --- |
| Dashboard | Réel : posture, moteur, signatures, dernier scan, quarantaine, pare-feu, trafic, activité, accès rapides |
| Antivirus | Fonctionnel : sélection, scan réel, progression, annulation, rapport, quarantaine ; refus de mise à jour pendant un scan |
| Historique | Fonctionnel : 200 rapports, filtres, recherche, rapport détaillé |
| Quarantaine | Fonctionnel : liste, restauration revalidée, suppression à double confirmation |
| Moniteur réseau | Fonctionnel (lecture seule) : TCP/UDP, processus, volumes corrigés, historique 2 000 lignes |
| Pare-feu | Fonctionnel (lecture seule) : profils, règles, empreinte de modification |
| Mises à jour | Fonctionnel : fraîcheur réelle, `freshclam` avec confirmation, journal |
| Paramètres | Fonctionnel : thème, **langue**, options de scan, chemins, seuil de fraîcheur, diagnostic |
| À propos | Fonctionnel : versions, chemins, diagnostic live, ouverture du dossier de données |

---

## 4. Tests et résultats

### Rust — `cargo test --workspace`

**64 réussis, 0 échec, 1 ignoré** (EICAR manuel), code de sortie 0.

| Suite | Tests | Résultat |
| --- | --- | --- |
| `cbs-core` unitaires | 20 | ✅ 20 |
| `cbs-core` intégration ClamAV | 4 | ✅ 3 + 1 ignoré |
| `cbs-core` mission E (volume + fichier verrouillé) | 2 | ✅ 2 |
| `cbs-firewall` | 3 | ✅ 3 |
| `cbs-netmon` (dont 3 tests de filtrage NDIS) | 7 | ✅ 7 |
| `cbs-quarantine` | 9 | ✅ 9 |
| `cbs-shield` (dont validation de langue) | 13 | ✅ 13 |
| `cbs-store` | 7 | ✅ 7 |
| **Total** | **65** | **64 réussis, 1 ignoré** |

### Frontend

| Commande | Résultat |
| --- | --- |
| `npm run ui:build` | ✅ `tsc --noEmit` + Vite (1 958 modules, 54,99 Ko CSS / 361,86 Ko JS) |
| `npm run ui:test` | ✅ **17 tests / 6 fichiers** |

Nouveaux tests UI : dictionnaires/interpolation (`i18n.test.ts`), tableau de bord
sans fausse protection et avec données réelles (`Dashboard.test.tsx`), historique
filtres + rapport (`History.test.tsx`).

### Qualité

| Commande | Résultat |
| --- | --- |
| `cargo fmt --all -- --check` | ✅ propre |
| `cargo clippy --workspace --all-targets -- -D warnings` | ✅ aucun avertissement |

---

## 5. Vérifications fonctionnelles effectuées

### 5.1 Fenêtre native et design

- Titre lu depuis l'OS : **`CBS Shield — Cybrense`**.
- 9 sections parcourues dans la fenêtre Tauri réelle ; captures dans
  `SCREENSHOTS/` (15 fichiers, voir `UX_TEST_REPORT.md`).
- Thème sombre et thème clair vérifiés ; changement de langue FR→EN à chaud.
- **1080×700** : `scrollWidth == innerWidth` (aucun débordement), navigation
  complète, sous-titre conservé.
- Clavier : `Tab` réel → anneau de focus `solid 2px rgb(78,167,255)`,
  `:focus-visible` actif ; `Échap` ferme les modales ; `aria-current="page"` sur
  l'élément de navigation actif, `aria-pressed` sur les filtres.
- Tray : commande `set_tray_language` → **`true`** (icône existante, menu
  reconstruit dans la langue choisie).

### 5.2 Moniteur réseau — données réelles (corrigées)

1. Interfaces réelles après correctif : **Tailscale, Wi‑Fi** (les couches de
   filtres NDIS ne sont plus comptées). ✅
2. Fenêtre inactive de 5 s : ≈ **13 Ko**, au lieu de centaines de Mo auparavant. ✅
3. Téléchargement contrôlé de 20 Mio : **24,6 Mo** mesurés (1,17×), contre
   **160 Mo** avant correction. ✅
4. Connexions TCP/UDP, PID et processus affichés ; recherche et filtre transport
   opérationnels ; historique SQLite borné à 2 000 lignes. ✅

> Correction d'une affirmation du rapport sprint 2 : les « 174 Mo en 5 s » n'étaient
> pas du trafic réel mais la somme des sous-couches NDIS. Le chiffre correct pour
> une navigation ordinaire est de l'ordre de quelques Ko à quelques Mo selon
> l'activité.

### 5.3 Pare-feu — lecture seule

1. Les trois profils sont rapportés **Désactivé**, conforme à
   `Get-NetFirewallProfile` (`Enabled=False`) et `netsh advfirewall show
   allprofiles state` (`OFF`) — vérification croisée indépendante. ✅
2. Profil actif courant : `privé` (valeur dépendante du réseau, lue via
   `CurrentProfileTypes()`). ✅
3. **657 règles** observées lors de cette session (665 au sprint 2 : les règles
   Windows évoluent), liste bornée avec recherche. ✅
4. **Aucune écriture** : aucun appel `put_*` dans `cbs-firewall` ; CBS Shield n'a
   pas modifié l'état du pare-feu pendant la recette. ✅

### 5.4 Non-régression Phase 1 / sprint 2

1. Scan propre réel via IPC + ClamAV réel (1 fichier, 0 menace). ✅
2. Détection de marqueur de test inoffensif, hash/taille affichés. ✅
3. Quarantaine / restauration / purge à confirmations multiples inchangées. ✅
4. Persistance SQLite après rescan (3 rapports réels dans l'historique). ✅
5. Mise à jour de signatures refusée pendant un scan (garde conservée). ✅

### 5.5 Distribution

- Installeur NSIS `currentUser` généré (aucune élévation à l'installation) :
  `target\release\bundle\nsis\CBS Shield_0.3.0-dev_x64-setup.exe`,
  **2 534 183 octets (2,42 Mo)**, SHA‑256
  `58BBD3717367D7BA165CE29104578242322AA69CF31C0A2E7632EA764E460D27`,
  **non signé** (`NotSigned`).
- L'exécutable release (7 033 856 octets) a été lancé **sans serveur Vite**
  (port 1420 fermé) : la page servie était `http://tauri.localhost/`, interface
  embarquée, données backend réelles. Les captures 01 à 15 ont été refaites depuis
  cette instance release, puis l'application a été fermée (préférences restaurées
  en français + thème sombre).
- Détail complet de la vérification : `UX_TEST_REPORT.md` § 8.
- L'installeur n'a **pas été installé sur une machine propre** (voir limites).

---

## 6. Limites connues

### Interface / localisation

- **Localisation partielle assumée** : Antivirus, Quarantaine, Réseau, Pare-feu et
  le corps des Paramètres restent en français ; dates/nombres au format `fr-FR`.
  Aucun écran n'est à moitié traduit.
- Le tray est minimal (ouvrir/quitter) : pas de réduction dans la zone de
  notification, pas de démarrage automatique, pas de menu contextuel avancé.
- Accessibilité partiellement vérifiée : focus clavier, ARIA, contrastes des jetons
  revus ; **NVDA/Narrateur et mode contraste élevé non testés**.
- Mouvement réduit implémenté (`prefers-reduced-motion`) mais non validé
  visuellement.
- L'installeur n'est **pas signé** (aucun certificat configuré) : SmartScreen peut
  afficher un avertissement.

### Sécurité / fonctionnel

- **Pas de protection en temps réel** : le moniteur observe, il ne bloque rien.
- Un scan propre **ne garantit pas** l'absence de malware (signatures uniquement).
- Pare-feu et réseau strictement en lecture seule ; aucune écriture système.
- La liste des règles du pare-feu est bornée à l'affichage ; l'empreinte porte sur
  l'intégralité.
- La base SQLite n'est pas chiffrée (permissions du profil Windows) ; le coffre de
  quarantaine l'est (AES-256-GCM + DPAPI).
- Un flux VPN encapsulé est compté sur le tunnel et sur l'interface physique.
- Un seul scan simultané ; 64 cibles maximum ; mise à jour de signatures refusée
  pendant un scan.
- Les fichiers > 512 Mo et les liens symboliques ne sont pas mis en quarantaine.

### Environnement / validation

- **Aucune validation sur machine propre** : la recette a eu lieu sur le poste de
  développement existant. L'installeur a été produit et inspecté, pas installé sur
  une VM vierge (`VM_TEST_PLAN.md` décrit la procédure).
- Le pare-feu Windows était **désactivé au niveau OS** sur ce poste ; CBS Shield
  l'affiche fidèlement et ne le modifie pas. Le chemin lecture seule est le même
  sur une machine où il est actif, mais ce cas n'a pas été rejoué ici.
- La mise à jour `freshclam` n'a **pas été relancée** pendant la recette UX (base
  déjà fraîche) : la modale de confirmation a été vérifiée, le flux reste couvert
  par les tests et la validation sprint 2.
- EICAR bloqué par Defender (voir section 7).

---

## 7. Limite EICAR / Microsoft Defender

Le test EICAR de bout en bout **n'a pas pu être validé sur cette machine** :
Microsoft Defender bloque la lecture du fichier par ClamAV (`Win32 error 225`).
Conformément aux contraintes du projet :

- Defender **n'a pas été désactivé** ;
- **aucune exclusion** n'a été ajoutée ;
- aucun malware réel n'a été téléchargé ou exécuté.

La chaîne de détection est validée avec une signature ClamAV de test inoffensive,
qui exerce le même code (lancement, parsing, détection, hash, événements). Le script
`scripts/eicar-manual-test.ps1` permet de refaire le diagnostic avec accord explicite.

---

## 8. Feuille de route

| Phase | Contenu | Statut |
| --- | --- | --- |
| 1 | Scanner manuel ClamAV, historique, quarantaine chiffrée | ✅ Livrée (expérimentale) |
| 2 | Observation réseau + pare-feu lecture seule | ✅ Livrée |
| 3 | Interface produit, design system, tableau de bord réel, FR/EN, tray | ✅ Sprint 3 livré |
| 3 (suite) | Migration i18n des modules restants, YARA-X, planification | À planifier |
| 4 | Protection temps réel / pilote / filtrage actif | Non commencée — conception et revue dédiées requises |

Toute fonctionnalité de sécurité active exigera des privilèges adaptés, une
réversibilité et une revue de sécurité — jamais une activation silencieuse.

---

## 9. Reproduire la validation

```powershell
# Dépendances
npm --prefix ui install

# Backend
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# Frontend
npm run ui:build
npm run ui:test

# Application (dev, Vite sur 1420)
npm run dev

# Installeur NSIS + exécutable release (interface embarquée)
npm run build

# Diagnostic EICAR manuel (optionnel, confirmation requise)
powershell -ExecutionPolicy Bypass -File .\scripts\eicar-manual-test.ps1

# Plan de validation machine propre (consentement explicite requis)
powershell -ExecutionPolicy Bypass -File .\scripts\vm-validate.ps1
```

---

## 10. Avertissement final

CBS Shield 0.4.0-dev est un projet **expérimental**. Il ne remplace pas Microsoft
Defender, qui doit rester actif. Il ne fournit aucune protection automatique,
aucune modification de configuration pare-feu, aucune capture de contenu réseau, et
ne doit pas être présenté comme un antivirus complet.
