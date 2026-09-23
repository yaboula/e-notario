param(
    [string]$CertificateThumbprint = $env:ENOTARIO_SIGNING_THUMBPRINT,
    [string]$TimestampUrl = $env:ENOTARIO_TIMESTAMP_URL,
    [switch]$Control,
    [string]$SupabaseUrl = $env:VITE_SUPABASE_URL,
    [string]$SupabasePublishableKey = $env:VITE_SUPABASE_PUBLISHABLE_KEY,
    [string]$LeaseKeyId = $env:ENOTARIO_CONTROL_LEASE_KEY_ID,
    [string]$LeasePublicKey = $env:ENOTARIO_CONTROL_LEASE_PUBLIC_KEY,
    [string]$LeasePublicKeys = $env:ENOTARIO_CONTROL_LEASE_PUBLIC_KEYS
)

$ErrorActionPreference = 'Stop'
$workspaceDirectory = Split-Path -Parent $PSScriptRoot
$git = Get-Command git.exe -ErrorAction SilentlyContinue
if (-not $git) { $git = Get-Command git -ErrorAction SilentlyContinue }
if (-not $git) { throw 'Git is required to identify the source of a signed release.' }
$sourceCommit = (& $git.Source -C $workspaceDirectory rev-parse --verify HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[a-f0-9]{40}$') {
    throw 'The signed release must be built from a Git commit.'
}
$sourceChanges = @(& $git.Source -C $workspaceDirectory status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the release worktree.' }
if ($sourceChanges.Count -ne 0) {
    throw 'Commit or remove every tracked and untracked change before signing a release.'
}
$leaseKeyIds = @()
if ($Control) {
    if ($env:CONTROL_LEASE_PRIVATE_KEY_PEM -or $env:CONTROL_SUPABASE_SECRET_KEY -or
        $env:SUPABASE_SERVICE_ROLE_KEY -or $env:SUPABASE_SECRET_KEY -or $env:SUPABASE_DB_URL) {
        throw 'Server-only control secrets must not be present in the installer build environment.'
    }
    $controlUri = $null
    if (-not [Uri]::TryCreate($SupabaseUrl, [UriKind]::Absolute, [ref]$controlUri) -or
        $controlUri.Scheme -ne 'https' -or -not $controlUri.IsDefaultPort -or
        $controlUri.DnsSafeHost -notmatch '^[a-z0-9-]+\.supabase\.co$' -or
        $controlUri.UserInfo -or $controlUri.Query -or $controlUri.Fragment -or
        $controlUri.AbsolutePath -ne '/') {
        throw 'Control pilot requires a project HTTPS URL at *.supabase.co.'
    }
    if ([string]::IsNullOrWhiteSpace($SupabasePublishableKey) -or
        $SupabasePublishableKey -match '\s|YOUR_|PLACEHOLDER' -or
        $SupabasePublishableKey.Length -lt 20) {
        throw 'Control pilot requires the real Supabase publishable key.'
    }
    if ([string]::IsNullOrWhiteSpace($LeasePublicKeys)) {
        $LeasePublicKeys = "$LeaseKeyId=$LeasePublicKey"
    }
    $leaseEntries = @($LeasePublicKeys -split ';')
    if ($leaseEntries.Count -lt 1 -or $leaseEntries.Count -gt 3) {
        throw 'Control pilot accepts between one and three Ed25519 lease public keys.'
    }
    $seenLeaseIds = @{}
    $seenLeaseKeys = @{}
    foreach ($leaseEntry in $leaseEntries) {
        $parts = @($leaseEntry -split '=', 2)
        if ($parts.Count -ne 2 -or $parts[0] -notmatch '^[A-Za-z0-9._-]{1,64}$') {
            throw 'Control pilot lease keyring contains an invalid key ID.'
        }
        if ($parts[1] -notmatch '^[A-Za-z0-9_-]{43}$') {
            throw 'Control pilot requires 32-byte Ed25519 public keys encoded as base64url.'
        }
        try {
            $decodedPublicKey = [Convert]::FromBase64String(($parts[1].Replace('-','+').Replace('_','/')) + '=')
        } catch {
            throw 'Control pilot lease public key is not valid base64url.'
        }
        $canonicalPublicKey = [Convert]::ToBase64String($decodedPublicKey).TrimEnd('=').Replace('+','-').Replace('/','_')
        if ($decodedPublicKey.Length -ne 32 -or $canonicalPublicKey -cne $parts[1] -or
            $seenLeaseIds.ContainsKey($parts[0]) -or
            $seenLeaseKeys.ContainsKey($parts[1])) {
            throw 'Control pilot lease keyring contains an invalid or duplicate key.'
        }
        $seenLeaseIds[$parts[0]] = $true
        $seenLeaseKeys[$parts[1]] = $true
        $leaseKeyIds += $parts[0]
    }
    $LeasePublicKeys = $leaseEntries -join ';'
}
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
$previousControlEnvironment = @{
    VITE_SUPABASE_URL = $env:VITE_SUPABASE_URL
    VITE_SUPABASE_PUBLISHABLE_KEY = $env:VITE_SUPABASE_PUBLISHABLE_KEY
    ENOTARIO_CONTROL_LEASE_KEY_ID = $env:ENOTARIO_CONTROL_LEASE_KEY_ID
    ENOTARIO_CONTROL_LEASE_PUBLIC_KEY = $env:ENOTARIO_CONTROL_LEASE_PUBLIC_KEY
    ENOTARIO_CONTROL_LEASE_PUBLIC_KEYS = $env:ENOTARIO_CONTROL_LEASE_PUBLIC_KEYS
}
Push-Location $workspaceDirectory
try {
    if ($Control) {
        $env:VITE_SUPABASE_URL = $controlUri.AbsoluteUri.TrimEnd('/')
        $env:VITE_SUPABASE_PUBLISHABLE_KEY = $SupabasePublishableKey
        $env:ENOTARIO_CONTROL_LEASE_KEY_ID = $LeaseKeyId
        $env:ENOTARIO_CONTROL_LEASE_PUBLIC_KEY = $LeasePublicKey
        $env:ENOTARIO_CONTROL_LEASE_PUBLIC_KEYS = $LeasePublicKeys
    }
    & .\.venv\Scripts\python.exe -m pytest
    if ($LASTEXITCODE -ne 0) { throw 'Core verification failed. No release artifacts will be signed.' }
    pnpm -r --if-present test
    if ($LASTEXITCODE -ne 0) { throw 'UI verification failed. No release artifacts will be signed.' }
    pnpm typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Type verification failed. No release artifacts will be signed.' }
    $env:RC = Find-ResourceCompiler
    Push-Location (Join-Path $workspaceDirectory 'apps\desktop\src-tauri')
    try {
        if ($Control) { cargo test --locked --features control }
        else { cargo test --locked }
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

    $tauriOverride = @{
        bundle = @{ windows = @{
            certificateThumbprint = $normalizedThumbprint
            digestAlgorithm = 'sha256'
            timestampUrl = $TimestampUrl
            tsp = $true
        }}
    }
    if ($Control) {
        $controlOrigin = $controlUri.GetLeftPart([UriPartial]::Authority)
        $tauriOverride.app = @{ security = @{ csp =
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src ipc: http://ipc.localhost http://127.0.0.1:8787 ws://127.0.0.1:8787 $controlOrigin; frame-ancestors 'none'; base-uri 'self'" } }
    }
    $signingConfig = $tauriOverride | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText($configPath, $signingConfig, [Text.UTF8Encoding]::new($false))

    if ($Control) { pnpm --filter '@notario/desktop' tauri build --config $configPath --features control }
    else { pnpm --filter '@notario/desktop' tauri build --config $configPath }
    if ($LASTEXITCODE -ne 0) { throw 'Tauri release build failed.' }
    Assert-SignedByOrganization (Join-Path $workspaceDirectory 'apps\desktop\src-tauri\target\release\valiris-desk.exe')

    $bundleDirectory = Join-Path $workspaceDirectory 'apps\desktop\src-tauri\target\release\bundle\nsis'
    $releaseVersion = (Get-Content -LiteralPath 'apps\desktop\src-tauri\tauri.conf.json' -Raw | ConvertFrom-Json).version
    $installers = @(Get-ChildItem -LiteralPath $bundleDirectory -Filter ('Valiris Desk_{0}_*-setup.exe' -f $releaseVersion) -File)
    if ($installers.Count -ne 1) { throw 'Expected exactly one NSIS setup executable.' }
    Assert-SignedByOrganization $installers[0].FullName
    $installerHash = (Get-FileHash -LiteralPath $installers[0].FullName -Algorithm SHA256).Hash
    $variant = if ($Control) { 'control' } else { 'local' }
    $manifestPath = Join-Path $bundleDirectory ("valiris-desk_{0}_{1}-release.json" -f $releaseVersion,$variant)
    $manifest = [ordered]@{
        schema = 'enotario.release/v1'
        product = 'Valiris Desk'
        version = $releaseVersion
        variant = $variant
        source_commit = $sourceCommit
        built_at_utc = [DateTimeOffset]::UtcNow.ToString('o')
        installer = [ordered]@{
            file = $installers[0].Name
            size_bytes = $installers[0].Length
            sha256 = $installerHash
        }
        signer = [ordered]@{
            thumbprint = $normalizedThumbprint
            subject = $certificate.Subject
            not_after_utc = ([DateTimeOffset]$certificate.NotAfter.ToUniversalTime()).ToString('o')
        }
        control = if ($Control) { [ordered]@{
            supabase_host = $controlUri.DnsSafeHost
            lease_key_ids = @($leaseKeyIds)
        }} else { $null }
    } | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText($manifestPath, $manifest, [Text.UTF8Encoding]::new($false))
    Write-Host "Verified signed installer: $($installers[0].FullName)"
    Write-Host "SHA-256: $installerHash"
    Write-Host "Release manifest: $manifestPath"
} finally {
    $env:RC = $previousResourceCompiler
    if ($Control) {
        foreach ($entry in $previousControlEnvironment.GetEnumerator()) {
            $environmentPath = "Env:$($entry.Key)"
            if ($null -eq $entry.Value) { Remove-Item -Path $environmentPath -ErrorAction SilentlyContinue }
            else { Set-Item -Path $environmentPath -Value $entry.Value }
        }
    }
    Pop-Location
    if (Test-Path -LiteralPath $configPath) { Remove-Item -LiteralPath $configPath -Force }
}
