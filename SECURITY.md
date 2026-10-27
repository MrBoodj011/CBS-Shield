# Sécurité — CBS Shield 0.6.0-dev

Ce document décrit le modèle de menace, les garanties offertes, les limites assumées
et la procédure de signalement. CBS Shield est une **version expérimentale** de
scanner manuel avec observation réseau et pare-feu en lecture seule : elle ne doit
pas être présentée comme une protection antivirus complète.

## Principes

1. **Aucune action destructive silencieuse.** Tout déplacement, toute restauration et
   toute suppression exigent une confirmation explicite de l'utilisateur.
2. **Aucune modification de la sécurité système.** CBS Shield ne désactive pas
   Microsoft Defender, n'ajoute pas d'exclusion, ne crée/modifie/active/désactive
   aucune règle de pare-feu et n'installe aucun pilote noyau. Le pare-feu est
   strictement observé et la gestion des règles est verrouillée.
3. **Moindre privilège.** L'application fonctionne sans élévation ; l'installeur est
   en mode `currentUser`, les données et signatures vivent dans le profil utilisateur.
   Seule l'installation **officielle** de ClamAV, demandée explicitement dans
   l'assistant, peut déclencher l'UAC de `winget` dans une console visible ; CBS
   Shield ne s'élève jamais lui-même.
4. **Aucune exécution de fichier analysé.** ClamAV lit les fichiers ; CBS Shield ne
   lance jamais un fichier détecté ou mis en quarantaine.
5. **Aucune télémétrie.** Pas de compte, pas de serveur CBS Shield, pas d'envoi de
   fichier ou de rapport. Seul `freshclam` contacte `database.clamav.net`, sur action
   explicite de l'utilisateur.
6. **Honnêteté de l'interface.** Un module absent est marqué « Non disponible » ;
   un scan en erreur n'est jamais présenté comme propre ; un pare-feu désactivé
   n'est jamais présenté comme protecteur ; un mapping connexion → règle est une
   référence, pas un verdict.
7. **Pas de capacité active de pare-feu.** Aucune commande IPC ne crée, ne modifie
   ni ne supprime une règle. L'export JSON est en lecture seule, marqué
   `restoreSupported: false`, et ne peut pas être restauré.
8. **Intégrité de l'artefact.** L'installeur du Sprint 6 n'est pas signé
   Authenticode ; son SHA-256 publié doit être vérifié avant exécution. Une
   signature absente n'est pas présentée comme une garantie d'éditeur.

## Modèle de menace

### Protégé contre

- Un fichier malveillant **connu des signatures ClamAV** présent sur le disque et
  analysé manuellement.
- La lecture du coffre de quarantaine par un autre compte Windows : les blobs sont
  chiffrés AES-256-GCM et la clé est scellée par DPAPI pour l'utilisateur courant.
- La falsification d'un blob : AES-GCM authentifie le contenu, l'identifiant est
  utilisé comme AAD. Le SHA-256 est revérifié à la restauration.
- L'écrasement accidentel lors d'une restauration : la destination existante est
  refusée.
- L'injection de chemins internes : les cibles de scan et de quarantaine sont
  canonicalisées, le coffre et le dossier de données sont refusés.

### Non protégé / hors périmètre

- **Malware inconnu des signatures** ou comportemental (pas de moteur heuristique actif).
- **Protection en temps réel** : un fichier peut être exécuté sans être intercepté.
- **Menaces sans fichier** (scripts en mémoire, attaques réseau, phishing).
- **Utilisateur administrateur compromis** : un processus élevé peut lire la mémoire
  de CBS Shield ou les données de l'utilisateur. DPAPI protège contre un autre compte,
  pas contre le compte lui-même ni contre un malware déjà élevé.
- **Altération du binaire ClamAV** : CBS Shield fait confiance au `clamscan.exe`
  configuré. Vérifiez son origine et ses mises à jour.
- **Exfiltration réseau** par un tiers déjà présent sur la machine.
- **Déni de service / ressources** : un scan de disque entier peut être long et
  consommer du CPU ; l'annulation arrête le processus enfant.

