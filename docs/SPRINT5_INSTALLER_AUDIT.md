# Sprint 5 — Audit de l'installeur NSIS

**Produit :** CBS Shield
**Version :** `0.5.0-dev`
**Date :** 27 octobre 2026
**Artefact :** `target/release/bundle/nsis/CBS Shield_0.5.0-dev_x64-setup.exe`

---

## 1. Identité de l'artefact

| Propriété | Valeur |
| --- | --- |
| Nom | `CBS Shield_0.5.0-dev_x64-setup.exe` |
| Taille | **2 651 293 octets** (2,53 Mio) |
| SHA-256 | `4D27F240511A8AE9563434706770AAA3BD3D63E61128B0E384E92A445067B226` |
| Signature Authenticode | **non signé** (`NotSigned`) |
| Mode d'installation | `currentUser` |
| Éditeur | Cybrense |
| Identifiant | `com.cybrense.cbsshield` |
| Licence affichée | Apache-2.0 (`LICENSE`) |
| ClamAV embarqué | **non** |
| Signatures ClamAV embarquées | **non** |

Vérification du hash :

```powershell
Get-FileHash -Algorithm SHA256 `
  'target\release\bundle\nsis\CBS Shield_0.5.0-dev_x64-setup.exe'
```

L'absence de signature Authenticode signifie que SmartScreen peut afficher un
avertissement. Le SHA-256 publié permet de vérifier l'intégrité du fichier, mais ne
remplace pas une signature de code.

---

## 2. Configuration NSIS

```json
{
  "installMode": "currentUser",
  "displayLanguageSelector": true,
  "languages": ["French", "English"],
  "startMenuFolder": "Cybrense"
}
```

- **`currentUser`** : installation dans le profil, sans élévation administrateur
  pour CBS Shield.
- **Sélecteur de langue** : français et anglais. La configuration est présente dans
  l'artefact ; le parcours **graphique** n'a pas été rejoué, le test hôte utilisant
  `/S`.
- **Dossier du menu Démarrer** : `Cybrense`, vérifié sur l'hôte.
- **Désinstalleur** : généré par Tauri, entrée HKCU.
- **WebView2** : Tauri utilise par défaut le téléchargement du bootstrapper si le
  runtime est absent. Ce scénario **n'a pas été testé** et nécessite un accès réseau.
- **Pas de service**, pas de pilote, pas de tâche planifiée, pas de démarrage
  automatique.

---

## 3. Contenu et dépendances

L'installeur contient :

- l'exécutable release `cbs-shield.exe` ;
- l'interface compilée `ui/dist` (aucun serveur Vite) ;
- les ressources et icônes ;
- le désinstalleur NSIS.

L'installeur **ne contient pas** :

- ClamAV, `clamscan.exe`, `freshclam.exe` ou des signatures ;
- un pilote noyau, un filtre WFP ou un pare-feu tiers ;
- des données utilisateur, une base SQLite ou une clé de quarantaine ;
- un script d'exclusion Defender.

ClamAV reste un composant **GPL-2.0 externe**, installé séparément, soit
manuellement, soit via l'assistant avec autorisation explicite.

---

## 4. Installation sur l'hôte

| Étape | Résultat |
| --- | --- |
| Exécution silencieuse `/S` | ✅ code 0 |
| Dossier | `%LOCALAPPDATA%\CBS Shield` |
| Raccourci | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Cybrense\CBS Shield.lnk` |
| Entrée HKCU | présente, version `0.5.0-dev` |
| Lancement | ✅ interface embarquée, version `0.5.0-dev` |
| Élévation CBS Shield | aucune |
| Désinstallation `/S` | ✅ code 0 |
| Binaires / raccourci / registre | supprimés |
| Données utilisateur | **préservées** |

> Ce test est **supplémentaire** : il a lieu sur le poste de développement, avec
> WebView2, ClamAV et des données existantes. Il ne remplace pas une VM propre.

---

## 5. Matrice d'échec et de reprise — non exécutée

| Scénario | Attendu | État |
| --- | --- | --- |
| WebView2 absent | bootstrap ou message explicite | ⛔ non exécuté |
| Réseau absent | erreur claire, reprise possible | ⛔ non exécuté |
| Disque plein | échec propre, pas de fichier partiel | ⛔ non exécuté |
| UAC refusé (winget) | assistant utilisable, moteur absent | ⛔ non exécuté |
| Installation interrompue | pas d'état « installé » simulé | ⛔ non exécuté |
| Mise à niveau 0.4 → 0.5 | données conservées | ⛔ non exécuté |
| Désinstallation pendant l'exécution | comportement documenté | ⛔ non exécuté |
| SmartScreen | avertissement attendu (non signé) | ⛔ non observé en VM |

---

## 6. Données à la désinstallation

Le désinstalleur ne supprime **pas** `%LOCALAPPDATA%\Cybrense\CBS Shield`. Ce choix
protège l'historique, la quarantaine et les signatures, mais signifie qu'une
désinstallation ne remet pas la machine dans un état totalement neuf.

Une suppression manuelle doit être explicite. La clé `quarantine.key` est
indispensable pour restaurer les blobs : sa perte rend les éléments du coffre
irrécupérables.

---

## 7. Points d'attention avant diffusion

1. **Signer l'installeur** avec un certificat Authenticode et horodater la signature.
2. **Tester le sélecteur de langue** et le dossier `Cybrense` en mode graphique.
3. **Tester la mise à niveau** depuis une 0.4.0 réellement installée.
4. **Tester les scénarios d'échec** sur VM jetable.
5. **Décider du comportement de suppression des données** et l'implémenter
   explicitement si souhaité.
6. **Publier le SHA-256** à côté de l'installeur.
7. Ne pas ajouter ClamAV au bundle sans revue GPL-2.0 et sans accord de
   redistribution.

---

## 8. Conclusion

L'installeur est généré, installable et désinstallable sur l'hôte, sans ClamAV ni
pilote. Il reste **non signé** et sa validation en machine propre, en mode graphique
et en scénarios d'échec **n'a pas été exécutée**.
