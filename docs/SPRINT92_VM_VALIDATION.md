# Sprint 9.2 — Validation VM (récupération et QA native)

**Version testée :** `0.9.0-dev` (HEAD `9b2c832`)
**VM :** `CBS-Shield-Sprint7` — VirtualBox 7.2.22 r175245, Windows 11 Enterprise Evaluation
26H2 (build 26100.26100), 1024×768 à **125 % de mise à l'échelle**, utilisateur `cbs`.
**État initial :** VM allumée mais inaccessible (session RDP refusée, capture noire).
**État final :** VM allumée, application installée et pilotée.

> Ce rapport ne consigne que ce qui a été **exécuté et observé**. Aucun test non
> exécuté n'est présenté comme réussi. Les points bloqués sont listés au §6.

---

## 1. Récupération de l'accès (priorité P1)

### 1.1 Ce qui bloquait

Sprint 9.1 s'était arrêté sur « validation VM bloquée ». Les causes réelles, une
fois rouvertes, n'étaient pas l'absence d'accès disque mais trois défauts de la
chaîne de contrôle :

| Symptôme | Cause réelle |
|---|---|
| Captures `screenshotpng` noires (2 367 octets) | écran invité en veille ; un scancode inerte suffit à réveiller l'affichage |
| Clics systématiquement décalés de 25 % vers le bas-droite | `SetCursorPos` en coordonnées logiques alors que l'invité est à 125 % |
| Commandes invité perdues / rejouées | agent relançait un enfant non tuable ; file d'attente sans historique |

### 1.2 Chaîne de contrôle reconstruite (sans contourner aucune sécurité)

- **Transport** : serveur HTTP hôte `python -m http.server 8000` dans
  `target/sprint7-vm/http/`, consommé par l'invité via la passerelle NAT
  `10.0.2.2`. Collecteur `collector92.py` sur `:8002` qui archive chaque
  exécution dans `target/sprint7-vm/inbox/` (horodatée, jamais écrasée).
- **Agent invité** (`http/agent92.ps1`) : boucle unique protégée par un mutex
  nommé, garde anti-récursion, exécution dans un **enfant tuable** avec délai
  maximal de 900 s, horodatage de la commande *avant* exécution pour éviter tout
  rejeu après redémarrage.
- **Souris** (`http/click92.ps1`) : `SetProcessDPIAware()` puis `SetCursorPos` +
  `mouse_event` en pixels physiques ; support molette. Après ce correctif, tous
  les clics ont porté sur la cible visée.
