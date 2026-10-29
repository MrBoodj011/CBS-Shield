# Sprint 8 — Architecture et modèle de menace Web Guard

**Version :** `0.8.0-dev`
**Date de vérification :** 30 octobre 2026
**Branche :** `sprint-8`
**Portée :** le module **Web Guard** (filtrage DNS local), son backend Rust, son intégration Tauri, son UI React, et les données locales associées.

## 1. Vue d'ensemble

### 1.1 Couches

```
+------------------------------------------------------------+
| UI React/Webview   ·   huit sous-vues Web Guard            |
|                api.ts (IPC)                                 |
+------------------------------------------------------------+
| src-tauri:commands/webguard.rs                             |
|   mapping IPC + AppState.webguard                          |
+------------------------------------------------------------+
| crates/cbs-webguard                                        |
|   classificateur, listes, historique, proxy DNS loopback   |
+------------------------------------------------------------+
| crates/cbs-webguard/src/sys.rs                              |
|   diagnostics réseau lecture seule (cartes, DNS, VPN)       |
+------------------------------------------------------------+
| Système hôte: résolveur système, cartes réseau, service D   |
+------------------------------------------------------------+
```

### 1.2 Fichiers

Les données importantes sont stockées localement par l'application, dans le dossier de données utilisateur :

- fichier d'état Web Guard (`webguard.json`) : listes, autorisations, filtres importés, historique ;
- base de signatures officielle ClamAV ;
- historique SQLite des scans ;
- clés et données de quarantaine.

Aucun de ces fichiers n'est pris en charge par un service distant.

## 2. Frontières de confiance

| Frontière | Description | Contrôle en place |
| --- | --- | --- |
| UI ↔ backend | L'interface webview ne pilote pas le moteur directement ; elle parle à `webguard_` commands. | Validation/désérialisation par Tauri et par le backend. |
| Backend ↔ système | Le backend lit l'état DNS/carte réseau en lecture seule, sans mutation. | Aucune commande de changement de DNS, aucun appel Winsock pour modifier les paramètres. |
| Entités externes | Le proxy DNS du prototype relaye vers le résolveur système. | Aucune exfiltration, aucune écriture vers un service tiers. |
| Disque local | Listes, historiques, JSON d'état, clés de quarantaine. | Accès limité au répertoire de données de l'application. |
| Utilisateur | Confirmation explicite exigée pour toute action destructrice. | Dialog de confirmation natif, phrase de confirmation. |


## 3. Assets protégés

| Asset | Importance | Actuellement protégé ? |
| --- | --- | --- |
| Listes de blocage/autorisations utilisateur | Haute | Oui, stockage local borné et parsé avec garde-fou. |
| Historique Web Guard | Moyenne | Oui, borné et chiffré/stocké localement. |
| Données de quarantaine | Critique | Oui, déjà couvert par le stockage chiffré AES-256-GCM + DPAPI. |
| Fichier d'état JSON Web Guard | Moyenne | Oui, écriture atomique + contrôle de version. |
| Paramètres de moteur/install | Haute | Oui, gérés par l'application et protégés par confirmation. |
| Moteur ClamAV officiel | Haute | Ne peut pas être modifié par l'app ; reste externe et signé officiellement. |

## 4. Menaces et couverture

### 4.1 Menaces du module Web Guard

| Menace | Impact | Statut |
| --- | --- | --- |
| Fichier de listes malveillant (trop grand, non parsable, données inattendues) | Blocage de l'app, fuite mémoire, corruption de l'état | Attaque testée ; importe borné et rejeté avec erreur propre. |
| Usurpation de résolveur système par l'utilisateur | Le prototype ne garantit pas un filtrage fiable si le résolveur est compromis | Annoncé honnêtement ; pas une garantie. |
| Contournement par IP directe ou par un résolveur différent | Le filtrage DNS local n'est pas une protection finale | Annoncé dans l'UI et dans ce document. |
| Oubli de suppression de l'écouteur après un arrêt | Ressource occupée indéfiniment | Arrêt implémenté avec statut et message. |
| Requête DNS mal formée qui n'est pas classifiable | Confusion UI/historique | Cas de garde honnête : `action=error` et pas de filtrage. |
| Fuite de private path/historique dans les captures | Respect de la vie privée | Captures assainies avant publication. |
| Modification non autorisée de listes via UI | Blocage de domaines légitimes | Permis, mais exige une action utilisateur explicite et visible. |
| Injection par adblock/hosts d'un fichier trop gros | Consommer toute la mémoire/persistance | Nombre max de domaines/taille de fichier bornés. |

### 4.2 Menaces du socle déjà couvertes

- **Quarantaine** : une clé AES-256-GCM locale, protégée par DPAPI.
- **Export de rapports** : fichiers générés localement, sans réseau.
- **Historique SQLite** : base locale accessible uniquement dans le dossier de données.
- **Évènements réseau/pare-feu** : lecture seule.
- **Pare-feu** : aucun changement de profil ou de règle.

## 5. Menaces non couvertes

Ces menaces sont **hors couverture du prototype** et ne doivent pas être revendiquées comme traitées :

- tout filtrage global du système (le Web Guard reste un prototype local) ;
- contournement par des applications qui gardent leur propre résolveur ou utilisent une IP directe ;
- détection de malware sur flux HTTPS ;
- analyse de contenu de page ou de comportement réseau par application ;
- protection contre les attaques de tunnel par DNS ;
- chiffrement DNS (DoH/DoT) non interprété, donc non filtrable ;
- les bypass réseau par VPN/changement de carte ou de résolveur ;
- accident d'utilisateur : suppression involontaire de domaines dans la liste de blocage (récupération manuelle depuis l'UI).

## 6. Garanties de conception

Le Web Guard s'interdit explicitement :

- de modifier DNS système, fichier hosts, ou profil réseau ;
- de créer ou modifier une règle de pare-feu ;
- d'installer un certificat racine, un driver ou un service ;
- de chiffrement/déchiffrement de TLS ;
- d'envoyer des données à un service distant ;
- de démarrer automatiquement une écoute réseau au lancement de l'application.

Ces garanties sont affichées dans la sous-vue « Limites & sécurité » de l'UI et sont testables par code inspection.

## 7. Modèle de sortie honnête

Sprint 8 est un **prototype de module de filtrage DNS local**. Il est :

- *fonctionnel :* les listes, les listes d'autorisations, les tests et le proxy loopback fonctionnent réellement.
- *limité :* ce n'est pas une protection système globale, pas une passerelle d'entreprise et pas une protection anti-malware.
- *transparent :* les limites et les écarts de validation sont documentés et visibles dans l'UI.

Il ne satisfait pas encore les critères obligatoires d'une version production-ready, en particulier la validation VM isolée complète.
