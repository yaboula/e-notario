param(
    [string]$CertificateThumbprint = $env:ENOTARIO_SIGNING_THUMBPRINT,
    [string]$TimestampUrl = $env:ENOTARIO_TIMESTAMP_URL
)

$ErrorActionPreference = 'Stop'
$workspaceDirectory = Split-Path -Parent $PSScriptRoot
$normalizedThumbprint = ($CertificateThumbprint -replace '\s', '').ToUpperInvariant()
if (-not $normalizedThumbprint) { throw 'Set ENOTARIO_SIGNING_THUMBPRINT to the organization code-signing certificate thumbprint.' }
if (-not $TimestampUrl) { throw 'Set ENOTARIO_TIMESTAMP_URL to the RFC 3161 timestamp service supplied by the certificate provider.' }
if ($normalizedThumbprint -notmatch '^[A-F0-9]{40}$') { throw 'The certificate thumbprint must contain exactly 40 hexadecimal characters.' }
$timestampService = $null
if (-not [Uri]::TryCreate($TimestampUrl, [UriKind]::Absolute, [ref]$timestampService) -or
    $timestampService.Scheme -notin @('http','https') -or $timestampService.UserInfo) {
    throw 'The timestamp service must be an absolute HTTP(S) URL without embedded credentials.'
}

$certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$normalizedThumbprint" -ErrorAction Stop
if (-not $certificate.HasPrivateKey) { throw 'The code-signing certificate does not expose its private key to this user.' }
if ($certificate.NotBefore -gt (Get-Date)) { throw 'The code-signing certificate is not valid yet.' }
if ($certificate.NotAfter -le (Get-Date).AddDays(14)) { throw 'The code-signing certificate is expired or expires in less than 14 days.' }
$codeSigningOid = '1.3.6.1.5.5.7.3.3'
if (-not ($certificate.EnhancedKeyUsageList.ObjectId.Value -contains $codeSigningOid)) {
    throw 'The selected certificate is not valid for code signing.'
}

function Find-SignTool {
    $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $kitsRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    $candidate = Get-ChildItem -LiteralPath $kitsRoot -Filter signtool.exe -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
        Sort-Object FullName -Descending | Select-Object -First 1
    if (-not $candidate) { throw 'signtool.exe was not found. Install the Windows SDK signing tools.' }
    return $candidate.FullName
}

function Find-ResourceCompiler {
    $command = Get-Command rc.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $kitsRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    $candidate = Get-ChildItem -LiteralPath $kitsRoot -Filter rc.exe -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\x64\\rc\.exe$' } |
        Sort-Object FullName -Descending | Select-Object -First 1
    if (-not $candidate) { throw 'rc.exe was not found. Install the Windows SDK resource compiler.' }
    return $candidate.FullName
}

function Assert-SignedByOrganization([string]$Path) {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne 'Valid') { throw "Invalid Authenticode signature: $Path ($($signature.Status))" }
    if (($signature.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant() -ne $normalizedThumbprint) {
        throw "Unexpected signer certificate: $Path"
    }
}

$configPath = Join-Path ([IO.Path]::GetTempPath()) ("enotario-tauri-signing-{0}.json" -f [guid]::NewGuid())
$previousResourceCompiler = $env:RC
Push-Location $workspaceDirectory
try {
    & .\.venv\Scripts\python.exe -m pytest
    if ($LASTEXITCODE -ne 0) { throw 'Core verification failed. No release artifacts will be signed.' }
    pnpm -r --if-present test
    if ($LASTEXITCODE -ne 0) { throw 'UI verification failed. No release artifacts will be signed.' }
    pnpm typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Type verification failed. No release artifacts will be signed.' }
    $env:RC = Find-ResourceCompiler
    Push-Location (Join-Path $workspaceDirectory 'apps\desktop\src-tauri')
    try {
        cargo test --locked
        if ($LASTEXITCODE -ne 0) { throw 'Native verification failed. No release artifacts will be signed.' }
    } finally { Pop-Location }
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw 'Web application build failed.' }
    & (Join-Path $PSScriptRoot 'build-sidecar.ps1')

    $sidecar = Join-Path $workspaceDirectory 'apps\desktop\src-tauri\binaries\cnie-capture\cnie-capture.exe'
    $signTool = Find-SignTool
    & $signTool sign /sha1 $normalizedThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $sidecar
    if ($LASTEXITCODE -ne 0) { throw 'Sidecar signing failed.' }
    Assert-SignedByOrganization $sidecar

    $signingConfig = @{
        bundle = @{ windows = @{
            certificateThumbprint = $normalizedThumbprint
            digestAlgorithm = 'sha256'
            timestampUrl = $TimestampUrl
            tsp = $true
        }}
    } | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText($configPath, $signingConfig, [Text.UTF8Encoding]::new($false))

    pnpm --filter '@notario/desktop' tauri build --config $configPath
    if ($LASTEXITCODE -ne 0) { throw 'Tauri release build failed.' }
    Assert-SignedByOrganization (Join-Path $workspaceDirectory 'apps\desktop\src-tauri\target\release\e-notario.exe')

    $bundleDirectory = Join-Path $workspaceDirectory 'apps\desktop\src-tauri\target\release\bundle\nsis'
    $releaseVersion = (Get-Content -LiteralPath 'apps\desktop\src-tauri\tauri.conf.json' -Raw | ConvertFrom-Json).version
    $installers = @(Get-ChildItem -LiteralPath $bundleDirectory -Filter ('e-notario_{0}_*-setup.exe' -f $releaseVersion) -File)
    if ($installers.Count -ne 1) { throw 'Expected exactly one NSIS setup executable.' }
    Assert-SignedByOrganization $installers[0].FullName
    Write-Host "Verified signed installer: $($installers[0].FullName)"
    Write-Host "SHA-256: $((Get-FileHash -LiteralPath $installers[0].FullName -Algorithm SHA256).Hash)"
} finally {
    $env:RC = $previousResourceCompiler
    Pop-Location
    if (Test-Path -LiteralPath $configPath) { Remove-Item -LiteralPath $configPath -Force }
}
