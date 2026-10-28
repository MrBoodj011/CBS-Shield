# Contribuer à CBS Shield

Merci de l'intérêt porté au projet. CBS Shield est un outil de sécurité local :
les contributions y sont examinées avec plus d'attention qu'ailleurs, en
particulier tout ce qui touche au pare-feu, à la quarantaine et à l'installation.

## Signaler un problème

- **Bug ou demande de fonctionnalité** : ouvrez une *issue* en décrivant la
  version (`0.7.0-dev`), le système (Windows 10/11, build), les étapes exactes et
  le résultat observé. Joignez le rapport d'analyse ou le diagnostic exporté
  plutôt qu'une capture d'écran seule.
- **Vulnérabilité** : n'ouvrez **pas** d'issue publique. Suivez
  [SECURITY.md](SECURITY.md).

## Environnement de développement

Prérequis détaillés dans le [README](README.md) : Rust ≥ 1.85 (MSVC), Node.js ≥ 20,
Visual Studio 2022 Build Tools (C++ Desktop), WebView2.

```powershell
npm --prefix ui install
npm run dev
```

## Avant d'ouvrir une pull request

```powershell
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm --prefix ui run build
npm --prefix ui test
```

Les tests d'intégration ClamAV s'ignorent automatiquement si le moteur ou la base
de signatures est absent : précisez dans la PR s'ils ont réellement été exécutés.

## Règles non négociables

Une contribution qui enfreint l'un de ces points est refusée, même si elle
fonctionne :

- **Aucune protection en temps réel**, aucun pilote noyau, aucune élévation
  automatique de CBS Shield.
- **Microsoft Defender n'est ni désactivé, ni contourné** ; aucune exclusion n'est
  ajoutée automatiquement.
- Le module pare-feu reste **en lecture seule** tant que la restauration vérifiée
  n'est pas prouvée ; aucune API de mutation n'est exposée.
- **Aucune télémétrie**, aucun compte, aucun envoi de fichier ou de métadonnée.
- Le moniteur réseau ne lit **aucun contenu** de paquet, n'ouvre aucune socket.
- Aucun binaire tiers embarqué (ClamAV reste installé séparément, GPL-2.0).
- Toute limite connue est **documentée**, pas masquée.

## Style et langue

- Rust : `rustfmt` par défaut, pas de `unwrap()` sur un chemin d'erreur utilisateur.
- TypeScript : composants fonctionnels, textes passant par `ui/src/lib/i18n.tsx`
  (FR et EN obligatoires pour tout nouveau texte visible).
- Documentation : français pour les documents racine, l'anglais est accepté dans
  les rapports techniques.

## Licence

En proposant une contribution, vous acceptez qu'elle soit publiée sous
**Apache-2.0** (voir [LICENSE](LICENSE)). Aucun CLA n'est demandé.
