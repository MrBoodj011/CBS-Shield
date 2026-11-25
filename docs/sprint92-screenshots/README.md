# Sprint 9.2 — Captures réelles de l'application installée (VM)

Ces images proviennent de la **VM isolée** `CBS-Shield-Sprint7`
(Windows 11 Enterprise Evaluation 26100, 1024×768 @ 125 %, utilisateur `cbs`),
avec l'installeur `CBS Shield_0.9.0-dev_x64-setup.exe`
(SHA-256 `d5a8b626a7797110aa8006f4ab69648a9a9f41581ba4bb08e32f33ae2f90b1fd`).

Elles sont copiées depuis `target/sprint7-vm/http/` (répertoire de travail non
versionné) pour être conservées avec le dépôt. Aucun outil de développement
n'est installé dans l'invité ; l'interface est celle du binaire de production.

| Fichier | Ce que montre la capture | Statut honnête |
|---|---|---|
| `01-dashboard-engine-absent.png` | Tableau de bord FR, moteur détecté comme absent avant provisionnement ; bandeau « préparation non terminée » | Réel — état transitoire |
| `02-antivirus-fr.png` | Page Antivirus FR, `ClamAV 1.5.4`, signatures « À jour », onglet Rapide | Réel |
| `03-scan-running.png` | Analyse rapide en cours (compteurs fichiers) | Réel |
| `04-scan-results.png` | Onglet Résultats après analyse | Réel |
| `05-quarantine-empty.png` | Page Quarantaine FR, coffre `0 actif` | Réel — la mise en quarantaine a échoué en 9.2 (A2/A3) |
| `06-quarantine-dialog.png` | Dialogue de confirmation de mise en quarantaine | Réel |
| `07-upgrade-080-to-090.png` | Console invitée : mise à jour `0.8.0-dev` → `0.9.0-dev`, `installer-sha-match=True`, `post-version=0.9.0-dev` | Réel — preuve de mise à niveau |
| `08-custom-signature-false-positives.png` | Résultats d'analyse avec signature de test **trop large** (`ABCDEF`) : faux positifs sur des binaires ClamAV | Réel — illustre un test invalide, pas un défaut produit (voir `SPRINT93_SIGNATURE_REGRESSION.md`) |
| `09-notification-area.png` | Zone de notification Windows avec l'icône CBS Shield ; menu système ouvert | Partiel — le menu contextuel de l'application n'a pas été rejoué |

## Ce que ces captures ne prouvent pas

- Elles ne prouvent pas la mise en quarantaine, la restauration ou la purge
  (échec 9.2, correctifs 9.3 non revalidés dans la VM).
- Elles ne prouvent pas les notifications natives ni le menu du plateau.
- Elles ne prouvent pas le thème clair ni l'anglais sur tous les écrans.
- Elles ne remplacent pas une campagne de désinstallation / persistance après
  correctifs.

Les captures de concepts UI sont séparées, dans `docs/sprint92-mockups/`, et
sont **étiquetées comme concepts** — elles ne représentent pas l'application
actuelle.
