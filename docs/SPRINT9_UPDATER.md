# Sprint 9 — Architecture de mise à jour signée / Signed updater investigation

Statut : **investigation et préparation** (Mission 7). Rien n'est activé :
aucune clé n'existe, aucun dépôt de publication, aucun canal de mise à jour
distribué. CBS Shield `0.9.0-dev` reste installé manuellement.

## 1. Deux signatures différentes — ne pas confondre

| | Signature Tauri updater | Authenticode Windows |
|---|---|---|
| Ce qu'elle signe | Le **contenu** du bundle de mise à jour (vérification intégrée au plugin Tauri) | Le **binaire** NT exécutable brouillé à l'installation |
| Portée | L'application accepte la mise à jour uniquement si la signature correspond à une clé publique embarquée | Windows SmartScreen notifie l'utilisateur ; l'exécutable déclaré comme signé |
| Clé privée | `tauri.conf.json` → never published, gérée hors dépôt | Certificats OV/EV d'une AC ; matériel (HSM) recommandé |
| Coût | Configure/planning seulement, pas pécuniaire | Certificat payant annuel + checks DCV |

Les deux sont nécessaires pour une distribution Windows sérieuse mais ne se
remplacent pas mutuellement.

## 2. Architecture proposée (non active)

1. **Clés hors dépôt** : clé privée Tauri (`tauri signer generate`) stockée
   dans un gestionnaire de secrets du mainteneur (1Password / VKS / HSM) ;
   la clé publique va dans `tauri.conf.json` (`updater.pubkey`).
2. **Artefacts**: NSIS `.exe` + fichier `.sig` par version publiée ; SHA-256
   publié en clair sur la page des releases.
3. **Manifeste signé**: `latest.json` avec `version`, `notes`, `pub_date`,
   `signature`, `url`. Servi en HTTPS seulement.
4. **Workflow utilisateur** : explicit dialog, `Download` => vérification
   signature => nouveau binaire => relance. Le plugin refuse silencieusement
   toute signature invalide.
5. **Récupération**: la version installée actuelle reste pleine; en cas
   d'échec d'installation de la mise à jour, le rollback Tauri NSIS conserve
   l'exécutable précédent.

## 3. Mesures concrètes prises ici

- L'application fonctionne pour l'instant **sans** canal de mise à jour :
  aucune dépendance au réseau au démarrage.
- Les manifestes (`tauri.conf.json`) n'incluent pas `createUpdaterArtifacts`.
- Documentation d'une checklist de publication signée à remplir plus tard
  (génération de clé, stockage, clef publique dans config, test sur VM).

## 4. Décision de non-publication

Aucune version publiée tant que :
1. la clé privée n'est pas existante à l'être stockée hors source ;
2. l'atelier de signature + smoke test VM n'est pas validé ;
3. les checkbox d'Authenticode ne sont pas complétées (certificat réel).
