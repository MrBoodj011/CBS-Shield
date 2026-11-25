# Sprint 9.3 — Analyse des causes racines (A1 – A7)

**Version :** `0.9.0-dev` · **Base :** commit `758199f` (Sprint 9.2)
**Branche :** `sprint-9.3`
**Date :** 2026-10-30
**Méthode :** toute conclusion ci-dessous s'appuie sur un fichier, une requête
SQLite ou une sortie de commande conservée dans `target/`. Une capture d'écran
n'est jamais utilisée comme preuve unique.

---

## A1 — « Aucune écriture SQLite »

### Verdict : **faux positif de mesure** — la persistance fonctionne

Le constat 9.2 reposait sur la taille et le `LastWriteTime` de
`cbs-shield.db-wal` observés pendant que l'application tenait la base ouverte.
Or Windows (NTFS) ne rafraîchit pas ces métadonnées de répertoire de façon
fiable tant que le handle reste ouvert et que le cache d'écriture n'est pas
vidé. L'application garde la connexion ouverte pendant toute sa durée de vie :
la WAL grossit sans que `Get-Item` ne voie ni la nouvelle taille ni la nouvelle
date.

### Preuves

| # | Observation | Résultat |
| ---: | --- | --- |
| 1 | AVANT analyse : `cbs-shield.db-wal` = 94 792 o, mtime `2026-10-28 07:43:36` | état 9.2 reproduit |
| 2 | Analyse rapide native lancée depuis l'UI (249 fichiers, 21 détections) | terminée, résultat affiché |
| 3 | Pendant et après l'analyse : mêmes taille/mtime via `Get-Item` | **inchangés** (métadonnées figées) |
| 4 | Copie brute `db + wal + shm` puis rejeu des frames côté hôte | WAL = **127 752 o, 31 frames** (contre 23 avant) |
| 5 | `PRAGMA integrity_check` sur la base reconstruite | `ok` |
| 6 | `SELECT count(*) FROM scans` / `FROM detections` | **1 scan** (`d0e7eec8-…`), **21 détections** |
| 7 | Onglet « Historique des scans » de l'application | « 1 scan(s) affiché(s) sur 1 » |

Fichiers de preuve : `target/sprint7-vm/inbox/20261030-173931-agent92out.txt`
(copie base64), `target/sprint93-vmdb3/` (copie décodée + `reconstructed.db`).

### Pourquoi le constat 9.2 semblait cohérent

- La VM avait été restaurée entre deux campagnes ; la base observée ne
  contenait alors que la ligne de référence pare-feu du 28/10.
- Le compteur de rafraîchissement UI des métadonnées ne bougeait pas, ce qui
  donnait l'illusion d'une base inerte.
- Aucun contrôle SQL direct n'avait été fait avant la conclusion.

### Conséquences pour le sprint

- Aucun correctif de persistance n'est nécessaire : le défaut n'existe pas.
- Une suite d'intégration reproductible a été ajoutée pour verrouiller le
  comportement (`crates/cbs-store/tests/persistence.rs`, 4 tests) : écriture
  d'un scan à UUID unique, fermeture complète de la connexion, réouverture,
  lecture du scan exact, `PRAGMA integrity_check`, visibilité immédiate depuis
  une seconde connexion.
- Recommandation de diagnostic : ne jamais conclure sur la taille d'une WAL
  d'un fichier ouvert. Utiliser une copie cohérente (`sqlite3 .backup`,
  `VACUUM INTO`, ou copie db+wal+shm suivie d'un rejeu) puis interroger la base.

---

## A2 — Coffre vide alors que le fichier source a disparu

### Verdict : **partiellement reproduit en 9.2, corrigé par conception en 9.3**

En 9.2, aucun `*.cbsq` n'existait et aucune ligne de quarantaine n'était
visible. Le parcours n'avait pas été rejoué après la correction de A1 ; il
n'existe donc pas de preuve que la mise en quarantaine elle-même échouait.
L'ancien `store()` présentait toutefois un risque réel de perte de la seule
copie (voir A3), et un fichier source verrouillé laissait un blob sans ligne
de métadonnées.

Correctifs 9.3 :

- écriture du blob **avant** toute suppression, avec `sync_all` puis vérification
  par déchiffrement et SHA-256 ;
- ligne SQLite créée en statut `pending` **avant** la suppression de la source ;
- promotion `pending → active` seulement après suppression réussie ;
- `SourceRetained` (fichier verrouillé) conserve le blob et laisse la ligne
  `pending` visible, donc récupérable.

Validation native : `docs/SPRINT93_QUARANTINE_VALIDATION.md`.

---

## A3 — `store()` détruit le blob quand `remove_file` échoue

### Verdict : **confirmé par lecture du code, corrigé, régression testée**

Ancien comportement : tout échec de `fs::remove_file(source)` déclenchait la
suppression du blob chiffré qui venait d'être écrit — y compris `NotFound`
(source déjà retirée par un antivirus concurrent).

Nouveau comportement (`crates/cbs-quarantine/src/lib.rs`) :

