# Architecture Pare-feu — CBS Shield 0.2.0-dev

**Date :** 25 octobre 2026 — sprint 2, fondation **strictement en lecture seule**.

Ce document décrit la fondation pare-feu livrée cette phase, les API utilisées et
pourquoi, les garde-fous absolus, et le plan d'évolution Phase 3 (hors périmètre
actuel, sans décision de conception engagée).

---

## 1. Périmètre livré (Phase 2, sprint 2)

### 1.1 Ce que fait le module

Un **observateur** de la stratégie Windows Firewall, exécuté à la demande de
l'utilisateur (bouton ou premier affichage de section) :

1. **Profil (domaine / privé / public)** :
   - état (`enabled`) par profil via `windows-firewall 0.8 → FwIsFirewallEnabled` ;
   - actions par défaut entrant/sortant via **COM direct** `INetFwPolicy2` ;
   - profils **effectivement actifs** via `CurrentProfileTypes()` (masque)
     — indispensable : le masque combiné (ex. privé+public = 6) n'est pas
     représentable par l'API mono-profil, et l'appel du crate échoue dessus
     (constat et contournement ci-dessous).
2. **Règles** : énumération bornée (affichage 1 000 premières), tri local
   (nom, programme), résumé honnête (nom, groupe, description, programme,
   service, direction, action, état, protocole, ports, profils). Le comptage
   total et l'**empreinte** portent sur l'intégralité, pas la liste affichée.
3. **Détection de modification** : empreinte SHA-256 du jeu de règles
   (`rules_fingerprint`) + heure, stockés **localement** (`firewallRulesHash`,
   `firewallCheckedAt` en réglages) et comparés à l'observation précédente.
   La bannière « configuration différente » affiche la date de l'observation
   précédente et **n'incrimine nobody** : CBS Shield ne connaît pas la cause
   du changement, il constate une différence.

### 1.2 Ce que le module **ne fait pas** (garde-fous absolus)

- **Aucune écriture** dans la stratégie : aucun `put_*` n'existe dans le code
  (vérifiable dans `crates/cbs-firewall/src/lib.rs`). L'API COM est appelée en
  lecture seule — mêmes signatures, jamais d'appel modificateur.
- **Aucune** élévation de privilèges, aucun batch UAC, aucune écriture registre
  security-policy.
- **Aucun** pilote noyau, aucun service, aucun hook, aucun filtre WFP, aucun outil
  tiers (Portmaster, TinyWall, etc.) — jamais installé, jamais embarqué.
- **Aucune** modification de Microsoft Defender (état, exclusions, RCDATA) —
  Defender / pare-feu Windows reste sous le contrôle exclusif de Windows.
- Le module ne « protège » rien : il ne bloque aucune connexion. La sécurité
  passe par Windows lui-même.

### 1.3 API et dépendances

| Lecture | API | Note |
| --- | --- | --- |
| État des profils | `windows-firewall 0.8` (`MIT/Apache-2.0`) sur `windows 0.62` | crate tiers public, audit des sources |
| Défauts par profil, profils actifs | `windows 0.62` **COM direct** `INetFwPolicy2` | `CoInitializeEx(MTA)` — les threads bloquants tokio réutilisés seront possiblement déjà MTA par la couche précédente ; `CoUninitialize` uniquement si init réussi |
| Règles | `windows-firewall 0.8` `list_rules/count_rules` | lecture bornée de l'UI, empreinte complète |
| Constantes | `NET_FW_PROFILE_TYPE2` figées msdn (domaine 0x1, privé 0x2, public 0x4) | correction d'une constante erronée 0x3 → 0x4 (audit A-8) |

Pas de kernel driver, pas de driver signing, pas de démarrage en tant que service,
pas de privilège System.

## 2. Garde-fous d'implémentation

- **Pas d'appel `put_*`** : l'interface COM n'est utilisée qu'en lecture ; il n'y a
  pas de code « put_ » dans la base, même en debug.
- **Tout échec est explicite** : si la COM échoue, le module expose une erreur
  (`firewallUnavailable`) au lieu d'écrire « protégé » ou une valeur inventée.
  Les profils affichés en « Désactivé » viennent du système, pas d'une déduction.
- **Pas de fingerprint persisté si observation échoue** : la sauvegarde de
  l'empreinte n'arrive qu'après une lecture réussie (une lecture partiellement
  rompue ne pollue pas une empreinte).
- **Pas de stockage cloud, pas de télémétrie** — tout reste local (audits Phase 1:
  `SECURITY.md`).

## 3. Ouverture future (Phase 3) — explicitement non engagée

Ce document liste des pistes, **sans engagement de conception** :

1. **Alerte active** (notification) sur changement d'empreinte — hors périmètre
   Phase 2, déclenché au plus tôt au rafraîchissement manuel, jamais en tâche de fond.
2. **Gestion inverse de modifications** (si CBS Shield ajoutait une règle) :
   hors périmètre. Conception exigée : privilèges adaptés, mémorisation fine des
   modifications opérées, téléchargement/reverse en un clic, revue de sécurité.
3. **Surveillance continue** de la stratégie : hors périmètre (polling léger
   eventuel via tâche planifiée, jamais pilote).
4. **YARA-X** (Détection avancée) : autre piste Phase 3, non couverte ici.

Toute décision sera documentée ici avant l'implémentation.

## 4. Reproduire les vérifications

```powershell
cargo test -p cbs-firewall        # 3 tests, dont un COM réel
# Vérification croisée runtime (comparer la section Profils de l'app:)
Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction
```
