# Sprint 9.2 — Dossier de preuve final

**Version :** `0.9.0-dev`
**Branche :** `sprint-9.3`
**Livraison Sprint 9.2 :** commit `758199f`
**Correctifs de suivi 9.3 :** commit `74b24b3`
**Preuves versionnées :** commit `36e0eb6`
**Date de clôture :** 2026-10-31

> Ce dossier consolide ce qui a été **exécuté et observé**. Il ne remplace pas
> les rapports détaillés et n'élève aucun test non exécuté au rang de réussite.

---

## 1. État réel du sprint

Le Sprint 9.2 (QA native finale, récupération VM, concepts UI/UX, spécification
Intrusion Guard) est **livré et versionné** dans `758199f`. Cette passe de
clôture a :

1. vérifié que tous les livrables demandés existent ;
2. corrigé une preuve invalide (`docs/screenshots/02-antivirus.png`, PNG vide de
   147 octets) ;
3. versionné les captures réelles de la VM dans `docs/sprint92-screenshots/` ;
4. terminé et versionné les correctifs 9.3 issus des anomalies A1–A5/A7 ;
5. reconstruit l'installeur depuis l'état commité pour une provenance non
   ambiguë.

## 2. Artefacts et intégrité

| Artefact | Taille | SHA-256 | Version | Authenticode | Statut de validation |
|---|---:|---|---|---|---|
| Installeur **testé dans la VM** (Sprint 9.1) | 2 903 396 o | `d5a8b626a7797110aa8006f4ab69648a9a9f41581ba4bb08e32f33ae2f90b1fd` | 0.9.0-dev | NotSigned | Installé, mis à niveau et analysé dans la VM |
| Installeur **candidat reconstruit** (HEAD `36e0eb6`, code 9.3) | 2 919 189 o | `6ad6dcfdddf57d502142b12db6f5f78b865a56fc33c828b6fe7c70d9d0a92bfb` | 0.9.0-dev | NotSigned | **Construit + lancement fumée hôte uniquement — NON validé en VM** |
| Binaire de production | 8 164 864 o | non publié | 0.9.0-dev | NotSigned | Lancé sur l'hôte (`CBS Shield - Cybrense`) |

> **Ne pas confondre les deux installeurs.** Le SHA `d5a8…` est celui qui a été
> réellement testé dans la VM. Le SHA `6ad6…` correspond au code 9.3 et n'a pas
> encore été rejoué dans un environnement propre.

## 3. Tests et contrôles exécutés (2026-10-31)

| Contrôle | Résultat |
|---|---|
| `cargo test --workspace` | **136 réussis, 0 échec** |
| `cargo clippy --workspace --all-targets -- -D warnings` | Propre |
| `cargo fmt --all --check` | Propre |
| `npm --prefix ui run test` (vitest) | **37 réussis / 11 fichiers** |
| `npm --prefix ui run build` (tsc + Vite) | Propre |
| `npm run build` (Tauri release + NSIS) | Propre (3 min 22 s) |
| Lancement fumée du binaire release | Processus actif, fenêtre `CBS Shield - Cybrense` |

## 4. Vérifié (preuves)

- **Installeur** : créé, version `0.9.0-dev`, taille et SHA-256 relevés,
  Authenticode `NotSigned` documenté.
