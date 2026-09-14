$ErrorActionPreference = 'Stop'
$workspaceDirectory = Split-Path -Parent $PSScriptRoot
Push-Location $workspaceDirectory
try {
    if (-not (Test-Path -LiteralPath 'apps/desktop/dist/index.html')) { throw 'Run pnpm build first.' }
    & .\.venv\Scripts\python.exe -m cnie_capture serve --open
} finally { Pop-Location }
