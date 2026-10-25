#Requires -Version 5.1
<#
.SYNOPSIS
  Validation machine propre CBS Shield (volontaire, avec consentement explicite).

.DESCRIPTION
  Exécute la chaîne de validation CBS Shield sur la machine courante : diagnostics
  d'environnement, tests Rust, tests UI, build frontend et (option) build de
  l'installeur NSIS. Un rapport texte horodaté est écrit sous target\.
  Rien d'autre : le script ne modifie jamais Microsoft Defender, le pare-feu
  Windows, aucune règle système, n'installe rien et ne télécharge aucun malware.

  Le script DOIT être lancé volontairement (console interactive). Il refuse
  silencieusement toute exécution dans un pipeline sans TTY.

.PARAMETER Installer
  Construit aussi l'installeur NSIS (npm run build) : 8-13 min.

.PARAMETER SkipRustTests
  Ignore les tests Rust (déjà passés ailleurs).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\vm-validate.ps1
#>

[CmdletBinding()]
param(
    [switch]$Installer,
    [switch]$SkipRustTests
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step { param([string]$Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Message) Write-Host "    [OK]  $Message" -ForegroundColor Green }
function Write-Fail { param([string]$Message) Write-Host "    [FAIL] $Message" -ForegroundColor Red }

# ---------------------------------------------------------------------------
# Consentement obligatoire : console interactive requise.
# ---------------------------------------------------------------------------
if (-not [Environment]::UserInteractive) {
    Write-Fail "Script interactif requis : exécutez-le volontairement dans une console (consentement explicite). Abandon."
    exit 1
}
$host.UI.RawUI.WindowTitle = "CBS Shield - validation volontaire"

$installerWord = if ($Installer) { "AVEC" } else { "SANS" }
Write-Host @"

==========================================================================
 CBS Shield 0.2.0-dev — validation volontaire sur CE poste
==========================================================================
 Ce script va :
   - vérifier l'environnement (node, npm, cargo, clamscan, MSVC);
   - exécuter: cargo fmt --check, cargo clippy, cargo test (sauf -SkipRustTests);
   - exécuter: npm run ui:test et npm run ui:build;
   - ($installerWord -Installer) construire l'installeur NSIS;
   - écrire target\vm-report-<date>.txt (sorties brutes).

 Ce script ne touchera JAMAIS:
   - Microsoft Defender (état, exclusions);
   - les règles du pare-feu Windows;
   - aucun service, pilote, planificateur;
   - aucun malware réel (aucun téléchargement de ce type).
==========================================================================
"@
$answer = Read-Host "> Confirmer le lancement sur ce poste (tapez OUI)"
if ($answer -ne "OUI") {
    Write-Fail "Consentement non reçu ('OUI' attendu). Abandon."
    exit 1
}

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
$reportPath = Join-Path $root ("target\vm-report-{0:yyyyMMdd-HHmmss}.txt" -f (Get-Date))
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $reportPath) | Out-Null
$sw = [System.Diagnostics.Stopwatch]::StartNew()

function Out-Report { param([string]$Text)
    Add-Content -LiteralPath $reportPath -Value $Text -Encoding UTF8
}

function Invoke-LoggedStep {
    param(
        [string]$Title,
        [scriptblock]$Action,
        [switch]$Optional
    )
    Write-Step $Title
    Out-Report "===== $Title ====="
    try {
        $output = & $Action 2>&1
        $exitCode = $LASTEXITCODE
        $output | ForEach-Object { Out-Report $_ }
        $output | Select-Object -Last 3 | ForEach-Object { Write-Host "      $_" }
        if ($null -ne $exitCode -and $exitCode -ne 0) {
            if ($Optional) {
                Write-Host "    [WARN] exit code $exitCode (étape optionnelle)" -ForegroundColor Yellow
                return $true
            }
            Write-Fail "exit code $exitCode"
            Out-Report "EXIT CODE: $exitCode"
            return $false
        }
        Write-Ok "$Title"
        return $true
    } catch {
        Out-Report "EXCEPTION: $_"
        Write-Fail $_.Exception.Message
        return $false
    }
}

$results = [ordered]@{}

