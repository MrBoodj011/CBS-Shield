# Sprint 4 — Validation d'installation propre

## Résultat : **non exécutée**

La validation sur machine virtuelle propre n'a pas été réalisée. Elle ne doit
pas être considérée comme acquise.

## Pourquoi

- Aucun outil de virtualisation exploitable n'est disponible sur l'hôte :
  VirtualBox et VMware absents, cmdlets Hyper-V non disponibles sans élévation.
- Aucune autorisation explicite n'a été donnée pour modifier la configuration
  Hyper-V, créer une VM ou installer/désinstaller l'application sur une machine
  supplémentaire.
- Le test sur l'hôte de développement ne remplace pas une VM propre : WebView2,
  ClamAV et les données utilisateur y sont déjà présents.

## Ce qui a été vérifié à la place

| Point | Méthode | Résultat |
| --- | --- | --- |
| Contenu de l'installeur | inspection du bundle NSIS | exe applicatif + WebView2, **pas de ClamAV ni signatures** |
| Dépendances du binaire | `dumpbin /dependents` | DLL Windows/UCRT uniquement, pas de VC++ Redistributable |
| Absence de Vite/Node chez l'utilisateur | lancement du binaire release sans serveur Vite | interface chargée depuis `tauri.localhost` |
| Mode d'installation | configuration Tauri | `currentUser`, pas d'élévation |
| Premier lancement | lancement du binaire release | interface fonctionnelle, moteur ClamAV détecté sur l'hôte |
| Désinstallation | non testée | aucune installation NSIS exécutée sur l'hôte |

## Ce qui reste à faire avant de déclarer l'installation validée

1. Provisionner une VM Windows 10 ou 11 propre, sans ClamAV, sans WebView2
   éventuellement, sans tools de développement.
2. Installer `CBS Shield_0.4.0-dev_x64-setup.exe` avec un compte standard.
3. Vérifier le premier lancement, l'état « moteur ClamAV indisponible », le guide
   winget, puis l'installation officielle de ClamAV et la mise à jour FreshClam.
4. Vérifier un scan propre et une détection synthétique **sans Defender coupé**.
5. Désinstaller et vérifier que les données utilisateur ne sont pas supprimées
   silencieusement (ou documenter leur emplacement).
6. Consigner captures, journaux et hash de l'installeur.

Tant que ces étapes ne sont pas exécutées, le critère « installation propre »
reste **non validé**.
