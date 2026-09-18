param(
    [string]$EnginePath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'apps/desktop/src-tauri/binaries/cnie-capture/cnie-capture.exe')
)

$ErrorActionPreference = 'Stop'
$workspaceDirectory = Split-Path -Parent $PSScriptRoot
$configuration = Get-Content -LiteralPath (Join-Path $workspaceDirectory 'apps/desktop/src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$storageRoot = Join-Path $workspaceDirectory ('build/packaged-engine-smoke/{0}' -f [guid]::NewGuid())
$null = New-Item -ItemType Directory -Path $storageRoot
$engine = $null
$previousLocalAppData = $env:LOCALAPPDATA
$previousDesktopToken = $env:CNIE_DESKTOP_TOKEN
$previousTemp = $env:TEMP
$previousTmp = $env:TMP

function Invoke-PostStatus([string]$Uri,$Headers,[string]$Body) {
    try {
        $response = Invoke-WebRequest $Uri -Headers $Headers -Method Post -ContentType 'application/json' -Body $Body
        return [int]$response.StatusCode
    } catch {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        throw
    }
}

try {
    if (-not (Test-Path -LiteralPath $EnginePath -PathType Leaf)) { throw 'PACKAGED_ENGINE_MISSING' }
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,8787)
    try { $listener.Start() } finally { $listener.Stop() }
    $env:LOCALAPPDATA = $storageRoot
    $env:TEMP = $storageRoot
    $env:TMP = $storageRoot
    $env:CNIE_DESKTOP_TOKEN = 'qa-synthetic-' + [guid]::NewGuid().ToString()
    $desktopHeaders = @{Authorization=('Bearer ' + $env:CNIE_DESKTOP_TOKEN)}
    $engine = Start-Process -FilePath $EnginePath -ArgumentList 'serve' -PassThru -WindowStyle Hidden
    $deadline = (Get-Date).AddSeconds(60)
    $health = $null
    do {
        if ($engine.HasExited) { throw 'PACKAGED_ENGINE_EXITED' }
        try { $health = Invoke-RestMethod 'http://127.0.0.1:8787/api/health' -TimeoutSec 2 } catch {}
        if (-not $health) { Start-Sleep -Milliseconds 200 }
    } while (-not $health -and (Get-Date) -lt $deadline)
    if (-not $health) { throw 'PACKAGED_ENGINE_TIMEOUT' }
    if ($health.version -ne $configuration.version -or $health.api_version -ne 2) { throw 'PACKAGED_ENGINE_CONTRACT_MISMATCH' }

    $challenge = Invoke-RestMethod 'http://127.0.0.1:8787/api/pairing' -Headers $desktopHeaders -Method Post
    $pairCode = ($challenge.url -split '#pair=',2)[1]
    if (-not $pairCode) { throw 'PACKAGED_PAIRING_FAILED' }
    $paired = Invoke-RestMethod 'http://127.0.0.1:8787/api/pair' -Method Post -ContentType 'application/json' -Body (@{code=$pairCode} | ConvertTo-Json)
    if (-not $paired.token) { throw 'PACKAGED_PAIRING_FAILED' }
    $mobileHeaders = @{Authorization=('Bearer ' + $paired.token);'Idempotency-Key'=[guid]::NewGuid().ToString()}
    $catalog = Invoke-RestMethod 'http://127.0.0.1:8787/api/document-templates' -Headers $mobileHeaders
    foreach ($templateFolder in @('marriage','inheritance')) {
        $sourceManifest = Get-Content -LiteralPath (Join-Path $workspaceDirectory ('src/cnie_documents/templates/{0}/manifest.json' -f $templateFolder)) -Raw | ConvertFrom-Json
        $packagedTemplate = $catalog | Where-Object id -eq $sourceManifest.id | Select-Object -First 1
        if (-not $packagedTemplate -or $packagedTemplate.version -ne $sourceManifest.version) {
            throw 'PACKAGED_TEMPLATE_VERSION_MISMATCH'
        }
    }

    $usagePath = Join-Path $storageRoot 'e-notario-v2/ocr-usage.json'
    if (Test-Path -LiteralPath $usagePath) { throw 'SYNTHETIC_USAGE_ALREADY_EXISTS' }
    [IO.File]::WriteAllText($usagePath,'synthetic-invalid-json',[Text.UTF8Encoding]::new($false))
    $usageStatus = 0
    $usageCode = $null
    try {
        $null = Invoke-WebRequest 'http://127.0.0.1:8787/api/ocr/usage' -Headers $desktopHeaders
    } catch {
        if (-not $_.Exception.Response) { throw }
        $usageStatus = [int]$_.Exception.Response.StatusCode
        $usageCode = ($_.ErrorDetails.Message | ConvertFrom-Json).detail
    }
    if ($usageStatus -ne 503 -or $usageCode -ne 'OCR_USAGE_READ_FAILED') {
        throw 'PACKAGED_CORRUPT_USAGE_NOT_BLOCKED'
    }
    Remove-Item -LiteralPath $usagePath
    $template = $catalog | Where-Object id -eq 'ma.marriage' | Select-Object -First 1
    if (-not $template) { throw 'PACKAGED_TEMPLATE_MISSING' }
    $caseBody = @{template_id=$template.id;template_version=$template.version;mode='complete'} | ConvertTo-Json
    $case = Invoke-RestMethod 'http://127.0.0.1:8787/api/cases' -Headers $mobileHeaders -Method Post -ContentType 'application/json' -Body $caseBody
    $statuses = @()
    foreach ($action in @('generate','complete','reopen')) {
        $body = @{revision=0;confirm_incomplete=$true} | ConvertTo-Json
        $statuses += Invoke-PostStatus ("http://127.0.0.1:8787/api/cases/{0}/{1}" -f $case.id,$action) $mobileHeaders $body
    }
    if (($statuses | Where-Object { $_ -ne 403 }).Count) { throw 'PACKAGED_MOBILE_AUTHORIZATION_FAILED' }
    [pscustomobject]@{
        version=$health.version
        api_version=$health.api_version
        template_count=$catalog.Count
        mobile_restricted_statuses=($statuses -join ',')
        corrupt_usage_status=$usageStatus
        corrupt_usage_code=$usageCode
        storage_root=$storageRoot
    } | ConvertTo-Json -Compress
} finally {
    if ($engine -and -not $engine.HasExited) {
        # Only terminate the isolated process started above.
        Stop-Process -Id $engine.Id -Force -ErrorAction SilentlyContinue
        $null = $engine.WaitForExit(5000)
    }
    $env:LOCALAPPDATA = $previousLocalAppData
    $env:CNIE_DESKTOP_TOKEN = $previousDesktopToken
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
}
