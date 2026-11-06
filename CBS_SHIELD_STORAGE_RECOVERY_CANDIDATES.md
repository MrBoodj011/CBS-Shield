# CBS SHIELD — VIRTUALBOX STORAGE RECOVERY CANDIDATES

**Date:** 2026-11-06
**Auditor:** Senior Windows 11 Systems Engineer / Storage Optimization Specialist / DevOps / Data Safety Auditor
**Host:** Windows 11, C: ≈ 930 GB total, **≈ 30.27 GB free**
**CBS Shield target:** ≈ 231 GB
**Latest reported Git commit:** faa0b8d

---

## 1. Exact current free space

- Free space (C:): **32,505,458,688 bytes ≈ 30.27 GB**
- Used space (C:): ≈ 899.98 GB
- Total (C:): ≈ 930.26 GB

---

## 2. Complete VirtualBox disk inventory

**VirtualBox version:** 7.2.22r175245

### Registered machines

| # | Name | UUID | CfgFile | SnapFldr | LogFldr | VMState | Change time | Memory | Storage (attached) | Image UUID |
|---|---|---|---|---|---|---|---|---|---|
| 1 | CBS-Shield-Sprint7 | 56faba97-eddd-4bea-8fda-ec5f06e258c5 | C:\Projects\CBS-Shield\target\sprint7-vm\CBS-Shield-Sprint7\CBS-Shield-Sprint7.vbox | …\CBS-Shield-Sprint7\Snapshots | …\CBS-Shield-Sprint7\Logs | **poweroff** | 2026-11-05T16:35:05 | 6144 | SATA-0-0 = `C:\Projects\CBS-Shield\target\sprint94-vm-evidence\CBS-Shield-Sprint7-clean-backup.vdi` (bootable) | 0c918ee3-998b-4d5c-81ce-f32e77a834b0 |
| 2 | CBS-Shield-Sprint94-Fresh | e2197b3b-8c3d-4f95-92fe-ffa12014b068 | C:\Projects\CBS-Shield\target\sprint94-fresh-vm\CBS-Shield-Sprint94-Fresh\CBS-Shield-Sprint94-Fresh.vbox | …\CBS-Shield-Sprint94-Fresh\Snapshots | …\CBS-Shield-Sprint94-Fresh\Logs | **aborted** | 2026-11-05T21:12:55 | 6144 | SATA-0-0 = `C:\Projects\CBS-Shield\target\sprint94-fresh-vm\CBS-Shield-Sprint94-Fresh.vdi` (bootable) | 2fc2c8f8-0069-4844-8d7f-e6bed65b34c3 |
| 3 | CBS-Shield-Sprint94-Clean | 8ee872f5-df1b-4af6-872f-a083eae6133b | C:\Projects\CBS-Shield\target\sprint94-clean-vm\CBS-Shield-Sprint94-Clean\CBS-Shield-Sprint94-Clean.vbox | …\CBS-Shield-Sprint94-Clean\Snapshots | …\CBS-Shield-Sprint94-Clean\Logs | **saved** | 2026-11-02T19:46:46 (VMStateFile = Snapshots\2026-11-02T19-45-44-792490900Z.sav) | 4096 | SATA-0-0 = `C:\Projects\CBS-Shield\target\sprint94-clean-vm\CBS-Shield-Sprint94-validation.vdi` (bootable) | b4cf39f1-b745-42f4-92ec-7df0efb2d90f |
| 4 | meridian | ebb9496e-14c0-4655-a952-026c87459c7c | C:\Users\adjar\vms\meridian\meridian\meridian.vbox | C:\Users\adjar\vms\meridian\meridian\Snapshots | C:\Users\adjar\vms\meridian\meridian\Logs | poweroff | 2026-10-29T13:49:25 | 2048 | SATA-0-0 = `C:\Users\adjar\vms\meridian\image\meridian.vdi` (bootable) | b30e100f-3ff7-459e-acd3-9aeb9230a0be |

### CBS Shield VM disk states