## Observation du pare-feu

- Lecture des profils et règles via `INetFwPolicy2`, sans privilège administrateur.
- Empreinte composite profils + actions + **toutes** les règles ; la liste affichée
  est bornée à 1 000 entrées.
- Une différence est **signalée**, jamais réparée. La baseline n'avance qu'après
  acquittement explicite ou lors de la première observation.
- Les connexions ne sont mappées qu'avec un **chemin d'image réel** ; un processus
  sans chemin (`System`) n'obtient pas de mapping inventé.
- L'état de `MpsSvc` et `BFE` est lu via `sc query` masqué. CBS Shield ne démarre,
  n'arrête et ne configure aucun service.
- L'interface distingue la **référence lue** de la **décision effective**, qui n'est
  pas calculée (priorité Allow/Block, WFP, IPsec, stratégie de groupe).
- Export JSON marqué `readOnly: true` et `restoreSupported: false`, avec SHA-256 des
  octets écrits, sans commande d'import.
- Le plan de récupération est **conceptuel uniquement** : restauration absente et
  répétition rollback non réalisée.
- **Aucun** appel `put_*`, aucun pilote, aucun service CBS Shield, aucun pare-feu tiers.
- Une alerte n'est pas une preuve d'intrusion et ne remplace pas Microsoft Defender
  Firewall.

## Assistant et provisioning ClamAV

- L'installation est proposée **uniquement** si ClamAV est absent.
- L'utilisateur doit cocher une autorisation explicite ; le backend refuse
  `confirm=false`.
- Seul le paquet officiel `Cisco.ClamAV` du catalogue Windows est utilisé, avec une
  fenêtre visible et sans option silencieuse. Aucune commande n'est affichée ou
  copiée dans le parcours principal.
- Aucun binaire ClamAV ou signature n'est embarqué dans l'installeur et aucun
  téléchargement direct depuis un site arbitraire n'est effectué.
- En cas d'échec, de délai de 20 minutes ou de suivi interrompu, le résultat est
  distingué (`notDetected`, `wingetFailed`, `installTimedOut`, etc.), expliqué et
  accompagné d'une reprise ou d'une localisation manuelle de `clamscan.exe`. L'état
  « prêt » n'est jamais simulé.
- ClamAV reste sous GPL-2.0 et sous la responsabilité de son éditeur.

## Quarantaine

