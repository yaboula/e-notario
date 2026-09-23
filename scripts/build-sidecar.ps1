$ErrorActionPreference = 'Stop'
$workspaceDirectory = Split-Path -Parent $PSScriptRoot
Push-Location $workspaceDirectory
try {
    $releaseVersion = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
    foreach ($packagePath in @('apps/desktop/package.json', 'apps/mobile-capture/package.json')) {
        $packageVersion = (Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json).version
        if ($packageVersion -cne $releaseVersion) {
            throw "Version mismatch: $packagePath is $packageVersion but the release is $releaseVersion."
        }
    }
    foreach ($distPath in @('apps/desktop/dist/assets', 'apps/mobile-capture/dist/assets')) {
        $bundles = @(Get-ChildItem -LiteralPath $distPath -Filter '*.js' -File -ErrorAction SilentlyContinue)
        if ($bundles.Count -eq 0 -or -not ($bundles | Select-String -SimpleMatch $releaseVersion -Quiet)) {
            throw "Stale build assets: $distPath does not contain release version $releaseVersion. Run pnpm build first."
        }
    }
    $assetMappings = @(
        @{Source='apps/desktop/dist'; Target='apps/desktop/dist'},
        @{Source='apps/mobile-capture/dist'; Target='apps/mobile-capture/dist'},
        @{Source='src/cnie_documents/templates'; Target='cnie_documents/templates'}
    )
    $expectedAssets = @()
    foreach ($mapping in $assetMappings) {
        $sourceRoot = Join-Path $workspaceDirectory $mapping.Source
        if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
            throw "Missing build assets: $($mapping.Source). Run pnpm build first."
        }
        foreach ($asset in Get-ChildItem -LiteralPath $sourceRoot -File -Recurse) {
            $relative = $asset.FullName.Substring($sourceRoot.Length).TrimStart([char[]]'\/')
            $expectedAssets += @{
                Source=$asset.FullName
                Target=Join-Path $mapping.Target $relative
                Hash=(Get-FileHash -LiteralPath $asset.FullName -Algorithm SHA256).Hash
            }
        }
    }
    $desktopAssets = (Join-Path $workspaceDirectory 'apps/desktop/dist') + ':apps/desktop/dist'
    $mobileAssets = (Join-Path $workspaceDirectory 'apps/mobile-capture/dist') + ':apps/mobile-capture/dist'
    & .\.venv\Scripts\python.exe -m PyInstaller --noconfirm --onedir --contents-directory runtime --name cnie-capture --distpath apps/desktop/src-tauri/binaries --workpath build/sidecar --specpath build --collect-data cnie_rectifier --collect-data cnie_documents --collect-binaries onnxruntime --collect-data onnx --hidden-import lxml --hidden-import onnx --hidden-import onnxruntime --collect-submodules uvicorn --collect-submodules websockets --add-data $desktopAssets --add-data $mobileAssets scripts/capture_entry.py
    if ($LASTEXITCODE -ne 0) { throw 'Sidecar build failed' }
    if (-not (Test-Path -LiteralPath 'apps/desktop/src-tauri/binaries/cnie-capture/cnie-capture.exe')) {
        throw 'Sidecar executable was not generated'
    }
    $runtimeRoot = Join-Path $workspaceDirectory 'apps/desktop/src-tauri/binaries/cnie-capture/runtime'
    foreach ($asset in $expectedAssets) {
        $packagedAsset = Join-Path $runtimeRoot $asset.Target
        if (-not (Test-Path -LiteralPath $packagedAsset -PathType Leaf)) {
            throw "Missing packaged resource: $($asset.Target). The build must not be distributed."
        }
        if ((Get-FileHash -LiteralPath $asset.Source -Algorithm SHA256).Hash -ne $asset.Hash -or
            (Get-FileHash -LiteralPath $packagedAsset -Algorithm SHA256).Hash -ne $asset.Hash) {
            throw "Resource changed during packaging or differs from its source: $($asset.Target). Build again without editing the assets."
        }
    }
    Write-Host "Verified $($expectedAssets.Count) packaged web and document-template resources."
} finally { Pop-Location }
