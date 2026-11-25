# CBS Shield - FreshClam TLS Repair - Final Status (Sprint 9.6)

**Product:** CBS Shield by Cybrense
**Version:** 0.9.0-dev
**Branch:** sprint-9.3
**Base commit at start of Sprint 9.6:** `b43a2a9`
**Evidence date:** 2026-11-06 (Phase A), re-used unchanged through 2026-11-07
**Test guest:** VirtualBox `CBS-Shield-Sprint94-Fresh` (Windows 11 Enterprise Evaluation, build 26300)
**Status:** **RESOLVED** - official ClamAV signatures install and verify with the unmodified product configuration.

---

## 1. Acceptance criteria

The Phase A gate required all of the following, in a guest where the defect was
originally observed:

1. `freshclam` completes with the product-generated configuration.
2. The downloaded databases pass ClamAV's own digital-signature verification.
3. `clamscan` loads the updated database and scans a file successfully.
4. TLS validation is not disabled or weakened in any way.

No acceptance was allowed on the basis of a cached or copied database, and no
"insecure", "no-verify" or certificate-exception switch was permitted.

---

## 2. Original failure

The fresh guest failed with `Download failed (60)` and exit code 5, on
`daily.cvd` only, while the custom `.ndb` signature still worked. The guest log
recorded:

```
daily database available for download (remote version: 28173)
WARNING: Download failed (60) WARNING:  Message: SSL peer certificate or SSH remote key was not OK
WARNING: Can't download daily.cvd from https://database.clamav.net/daily.cvd
...
ERROR: Download failed (60) ERROR:  Message: SSL peer certificate or SSH remote key was not OK
ERROR: Can't download daily.cvd from https://database.clamav.net/daily.cvd
Giving up on https://database.clamav.net...
ERROR: Update failed for database: daily
```

Error 60 is curl's `CURLE_PEER_FAILED_VERIFICATION`, i.e. the peer chain did
not validate against the trust store. This was therefore a trust-store problem,
not a network, proxy or clock problem.

---

## 3. Diagnosis sequence

All checks were run as the non-administrator guest user `cbs`.

| Check | Result | Interpretation |
| --- | --- | --- |
| Guest clock / time zone | `Central Europe Standard Time`, UTC+01:00, date agreed with host probe | Clock was not the cause |
| `w32tm` status | `Local CMOS Clock`, leap indicator 3 (not synchronized) | Lab VM has no domain time source; clock still correct within tolerance |
| DNS for `database.clamav.net` | CNAME to `database.clamav.net.cdn.cloudflare.net`; A `104.18.203.90`, `104.17.196.15` | Resolution correct |
| TCP 443 | `TcpTestSucceeded = True` | Reachability correct |
| TLS handshake | TLS 1.3, cipher `Aes256` | Protocol correct |
| Server certificate | `CN=database.clamav.net`, issuer `CN=WE1, O=Google Trust Services`, valid now = True | Certificate itself valid |
| Chain | `database.clamav.net` -> `WE1` -> `GlobalSign ECC Root CA - R4` | Chain terminates at R4 |
| Root store, R4 | **MISSING** in both `LocalMachine\Root` and `CurrentUser\Root` | **Root cause** |
| Proxy settings | WinHTTP direct, IE proxy disabled, no proxy environment variables | Not a proxy issue |
| Product `freshclam.conf` | `DatabaseMirror database.clamav.net`, `Checks 1`, no TLS overrides | Product configuration correct |

The chain evidence recorded by the diagnostic run was:

```
CN=database.clamav.net      || issuer=CN=WE1, O=Google Trust Services, C=US
CN=WE1, O=Google Trust Services, C=US || issuer=CN=GlobalSign, O=GlobalSign, OU=GlobalSign ECC Root CA - R4
CN=GlobalSign, O=GlobalSign, OU=GlobalSign ECC Root CA - R4 || self-signed
```

---

## 4. Root cause

The Windows trust store on this fresh guest did not contain
**GlobalSign ECC Root CA - R4** (SHA-1 thumbprint
`6BA0B098E171EF5AADFE4815807710F4BD6F0B28`, valid until 2038-01-19).
`database.clamav.net` is served by a Google Trust Services `WE1` certificate
that chains to that root. ClamAV's bundled/independently verified TLS path
therefore rejected the chain and reported error 60.

The defect is environmental (an incomplete root store on a freshly provisioned
Windows image), not a CBS Shield configuration error and not a ClamAV defect.

---

## 5. Resolution

