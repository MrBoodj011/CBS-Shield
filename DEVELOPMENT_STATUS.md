# État du développement — CBS Shield 0.5.0-dev

**Date de vérification :** 27 octobre 2026
**Branche :** `sprint-5` (base Sprint 4 validée `4930e02`)
**Nature :** version expérimentale — antivirus manuel avancé, assistant de premier
lancement, provisionnement ClamAV, observation réseau et pare-feu en lecture seule.

Ce document décrit ce qui a été **réellement implémenté et vérifié**, ce qui reste
**bloqué ou non exécuté**, et les limites connues. Aucune fonctionnalité non testée
n'est présentée comme opérationnelle. Le détail de recette est dans
[`docs/SPRINT5_TEST_REPORT.md`](docs/SPRINT5_TEST_REPORT.md).

---

## 1. Environnement de validation

| Élément | Valeur |
| --- | --- |
| Système | Windows 11 Home, build 26200 |
| Rust | 1.99.1, toolchain MSVC |
| Node.js / npm | 24.18 / 12 |
| WebView2 | Runtime 155 |
| ClamAV | 1.5.4 (`winget`, `Cisco.ClamAV`) |
| Base de signatures | `daily.cld` révision 28165, 3 642 895 signatures officielles |
| Pare-feu Windows | **désactivé sur les 3 profils** — constaté, non modifié |
| Visual Studio | 2022 Build Tools (C++) |

---

## 2. Ce que le Sprint 5 a livré

### 2.1 Assistant de premier lancement

- Assistant 5 étapes : accueil, état du moteur, signatures officielles, protection
  réseau observée, résumé.
- Ouverture automatique tant que `onboardingCompleted` est faux ; réouverture depuis
  **Paramètres** et **Mises à jour**.
- Diagnostic réel : ClamAV présent/absent, version, signatures, âge, pare-feu.
- Installation officielle de ClamAV (`Cisco.ClamAV`) **uniquement** après case
  d'autorisation, avec console visible, sans mode silencieux, sans élévation
  automatique de CBS Shield.
- Possibilité de localiser une installation existante ; aucun téléchargement
  arbitraire.
- Échecs affichés avec code, sortie et reprise ; jamais de faux état « prêt ».
- FR/EN, `<html lang>` synchronisé.

### 2.2 Pare-feu en lecture seule enrichi

- Trois profils réels (Domaine, Privé, Public), actions par défaut, profils actifs.
- **Alertes** : tous profils désactivés, profil désactivé, entrée par défaut
  permissive.
- **Détection de changement** : empreinte composite profils + actions + toutes les
  règles ; baseline locale avancée uniquement sur première observation ou
  acquittement explicite.
- **Mapping connexions TCP → règles** par chemin d'image réel ; aucun mapping inventé
  pour `System` ; résultat présenté comme référence, pas comme verdict.
