# Intégration ClamAV — CBS Shield 0.2.0-dev

**Date :** 25 octobre 2026 — ClamAV **1.5.4** (`Cisco.ClamAV` via `winget`),
base de signatures app-locale sous
`%LOCALAPPDATA%\Cybrense\CBS Shield\clamav\database`.

Ce document décrit l'intégration réel du moteur ClamAV dans CBS Shield, la
validation effectuée (aucun malware réel) et les limites connues.

---

## 1. Principe

CBS Shield n'embarque pas ClamAV : il **découvre** le moteur officiellement installé
par l'utilisateur (`clamscan.exe`/`freshclam.exe`) et vérifie sa charge.

- Découverte : `clamscan` cherché dans les chemins usuels (`winget` links,
  `/Program Files/ClamAV`, sinon `PATH`), puis surcharge manuelle dans **Paramètres**
  (chemin validé).
- Mode d'invocation : `clamscan --database=<base app>` — la base de signatures est
  **app-locale**, jamais un dossier système. C'est une décision de sécurité : le
  poste ne pose jamais ses signatures dans un répertoire protégé, et l'utilisateur
  n'a jamais à ouvrir les droits en écriture sur le dossier d'installation.
- Sécurité d'exécution : `CREATE_NO_WINDOW` ; toute sortie est lue bornée
  (64 Ko/ligne, audit A-4) ; tout enfant de diagnostic est soumis à un timeout
  (`execute_with_timeout`, audit A-2) avec kill.

## 2. Signature DB : état et diagnostic

`engine_status` lit via `clamscan --database=… --version` la version du moteur et
celle des signatures, calcule l'âge en jours et expose un état honnête :
`missing` (aucune base), `outdated` (seuil configurable en réglages),
`upToDate`, `unknown` (échec d'interrogation — non inventé). Le compteur
`databaseFileCount` ne compte que les fichiers `daily.cvd/main.cvd/*.cld/bytecode.cvd`
de la base app-locale — les fichiers temporaires d'un `freshclam` interrompu sont
ignorés (voir §5).

## 3. Interopérabilité scan ↔ mise à jour

- Un `freshclam` refuse le lancement pendant un scan en cours (verrou explicite,
  message clair) — audit A-3.
- Inversement, le lancement d'un scan pendant une mise à jour affiche l'état
  « mise à jour en cours » (binaire interdit par le même verrou côté scan).

## 4. Validation effectuée (aucun malware réel)

| Vérification | Méthode | Résultat |
| --- | --- | --- |
| Découverte moteur | `clamscan --database=<base> --version` | ✅ 1.5.4, signatures `28164` |
| Détection positive par la vraie chaîne | signature NDB **inoffensive** ajoutée temporairement à la base app-locale, fichier bénin scanné | ✅ `CBS-Shield-Test-Signature.UNOFFICIAL FOUND` (hash, taille, événements) |
| Scan propre | fichier texte bénin contre la base complète | ✅ `clean`, sans erreur |
| Volume | arborescence récursive 240 fichiers (mission E) | ✅ ~0,3 s, tous événements comptés |
| Fichier verrouillé | `share_mode(0)` sur un fichier du corpus | ✅ `completedWithErrors`, chemin explicite (audit A-7) |
| Quarantaine/restauration du fichier détecté | chiffrement AES-256-GCM + purge | ✅ (Phase 1, inchangée) |
| EICAR | diagnostic manuel uniquement (`scripts/eicar-manual-test.ps1`) | ⚠ Defender bloque la lecture (voir `DEVELOPMENT_STATUS.md` § 5) |

## 5. Interruption de `freshclam` (démonstration des garde-fous)

Scénario pratique, sans produit toxique : un `freshclam` **interrompu** (kill via le
monitoring UI ou fermeture du poste) peut laisser dans le dossier de signatures :

- un `*.tmp` partiel adapté à la future base complète (jamais chargé par `clamscan`
  au prochain démarrage, car l'extension `.cvd` n'est pas atteinte) ;
- éventuellement, une ancienne base `.cvd` reste en place et la base reste
  utilisable/lisible (jamais corrompue en mode « inconnu »).

Conséquences et garde-fous :

1. Le compteur de base n'accepte que les fichiers de signature modifiables — les
   `.tmp` d'une mise à jour interrompue sont ignorés (pas de faux « à jour »).
2. La classification explicite (`summarize_update_run`) détecte une interruption par
   délai (30 min, kill propre) et l'indique dans la UI plutôt que de laisser un
   spinner infini.
3. Au prochain `freshclam` réussi, les fichiers partiels sont réécrits
   (comportement ClamAV officiel). CBS Shield ne fait pas de nettoyage manuel du
   dossier de signatures : il ne touche pas au moteur, il expose l'état.

## 6. Limites connues

- Le scan « clean » n'est pas une preuve d'absence de malware : uniquement basé sur
  signatures ClamAV + heuristiques internes du moteur.
- Les formats et tailles analysées sont ceux de ClamAV (taille/limites officielles).
- EICAR reste bloqué si Defender ne dispose pas d'exclusion — conformément aux
  contraintes du projet, CBS Shield ne configure jamais d'exclusion.
- `freshclam` sans connectivité réseau : statut honnête `outdated/mise à jour
  impossible` ; aucune nouvelle tentative automatique masquée par l'UI ; aucune
  élévation de privilège n'est tentée.
- ClamAV charge toute la base en RAM au premier scan (lent au démarrage,
  ~24 s en validation) : c'est le comportement officiel du moteur.