- **Clavier** : `VBoxManage controlvm keyboardputscancode` (aucune saisie de
  secret, aucun contournement d'authentification).
- **Redémarrage du mode d'affichage** : uniquement après accord explicite du
  propriétaire (`startvm --type gui`). Aucun réglage d'hyperviseur, de réseau
  ou de sécurité de l'hôte n'a été modifié.

### 1.3 Conformité aux contraintes

| Contrainte | Respect |
|---|---|
| Ne pas contourner l'authentification Windows | Respecté — session invité déjà ouverte, aucun credential forcé |
| Ne pas modifier la virtualisation / sécurité de l'hôte | Respecté |
| Ne pas désactiver Defender ni le pare-feu ni ajouter d'exclusion | Respecté — aucune commande de ce type exécutée |
| Fixtures inoffensives uniquement | Respecté — EICAR de test + fichiers texte `ABCDEF` |
| Aucun test non exécuté déclaré réussi | Respecté — voir §6 |

---

## 2. Intégrité de l'artefact installé

| Contrôle | Résultat | Preuve |
|---|---|---|
| Installeur présent dans l'invité | `C:\Users\cbs\AppData\Local\Temp\CBS-Shield-0.9.0-dev-setup.exe` | probe `vm92-exestr.ps1` |
| SHA-256 de l'installeur invité | `D5A8B626A7797110…` | idem |
| SHA-256 du bundle du dépôt | `d5a8b626a7797110aa8006f4ab69648a9a9f41581ba4bb08e32f33ae2f90b1fd` | `sha256sum` hôte |
| **Conclusion** | **identique — l'artefact installé est bien le 0.9.0-dev exact du dépôt** | |
| `FileVersion` / `ProductVersion` de `cbs-shield.exe` | `0.9.0-dev` / `0.9.0-dev` | probe `vm92-exe.ps1` |
| Taille de `cbs-shield.exe` installé | 8 125 952 octets (= binaire hôte) | idem |

---

## 3. Provisionnement ClamAV (validé)

L'application livrée ne **redistribue pas** ClamAV ; elle télécharge le ZIP
officiel épinglé. Le téléchargement a été réalisé dans l'invité depuis
l'URL épinglée du code.

| Contrôle | Attendu (code) | Observé |
|---|---|---|
| Archive | `clamav-1.5.4.win.x64.zip` | `…\clamav\downloads\clamav-1.5.4.win.x64.zip` |
| Taille | 225 774 978 octets | **225 774 978** |
| SHA-256 | `0d9e0228b2674137ea1a2853566c98a0278ad52ab2582c3d6dbd75373848c395` | **conforme** (vérifié avant extraction) |
| Moteur | `clamav\portable\clamscan.exe` | présent, chargé par l'application |
| Base | `clamav\database\{main,daily,bytecode}.cvd` | 89 072 577 / 23 447 608 / 281 702 octets |
| Signature de test | `custom.ndb` = `CBS_Test_Synthetic:0:*:414243444546` | présent |

Les constantes proviennent de `src-tauri/src/commands/signatures.rs:23-28` et
n'ont pas été réécrites : le script de provisionnement les reprend à l'identique.

---

## 4. Mise à jour des signatures (`freshclam`) — anomalie levée

**Séquence observée :**

1. `07:52` — l'application génère `freshclam.conf` (`DatabaseMirror
   database.clamav.net`, `Checks 1`) puis lance `freshclam`.
2. `07:52 → 08:00` — échec répété, consigné dans `clamav\freshclam.log` :

   ```
   ERROR: Download failed (60) ERROR:  Message: SSL peer certificate or SSH remote key was not OK
   ERROR: Can't download daily.cvd from https://database.clamav.net/daily.cvd
   ERROR: Update failed for database: daily
   ```

   Un répertoire temporaire `database\tmp.1387864dd6\` (206 207 octets) reste
   comme trace de l'échec.
3. `08:26` — même binaire, même configuration, **relance manuelle** :
   `freshclam --config-file=… --stdout --verbose` → **code de sortie 0**, les
   fichiers `main-63.cvd.sign`, `daily-28169.cvd.sign`,
   `bytecode-339.cvd.sign` sont téléchargés, puis `daily/main/bytecode already
   up-to-date`.

**Interprétation :** l'échec `curl 60` n'est **pas** un blocage permanent du
produit. Il coïncide avec une dérive d'horloge de l'invité (voir A7) ; les
validations TLS échouent de façon transitoire quand l'horloge saute. Le
comportement correct du produit serait de remonter ce cas comme une erreur
réseau/TLS explicite avec l'horloge de l'invité, au lieu d'un message opaque.

**Statut :** mise à jour des signatures **validée** ; la robustesse du message
d'erreur reste un axe d'amélioration (§6, R2).

---

## 5. Analyse en mémoire — validée

Analyse **lancée depuis l'interface** (bouton « Lancer l'analyse », onglet
Rapide), cibles par défaut : Téléchargements, Bureau, Documents, Temp,
démarrage.

| Contrôle | Observé |
|---|---|
| Démarrage depuis l'UI | oui — panneau « Analyse en cours » avec compteurs |
| Fin d'analyse | oui — rapport « Terminé », `CVD 1.0.3628246` |
| Fichiers analysés | 145 |
| Erreurs | 0 |
| Détections | 1 — `Eicar-Test-Signature` |
| Corroboration hors capture | `cbs-shield.db-shm` touché à 08:43:26 (ouverture de la base à la fin d'analyse) |

L'analyse est donc réelle et l'interface affiche un statut honnête
(« La détection est une information, pas une action : aucun fichier n'a été
déplacé ou supprimé »).

---

## 6. Anomalies — constat ferme

Les points ci-dessous sont établis par inspection du système de fichiers ou
lecture du code, **pas** par lecture d'écran.

### A1 — Aucune persistance SQLite pendant la session (bloquant)

| Fichier | Taille | Dernière écriture |
|---|---|---|
| `cbs-shield.db` | 4 096 o | 2026-10-28 07:43:23 |
| `cbs-shield.db-wal` | 94 792 o | **2026-10-28 07:43:36** |
| `cbs-shield.db-shm` | 32 768 o | 2026-10-30 09:15:18 |

La taille du WAL est **restée strictement identique** après : un redémarrage
complet de l'application (09:15), une analyse terminée (08:43) et l'ouverture
de la surveillance réseau. Une base SQLite en mode WAL n'enregistre rien si le
WAL ne grossit pas.

Les causes d'environnement sont écartées : l'utilisateur `cbs` possède
`FullControl` sur le répertoire, l'écriture d'un fichier de sonde réussit, et
l'ouverture en lecture/écriture partagée du WAL réussit.

**Conséquence :** historique d'analyses, quarantaine et paramètres ne sont pas
persistés ; l'interface peut afficher des résultats qui disparaîtront au
redémarrage.

### A2 — Le coffre de quarantaine n'est jamais écrit (bloquant)

Après une mise en quarantaine déclenchée depuis l'interface :

- recherche de `*.cbsq` sur **tout `C:\`** : **aucun résultat** ;
- `…\CBS Shield\quarantine\` : vide, `mtime = 2026-10-28 07:43:22` (jamais
  écrite) ;
- `C:\Users\cbs\Documents\cbs-eicar-check.txt` : **absent du disque**.

Qui a supprimé le fichier n'est pas déterminé : `Get-MpThreatDetection` ne
renvoie aucune menace, mais la commande n'est pas fiable sans élévation.
L'anomalie A3 (défaut de code) rend ce scénario plausible sans qu'il soit
prouvé.

### A3 — `store()` détruit la seule copie en cas d'échec de suppression (défaut de code)

`crates/cbs-quarantine/src/lib.rs:195-198` :

```rust
if let Err(err) = fs::remove_file(source) {
    let _ = fs::remove_file(&stored_path);   // supprime le blob chiffré
    return Err(err.into());
}
```

Si la suppression de la source échoue pour **n'importe quelle** raison —
y compris `NotFound` provoqué par un antivirus tiers ayant traité le fichier
entre la lecture et la suppression — le blob chiffré (désormais la seule copie
existante) est supprimé. Le fichier est alors perdu définitivement.
Le cas `NotFound` doit conserver le blob et signaler un état intermédiaire.

### A4 — Les signatures `.ndb` personnalisées ne sont pas appliquées (majeur)

`custom.ndb` est présent dans le répertoire de base et la signature
`CBS_Test_Synthetic` fonctionne en appel direct
(`clamscan -r --database=<dir>` → détection confirmée). Deux fixtures texte
inoffensives contenant `ABCDEF`, placées sur le Bureau (cible de l'analyse
rapide), **n'ont pas été détectées** par l'analyse de l'application ; seule la
fixture EICAR l'a été.

L'analyse intégrée ne charge donc pas les signatures `.ndb` du répertoire de
base, ou ne parcourt pas ces chemins.

### A5 — Aucune garde mono-instance (majeur)

`src-tauri/Cargo.toml` ne déclare que `tauri-plugin-dialog` et
`tauri-plugin-notification`. Aucun plugin mono-instance, aucun mutex
applicatif. Deux instances peuvent ouvrir simultanément la même base et le
même coffre.

### A6 — L'état d'accueil ne vit que dans le stockage WebView2 (mineur)

Le renommage de `%LOCALAPPDATA%\com.cybrense.cbsshield` fait réapparaître
l'assistant en **étape 1/5**. L'achèvement de l'accueil n'est donc pas stocké
dans la base de l'application : il est perdu avec le profil WebView2.

### A7 — Dérive d'horloge de l'invité (environnement)

L'invité a rapporté `2026-10-30 09:09 -07:00` alors que l'hôte était à ~16:09.
L'écart constant de −7 h explique les échecs TLS transitoires de `freshclam`
(§4). À corriger dans l'image VM, pas dans le produit.

---

## 7. Ce qui reste bloqué

| Élément de la matrice P1 | Statut | Motif |
|---|---|---|
| Installation de l'installeur | **Validée** | installeur identique + app fonctionnelle |
| Provisionnement ClamAV | **Validé** | §3 |
| Mise à jour des signatures | **Validée** (après reprise) | §4 |
| Analyse depuis l'UI | **Validée** | §5 |
| Mise en quarantaine | **Échouée** | A1, A2, A3 |
| Restauration / purge | **Non exécutable** | dépend de A1/A2 |
| Persistance après redémarrage OS | **Non exécutée** | dépend de A1 |
| Mise à niveau en place | **Non exécutée** | reportée après correction de A1 |
| Désinstallation silencieuse | **Non exécutée** | reportée après correction de A1 |

---

## 8. Index des preuves

Dans `target/sprint7-vm/` :

| Élément | Fichier |
|---|---|
| Captures analyse (départ, fin, rapport) | `http/s8-running.png`, `http/s9-results.png` |
| Capture page Quarantaine vide | `http/s5-quarantine-page.png` |
| Dialogue de confirmation | `http/s3-dialog.png` |
| Journal d'échec puis de succès `freshclam` | `…\clamav\freshclam.log` (relevé dans `inbox/*agent92out.txt`) |
| Recherche disque `*.cbsq` | `inbox/*-agent92out.txt` (sonde `vm92-disk.ps1`) |
| État base SQLite | sonde `vm92-walcheck.ps1`, `vm92-acl.ps1` |
| Hash installeur invité | sonde `vm92-exestr.ps1` |

Les scripts de sonde sont conservés dans `target/sprint7-vm/http/` et sont
rejouables tels quels.

> Anomalies A1–A7, gravités et conditions de sortie : `docs/SPRINT92_RISK_REGISTER.md`.
> Régression de sécurité de ce sprint : `docs/SPRINT92_SECURITY_REGRESSION.md`.
