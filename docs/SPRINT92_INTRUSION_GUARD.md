# Sprint 9.2 — CBS Intrusion Guard : spécification d'architecture

**Statut :** spécification uniquement. **Aucune ligne de code n'est implémentée
dans ce sprint.** Ce document décrit une fonctionnalité défensive, **en lecture
seule**, destinée à une implémentation ultérieure après revue.

---

## 1. Objectif et non-objectifs

### 1.1 Objectif

Donner à l'utilisateur une **chronologie locale et explicable** des signaux
d'intrusion observables sur son poste, en réutilisant l'observation déjà
présente dans CBS Shield (sockets, compteurs réseau, configuration pare-feu,
DNS local) et en y ajoutant, plus tard, une lecture du journal d'événements
Windows.

Chaque signal est présenté avec :
son **niveau de confiance**, sa **source exacte**, l'**heure**, et ce que CBS
Shield a réellement fait (en l'occurrence : rien — il observe).

### 1.2 Non-objectifs (verrouillés)

Conformément à `SECURITY.md`, `FIREWALL_ARCHITECTURE.md:292-293` et
`docs/SPRINT8_ARCHITECTURE_THREAT_MODEL.md:99-110`, Intrusion Guard **ne fait
jamais** :

- de blocage automatique d'une connexion, d'un processus ou d'un compte ;
- d'injection de paquets, de redirection ou de filtrage réseau ;
- de mutation du pare-feu Windows (`put_*`, `netsh advfirewall set`, WFP) ;
- de désactivation ou d'exclusion de Microsoft Defender ;
- d'élévation implicite, de pilote noyau ou de service permanent ;
- de télémétrie, d'envoi distant ou de « threat intelligence » réseau.

L'application reste non élevée (`src-tauri/src/paths.rs:8`,
`SECURITY.md:18-22`). Toute capacité demandant des privilèges supplémentaires
doit faire l'objet d'une décision explicite et documentée du propriétaire.

---

## 2. Vocabulaire de statut (honnêteté par construction)

Le vocabulaire est le point le plus sensible du produit : il ne doit jamais
laisser croire à une neutralisation qui n'a pas eu lieu.

| Statut | Signification exacte | Ce que l'UI peut dire | Ce qu'elle ne peut pas dire |
|---|---|---|---|
| **Observé** | un fait brut a été relevé (socket, compteur, empreinte) | « connexion observée » | « connexion malveillante » |
| **Suspecté** | le fait correspond à une règle heuristique, sans preuve | « comportement inhabituel » | « intrusion détectée » |
| **Confirmé** | le fait est corroboré par au moins deux sources indépendantes **ou** par une signature déterministe (ex. : EICAR, événement 1102 « journal effacé ») | « intrusion confirmée par <sources> » | « intrusion bloquée » |
| **Bloqué** | **interdit à ce stade** — Intrusion Guard ne bloque rien | *jamais affiché* | — |

Le mot « bloqué » n'apparaît dans l'interface **que** si un autre composant du
système (Defender, pare-feu Windows) a effectivement bloqué quelque chose, et
dans ce cas le libellé doit citer ce composant : « bloqué par Microsoft
Defender », jamais « bloqué par CBS Shield ».

> Règle de rédaction reprise de `FIREWALL_ARCHITECTURE.md:127-128` :
> « Une alerte n'est pas une preuve d'intrusion. »

---

## 3. Sources d'événements

### 3.1 Sources déjà disponibles dans le produit (à réutiliser)

| Source | Ce qu'elle fournit | Où | Limite connue |
|---|---|---|---|
| Tables de sockets | connexions TCP établies, écoutes UDP/TCP, PID et chemin du processus | `cbs_netmon::capture_snapshot` — `crates/cbs-netmon/src/sys.rs:437` ; modèle `NetConnection` `lib.rs:43-61` | instantané à la demande, pas de flux continu |
| Compteurs d'interfaces | octets cumulés par interface, deltas mesurés | `traffic_delta` — `crates/cbs-netmon/src/lib.rs:107` | cumuls NDIS, pas de contenu |
| Configuration pare-feu | profils, règles, empreintes SHA-256 | `cbs_firewall::inspect` — `crates/cbs-firewall/src/lib.rs:423` ; empreintes `:196`, `:224`, `:259` | lecture seule, ne calcule pas la décision effective (WFP) |
| Alertes pare-feu | profil désactivé, entrée autorisée par défaut | `security_alerts` — `crates/cbs-firewall/src/lib.rs:278-314` | observations, pas de remédiation |
| Ligne de base pare-feu | détection de changement depuis un état acquitté | `commands/firewall.rs:129-215`, acquittement `:266-274` | non signée, non fiable contre un attaquant élevé |
| DNS local | requêtes bloquées/autorisées vues par le proxy boucle locale | `crates/cbs-webguard/src/lib.rs` | **uniquement** le trafic envoyé volontairement à `127.0.0.1:5353` |
| Observateur de fichiers | créations/modifications sous surveillance | `crates/cbs-proactive/src/lib.rs:385-404` | pas de temps réel garanti |

