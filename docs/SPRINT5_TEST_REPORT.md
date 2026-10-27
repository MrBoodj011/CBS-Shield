# Sprint 5 — Rapport de tests

**Version :** `0.5.0-dev` — branche `sprint-5`
**Date :** 27 octobre 2026
**Base :** Sprint 4 validé, commit `4930e02`
**Artefact :** `target/release/bundle/nsis/CBS Shield_0.5.0-dev_x64-setup.exe`

Ce rapport distingue explicitement les tests **réussis**, **échoués**, **bloqués**
et **non exécutés**. Il ne déclare pas le sprint entièrement validé : la recette sur
VM Windows 11 propre reste impossible avec l'outillage disponible.

---

## 1. Environnement

| Élément | Valeur |
| --- | --- |
| Système | Windows 11 Home, build 26200 |
| Rust | 1.99.1, toolchain MSVC |
| Node.js / npm | 24.18 / 12 |
| WebView2 | Runtime 155 |
| ClamAV | 1.5.4 (`Cisco.ClamAV`) |
| Signatures | `daily.cld` révision 28165, 3 642 895 signatures officielles |
| Pare-feu Windows | **désactivé sur les 3 profils** — état constaté, non modifié |
| Navigateur de test | CDP WebView2 sur le binaire release, sans serveur Vite |

---

## 2. Synthèse

| Catégorie | Résultat |
| --- | --- |
| Rust | ✅ **92 réussis, 0 échec, 1 ignoré** |
| Interface (Vitest) | ✅ **23 réussis / 8 fichiers** |
| TypeScript + build UI | ✅ |
| Format / Clippy | ✅ |
| Build release + installeur NSIS | ✅ |
| E2E natif WebView2 | ✅ scénarios listés ci-dessous |
| Captures réelles FR/EN | ✅ |
| Installation/désinstallation hôte | ✅ supplémentaire, pas une VM |
| Validation VM Windows 11 propre | ⛔ **non exécutée** |
| Scénarios d'échec installeur | ⛔ **non exécutés** |
| Installation ClamAV réelle via l'assistant | ⛔ **non exécutée** (ClamAV déjà présent) |
| Mutation de règle de pare-feu | ⛔ **interdite / non exposée** |

---

## 3. Tests Rust

Commande : `cargo test --workspace`
Résultat : **92 réussis, 0 échec, 1 ignoré**, code de sortie 0.

| Suite | Tests | Résultat |
| --- | --- | --- |
| `cbs-core` unitaires | 30 | ✅ 30 |
| `cbs-core` intégration ClamAV | 4 | ✅ 3 + 1 ignoré (EICAR manuel) |
| `cbs-core` mission E (volume + fichier verrouillé) | 2 | ✅ 2 |
| `cbs-firewall` | 8 | ✅ 8 |
| `cbs-netmon` | 7 | ✅ 7 |
| `cbs-quarantine` | 9 | ✅ 9 |
| `cbs-shield` (commandes Tauri) | 26 | ✅ 26 |
| `cbs-store` | 7 | ✅ 7 |
| Tests de documentation | 0 | ✅ |
| **Total** | **93** | **92 réussis, 1 ignoré** |

Nouveaux tests Sprint 5 :

- empreintes profils / configuration et alertes réelles (`cbs-firewall`) ;
- chemins d'image de processus et mapping par chemin complet ou nom de fichier
  (`cbs-netmon`, `commands::firewall`) ;
- détection des changements de règles, d'état de profil et d'actions par défaut ;
- absence de mapping inventé pour un processus sans chemin ;
- nom de snapshot sûr et absence de changement à la première baseline ;
- politique d'installation ClamAV : paquet officiel, console visible, aucun flag
  silencieux, refus sans autorisation ;
- réglage `onboardingCompleted` et gates de gestion du pare-feu.

### Qualité

| Commande | Résultat |
| --- | --- |
| `cargo fmt --all -- --check` | ✅ propre |
| `cargo clippy --workspace --all-targets -- -D warnings` | ✅ aucun avertissement |

---

## 4. Tests interface

