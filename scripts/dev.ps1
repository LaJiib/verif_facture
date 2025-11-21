$ErrorActionPreference = "Stop"

# Resolve repository root (scripts/..)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")

# Python interpreter
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    $python = "python"
}

$backendCmd = "$python -m uvicorn backend.api:app --reload --port 8000 --log-level debug"
$frontendCmd = "npm run dev -- --host --port 5173"

Write-Host "Starting backend (uvicorn)..." -ForegroundColor Cyan
Start-Process -FilePath "powershell" -WorkingDirectory $repoRoot -ArgumentList @(
    "-NoLogo",
    "-NoExit",
    "-Command",
    "$env:PYTHONPATH='$repoRoot\src'; cd '$repoRoot'; $backendCmd"
)

Write-Host "Starting frontend (Vite)..." -ForegroundColor Cyan
Start-Process -FilePath "powershell" -WorkingDirectory (Join-Path $repoRoot "frontend") -ArgumentList @(
    "-NoLogo",
    "-NoExit",
    "-Command",
    "$frontendCmd"
)

Write-Host "Both processes launched. Backend: http://localhost:8000  Frontend: http://localhost:5173" -ForegroundColor Green
Write-Host "Use Ctrl+C in each spawned window to stop them."
