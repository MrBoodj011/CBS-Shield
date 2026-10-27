# Sprint 5 — Non-régression sécurité

**Version :** `0.5.0-dev` — branche `sprint-5`
**Date :** 27 octobre 2026
**Périmètre :** assistant de premier lancement, provisioning ClamAV, pare-feu
lecture seule enrichi, installeur NSIS.

Ce document liste les garanties vérifiées **par le code et les tests**, puis les
risques résiduels et les vérifications **non exécutées**. Il ne remplace pas une
revue de sécurité indépendante.

---

## 1. Garanties vérifiées

### 1.1 Pare-feu Windows — aucune mutation

| Contrôle | Preuve | Résultat |
| --- | --- | --- |
| Aucun appel `put_*` dans le crate pare-feu | recherche dans `crates/cbs-firewall/src` | ✅ aucun |
| Aucune commande IPC de création/modification/suppression de règle | `src-tauri/src/commands/firewall.rs` | ✅ aucune |
| Gestion de règles verrouillée | `firewall_management_status`, `rule_writes_allowed = false` | ✅ testé |
| Création/modification refusée côté backend | gates renvoyant une erreur explicite | ✅ testé |
| Aucun pilote noyau, service, filtre WFP ou pare-feu tiers | dépendances et code | ✅ aucun |
| Defender non modifié (état, exclusions) | aucun appel Defender | ✅ aucun |
| Lecture sans élévation | API COM `INetFwPolicy2`, aucun manifeste admin | ✅ constaté |

Le module ne « protège » pas le réseau : il observe l'état de Microsoft Defender
Firewall. Il ne remplace pas, ne désactive pas et ne contourne pas le pare-feu
Windows.

### 1.2 Détection de changement — pas de réparation automatique

