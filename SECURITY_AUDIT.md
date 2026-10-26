# Audit de sécurité — CBS Shield (sprint 2, Phase 2)

**Date :** 25 octobre 2026
**Périmètre :** phase 1 (base `9a735e0`) auditée puis corrigée sur la branche `sprint-2`.
**Méthode :** lecture complète du code backend (crates + `src-tauri`), revue des
entrées IPC, revue des accès système (ClamAV, DPAPI, SQLite, IP Helper, COM), puis
correction immédiate de chaque constat avec un test qui l'atteste. Aucun malware
réel n'a été utilisé.

Chaque constat ci-dessous indique : sévérité, cause, correction, preuve.

---

## Constats et corrections

### A-1. (Critique) Gardes de chemins `canonicalize()` jamais effectives sous Windows

**Cause.** Sous Windows, `std::fs::canonicalize()` renvoie un chemin **verbatim**
préfixé `\\?\` (ex. `\\?\C:\Users\…`). Tous les gardes de la Phase 1 comparant
`canonicalize().starts_with(chemin_sans_prefixe)` ne correspondaient donc
**jamais** : la garde « interdire la mise en quarantaine d'un fichier du coffre ou
du répertoire de données » était morte en production, sans erreur apparente ni
écrasement de fichier. Un test réel (mis en place pendant le sprint) le confirme
empiriquement : deux chemins identiques, l'un verbatim, l'autre non, ne se
comparent jamais égaux.

**Correction.**

- `src-tauri/src/paths.rs` : `AppPaths::canonicalized()` supprime le préfixe
  `\\?\` après canonicalisation ; les racines (coffre, données, signatures) sont
  canonisées une fois au démarrage. Le chemin de substitution d'environnement
  passe par `std::path::absolute` (résolution cohérente, sans résolution symbolique).
- `src-tauri/src/commands/vault.rs` : ajout de `normalized_path()` (canonicalisation
  + retrait `\\?\`) et de `is_inside()` (comparaison préfixe insensible à la casse
  avec séparation de composants) ; `validate_source` et `validate_restore_destination`
  les utilisent systématiquement.
- Nouvelle garde `validate_restore_destination(vault, data_dir, destination)` : la
  restauration refuse tout chemin **dans le coffre** (ni écrasement de blob,
  ni écriture par un chemin détourné), **dans le répertoire de données de
  l'application** (SQLite, réglages, signature de clé), une racine de lecteur ou
  un chemin inexistant. La restauration vers l'origine reste valide ; les fichiers
  du répertoire de données (ex. une base de réglages) ne sont plus des destinations
  acceptées.

**Preuve.** 5 tests de `vault.rs`, dont : gardes `\\?\` explicites (fichier du
coffre, racine de données, répertoire `settings`), refus présent seulement depuis
la correction (échec vérifié avant correctif), raccourcis verbatim dans les
arguments de restauration. `cargo test -p cbs-shield` : 12/12.

### A-2. (Élevé) Sonde de version ClamAV sans limite de temps

**Cause.** `probe_version` attendait la fin d'un processus enfant `clamscan
--version` **sans timeout**. Un moteur coincé (anti-virus tiers, lecteur réseau
suspendu…) bloquait indéfiniment l'interface et le thread de diagnostic.

**Correction.** `crates/cbs-core/src/engine.rs` : nouvelle fonction
`execute_with_timeout` — lecture non bloquante des sorties + `try_wait` en
polling avec échéance `PROBE_TIMEOUT` ; au-delà, le processus est tué et l'erreur
retournée est explicite (« délai dépassé »), jamais un blocage.

**Preuve.** Test unitaire avec un faux binaire qui dort au-delà du délai :
le helper abandonne près de l'échéance, pas après la fin de l'enfant.

### A-3. (Élevé) Aucun verrou entre scan et mise à jour de signatures

**Cause.** Un `freshclam` lancé pendant un scan Recoit/écrit dans le dossier de
signatures pendant que `clamscan` lit la même base : source d'échecs aléatoires
de scan, indécryptable pour l'utilisateur.

**Correction.** `src-tauri/src/commands/engine.rs` : `update_signatures` refuse
avec un message clair tant que `state.is_scanning()` ; la classification du run
de mise à jour est faite par `summarize_update_run`, une **fonction pure**, qui
distingue : base déjà à jour, base mise à jour, échec réseau, échec d'écriture
dans le dossier de signatures, interruption par délai (`PROBE_TIMEOUT` échéance
30 min, kill propre).

**Preuve.** 6 tests unitaires sur `summarize_update_run` (chacune des classes
ci-dessus + refus pendant scan).

### A-4. (Moyen) Buffers de lecture des sorties de `clamscan` non bornés

**Cause.** Les tâches de lecture stdout/stderr de `scan.rs` accumulaient une
ligne sans limite mémoire ; une sortie corrompue (moteur bogué, disque plein)
pouvait saturer la mémoire du poste.

**Correction.** Chaque ligne est plafonnée à `MAX_LINE_BYTES` (64 Ko) : au-delà,
l'événement est tronqué puis la ligne se termine avec une **erreur explicite**
(troncation enregistrée dans le rapport), le tampon est réinitialisé, le scan
se poursuit.

**Preuve.** Lecture du code + revue des limites ; comportement testé via les
tests de parsing existants (les lignes normales restent intactes).

### A-5. (Moyen) Orphelins `.tmp` après crash de mise en quarantaine

**Cause.** Le stockage chiffre d'abord dans `.<id>.tmp` puis renomme ; un crash
ou une coupure entre les deux laissait un blob orphelin jamais listé, jamais
supprimé (fuite disque silencieuse dans le coffre).

**Correction.** `crates/cbs-quarantine/src/lib.rs` : `ensure_layout()` purge
désormais les `.<hex uuid>.tmp` présents. Les orphelins ne sont ni listés dans
l'audit ni restaurables (ils n'ont pas d'enregistrement).

**Preuve.** Test `stale_temp_blobs_are_cleaned_on_layout_ensure` : blob orphelin
écrit à la main, `ensure_layout` le supprime, les blobs légitimes restent.

### A-6. (Moyen) Schéma de base sans chemin de migration

**Cause.** La Phase 1 n'avait qu'un schéma v1. L'ajout de `netmon_snapshots`
(sprint 2) aurait exigé un choix : écraser la base utilisateur (perte d'historique)
ou laisser une base incompatible.

**Correction.** `cbs-store` passe à `SCHEMA_VERSION = 2` : `PRAGMA user_version`
est lu ; une base v1 est migrée (`CREATE TABLE netmon_snapshots…`) **sans perte**
; une base plus récente est détectée et refusée proprement. Rétention : 2 000
lignes (`NETMON_SNAPSHOT_RETENTION`), purge par insertion.

**Preuve.** Test de migration `LEGACY_V1_SCHEMA_SQL` → v2 : l'historique Phase 1
reste lisible après migration ; 7 tests store au total.

### A-7. (Moyen) Fichier illisible ≠ échec opaque

**Cause.** `clamscan` signale les fichiers inaccessibles sur **stderr** sous forme
d'avertissements (`LibClamAV Warning: Can't open file \\?\…: 32`), pas dans le
flux stdout parsé. Un dossier contenant un fichier verrouillé produisait
l'issue `failed` sans explication, alors que le reste du dossier a été analysé.

