# Sprint 7 — Rapport de test

**Version :** `0.7.0-dev`
**Date :** 28 octobre 2026
**Branche :** `main` (Sprint 7 fusionné depuis `sprint-7`)
**Base :** Sprint 6, commit `888e0ac`

## 1. Résumé exécutif

Le Sprint 7 livre une version **0.7.0-dev** du pare-feu CBS Shield en lecture seule
avec une interface plus complète, un historique d'instantanés vérifiable et une
gate de sauvegarde renforcée.

Les tests locaux Rust et frontend passent, le build de production et le bundle NSIS
sont produits. Le **cycle VM Windows 11 isolée a été exécuté pour les scénarios
principaux** : installation propre sans ClamAV, mise à niveau 0.6 → 0.7, redémarrage
et persistance, export d'instantané avec sidecar `.sha256`, désinstallation avec
conservation des données et observation d'un pare-feu activé sur 3/3 profils. Ces
résultats sont consignés avec leurs preuves dans la section 7.

La validation reste **partielle** : l'installation officielle de ClamAV, FreshClam,
le scan, la quarantaine/restauration, le pare-feu désactivé dans la VM, l'altération
d'instantané dans la VM et un test lecteur d'écran complet ne sont pas revendiqués.
La VM ne dispose ni de `winget` ni de ClamAV, et le compte de test est non
administrateur. Aucun résultat non exécuté n'est présenté comme validé.

La mutation de règle reste **désactivée**. Aucun gate d'isolation, de restauration
ou d'autorisation explicite n'est satisfait ; seul `backup_snapshot` devient
disponible après un export dont le sidecar concorde.

---

## 2. Environnement local

| Élément | Valeur |
| --- | --- |
| Hôte | Windows 11 Home, build 26200, x64 |
| Rust | toolchain MSVC, édition 2021, `rust-version = 1.85` |
| Node.js / npm | Node 24, npm 12 |
| WebView2 | runtime installé |
| Pare-feu hôte | profils désactivés — observation uniquement |
| VirtualBox | 7.2.22 r175245, sans Guest Additions |
| VM | `CBS-Shield-Sprint7`, Windows 11 Enterprise Evaluation 26H2, build 26300 |
| Compte VM | `cbs`, non administrateur, interface française |
| Dépendances VM | `winget` absent, ClamAV absent, pare-feu Windows activé 3/3 |

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

### 7.1 Environnement et méthode

- ISO officielle Windows 11 Enterprise Evaluation 26H2 vérifiée :
  `8 225 329 152` octets,
  SHA-256 `BC3F24086EBADC94489066B5AD78089E2CF5C3491E90E790BB81A2B199C10E38`.
- VM VirtualBox `CBS-Shield-Sprint7` : 6 Go de RAM, 4 vCPU, EFI, TPM 2.0, NAT,
  VRDE local, audio/USB/presse-papiers/glisser-déposer désactivés.
- Windows 11 Enterprise Evaluation 26H2, build `26300`, interface française,
  compte local `cbs` **non administrateur**.
- Aucun dossier hôte partagé, aucune Guest Additions. Les scripts de test et les
  installeurs ont été récupérés par HTTP local, puis leur SHA-256 a été vérifié
  dans la VM.
- `winget` est absent et ClamAV n'est pas installé. Le pare-feu Windows est actif
  sur les trois profils avant et après les tests.
- L'automatisation graphique utilise l'API UI Automation et le clavier virtuel
  VirtualBox. Aucun contenu du bureau hôte n'est copié dans la VM.

Le premier script d'installation a été lancé deux fois en parallèle par erreur :
cela a produit des lignes dupliquées et une erreur de verrou de fichier dans le
journal. Les valeurs uniques et les preuves matérielles restent cohérentes ; ce
doublon n'est pas compté comme deux exécutions distinctes.

### 7.2 Résultats exécutés

