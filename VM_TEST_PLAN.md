# Plan de validation Windows 11 isolé — CBS Shield 0.7.0-dev

**Date :** 27 octobre 2026 — Sprint 7
**Statut global :** **en cours / non complet**. Aucun résultat n'est revendiqué
comme validé tant que la ligne correspondante du journal n'a pas de preuve.

Ce plan remplace le plan 0.2.0-dev. Il couvre l'installation NSIS, l'absence de
ClamAV, l'assistant de préparation, les signatures, un scan de fixture inoffensive,
le redémarrage, la mise à niveau depuis 0.6, la désinstallation et les scénarios
pare-feu activé/désactivé. Il ne contient **aucun malware réel**.

> **Règle absolue.** Aucune mutation de règle de pare-feu n'est autorisée avant
> que l'isolation, la sauvegarde vérifiée et la répétition de restauration aient
> produit des preuves. CBS Shield ne remplace pas Microsoft Defender Firewall, ne
> désactive pas Defender et ne crée aucun pilote noyau.

---

## 1. Environnement isolé

| Élément | Valeur |
| --- | --- |
| Hyperviseur | VirtualBox 7.2.22 r175245 |
| VM | `CBS-Shield-Sprint7` |
| Système invité | Windows 11 Enterprise Evaluation 26H2, build 26300.9457, en-US |
| ISO | `target/iso/Win11_Enterprise_Eval_26H2_en-us.iso` |
| Taille / SHA-256 ISO | `8 225 329 152` octets / `BC3F24086EBADC94489066B5AD78089E2CF5C3491E90E790BB81A2B199C10E38` |
| Ressources | 6 Go RAM, 4 vCPU, 80 Go VDI, EFI, TPM 2.0 |
| Réseau | NAT uniquement, VRDE local `127.0.0.1:3390` |
| Périphériques | audio, USB, presse-papiers et glisser-déposer désactivés |
| Compte de test | compte local administrateur créé par l'installation unattended ; mot de passe non versionné |
| Dossier VM | `target/sprint7-vm` (non versionné) |

L'ISO d'évaluation Enterprise est utilisée parce que le point d'entrée ISO grand
public a rejeté ce réseau lors de la préparation. Ce choix doit être mentionné
dans tout rapport de compatibilité.

### 1.1 Artefacts à copier dans la VM

| Artefact | Chemin hôte | Usage |
| --- | --- | --- |
| Installeur 0.6 (base de mise à niveau) | `target/release/bundle/nsis/CBS Shield_0.6.0-dev_x64-setup.exe` | scénario de mise à niveau |
| Installeur 0.7 | `target/release/bundle/nsis/CBS Shield_0.7.0-dev_x64-setup.exe` | installation propre |
| Fixture inoffensive | à créer dans la VM | scan `clean` |
| Fixture EICAR | `tests/fixtures/eicar.com.txt` (ou équivalent) | détection sans malware réel |
| Rapport de preuve | `target/sprint7-vm/evidence/` | captures, journaux, SHA-256 |

Ne jamais monter le dossier du projet en partage dans la VM. Copier les artefacts
par un moyen explicite, puis vérifier leur SHA-256 dans la VM.

---

## 2. Matrice d'exécution

