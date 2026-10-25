#Requires -Version 5.1
<#
.SYNOPSIS
    Télécharge les signatures ClamAV dans le profil utilisateur de CBS Shield.

.DESCRIPTION
    Écrit un freshclam.conf local puis exécute freshclam SANS élévation de
    privilèges. Les signatures sont stockées dans :
      %LOCALAPPDATA%\Cybrense\CBS Shield\clamav\database

    ClamAV doit déjà être installé (winget install --id Cisco.ClamAV --exact).
    Le premier téléchargement peut dépasser 100 Mo.

.PARAMETER FreshclamPath
    Chemin explicite vers freshclam.exe (sinon détection automatique).

.PARAMETER SkipRun
    Écrit seulement la configuration, sans lancer freshclam.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\setup-clamav-signatures.ps1
#>
[CmdletBinding()]
param(
    [string]$FreshclamPath = "",
    [switch]$SkipRun
)

$ErrorActionPreference = "Stop"

function Find-Freshclam {
    param([string]$Explicit)

    if ($Explicit) {
        if (Test-Path -LiteralPath $Explicit -PathType Leaf) {
            return (Resolve-Path -LiteralPath $Explicit).Path
        }
        throw "freshclam.exe introuvable au chemin indiqué : $Explicit"
    }

    $candidates = @(
        (Join-Path $env:ProgramFiles "ClamAV\freshclam.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "ClamAV\freshclam.exe")
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return $candidate
        }
    }

    $command = Get-Command freshclam.exe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    throw @"
freshclam.exe est introuvable.
Installez ClamAV puis relancez ce script :
    winget install --id Cisco.ClamAV --exact
"@
}

if ($env:CBS_SHIELD_DATA_DIR) {
    $dataDir = $env:CBS_SHIELD_DATA_DIR
} elseif ($env:LOCALAPPDATA) {
    $dataDir = Join-Path $env:LOCALAPPDATA "Cybrense\CBS Shield"
} else {
    throw "LOCALAPPDATA est introuvable. Définissez CBS_SHIELD_DATA_DIR."
}

$clamavDir = Join-Path $dataDir "clamav"
$databaseDir = Join-Path $clamavDir "database"
$configPath = Join-Path $clamavDir "freshclam.conf"
$logPath = Join-Path $clamavDir "freshclam.log"

Write-Host "CBS Shield — préparation des signatures ClamAV" -ForegroundColor Cyan
Write-Host "  Données  : $dataDir"

New-Item -ItemType Directory -Force -Path $databaseDir | Out-Null

$freshclam = Find-Freshclam -Explicit $FreshclamPath
Write-Host "  freshclam: $freshclam"

$config = @"
# Généré par CBS Shield — mise à jour des signatures ClamAV
DatabaseDirectory $databaseDir
UpdateLogFile $logPath
DatabaseMirror database.clamav.net
Checks 1
"@

Set-Content -LiteralPath $configPath -Value $config -Encoding ASCII
Write-Host "  Config   : $configPath"
Write-Host "  Base     : $databaseDir"

if ($SkipRun) {
    Write-Host "Configuration écrite. freshclam n'a pas été lancé (-SkipRun)." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Lancement de freshclam (aucune élévation demandée)..." -ForegroundColor Cyan
& $freshclam "--config-file=$configPath" --stdout
$exitCode = $LASTEXITCODE

$signatureCount = @(
    Get-ChildItem -LiteralPath $databaseDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -in @(".cvd", ".cld", ".ndb", ".hdb", ".hsb", ".mdb") }
).Count

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "freshclam a terminé (code 0). $signatureCount fichier(s) de signatures présent(s)." -ForegroundColor Green
} else {
    Write-Host "freshclam a renvoyé le code $exitCode. $signatureCount fichier(s) de signatures présent(s)." -ForegroundColor Yellow
    Write-Host "Consultez $logPath pour le détail." -ForegroundColor Yellow
}

Write-Host "Relancez CBS Shield puis cliquez sur « Revérifier le moteur »." -ForegroundColor Cyan
exit $exitCode
