# Sprint 8 — Régression de sécurité

**Version :** `0.8.0-dev`
**Date de vérification :** 30 octobre 2026
**Branche :** `sprint-8`
**Statut global :** tests locaux passés ; validation VM isolée non terminée.## 1. Résumé

Le Sprint 8 introduit le prototype **Web Guard** sans dégrader les garanties de sécurité du socle. Les tests Rust, les tests UI, la compilation et le bundle NSIS passent, et la revendication finale reste **“partielle : prototype local validé sur l'hôte ; validation VM isolée non terminée”**.

## 2. Invariants respectés

| Invariant | Statut |
| --- | --- |
| Defender jamais désactivé | Maintenu |
| Aucune exclusion Defender ajoutée | Maintenu |
| Aucun malware réel utilisé | Maintenu |
| Aucun DNS système modifié | Maintenu |
| Aucun hosts file, VPN, pare-feu ou profil réseau modifié | Maintenu |
| Aucun certificat racine, WFP, pilote ou service installé | Maintenu |
| Aucune répartition de binaires ClamAV | Maintenu |
| Aucun secret/vue privée committé dans le dépôt | Maintenu |
| ClamAV n'est jamais redistribué | Maintenu |
| Aucun réseau/sécurité global compromis | Maintenu |

## 3. Tests Rust

Commandes exécutées :

```powershell
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Résultat :

- 116 tests passés, 1 ignoré (diagnostic EICAR manuel).
- 0 échec.
- clippy/fmt clean.

## 4. Tests UI

Commande exécutée :

```powershell
npm --prefix ui run test -- --run
```

Résultat :

- 10 fichiers de tests passés.
- 34 tests UI passés.
- 0 échec.

## 5. Compilation et bundle

Commande exécutée :

```powershell
npm run build
```

Résultat :

- compilations Rust et TypeScript/Vite sans erreur ;
- bundle NSIS produit.

Artefacts finaux :

| Artefact | Taille (octets) | SHA-256 |
| --- | ---: | --- |
| `CBS Shield_0.8.0-dev_x64-setup.exe` | 2 773 391 | `9F0377C511AE1EAC8EE408120F17154756EB26E09889783D0FE1A0882131796E` |
| `cbs-shield.exe` | 7 680 000 | `BAF8CAB6B539DCD114532B906FF3BC420E5C93940D6293FAF1F71A41096CAEFC` |

Authenticode des deux artefacts : `NotSigned`.

## 6. Validation Web Guard réel

Pendant la session de validation :

1. Démarrage du prototype : écoute `127.0.0.1:5354` après repli de `127.0.0.1:5353` arrivé à `os error 10013` (mDNS).
2. Tests réels de domaine :
   - `malware.cbs-test.invalid` → bloqué localement, réponse NXDOMAIN, sans résolveur en amont.
   - `sub.malware.cbs-test.invalid` → bloqué par correspondance de label.
   - `allowed.cbs-test.invalid` → autorisé par la liste d'autorisations ; requête relais `RCODE 3` en amont ; le résultat est affiché honnêtement comme erreur, pas faux succès.
   - `example.com` → autorisé, relayé vers le résolveur système réel.
   - import corrompu → `importEmpty` ; la liste de blocage précédente (4 domaines) **est restée intacte**.
3. Redémarrage de l'application : l'état Web Guard, la liste de blocage, la liste d'autorisations et l'historique ont été préservés.
4. Arrêt du prototype : plus d'écoute persistante, pas de modification DNS système.

## 7. Statut de la VM isolée

La VM Windows 11 (`CBS-Shield-Sprint7`) utilisée pour le Sprint 7 n'a pas été maintenue dans un état exploitable assez longtemps pour refaire les scénarios complets de sécurité dans la VM pour le Sprint 8. En conséquence, toutes les revendications de sécurité ci-dessus valent **sur l'hôte**. La VM isolée reste un écart de certification : aucune preuve VM isolée n'est revendiquée.

## 8. Non-effectué

- le cycle complet de sécurité dans une VM isolée (`0.8.0-dev` final installé, portable ClamAV installé, scans, quarantaine, redémarrage).
- un test EICAR réel sur l'hôte (Defender le supprime automatiquement).
- l'exercice de tous les cas réseau dégradés dans un environnement bloqué (aucun réseau déconnecté revendiqué).
- réinstallation du bundle NSIS final dans la VM (l'installation antérieure `0.8.0-dev` restée est une preuve historique).

## 9. Artefacts et publication

- Captures Web Guard FR/EN natives assainies (chemins privés, IPs et suffixe VPN masqués).
- Docs Sprint 8 : `SPRINT8_VM_AV.md`, `SPRINT8_DNS_FILTERING.md`, `SPRINT8_ARCHITECTURE_THREAT_MODEL.md`, `SPRINT8_SECURITY_REGRESSION.md`, `SPRINT8_TEST_REPORT.md`, `SPRINT8_INSTALLER_AUDIT.md`.
- Les artefacts d'installeur et les données de validation hôte restent hors dépôt sous `target/`.

## 10. Conclusion

Le Sprint 8 est un pas réel vers un module Web Guard robuste, mais :

- c'est un prototype loopback, pas une protection système globale ;
- la VM isolée reste un écart de validation ;
- la revendication honnête est **implémenté et testé sur l'hôte**, sans certification VM.
