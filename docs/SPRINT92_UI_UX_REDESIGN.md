# CBS Shield — Spécification de refonte UI/UX (Sprint 9.2)

**Statut : PROPOSITION — aucune ligne de code d'interface n'est modifiée tant que le propriétaire du produit n'a pas approuvé une direction.**
Version applicative concernée : `0.9.0-dev` · Date : 2026-10-30 · Branche : `sprint-9`

Maquettes associées (concepts HTML statiques) :

| Fichier | Contenu |
| --- | --- |
| [`docs/sprint92-mockups/index.html`](sprint92-mockups/index.html) | Index des deux directions |
| [`docs/sprint92-mockups/direction-a-calme-souverain.html`](sprint92-mockups/direction-a-calme-souverain.html) | Direction A — Calme & Souverain |
| [`docs/sprint92-mockups/direction-b-console-compacte.html`](sprint92-mockups/direction-b-console-compacte.html) | Direction B — Console compacte |

Chaque maquette porte un bandeau fixe **« Maquette — concept, non implémenté »**. Aucun bouton des maquettes n'agit sur le système.

---

## 1. Pourquoi cette refonte

L'interface actuelle (`ui/src/sections/`, 11 sections) est fonctionnelle mais :

- expose **beaucoup de texte** et de libellés techniques (chemins, ports, politiques) au même niveau visuel ;
- ne hiérarchise pas clairement **ce qui est actif** et **ce qui ne l'est pas** ;
- répartit les fonctions sur des onglets de poids équivalent, sans regroupement par **domaine de risque** ;
- ne met pas en avant l'action principale (l'analyse) ni l'état vrai du poste.

La refonte vise une lecture immédiate en trois secondes : *que fait CBS Shield maintenant, et que ne fait-il pas.*

### Contraintes non négociables

1. **Vérité avant réassurance** — aucun état « protégé » vert si le moteur temps réel est absent. CBS Shield n'a pas de temps réel : l'UI doit le dire.
2. **Aucune revendication non prouvée** — le filtrage Web Guard est un proxy en boucle locale ; le pare-feu est en **observation seule** ; le mot « Bloqué » n'apparaît pas pour l'Intrusion Guard.
3. **Tout est local** — aucune télémétrie, aucun compte, aucune donnée envoyée.
4. **Parité FR/EN stricte** — chaque chaîne existe dans `ui/src/lib/i18n.tsx` en `fr` et `en`, avec la même clé.
5. **Accessibilité AA** — contraste ≥ 4,5:1 sur le texte, navigation clavier complète, focus visible, aucun contenu porté par la couleur seule.
6. **Ne pas régresser** — chaque écran actuel doit être joignable et conserver ses commandes. La refonte est une réorganisation, pas une suppression.

---

## 2. Architecture d'information commune

Les deux directions partagent la même IA. Seule la mise en page change.

```
Navigation principale (5 entrées, pas plus)
├── Synthèse (tableau de bord)
│     ├── État global (une phrase vraie)
│     ├── Action principale : Analyser maintenant
│     ├── Trois domaines : Appareil · Internet · Réseau
│     └── Journal local récent
├── Antivirus
│     ├── Lancer une analyse (Rapide / Complète / Personnalisée)
│     ├── Progression réelle (fichiers, détections, indexés, erreurs)
│     ├── Résultats (table : menace, fichier, taille, SHA-256, action)
│     └── Quarantaine (liste, restaurer, purger)
├── Protection
│     ├── Modules et état réel (à la demande / inactive / observation seule / non fournie)
│     ├── Surveillance proactive (consentement explicite)
│     └── « Ce qui n'est pas couvert »
├── Réseau
│     ├── Alertes (Observé · Suspecté · Confirmé)
│     ├── Connexions actuelles (instantané)
│     ├── Filtrage DNS (boucle locale)
│     └── Pare-feu (lecture seule)
└── Réglages (nav secondaire : Général · Antivirus · Avancé · À propos)
      └── Historique, mises à jour, export diagnostic rangés ici
```