| ID | Scénario | Résultat | Preuve observée |
| --- | --- | --- | --- |
| VM-01 | Installation propre 0.7 sans ClamAV | ✅ | `/S` code 0, registre `0.7.0-dev`, binaire installé 7 401 984 octets, SHA-256 `2E0920B4…B97C7`, fenêtre `CBS Shield - Cybrense`, message « ClamAV n'est pas détecté sur ce poste » |
| VM-02 | Assistant de préparation | ⚠️ partiel | assistant 5 étapes affiché (étape 1/5), fermé par « Configurer plus tard » ; parcours d'installation ClamAV non exécuté faute de `winget` |
| VM-03 | Installation officielle ClamAV | ❌ non exécuté | `winget` absent ; aucun paquet officiel n'a été installé dans la VM |
| VM-04 | Signatures FreshClam | ❌ non exécuté | dépend de VM-03 ; aucune base de signatures dans la VM |
| VM-05 | Scan fixture inoffensive | ❌ non exécuté | moteur absent ; la couverture locale ne remplace pas ce scénario VM |
| VM-06 | EICAR + quarantaine/restauration | ❌ non exécuté | dépend de VM-03 ; aucune fixture malveillante utilisée |
| VM-07 | Redémarrage et persistance | ✅ | 6 fichiers de données, 1 instantané, sidecar concordant, base SQLite présente, application relancée après redémarrage |
| VM-08 | Mise à niveau 0.6 → 0.7 | ✅ | installation 0.6 code 0, mise à niveau 0.7 code 0, version `0.7.0-dev`, données conservées |
| VM-09 | Désinstallation | ✅ | `/S` code 0, exécutable et registre supprimés, dossier de données conservé avec 4 fichiers ; choix interactif non exercé |
| VM-10 | Dépendances absentes | ✅ | ClamAV et `winget` absents, messages honnêtes, assistant accessible, aucune boucle infinie observée |
| VM-11 | Pare-feu activé | ✅ | profils `Domain=True, Private=True, Public=True` avant/après, 450 règles à la première lecture puis 476, aucune mutation |
| VM-12 | Pare-feu désactivé | ⚠️ non exécuté en VM | compte non-admin et UAC non automatisé ; l'hôte a observé 0/3 avec la même interface, sans mutation |
| VM-13 | Instantané + sidecar | ✅ | JSON `firewall-snapshot-20261028T150021Z.json`, SHA-256 `CC7F7F77…9826`, sidecar concordant, `readOnly=true`, `restoreSupported=false`, interface « 1 présent, 1 avec empreinte vérifiée » |
| VM-14 | Altération d'instantané | ❌ non exécuté en VM | la détection de `mismatch` est couverte par les tests Rust, pas par une preuve VM |
| VM-15 | Gate de mutation | ✅ | gestion désactivée, `backup_snapshot` disponible après export, autres gates non satisfaites, aucun bouton de mutation actif |
| VM-16 | Accessibilité clavier | ⚠️ partiel | Tab, Échap, Entrée et UI Automation utilisés pour fermer l'assistant, ouvrir Pare-feu/Sauvegardes et exporter ; ordre de tabulation complet et lecteur d'écran non mesurés |
| VM-17 | Récupération après perte de connectivité | ⏳ | impossible sans API de mutation ; reste une condition de la gate |

### 7.3 Preuves conservées localement

- `target/sprint7-vm/vm-result.txt` : installation 0.7, absence de ClamAV,
  pare-feu activé, désinstallation et conservation des données ;
- `target/sprint7-vm/vm-result2.txt` : persistance après redémarrage, sidecar,
  base SQLite et réinstallation ;
- `target/sprint7-vm/vm-result3.txt` : export et vérification d'instantané ;
- `target/sprint7-vm/snapshot-run-07.png` : interface installée avec l'instantané
  exporté, son SHA-256 et « 1 avec empreinte vérifiée » ;
- `target/sprint7-vm/snapshot-run-12.png` : profils 3/3, 476 règles, 1 instantané,
  mutation désactivée ;
- `target/sprint7-vm/post-reboot-app6.png` : tableau de bord après redémarrage,
  absence de ClamAV et version 0.7.0-dev.

Ces fichiers contiennent des chemins utilisateur et restent **hors dépôt**. Les
captures versionnées dans `docs/screenshots/` proviennent de l'installation hôte,
pas de la VM. Les preuves VM ne sont donc pas présentées comme des captures
publiables sans nettoyage.

### 7.4 Limites de cette validation

- Aucun `winget` ni ClamAV dans la VM : le provisionnement, les signatures, le scan,
  la quarantaine et la restauration n'ont pas été validés dans l'environnement isolé.
- Le compte `cbs` est non administrateur et les boîtes UAC ne sont pas automatisées :
  le basculement du pare-feu VM à l'état désactivé n'a pas été exécuté.
- Aucune Guest Additions : les tests reposent sur le clavier virtuel et UI Automation,
  avec un mode d'exécution VirtualBox NEM lent.
- L'altération d'un fichier d'instantané n'a pas été provoquée dans la VM ; le test
  Rust la couvre.
- L'installeur reste **NotSigned** ; aucun certificat Authenticode n'est disponible.

### 7.5 Conclusion VM

Le chemin d'installation, de mise à niveau, de redémarrage, d'export d'instantané et
de désinstallation est **réellement exercé dans la VM isolée**. Les scénarios liés
au moteur antivirus et au pare-feu désactivé restent **non validés dans la VM** et
sont marqués comme tels. Ils ne doivent pas être déduits des résultats hôte.

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

Le Sprint 7 est **fonctionnel et testé localement**. Le socle VM est validé pour
l'installation, la mise à niveau, le redémarrage, l'export d'instantané et la
désinstallation. Il n'est **pas déclaré entièrement validé sur VM** : le
provisionnement ClamAV, les signatures, le scan, la quarantaine/restauration, le
pare-feu désactivé dans la VM et l'altération d'instantané restent non exécutés ou
partiels. La gestion active des règles reste hors périmètre et verrouillée.

Le projet ne doit pas être présenté comme prêt pour la production avant la
fermeture de ces scénarios et l'obtention d'une signature Authenticode.