Commande : `npm run ui:test`
Résultat : **23 réussis / 23, 8 fichiers**, code de sortie 0.

| Fichier | Rôle |
| --- | --- |
| `components/SetupWizard.test.tsx` | assistant, étapes, autorisation ClamAV, absence de faux succès |
| `components/UnavailablePanel.test.tsx` | module indisponible honnête |
| `lib/format.test.ts` | formats localisés |
| `lib/i18n.test.ts` | dictionnaires FR/EN, interpolation |
| `sections/Dashboard.test.tsx` | données réelles, aucune fausse protection complète |
| `sections/Firewall.test.tsx` | profils, alertes, mapping, gates verrouillés |
| `sections/History.test.tsx` | filtres et rapport |
| `sections/NetworkMonitor.test.tsx` | connexions et états |

Build : `npm run ui:build` → `tsc --noEmit` + Vite, **1 959 modules**, CSS
70,86 Ko, JS 457,25 Ko (gzip 126,81 Ko). ✅

---

## 5. E2E natif WebView2

Le binaire **release** `target\release\cbs-shield.exe` a été lancé sans Vite, avec
WebView2 en mode débogage CDP pour automatiser la fenêtre réelle. La page servie
était l'interface embarquée `http://tauri.localhost/`, pas le serveur de
développement.

### 5.1 Assistant de premier lancement

| Scénario | Résultat |
| --- | --- |
| Ouverture automatique quand `onboardingCompleted=false` | ✅ |
| Cinq étapes : accueil, moteur, signatures, réseau, résumé | ✅ |
| Données moteur/signatures/pare-feu réelles | ✅ |
| Parcours complet en français | ✅ |
| Parcours complet en anglais | ✅ |
| Toast de fin et disparition de la bannière « configuration incomplète » | ✅ |
| Redémarrage après completion : pas de réouverture automatique | ✅ |
| Réouverture depuis **Paramètres → Relancer l'assistant** | ✅ |
| Réouverture depuis **Mises à jour** | ✅ |
| `<html lang>` synchronisé (`fr` / `en`) | ✅ |

### 5.2 Pare-feu

| Scénario | Résultat |
| --- | --- |
| Trois profils affichés avec l'état réel | ✅ |
| Alerte « tous les profils désactivés » issue du système | ✅ |
| Règles réelles, compteur total, recherche | ✅ |
| Connexions TCP réelles avec PID/processus | ✅ |
| Mapping uniquement avec chemin d'image réel | ✅ |
| Aucun mapping inventé pour `System` | ✅ |
| Gates de gestion affichés et verrouillés | ✅ |
| Export snapshot JSON en lecture seule | ✅ |
| Aucune règle modifiée pendant la recette | ✅ |