**Correction.** `crates/cbs-core/src/scan.rs` :
- nouvelle fonction pure `extract_file_errors(stderr_text)` : conversion des
  avertissements en `ScanErrorRecord { path, message }` (préfixe `\\?\` retiré,
  dédoublonnage, plafond aux erreurs stockées) ;
- la logique d'issue distingue désormais `completedWithErrors` (le scan s'est
  déroulé, mais N fichiers sont restés inaccessibles et sont nommés) de `failed`
  (aucun fichier analysé, aucune erreur par fichier — vrai échec fatal : code 2
  sans stdout exploitable, délai, etc.).

**Preuve.** Test réel `locked_file_reported_as_error_not_crash` (mission E) :
fichier verrouillé via `share_mode(0)`, la base ClamAV réelle renvoie
`CompletedWithErrors` avec le chemin `locked.bin` explicite, 0 détection, et le
processus de scan ne plante pas. 3 tests unitaires du parseur stderr.

### A-8. (Faible/Élevé au moment de l'usage) Constante `NET_FW_PROFILE2_PUBLIC` erronée

**Cause.** Le code COM direct du sprint 2 utilisait `PROFILE_TYPE_PUBLIC = 0x3`
au lieu de **0x4** (msdn `NET_FW_PROFILE_TYPE2` : domaine 0x1, privé 0x2,
public 0x4). `get_DefaultInboundAction(0x3)` échoue, et la lecture en cascade
rendait tous les détails de profils « inconnus » de manière silencieuse
(constaté en test réel, corrigé pré-publication). Mode d'appartement COM aligné
sur `COINIT_MULTITHREADED` (les threads bloquants tokio réutilisés peuvent être
déjà initialisés MTA par la couche `windows-firewall`).

**Correction.** `crates/cbs-firewall/src/lib.rs` : constante corrigée, mode MTA,
échec explicite en `Unavailable` en cas de refus COM.

**Preuve.** Comparaison croisée runtime avec `Get-NetFirewallProfile`
(profils désactivés = lecture « Désactivé » conforme) + badge profil actif
`privé + public` lu via `CurrentProfileTypes()` ; 3 tests du crate dont un COM réel.

### A-9. (Faible) Disponibilité profil « actif » par l'API tierce

**Cause.** `get_active_profile` du crate `windows-firewall` échoue sur un
masque combiné (ex. privé+public = 6) : « Invalid NET_FW_PROFILE value: 6 » ;
un seul profil ne peut pas représenter la réalité quand Windows en applique
plusieurs.

**Correction.** Lecture directe de `CurrentProfileTypes()` et libellé
explicite « Actif : X + Y » ; aucun profil inventé quand le masque est vide.

### A-10. (Moyen) Compteurs réseau gonflés par les sous-couches de filtres NDIS

**Cause.** `GetIfTable2` expose chaque couche de filtre NDIS (WFP, Npcap, QoS,
filtre Wi-Fi virtuel…) comme une interface distincte, avec ses propres
`InOctets`/`OutOctets`. Le moniteur additionnait toutes les lignes « opérationnelles » :
un même paquet Wi-Fi était compté 6 à 8 fois. Preuve contrôlée (sprint 3) : un
téléchargement unique de 20 Mio (21 Mo) mesurait **160 Mo** avant correction, soit
7,6×.

**Correction.** `keep_interface_row()` dans `crates/cbs-netmon/src/sys.rs` exclut les
lignes dont `InterfaceAndOperStatusFlags.FilterInterface` (bit 1) est positionné,
en conservant les adaptateurs réels (Wi-Fi, Ethernet, Tailscale, vEthernet WSL).
Trois tests unitaires ajoutés (7 au total pour `cbs-netmon`). Après correction, le
même téléchargement contrôlé de 20 Mio mesure **24,6 Mo** (1,17×, trafic de fond et
surcoût protocolaire inclus), et une fenêtre inactive 5 s mesure ~13 Ko.

**Limite restante (documentée).** Les octets sont cumulés par interface : un flux
encapsulé (VPN) apparaît à la fois sur le tunnel et sur l'adaptateur physique. Les
deltas restent des mesures par interface, jamais des estimations.

---

## Constats explicitement NON traités (assumés, documentés)

- La base SQLite reste non chiffrée (chemins/hashes/résumés) : protégée par les
  permissions du profil Windows ; le chiffrement de la base est un sujet Phase 3
  (DPAPI déjà en place pour la clé de quarantaine).
- La clé de quarantaine perdue rend les blobs irrécupérables : limite assumée du
  chiffrement, documentée côté UI (aucun contournement silencieux).
- Les liens symboliques ne sont pas mis en quarantaine (refus explicite, message).
- Le notaire/blocage EICAR par Defender est une **limite d'environnement**, pas un
  défaut du produit : aucun contournement n'est implémenté (aucune exclusion, aucun
  arrêt de Defender — contrairement à la contrainte projet).

## Vérification de non-régression

- `cargo test --workspace` : **64 réussis, 0 échec, 1 ignoré** (EICAR manuel), après
  ajout des tests de filtrage d'interfaces et de validation de langue.
- `cargo clippy --workspace --all-targets -- -D warnings` : propre.
- `cargo fmt --all -- --check` : propre.
- `npm run ui:build` + `npm run ui:test` : **17/17** (6 fichiers).
- Parcours manuels réels (fenêtre Tauri) : scan/détection/quarantaine/restauration/
  purge inchangés ; moniteur réseau et pare-feu validés en lecture seule
  (voir `DEVELOPMENT_STATUS.md` § 4 et `UX_TEST_REPORT.md`).
