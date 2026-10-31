# Sprint 9.3 — Persistance SQLite (A1)

**Version :** `0.9.0-dev` · **Branche :** `sprint-9.3`
**Date :** 2026-10-30
**Objet :** établir si l'application persiste réellement analyses, détections,
quarantaine et réglages, et verrouiller le comportement par des tests.

---

## 1. Périmètre vérifié

| Élément | Chemin |
| --- | --- |
| Base | `%LOCALAPPDATA%\Cybrense\CBS Shield\cbs-shield.db` |
| WAL / SHM | même dossier |
| Ouverture | `crates/cbs-store/src/lib.rs:222` (`Store::open`) |
| Configuration | `busy_timeout` 5 s, `foreign_keys=ON`, `journal_mode=WAL` |
| Version de schéma | `user_version = 2` |
| Écriture des analyses | `Store::save_scan` (`crates/cbs-store/src/lib.rs:268`) |

Toutes les écritures passent par une transaction unique protégée par un
`Mutex<Connection>` ; l'application n'ouvre qu'une connexion.

---

## 2. Constat initial (Sprint 9.2) et réfutation

Constat 9.2 : `cbs-shield.db-wal` figée à 94 792 o et
`mtime = 2026-10-28 07:43:36`, donc « aucune écriture SQLite ».

Réfutation mesurée le 2026-10-30 :

1. Instantané de la base **avant** analyse :
   - `cbs-shield.db` : 4 096 o (hash `89a2318c…8362`)
   - `cbs-shield.db-wal` : 94 792 o, mtime `2026-10-28T07:43:36`
2. Analyse rapide lancée depuis l'interface (249 fichiers, 21 détections).
3. `Get-Item` sur la WAL **après** analyse : taille et date identiques.
4. Copie brute `db + wal + shm` (script `vm93-dbexfil.ps1`), rejeu des frames :
   - WAL = **127 752 o**, **31 frames** (contre 23 avant) ;
   - `PRAGMA integrity_check` : `ok` ;
   - `scans` = **1** (`uuid d0e7eec8-d0b2-45bb-8adf-e166d428fc6a`,
     `2026-10-30T16:43:56Z`, 249 fichiers, 21 détections, `outcome=detected`) ;
   - `detections` = **21**.
5. Interface → « Historique des scans » : « 1 scan(s) affiché(s) sur 1 ».

**Cause :** NTFS ne rafraîchit pas les métadonnées de répertoire d'un fichier
maintenu ouvert et écrit via le cache. La connexion SQLite reste ouverte toute
la vie du processus ; la taille et la date observées restent donc figées alors
que des frames sont ajoutées. Ce n'est pas un défaut de persistance.

Preuves conservées :

- `target/sprint7-vm/inbox/20261030-173931-agent92out.txt` (copie base64) ;
- `target/sprint93-vmdb3/` (fichiers décodés, `reconstructed.db`) ;
- `target/sprint93-vmdb2/` (état avant analyse, 0 scan).

---

## 3. Test d'intégration reproductible

Fichier : `crates/cbs-store/tests/persistence.rs` (nouveau).

| Test | Ce qu'il prouve |
| --- | --- |
| `saved_scan_survives_close_and_reopen` | écrit un scan à UUID unique, **ferme** `Store`, rouvre le fichier, retrouve la ligne exacte et sa détection ; `integrity_check` = `ok` |
| `settings_and_quarantine_metadata_survive_reopen` | réglages + métadonnées de quarantaine relus après réouverture |
| `a_second_connection_sees_committed_rows_immediately` | une connexion brute voit la ligne commitée et `journal_mode = wal` |
| `reopening_keeps_a_single_schema_and_reports_the_version` | une seule table `scans`, `user_version = 2` après plusieurs ouvertures |

Exécution : `cargo test -p cbs-store --test persistence` → **4 passed**.

---

## 4. Vérifications complémentaires

- Migrations : `Store::migrate` applique le schéma si `user_version` est
  inférieur à 2, sans recréer de table existante.
- Concurrence : `busy_timeout` 5 s et `Mutex<Connection>` ; aucun accès
  concurrent interne. La garde mono-instance (A5) empêche un second processus.
- Quarantaine : la nouvelle ligne est d'abord écrite en statut `pending`, puis
  promue `active` — une interruption laisse donc toujours une trace exploitable.
- Erreurs silencieuses : `save_scan` renvoie l'erreur au frontend
  (`persistence_error`), affichée en notification d'erreur. Aucun `unwrap`.

Point restant, non bloquant : `PRAGMA journal_mode = WAL` ignore son erreur
(`let _ =`, `crates/cbs-store/src/lib.rs:250`). Si le mode WAL n'était pas
applicable, la base resterait en mode rollback sans perte de garanties. Le
comportement est conservé tel quel pour ne pas modifier la portée du sprint.

---

## 5. Procédure de diagnostic recommandée

Ne jamais juger une base sur la taille de sa WAL alors que l'application est
ouverte. Utiliser :

```sql
-- sur une copie cohérente
PRAGMA integrity_check;
SELECT count(*), max(started_at) FROM scans;
SELECT count(*), max(created_at) FROM detections;
SELECT count(*) FROM quarantine;
SELECT key, value FROM settings;
```

La copie doit être prise avec `sqlite3 .backup`, `VACUUM INTO` ou
`db + wal + shm` simultanément, puis rejouée. C'est la méthode utilisée dans
cette campagne.