- L'empreinte est composite : profils + actions par défaut + **toutes** les règles
  (le hash porte sur l'intégralité, pas sur les 1 000 lignes affichées).
- Une différence produit une **alerte informative**. CBS Shield ne modifie rien,
  ne restaure rien et n'attribue pas la cause du changement.
- La baseline n'avance **que** lors de la première observation ou après
  acquittement explicite de l'utilisateur (`acknowledge_firewall_baseline`).
- Un échec de lecture ne remplace pas la baseline : l'erreur est exposée, l'ancienne
  empreinte reste intacte.
- L'export JSON est **en lecture seule** (`readOnly: true`) et ne peut pas être
  restauré : aucune commande d'import n'existe.

### 1.3 Alertes de sécurité

Les alertes sont dérivées de l'état réel :

- tous les profils désactivés ;
- un profil actif désactivé ;
- action entrante par défaut `Allow` sur un profil actif ;
- changement de configuration depuis la baseline ;
- incohérence éventuelle entre profils actifs et état global.

Une alerte n'est **jamais** présentée comme une preuve d'intrusion. Quand tous les
profils sont désactivés, l'interface affiche explicitement que CBS Shield ne peut
pas conclure à une protection réseau.

### 1.4 Mapping connexion → règle

- Le mapping exige un **chemin d'image réel** fourni par le système.
- Un processus générique (`System`, PID 4) sans chemin d'image n'est **pas** mappé
  arbitrairement.
- Le résultat est présenté comme une **référence** (« règle correspondante
  possible »), pas comme un verdict d'autorisation ou de blocage.
- Aucune connexion n'est ouverte, interceptée ou bloquée par CBS Shield.

### 1.5 Assistant de premier lancement et ClamAV

| Contrôle | Preuve | Résultat |
| --- | --- | --- |
| Installation ClamAV jamais silencieuse | commande `winget` avec console visible, sans `--silent` | ✅ test de politique |
| Autorisation explicite obligatoire | case à cocher + confirmation avant lancement | ✅ testé |
| Paquet officiel uniquement | `Cisco.ClamAV` épinglé, arguments fixes | ✅ testé |
| Aucune élévation automatique | l'installeur CBS Shield reste `currentUser` ; l'UAC éventuel de winget est visible | ✅ conception |
| Aucun ClamAV ni signature embarqué | bundle NSIS et `tauri.conf.json` | ✅ vérifié |
| Aucun téléchargement de signature hors `freshclam` | `freshclam` officiel, configuration locale | ✅ code |
| ClamAV reste externe GPL-2.0 | aucun binaire redistribué | ✅ |
| Diagnostic en cas d'échec | sortie, code, étapes de reprise affichés | ✅ testé / UI |

L'assistant ne peut pas installer ClamAV sans action de l'utilisateur. Il ne
télécharge pas de binaire depuis un site arbitraire et ne désactive pas Defender
pour faire aboutir l'installation.

### 1.6 Quarantaine et scans — non-régression

Les garanties des sprints précédents restent en place :

- quarantaine AES-256-GCM, clé DPAPI, restauration sans écrasement, SHA-256
  revérifié, purge à double confirmation ;
- aucun fichier détecté n'est exécuté ;
- aucun scan n'est lancé automatiquement ;
- les chemins sont canonicalisés et le dossier de données est refusé comme cible ;
- un scan propre reste présenté comme **manuel**, jamais comme une protection
  complète.

### 1.7 Surface IPC et réseau

- CSP inchangée : `default-src 'self'`, scripts limités à l'origine locale.
- Aucun serveur CBS Shield, aucun compte, aucune télémétrie.
- Le seul trafic sortant est `freshclam` (action explicite) et `winget` (action
  explicite de l'assistant) ; aucun envoi de fichier ou de rapport.
- Les commandes ajoutées valident leurs entrées et n'exposent aucun chemin
  d'écriture arbitraire.

---

## 2. Résultats des tests de sécurité

| Test | Commande / preuve | Résultat |
| --- | --- | --- |
| Suite Rust complète | `cargo test --workspace` | ✅ 92 réussis, 1 ignoré |
| Politique d'installation ClamAV | test unitaire `commands::signatures` | ✅ |
| Gates de gestion pare-feu | tests `commands::firewall` | ✅ |
| Profils / empreintes / alertes | tests `cbs-firewall` | ✅ |
| Mapping par chemin réel | tests `cbs-netmon` / commandes | ✅ |
| Export snapshot en lecture seule | test + fichier réel | ✅ |
| Interface sans fausse protection | tests Dashboard / Firewall / SetupWizard | ✅ |
| Build production sans Vite | binaire release + inspection CDP | ✅ |
| Absence de `put_*` | recherche statique | ✅ |
| Absence de commande de mutation | inventaire IPC | ✅ |

---

## 3. Risques résiduels

1. **Installeur non signé** : SmartScreen peut afficher un avertissement. Le
   SHA-256 publié permet de vérifier l'artefact, mais ne remplace pas une signature
   Authenticode.
2. **Dépendance à winget et à l'UAC** : l'installation de ClamAV peut échouer ou
   être refusée. Le cas d'échec réel n'a pas été rejoué (ClamAV déjà installé).
3. **Pare-feu désactivé au niveau OS** : CBS Shield l'affiche, mais ne peut pas
   protéger un poste dont le pare-feu Windows est coupé. Aucune correction
   automatique n'est proposée.
4. **Baseline locale non signée** : un processus élevé pourrait modifier la base
   SQLite et la baseline. CBS Shield ne se défend pas contre un administrateur
   compromis.
5. **Mapping indicatif** : une règle correspondante n'est pas une preuve que le
   trafic est autorisé ou bloqué.
6. **Faux positifs ClamAV** : la détection générique `Packed` peut signaler un
   binaire légitime. La marche à suivre est documentée dans
   [`SPRINT5_MALWARE_INVESTIGATION.md`](SPRINT5_MALWARE_INVESTIGATION.md).
7. **Pas de validation VM propre** : les garanties d'installation, de premier
   lancement sans outils de développement et de désinstallation sont partiellement
   vérifiées sur le poste hôte uniquement.

---

## 4. Vérifications explicitement non exécutées

- Validation sur VM Windows 11 propre (aucun outil de VM disponible / autorisé).
- Installation réelle de ClamAV par l'assistant (ClamAV déjà présent ; aucune
  désinstallation imposée).
- Scénario « WebView2 absent », « réseau absent », « disque plein », « UAC
  refusé ».
- Modification de règle de pare-feu : **hors périmètre et volontairement
  impossible**.
- Scénario avec profils de pare-feu actifs : tous les profils sont désactivés sur
  le poste de validation ; les alertes correspondantes sont testées par le code,
  pas observées en conditions réelles.
- Test d'intrusion, test d'évasion, analyse dynamique de malware.
- Désactivation de Microsoft Defender ou ajout d'exclusion : **interdit et non
  effectué**.
- Exécution du fichier détecté `Freebuff-0.0.158-win-x64.exe` : **non effectuée**.

---

## 5. Conclusion

Les contrôles de sécurité du périmètre Sprint 5 sont cohérents avec les
restrictions du projet : **aucune capacité active de pare-feu**, **aucune
installation silencieuse**, **aucune modification de Defender**, **aucun malware
exécuté**. La validation en machine propre et plusieurs scénarios d'échec restent
bloqués ; le sprint ne doit donc pas être déclaré entièrement validé.
