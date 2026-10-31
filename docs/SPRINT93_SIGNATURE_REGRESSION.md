# Sprint 9.3 — Régression des signatures personnalisées (A4)

**Version :** `0.9.0-dev` · **Base :** commit `758199f` (Sprint 9.2)
**Branche :** `sprint-9.3` · **Date :** 2026-10-30
**Objet :** établir si l'analyse intégrée applique réellement les signatures
`.ndb` personnalisées, et qualifier le faux positif observé en 9.2.

> Ce document ne consigne que des exécutions réelles dans la VM
> `CBS-Shield-Sprint7`. Aucun échantillon de malware : uniquement des chaînes
> de test inoffensives.

---

## 1. Constat 9.2

- Signature 9.2 : `CBS_Test_Synthetic:0:*:414243444546` → correspond à **tout
  fichier contenant les octets `ABCDEF`, n'importe où**.
- Deux fixtures texte (`ABCDEF`) sur le Bureau n'ont pas été détectées par
  l'analyse lancée depuis l'interface, alors que `clamscan` en direct les
  détectait.
- Conclusion provisoire 9.2 : « les signatures `.ndb` ne sont pas appliquées ».

## 2. Méthode 9.3 (signature discriminante)

| Élément | Valeur |
|---|---|
| Signature | `CBS93_Synthetic:0:*:43425339332d53594e5448` (jeton ASCII `CBS93-SYNTH`) |
| Fixture | `C:\Users\cbs\Desktop\cbs93-precise.txt` (texte inoffensif contenant le jeton) |
| Base | `%LOCALAPPDATA%\Cybrense\CBS Shield\clamav\database` |
| Scan applicatif | onglet Antivirus → profil **Rapide** |

## 3. Résultats

| # | Exécution | Résultat observé |
|---|---|---|
| 1 | `clamscan --database=<dir> cbs93-precise.txt` (CLI) | `cbs93-precise.txt: CBS93_Synthetic.UNOFFICIAL FOUND` |
| 2 | Analyse **Rapide** depuis l'interface | même nom de détection remonté pour la même fixture, plus le script de test contenant le jeton |
| 3 | Capture des résultats | `target/sprint7-vm/http/vm93-results-01.png` |

**Verdict :** la construction de la commande (`--database=<dir>`) et le
traitement des sorties fonctionnent. Le constat 9.2 était un **faux positif de
test** : la signature `ABCDEF` était trop large et sans cible.

## 4. Le faux positif large (à ne pas reproduire)

La capture `vm93-results-01.png` montre aussi de nombreuses détections
`CBS_Test_Synthetic.UNOFFICIAL` sur des binaires ClamAV légitimes
(`clambc.exe`, `libclamav.dll`, etc.). C'est le comportement attendu d'une
signature de test trop générique (`ABCDEF` apparaît dans des binaires), **pas**
un défaut du moteur ni de l'application.

Conséquences pratiques :

- une signature personnalisée doit cibler un jeton unique et long ;
- l'interface doit continuer à présenter toute détection comme une
  **information**, jamais comme une preuve de malware ;
- les signatures de test ne doivent jamais être livrées dans un installeur de
  production.

## 5. Limites

- Une seule session VM, un seul utilisateur (`cbs`).
- Aucune mesure de performance sur un grand corpus.
- Aucun test avec une signature `.ndb` malformée (comportement du moteur
  ClamAV non instrumenté dans ce sprint).

## 6. Recommandations

1. Ajouter un test d'intégration automatisé avec une signature discriminante
   et une fixture dédiée (hors VM), pour éviter toute régression silencieuse.
2. Refuser ou avertir sur les signatures personnalisées trop courtes/génériques.
3. Ne jamais embarquer `custom.ndb` dans le bundle de production.
