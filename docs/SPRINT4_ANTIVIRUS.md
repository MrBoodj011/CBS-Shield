# Sprint 4 — Antivirus avancé, signatures et mises à jour

Version : **0.4.0-dev** — branche `sprint-4` — 26 octobre 2026

Ce document décrit ce qui est réellement implémenté, mesuré ou volontairement
laissé hors périmètre. Il ne présente pas une protection temps réel : CBS Shield
reste un **scanner antivirus manuel à la demande**.

## 1. Périmètre des analyses

### Analyse rapide

Cibles résolues côté Rust, jamais envoyées par l'interface :

| Cible | Chemin |
| --- | --- |
| Téléchargements | `%USERPROFILE%\Downloads` |
| Bureau | `%USERPROFILE%\Desktop` |
| Documents | `%USERPROFILE%\Documents` |
| Temp utilisateur | `%LOCALAPPDATA%\Temp` |
| Démarrage utilisateur | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` |
| Démarrage commun | `%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\StartUp` |

Seules les cibles existantes sont conservées. L'interface affiche les cibles
effectivement résolues et le nombre de fichiers indexés.

### Analyse complète

- Tous les **volumes fixes locaux** détectés par `GetLogicalDrives` /
  `GetDriveTypeW` (`DRIVE_FIXED`).
- Les volumes réseau, amovibles, optiques et inconnus sont exclus.
- Exclusions par défaut :
  - le dossier de données CBS Shield (base, quarantaine, journaux, signatures) ;
  - `C:\Windows\WinSxS` ;
  - `C:\Windows\System32\config` ;
  - `$Recycle.Bin` et `System Volume Information` à la racine de chaque volume.
- Les liens symboliques, jonctions et points d'analyse ne sont **jamais suivis**
  (indexeur et ClamAV configurés en conséquence).
- Une analyse complète n'a pas été exécutée de bout en bout pendant la
  validation : elle dure trop longtemps pour la fenêtre de test disponible.
  La résolution des volumes et l'indexation sont couvertes par les tests.

### Analyse personnalisée

- Sélection native de fichiers/dossiers, ou saisie/collage d'un chemin local.
- Plusieurs cibles, dédupliquées par le backend.
- Les chemins restent locaux ; aucun chemin n'est transmis sur le réseau.

## 2. Progression, annulation et erreurs

- L'indexation est bornée (1 000 000 de fichiers ou 20 secondes par défaut).
- Le pourcentage n'est affiché que lorsque l'index est **complet**. Sinon
  l'interface affiche une barre indéterminée, le nombre de fichiers analysés et
  le fichier courant.
- La progression provient des événements réels de `clamscan`
  (`FOUND`, `OK`, `ERROR`) et du processus, jamais d'une simulation.
- L'annulation tue le processus ClamAV, conserve les détections déjà reçues,
  ignore le calcul de hash des fichiers non encore traités et enregistre un
  rapport `cancelled`.
- Les erreurs par fichier (fichier verrouillé, accès refusé, archive invalide)
  sont conservées dans le rapport sans faire échouer tout le scan.
- Un fichier verrouillé est testé en intégration : erreur non bloquante, pas de
  crash.

## 3. Limites de ressources

Valeurs par défaut, bornées côté backend :

| Réglage | Défaut | Bornes |
| --- | --- | --- |
| Taille maximale d'un fichier | 200 Mo | 1–2 000 Mo |
| Taille maximale analysée | 2 000 Mo | 10–10 000 Mo |
| Nombre maximal de fichiers | 100 000 | 100–1 000 000 |
| Récursion maximale | 10 | 1–100 |
| Durée maximale | illimitée | 0–1 440 min |
| Archives | activées | option |
| Priorité basse | activée | option |

Les valeurs sont transmises à ClamAV (`--max-filesize`, `--max-scansize`,
`--max-files`, `--max-recursion`, `--max-scantime`) et le processus est lancé en
priorité basse sans fenêtre (`IDLE_PRIORITY_CLASS`, `CREATE_NO_WINDOW`).

## 4. Rapports, historique et export

- Rapport final : profil, cibles résolues, exclusions, fichiers indexés,
  indicateur de troncature, compteurs, détections, erreurs, durée, version
  moteur/CVD, limite appliquées, annulation.
- Historique SQLite inchangé (aucune migration de schéma).
- Export depuis l'interface : JSON, CSV, Markdown, TXT, via le dialogue natif
  d'enregistrement (`dialog:allow-save`). Le format PDF n'est pas prétendu.
- Les fichiers exportés contiennent les détections et les erreurs telles
  qu'enregistrées.

## 5. Signatures officielles et la confusion « 28 164 »

`28 164` (puis `28 165` après une mise à jour réelle) est le **numéro de
révision de la base journalière CVD**, pas un nombre de signatures. La valeur
est affichée par `clamscan` sous la forme `daily.cvd (version: 28164)`.

Inventaire mesuré avec `sigtool --info` sur les composants officiels :

| Composant | Version | Signatures |
| --- | ---: | ---: |
| `bytecode.cvd` | 339 | 80 |
| `daily.cvd` | 28164 | 355 788 |
| `main.cvd` | 63 | 3 287 027 |
| **Total officiel** | | **3 642 895** |

`clamscan` rapportait **3 628 192 virus connus chargés** : un total différent car
les compteurs ne mesurent pas exactement la même chose (entrées chargées par
libclamav vs entrées déclarées par les composants). L'interface affiche le total
officiel issu de l'inventaire et présente la révision CVD séparément. Une base
journalière mise à jour (`daily.cld` v28165) conserve le même nombre de
signatures dans le composant.

Les fichiers personnalisés (`.ndb`, `.hdb`, `.hsb`, `.ldb`, `.sdb`) sont
comptés séparément et étiquetés **custom/test**. ClamAV ajoute le suffixe
`.UNOFFICIAL` aux détections issues de ces fichiers. Pendant la validation, un
fichier synthétique inoffensif et une signature `.hsb` de test ont produit
`CBS.Shield.Test.Synthetic-1.UNOFFICIAL` ; cette signature de test a été retirée
de la base utilisateur après les essais. Elle n'est ni livrée ni installée.

## 6. Mises à jour FreshClam

- Mise à jour manuelle via `freshclam`, sans élévation, avec confirmation et
  verrou exclusif partagé avec les scans.
- Nettoyage des fichiers `.tmp` de téléchargement abandonnés (plus d'une heure).
- Vérification après téléchargement : présence des bases, chargement par
  `sigtool --info`, composants vérifiés (`.sign` si disponible).
- Classification hors ligne sur les erreurs réseau réelles de FreshClam.
- Journal persistant `updates.log` (une ligne par tentative) et journaux
  `freshclam.log` / application en lecture seule dans l'interface.
- Mise à jour automatique optionnelle, **uniquement lorsque CBS Shield est
  ouvert** : vérification toutes les 5 minutes, intervalle configurable de 6 à
  168 heures, jamais pendant un scan, aucun service ni tâche planifiée.
- Une mise à jour interrompue ne remplace pas la base existante ; l'état
  « hors ligne » est explicite et la base reste utilisable.

Validation réelle : mise à jour manuelle `success=true`, code de sortie 0,
base vérifiée, journal écrit, passage de la CVD de 28164 à 28165. L'échec réseau
natif n'a pas pu être forcé sans modifier le réseau ou le pare-feu (interdit) ;
la classification est couverte par des tests unitaires.

## 7. Interface

Cinq vues antivirus : **Rapide**, **Complète**, **Personnalisée**, **Résultats**,
et accès direct à **Quarantaine** et **Mises à jour**. Tous les boutons
exécutent une commande réelle : résolution des cibles, scan, annulation, export,
quarantaine, vérification, mise à jour, ouverture de documentation.

L'interface reste réactive pendant un scan : le scan tourne dans le backend
asynchrone, les événements sont émis en continu et le bouton d'annulation reste
actif. Une capture réelle montre une annulation après 3 min 23 s avec 9 627
fichiers indexés et une détection préexistante dans `Downloads`.

## 8. Limites assumées

- Pas de protection temps réel, pas de pilote noyau, pas de surveillance des
  processus.
- Pas de suppression automatique : toute mise en quarantaine est confirmée.
- Une analyse propre ne prouve pas l'absence de malware.
- Microsoft Defender n'est ni désactivé, ni contourné, ni exclu.
- Le pare-feu Windows n'est jamais modifié.
- Aucun malware réel n'est utilisé pour les tests.
- Les messages techniques renvoyés par FreshClam/ClamAV peuvent rester dans leur
  langue d'origine ; l'interface et les messages applicatifs sont FR/EN.
