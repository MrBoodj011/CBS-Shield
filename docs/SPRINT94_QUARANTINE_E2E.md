# Sprint 9.4 — installed-app quarantine E2E

**Status:** quarantine → app restart → restore → second quarantine → **explicit purge with typed confirmation all passed** for the installed Sprint 9.3 candidate. The purge was executed on 2026-11-05 after the original guest was recovered by an authorized reset and re-bootstrapped.

## Fixture and engine

The fixture was a harmless ASCII text file `C:\Users\cbs\Desktop\cbs94-qz-43eeae00.txt`, 69 bytes, containing the unique token `CBS94QZ-43EEAE00`. Its SHA-256 before scanning was `C693FE3234B88300D9CEB0A44935BB8F87A4FB012D684B09A4D8C1C928162090`. Microsoft Defender real-time protection and tamper protection both reported `True` during fixture creation (`target/sprint7-vm/inbox/20261031-200302-agent92out.txt`). No malware was used and Defender was not disabled.

The guest `custom.ndb` contained `CBS94_Synthetic:0:*:4342533934515a2d3433454541453030`. Direct `clamscan --database=<guest database> <fixture>` returned `CBS94_Synthetic.UNOFFICIAL FOUND` (same guest output). The installed CBS Shield GUI custom scan selected the exact file and showed that same detection; `scans.id=3` and `detections.id=24` in SQLite confirm one scanned file, one detection, zero scan errors, and the unique file hash. See [SQL evidence](SPRINT94_SQLITE_PERSISTENCE.md) and [native screenshot](sprint94-screenshots/01-synthetic-detection.jpg).

## Observed state transitions

| Step | Evidence | Result |
| --- | --- | --- |
| GUI request and explicit confirmation | `inbox/20261101-134905-sum94q1.txt`; [dialog](sprint94-screenshots/02-quarantine-confirmation.jpg) | Confirmed only the unique synthetic fixture |
| Encrypted blob and source removal | `inbox/20261101-135229-sum94q2.txt` | Source absent; `2aba2cf0-3af6-45ba-b74f-99ba4a1b93b2.cbsq`, 102 bytes, SHA-256 `E8C12CB4919E6C610D8954ECA04A260E0D2EED5A2CEBE795A918C04F64C26D4E` present |
| Metadata | SQL `quarantine.item_id=2aba2cf0-3af6-45ba-b74f-99ba4a1b93b2` | Stored path, source path, 69-byte size, original SHA-256, threat name, and status recorded |
| App restart | `inbox/20261101-141025-sum94p2a.txt`; [item](sprint94-screenshots/04-restart-item.jpg) | One active item and same blob after restart |
| Explicit restore consent | `inbox/20261101-141302-sum94p2c.txt`; [consent](sprint94-screenshots/05-restore-consent.jpg) | Checkbox switched `Off → On`; restore invoked |
| Byte-exact restore | Same guest output; SQL snapshot | Source recreated at 69 bytes with exact original SHA-256; blob count 0; SQL status `restored` with audit row retained |
| Full Windows restart | `inbox/20261101-201545-agent92out.txt`; post-restart SQL snapshot | Fixture still present with original hash; `restored` audit row persisted; database integrity `ok` |
| Second GUI scan and explicit quarantine | `inbox/20261101-202621-sum94p3a.txt`; [detection](sprint94-screenshots/09-second-detection.jpg) and [dialog](sprint94-screenshots/10-second-quarantine-confirmation.jpg) | Same unique detection; new blob `67469744-b7ee-4046-87dd-e15f792cb1eb.cbsq`, 102 bytes, SHA-256 `F1DC872CDD6060FCAA9F640A099EF294BB0DF15471E8741388B184EF237D98EF`; source absent |
| Second metadata and retained audit | Post-second-quarantine SQL snapshot `20261101-202745-db94afterp3*` | New `scans.id=4`, `detections.id=25`, active item `67469744-…`; first item remains `restored`; `integrity_check=ok` |

The restored content was logged as the same three ASCII lines that were written to the fixture. SHA-256 plus byte length and logged content provide the byte-for-byte check; the application never ran the file.