- `stage()` produit le blob sans toucher à la source ;
- `commit()` vérifie l'intégrité du blob, puis supprime la source ;
- `NotFound` = succès (la source n'existe plus) ;
- autre erreur = `SourceRetained`, le blob reste sur disque et la ligne reste
  `pending` ;
- `store()` ne supprime le blob que si le chiffrement ou la vérification
  échoue, jamais parce que la source est verrouillée.

Tests de non-régression (crate `cbs-quarantine`, 14 tests dont 5 nouveaux) :

| Test | Cas couvert |
| --- | --- |
| `stage_leaves_the_source_untouched` | aucune suppression à l'étape blob |
| `commit_treats_a_vanished_source_as_success` | source disparue ⇒ succès |
| `locked_source_is_retained_and_blob_preserved` | partage Windows refusé ⇒ blob conservé, source intacte, restauration possible |
| `commit_refuses_when_the_blob_is_missing_or_corrupted` | blob corrompu ⇒ refus |
| `concurrent_stores_are_serialized_and_leave_no_temp_files` | 8 threads, 8 blobs, 0 `.tmp` |

---

## A4 — Signature personnalisée « non appliquée » par le scan intégré

### Verdict : **faux positif de test** — les signatures personnalisées sont appliquées

La signature 9.2 était `CBS_Test_Synthetic:0:*:414243444546`, c'est-à-dire
« tout fichier contenant les octets `ABCDEF` n'importe où ». Elle est
extrêmement large et n'a pas de cible précise ; les fixtures 9.2 contenaient
aussi EICAR, souvent rapporté en premier par ClamAV.

Test 9.3 avec une signature discriminante :

- `custom.ndb` = `CBS93_Synthetic:0:*:43425339332d53594e5448` (jeton
  `CBS93-SYNTH`) ;
- fixture `C:\Users\cbs\Desktop\cbs93-precise.txt` (texte inoffensif) ;
- **CLI directe** : `cbs93-precise.txt: CBS93_Synthetic.UNOFFICIAL FOUND` ;
- **Scan intégré (onglet Antivirus, profil Rapide)** : même nom de détection
  remonté pour le même fichier, plus le script de test qui contient le jeton.

Conclusion : la construction de la commande (`--database=<dir>`) et le
traitement des sorties fonctionnent. Le constat 9.2 ne doit pas être requalifié
en défaut produit. Voir `docs/SPRINT93_SIGNATURE_REGRESSION.md`.

---

## A5 — Absence de garde mono-instance

### Verdict : **confirmé, corrigé**

`tauri-plugin-single-instance` est enregistré **en premier** dans
`src-tauri/src/lib.rs`. Un second lancement transmet ses arguments à
l'instance existante, restaure et focalise la fenêtre principale, puis le
nouveau processus se termine : un seul propriétaire pour la base, le worker
proactif et le coffre.

Validation native : second lancement observé, un seul processus subsistant,
fenêtre existante ramenée au premier plan.

---

## A6 — État d'accueil stocké uniquement dans le profil WebView2

### Verdict : **inexact** — l'état est déjà persisté en SQLite

- `SetupWizard.tsx:435` appelle `persist({ onboardingCompleted: true })` ;
- `src-tauri/src/commands/settings.rs:193` écrit la clé `onboardingCompleted`
  dans la table `settings` ;
- `ui/src/App.tsx:211` relit ce champ depuis `get_settings`.

L'assistant réapparaît si l'utilisateur a choisi « Configurer plus tard » ou
fermé la fenêtre : aucune ligne n'a alors été écrite. La base de la VM 9.2 ne
contenait effectivement aucune clé `onboardingCompleted`, ce qui explique le
constat — ce n'était pas un stockage WebView2.

Vérification 9.3 : achever l'assistant, fermer l'application, la relancer :
l'assistant ne revient pas et la clé apparaît dans `settings`.

---

## A7 — Horloge invitée décalée / erreurs TLS FreshClam

### Verdict : **décalage de fuseau, pas de dérive d'horloge**

- Fuseau invité : *Pacific Standard Time* (`-07:00`) ; hôte : UTC+1.
- Heure **UTC** comparée au même instant : écart ≤ 2 min (agent :
  `2026-10-30T09:41:23-07:00` = `16:41:23Z`).
- `freshclam` a téléchargé les bases le 30/10 à 08:26 heure invitée sans erreur
  TLS, ce qui confirme que la validation X.509 n'est pas affectée.

Amélioration 9.3 : la classification des échecs FreshClam nomme désormais la
cause TLS (« certificat refusé : vérifiez l'heure et le fuseau ») au lieu de
la rattacher au réseau. **La vérification TLS n'est jamais désactivée.**
Test unitaire : `commands::engine::tests::classifies_tls_certificate_failure_with_clock_hint`.

---

## Synthèse

| Réf. | Statut 9.3 | Nature |
| --- | --- | --- |
| A1 | Corrigé = faux positif de mesure ; persistance prouvée | Instrumentation |
| A2 | Flux refondu, blob toujours conservé | Correctif |
| A3 | Correctif + 5 tests de non-régression | Correctif |
| A4 | Faux positif de test, détection confirmée | Méthodologie |
| A5 | Plugin single-instance actif | Correctif |
| A6 | Déjà persistant en SQLite ; documentation corrigée | Documentation |
| A7 | Fuseau horaire, UTC correct ; diagnostic TLS enrichi | Environnement + diagnostic |
