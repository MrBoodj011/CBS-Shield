# Sprint 6 — Risques non résolus et conditions de sortie

**Version :** `0.6.0-dev`
**Date :** 27 octobre 2026
**Statut :** ⚠️ **non production-ready**
**Principe :** aucun risque bloqué n'est masqué par un test local réussi.

---

## 1. Risques bloquants pour une release de production

| # | Risque | Impact | Preuve / état | Condition de sortie |
| ---: | --- | --- | --- | --- |
| R1 | Installeur **non signé** | SmartScreen, usurpation, absence de garantie d'éditeur | `NotSigned`, aucun certificat | Certificat Authenticode, signature vérifiée, hash publié |
| R2 | Aucune installation sur **Windows 11 propre** | WebView2, UAC, chemins, données neuves non vérifiés | pas de VM disponible | Recette VM complète, FR et EN |
| R3 | Parcours **ClamAV absent** non exécuté | installation officielle, UAC, échec et reprise non prouvés | ClamAV déjà installé ; désinstallation non autorisée | VM sans ClamAV, test consentement/annulation/échec/succès |
| R4 | Matrice d'échec installeur non exécutée | comportement sur réseau coupé, disque plein, WebView2 absent inconnu | pas de VM jetable | tests destructifs en VM + récupération |
| R5 | Upgrade inter-versions non testé | migration 0.5 → 0.6 inconnue | aucune VM, pas de paquet 0.5 installé | test upgrade + rollback |
| R6 | Restauration de pare-feu **non implémentée** | pas de rollback réel | `restoreSupported: false`, plan `designOnly` | implémentation séparée, VM isolée, rollback répété, autorisation |

---

## 2. Risques fonctionnels et de sécurité

| # | Risque | Niveau | Réduction actuelle | Reste à faire |
| ---: | --- | --- | --- | --- |
| R7 | Pare-feu avec profil **actif** non testé | Moyen | hôte désactivé, UI alerte, aucune mutation | test VM avec profils actifs et règles contradictoires |
| R8 | Décision effective du pare-feu non calculée | Moyen | distinction explicite référence/décision | documenter les limites WFP/IPsec/GPO |
| R9 | Snapshot local non signé | Faible/Moyen | SHA-256 affiché et vérifié | signature ou stockage protégé si requis |
| R10 | `winget`/installateur peut survivre au délai CBS Shield | Moyen | timeout 20 min, message honnête, reprise | vérifier le processus enfant et l'état réel après timeout en VM |
| R11 | Journaux externes non traduits | Faible | mention dans Paramètres | décider du niveau de localisation |
| R12 | Accessibilité non auditée avec technologies d'assistance | Moyen | focus trap, ARIA, clavier | audit NVDA/Narrateur, contraste, zoom, mouvement réduit |
| R13 | Scan **Complet** non exécuté de bout en bout | Moyen | scan réel de fichiers/dossiers testé | disque de test, annulation, reprise |
| R14 | FreshClam hors ligne non testé | Faible/Moyen | états et logs | test réseau coupé, reprise, verrou |
| R15 | Aucun test de malware réel | Faible (volontaire) | EICAR documenté, aucune exécution | laboratoire isolé uniquement |

---

## 3. Risques acceptés explicitement pour cette version

- L'installeur est **non signé** ; le SHA-256 est le seul contrôle d'intégrité.
- CBS Shield ne fournit **aucune protection temps réel** et ne remplace pas Defender.
- Le pare-feu est **strictement en lecture seule** ; aucune gestion active.
- Les règles affichées sont une **référence**, pas la décision effective du noyau.
- Le plan de récupération est une **conception**, pas une fonctionnalité.
- ClamAV et les signatures ne sont **pas embarqués** ; ils restent externes GPL-2.0.
- Les tests hôte ne valent pas validation d'une machine neuve.
- Aucun malware réel n'est exécuté sur l'hôte de développement.

---

## 4. Conditions minimales avant de retirer le label expérimental

1. Signer l'installeur et vérifier la chaîne Authenticode.
2. Exécuter la recette Windows 11 propre, hors ligne puis en ligne.
3. Valider l'installation officielle de ClamAV en absence de moteur, y compris UAC,
   annulation, timeout, `winget` absent et reprise.
4. Tester les échecs installeur : WebView2 absent, disque plein, réseau coupé, arrêt
   brutal, désinstallation interrompue.
5. Tester upgrade 0.5 → 0.6 et rétrogradation ou documenter l'absence de support.
6. Valider le pare-feu sur VM avec profils actifs, sans mutation, et vérifier les
   alertes de changement.
7. Si la gestion active est un jour activée : VM isolée, snapshot, restauration
   éprouvée, rollback répété, autorisation distincte et revue de sécurité.
8. Audit accessibilité réel et validation FR/EN complète.
9. Documenter la politique de conservation des données à la désinstallation.
10. Recalculer et publier le SHA-256 du nouvel artefact après chaque changement de
    code.

---

## 5. Décision de statut

Le Sprint 6 est **livré en code et validé localement** : tests Rust/UI réussis,
installeur construit et testé sur l'hôte, captures réelles FR/EN, aucune mutation de
sécurité observée. Il **n'est pas déclaré prêt pour la production** à cause des
risques R1–R6 et des scénarios non exécutés ci-dessus.

Tant que ces conditions ne sont pas satisfaites, la communication doit rester :
**version expérimentale, analyse manuelle, Defender actif, pare-feu observé seulement.**