| ID | Scénario | Attendu | Statut |
| --- | --- | --- | --- |
| VM-01 | Installation propre 0.7 sans ClamAV | application démarre, moteur `non détecté`, aucune boucle infinie | à exécuter |
| VM-02 | Assistant de préparation | étapes lisibles, autorisation explicite avant `winget`, aucun terminal brut | à exécuter |
| VM-03 | Installation officielle ClamAV | paquet officiel, UAC/fenêtre visible, résultat honnête | à exécuter |
| VM-04 | Mise à jour des signatures | `freshclam` réel, base et état affichés, reprise après interruption | à exécuter |
| VM-05 | Scan fixture inoffensive | scan `clean`, progression et rapport corrects | à exécuter |
| VM-06 | Détection EICAR | détection, quarantaine, restauration, purge avec confirmations | à exécuter |
| VM-07 | Redémarrage | historique SQLite, quarantaine, réglages et langue persistent | à exécuter |
| VM-08 | Mise à niveau 0.6 → 0.7 | données conservées, version affichée 0.7.0-dev, pas de doublon | à exécuter |
| VM-09 | Désinstallation | désinstalleur réel, choix explicite sur les données | à exécuter |
| VM-10 | Dépendances absentes | absence de ClamAV/Node/Rust gérée avec messages, pas de spinner infini | à exécuter |
| VM-11 | Pare-feu Windows activé | profils et règles observés, aucune mutation | à exécuter |
| VM-12 | Pare-feu Windows désactivé | alerte réelle, aucune tentative de réparation | à exécuter |
| VM-13 | Instantané pare-feu + sidecar | JSON + `.sha256`, vérification `matched` | à exécuter |
| VM-14 | Altération d'instantané | vérification `mismatch`, aucune restauration | à exécuter |
| VM-15 | Gate de mutation | gestion désactivée, gates incomplètes, aucun bouton actif | à exécuter |
| VM-16 | Accessibilité clavier | Tab/Shift+Tab, Échap, focus visible sur les nouveaux contrôles | à exécuter |

### 2.1 Scénarios de récupération (obligatoires avant toute mutation)

Ces scénarios ne peuvent être exécutés que si une future version expose une
mutation. Ils sont listés pour empêcher de considérer la gate comme acquise.

1. Créer une règle de test sur un profil VM isolé.
2. Exporter un instantané **avant** mutation et vérifier son sidecar.
3. Appliquer la mutation avec confirmation explicite.
4. Simuler une perte de connectivité : la protection doit revenir automatiquement
   à l'état sauvegardé, sans laisser le réseau coupé.
5. Restaurer la sauvegarde, vérifier que la règle de test disparaît et que les
   règles préexistantes sont intactes.
6. Consigner les preuves, les hashes et la durée de récupération.

Tant que les étapes 1–6 ne sont pas toutes exécutées, `isolated_vm_test`,
`rollback_rehearsal` et `explicit_authorization` restent fausses et la gestion
des règles reste indisponible.

---

## 3. Commandes de vérification dans la VM

```powershell
Get-ComputerInfo | Select-Object WindowsProductName,WindowsVersion,OsBuildNumber
Get-FileHash 'CBS Shield_0.7.0-dev_x64-setup.exe' -Algorithm SHA256
Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction
Get-AuthenticodeSignature 'CBS Shield_0.7.0-dev_x64-setup.exe' | Format-List
```

Pour comparer sans modifier :

```powershell
Get-NetFirewallRule |
  Measure-Object |
  Select-Object Count
```

CBS Shield ne doit exécuter aucun `Set-NetFirewallRule`, `New-NetFirewallRule`,
`Remove-NetFirewallRule`, `netsh advfirewall set` ou équivalent.

---

## 4. Journal des exécutions

| Date | Version | Scénario | Résultat | Preuve |
| --- | --- | --- | --- | --- |
| 27/10/2026 | 0.7.0-dev | Création VM isolée et démarrage | partiel | `target/sprint7-vm/boot-*.png`, `Logs/VBox.log` |
| 27/10/2026 | 0.7.0-dev | Installation Windows unattended | en cours | captures de setup |
| — | 0.7.0-dev | VM-01 à VM-16 | non exécuté | — |

> **Ne pas publier « validé sur VM »** avant que les scénarios critiques
> (installation, absence de ClamAV, scan, redémarrage, mise à niveau,
> désinstallation, pare-feu activé/désactivé) soient terminés et que leurs preuves
> soient archivées.

---

## 5. Nettoyage et conservation

- La VM et son VDI restent sous `target/sprint7-vm` et ne sont pas versionnés.
- Les captures et rapports de preuve peuvent être copiés dans `docs/` uniquement
  s'ils ne contiennent aucun secret, jeton ou mot de passe.
- La VM peut être supprimée avec `VBoxManage unregistervm --delete` après
  archivage des preuves.
- Ne pas réutiliser cette VM pour des tests de malware réel.