- **Export JSON** en lecture seule dans
  `%LOCALAPPDATA%\Cybrense\CBS Shield\firewall-backups\`.
- **Gestion de règles verrouillée** : gates visibles (`ruleWritesAllowed=false`),
  aucune commande de mutation, aucun pilote, aucun pare-feu tiers.
- Aucun appel `put_*` ; aucune modification de Microsoft Defender.

### 2.3 Installeur et interface

- Installeur NSIS `0.5.0-dev` `currentUser`, sélecteur **Français / English**,
  dossier `Cybrense` dans le menu Démarrer.
- Données, signatures et snapshots conservés dans le profil utilisateur.
- Design « Midnight Navy » conservé ; dashboard et alertes de sécurité réels ;
  profils pare-feu en trois colonnes ; bannière d'installation incomplète.
- Version `0.5.0-dev` alignée sur Cargo, Tauri, npm et l'interface.

### 2.4 Non-régression 0.4

Les fonctions du Sprint 4 restent présentes : profils Rapide/Complète/Personnalisée,
progression, annulation, erreurs par fichier, export JSON/CSV/Markdown/TXT,
FreshClam manuel/automatique, inventaire `sigtool`, historique SQLite, quarantaine
AES-256-GCM + DPAPI, dashboard réel, FR/EN, tray minimal.

---

## 3. Composants

### Backend Rust

| Crate | Contenu | État |
| --- | --- | --- |
| `cbs-core` | modèles, découverte ClamAV, parsing, orchestration, profils, progression, annulation | Complet et testé |
| `cbs-store` | SQLite v2 (scans, détections, quarantaine, réglages, `netmon_snapshots`) | Complet et testé |
| `cbs-quarantine` | AES-256-GCM, clé DPAPI, store/restore/purge, anti-écrasement | Complet et testé |
| `cbs-netmon` | TCP/UDP, compteurs d'interface filtrés, processus et chemins d'image | Complet et testé |
| `cbs-firewall` | profils, règles, empreintes, alertes — **lecture seule** | Complet et testé |
| `src-tauri` | IPC, assistant, provisioning, baseline, mapping, snapshot, tray | Compilé et testé |

### Interface React

| Section | État |
| --- | --- |
| Dashboard | Réel : posture, alertes pare-feu, moteur, signatures, activité |
| Antivirus | Fonctionnel : sélection, scan réel, profils, progression, rapport |
| Historique | Fonctionnel : 200 rapports, filtres, recherche |
| Quarantaine | Fonctionnel : restauration revalidée, suppression double confirmation |
| Moniteur réseau | Fonctionnel (lecture seule) |
| Pare-feu | Profils, règles, alertes, changements, connexions, snapshot, gates |
| Mises à jour | FreshClam, inventaire, assistant |
| Paramètres | Thème, langue, chemins, options, assistant |
| À propos | Versions, chemins, diagnostic live |
| Assistant | 5 étapes FR/EN, ClamAV explicite |

---

## 4. Tests et résultats

### Rust

Commande : `cargo test --workspace`
**92 réussis, 0 échec, 1 ignoré** (EICAR manuel).

| Suite | Tests | Résultat |
| --- | --- | --- |
| `cbs-core` unitaires | 30 | ✅ 30 |
| `cbs-core` intégration ClamAV | 4 | ✅ 3 + 1 ignoré |
| `cbs-core` mission E | 2 | ✅ 2 |
| `cbs-firewall` | 8 | ✅ 8 |
| `cbs-netmon` | 7 | ✅ 7 |
| `cbs-quarantine` | 9 | ✅ 9 |
| `cbs-shield` | 26 | ✅ 26 |
| `cbs-store` | 7 | ✅ 7 |
| **Total** | **93** | **92 réussis, 1 ignoré** |

### Frontend et qualité

| Commande | Résultat |
| --- | --- |
| `npm run ui:test` | ✅ **23 tests / 8 fichiers** |
| `npm run ui:build` | ✅ TypeScript strict + Vite (1 959 modules) |
| `cargo fmt --all -- --check` | ✅ propre |
| `cargo clippy --workspace --all-targets -- -D warnings` | ✅ aucun avertissement |
| `npm run build` | ✅ release + installeur NSIS |

### E2E natif

Binaire **release** lancé sans Vite, piloté via CDP WebView2 :

- assistant complet en FR et EN, toast, bannière supprimée ;
- pas de réouverture automatique après completion ;
- réouverture depuis Paramètres et Mises à jour ;
- pare-feu réel : 3 profils désactivés, alerte, 659 règles, connexions, mapping ;
- gates de gestion verrouillés ;
- export JSON réel (`readOnly: true`) ;
- dashboard réel FR/EN ;
- captures dans [`docs/screenshots/`](docs/screenshots/).

---

## 5. Installation et distribution

- Installeur NSIS `CBS Shield_0.5.0-dev_x64-setup.exe`, **2 651 293 octets**,
  SHA-256 `4D27F240511A8AE9563434706770AAA3BD3D63E61128B0E384E92A445067B226`,
  **non signé**.
- Installation silencieuse hôte : code 0, dossier `%LOCALAPPDATA%\CBS Shield`,
  raccourci `Cybrense`, entrée HKCU `0.5.0-dev`.
- Lancement : version `0.5.0-dev`, interface embarquée.
- Désinstallation : code 0, binaires/raccourci/registre supprimés, **données
  préservées**.
- SHA-256, taille et détails : [`docs/SPRINT5_INSTALLER_AUDIT.md`](docs/SPRINT5_INSTALLER_AUDIT.md).
- Cycle VM propre : **non exécuté** ; voir
  [`docs/SPRINT5_CLEAN_INSTALL.md`](docs/SPRINT5_CLEAN_INSTALL.md).

---

## 6. Limites et vérifications non exécutées

### Bloqué

- Validation sur **VM Windows 11 propre** : aucune VM/authorisation disponible.
- Matrice d'échec installeur : WebView2 absent, réseau coupé, disque plein, UAC
  refusé, mise à niveau 0.4 → 0.5.
- Installation réelle de ClamAV via l'assistant : ClamAV est déjà installé ; aucune
  désinstallation imposée.

### Non exécuté / limites

- Pare-feu actif : les trois profils sont désactivés sur l'hôte ; CBS Shield le
  signale sans le modifier.
- Sélecteur de langue NSIS en mode graphique : test hôte en `/S`.
- Scan **Complet** de bout en bout et échec réseau FreshClam natif.
- Accessibilité NVDA/Narrateur, contraste élevé, mouvement réduit visuel.
- Signature Authenticode de l'installeur : aucun certificat.
- Gestion active des règles de pare-feu : **non implémentée, non autorisée**.
- Aucune protection temps réel, aucun pilote noyau.

---

## 7. Sécurité — rappel

- CBS Shield **ne remplace pas Microsoft Defender** et ne le modifie pas.
- Le pare-feu est **strictement observé** ; aucune règle n'est modifiée.
- ClamAV reste **externe GPL-2.0**, non embarqué, installé avec autorisation.
- Aucun malware réel n'a été exécuté. Le fichier détecté `Freebuff` a été conservé
  et analysé sans exécution : [`docs/SPRINT5_MALWARE_INVESTIGATION.md`](docs/SPRINT5_MALWARE_INVESTIGATION.md).
- Aucune télémétrie, aucun envoi de fichier ou de rapport.

Détail : [`SECURITY.md`](SECURITY.md) et
[`docs/SPRINT5_SECURITY_REGRESSION.md`](docs/SPRINT5_SECURITY_REGRESSION.md).

---

## 8. Feuille de route

| Phase | Contenu | Statut |
| --- | --- | --- |
| 1 | Scanner manuel ClamAV, historique, quarantaine chiffrée | ✅ |
| 2 | Observation réseau + pare-feu lecture seule | ✅ |
| 3 | Design system, dashboard réel, FR/EN, tray | ✅ |
| 4 | Antivirus avancé, profils, FreshClam, installeur | ✅ |
| 5 | Assistant, provisionnement ClamAV, pare-feu enrichi, installeur 0.5 | ⚠️ Code livré ; validation VM et scénarios d'échec bloqués |
| 6 | Gestion active du pare-feu | Non engagée — autorisation, VM isolée, rollback, revue requis |
| 7 | YARA-X, planification, temps réel | Non commencée — service privilégié et revue requis |

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

# Release + installeur
npm run build

# Hash de l'installeur
Get-FileHash -Algorithm SHA256 `
  'target\release\bundle\nsis\CBS Shield_0.5.0-dev_x64-setup.exe'
```

---

## 10. Avertissement final

CBS Shield 0.5.0-dev est un projet **expérimental**. Il ne remplace pas Microsoft
Defender, qui doit rester actif. Il ne fournit aucune protection en temps réel,
aucune modification de pare-feu, aucune capture de contenu réseau, et ne doit pas
être présenté comme un antivirus complet. Le Sprint 5 n'est pas déclaré entièrement
validé tant que la VM propre et les scénarios d'échec n'ont pas été exécutés.