- **CBS-Shield-Sprint7** (Windows 11): VMState = poweroff; active disk = `target\sprint94-vm-evidence\CBS-Shield-Sprint7-clean-backup.vdi` (42.70 GB; SATA-0-0 bootable). Snapshot chain in `target\sprint7-vm\CBS-Shield-Sprint7\Snapshots` (2026-10-27, 2026-11-01). NVRAM/RVRDE/recordings under `target\sprint7-vm\CBS-Shield-Sprint7\`.
- **CBS-Shield-Sprint94-Fresh** (Windows 11): VMState = **aborted** (2026-11-05T21:12:55); active disk = `target\sprint94-fresh-vm\CBS-Shield-Sprint94-Fresh.vdi` (26.14 GB; SATA-0-0 bootable). Snapshot dir present.
- **CBS-Shield-Sprint94-Clean** (Windows 11): VMState = **saved** (2026-11-02T19:46:46; saved-state file = `Snapshots\2026-11-02T19-45-44-792490900Z.sav`, 2.11 GB). Active disk = `target\sprint94-clean-vm\CBS-Shield-Sprint94-validation.vdi` (34.04 GB; SATA-0-0 bootable).

## 3. Recovery candidates table

| # | Path | Size (GB) | VBox UUID | Registered / Unregistered | Attached machine | Parent / child dep. | Snapshot deps. | Last mod (UTC) | Backup status | Safe action | Est. recovery | Risk | Approval req. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `C:\Projects\CBS-Shield\target\sprint94-vm-evidence\CBS-Shield-Sprint7-clean-backup.vdi` | 42.70 | `0c918ee3-998b-4d5c-81ce-f32e77a834b0` | Registered (Sprint7 SATA-0-0) | CBS-Shield-Sprint7 | Active boot disk | No | 2026-11-05T21:12 | Active/primary | **No action** — protected | 0 | Critical | **No** (protected) |
| 2 | `C:\Projects\CBS-Shield\target\sprint94-fresh-vm\CBS-Shield-Sprint94-Fresh.vdi` | 26.14 | `2fc2c8f8-0069-4844-8d7f-e6bed65b34c3` | Registered (Sprint94-Fresh SATA-0-0) | CBS-Shield-Sprint94-Fresh | Active boot disk | No | 2026-11-05T21:12 | Active/primary | **No action** — protected | 0 | Critical | **No** (protected) |
| 3 | `C:\Projects\CBS-Shield\target\sprint94-clean-vm\CBS-Shield-Sprint94-validation.vdi` | 34.04 | `b4cf39f1-b745-42f4-92ec-7df0efb2d90f` | Registered (Sprint94-Clean SATA-0-0) | CBS-Shield-Sprint94-Clean | Active boot disk | Saved state = 2.11 GB | 2026-11-02T19:45 | Active/primary | **No action** — protected | 0 | Critical | **No** (protected) |
| 4 | `C:\Projects\CBS-Shield\target\sprint94-vm-evidence\CBS-Shield-Sprint7-pre-recovery-20261101.vdi` | 38.76 | (not attached) | **Unregistered / backup** | — | Backup of Sprint7 | — | 2026-11-01T20:38 | Backup | Archive / delete after approval | **38.76** | Medium | **YES** |
| 5 | `C:\Projects\CBS-Shield\target\sprint7-vm\CBS-Shield-Sprint7.vdi` | 16.58 | (not attached; Sprint7 uses clean-backup) | **Unregistered / orphan** | — | Orphan for Sprint7 | — | 2026-10-31T19:33 | Possibly orphan | Review / delete after approval | **16.58** | Medium | **YES** |
| 6 | `C:\Projects\CBS-Shield\target\sprint94-vm-evidence\CBS-Shield-Sprint7-repair.hdd` | 33.18 | (not attached) | **Unregistered / orphan** | — | Orphan (hdd) | — | 2026-10-31T19:36 | Orphan | Review / delete after approval | **33.18** | Medium | **YES** |
| 7 | `C:\Projects\CBS-Shield\target\iso\Win11_Enterprise_Eval_26H2_en-us.iso` | 7.67 | — | Unregistered (test asset) | — | Test asset | — | 2026-10-27T14:31 | Single copy | Archive / delete after approval | **7.67** | Low–Medium | **YES** |
| 8 | `C:\Users\adjar\vms\meridian\image\meridian.vdi` | (size not measured) | `b30e100f-3ff7-459e-acd3-9aeb9230a0be` | Registered (meridian) | meridian | Active boot disk | No | 2026-10-29T13:49 | Active/primary | **No action** — protected (non-CBS VM) | 0 | Critical | **No** (protected) |

### Notes on candidate #4–7
- Equal file sizes do not prove duplication; hashes not computed in this audit — **not treated as duplicates** without hash verification.

## 4. Confirmed disk dependencies

- Sprint7: active boot disk (clean-backup VDI) ← VMState poweroff; snapshots + NVRAM + VRDE + recordings under `target\sprint7-vm\CBS-Shield-Sprint7\`.
- Sprint94-Fresh: active boot disk (Fresh VDI) ← VMState **aborted**; NVRAm/VRDE/recording under `target\sprint94-fresh-vm\CBS-Shield-Sprint94-Fresh\`.
- Sprint94-Clean: active boot disk (validation VDI) + **saved state** (2.11 GB) ← protected.
- meridian: active boot disk (meridian.vdi) ← protected (Debian VM).

## 5. Potential recovery per candidate

- Protected actives: 0 GB (cannot recover).
- Unregistered backups/orphans: ≈ 38.76 + 16.58 + 33.18 = **≈ 88.5 GB** (subject to approval; hashes recommended).
- ISO: ≈ 7.67 GB (approval required).

## 6. Safe cleanup recommendations

- Confirmed regenerable: build caches (already cleaned this session).
- Review: unregistered backups/orphans, ISO, VM-related duplicates.

## 7. Items requiring explicit approval

1. Deletion of `CBS-Shield-Sprint7-pre-recovery-20261101.vdi` (≈38.76 GB).
2. Deletion of `CBS-Shield-Sprint7-repair.hdd` (≈33.18 GB).
3. Deletion of `CBS-Shield-Sprint7.vdi` (≈16.58 GB).
4. Deletion of `Win11_Enterprise_Eval_26H2_en-us.iso` (≈7.67 GB).
5. VM snapshot compaction / archival (any VM).
6. Any future cleanup of protected VM disks.

## 8. Final verification

- No high-risk cleanup performed in this mission.
- No VM disk or snapshot modified.
- No deletion performed.
- No Git push.

---

*End of CBS_SHIELD_STORAGE_RECOVERY_CANDIDATES.md*
