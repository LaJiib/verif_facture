param(
    [switch]$SkipFrontend
)
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$frontendDir = Join-Path $repoRoot "frontend"
$backendDir = Join-Path $repoRoot "backend"
$staticDir = Join-Path $backendDir "static"

Write-Host "==> Build release depuis $repoRoot" -ForegroundColor Cyan

if (-not $SkipFrontend) {
    Write-Host "==> Frontend: npm install && npm run build" -ForegroundColor Cyan
    Push-Location $frontendDir
    npm.cmd install
    npm.cmd run build
    Pop-Location

    if (Test-Path $staticDir) { Remove-Item -Recurse -Force $staticDir }
    Copy-Item -Recurse -Force (Join-Path $frontendDir "dist") $staticDir
} else {
    Write-Host "==> Frontend sauté (SkipFrontend)" -ForegroundColor Yellow
}

Write-Host "==> Backend: installation des dépendances Python" -ForegroundColor Cyan
Push-Location $repoRoot
python -m pip install -r requirements.txt
Pop-Location

# Migration embarqu?e (idempotente) : ajoute la colonne statut aux bases existantes si d?tect?es.
Write-Host "==> Migration DB (colonne statut lignes_factures)" -ForegroundColor Cyan
try {
    python scripts/migrate_add_ligne_statut.py
} catch {
    Write-Host "Migration non appliqu?e (aucune base locale trouv?e ou Python indispo). Continuer..." -ForegroundColor Yellow
}

Write-Host "==> Packaging PyInstaller" -ForegroundColor Cyan
Push-Location $repoRoot
python -m PyInstaller pyinstaller.spec
Pop-Location

Write-Host "Build terminé. Exécutable: dist/VerifFacture.exe" -ForegroundColor Green


