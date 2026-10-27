# Architecture Pare-feu — CBS Shield 0.7.0-dev

**Date :** 27 octobre 2026 — Sprint 7
**Périmètre :** observation **strictement en lecture seule** de Microsoft Defender
Firewall, diagnostic des services, détection de changement, alertes, mapping
connexions → règles, distinction référence/décision effective, export d'audit avec
SHA-256 et empreinte de contrôle `.sha256`, historique d'instantanés vérifiable,
plan de récupération **non actif** et architecture de gestion **désactivée**.

Ce document remplace la description Sprint 2. Les garde-fous restent identiques :
CBS Shield ne crée, ne modifie, n'active et ne désactive **aucune** règle. La
mutation reste bloquée tant que l'isolation VM, la sauvegarde vérifiée et la
répétition de restauration n'ont pas produit de preuves.

---

## 1. Ce que fait le module

1. **Profils** (`Domaine`, `Privé`, `Public`) :
   - état activé/désactivé ;
   - actions par défaut entrant/sortant ;
   - profils réellement actifs (`CurrentProfileTypes()`).
2. **Règles** : lecture bornée à 1 000 entrées pour l'affichage, avec le **nombre
   total réel**. Le hash et les alertes portent sur l'intégralité des règles.
3. **Alertes** : dérivées de l'état réel, jamais d'une supposition.
4. **Changements** : comparaison avec une baseline locale (profils + actions +
   règles). L'utilisateur peut acquitter explicitement la configuration courante.
5. **Connexions** : les connexions TCP actives sont associées aux règles dont le
   programme correspond au **chemin d'image réel** du processus.
6. **Services** : état de `MpsSvc` et `BFE` via `sc query` masqué, sans démarrage,
   arrêt ou configuration. Un état illisible reste `unknown`.
7. **Snapshot** : export JSON en lecture seule dans le dossier de données, avec
   SHA-256 des octets écrits et fichier de contrôle `*.json.sha256`.
8. **Historique d'instantanés** : liste bornée aux 50 fichiers d'audit les plus
   récents, avec taille, date, nombre de règles, empreinte et état d'intégrité.
9. **Vérification** : commande séparée qui recompute le SHA-256 et compare le
   sidecar. Elle détecte une altération accidentelle ; ce n'est **pas** une
   signature Authenticode.
10. **Référence vs décision** : l'interface explique que les règles lues ne
    constituent pas la décision effective du noyau.
11. **Gestion de règles** : architecture, gates et plan de récupération affichés,
    mais **aucune capacité d'écriture** n'est exposée.
12. **Interface Sprint 7** : vue d'ensemble, navigation par sections, filtres
    locaux (direction, action, état, protocole, profil), détail de règle en
    lecture seule, regroupement des connexions par application et matrice de
    capacités.

### 1.1 API et dépendances

| Lecture | API | Note |
| --- | --- | --- |
| État des profils | `windows-firewall 0.8` (`MIT/Apache-2.0`) sur `windows 0.62` | crate public audité |
| Défauts, profils actifs | COM direct `INetFwPolicy2` | `CoInitializeEx(MTA)` |
| Règles | `windows-firewall` `list_rules/count_rules` | liste bornée, hash complet |
| Connexions | `GetExtendedTcpTable`, `QueryFullProcessImageNameW` | via `cbs-netmon` |
| Services | `sc query MpsSvc`, `sc query BFE` | console masquée, lecture seule |

Aucun pilote noyau, service CBS Shield, filtre WFP, hook ou pare-feu tiers.

---

## 2. Modèle de données

`FirewallStatus` contient :

- `profiles` : trois profils avec `enabled`, actions entrantes/sortantes ;
- `activeProfiles` : libellés des profils actifs ;
- `rules` : liste bornée de `RuleSummary` ;
- `rulesTotalCount` : total réel ;
- `rulesHash` : SHA-256 du jeu complet ;
- `profilesHash` : SHA-256 des profils + actions ;
- `configurationHash` : hash composite `profilesHash + rulesHash + total` ;
- `checkedAt` : horodatage RFC 3339.

`FirewallObservation` ajoute :

- `service` : `mpsSvc`, `bfe`, `observed`, `checkedAt` ;
- `alerts`, `changes`, `changedSinceLast`, `listedTruncated`.

`RuleSummary` expose : nom, groupe, description, programme, service, direction,
action, état, protocole, ports locaux/distants, profils.

### 2.1 Baseline

Stockée dans la table clé/valeur des réglages (JSON), avec :

