# Sécurité — CBS Shield Phase 1

Ce document décrit le modèle de menace, les garanties offertes, les limites assumées
et la procédure de signalement. CBS Shield est une **version expérimentale** de
scanner manuel : elle ne doit pas être présentée comme une protection antivirus
complète.

## Principes

1. **Aucune action destructive silencieuse.** Tout déplacement, toute restauration et
   toute suppression exigent une confirmation explicite de l'utilisateur.
2. **Aucune modification de la sécurité système.** CBS Shield ne désactive pas
   Microsoft Defender, n'ajoute pas d'exclusion, ne modifie aucune règle de pare-feu
   et n'installe aucun pilote noyau.
3. **Moindre privilège.** L'application fonctionne sans élévation ; l'installeur est
   en mode `currentUser`, les données et signatures vivent dans le profil utilisateur.
4. **Aucune exécution de fichier analysé.** ClamAV lit les fichiers ; CBS Shield ne
   lance jamais un fichier détecté ou mis en quarantaine.
5. **Aucune télémétrie.** Pas de compte, pas de serveur CBS Shield, pas d'envoi de
   fichier ou de rapport. Seul `freshclam` contacte `database.clamav.net`, sur action
   explicite de l'utilisateur.
6. **Honnêteté de l'interface.** Un module absent est marqué « Non disponible » ;
   un scan en erreur n'est jamais présenté comme propre.

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

Aucun rapport n'est envoyé à Cybrense. Les chemins de fichiers peuvent révéler des
informations personnelles : la base SQLite n'est pas chiffrée. Protégez votre compte
Windows et le dossier de données en conséquence.

## Surface d'attaque

- **IPC Tauri** : seules les commandes listées dans `ARCHITECTURE.md` sont exposées ;
  les capacités se limitent à `core:default` et `dialog:allow-open`.
- **Entrées utilisateur** : chemins validés/canonicalisés, nombre de cibles limité à 64,
  longueur de la signature de menace tronquée, réglages validés côté Rust.
- **Processus externes** : lancés avec des arguments explicites, sans shell
  intermédiaire, stdin fermé, console masquée. Aucune concaténation de commande.
- **CSP** : `default-src 'self'`, scripts limités à l'origine de l'application,
  connexions IPC uniquement.
- **SQLite** : requêtes paramétrées via `rusqlite`, pas de SQL construit par concaténation.
- **Dépendances** : licences vérifiées dans `LICENSES.md` ; `cargo audit` et
  `npm audit` sont recommandés avant toute release.

## Bonnes pratiques pour les contributeurs

- Ne jamais journaliser le contenu d'un fichier analysé ni la clé de quarantaine.
- Ne jamais ajouter d'exclusion Defender, de règle de pare-feu ou d'appel nécessitant
  une élévation sans revue explicite.
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

CBS Shield 0.1.0 est un projet expérimental. Il ne remplace pas Microsoft Defender,
qui doit rester actif. Un scan sans détection ne garantit pas qu'un système est sain.
