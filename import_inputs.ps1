<#
.SYNOPSIS
    Import the bank statements dropped in _inputs/ into the existing compta.db.
.DESCRIPTION
    Runs backend/scripts/import_inputs.py with the virtualenv's python: only rows not yet in the
    database are added, nothing is deleted. Extra arguments (e.g. --db PATH) are passed through.
#>
$ErrorActionPreference = "Stop"
$python = Join-Path $PSScriptRoot ".venv/Scripts/python.exe"

if (-not (Test-Path $python)) {
    throw "Virtualenv python not found at $python. Create it and run: & '$python' -m pip install -r backend/requirements.txt"
}

& $python (Join-Path $PSScriptRoot "backend/scripts/import_inputs.py") @args
exit $LASTEXITCODE
