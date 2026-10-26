# Sprint 4 — Rapport sécurité et non-régression

Version : **0.4.0-dev** — 26 octobre 2026

## 1. Garanties conservées

| Garantie | Vérification |
| --- | --- |
| Microsoft Defender non désactivé | Aucun code ne touche à Defender ; aucun `Set-MpPreference`, aucune exclusion |
| Pare-feu non modifié | Module lecture seule ; aucune règle, aucun profil, aucune stratégie modifiée |
| Aucune exclusion automatique | Les seules exclusions sont des chemins internes/Windows lus par l'indexeur, jamais appliquées à Defender |
| Aucune élévation | Installeur `currentUser`, `freshclam` et `clamscan` sans admin |
| Aucun service/pilote | Aucun service Windows, pilote noyau ou tâche planifiée |
| Aucune suppression automatique | Quarantaine, restauration et purge exigent une confirmation ; purge avec phrase |
| Aucune télémétrie | Données SQLite locales, aucun compte, aucun envoi |
| Aucun malware réel | Fichiers inoffensifs + signature `.hsb` synthétique + EICAR uniquement en test ignoré |

### État réel du pare-feu

Pendant la validation, le pare-feu Windows était **réellement désactivé au
niveau OS**. L'application l'a signalé sans le réactiver, sans modifier de
stratégie et sans proposer d'action automatique. C'est un état observé, pas un
effet de CBS Shield.

## 2. Surface de commandes Tauri

Nouvelles commandes Sprint 4 :

- `resolve_scan_targets` : profils Quick/Full/Custom, chemins résolus côté
  backend ;
- `export_scan_report` : format JSON/CSV/Markdown/TXT, écriture via dialogue
  natif ;
- `signature_inventory` : inventaire `sigtool`, lecture seule ;
- `update_logs` : journaux locaux, taille bornée ;
- `provisioning_status` : détection winget/ClamAV, aucune installation ;
- `open_documentation` : URL **allowlist** uniquement (documentation officielle) ;
- mise à jour FreshClam : verrou exclusif, pas de chevauchement avec un scan.

Contrôles :

- les chemins personnalisés sont validés côté backend ; une cible inexistante
  est signalée, pas inventée ;
- les limites sont bornées (`ScanLimits::sanitized`) avant d'atteindre la ligne
  de commande ;
- ClamAV est lancé avec des arguments séparés (pas de shell), sans fenêtre ;
- les phrases de confirmation de purge acceptent `SUPPRIMER` (FR) et `DELETE`
  (EN), côté backend ;
- l'export ne peut écrire que dans le chemin choisi par le dialogue natif ;
- `dialog:allow-save` est la seule capability ajoutée.

## 3. Quarantaine

- Chiffrement AES-256-GCM ; clé protégée par DPAPI pour le compte Windows.
- Le fichier original est déplacé, pas copié ; aucune donnée laissée en clair.
- Restauration : confirmation explicite + case « je comprends ».
- Suppression : confirmation + phrase localisée, blob effacé, ligne d'audit
  conservée avec le statut `deleted`.
- Testé nativement : mise en quarantaine, restauration, purge.
- Aucune analyse automatique du coffre et aucune exécution du fichier restauré.

## 4. Intégrité des signatures

- Les composants officiels sont lus via `sigtool --info`, jamais par une
  estimation.
- Les fichiers `.sign` disponibles sont vérifiés ; l'intégrité est affichée
  composant par composant.
- Les signatures personnalisées sont comptées à part et ClamAV les marque
  `.UNOFFICIAL`.
- Une base manquante/corrompue n'est jamais présentée comme opérationnelle.
- Le nombre `28 164` est identifié comme révision CVD, pas comme total de
  signatures (voir [SPRINT4_ANTIVIRUS.md](SPRINT4_ANTIVIRUS.md)).
- Les journaux sont locaux et tronqués à l'affichage.

## 5. Non-régression

- Aucune migration de schéma SQLite.
- Les commandes existantes (scan, historique, quarantaine, réseau, pare-feu,
  paramètres, diagnostic) restent enregistrées.
- Les tests existants passent : 79 tests Rust, 18 tests UI.
- Le tableau de bord utilise désormais le total officiel de signatures et
  n'affiche plus la révision CVD comme un nombre de signatures.
- Les pages observation (réseau, pare-feu), quarantaine et paramètres ont été
  localisées sans modifier leurs commandes en lecture seule.
- Le scan rapide réel a toujours trouvé la détection préexistante et l'a
  conservée dans le rapport annulé.

## 6. Risques résiduels

| Risque | Niveau | Traitement |
| --- | --- | --- |
| ClamAV non installé | Moyen | état indisponible honnête, guide officiel, aucune fausse protection |
| Base de signatures ancienne | Moyen | âge affiché, seuil, mise à jour manuelle/auto |
| Scan complet très long | Faible/Moyen | annulation réelle, limites, priorité basse ; non validé de bout en bout |
| Faux positifs | Faible | détection nommée, quarantaine confirmée, restauration possible |
| Faux négatifs | Structurel | scanner manuel, pas de temps réel ; rappel explicite dans l'UI |
| Échec réseau non testé nativement | Faible | classification unitaire, base existante conservée, message hors ligne |
| Test VM propre absent | Moyen | non revendiqué ; installeur inspecté et testé sur l'hôte |
| Messages techniques FreshClam en langue d'origine | Faible | interface et messages applicatifs localisés ; détail technique brut |
| ClamAV GPLv2 non embarqué | Faible | installation officielle par l'utilisateur, licence documentée |
| Pare-feu OS désactivé | Informatif | signalé, jamais modifié |
| Signature de test résiduelle | Faible | retirée de la base utilisateur après les essais, non livrée |

## 7. Conclusion

Aucun contournement de Defender, aucune exclusion, aucune modification du
pare-feu, aucune suppression silencieuse, aucune donnée inventée. Les limites
restantes sont documentées et ne sont pas présentées comme validées.