| Champ | Rôle |
| --- | --- |
| `profilesHash` | empreinte des profils et actions par défaut |
| `rulesHash` | empreinte de toutes les règles |
| `rulesTotalCount` | nombre total |
| `configurationHash` | empreinte composite |
| `checkedAt` | date de l'observation acceptée |
| `profiles` | état détaillé par profil pour produire les différences |

La baseline est créée à la **première** observation, puis remplacée uniquement
par `firewall_acknowledge_baseline`. Une observation différente ne l'écrase pas.

### 2.2 Changements

`FirewallChange` contient un code stable et, le cas échéant, le profil concerné.
Les codes couvrent :

- `rules_changed` (hash et/ou nombre total de règles) ;
- `profile_missing_from_baseline` ;
- `profile_state_changed` ;
- `profile_defaults_changed` (action entrante ou sortante).

L'interface affiche la date de la baseline et ne dit jamais **qui** a modifié la
configuration.

---

## 3. Alertes

`cbs_firewall::security_alerts(&status)` produit des alertes honnêtes :

| Code | Déclencheur | Sévérité |
| --- | --- | --- |
| `all_profiles_disabled` | les 3 profils sont désactivés | `danger` |
| `profile_disabled` | un profil est désactivé (si les trois ne le sont pas) | `warning` |
| `inbound_default_allow` | action entrante par défaut `autoriser` sur un profil actif | `warning` |

Les différences avec la baseline sont exposées séparément par
`configurationChanged` et `changes`, et ne sont pas dupliquées dans les alertes.

Le Dashboard agrège ces alertes. Une alerte n'est pas une preuve d'intrusion et
n'entraîne aucune action corrective.

---

## 4. Mapping connexions → règles

`firewall_connections` :

1. lit l'état du pare-feu (best effort) et capture les connexions TCP via
   `cbs_netmon` ;
2. pour chaque connexion, récupère le **chemin d'image** du PID ;
3. compare le chemin complet (insensible à la casse) puis le nom de fichier aux
   champs `programme` des règles ;
4. renvoie au maximum quelques noms de règles, avec un **total réel** de
   correspondances ;
5. expose `mappingAvailable` et `mappingLimited`.

Règles d'honnêteté :

- sans chemin d'image réel, **aucun mapping** n'est inventé (cas `System`) ;
- les règles sans programme ne sont pas associées ;
- une correspondance est une **référence**, pas un verdict d'autorisation ;
- si le pare-feu est indisponible, les connexions restent visibles mais le mapping
  est marqué indisponible.

---

## 5. Export JSON

Commande : `firewall_export_snapshot`.