- Algorithme : AES-256-GCM, nonce aléatoire de 96 bits par élément.
- Clé : 32 octets aléatoires (`getrandom`), stockée chiffrée par DPAPI.
- Fichier de clé : `%LOCALAPPDATA%\Cybrense\CBS Shield\quarantine.key`.
- Blobs : `%LOCALAPPDATA%\Cybrense\CBS Shield\quarantine\<uuid>.cbsq`.
- Métadonnées : table `quarantine` dans SQLite (chemin d'origine, hash, statut).
- Une restauration n'écrase jamais un fichier existant et vérifie le SHA-256.
- La suppression définitive exige `confirm=true` **et** la saisie de `SUPPRIMER`.
- Le fichier d'origine est déplacé, pas copié : après mise en quarantaine, il n'existe
  plus à son emplacement d'origine.

### Sauvegarde de la clé

Si `quarantine.key` est perdu (réinstallation, changement de profil, nettoyage), les
blobs deviennent **irrécupérables**. C'est le prix du chiffrement. Sauvegardez la clé
si vous conservez des éléments importants, en la protégeant comme un secret.

## Données et vie privée

| Donnée | Emplacement | Portée |
| --- | --- | --- |
| Historique des scans | `cbs-shield.db` | locale, utilisateur |
| Détections (chemins, hashes) | `cbs-shield.db` | locale, utilisateur |
| Coffre chiffré | `quarantine/` | locale, utilisateur |
| Clé du coffre | `quarantine.key` (DPAPI) | locale, utilisateur |
| Signatures ClamAV | `clamav/database/` | locale, utilisateur |
| Journal freshclam | `clamav/freshclam.log` | locale, utilisateur |
| Snapshots pare-feu | `firewall-backups/*.json` | locale, utilisateur, lecture seule |
| Baseline pare-feu | `cbs-shield.db` (table `settings`) | locale, utilisateur |

Aucun rapport n'est envoyé à Cybrense. Les chemins de fichiers peuvent révéler des
informations personnelles : la base SQLite n'est pas chiffrée. Protégez votre compte
Windows et le dossier de données en conséquence.

## Surface d'attaque

- **IPC Tauri** : seules les commandes listées dans `ARCHITECTURE.md` sont exposées ;
  les capacités se limitent à `core:default` et `dialog:allow-open`.
- **Entrées utilisateur** : chemins validés/canonicalisés, nombre de cibles limité à 64,
  longueur de la signature de menace tronquée, réglages validés côté Rust.
- **Processus externes** : lancés avec des arguments explicites, sans shell
  intermédiaire, stdin fermé. `clamscan`/`freshclam` utilisent une console masquée ;
  l'installation ClamAV utilise une console **visible** pour que l'utilisateur voie
  l'UAC et la progression. Aucune concaténation de commande.
- **Pare-feu** : cinq commandes (état, mapping, export, diagnostic et acquittement
  local de la baseline) ; aucune mutation de règle enregistrée dans Tauri, gates de
  gestion fermés.
- **CSP** : `default-src 'self'`, scripts limités à l'origine de l'application,
  connexions IPC uniquement.
- **SQLite** : requêtes paramétrées via `rusqlite`, pas de SQL construit par concaténation.
- **Dépendances** : licences vérifiées dans `LICENSES.md` ; `cargo audit` et
  `npm audit` sont recommandés avant toute release.

## Intégrité de l'installeur

- Artefact de référence Sprint 6 : `CBS Shield_0.6.0-dev_x64-setup.exe`,
  **2 658 926 octets**, SHA-256
  `650A35AA5A6D59AAB1223D2B41644E5703936C1AE711462227B25112E8784BB8`.
- **Non signé** : `Get-AuthenticodeSignature` retourne `NotSigned`. SmartScreen peut
  avertir. Vérifiez le SHA-256 publié avant exécution.
- L'installeur est en mode `currentUser`; il ne demande pas d'élévation pour installer
  CBS Shield. L'installation de ClamAV peut déclencher une demande Windows distincte.
- ClamAV et les signatures ne sont pas inclus dans l'installeur.

## Bonnes pratiques pour les contributeurs

- Ne jamais journaliser le contenu d'un fichier analysé ni la clé de quarantaine.
- Ne jamais ajouter d'exclusion Defender, de mutation de règle de pare-feu ou d'appel
  nécessitant une élévation sans revue explicite. Toute future gestion active de
  pare-feu exige VM isolée, sauvegarde, restauration validée et autorisation.
- Ne jamais rendre l'installation de ClamAV silencieuse ou automatique.
- Ne pas utiliser de malware réel dans les tests : EICAR ou signature NDB inoffensive.
- Toute nouvelle commande IPC doit valider ses entrées et documenter ses effets.
- Toute opération destructive doit rester confirmée et réversible quand c'est possible.

## Signaler une vulnérabilité

**Ne créez pas d'issue publique pour une vulnérabilité exploitable.**

Contactez Cybrense en privé (canal de sécurité du dépôt ou contact du mainteneur) avec :

- la version de CBS Shield et de ClamAV ;
- une description du problème et de son impact ;
- les étapes de reproduction, sans joindre de malware réel ;
- toute preuve de concept minimale.

Objectif de réponse : accusé de réception sous 7 jours, évaluation sous 30 jours.
Merci de laisser un délai raisonnable avant toute divulgation publique.

## Avertissement

CBS Shield 0.6.0-dev est un projet expérimental. Il ne remplace pas Microsoft
Defender, qui doit rester actif. Un scan sans détection ne garantit pas qu'un système
est sain, et un pare-feu observé comme actif ne garantit pas l'absence d'intrusion.
