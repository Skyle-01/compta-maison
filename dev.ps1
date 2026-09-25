<#
.SYNOPSIS
    Start the compta backend (FastAPI/uvicorn) and frontend (Next.js) together.
.DESCRIPTION
    Launches both dev servers in this console; Ctrl+C (or closing the window) stops both,
    including uvicorn's --reload child processes.
        Backend : http://localhost:8000
        Frontend: http://localhost:3000  (proxies /api -> :8000)
#>
[CmdletBinding()]
param(
    [int]$BackendPort = 8000
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$python = Join-Path $root ".venv/Scripts/python.exe"

if (-not (Test-Path $python)) {
    throw "Virtualenv python not found at $python. Create it and run: & '$python' -m pip install -r backend/requirements.txt"
}

$procs = @()
try {
    Write-Host "Starting backend on http://localhost:$BackendPort ..." -ForegroundColor Cyan
    $procs += Start-Process -FilePath $python `
        -ArgumentList @("-m", "uvicorn", "app.main:app", "--port", "$BackendPort", "--reload") `
        -WorkingDirectory (Join-Path $root "backend") -NoNewWindow -PassThru

    Write-Host "Starting frontend on http://localhost:3000 ..." -ForegroundColor Cyan
    $procs += Start-Process -FilePath "npm.cmd" `
        -ArgumentList @("run", "dev", "--prefix", "frontend") `
        -WorkingDirectory $root -NoNewWindow -PassThru

    Write-Host "Both servers running. Press Ctrl+C to stop." -ForegroundColor Green
    Wait-Process -Id ($procs | ForEach-Object { $_.Id })
}
finally {
    Write-Host "`nStopping servers..." -ForegroundColor Yellow
    foreach ($p in $procs) {
        if ($p -and -not $p.HasExited) {
            try { $p.Kill($true) } catch { }  # $true = kill the whole process tree
        }
    }
}
