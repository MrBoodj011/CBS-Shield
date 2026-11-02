# Sprint 9.4 — installer audit

**Date:** 2026-11-01. **Branch:** `sprint-9.3`. **Release status:** experimental.

## Provenance and immutable identity

| Artifact | Bytes | SHA-256 | VM status |
| --- | ---: | --- | --- |
| Sprint 9.1/9.2 installer | 2,903,396 | `D5A8B626A7797110AA8006F4AB69648A9A9F41581BA4BB08E32F33AE2F90B1FD` | Historically installed; **not** the 9.3 fix candidate |
| **Sprint 9.3 fix candidate** `CBS Shield_0.9.0-dev_x64-setup.exe` | **2,919,189** | **`6AD6DCFDDDF57D502142B12DB6F5F78B865A56FC33C828B6FE7C70D9D0A92BFB`** | Downloaded into `CBS-Shield-Sprint7`; guest hash matched; silent install exit 0 |
| Sprint 9.4 local rebuild, retained separately as `target/sprint94-validation/rebuild-unvalidated-D8771319.exe` | 2,919,090 | `D8771319E8CB5FA1111A98884BB27696A95A67B9D086467ABD0DDA2DA6F0469F` | Build passed; **not** installed or validated in VM |

The tested candidate is preserved at `target/sprint94-validation/CBS Shield_0.9.0-dev_x64-setup.exe` and restored to the normal `target/release/bundle/nsis/` path after the local production build. Its Authenticode status is **`NotSigned`**. The rebuilt file differs in size and hash; no VM result in this report is attributed to it.

The candidate was built at 2026-10-31 19:01:45 UTC, after commit `36e0eb63246cd3b71f3ee88caa68a8be8fd5f726` (18:58:03 UTC) and before `f54ab7560bc581186fc66e0694c8bcb8796b8887` (19:03:28 UTC). The contemporary [Sprint 9.2 evidence dossier](SPRINT92_FINAL_EVIDENCE.md) identifies the build checkout as `36e0eb6`; the last production-code changes are `74b24b3a8e7cce1390a35f9f4c8c306301e7ab2c`. The installer does not embed a Git SHA, so the exact checkout is supported by build chronology and that dossier, not by an embedded cryptographic attestation. Commits `36e0eb6` and `f54ab75` changed evidence/docs only.

## Guest install and preservation

The guest output `target/sprint7-vm/inbox/20261031-200509-agent92out.txt` records `SETUP_SHA256=6AD6…2BFB`, `INSTALL_EXIT=0`, installed `cbs-shield.exe` size 8,164,864 bytes, SHA-256 `F45E91BBA007F8EE867ADF2BE0971BA408FEB15CD7990FFCFD264E4BA0E643BA`, and version `0.9.0-dev`. The existing `%LOCALAPPDATA%\Cybrense\CBS Shield\cbs-shield.db` and WAL remained present after the upgrade. The installed executable hash was checked again on 2026-11-01 with the same result (`inbox/20261101-200130-agent92out.txt`).

This is an **in-place upgrade of the existing 0.9.0-dev installation**, not a clean-install result. Uninstall and reinstall are still unverified. The production build command `npm run build` completed successfully on 2026-11-01; its log is `target/sprint94-validation/production-build.log` (ignored build evidence). The Vite large-chunk advisory did not fail the build.

On 2026-11-02 an owner-authorized isolated clone of the unattached `CBS-Shield-Sprint7-clean.vdi` booted with an older installed `0.9.0-dev` executable (SHA-256 `885AE311CFEE09E90EC8502893468EE949D111610617BFA4E39D37D7297D5E5F`). After pre-upgrade DB/WAL/SHM snapshot, the **same** `6AD6…2BFB` installer was downloaded, verified, and run with `/S`. Exit was 0; installed `cbs-shield.exe` SHA-256 was again `F45E91BBA007F8EE867ADF2BE0971BA408FEB15CD7990FFCFD264E4BA0E643BA`, and existing database files remained. Guest evidence: `target/sprint7-vm/inbox/20261102-192401-agent92out.txt`. Because the source disk already contained an installation and user data, this is a second **upgrade** check, not a clean-install check. The clone later became unresponsive during GUI automation, so uninstall/reinstall remains open.
