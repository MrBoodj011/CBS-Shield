# Sprint 9.2 — Régression de sécurité

**Version applicative validée :** `0.9.0-dev` · **Artefact :** `CBS Shield_0.9.0-dev_x64-setup.exe`
**SHA-256 (hôte) :** `d5a8b626a7797110aa8006f4ab69648a9a9f41581ba4bb08e32f33ae2f90b1fd`
**Date :** 2026-10-30 · **Branche :** `sprint-9` (base `9b2c832`)

> Sprint de QA et de conception : **aucun fichier source n'a été modifié**. Le diff de 9.2 est composé uniquement de documents et de maquettes HTML statiques (`git status` : 4 fichiers `.md` + `docs/sprint92-mockups/`).

---

## 1. Portée : ce qui n'a pas bougé

| Contrôle | État en 9.2 | Preuve |
| --- | --- | --- |
| Code Rust (crates + `src-tauri`) | Inchangé depuis `9b2c832` | `git status --porcelain` : aucune modification suivie |
| Interface (`ui/src`) | Inchangée | idem ; `npm run ui:build` reconstruit sans erreur |
| Microsoft Defender (hôte) | Non modifié, non désactivé, aucune exclusion ajoutée | Aucune commande Defender exécutée pendant 9.2 |
| Pare-feu Windows (hôte) | Non modifié | Aucune commande `netsh`/`New-NetFirewallRule` exécutée sur l'hôte |
| Paramètres de virtualisation | Non modifiés | Seules des commandes `VBoxManage controlvm` (clavier, capture) ont été utilisées |
| DNS système | Non modifié | Web Guard reste en boucle locale `127.0.0.1:8787` |
| Échantillons malveillants | Aucun | Seuls EICAR et la signature synthétique `ABCDEF` ont été utilisés |
| Publication / push distant | Aucun | Commit local uniquement |

## 2. Vérifications exécutées

| Suite | Commande | Résultat |
| --- | --- | --- |
| Formatage Rust | `cargo fmt --all -- --check` | OK (exit 0, aucun diff) |
| Lint Rust | `cargo clippy --workspace --all-targets -- -D warnings` | OK — 0 avertissement |
| Tests Rust | `cargo test --workspace` | **125 réussis, 0 échec, 1 ignoré** (10 binaires de test) |
| Tests UI | `npm run ui:test` | **34 réussis / 34** (10 fichiers) |
| Build UI | `npm run ui:build` | OK — 1 962 modules, bundle produit |
| Intégrité installateur | `sha256sum` de l'artefact NSIS | `d5a8b626…b1fd`, identique au hash relevé dans l'invité |

Détail des tests Rust par crate :

| Crate | Tests | Ignorés |
| --- | --- | --- |
| `cbs-core` (unit + `clamav_integration` + `mission_e`) | 30 + 3 + 2 | 1 (`clamav_integration`, nécessite un binaire externe) |
| `cbs-firewall` | 8 | 0 |
| `cbs-netmon` | 7 | 0 |
| `cbs-proactive` | 7 | 0 |
| `cbs-quarantine` | 9 | 0 |
| `cbs-shield` (lib) | 38 | 0 |
| `cbs-store` | 7 | 0 |
| `cbs-webguard` | 14 | 0 |

## 3. Revue des invariants de sécurité du produit

| Invariant | Statut |
| --- | --- |
| Aucune commande de quarantaine sans `confirm: true` | Respecté (inchangé) |
| Aucune écriture hors du dossier de données / coffre | Respecté (inchangé) |
| Web Guard présenté comme proxy local, jamais comme filtrage global | Rappelé dans la spec UI et les maquettes |
| Pare-feu présenté comme lecture seule, jamais comme application de règles | Rappelé dans la spec UI et les maquettes |
| Aucun état « protégé » sans moteur temps réel | Rappelé dans la spec UI et les maquettes |
| Intrusion Guard sans blocage, injection ni mutation pare-feu | Verrouillé dans `SPRINT92_INTRUSION_GUARD.md` |
| Aucune télémétrie, aucun compte, aucune donnée sortante hors mises à jour | Respecté (inchangé) |

## 4. Risques résiduels issus de la QA

Les anomalies A1 à A7 du rapport natif ne sont **pas** corrigées dans 9.2 (elles nécessitent une décision ou un correctif hors périmètre QA). Elles sont tracées dans `SPRINT92_RISK_REGISTER.md`, avec la plus critique en tête :

- **A3** — `cbs-quarantine::store()` supprime le blob chiffré lorsque `remove_file(source)` échoue ; une disparition concurrente de la source détruit alors l'unique copie. Correctif proposé § 4.3 du registre, non appliqué.

## 5. Conclusion

La surface de sécurité n'a pas été élargie : pas de nouvelle commande Tauri, pas de nouveau processus externe, pas de nouvelle permission. Le code est identique à la base validée ; seules des livrables de documentation et de conception ont été ajoutés. L'artefact testé reste celui produit à `9b2c832`.
