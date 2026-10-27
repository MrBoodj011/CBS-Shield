# Architecture Pare-feu — CBS Shield 0.5.0-dev

**Date :** 27 octobre 2026 — Sprint 5
**Périmètre :** observation **strictement en lecture seule** de Microsoft Defender
Firewall, détection de changement, alertes, mapping connexions → règles, export
d'audit et architecture de gestion **désactivée**.

Ce document remplace la description Sprint 2. Les garde-fous restent identiques :
CBS Shield ne crée, ne modifie, n'active et ne désactive **aucune** règle.

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
6. **Snapshot** : export JSON en lecture seule dans le dossier de données.
7. **Gestion de règles** : architecture et prérequis affichés, mais **aucune
   capacité d'écriture** n'est exposée.

### 1.1 API et dépendances

| Lecture | API | Note |
| --- | --- | --- |
| État des profils | `windows-firewall 0.8` (`MIT/Apache-2.0`) sur `windows 0.62` | crate public audité |
| Défauts, profils actifs | COM direct `INetFwPolicy2` | `CoInitializeEx(MTA)` |
| Règles | `windows-firewall` `list_rules/count_rules` | liste bornée, hash complet |
| Connexions | `GetExtendedTcpTable`, `QueryFullProcessImageNameW` | via `cbs-netmon` |

Aucun pilote noyau, service, filtre WFP, hook ou pare-feu tiers.

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
- contenu : version, `readOnly: true`, statut complet, baseline, règles, alertes ;
- aucune commande d'import ou de restauration n'existe.

Un snapshot observé le 26 octobre contenait **657 règles** et le marqueur
`"readOnly": true` ; l'observation finale du 27 octobre affichait **659 règles**,
la stratégie Windows ayant évolué. Le fichier est une pièce d'audit, pas une
sauvegarde restaurable.

---

## 6. Gestion de règles — verrouillée

`firewall_management_status` expose :

- `ruleWritesAllowed: false` ;
- `elevationRequired: true` (information, aucune demande d'élévation) ;
- `isolationRequired: true` ;
- `rollbackRequired: true` ;
- des prérequis détaillés :
  - sauvegarde/export disponible ;
  - validation sur VM isolée ;
  - validation de la restauration ;
  - autorisation explicite de l'utilisateur ;
  - revue de sécurité dédiée.

Aucune commande de création, modification, activation, désactivation ou
suppression de règle n'est enregistrée dans Tauri. Le bouton de gestion reste
désactivé ; le backend refuserait toute demande même si l'interface était
contournée.

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
- **Pas de validation VM** : les scénarios pare-feu actif/désactivé sur machine
  propre restent non exécutés.

---

## 8. Vérifications

```powershell
cargo test -p cbs-firewall          # 8 tests
cargo test -p cbs-netmon            # 7 tests
cargo test -p cbs-shield commands::firewall
cargo clippy --workspace --all-targets -- -D warnings
```

Contrôle croisé manuel :

```powershell
Get-NetFirewallProfile |
  Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction
netsh advfirewall show allprofiles state
```

Aucun `put_*` ne doit apparaître dans `crates/cbs-firewall/src`. Aucune commande
IPC de mutation ne doit apparaître dans `src-tauri/src/commands/firewall.rs`.