### Règles de réduction de texte

- **Un seul bouton primaire** visible par écran (le reste en secondaire ou en menu).
- Les chemins, ports, identifiants techniques passent en **monospace secondaire** ou derrière « Détails ».
- Chaque carte porte un titre court + une phrase de substance ; pas de paragraphe explicatif dans le flux principal.
- Les limitations sont **affichées**, pas cachées : une carte « Ce qui n'est pas couvert » est permanente dans Protection.

### Vocabulaire de statut (verrouillé)

| Terme autorisé | Sens | Interdit |
| --- | --- | --- |
| À la demande | Fonction qui ne s'exécute que sur action | — |
| Inactive | Module présent mais non lancé | « Désactivée par vous » sans preuve |
| Observation seule | Lecture, aucune modification système | « Protection réseau » |
| Non fournie | Fonction absente de cette version | « Bientôt disponible » présenté comme actif |
| Observé / Suspecté / Confirmé | Niveaux de constat réseau | « Bloqué » |

---

## 3. Direction A — « Calme & Souverain »

**Intention :** une interface qui respire. L'utilisateur voit d'abord *son* état, puis un seul geste possible.

| Élément | Choix |
| --- | --- |
| Navigation | Rail vertical d'icônes 84 px, libellés au survol et au focus |
| État | Ligne-héros unique, vraie : « Analyse manuelle disponible · pas de protection en temps réel » |
| Action | Un bouton large « Analyser maintenant » |
| Domaines | Trois cartes : Appareil / Internet / Réseau, chacune avec un fait et une limite |
| Densité | Faible — beaucoup de blanc, une idée par carte |
| Réglages | Nav secondaire en bas du rail |
| Public | Utilisateur non expert, poste familial ou TPE |

**Points forts :** très lisible, rassurant sans mentir, réduit la charge cognitive.
**Points faibles :** moins d'information simultanée ; les utilisateurs avancés feront un clic de plus pour les détails.

Capture conceptuelle : `direction-a-calme-souverain.html` (5 écrans commutables, bascule clair/sombre).

---

## 4. Direction B — « Console compacte »

**Intention :** un poste de pilotage dense. Tout l'état utile tient dans le premier écran.

| Élément | Choix |
| --- | --- |
| Navigation | Barre supérieure horizontale (5 onglets) + indication de thème |
| État | Bandeau d'état + tuiles de mesures (moteur, dernière analyse, quarantaine) |
| Action | Boutons d'analyse en ligne, le primaire restant « Analyser maintenant » |
| Domaines | Tableau comparatif « Ce qui est vrai / Limite » |
| Densité | Élevée — tableaux, journal horodaté, chiffres |
| Réglages | Onglet plein, sections Général / Antivirus / Avancé / À propos |
| Public | Utilisateur averti, administrateur, support technique |

**Points forts :** information immédiate, journal et alertes visibles, adapté au diagnostic.
**Points faibles :** plus chargé, moins accueillant pour un non-initié, risque de surcharge visuelle sur petit écran.

Capture conceptuelle : `direction-b-console-compacte.html` (5 écrans, bascule clair/sombre).

---

## 5. Comparaison et recommandation

| Critère (poids) | A — Calme | B — Console |
| --- | --- | --- |
| Lisibilité pour non-expert (30 %) | 9 / 10 | 6 / 10 |
| Densité d'information (20 %) | 6 / 10 | 9 / 10 |
| Honnêteté / visibilité des limites (20 %) | 9 / 10 | 9 / 10 |
| Effort d'implémentation (15 %) | 7 / 10 | 6 / 10 |
| Accessibilité AA (15 %) | 9 / 10 | 7 / 10 |

