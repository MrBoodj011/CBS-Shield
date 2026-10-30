# Sprint 9.2 — Rapport d'acceptation native (Windows)

**Artefact :** `CBS Shield_0.9.0-dev_x64-setup.exe`
**SHA-256 :** `d5a8b626a7797110aa8006f4ab69648a9a9f41581ba4bb08e32f33ae2f90b1fd`
**Environnement :** VM isolée `CBS-Shield-Sprint7` (Windows 11 Ent. Eval 26100),
utilisateur `cbs`, 1024×768 @ 125 %, sans outil de développement installé.
**Installeur dans l'invité :** identique octet pour octet au bundle du dépôt
(voir `SPRINT92_VM_VALIDATION.md` §2).

Légende : **VÉRIFIÉ** = exécuté et observé · **ÉCHEC** = exécuté, résultat
négatif · **BLOQUÉ** = dépend d'un défaut non corrigé · **NON EXÉCUTÉ** =
volontairement non lancé, aucune conclusion.

---

## 1. Matrice d'acceptation

| # | Critère | Statut | Preuve / motif |
|---|---|---|---|
| 1 | Démarrage sans outillage de développement | **VÉRIFIÉ** | lancement de `C:\Users\cbs\AppData\Local\CBS Shield\cbs-shield.exe` ; aucun serveur de dev, WebView2 fourni par le runtime Edge ; processus enfant `msedgewebview2.exe --embedded-browser-webview=1` |
| 2 | Icône de barre d'état (tray) | **VÉRIFIÉ (partiel)** | icône présente et pastille de comptage observée (`http/sprint92-tray*.png`) ; le menu contextuel et ses destinations n'ont pas été rejoués dans cette session |
| 3 | Notifications Windows natives | **NON EXÉCUTÉ** | plugin `tauri-plugin-notification` enregistré côté Rust uniquement ; aucune détection proactive déclenchée cette session |
| 4 | Analyse manuelle | **VÉRIFIÉ** | §5 de `SPRINT92_VM_VALIDATION.md` : 145 fichiers, 0 erreur, 1 détection |
| 5 | Auto-analyse du Proactive Monitor avec consentement explicite | **NON EXÉCUTÉ** | double verrou vérifié dans le code (`commands/proactive.rs:119-158`, `proactive_worker.rs:71-86`) ; parcours UI non rejoué |
| 6 | Mise en quarantaine | **ÉCHEC** | aucun `*.cbsq` sur tout `C:\` ; coffre vide ; voir A1/A2/A3 |
| 7 | Restauration depuis la quarantaine | **BLOQUÉ** | dépend de 6 |
| 8 | Purge d'un élément | **BLOQUÉ** | dépend de 6 |
| 9 | Web Guard | **NON EXÉCUTÉ** | validé au Sprint 8 sur la même VM ; non rejoué ici |
| 10 | Network Monitor | **NON EXÉCUTÉ** | page ouverte, rendu non confirmé de façon fiable |
| 11 | Firewall Monitor | **NON EXÉCUTÉ** | non lancé cette session |
| 12 | Français | **VÉRIFIÉ** | interface entièrement en français |
| 13 | Anglais | **NON EXÉCUTÉ** | bascule de langue non exercée |
| 14 | Thème sombre | **VÉRIFIÉ** | thème par défaut observé |
| 15 | Thème clair | **NON EXÉCUTÉ** | non basculé |
| 16 | Persistance après redémarrage | **BLOQUÉ** | voir A1 — aucune écriture SQLite |
| 17 | Désinstallation propre | **NON EXÉCUTÉ** | reportée après correction de A1 |

**Score honnête :** 4 critères vérifiés, 1 échec, 4 bloqués, 8 non exécutés.
Aucun critère non exécuté n'est compté comme réussi.

---

## 2. Points d'interface confirmés par le code et l'exécution

Le comportement de l'interface a été recoupé avec `ui/src/sections/Antivirus.tsx`
et `ui/src/lib/i18n.tsx`. Les libellés réellement présents dans le build ont été
vérifiés dans le source, et non lus uniquement sur capture.

| Élément affiché | Source |
|---|---|
| Onglets `Rapide / Complète / Personnalisée / Résultats` | `i18n.tsx:338-341` |
| Bandeau « Analyse à la demande uniquement » | `i18n.tsx` (`av.limits.*`) |
| Panneau d'analyse en cours (`Fichiers indexés`, `Fichiers analysés`) | `i18n.tsx:392-399` |
| Mention « La détection est une information, pas une action » | `av.result.detectionsHint` |

Le statut affiché est honnête : le produit ne prétend ni protection temps réel
ni suppression automatique.

---

## 3. Défauts natifs à corriger avant 0.9.0

| Réf. | Sévérité | Description |
|---|---|---|
| A1 | **Critique** | aucune écriture SQLite (WAL figé depuis le 28/10) → historique, quarantaine et paramètres non persistés |
| A2 | **Critique** | le coffre de quarantaine n'est jamais écrit alors que le fichier source disparaît |
| A3 | **Critique** | `store()` supprime le blob chiffré si `remove_file(source)` échoue (perte définitive) |
| A4 | Majeur | signatures `.ndb` personnalisées non appliquées par l'analyse intégrée |
| A5 | Majeur | absence de garde mono-instance |
| A6 | Mineur | état d'accueil stocké uniquement dans le profil WebView2 |

Aucun de ces défauts ne peut être contourné par la documentation : ils doivent
être corrigés et re-testés dans la VM avant toute publication.

---

## 4. Ce qui requiert une décision du propriétaire

1. **Priorité de correction** : A1/A2/A3 en premier (ils invalident la promesse
   « quarantaine réversible »), puis A4 et A5.
2. **Campagne de re-test** : après correction, la matrice complète (lignes 6-17)
   doit être rejouée sur un instantané propre de la VM.
3. **Image VM** : corriger la dérive d'horloge (A7) avant de rejouer les tests
   dépendant de TLS, sinon les échecs `freshclam` réapparaîtront sans rapport
   avec le produit.

> Registre consolidé, gravités et conditions de sortie : `docs/SPRINT92_RISK_REGISTER.md`.
> Régression de sécurité de ce sprint : `docs/SPRINT92_SECURITY_REGRESSION.md`.
