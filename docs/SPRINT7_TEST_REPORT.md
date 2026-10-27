# Sprint 7 — Rapport de test

**Version :** `0.7.0-dev`
**Date :** 27 octobre 2026
**Branche :** `sprint-7`
**Base :** Sprint 6, commit `888e0ac`

## 1. Résumé exécutif

Le Sprint 7 livre une version **0.7.0-dev** du pare-feu CBS Shield en lecture seule
avec une interface plus complète, un historique d'instantanés vérifiable et une
gate de sauvegarde renforcée.

Les tests locaux Rust et frontend passent, le build de production et le bundle NSIS
sont produits. La **validation VM Windows 11 n'est pas complète** à la date de ce
rapport : la VM isolée a été créée et Windows a démarré, mais la matrice
d'installation, de scan, de redémarrage, de mise à niveau et de désinstallation doit
encore être exécutée. Aucun résultat non exécuté n'est présenté comme validé.

La mutation de règle reste **désactivée**. Aucun gate d'isolation, de restauration
ou d'autorisation explicite n'est satisfait.

---

## 2. Environnement local

| Élément | Valeur |
| --- | --- |
| Hôte | Windows 11 Home, build 26200, x64 |
| Rust | toolchain MSVC, édition 2021, `rust-version = 1.85` |
| Node.js / npm | Node 24, npm 12 |
| WebView2 | runtime installé |
| Pare-feu hôte | profils désactivés — observation uniquement |
| VirtualBox | 7.2.22 r175245 |
| VM | `CBS-Shield-Sprint7`, Windows 11 Enterprise Evaluation 26H2 |

---

## 3. Tests Rust

Commande :

```powershell
cargo test --workspace
```

Résultat : **95 tests réussis, 0 échec, 1 test d'intégration ignoré** (EICAR
manuel, faute de malware réel dans la suite automatique).

| Crate / cible | Tests |
| --- | ---: |
| `cbs-core` | 30 |
| tests d'intégration | 3 |
| `mission_e` | 2 |
| `cbs-firewall` | 8 |
| `cbs-netmon` | 7 |
| `cbs-quarantine` | 9 |
| `cbs-shield` (lib) | 29 |
| `cbs-store` | 7 |

Nouveaux tests Sprint 7 :

- `snapshot_history_verifies_digest_and_detects_tampering` ;
- `snapshot_paths_are_contained_and_require_json`.

Ils couvrent le sidecar concordant, la détection d'altération, le schéma invalide,
le refus hors dossier d'audit et le refus d'une extension non JSON.

---

## 4. Tests frontend

Commande :

```powershell
npm --prefix ui test -- --pool=threads
```

Résultat : **9 fichiers, 28 tests réussis, 0 échec.**

La suite `ui/src/sections/Firewall.test.tsx` vérifie :

- le rendu des alertes réelles ;
- les métriques et la navigation ;
- les filtres locaux de règles ;
- le détail de règle en lecture seule ;
- l'export d'instantané et la présence du sidecar ;
- l'historique et la vérification ;
- l'absence de restauration exposée ;
- les libellés FR/EN des nouveaux contrôles.

---

## 5. Build et lint

| Commande | Résultat |
| --- | --- |
| `cargo fmt --all -- --check` | ✅ |
| `cargo clippy --workspace --all-targets -- -D warnings` | ✅ |
| `npm --prefix ui run build` | ✅ `tsc --noEmit` + Vite |
| `npm run build` | ✅ binaire release + NSIS |

Le build Vite émet un avertissement de taille de chunk (503,60 Ko) sans erreur.

---

## 6. Installeur NSIS

Le bundle produit est :

```text
target\release\bundle\nsis\CBS Shield_0.7.0-dev_x64-setup.exe
```

Artefact final : **2 674 869 octets**, SHA-256
`F09AAA014DCEE3DE875B6A1016A9B077887563353D706DFAFD08F3196B6AD4AF`,
**non signé Authenticode**. Le détail est dans
[`SPRINT7_INSTALLER_AUDIT.md`](SPRINT7_INSTALLER_AUDIT.md).

### 6.1 Résultats hôte

