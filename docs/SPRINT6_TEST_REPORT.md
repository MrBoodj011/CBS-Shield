# Sprint 6 — Rapport de test

**Version :** `0.6.0-dev`
**Date :** 27 octobre 2026
**Branche :** `sprint-6`
**Statut global :** ⚠️ **tests locaux réussis — validation VM propre et scénarios
d'échec bloqués ; pas de déclaration « prête pour la production ».**

Ce rapport sépare les résultats **réussis**, les **échecs rencontrés puis corrigés**,
les tests **bloqués** et les tests **non exécutés**. Il ne transforme pas un test non
exécuté en succès.

---

## 1. Environnement

| Élément | Valeur |
| --- | --- |
| Système | Windows 11 Home, build 26200, x64 |
| Rust | 1.99.1, toolchain MSVC |
| Node.js / npm | 24.18 / 12 |
| WebView2 | Runtime 155 |
| ClamAV | 1.5.4, paquet `Cisco.ClamAV` |
| Base | `daily.cld` révision 28165, 3 642 895 signatures |
| Pare-feu | 3 profils désactivés ; `MpsSvc` et `BFE` en cours d'exécution |
| Microsoft Defender | Actif, protection temps réel active, aucune exclusion CBS Shield |
| Installeur | NSIS `0.6.0-dev`, `currentUser`, non signé |

---

## 2. Tests réussis

### 2.1 Rust

Commande :

```powershell
cargo test --workspace
```

Résultat : **93 réussis, 0 échec, 1 ignoré** (94 au total).

| Suite | Exécutés | Réussis | Ignorés | Échecs |
| --- | ---: | ---: | ---: | ---: |
| `cbs-core` unitaires | 30 | 30 | 0 | 0 |
| `cbs-core` intégration ClamAV | 4 | 3 | 1 | 0 |
| `cbs-core` mission E | 2 | 2 | 0 | 0 |
| `cbs-firewall` | 8 | 8 | 0 | 0 |
| `cbs-netmon` | 7 | 7 | 0 | 0 |
| `cbs-quarantine` | 9 | 9 | 0 | 0 |
| `cbs-shield` | 27 | 27 | 0 | 0 |
| `cbs-store` | 7 | 7 | 0 | 0 |
| **Total** | **94** | **93** | **1** | **0** |

Le test ignoré est le diagnostic EICAR manuel (`manual EICAR diagnostic; may be
blocked by Microsoft Defender`). Il n'est pas compté comme une validation de
détection.

Nouveaux tests Rust du Sprint 6 :

- parsing des codes réels `sc query` (`running`, `stopped`, `stopPending`) ;
- refus d'inventer un état pour une valeur inconnue ;
- conservation des tests de changement de règles/profils et de snapshot.

### 2.2 Frontend et qualité

| Commande | Résultat |
| --- | --- |
| `npm run ui:test` | ✅ **26 tests / 9 fichiers** |
| `npm run ui:build` | ✅ TypeScript strict + Vite, **1 960 modules** |
| `cargo fmt --all -- --check` | ✅ aucune sortie |
| `cargo clippy --workspace --all-targets -- -D warnings` | ✅ aucun avertissement |
| `npm run build` | ✅ release + NSIS final |

Tests UI notables :

- `Modal.test.tsx` : focus initial, boucle Tab/Shift+Tab, fermeture, restauration du
  focus, verrouillage du défilement ;
- `SetupWizard.test.tsx` : absence de commande brute dans le parcours principal,
  autorisation explicite, résultat d'installation, états d'erreur ;
- `Firewall.test.tsx` : état des services, export avec SHA-256, distinction
  référence/décision, plan de récupération ;
- `Dashboard.test.tsx` : posture sans ambiguïté protection temps réel.

### 2.3 E2E natif sur l'hôte

Le binaire **release** a été installé, lancé sans Vite et piloté via CDP WebView2.

| Scénario | Résultat |
| --- | --- |
| Installation silencieuse finale (`/S`) | ✅ code 0 |
| Réinstallation sur la même version | ✅ code 0 |
| Version installée | ✅ `0.6.0-dev` |
| Raccourci `Cybrense` | ✅ présent après installation |
| Lancement réel | ✅ interface embarquée, WebView2 |
| Assistant FR/EN | ✅ 5 étapes, focus visible, `Échap` |
| Piège de focus | ✅ test UI + vérification clavier réelle |
| Pare-feu réel | ✅ 3 profils désactivés, 657 règles, services `running` |
| Détection de changement | ✅ 659 → 657 signalé sans réparation |
| Snapshot JSON | ✅ `readOnly: true`, `restoreSupported: false`, SHA-256 vérifié |
| Plan de récupération | ✅ affiché non actif, restauration absente |
| Désinstallation | ✅ code 0, données préservées |

Le nombre de règles a changé pendant la session de validation (659 → 657). CBS Shield
a seulement affiché le changement ; aucune règle n'a été modifiée par l'application.
La nouvelle référence locale n'a été acceptée qu'après un clic explicite.

Snapshots finaux :

| Langue | Fichier | Taille | SHA-256 | Règles |
| --- | --- | ---: | --- | ---: |
| FR | `firewall-snapshot-20261027T135517Z.json` | 365 613 | `21c785585dc3211b33f4f2519161ab327f9dd3ff1afdc510c4acdf8491d0d2cd` | 657 |
| EN | `firewall-snapshot-20261027T135555Z.json` | 365 613 | `581d06218da215171b59df878065a0e0d7c168c3c97d1cd99b42927376f5fb67` | 657 |