# ---------------------------------------------------------------------------
# 1. Environnement
# ---------------------------------------------------------------------------
Out-Report "=== CBS Shield VM validation $(Get-Date -Format o) ==="

Write-Step "Environnement"
$envChecks = @(
    @{ Name = "node";     Cmd = "node";     Args = "--version" },
    @{ Name = "npm";      Cmd = "npm.cmd";  Args = "--version" },
    @{ Name = "cargo";    Cmd = "cargo";    Args = "--version" },
    @{ Name = "rustc";    Cmd = "rustc";    Args = "--version" }
)
$envOk = $true
foreach ($check in $envChecks) {
    try {
        $version = & $check.Cmd $check.Args 2>&1 | Select-Object -First 1
        Write-Ok "$($check.Name): $version"
        Out-Report "$($check.Name): $version"
    } catch {
        Write-Fail "$($check.Name) introuvable"
        $envOk = $false
    }
}

$clamscan = (Get-Command "clamscan.exe" -ErrorAction SilentlyContinue).Source
if ($clamscan) {
    $engineVersion = & $clamscan --version 2>&1 | Select-Object -First 1
    Write-Ok "clamscan: $engineVersion ($clamscan)"
    Out-Report "clamscan: $engineVersion ($clamscan)"
} else {
    Write-Host "    [INFO] ClamAV absent (scénario 'machine vierge' attendu avant l'étape d'installation utilisateur)" -ForegroundColor Yellow
    Out-Report "clamscan: ABSENT"
}

# ---------------------------------------------------------------------------
# 2. Qualité Rust
# ---------------------------------------------------------------------------
if (-not $SkipRustTests) {
    $results.fmt = Invoke-LoggedStep "cargo fmt --all -- --check" { cargo fmt --all -- --check }
    $results.clippy = Invoke-LoggedStep "cargo clippy --workspace --all-targets -- -D warnings" { cargo clippy --workspace --all-targets -- -D warnings }
    $results.rustTests = Invoke-LoggedStep "cargo test --workspace" { cargo test --workspace }
}

# ---------------------------------------------------------------------------
# 3. Frontend
# ---------------------------------------------------------------------------
$results.uiTest = Invoke-LoggedStep "npm run ui:test" { npm run ui:test }
$results.uiBuild = Invoke-LoggedStep "npm run ui:build" { npm run ui:build }

# ---------------------------------------------------------------------------
# 4. Installeur (optionnel, long)
# ---------------------------------------------------------------------------
if ($Installer) {
    $results.installer = Invoke-LoggedStep "npm run build (tauri build — 8 à 13 min)" { npm run build }
    $nsis = Get-ChildItem "target\release\bundle\nsis\*.exe" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($nsis) {
        Write-Ok "installeur : $($nsis.FullName) ($([math]::Round($nsis.Length/1MB,2)) Mo)"
        Out-Report "Installeur : $($nsis.FullName) ($($nsis.Length) octets)"
    } else {
        Write-Fail "installeur NSIS introuvable"
    }
} else {
    Write-Host "==> Build d'installeur ignoré (utilisez -Installer pour l'exécuter)" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# 5. Synthèse
# ---------------------------------------------------------------------------
$sw.Stop()
$succeeded  = @($results.GetEnumerator() | Where-Object { $_.Value }).Count
$totalSteps = $results.Keys.Count
$summary = "SYNTHÈSE: $succeeded/$totalSteps étapes techniquement réussies — durée $([math]::Round($sw.Elapsed.TotalMinutes,1)) min"
Out-Report ""
Out-Report $summary
Write-Host "`n$summary" -ForegroundColor White
Write-Host "Rapport complet : $reportPath" -ForegroundColor Cyan
Write-Host "`nLe plan de test interactif (scénarios d'application) reste dans VM_TEST_PLAN.md :"
Write-Host "  parcours sans ClamAV, installation par l'utilisateur, parcours pare-feu/moniteur réseau," -NoNewline
Write-Host " exécution de l'installeur sur machine par défaut." -ForegroundColor Cyan

Pop-Location
if ($succeeded -lt $totalSteps) { exit 1 } else { exit 0 }
