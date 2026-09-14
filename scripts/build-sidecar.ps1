$ErrorActionPreference = 'Stop'
$workspaceDirectory = Split-Path -Parent $PSScriptRoot
Push-Location $workspaceDirectory
try {
    $desktopAssets = (Join-Path $workspaceDirectory 'apps/desktop/dist') + ':apps/desktop/dist'
    $mobileAssets = (Join-Path $workspaceDirectory 'apps/mobile-capture/dist') + ':apps/mobile-capture/dist'
    & .\.venv\Scripts\python.exe -m PyInstaller --noconfirm --onedir --contents-directory runtime --name cnie-capture --distpath apps/desktop/src-tauri/binaries --workpath build/sidecar --specpath build --collect-data cnie_rectifier --collect-binaries onnxruntime --collect-data onnx --hidden-import onnx --hidden-import onnxruntime --collect-submodules uvicorn --collect-submodules websockets --add-data $desktopAssets --add-data $mobileAssets scripts/capture_entry.py
    if ($LASTEXITCODE -ne 0) { throw 'Sidecar build failed' }
    if (-not (Test-Path -LiteralPath 'apps/desktop/src-tauri/binaries/cnie-capture/cnie-capture.exe')) {
        throw 'Sidecar executable was not generated'
    }
} finally { Pop-Location }