Les deux JSON contiennent `"readOnly": true` et `"restoreSupported": false`. Le hash
affiché dans l'interface correspond au hash calculé sur le fichier.

### 2.4 Audit des parcours cliquables

Les parcours principaux ont été exercés sur le binaire installé : navigation des
neuf sections, changement FR/EN, sauvegarde des réglages, ouverture/fermeture de
l'assistant, navigation des cinq étapes, `Continuer`, « Relancer l'assistant »,
« Accepter comme nouvelle référence » et « Exporter un instantané lecture seule ».
Les boutons sans action réelle, les commandes brutes et les états « protégé » trompeurs
ne sont plus présents dans le parcours principal.

Limites : cet audit est **manuel et ciblé**, pas un crawl automatique de tous les
éléments cliquables. Les actions destructives de quarantaine (restauration,
suppression définitive) sont couvertes par les tests UI/backend mais n'ont pas été
rejouées sur un fichier réel dans la session finale.

### 2.5 Captures réelles

Les captures FR/EN sont dans [`docs/screenshots/`](screenshots/) :

| Fichier | Contenu |
| --- | --- |
| `sprint6-dashboard-fr.png` | Dashboard réel, version 0.6.0-dev |
| `sprint6-settings-fr.png` / `-en.png` | Paramètres et explication des journaux techniques |
| `sprint6-updates-fr.png` / `-en.png` | Mises à jour sans commande brute dans le flux principal |
| `sprint6-updates-fr-provisioning.png` / `-en-provisioning.png` | Source officielle et mode d'installation |
| `sprint6-firewall-fr.png` / `-en.png` | Profils, services, référence/décision |
| `sprint6-firewall-fr-change.png` | Changement 659 → 657 détecté, non réparé |
| `sprint6-firewall-fr-recovery.png` / `-en-recovery.png` | Plan de récupération non actif |
| `sprint6-firewall-fr-snapshot.png` / `-en-snapshot.png` | Snapshot, SHA-256, lecture seule |
| `sprint6-setup-welcome-fr.png` | Accueil de l'assistant |
| `sprint6-setup-engine-fr.png` / `-en.png` | État réel du moteur |
| `sprint6-setup-signatures-fr.png` | Signatures et mises à jour |
| `sprint6-setup-network-fr.png` / `-en.png` | Pare-feu observé, profils désactivés |
| `sprint6-setup-focus-en.png` | Focus clavier visible dans le dialogue |

Ces captures ne remplacent pas une validation VM propre.

---

## 3. Échecs rencontrés pendant le développement, puis corrigés

Aucun échec ne subsiste dans les commandes finales. Les échecs suivants ont été
observés et corrigés :

| Échec | Cause | Correction | État final |
| --- | --- | --- | --- |
| `Firewall.test.tsx` : plusieurs éléments `SHA-256` | requête `getByText` trop stricte | `getAllByText` | ✅ |
| `Modal.test.tsx` : focus initial attendu sur « Premier » | le bouton de fermeture est le premier élément focusable | attente corrigée sur le bouton Fermer | ✅ |
| TypeScript : mock `FirewallObservation` non typé | objet de test inféré en `string` | annotation `FirewallObservation` et `service!` | ✅ |
| Clippy : `needless_return` dans `query_service_state` | retour inutile dans un bloc | expression finale | ✅ |
| Clippy/TS pendant l'ajout du SHA-256 | types de snapshot incomplets | champs ajoutés côté Rust et TypeScript | ✅ |

---

## 4. Tests bloqués

| Test | Raison | Preuve |
| --- | --- | --- |
| Installation sur Windows 11 **VM propre** | Windows 11 Home sans Windows Sandbox ni gestion Hyper-V utilisable sans modification non autorisée de l'hôte | Aucune VM provisionnée ; voir `SPRINT6_ENVIRONMENT_LIMITATIONS.md` |
| Installation réelle de ClamAV en **absence de moteur** | ClamAV 1.5.4 déjà installé ; désinstallation non autorisée | Capture assistant = moteur présent, pas état absent |
| Scénario pare-feu avec **profil actif** | les 3 profils sont désactivés ; politiques non modifiées | `Get-NetFirewallProfile` |
| Signature Authenticode | aucun certificat | `NotSigned` |
| Matrice d'échec installeur | nécessite VM jetable (WebView2 absent, disque plein, réseau coupé, UAC refusé, upgrade 0.5 → 0.6) | non exécutée |
| Test EICAR de bout en bout | Defender bloque la lecture EICAR par ClamAV ; exécution de malware interdite | test `#[ignore]` |

---

## 5. Tests non exécutés

- Sélecteur de langue NSIS en mode graphique : installation testée en `/S` uniquement.
- Mise à niveau inter-versions 0.5 → 0.6 et rétrogradation.
- Échec réseau FreshClam natif et reprise après coupure.
- Scan **Complet** de bout en bout sur un disque réel.
- Restauration effective de règles de pare-feu : **non implémentée**.
- Audit NVDA/Narrateur, contraste élevé, mouvement réduit, zoom 200 %.
- Vérification de l'installeur par un utilisateur non-administrateur sur une machine
  neuve.
- Comportement exact de SmartScreen sur une machine sans cache de réputation.

---

## 6. Verdict

**Tests locaux :** réussis, sans échec final.
**Tests de production :** incomplets. Le Sprint 6 n'est **pas déclaré prêt pour la
production** tant que la VM Windows propre, l'installation réelle en absence de
ClamAV, les scénarios d'échec/reprise et la restauration de règles n'ont pas été
validés. Voir `SPRINT6_UNRESOLVED_RISKS.md`.
