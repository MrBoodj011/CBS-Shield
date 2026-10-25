#Requires -Version 5.1
<#
.SYNOPSIS
    Diagnostic manuel EICAR pour CBS Shield — à exécuter avec un accord explicite.

.DESCRIPTION
    Crée le fichier de test standard EICAR (inoffensif, pas un malware) dans un
    dossier temporaire dédié, le fait analyser par clamscan avec la base de
    signatures de CBS Shield, affiche le résultat, puis supprime le fichier.

    IMPORTANT : Microsoft Defender peut bloquer la lecture du fichier EICAR par
    ClamAV (Win32 error 225) et/ou le mettre en quarantaine. CBS Shield ne
    désactive pas Defender et n'ajoute aucune exclusion. Un échec ici est une
    limite de l'environnement, pas nécessairement un défaut du moteur.

.PARAMETER Force
    Ne demande pas la confirmation interactive (à utiliser en automation consciente).

.PARAMETER KeepFile
    Conserve le fichier et le dossier temporaire pour inspection manuelle.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\eicar-manual-test.ps1
#>
[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$KeepFile
)

$ErrorActionPreference = "Stop"

function Find-Clamscan {
    $candidates = @(
        (Join-Path $env:ProgramFiles "ClamAV\clamscan.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "ClamAV\clamscan.exe")
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return $candidate
        }
    }
    $command = Get-Command clamscan.exe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    throw "clamscan.exe est introuvable. Installez ClamAV : winget install --id Cisco.ClamAV --exact"
}

if ($env:CBS_SHIELD_DATA_DIR) {
    $dataDir = $env:CBS_SHIELD_DATA_DIR
} elseif ($env:LOCALAPPDATA) {
    $dataDir = Join-Path $env:LOCALAPPDATA "Cybrense\CBS Shield"
} else {
    throw "LOCALAPPDATA est introuvable."
}

$databaseDir = Join-Path $dataDir "clamav\database"
if (-not (Test-Path -LiteralPath $databaseDir -PathType Container)) {
    throw "Base de signatures absente : $databaseDir. Lancez d'abord scripts\setup-clamav-signatures.ps1"
}
$signatureFiles = @(Get-ChildItem -LiteralPath $databaseDir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @(".cvd", ".cld", ".ndb", ".hdb", ".hsb", ".mdb") })
if ($signatureFiles.Count -eq 0) {
    throw "Aucune signature dans $databaseDir. Lancez d'abord scripts\setup-clamav-signatures.ps1"
}

Write-Host "CBS Shield — diagnostic EICAR manuel" -ForegroundColor Cyan
Write-Host "  Base de signatures : $databaseDir ($($signatureFiles.Count) fichier(s))"
Write-Host ""
Write-Host "Rappel : EICAR est une chaîne de test inoffensive, pas un malware." -ForegroundColor Yellow
Write-Host "Microsoft Defender peut bloquer la lecture par ClamAV ou supprimer le fichier." -ForegroundColor Yellow
Write-Host "CBS Shield ne désactive pas Defender et n'ajoute aucune exclusion." -ForegroundColor Yellow
Write-Host ""

if (-not $Force) {
    $answer = Read-Host "Tapez OUI pour créer le fichier de test dans un dossier temporaire dédié"
    if ($answer -ne "OUI") {
        Write-Host "Test annulé. Aucun fichier créé." -ForegroundColor Yellow
        exit 1
    }
}

$clamscan = Find-Clamscan
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("cbs-shield-eicar-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
$target = Join-Path $tempDir "eicar-test.com"

# Chaîne EICAR standard décodée depuis son hexadécimal : le fichier source du
# script ne contient pas la signature sous forme littérale.
$hex = "58354f2150254041505b345c505a58353428505e2937434329377d2445494341522d5354414e444152442d414e544956495255532d544553542d46494c452124482b482a"
$bytes = [byte[]]::new($hex.Length / 2)
for ($i = 0; $i -lt $bytes.Length; $i++) {
    $bytes[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16)
}

try {
    [System.IO.File]::WriteAllBytes($target, $bytes)
    Write-Host "Fichier créé : $target ($($bytes.Length) octets)" -ForegroundColor Gray
    Write-Host ""

    & $clamscan "--database=$databaseDir" --stdout $target
    $exitCode = $LASTEXITCODE

    Write-Host ""
    Write-Host "Code de sortie clamscan : $exitCode" -ForegroundColor Gray
    switch ($exitCode) {
        0 {
            Write-Host "Aucune détection : EICAR n'a pas été reconnu." -ForegroundColor Red
            Write-Host "Vérifiez la base de signatures et la version de ClamAV." -ForegroundColor Yellow
        }
        1 {
            Write-Host "SUCCÈS : EICAR a été détecté par ClamAV via CBS Shield." -ForegroundColor Green
        }
        default {
            Write-Host "ClamAV a signalé une erreur (code $exitCode)." -ForegroundColor Yellow
            Write-Host "Sous Windows, l'erreur 225 est généralement causée par Microsoft Defender," -ForegroundColor Yellow
            Write-Host "qui empêche ClamAV de lire le fichier de test. Ce n'est pas contourné." -ForegroundColor Yellow
        }
    }
    exit $exitCode
}
finally {
    if ($KeepFile) {
        Write-Host "Fichier conservé : $target" -ForegroundColor Yellow
    } else {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Dossier temporaire supprimé : $tempDir" -ForegroundColor Gray
    }
}