| Test | Résultat |
| --- | --- |
| Installation silencieuse 0.6 | ✅ code 0 |
| Mise à niveau 0.6 → 0.7 | ✅ code 0, registre `0.7.0-dev` |
| Lancement de l'interface installée | ✅ fenêtre `CBS Shield - Cybrense` |
| Capture FR/EN du pare-feu | ✅ `docs/screenshots/sprint7-firewall-*.png` |
| Export d'instantané + sidecar | ✅ `Empreinte vérifiée` |
| Désinstallation silencieuse | ✅ code 0 |
| Données après désinstallation | ✅ conservées |
| Réinstallation 0.7 | ✅ code 0 |

Ces tests hôte ne remplacent pas la VM isolée.

---

## 7. Validation Windows 11 isolée

### 7.1 Ce qui a été fait

- ISO officielle Windows 11 Enterprise Evaluation 26H2 téléchargée et vérifiée :
  `8 225 329 152` octets,
  SHA-256 `BC3F24086EBADC94489066B5AD78089E2CF5C3491E90E790BB81A2B199C10E38`.
- VM VirtualBox créée avec 6 Go de RAM, 4 vCPU, EFI, TPM 2.0, NAT, VRDE local,
  audio/USB/presse-papiers/glisser-déposer désactivés.
- Installation unattended démarrée ; Windows Setup a dépassé les termes de licence
  et affiche la progression d'installation.
- Aucun dossier hôte n'est partagé avec la VM.

### 7.2 Ce qui reste à exécuter

| Scénario | Statut |
| --- | --- |
| Installation propre sans ClamAV | ⏳ |
| Assistant de préparation | ⏳ |
| Installation officielle ClamAV | ⏳ |
| Signatures FreshClam | ⏳ |
| Scan fixture inoffensive | ⏳ |
| Détection EICAR + quarantaine/restauration | ⏳ |
| Redémarrage et persistance | ⏳ |
| Mise à niveau 0.6 → 0.7 | ⏳ |
| Désinstallation et choix des données | ⏳ |
| Dépendances absentes | ⏳ |
| Pare-feu activé | ⏳ |
| Pare-feu désactivé | ⏳ |
| Instantané + sidecar + altération | ⏳ |
| Gate de mutation | ⏳ |
| Accessibilité clavier | ⏳ |
| Récupération après perte de connectivité | ⏳ (gate de mutation) |

### 7.3 Preuves disponibles

- `target/sprint7-vm/boot-*.png` : progression de l'installation Windows
  (dernier jalon observé : 51 % à 15:17 UTC) ;
- `target/sprint7-vm/CBS-Shield-Sprint7/Logs/VBox.log` : démarrage EFI/NEM ;
- `docs/screenshots/sprint7-firewall-en.png` et
  `sprint7-firewall-fr.png` : pare-feu installé, vue d'ensemble FR/EN ;
- `docs/screenshots/sprint7-firewall-rules-en.png` : règles et filtres locaux ;
- `VM_TEST_PLAN.md` : matrice complète et règles d'isolation.

Ces captures proviennent de l'installation **hôte** 0.7.0-dev. Elles ne sont pas
présentées comme des preuves VM. Les captures contenant des chemins utilisateur
sont conservées localement dans `target/sprint7-vm/` et ne sont pas versionnées.
Les captures VM seront ajoutées uniquement après l'installation et l'exécution
effectives dans la VM isolée.

---

## 8. Sécurité

La revue détaillée est dans
[`SPRINT7_SECURITY_REGRESSION.md`](SPRINT7_SECURITY_REGRESSION.md).

Points saillants :

- aucun `put_*` dans `cbs-firewall` ;
- aucune commande de mutation dans Tauri ;
- `enabled: false`, `mutationApiExposed: false` ;
- sidecar non signé, documenté comme détection d'altération et non comme signature ;
- CSP stricte et capabilities minimales ;
- aucun pilote noyau, aucun service, aucune modification Defender.

---

## 9. Conclusion

Le Sprint 7 est **fonctionnel et testé localement**. Il n'est **pas déclaré validé
sur VM** ni prêt pour la production tant que la matrice de la section 7.2 n'a pas
été exécutée avec preuves. La gestion active des règles reste hors périmètre et
verrouillée.