- **VM isolée** : installeur identique au bundle (hash contrôlé dans l'invité),
  mise à niveau `0.8.0-dev → 0.9.0-dev` réussie (`installer-sha-match=True`),
  ClamAV 1.5.4 provisionné, signatures à jour, analyse manuelle exécutée,
  interface FR, thème sombre.
- **Captures réelles** : `docs/sprint92-screenshots/` (9 images) avec provenance
  et limites explicites.
- **Concepts UI/UX** : deux directions complètes (5 écrans chacune, clair/sombre),
  bandeau « concept, non implémenté », dans `docs/sprint92-mockups/`.
- **Intrusion Guard** : architecture complète (sources, détection, faux
  positifs, notifications limitées, historique, confidentialité, statuts
  suspecté/confirmé/bloqué), dans `docs/SPRINT92_INTRUSION_GUARD.md`.
- **Registre des risques** : `docs/SPRINT92_RISK_REGISTER.md`.
- **Correctifs 9.3** : quarantaine atomique, tests de persistance, mono-instance,
  diagnostic TLS — tests unitaires verts.

## 5. Échecs constatés sur l'artefact 9.1 testé

| # | Constat | Correctif |
|---|---|---|
| A2/A3 | Mise en quarantaine sans blob conservé ; risque de perte de la seule copie | Corrigé dans le code 9.3 (`pending → active`, `SourceRetained`) — **non revalidé en VM** |
| A6 | État d'accueil stocké uniquement dans le profil WebView2 | Non corrigé |
| R1 | Installeur non signé (pas de certificat) | Non corrigé (décision/distribution) |

Les anomalies **A1** (persistance) et **A4** (signatures `.ndb`) ont été
requalifiées en **faux positifs de mesure/test** par les analyses 9.3, avec
preuves dans `SPRINT93_SQLITE_PERSISTENCE.md` et
`SPRINT93_SIGNATURE_REGRESSION.md`.

## 6. Bloqué (motif précis et preuve conservée)

1. **Revalidation VM des correctifs 9.3** : l'installeur doit être reconstruit
   (fait : `6ad6…`) puis rejoué dans la VM. La VM a été retrouvée en état
   `aborted` le 2026-10-31 à 11:20:35 (redémarrage/veille de l'hôte), avec
   `VBox.log` et `VBoxHardening.log` conservés. La chaîne de contrôle 9.2
   (HTTP `10.0.2.2`, agent, clavier, captures) existe et est réutilisable.
2. **Désinstallation** : non exécutée. Condition de sortie R2 du registre.
3. **Notifications natives** : non déclenchées (aucune détection réelle
   disponible sans affaiblir Defender).
4. **Menu du plateau** : icône observée, menu contextuel non rejoué.
5. **Cycle réel d'auto-analyse proactive** : non observé.
6. **Web Guard / Network Monitor / Firewall Monitor** : non rejoués cette
   session (validés antérieurement, notamment Sprint 8).

## 7. Non exécuté (aucune conclusion)

- Analyse complète et analyse personnalisée de bout en bout.
- Anglais complet sur les 11 écrans et thème clair sur tous les écrans.
- Audit d'accessibilité lecteur d'écran (Narrateur/NVDA), zoom 200 %.
- Parcours « ClamAV absent » (installation officielle, consentement, annulation).
- Signature `.ndb` malformée.
- Publication d'une version de production.

## 8. Décisions requises du propriétaire

1. **UI/UX** : choisir la direction A ou B (ou une variante) — aucune
   implémentation avant approbation explicite.
2. **Quarantaine** : politique de conservation/restauration/purge.
3. **Signature de code** : certificat Authenticode pour supprimer l'alerte
   SmartScreen.
4. **Intrusion Guard** : go/no-go sur l'architecture lecture seule.

## 9. Invariants de sécurité respectés

- Microsoft Defender et le pare-feu Windows sont restés **actifs**.
- Aucune exclusion Defender, aucune règle pare-feu modifiée.
- Aucun échantillon de malware réel ; seules des chaînes de test inoffensives
  (EICAR, jetons texte) ont été utilisées.
- Aucune modification DNS système.
- Aucun contournement d'authentification Windows, aucune modification de la
  virtualisation ou de la sécurité de l'hôte.
- Aucun push distant.

## 10. Conditions de sortie vers une 0.9.0 « production »

1. Rejouer la matrice native complète dans une VM propre avec l'installeur
   `6ad6…` (ou un descendant) : quarantaine, restauration, purge, persistance
   après redémarrage, désinstallation, mise à niveau.
2. Obtenir un certificat et signer l'installeur ; publier le SHA-256.
3. Décider et implémenter la politique de quarantaine.
4. Approuver une direction UI avant toute refonte.
5. Documenter explicitement les limites (pas de temps réel, proxy loopback,
   pare-feu en lecture seule, Intrusion Guard non implémenté).