### 3.2 Source à ajouter : journal d'événements Windows

**Constat important : CBS Shield ne lit aujourd'hui aucun journal d'événements,
aucun flux ETW et n'utilise pas WMI.** C'est une capacité entièrement nouvelle.

Événements candidats (lecture seule) :

| Canal | ID | Intérêt | Condition d'accès |
|---|---|---|---|
| Sécurité | 4625 | échecs d'ouverture de session répétés | membre du groupe *Event Log Readers* (pas d'élévation) |
| Sécurité | 4624 | ouvertures de session réussies (type 3, 10) | idem |
| Sécurité | 4648 | usage d'identifiants explicites | idem |
| Sécurité | 4720 / 4732 | création de compte / ajout à un groupe privilégié | idem |
| Sécurité | 1102 | **journal de sécurité effacé** (signal fort) | idem |
| Système | 7045 | installation d'un nouveau service | lecture standard |
| Defender | 1116 / 1117 | détection / action de Defender | lecture standard |
| Pare-feu | 2003/2004/2009 | changement de profil ou de règle | lecture standard |

**Histoire de disponibilité obligatoire.** Si le journal n'est pas lisible
(groupe absent, journal désactivé, stratégie), l'interface doit afficher
« Journal de sécurité non lisible — Intrusion Guard voit uniquement le réseau
et le pare-feu » et **dégrader la confiance** des règles concernées. Aucun
« tout est calme » ne doit être affiché quand la source est muette.
C'est la transposition directe de la règle du Sprint 9 :
« jamais déclaré réussi sans exécution réelle » (`docs/SPRINT9_SECURITY.md:34`).

---

## 4. Règles de détection (déterministes d'abord, heuristiques ensuite)

Chaque règle produit un `Finding` avec `ruleId`, `confidence`, `sources`,
`evidence` (données brutes bornées) et `firstSeen`/`lastSeen`.

### 4.1 Famille « balayage réseau » (suspecté)

- **R-A** : plus de *N* tentatives de connexion sortantes vers des ports
  distincts de la même adresse distante en moins de *T* secondes
  (détection de scan sortant).
- **R-B** : plus de *N* connexions entrantes refusées depuis la même adresse
  en moins de *T* secondes (scan entrant, visible seulement si le pare-feu
  journalise — sinon marqué « partiel »).

Bornes proposées : `N = 20`, `T = 60 s`, fenêtre glissante de 5 min.
Confiance : **suspecté** par défaut — un navigateur ou un antivirus tiers peut
produire le même motif.

### 4.2 Famille « exposition » (observé → suspecté)

- **R-C** : nouvelle écoute TCP/UDP sur une interface non-loopback par un
  processus absent de la ligne de base des écoutes.