**Recommandation :** Direction A comme interface par défaut, avec deux emprunts à la Direction B —
(1) le **journal horodaté** de la Synthèse, (2) le **tableau d'alertes** de l'écran Réseau.
Cela garde la sobriété tout en donnant accès aux données utiles sans clic supplémentaire.

La décision finale appartient au propriétaire. Aucune direction n'est implémentée avant validation explicite (§ 9).

---

## 6. Exigences d'accessibilité

| Exigence | Critère mesurable |
| --- | --- |
| Contraste texte | ≥ 4,5:1 (AA), vérifié sur chaque paire texte/fond des deux thèmes |
| Contraste des états | Ne jamais coder un état uniquement par la couleur : associer icône + texte |
| Clavier | Toute action atteignable au Tab ; ordre logique ; pas de piège de focus |
| Focus | Anneau visible ≥ 2 px, contraste ≥ 3:1 sur le fond adjacent |
| Zoom | 100 % → 200 % sans perte de fonction ni chevauchement |
| Lecteur d'écran | `aria-label` sur les boutons-icônes du rail ; `role="tab"` + `aria-selected` ; annonces de progression polies |
| Mouvement | Respect de `prefers-reduced-motion` ; transitions ≤ 220 ms |
| Langue | `lang="fr"` / `lang="en"` sur `<html>` selon le choix ; textes i18n, pas de concaténation de phrases |
| Taille de cible | ≥ 32 × 32 px pour toute cible tactile/souris |

---

## 7. Parité FR/EN

- Toute nouvelle clé est ajoutée **simultanément** dans `fr` et `en` de `ui/src/lib/i18n.tsx`.
- Aucune chaîne en dur dans les composants ; aucun texte dans les maquettes n'est destiné à être copié tel quel sans passer par l'i18n.
- Les tests UI existants (`ui/src/sections/*.test.tsx`) doivent rester verts ; les nouveaux libellés sont couverts par un test de présence de clé.
- Les termes de statut du § 2 sont traduits de façon stable (`À la demande` → `On demand`, `Observation seule` → `Monitor only`, `Non fournie` → `Not provided`).

---

## 8. Plan d'implémentation (après approbation uniquement)

| Phase | Contenu | Fichiers pressentis |
| --- | --- | --- |
| 0 | Validation de la direction et du mélange par le propriétaire | ce document |
| 1 | Jetons et primitives (espacement, tailles, états) | `ui/src/theme.css` |
| 2 | Coquille applicative + navigation + Synthèse | `ui/src/App.tsx`, `ui/src/sections/Dashboard.tsx` |
| 3 | Antivirus + résultats + quarantaine | `Antivirus.tsx`, `Quarantine.tsx` |
| 4 | Protection (modules, consentement, limites) | `ProactiveMonitor.tsx`, nouveau panneau |
| 5 | Réseau (alertes, connexions, DNS, pare-feu) | `NetworkMonitor.tsx`, `WebGuard.tsx`, `Firewall.tsx` |
| 6 | Réglages + Historique/Updates/About rangés en secondaire | `Settings.tsx`, `History.tsx`, `Updates.tsx`, `About.tsx` |
| 7 | Accessibilité, parité FR/EN, tests, revue de véracité | tests `ui/src/sections/*.test.tsx` |

Aucune phase ne commence sans le feu vert du § 9. La refonte n'introduit **aucune** fonctionnalité de sécurité nouvelle : elle réorganise et nomme l'existant.

---

## 9. Approbation du propriétaire

À compléter avant toute implémentation :

| Question | Réponse |
| --- | --- |
| Direction retenue (A / B / mélange) | ☐ A ☐ B ☐ Mélange A+B |
| Emprunts à l'autre direction | |
| Date d'approbation | |
| Validation explicite « j'autorise l'implémentation » | ☐ oui |

**Tant que cette section n'est pas remplie, l'interface reste inchangée.** Le présent document et les maquettes sont des livrables de conception, pas une implémentation.