L'export réel a produit un fichier dans
`%LOCALAPPDATA%\Cybrense\CBS Shield\firewall-backups\` contenant **657 règles** et
`"readOnly": true` (export du 26 octobre ; l'observation finale du 27 octobre
affichait **659 règles**, la stratégie Windows ayant évolué). Le fichier n'est pas
restaurable : aucune commande d'import n'existe.

### 5.3 Dashboard et non-régression

| Scénario | Résultat |
| --- | --- |
| Dashboard alimenté par le backend réel | ✅ |
| Alertes de sécurité réelles visibles | ✅ |
| Aucune mention « entièrement protégé » | ✅ |
| Thème sombre conservé | ✅ |
| Navigation FR/EN à chaud | ✅ |
| Version `0.5.0-dev` affichée | ✅ |

### 5.4 Captures

Captures réelles dans `docs/screenshots/` :

- assistant : accueil, moteur, signatures, réseau, résumé — **FR et EN** ;
- pare-feu : tableau de bord, connexions, gestion — **FR et EN** ;
- dashboard **FR et EN**.

---

## 6. Installation et artefact

Le détail complet (taille, SHA-256, signature, contenu NSIS, installation hôte)
est dans [`SPRINT5_INSTALLER_AUDIT.md`](SPRINT5_INSTALLER_AUDIT.md) et
[`SPRINT5_CLEAN_INSTALL.md`](SPRINT5_CLEAN_INSTALL.md).

Résumé :

- build release et installeur NSIS générés avec succès ;
- installeur **2 651 293 octets**, SHA-256
  `4D27F240511A8AE9563434706770AAA3BD3D63E61128B0E384E92A445067B226`,
  **non signé** (aucun certificat configuré) ;
- installation silencieuse de test sur l'hôte : code de sortie 0, dossier
  `%LOCALAPPDATA%\CBS Shield`, raccourci `Cybrense`, entrée HKCU `0.5.0-dev` ;
- lancement de l'application installée : version `0.5.0-dev` ;
- désinstallation : code 0, binaires/raccourci/registre supprimés, **données
  utilisateur préservées** ;
- installation sur VM propre : **non exécutée**.

---

## 7. Échecs observés

Aucun échec produit dans l'état final.

Pendant le développement, deux tests UI ont d'abord échoué pour des raisons de
harnais (mock non hissé, sélecteur ambigu), puis ont été corrigés avant la recette
finale. Aucun défaut produit n'est resté ouvert dans le périmètre testé.

Le seul échec fonctionnel constaté concerne la détection EICAR : Microsoft Defender
bloque la lecture du fichier par ClamAV (`Win32 error 225`). Conformément aux
contraintes, Defender n'a **pas** été désactivé et aucune exclusion n'a été ajoutée.
La chaîne de détection est vérifiée avec une signature ClamAV de test inoffensive.

---

## 8. Tests bloqués

| Élément | Raison |
| --- | --- |
| Validation sur VM Windows 11 propre | aucune VM propre provisionnée / autorisation absente |
| Matrice d'échec de l'installeur | nécessite une VM jetable (WebView2 absent, réseau coupé, disque plein, UAC refusé) |
| Installation réelle de ClamAV via l'assistant | ClamAV 1.5.4 déjà installé ; aucune désinstallation imposée |
| Scénario pare-feu avec profils actifs | les 3 profils sont désactivés sur l'hôte ; non modifiés |
| Alerte de changement réelle en conditions actives | dépend du scénario VM / pare-feu actif |
| Signature Authenticode de l'installeur | aucun certificat de signature disponible |

---

## 9. Tests explicitement non exécutés

- Scan **Complet** de bout en bout (volume entier) : non relancé pendant ce sprint.
- Échec réseau `freshclam` natif : non rejoué.
- WebView2 absent, installation hors ligne, mise à niveau depuis 0.4.0, retour
  arrière, désinstallation pendant que l'application tourne.
- Sélecteur de langue NSIS et dossier du menu Démarrer en mode **graphique** :
  l'installation hôte a utilisé le mode silencieux `/S`.
- Suppression des données par le désinstalleur : **non implémentée**, les données
  sont volontairement préservées.
- Accessibilité NVDA/Narrateur, contraste élevé, mouvement réduit visuel.
- Analyse dynamique ou exécution du fichier détecté `Freebuff` : **interdite et non
  effectuée**.
- Désactivation de Defender, ajout d'exclusion, ouverture de port : **interdit et
  non effectué**.
- Mutation de règle de pare-feu : **hors périmètre, aucune API**.

---

## 10. Critères d'acceptation

| Critère | État |
| --- | --- |
| Assistant de premier lancement fonctionnel | ✅ |
| Installation ClamAV explicitement autorisée, jamais silencieuse | ✅ (code + tests) |
| Pare-feu strictement en lecture seule | ✅ |
| Alertes, changements et mapping issus de données réelles | ✅ |
| Gestion de règles désactivée | ✅ |
| Tests Rust/UI/build | ✅ |
| E2E natif release | ✅ |
| Captures réelles | ✅ |
| Installeur + SHA-256 | ✅ |
| Validation VM propre | ⛔ bloquée |
| Matrice d'échec installeur | ⛔ non exécutée |
| Installation ClamAV réelle depuis l'assistant | ⛔ non exécutée |

**Conclusion :** le périmètre code, interface, tests automatisés et E2E est livré.
La validation d'installation propre et plusieurs scénarios de reprise restent
bloqués. **Le Sprint 5 n'est pas déclaré entièrement validé.**