- **R-D** : écoute sur un port < 1024 par un processus non signé hors
  `C:\Windows\`.

Ligne de base : première observation = apprentissage silencieux ; toute
nouveauté ensuite est un `Finding`. Le mécanisme est le même que
`FirewallBaseline` (`commands/firewall.rs:129-215`) : **jamais avancé
automatiquement**, seulement par acquittement explicite de l'utilisateur.

### 4.3 Famille « configuration » (confirmé si empreinte stable)

- **R-E** : empreinte des règles pare-feu différente de la ligne de base
  (`rules_fingerprint`).
- **R-F** : profil pare-feu désactivé (`all_profiles_disabled`,
  `profile_disabled` — déjà calculés par `security_alerts`).

Ces règles sont **confirmées** au sens « le changement a bien eu lieu », pas
« quelqu'un a piraté le poste » : le libellé doit rester « configuration
modifiée depuis le <date> », jamais « attaque ». (cf.
`FIREWALL_ARCHITECTURE.md:109-110` : l'UI ne désigne pas l'auteur.)

### 4.4 Famille « compte et journal » (confirmé)

- **R-G** : ≥ 5 échecs 4625 pour un même compte en 10 min → suspecté ;
  ≥ 20 ou suivi d'un 4624 → confirmé.
- **R-H** : événement 1102 → **confirmé** : le journal de sécurité a été
  effacé. C'est déterministe et ne dépend d'aucune heuristique.
- **R-I** : 4720/4732 hors fenêtre de maintenance déclarée → suspecté.

### 4.5 Anti-faux-positifs

1. **Apprentissage** : 24 h de ligne de base silencieuse avant d'émettre une
   règle basée sur la nouveauté (R-C, R-D, R-E).
2. **Liste d'exceptions locale** : l'utilisateur peut marquer un processus ou
   un couple (adresse, port) comme connu. Stockée localement, jamais envoyée.
3. **Score de confiance** : chaque règle porte une confiance de base ; une
   corroboration par une seconde source indépendante la fait monter d'un cran,
   une source indisponible la fait baisser.
4. **Fusion** : deux `Finding` de même `ruleId` + même cible dans une fenêtre
   de 10 min sont fusionnés (compteur incrémenté) au lieu d'empiler des lignes.
5. **Aucune inférence** : si une donnée manque, le champ vaut « inconnu » et
   n'est **jamais** comblé par une valeur plausible.

---

## 5. Notifications et limitation de débit

Réutilisation directe de l'existant :

- `NotifyRing::admit` (`src-tauri/src/notify.rs:24-33`) : anneau de 16 clés
  déjà utilisé pour dédupliquer les notifications de détection.
- `notify::show` (`notify.rs:38`) : émission native côté Rust uniquement ; le
  frontend n'a pas la permission de notifier
  (`src-tauri/capabilities/default.json` ne donne que `core:default`).

Politique proposée :

| Niveau | Notification |
|---|---|
| Observé | jamais |
| Suspecté | au plus **1 par règle et par 30 min**, groupée (« 3 événements ») |
| Confirmé | immédiate, **1 par `Finding`**, jamais répétée à l'identique |

Plafond absolu : **5 notifications natives par heure**, puis les suivantes
sont uniquement ajoutées à l'historique avec un badge dans l'interface. Aucune
notification ne contient de donnée sensible (pas de chemin complet, pas
d'adresse distante précise) : « Activité inhabituelle détectée — ouvrez CBS
Shield pour le détail ».

---

## 6. Historique local

Nouvelle table, même schéma de migration que la v2 :

```sql
CREATE TABLE IF NOT EXISTS intrusion_findings (
  id              TEXT PRIMARY KEY,
  rule_id         TEXT NOT NULL,
  status          TEXT NOT NULL,      -- observed | suspected | confirmed
  confidence      INTEGER NOT NULL,   -- 0..100
  title           TEXT NOT NULL,
  detail          TEXT NOT NULL,      -- texte borné, sans secret
  sources         TEXT NOT NULL,      -- JSON: ["netmon","firewall"]
  evidence        TEXT NOT NULL,      -- JSON borné (≤ 4 KiB)
  first_seen      TEXT NOT NULL,
  last_seen       TEXT NOT NULL,
  occurrences     INTEGER NOT NULL DEFAULT 1,
  acknowledged_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_findings_seen ON intrusion_findings(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_findings_status ON intrusion_findings(status);
```

- Migration : incrément de `SCHEMA_VERSION` dans `crates/cbs-store/src/lib.rs:20-86`,
  même motif `CREATE … IF NOT EXISTS` que la v1→v2 (test
  `lib.rs:858-889`).
- Insertion : motif `insert_netmon_snapshot` (`lib.rs:531-559`) avec
  élagage à l'insertion.
- **Rétention** : 5 000 lignes, 90 jours, puis `DELETE` par ancienneté.
- **Export** : JSON + empreinte SHA-256 en sidecar, en réutilisant la
  mécanique de `firewall_export_snapshot` (`commands/firewall.rs:298-376`) ;
  `restoreSupported: false` comme pour les instantanés pare-feu.

---

## 7. Confidentialité et ressources

| Contrainte | Valeur |
|---|---|
| Contenu des paquets | jamais lu |
| Contenu des fichiers | jamais lu par Intrusion Guard (seuls des métadonnées) |
| Adresses conservées | oui, **localement**, bornées et expurgées à l'export |
| Envoi réseau | aucun |
| Télémétrie | aucune |
| Fréquence d'échantillonnage | 10 s (sockets) / 60 s (pare-feu) / événementiel (journal) |
| CPU cible | < 1 % en veille |
| Mémoire cible | < 40 Mo |
| Écritures disque | uniquement à l'insertion d'un `Finding` (jamais de boucle d'écriture) |
| Écriture dans les dossiers surveillés | interdite (`docs/SPRINT9_SECURITY.md:13`) |

---

## 8. Modèle de données (Rust)

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    pub rule_id: String,
    pub status: FindingStatus,      // Observed | Suspected | Confirmed
    pub confidence: u8,             // 0..=100
    pub title: String,
    pub detail: String,
    pub sources: Vec<SourceId>,     // Netmon, Firewall, EventLog, WebGuard
    pub evidence: serde_json::Value,
    pub first_seen: String,         // RFC 3339 UTC
    pub last_seen: String,
    pub occurrences: u32,
    pub acknowledged_at: Option<String>,
}
```

Le champ `evidence` est tronqué côté backend avant sérialisation : le
frontend ne reçoit jamais plus de 4 KiB par `Finding`.

---

## 9. Surface de commandes (proposition)

| Commande | Rôle |
|---|---|
| `intrusion_snapshot` | état courant : sources disponibles/indisponibles, findings récents, compteurs |
| `intrusion_history(limit)` | liste bornée, la plus récente d'abord |
| `intrusion_acknowledge(id)` | acquittement explicite (même motif que `firewall_acknowledge_baseline`) |
| `intrusion_set_watch(enabled)` | **consentement explicite** avant tout démarrage de boucle |
| `intrusion_export` | export JSON + sidecar SHA-256 |

Aucune commande de blocage, de quarantaine réseau ou de mutation.

---

## 10. Démarrage de la surveillance : consentement

Reprise exacte du modèle du Proactive Monitor
(`src-tauri/src/commands/proactive.rs:119-158`,
`proactive_worker.rs:71-86`, `docs/SPRINT9_PROACTIVE.md:32`) :

1. La surveillance est **désactivée** après installation.
2. L'activation exige une action utilisateur explicite et une phrase de
   confirmation dans l'interface.
3. L'état est persisté dans `settings` ; un redémarrage ne réactive pas une
   surveillance qui n'était pas consentie.
4. L'arrêt est coopératif (jeton d'annulation + compteur de génération pour
   éviter deux boucles concurrentes).

---

## 11. Ce qu'Intrusion Guard ne pourra pas faire (et doit dire)

- Ne voit pas la **décision effective** du pare-feu (WFP/IPsec non calculés —
  `FIREWALL_ARCHITECTURE.md:237-238`).
- Ne voit pas le DNS réellement système : seul le proxy boucle locale est
  visible, et il est contournable par DoH/DoT
  (`docs/SPRINT8_DNS_FILTERING.md:99`).
- Ne fonctionne pas quand l'application est fermée : pas de service permanent
  (`docs/SPRINT9_PROACTIVE.md:86`).
- Ne résiste pas à un attaquant déjà élevé : les lignes de base et sidecars ne
  sont pas signés (`SECURITY.md:89-91`).
- Ne remplace pas Microsoft Defender, qui reste la seule protection continue.

Ces cinq limites doivent être affichées dans l'écran « Network Security &
Intrusion Alerts », pas reléguées dans une page d'aide.

---

## 12. Découpage proposé

| Phase | Contenu | Prérequis |
|---|---|---|
| **0** | Schéma v3 + `Finding` + commandes lecture/acquittement/export, **sans aucune règle** | migration testée |
| **1** | Règles réseau (R-A, R-B, R-C, R-D) sur `netmon`, apprentissage 24 h | phase 0 |
| **2** | Règles configuration (R-E, R-F) sur `firewall` | phase 1 |
| **3** | Lecture du journal Windows (R-G, R-H, R-I) avec histoire de disponibilité | décision explicite sur l'accès *Event Log Readers* |
| **4** | Interface « Network Security & Intrusion Alerts » | maquette approuvée (voir `SPRINT92_UI_UX_REDESIGN.md`) |

Chaque phase livre ses propres tests et sa propre section de limites.

---

## 13. Points de réutilisation (à appeler, pas à réécrire)

| Besoin | À réutiliser |
|---|---|
| Instantané sockets | `cbs_netmon::capture_snapshot` — `crates/cbs-netmon/src/sys.rs:437` |
| Delta de trafic | `cbs_netmon::traffic_delta` — `lib.rs:107`, mémorisation `state.rs:213-221` |
| Lecture pare-feu + empreintes + alertes | `cbs_firewall::inspect:423`, `rules_fingerprint:196`, `security_alerts:278` |
| Ligne de base + acquittement | `commands/firewall.rs:129-215`, `:266-274` |
| Persistance bornée | `Store::insert_netmon_snapshot` — `crates/cbs-store/src/lib.rs:531` |
| Boucle consentie | `proactive_worker.rs:71-133`, `commands/proactive.rs:119` |
| Déduplication notifications | `NotifyRing::admit` — `src-tauri/src/notify.rs:24` |
| Lecture d'état de service sans nouvelle dépendance | `query_service_state` — `commands/firewall.rs:67-108` |
| Enregistrement des commandes | `src-tauri/src/lib.rs:53-108` |
