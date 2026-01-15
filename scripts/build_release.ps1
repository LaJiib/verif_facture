param(
    [switch]$SkipFrontend
)
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$frontendDir = Join-Path $repoRoot "frontend"
$backendDir = Join-Path $repoRoot "backend"
$staticDir = Join-Path $backendDir "static"
$buildDir = Join-Path $repoRoot "build"
$versionFile = Join-Path $repoRoot "VERSION"
$pyinstallerVersionFile = Join-Path $buildDir "VerifFactureVersion.txt"

function Get-AppVersion {
    if (-not (Test-Path $versionFile)) {
        throw "Fichier VERSION introuvable ($versionFile). Cree-le avec un numero (ex: 1.2.3)."
    }
    $v = (Get-Content $versionFile -ErrorAction Stop | Select-Object -First 1).Trim()
    if (-not $v) { throw "VERSION est vide." }
    return $v
}

function New-VersionResource {
    param(
        [string]$VersionText
    )
    if (-not (Test-Path $buildDir)) {
        New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
    }

    $parts = $VersionText.Split(".")
    $major = [int]($parts[0])
    $minor = [int]($(if ($parts.Length -ge 2) { $parts[1] } else { 0 }))
    $patch = [int]($(if ($parts.Length -ge 3) { $parts[2] } else { 0 }))
    $build = [int]($(if ($parts.Length -ge 4) { $parts[3] } else { 0 }))

    @"
VSVersionInfo(
  ffi=FixedFileInfo(
    filevers=($major, $minor, $patch, $build),
    prodvers=($major, $minor, $patch, $build),
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo([
      StringTable('040904B0', [
        StringStruct('CompanyName', 'JBSK Consulting'),
        StringStruct('FileDescription', 'VerifFacture'),
        StringStruct('FileVersion', '$VersionText'),
        StringStruct('ProductVersion', '$VersionText'),
        StringStruct('ProductName', 'VerifFacture')
      ])
    ]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"@ | Set-Content -Path $pyinstallerVersionFile -Encoding ASCII
}

$appVersion = Get-AppVersion
$env:VF_VERSION = $appVersion

Write-Host "==> Build release depuis $repoRoot (version $appVersion)" -ForegroundColor Cyan
Write-Host "==> Generation du fichier version PyInstaller" -ForegroundColor Cyan
New-VersionResource -VersionText $appVersion

if (-not $SkipFrontend) {
    Write-Host "==> Frontend: npm install && npm run build" -ForegroundColor Cyan
    Push-Location $frontendDir
    npm.cmd install
    npm.cmd run build
    Pop-Location

    if (Test-Path $staticDir) { Remove-Item -Recurse -Force $staticDir }
    Copy-Item -Recurse -Force (Join-Path $frontendDir "dist") $staticDir
} else {
    Write-Host "==> Frontend saute (SkipFrontend)" -ForegroundColor Yellow
}

Write-Host "==> Backend: installation des dependances Python" -ForegroundColor Cyan
Push-Location $repoRoot
python -m pip install -r requirements.txt
Pop-Location

# Migration embarquee (idempotente) : ajoute la colonne statut aux bases existantes si detectees.
Write-Host "==> Migration DB (colonne statut lignes_factures)" -ForegroundColor Cyan
try {
    python scripts/migrate_add_ligne_statut.py
} catch {
    Write-Host "Migration non appliquee (aucune base locale trouvee ou Python indispo). Continuer..." -ForegroundColor Yellow
}

Write-Host "==> Packaging PyInstaller (VerifFacture)" -ForegroundColor Cyan
Push-Location $repoRoot
python -m PyInstaller pyinstaller.spec
Write-Host "==> Packaging PyInstaller (migrate_add_ligne_statut)" -ForegroundColor Cyan
python -m PyInstaller migrate_add_ligne_statut.spec
Pop-Location

# Optionnel: build installeur Inno Setup si iscc est disponible
$iss = Join-Path $repoRoot "installer" "VerifFacture.iss"
if (Get-Command iscc.exe -ErrorAction SilentlyContinue) {
    Write-Host "==> Inno Setup (version $appVersion)" -ForegroundColor Cyan
    iscc.exe "/DMyAppVersion=$appVersion" $iss
} else {
    Write-Host "Inno Setup (iscc.exe) introuvable dans le PATH, installeur non genere." -ForegroundColor Yellow
}

Write-Host "Build termine. Executables: dist/VerifFacture.exe et dist/migrate_add_ligne_statut.exe" -ForegroundColor Green
