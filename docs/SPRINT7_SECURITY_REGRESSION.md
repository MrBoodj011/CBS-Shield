# Sprint 7 — Revue de sécurité et non-régression

**Version :** `0.7.0-dev`
**Date :** 27 octobre 2026
**Périmètre :** pare-feu en lecture seule, instantanés d'audit, interface, IPC Tauri,
installeur.
**Statut :** contrôles statiques et tests locaux exécutés ; validation VM encore
partielle. Aucune mutation de règle n'est exposée.

---

## 1. Invariants de sécurité

| Invariant | Vérification | Résultat |
| --- | --- | --- |
| Aucune règle créée/modifiée/supprimée | recherche de `put_*` dans `crates/cbs-firewall/src` | **0 appel** |
| Aucune commande de mutation | recherche `New-NetFirewallRule`, `Set-NetFirewallRule`, `Remove-NetFirewallRule`, `netsh advfirewall set` et `put_*` dans `src-tauri/src/commands/firewall.rs` | **0 correspondance** |
| Aucune restauration exposée | `restoreSupported: false`, `restoreExposed: false`, aucun import de snapshot | conforme |
| Aucun pilote noyau | aucun crate `wdk`, `driver`, `wfp` ajouté ; aucun service CBS Shield | conforme |
| Defender non modifié | aucun appel `Set-MpPreference`, exclusion ou service Defender | conforme |
| Élévation non demandée | manifeste NSIS `asInvoker`, mode `currentUser`, page pare-feu sans UAC | conforme |
| IPC minimal | 7 commandes pare-feu, toutes en lecture ou écriture d'audit local | conforme |
| CSP stricte | `default-src 'self'`, `script-src 'self'`, `connect-src ipc:` | conforme |
| Capabilities minimales | `core:default`, `dialog:allow-open`, `dialog:allow-save` | conforme |

Commandes pare-feu enregistrées :

```text
firewall_status
firewall_acknowledge_baseline
firewall_connections
firewall_export_snapshot
firewall_snapshot_history
firewall_verify_snapshot
firewall_management_status
```

Aucune de ces commandes ne prend une règle en entrée, ne modifie un profil et
n'appelle `INetFwPolicy2::put_*`. `firewall_export_snapshot` écrit uniquement dans
le dossier d'audit CBS Shield.

---

## 2. Instantanés et intégrité

### 2.1 Ce qui est protégé

- Nom de fichier généré à partir de l'horodatage, sans entrée utilisateur.
- Écriture dans `state.paths.firewall_backups`, pas dans un chemin arbitraire.
- Sidecar `*.json.sha256` au format `sha256sum`.
- Lecture de l'historique limitée à 50 fichiers et 16 Mio par fichier.
- `firewall_verify_snapshot` :
  - canonicalise le dossier d'audit et le fichier ;
  - refuse tout fichier hors du dossier ;
  - refuse une extension autre que `.json` ;
  - refuse un dossier à la place d'un fichier ;
  - recompute le SHA-256 sans écrire.

### 2.2 Ce qui n'est pas protégé

- Le sidecar n'est **pas signé**. Un processus élevé peut réécrire le JSON et le
  sidecar ensemble : la vérification détecte une altération accidentelle, pas une
  falsification coordonnée.
- Un instantané sans sidecar est `unverified`, jamais `matched`.
- Un JSON structurellement valide mais divergent est `mismatch`.
- Aucun chemin d'import, d'application ou de restauration n'existe.

### 2.3 Gate de gestion

`firewall_management_status` reste verrouillée :

| Gate | État |
| --- | --- |
| `explicit_authorization` | non satisfaite |
| `isolated_vm_test` | non satisfaite |
| `backup_snapshot` | satisfaite uniquement avec un sidecar concordant |
| `rollback_rehearsal` | non satisfaite |

`backup_snapshot` ne suffit pas à activer la gestion. `enabled` reste `false` et
`mutationApiExposed` reste `false`. L'interface n'affiche aucun bouton de mutation
actif et marque la restauration comme indisponible.

---

## 3. Interface et accessibilité

- Toutes les nouvelles chaînes passent par `L(fr, en)` ; aucune chaîne anglaise
  codée en dur dans les nouveaux blocs.
- Les filtres sont **locaux** : ils ne déclenchent aucun appel IPC.
- La modale de détail utilise `useFocusTrap`, se ferme avec Échap et rend le focus.
- Les tableaux ont des en-têtes, les boutons ont des libellés accessibles.
- Les états vides, erreurs de chargement et erreurs d'action sont distincts.
- Aucune couleur ne porte seule une information : badges + texte.
- La distinction référence / décision effective est visible.

Cette revue ne remplace pas un test lecteur d'écran (NVDA) ni un test clavier
complet sur la VM ; ces points restent à exécuter dans `VM_TEST_PLAN.md`.

---

## 4. Non-régression fonctionnelle

### 4.1 Rust

```text
cargo test --workspace
30 + 3 + 2 + 8 + 7 + 9 + 29 + 7 = 95 tests réussis
0 échec
```

Les tests couvrent notamment :

- parsing ClamAV et états réels ;
- quarantaine et restauration ;
- capture réseau et mapping règles/connexions ;
- lecture pare-feu et détection de changement ;
- parsing réel de `sc query` ;
- nouveaux helpers d'instantanés :
  - `snapshot_history_verifies_digest_and_detects_tampering` ;
  - `snapshot_paths_are_contained_and_require_json`.

### 4.2 Frontend

```text
npm --prefix ui test -- --pool=threads
9 fichiers, 28 tests réussis
```

La suite `Firewall.test.tsx` couvre le rendu des alertes, l'export, la vérification,
les filtres locaux, l'historique et l'absence de bouton de restauration.

### 4.3 Build et lint

```text
cargo fmt --all -- --check          OK
cargo clippy --workspace --all-targets -- -D warnings   OK
npm --prefix ui run build           OK (tsc + vite)
```

Le build Vite signale seulement un chunk JavaScript supérieur à 500 Ko ; ce n'est
pas une erreur et aucun code n'a été chargé depuis le réseau.

---

## 5. Installeur

- Format NSIS x64, mode `currentUser`.
- Sélecteur de langue FR/EN.
- Aucune signature Authenticode disponible.
- Artefact final : **2 674 869 octets**, SHA-256
  `F09AAA014DCEE3DE875B6A1016A9B077887563353D706DFAFD08F3196B6AD4AF`,
  **NotSigned**.
- Mise à niveau hôte 0.6 → 0.7 : code 0, registre `0.7.0-dev`.
- L'installation doit encore être testée dans la VM isolée ; le test hôte ne
  remplace pas ce scénario.

---

## 6. Résultats honnêtes

| Élément | Résultat |
| --- | --- |
| Tests Rust locaux | ✅ 95 réussis |
| Tests frontend locaux | ✅ 28 réussis |
| Build production frontend | ✅ |
| Clippy + fmt | ✅ |
| Build NSIS | ✅ |
| Installation NSIS sur VM propre | ⏳ non terminée |
| Absence de ClamAV sur VM | ⏳ non exécuté |
| Scan fixture inoffensive sur VM | ⏳ non exécuté |
| Pare-feu activé/désactivé sur VM | ⏳ non exécuté |
| Instantané + altération sur VM | ⏳ non exécuté |
| Désinstallation sur VM | ⏳ non exécuté |
| Signature Authenticode | ❌ absente |

Aucun résultat VM n'est déclaré comme validé avant la production des preuves
correspondantes.
