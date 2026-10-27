# Sprint 6 — Régression de sécurité

**Version :** `0.6.0-dev`
**Date :** 27 octobre 2026
**Objet :** vérifier que le Sprint 6 n'a pas affaibli Defender, le pare-feu Windows,
les services système ou les données utilisateur.
**Verdict :** ✅ aucune mutation de sécurité observée sur l'hôte — ⛔ plusieurs
scénarios restent non testés (VM propre, pare-feu actif, installation réelle de
ClamAV en absence de moteur).

---

## 1. Garanties vérifiées

| Garantie | Méthode | Résultat |
| --- | --- | --- |
| Defender actif | `Get-MpComputerStatus` | ✅ `AntivirusEnabled=True`, `RealTimeProtectionEnabled=True` |
| Service Defender actif | `AMServiceEnabled` | ✅ `True` |
| Comportement Defender actif | `BehaviorMonitorEnabled` | ✅ `True` |
| Aucune exclusion CBS Shield | `Get-MpPreference.ExclusionPath` | ✅ 0 correspondance CBS Shield / Cybrense |
| Pare-feu non activé/désactivé par CBS Shield | `Get-NetFirewallProfile` | ✅ état inchangé, 3 profils désactivés |
| Services pare-feu présents | `Get-Service MpsSvc,BFE` | ✅ `Running`, `Automatic` |
| Aucune règle CBS Shield | `Get-NetFirewallRule` | ✅ 0 règle CBS Shield sur 657 |
| Aucun service CBS Shield | `Get-Service` | ✅ 0 |
| Aucune tâche CBS Shield | `Get-ScheduledTask` | ✅ 0 |
| Aucune commande de mutation dans le code | recherche source ciblée | ✅ 0 occurrence |
| Installeur non signé | `Get-AuthenticodeSignature` | ⚠️ `NotSigned` — connu |
| Données conservées après désinstallation | hashes avant/après | ✅ identiques |

Les recherches source couvraient notamment `New-NetFirewallRule`,
`Set-NetFirewallRule`, `Remove-NetFirewallRule`, `Enable-NetFirewallRule`,
`Disable-NetFirewallRule`, `netsh`, `Add-MpPreference`, `Set-MpPreference`,
`DisableRealtimeMonitoring`, `bcdedit`, `New-Service`, `sc create` et les appels
`put_*` du pare-feu. **Aucune occurrence** dans le backend et les crates concernés.

---

## 2. État réel de l'hôte après les tests

### 2.1 Pare-feu

```text
Domain    Enabled=False   Inbound=NotConfigured   Outbound=NotConfigured
Private   Enabled=False   Inbound=NotConfigured   Outbound=NotConfigured
Public    Enabled=False   Inbound=NotConfigured   Outbound=NotConfigured
MpsSvc    Running  Automatic
BFE       Running  Automatic
TotalFirewallRules=657
CBSShieldFirewallRules=0
```

Le pare-feu était déjà désactivé au début du Sprint 6. CBS Shield ne l'a ni activé,
ni désactivé, ni réparé. L'interface affiche cet état comme une alerte de sécurité et
ne prétend pas que la machine est protégée.

### 2.2 Détection de changement

Pendant la validation, le nombre de règles est passé de **659 à 657** entre deux
observations. CBS Shield a :

- détecté et affiché la différence ;
- conservé l'ancienne référence ;
- attendu un acquittement explicite ;
- **jamais** créé, supprimé ou modifié une règle.

La capture `sprint6-firewall-fr-change.png` montre cet état avant acquittement.
L'origine exacte du changement Windows n'a pas été attribuée ; elle n'est pas
imputée à CBS Shield et aucune réparation n'a été tentée. La nouvelle référence a
ensuite été acceptée manuellement dans l'interface, ce qui ne modifie que l'état
local de CBS Shield.

### 2.3 Snapshot

Les snapshots finaux sont des exports d'audit :

| Langue | Fichier | SHA-256 | Règles |
| --- | --- | --- | ---: |
| FR | `firewall-snapshot-20261027T135517Z.json` | `21c785585dc3211b33f4f2519161ab327f9dd3ff1afdc510c4acdf8491d0d2cd` | 657 |
| EN | `firewall-snapshot-20261027T135555Z.json` | `581d06218da215171b59df878065a0e0d7c168c3c97d1cd99b42927376f5fb67` | 657 |

Champs vérifiés : `readOnly: true`, `restoreSupported: false`, `exportedAt` présent.
Le SHA-256 affiché dans l'interface correspond au fichier. Aucun import ou restore
n'existe.

### 2.4 Données utilisateur

La désinstallation a supprimé le dossier d'application, le raccourci et l'entrée
HKCU, mais a conservé :

- `cbs-shield.db` — SHA-256 `89A2318C76452BE80E1D743F163F3DD96623B2B05604AA06985C6B5501238362` ;
- `cbs-shield.db-wal` — SHA-256 `5860575C6A7BDAD24439B9F726ED8BFE11C923960B5CC6C8089B41E32F72B699` ;
- `cbs-shield.db-shm` — SHA-256 `C92100B5DC1457C498E28D45263BD856362B4EB9E4D80124C26ADCD7C76C3C09` ;
- `quarantine.key` — SHA-256 `368CE2791D3E655D7731A1EE76397F4704B790CDA377291D36A6EC829ED005DB` ;
- `updates.log` ;
- 8 fichiers ClamAV locaux ;
- 8 snapshots pare-feu.

Les hashes étaient identiques avant et après désinstallation.

---

## 3. Surface d'attaque et privilèges

- CBS Shield fonctionne en **utilisateur courant**. L'installeur est `currentUser`
  et son manifeste déclare `asInvoker`.
- Aucune élévation automatique de CBS Shield. L'installation ClamAV peut provoquer
  un UAC distinct ; il n'a pas été contourné.
- Aucun pilote noyau, filtre WFP, service CBS Shield, hook ou pare-feu tiers.
- Les commandes IPC restent limitées à la lecture, aux scans, à la quarantaine, aux
  réglages et au lancement explicite de l'installation ClamAV.
- Les exports et rapports restent locaux ; aucune télémétrie ni envoi réseau.
- Les journaux techniques externes peuvent contenir des chemins locaux et rester en
  anglais ; l'interface l'explique.

---

## 4. Risques résiduels

| Risque | Niveau | Traitement |
| --- | --- | --- |
| Installeur non signé / SmartScreen | Élevé pour la distribution | SHA-256 publié, non signé assumé ; certificat requis plus tard |
| VM Windows propre non testée | Élevé | À exécuter avant production |
| Installation réelle sans ClamAV non testée | Élevé | Consentement et code testés, parcours complet non exécuté |
| Pare-feu actif non testé | Moyen | Hôte désactivé ; aucune politique modifiée |
| Restauration de règles absente | Moyen | Plan affiché comme non actif ; aucune capacité exposée |
| Snapshot local non signé | Faible/Moyen | SHA-256 détecte l'altération accidentelle, pas un adversaire élevé |
| Décision effective du pare-feu non calculée | Moyen | Distinction explicite dans l'UI ; pas de fausse garantie |
| Logs externes non traduits | Faible | Mention dans Paramètres |

---

## 5. Conclusion

Les contrôles disponibles confirment que le Sprint 6 **n'a pas modifié Defender, le
pare-feu, les services système ni les données**. Le module pare-feu reste strictement
observationnel. Cette régression est réussie sur l'hôte, mais elle ne remplace pas une
validation en VM isolée avec un pare-feu actif et une installation réelle de ClamAV.
