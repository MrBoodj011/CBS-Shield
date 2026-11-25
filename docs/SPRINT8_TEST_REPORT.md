# Sprint 8 — Rapport de test

**Version :** `0.8.0-dev`
**Date de vérification :** 30 octobre 2026
**Branche :** `sprint-8`
**Statut global :** tests locaux réussis ; validation VM isolée non terminée.

## 1. Résumé exécutif

Le Sprint 8 livre `0.8.0-dev` avec :

- le prototype **Web Guard** de filtrage DNS local (huit vues FR/EN, backend réel, pas de télémétrie) ;
- l'installation portable ClamAV `1.5.4` avec URL/taille/SHA-256 épinglés et confirmation explicite ;
- un flux antivirus manuel validé sur l'hôte ;
- un installeur NSIS final reconstruit à 12:51 (2 773 391 octets, SHA-256 `9F0377C511AE1EAC8EE408120F17154756EB26E09889783D0FE1A0882131796E`) ;
- des tests locaux Rust/UI/compilation propres.

La validation **dans la VM Windows 11 isolée** n'a pas été achevée ; c'est l'écart principal.

## 2. Ce qui a été vérifié dans le dépôt

| Domaine | Résultat |
| --- | --- |
| `cargo fmt --all -- --check` | Passé |
| `cargo clippy --workspace --all-targets -- -D warnings` | Passé |
| `cargo test --workspace` | 116 passés, 1 ignoré |
| `npm --prefix ui run test -- --run` | 34 tests passés |
| `npm run build` | Passé ; UI + binaire + NSIS générés |
| Hash de l'installeur final | `9F0377C511AE1EAC8EE408120F17154756EB26E09889783D0FE1A0882131796E` |
| Hash du binaire final | `BAF8CAB6B539DCD114532B906FF3BC420E5C93940D6293FAF1F71A41096CAEFC` |

## 3. Validation fonctionnelle réelle

### 3.1 Web Guard

Refaire cette séquence :

1. Démarrer l'application release dépaquetée.
2. Ouvrir Web Guard.
3. Démarrer le prototype.
4. Tester plusieurs domaines listés, sous-domaines, autorisé et non listé.
5. Importer un fichier de listes valide et un fichier corrompu.
6. Redémarrer l'application et vérifier la persistance.
7. Arrêter le prototype.

Résultat réel :

- port réel affiché `127.0.0.1:5354` après repli de `127.0.0.1:5353` (mDNS occupé, `os error 10013`) ;
- blocage local réellement observé sur domaine listé et sous-domaine ;
- autorité de la liste d'autorisations confirmée sur la liste de blocage ;
- requête normale `example.com` relayée au résolveur système ;
- import corrompu rejeté avec `importEmpty`, la liste précédente exacte conservée ;
- l'état Web Guard, la liste de blocage, la liste d'autorisations et l'historique persistés ;
- aucune modification DNS système, pare-feu, hosts ou VPN.

### 3.2 Antivirus

Sur l'hôte avec le moteur officiel ClamAV `1.5.4` :

- scan propre : 1 fichier, 0 détection ;
- détection synthétique via signature `.ndb` temporaire **non officielle** ;
- quarantaine, restauration, purge, persistance après redémarrage ;
- Defender jamais désactivé ni exclu.

### 3.3 Redémarrage

L'application a été redémarrée plusieurs fois ; l'état (Web Guard, quarantaine, historique, réglages) est resté conforme.

## 4. Ce qui n'a pas été testé / non revendiqué

- **VM Windows 11 isolée** : tous les scénarios sécurité dans la VM (installation propre, portable ClamAV, FreshClam, scans, quarantaine, pare-feu, redémarrage) restent à faire.
- **Installation du bundle NSIS final** dans la VM.
- **Pare-feu** : lecture seule non re-exercée en conditions réelles dans la VM.
- **Réseau dégradé** : aucun test de déconnexion complète revendiqué.
- **ClamAV portable install** de bout en bout sur une machine propre.

## 5. Statut honnête

Le Sprint 8 est livré comme **partiellement validé** : implémentation et tests locaux réellement passés, mais la certification VM isolée complète, l'exercice portable de l'installeur et le cycle de sécurité VM isolée restent des écarts. Aucune revendication « prête pour la production » n'est faite.