- destination : `%LOCALAPPDATA%\Cybrense\CBS Shield\firewall-backups\` ;
- nom : `firewall-snapshot-<horodatage>.json` (caractères non sûrs remplacés) ;
- contenu : version, `exportedAt`, `readOnly: true`, `restoreSupported: false`,
  statut complet, règles et alertes ;
- sidecar : `firewall-snapshot-<horodatage>.json.sha256`, au format
  `<sha256>  <nom-du-fichier>` (compatible `sha256sum -c`) ;
- réponse IPC : `sha256` calculé sur les octets exacts écrits, `sha256Sidecar`
  lorsque le sidecar a été écrit, `readOnly`, `restoreSupported`, nombre de
  règles sauvegardées et total ;
- historique : `firewall_snapshot_history` lit au plus 50 fichiers
  `firewall-snapshot-*.json` et retourne `matched`, `mismatch`, `unverified` ou
  `invalid` selon le schéma et le sidecar ;
- vérification : `firewall_verify_snapshot(path)` canonicalise le chemin,
  refuse tout fichier hors du dossier d'audit et toute extension autre que
  `.json`, puis recompute l'empreinte sans rien écrire ;
- aucune commande d'import ou de restauration n'existe.

Un fichier sans sidecar reste lisible, mais il est présenté **non attesté**
(`unverified`). Un sidecar divergent est présenté comme **suspect**
(`mismatch`). Ces états ne sont jamais maquillés en « vérifié ».

Pendant la validation du 27 octobre, le nombre de règles observé est passé de
**659 à 657**. CBS Shield a affiché le changement sans le réparer ni avancer la
baseline ; l'acquittement explicite a ensuite créé une nouvelle référence locale.
Les snapshots finaux contenaient **657 règles**, `readOnly: true`,
`restoreSupported: false` et un SHA-256 identique à celui du fichier. Le fichier
est une pièce d'audit, pas une sauvegarde restaurable.

---

## 6. Gestion de règles — verrouillée

`firewall_management_status` expose :

- `enabled: false` ;
- `mutationApiExposed: false` ;
- `backupDirectory` ;
- `snapshotCount` et `verifiedSnapshotCount` (sidecar `.sha256` concordant) ;
- `lastSnapshotAt` ;
- quatre gates à code stable :
  - `explicit_authorization` — **non satisfaite** ;
  - `isolated_vm_test` — **non satisfaite** ;
  - `backup_snapshot` — satisfaite seulement si au moins un instantané a une
    empreinte `.sha256` concordante (pas un simple fichier JSON) ;
  - `rollback_rehearsal` — **non satisfaite** ;
- un plan `recovery` marqué `state: "designOnly"`, avec
  `snapshotReadOnly: true`, `restoreExposed: false`, `rollbackRehearsed: false`,
  `isolationRequired: true`.

Aucune commande de création, modification, activation, désactivation ou
suppression de règle n'est enregistrée dans Tauri. Le bouton de gestion reste
désactivé ; le backend refuserait toute demande même si l'interface était
contournée. La présence d'un snapshot vérifié ne suffit jamais à elle seule :
tant que `isolated_vm_test`, `rollback_rehearsal` et
`explicit_authorization` restent fausses, la gestion demeure indisponible.

Le plan de récupération est une **architecture documentée**, pas une fonction
disponible. Aucune restauration de règles n'est exposée tant que la VM isolée, le
rollback et l'autorisation distincte n'ont pas été validés.

---

## 7. Menaces et limites

- **Pare-feu OS désactivé** : CBS Shield le signale, mais ne peut pas protéger un
  poste dont le filtrage Windows est coupé.
- **Baseline locale** : non signée, modifiable par un processus élevé ; elle sert
  à détecter un changement, pas à prouver l'intégrité du système.
- **Liste bornée** : l'interface affiche 1 000 règles ; le hash et le compteur
  portent sur toutes les règles.
- **Mapping indicatif** : le nom d'image peut être usurpé ; le mapping ne prouve
  pas l'effet réel d'une règle.
- **Pas de surveillance en arrière-plan** : l'état est rafraîchi à la demande ou
  à l'ouverture de la section.
- **Snapshot non signé** : le SHA-256 et son sidecar détectent une altération
  accidentelle, pas une falsification coordonnée par un processus élevé.
- **Sidecar non signé** : un attaquant élevé peut réécrire le JSON et le sidecar
  ensemble. Le sidecar n'est pas une preuve d'origine.
- **Pas de décision effective** : les priorités Allow/Block, les filtres WFP,
  IPsec et les stratégies de groupe ne sont pas calculés.
- **Pas de validation VM complète** : la VM Windows 11 isolée a été créée pour
  Sprint 7, mais le cycle complet d'installation, sauvegarde et restauration doit
  encore être prouvé avant toute activation de mutation. Aucun scénario de
  mutation n'est revendiqué comme validé.

---

## 8. Interface Sprint 7

La page Pare-feu est découpée en sections navigables : vue d'ensemble, alertes,
profils, connexions, règles, sauvegardes et diagnostic. Toutes les actions
affichées sont réelles :

| Élément | Comportement |
| --- | --- |
| Actualiser / Tout actualiser | relit profils, règles, services, connexions et historique |
| Filtres de règles | filtrage local uniquement, aucun appel IPC de mutation |
| Détail d'une règle | modale en lecture seule, fermeture clavier Échap |
| Recherche de connexions | filtrage local, option « établies uniquement » |
| Export d'instantané | écrit le JSON et son sidecar `.sha256` |
| Vérifier | recompute l'empreinte et compare le sidecar |
| Gestion des règles | aucun bouton actif : capacité visiblement indisponible |

Les couleurs et badges distinguent une règle **référencée** d'une décision
effective. La page ne présente jamais une règle observée comme une garantie
d'application par le noyau.

## 9. Vérifications

```powershell
cargo test -p cbs-firewall          # 8 tests
cargo test -p cbs-netmon            # 7 tests
cargo test -p cbs-shield commands::firewall
cargo clippy --workspace --all-targets -- -D warnings
```

Tests Sprint 7 ajoutés dans `cbs-shield` :

- `snapshot_history_verifies_digest_and_detects_tampering` : sidecar concordant,
  structure JSON valide, nombre de règles tronqué, altération détectée ;
- `snapshot_paths_are_contained_and_require_json` : refus hors dossier d'audit,
  refus d'un dossier et d'une extension non JSON ;
- les tests frontend couvrent les filtres locaux, l'historique, la vérification
  et l'absence de restauration exposée.

Contrôle croisé manuel :

```powershell
Get-NetFirewallProfile |
  Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction
netsh advfirewall show allprofiles state
```

Aucun `put_*` ne doit apparaître dans `crates/cbs-firewall/src`. Aucune commande
IPC de mutation ne doit apparaître dans `src-tauri/src/commands/firewall.rs`.