Before any purge, a separate 69-byte recovery copy was written to `target/sprint94-validation/recovery-copy-43eeae00.txt` and verified at the **same original SHA-256**. Thus the active `.cbsq` is not the only recoverable copy. This copy is of the synthetic test content only; no existing user file was replaced.

## Failure-path coverage

The 14 passing `cbs-quarantine` tests cover missing source, a source vanishing between staging and commit, a locked source that remains on disk while the encrypted blob is preserved, missing/corrupt blob refusal, stale temporary files from an interrupted write, truncated/corrupt ciphertext, and eight concurrent stores leaving eight blobs and zero temp files. The installed GUI was used for the normal transition above. A distinct access-denied ACL case and a genuine disk-full simulation in an isolated volume were **not executed**; the locked-source test exercises the same `SourceRetained` branch but is not labeled an access-denied test.

## Purge executed — 2026-11-05

After the 2026-11-03 stall the original guest was unresponsive to input. On 2026-11-05 the owner-authorized reset path was used: a VM reset returned the guest to the signed-in desktop with no credential bypass, the Windows PowerShell console was launched through the Start menu with keyboard scancodes, and the documented Sprint 9.2 HTTP queue/collector agent was re-bootstrapped. The host static HTTP server (`:8000`) and collector (`:8002`) were restarted after they were found down; a guest `iwr` connect failure was resolved when they came back.

State at session start matched the documented 2026-11-01 end state: the vault held exactly one blob `67469744-b7ee-4046-87dd-e15f792cb1eb.cbsq` (102 bytes, SHA-256 `F1DC872CDD6060FCAA9F640A099EF294BB0DF15471E8741388B184EF237D98EF`) and no fixture copy existed on the Desktop (`target/sprint94-vm-evidence/sum94p3purge-result.txt`).

The purge ran through the installed 0.9.0-dev GUI, two-part so each action returned evidence before the following one:

1. **Dialog** — the app was launched (no wizard; onboarding already completed), the Quarantine page showed `1 actif`, the row `Supprimer` button opened the confirmation dialog titled “Supprimer définitivement cet élément ?”. Its caption restates the exact semantics in `ui/src/components/ConfirmDialog.tsx`: deleting only the quarantine copy, never the (already moved) original, not reversible, with the audit row remaining visible. Guest output `target/sprint7-vm/inbox/20261105-154832-agent92out.txt`; captures `shot94pgquarantinepage-result.jpg` and `shot94pgpurgedialog-result.jpg` in `target/sprint94-vm-evidence/`.
2. **Confirmation and execution** — the dialog was already open with the checkbox `On` from the first pass; the follow-up (`target/sprint7-vm/inbox/20261105-154941-agent92out.txt`, summary `target/sprint94-vm-evidence/sum94p3purge2-result.txt`) re-verified the checkbox state, set the phrase input value to `SUPPRIMER` via UIA `ValuePattern` (`PHRASE_VALUE=[SUPPRIMER]` read back), observed the three dialog buttons `Fermer` / `Annuler` / `Supprimer définitivement` with the confirm **enabled=True** (both guards satisfied), invoked it, and then observed:
   - quarantine directory blob count `QFILES_PRE=1` → `QFILES_POST=0`;
   - page texts `0 actif`, `Élément supprimé définitivement`, and `cbs94-qz-43eeae00.txt a été retiré du coffre.`;
   - captures `shot94pg2beforeconfirm-result.jpg` (checkbox `On`, phrase filled) and `shot94pg2afterconfirm-result.jpg` (dialog closed, quarantine page `0 actif`) in `target/sprint94-vm-evidence/`.

The SQL verification of the post-purge database is in [SQLite persistence](SPRINT94_SQLITE_PERSISTENCE.md): the second row is now `status='deleted'` and the first row remains `restored`, exactly the audit behavior the dialog caption promised. The remaining release criterion formerly titled "**not met**" for purge is therefore met for this exact item. The byte-verified separate recovery copy is retained (its deletion was never the intent of the sweep; it is a lab file).
