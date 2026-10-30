# État du développement — CBS Shield 0.9.0-dev

**Date de vérification :** 30 octobre 2026
**Branche :** `sprint-9` (commit `0160f2f` + Sprint 9.1)
**Nature :** version expérimentale — antivirus manuel, assistant de préparation,
installation officielle de ClamAV, observation réseau et pare-feu strictement en
lecture seule, prototype Web Guard de filtrage DNS local, historique de sécurité,
surveillance proactive de fichiers (observateur, pas antivirus temps réel) et
analyse automatique optionnelle de la file d'observation.

Ce document décrit ce qui a été **réellement implémenté et vérifié**, ce qui
reste **bloqué ou non exécuté**, et les limites connues. Aucune fonctionnalité
non testée n'est présentée comme opérationnelle. Le détail de recette est dans
[`docs/SPRINT9_NATIVE_TEST_REPORT.md`](docs/SPRINT9_NATIVE_TEST_REPORT.md),
[`docs/SPRINT9_TEST_REPORT.md`](docs/SPRINT9_TEST_REPORT.md) et
[`docs/SPRINT9_PROACTIVE_INTEGRATION.md`](docs/SPRINT9_PROACTIVE_INTEGRATION.md).

---

## 1. Livré (Sprint 9 + 9.1)

- Module **CBS Proactive Monitor** (crate `cbs-proactive`) : scrutation bornée,
  file d'analyse bornée, backpressure, baseline silencieuse, pause/reprise/arrêt,
  persistance `proactive.json`, consentement explicite de relance.
- Analyse automatique optionnelle de la file d'observation via un ouvrier
  consenti qui réutilise le `Scanner` ClamAV validé (aucune suppression ni
  quarantaine automatique ; audit complet dans l'historique).
- Plateau Windows étendu : Ouvrir / Quarantaine / Moniteur réseau / Quitter
  (FR/EN) avec navigation via `tray-navigate`.
- Notifications natives Windows dédupliquées (scan terminé, détection,
  échec moteur) avec anneau de 16 clés.
- Interface : nouvelle section `proactive` (groupe Protection), métriques
  réelles, gestion des dossiers, limites de ressources, statut de l'ouvrier.
- Version alignée `0.9.0-dev` (Cargo, Tauri, npm, lockfiles, interface).
- Suite locale : **148 tests Rust** + **34 tests frontend** réussis,
  `cargo fmt` et Clippy sans avertissement, `tsc` et build Vite propres.
- Production NSIS : `CBS Shield_0.9.0-dev_x64-setup.exe`, 2 903 396 octets,
  SHA-256 `D5A8B626A7797110AA8006F4AB69648A9A9F41581BA4BB08E32F33AE2F90B1FD`.
- Documentation : rapports natif, intégration proactive, régression sécurité,
  audit installeur, validation VM, captures d'écran (10 PNG).

## 2. Non livré / bloqué

- Validation VM complète (installation, ClamAV portable, upgrade, désinstallation,
  restauration réseau) : **bloquée** (instabilité historique de la VM Sprint 7 ;
  démarrage et capture d'écran VM réussis, mais aucune installation exécutée).
- Notifications live non observées (Microsoft Defender bloque la lecture EICAR
  par ClamAV, erreur 225) — aucune exclusion ajoutée.
- Plateau Windows non exercé en interaction réelle (code compilé et revu).
- Thème clair non capturé ; scan/quarantaine non exécutés dans l'interface
  graphique (pilotage par boîte de dialogue non automatisable proprement).
- Installeur non signé (Authenticode : NotSigned) — volontaire, pas de
  certificat disponible.

## 3. Limites connues et honnêtes

- Le moniteur proactif est un **observateur**, pas un antivirus temps réel ;
  granularité = intervalle de cycle (1–30 s).
- L'analyse automatique reste **opt-in** et ne supprime ni ne met en
  quarantaine automatiquement.
- La surveillance ne fonctionne que pendant l'exécution de l'application.
- Aucune modification de Microsoft Defender, aucune exclusion, aucune règle
  pare-feu, aucune modification DNS système.
- Aucun échantillon de malware réel ; seul le fichier de test EICAR standard
  (inoffensif) a été utilisé en ligne de commande.

## 4. Prochaines étapes suggérées (Sprint 10)

1. Exécuter la recette complète sur la VM (ou une nouvelle VM stable) avec
   le SHA-256 de référence.
2. Piloter l'interface graphique (scan, quarantaine, notifications) en
   capturant les résultats.
3. Obtenir un certificat de signature de code et signer l'installeur.
4. Raccorder les notifications « signatures obsolètes » à la programmation
   FreshClam existante.
5. Éventuellement chiffrer le cache d'empreintes si la persistance devient
   utile.