The supported Windows automatic root-certificate update mechanism provisioned
**GlobalSign ECC Root CA - R4** into the trust store. No manual certificate
injection, no PEM override and no verification bypass was used.

After provisioning, `freshclam` was run again with the **unmodified**
product-generated configuration. The first run downloaded `main`, `bytecode`
and `daily`; the later re-check reported every database already up to date.

A separate diagnostic attempt to point FreshClam at an exported root bundle via
a `CACertificate` option in a temporary config was rejected by FreshClam
(`Unknown option CACertificate`) and played no part in the success. The product
configuration on disk was never changed.

---

## 6. Verification evidence

### 6.1 Root store

```
R4_Cert:\LocalMachine\Root  thumb=6BA0B098E171EF5AADFE4815807710F4BD6F0B28
                            notbefore=2012-11-13  notafter=2038-01-19
R4_Cert:\CurrentUser\Root   thumb=6BA0B098E171EF5AADFE4815807710F4BD6F0B28
```

### 6.2 FreshClam download with standard configuration

```
* SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384 / X25519MLKEM768
* Server certificate: subject: CN=database.clamav.net
*                    issuer: C=US; O=Google Trust Services; CN=WE1
* OpenSSL verify result: 0
* SSL certificate verified via OpenSSL.
main.cvd updated (version: 63, sigs: 3287027, f-level: 90, builder: tomjudge)
bytecode.cvd updated (version: 339, sigs: 80, f-level: 90, builder: nrandolp)
daily.cvd updated (version: 28175, sigs: 355849, f-level: 90, builder: svc.clamav-publisher)
```

Re-check run:

```
daily.cvd database is up-to-date (version: 28175, sigs: 355849, ...)
main.cvd database is up-to-date (version: 63, sigs: 3287027, ...)
bytecode.cvd database is up-to-date (version: 339, sigs: 80, ...)
```

### 6.3 Signature verification and engine load

`sigtool --info` on each database:

```
daily.cvd    Version: 28175  Signatures: 355849   Verification OK.
main.cvd     Version: 63     Signatures: 3287027  Verification OK.
bytecode.cvd Version: 339    Signatures: 80       Verification OK.
```

`clamscan` against `C:\Windows\win.ini`:

```
C:\Windows\win.ini: OK
ClamAV 1.5.4/28175/Fri Nov  6 07:24:43 2026
exit 0
```

### 6.4 Database directory after the repair

```
daily.cvd            23448090 bytes
daily-28175.cvd.sign     9078 bytes
main.cvd             89072577 bytes
main-63.cvd.sign         9078 bytes
bytecode.cvd           281702 bytes
bytecode-339.cvd.sign    9078 bytes
custom.ndb                54 bytes   (CBS94_Synthetic fixture, unchanged)
```

---

## 7. Security guarantees preserved

- No `--insecure`, `-k`, `NO_VERIFY` or equivalent option was used.
- No TLS/certificate exception was added to ClamAV or to the product.
- No proxy, hosts-file or DNS override was introduced.
- The product `freshclam.conf` was not weakened; `DatabaseMirror` remains
  `database.clamav.net` with normal verification.
- Microsoft Defender was not disabled, excluded or modified.
- The fix is a normal Windows root-store provisioning action, i.e. exactly the
  mechanism a supported Windows update uses.

**TLS/security regression: none.**

---

## 8. Residual state and limits

- The separate `CBS-Shield-Sprint7` lab VM still carries ClamAV database
  **28169**, about 9 days old at the time of the Sprint 9.6 UI run. Its
  dashboard therefore correctly displays `Analyse manuelle dégradée` /
  `Signatures âgées de 9 jour(s) (seuil : 7 jour(s))`. This is expected and is
  **not** a regression: that VM was intentionally left on its existing database
  so the UI could be exercised in a realistic stale-signature state.
- Phase A success belongs to the fresh guest only. No claim is made that every
  Windows image ships with R4; a minimal/offline image can still have an
  incomplete root store.
- No kernel driver, firewall rule, Defender change or real-time protection was
  introduced by this repair.

---

## 9. Status

| Criterion | Status |
| --- | --- |
| Root cause identified from chain and trust-store evidence | PASS |
| Official signatures downloaded with product configuration | PASS |
| `sigtool` verification of all three databases | PASS |
| `clamscan` loads DB 28175 and scans successfully | PASS |
| TLS verification preserved (TLS 1.3, verify result 0) | PASS |
| No security weakening | PASS |
| Sprint 9.6 Phase A gate | **PASS** |

**Verdict: FreshClam TLS defect resolved on the fresh guest, with no TLS
verification weakening.**
