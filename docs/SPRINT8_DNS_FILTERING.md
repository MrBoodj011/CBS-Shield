# Sprint 8 — Filtrage DNS local (Web Guard)

**Version :** `0.8.0-dev`
**Date de vérification :** 30 octobre 2026
**Branche :** `sprint-8`
**Statut global :** prototype fonctionnel sur loopback ; aucune modification système ; aucune protection globale revendiquée.

## 1. Résumé exécutif

`0.8.0-dev` introduit **Web Guard** comme prototype de filtrage DNS local. Le module :

- écoute uniquement sur `127.0.0.1` (port `5353` par défaut, autre port libre de `5354` à `5360` si ce port est occupé) ;
- ne modifie jamais le DNS de Windows ;
- ne crée aucune règle de pare-feu, aucun certificat, aucun filtre WFP et aucun pilote ;
- n'effectue aucune interception TLS ;
- classe les requêtes locales DNS par listes utilisateur et autorisations ;
- journalise les évènements localement, sans télémétrie.

Sur la machine de validation, le port `5353` était déjà occupé par le service mDNS (`os error 10013`), et le prototype est donc tombé automatiquement sur `127.0.0.1:5354`. Ce comportement de repli est documenté dans l'interface sous forme du port réellement utilisé.

## 2. Comportement de filtrage réel

| Type de request | Résultat observé | Note |
| --- | --- | --- |
| Domaine listé | Bloqué localement, réponse NXDOMAIN | Aucune requête transmise au résolveur système |
| Sous-domaine d'un domaine listé | Bloqué par correspondance par label | Exemple : `sub.malware.cbs-test.invalid` bloqué par le domaine parent listé |
| Domaine explicitement autorisé | Autorisé, priorité sur la liste de blocage | Exemple : `allowed.cbs-test.invalid` autorisé par la liste d'autorisation |
| Domaine non listé | Autorisé, relayé vers le résolveur système | Exemple : `example.com` relayé et répondu par le résolveur réel |
| Requête DNS non parsable | Marquée en erreur, aucune action de filtration n'est engagée | Cas de garde honnête |
| Importe de fichier non parsable | Erreur locale affichée, aucune donnée remplacée | Comportement testé |

## 3. Backend réel

- Domaines normalisés et bornés.
- Correspondance par labels (domaine racine + sous-domaines).
- Priorité de la liste d'autorisations sur la liste de blocage.
- Import de fichiers `hosts`/adblock choisis localement uniquement.
- Pas de feed distant.
- Persistence atomique du fichier d'état Web Guard.
- Historique borné (300 évènements).
- Évènements stockés localement, jamais envoyés.
- Endpoint réel du datastore et de la mémoire.

## 4. State et persistence

- Fichier d'état JSON unique sous le répertoire de données local.
- Sauvegarde atomique à chaque écriture.
- Version de désérialisation : 1.
- Comportement avec état corrompu reconstruit.
- Clear history/blocklist exige une phrase de confirmation.

## 5. Observations sur le port de départ

Sur l'hôte de test, `127.0.0.1:5353` était **déjà attribué par mDNS (`0.0.0.0:5353`)** ; la tentative de bind a échoué avec `os error 10013` (accès refusé, pas une absence de port). En conséquence :

1. Le prototype logique essaie `127.0.0.1:5353`.
2. S'il est occupé, il essaie `127.0.0.1:5354`, puis les ports suivants jusqu'à `5360`.
3. Le port réellement utilisé est affiché dans l'UI, ici `127.0.0.1:5354`.
4. Aucune mutation DNS système n'est faite pour ce repli.

Ce comportement est **implémenté et testé** (`cargo test -p cbs-webguard` et test unitaire `proxy_bind_stays_on_loopback_and_in_the_expected_port_range`), mais il est clairement annoncé comme comportement prototype ; le rôle de filtrage n'était **pas actif** sur le trafic système.

## 6. Test réel effectué

Le prototype a été démarré et arrêté manuellement pendant la session de validation :

1. Import de la liste de blocage synthétique : `blocklist.hosts` contenant 4 domaines `.invalid`.
2. Import de la liste d'autorisations : 1 entrée `allowed.cbs-test.invalid`.
3. Démarrage du prototype sur `127.0.0.1:5354` après repli.
4. Tests réels de domaine :
   - `malware.cbs-test.invalid` → bloqué, réponse NXDOMAIN localement, sans résolveur en amont.
   - `sub.malware.cbs-test.invalid` → bloqué par la même règle.
   - `allowed.cbs-test.invalid` → autorisé par la liste d'autorisation ; la requête relais a renvoyé `RCODE 3` amont ; l'UI affiche le résultat en tant que `Erreur`, pas en faux succès.
   - `example.com` → autorisé, relayé vers le résolveur configuré, réponse réelle.
5. Import d'une liste corrompue → erreur `importEmpty` et la liste de blocage restée à 4 domaines exactement identiques.
6. Redémarrage de l'application → l'état Web Guard, la liste de blocage, la liste d'autorisations et l'historique des évènements ont été préservés.
7. Arrêt du prototype → aucune écoute persistante ; aucune mutation DNS système.

## 7. Santé/diagnostics

La vue Diagnostic DNS :

- lit les cartes réseau en lecture seule ;
- carte service VPN / Tailscale probable (et l'affiche honnêtement) ;
- lit l'adaptateur DNS, l'état du service `Dnscache`, les résolveurs configurés ;
- ne lit pas les paramètres réseau comme une information de référence absolue pour le filtrage ;
- distinction claire entre service en marche et filtrage réellement en écoute.

Aucun champ n'a été modifié pendant diagnostics.

## 8. Cas limites honnêtes

Web Guard **ne** :

- filtre pas tout le trafic système de Windows ;
- remplace pas le DNS de Windows ou un pare-feu d'entreprise ;
- intercepte pas TLS, ne décode pas les requêtes HTTPS et n'installe pas de certificat racine ;
- intercepte pas les applications qui utilisent un autre résolveur ou une résolution directe par IP ;
- garantit pas un niveau de protection équivalent Defender/pare-feu ;
- protège pas du réseau entreprise / VPN ;
- protège pas contre les flux non DNS (ex : streaming, HTTP précréé) ;
- attribue pas l'identité de domaines via cookies, IP, port, méthode, temps, ou capacités ;
- expose pas l'historique d'identifiants, la navigation passée, ou l'URL passée de navigation dans un fichier partagé ;
- envoie aucune donnée en ligne.

Ces limites sont encadrées par `docs/SPRINT8_ARCHITECTURE_THREAT_MODEL.md`.

## 9. UI

Web Guard a huit sous-vues localisées FR/EN :

1. Vue d'ensemble (réel, pas simulé).
2. Filtrage DNS.
3. Blocage.
4. Autorisations.
5. Activité locale.
6. Listes.
7. Diagnostic DNS.
8. Limites & sécurité.

Toutes les valeurs affichées sont réelles (depuis le backend), pas simulées. Les éléments non implémentés sont explicitement marqués comme tels, pas un faux succès ni un status caché.

## 10. Preuves visuelles

Les captures natives incluses dans le dépôt (`docs/screenshots/sprint8-webguard-01..08-{fr,en}.png`) montrent l'état réel des huit vues après démarrage du prototype ; l'identifiant d'adaptateur, les suffixes VPN et les IPs ont été assainis pour publication.
