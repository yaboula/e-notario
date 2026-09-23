# This destructive-to-the-disposable-machine integration test MUST NOT run on a working PC.
$ErrorActionPreference = 'Stop'
if ($env:USERNAME -ne 'WDAGUtilityAccount' -or $env:USERPROFILE -notmatch '\\WDAGUtilityAccount$') {
    throw 'QA_SANDBOX_REQUIRED: this script only runs as the Windows Sandbox disposable account.'
}
$inputDirectory = 'C:\e-notario-qa\input'
$resultsDirectory = 'C:\e-notario-qa\results'
$installDirectory = 'C:\e-notario-qa\installed'
$configurationDirectory = Join-Path $env:LOCALAPPDATA 'e-notario-v2'
$report = @{schema='enotario.windows-qa-result/v1';status='running';checks=@();production_approved=$false}
$stage = 'manifest'
$engineProcess = $null
$previousDesktopToken = $env:CNIE_DESKTOP_TOKEN
$env:CNIE_DESKTOP_TOKEN = 'qa-synthetic-' + [guid]::NewGuid().ToString()
$headers = @{Authorization=('Bearer ' + $env:CNIE_DESKTOP_TOKEN)}

function Add-Check([string]$Name) { $script:report.checks += $Name }
function Assert-Hash([string]$Path,[string]$Expected) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf) -or
        (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Expected) { throw 'QA_HASH_MISMATCH' }
}
function Install-Package($Package) {
    if ($Package.file -notin @('current-setup.exe','previous-setup.exe') -or $Package.sha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw 'QA_MANIFEST_PACKAGE_INVALID' }
    $path = Join-Path $inputDirectory $Package.file
    Assert-Hash $path $Package.sha256
    $installation = Start-Process -FilePath $path -ArgumentList @('/S',("/D={0}" -f $installDirectory)) -PassThru -Wait -WindowStyle Hidden
    if ($installation.ExitCode -ne 0) { throw 'QA_INSTALLATION_FAILED' }
}
function Start-Engine([string]$ExpectedVersion,[int]$ExpectedApi=0) {
    $portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,8787)
    try { $portProbe.Start() } finally { $portProbe.Stop() }
    $script:engineProcess = Start-Process -FilePath (Join-Path $installDirectory 'sidecar/cnie-capture.exe') -ArgumentList 'serve' -PassThru -WindowStyle Hidden
    $deadline = (Get-Date).AddSeconds(60)
    do {
        if ($script:engineProcess.HasExited) { throw 'QA_ENGINE_EXITED' }
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:8787/api/health' -TimeoutSec 2
            if ($health.version -ne $ExpectedVersion -or ($ExpectedApi -gt 0 -and $health.api_version -ne $ExpectedApi)) { throw 'QA_ENGINE_VERSION_MISMATCH' }
            return
        } catch {
            if ($_.Exception.Message -eq 'QA_ENGINE_VERSION_MISMATCH') { throw }
        }
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $deadline)
    throw 'QA_ENGINE_START_TIMEOUT'
}
function Stop-Engine {
    if ($script:engineProcess) {
        if (-not $script:engineProcess.HasExited) {
            # Deliberately simulate process termination; only the process started by this test.
            Stop-Process -Id $script:engineProcess.Id -Force -ErrorAction SilentlyContinue
            if (-not $script:engineProcess.WaitForExit(5000)) { throw 'QA_ENGINE_STOP_TIMEOUT' }
        }
        $script:engineProcess = $null
    }
}
function Assert-MobileActionForbidden([string]$CaseId,[string]$Action,$MobileHeaders) {
    $parsedId = [guid]::Empty
    if (-not [guid]::TryParse($CaseId,[ref]$parsedId) -or $Action -notin @('generate','complete','reopen')) { throw 'QA_PERMISSION_INPUT_INVALID' }
    $body = @{revision=0;confirm_incomplete=$true} | ConvertTo-Json
    try {
        $null = Invoke-RestMethod ("http://127.0.0.1:8787/api/cases/{0}/{1}" -f $CaseId,$Action) -Headers $MobileHeaders -Method Post -ContentType 'application/json' -Body $body
    } catch {
        if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 403) { return }
        throw 'QA_MOBILE_PERMISSION_FAILED'
    }
    throw 'QA_MOBILE_PERMISSION_FAILED'
}
function Assert-InstalledFiles($Manifest) {
    $root = [IO.Path]::GetFullPath($installDirectory) + [IO.Path]::DirectorySeparatorChar
    foreach ($file in $Manifest.installed_files) {
        if ([IO.Path]::IsPathRooted($file.path) -or $file.path -match '(^|[\\/])\.\.([\\/]|$)' -or $file.path.Contains(':')) { throw 'QA_MANIFEST_PATH_INVALID' }
        $target = [IO.Path]::GetFullPath((Join-Path $installDirectory $file.path))
        if (-not $target.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)) { throw 'QA_MANIFEST_PATH_INVALID' }
        Assert-Hash $target $file.sha256
    }
    $registered = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Valiris Desk'
    if ($registered.DisplayVersion -ne $Manifest.version -or $registered.InstallLocation.Trim('"') -ne $installDirectory) { throw 'QA_REGISTRATION_MISMATCH' }
}

try {
    $manifest = Get-Content -LiteralPath (Join-Path $inputDirectory 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.schema -ne 'enotario.windows-qa/v1' -or $manifest.scenario -notin @('Clean','Upgrade') -or $manifest.production_approved -ne $false -or
        $manifest.version -notmatch '-(alpha|beta|rc)\.' -or $manifest.api_version -ne 2 -or $manifest.installed_files.Count -lt 2 -or
        $manifest.runner_sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or
        $manifest.current.file -ne 'current-setup.exe' -or
        ($manifest.scenario -eq 'Upgrade' -and ($manifest.previous.file -ne 'previous-setup.exe' -or $manifest.previous.version -ne '0.7.2'))) { throw 'QA_MANIFEST_INVALID' }
    Assert-Hash $PSCommandPath $manifest.runner_sha256
    Add-Check 'runner-matches-prepared-manifest'
    if (Test-Path -LiteralPath $installDirectory) { throw 'QA_ENVIRONMENT_NOT_CLEAN' }
    $report.version = $manifest.version
    $report.scenario = $manifest.scenario
    $report.authenticode_status = $manifest.authenticode_status
    if ($manifest.scenario -eq 'Upgrade') {
        $stage = 'baseline-install'
        Install-Package $manifest.previous
        Start-Engine $manifest.previous.version
        Stop-Engine
        Add-Type -AssemblyName System.Security
        $null = New-Item -ItemType Directory -Path $configurationDirectory -Force
        $marker = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes('e-notario synthetic DPAPI preservation fixture'),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
        [IO.File]::WriteAllBytes((Join-Path $configurationDirectory 'qa-preservation.dpapi'),$marker)
        $preservedFiles = @{}
        foreach ($file in Get-ChildItem -LiteralPath $configurationDirectory -Recurse -File) {
            $preservedFiles[$file.FullName] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        }
        Add-Check 'baseline-0.7.2-engine-start'
    }
    $stage = 'current-install'
    Install-Package $manifest.current
    Assert-InstalledFiles $manifest
    Add-Check 'installed-binaries-and-resources-match-build'
    Add-Check 'current-user-registration-and-version'
    if ($manifest.scenario -eq 'Upgrade') {
        foreach ($path in $preservedFiles.Keys) { Assert-Hash $path $preservedFiles[$path] }
        $report.preserved_configuration_files = $preservedFiles.Count
        Add-Check 'upgrade-preserves-generated-configuration-and-synthetic-dpapi'
    }
    $stage = 'current-engine-start'
    Start-Engine $manifest.version $manifest.api_version
    $profileId = [guid]::NewGuid().ToString()
    # ASCII source also works with Windows PowerShell 5.1's legacy script encoding.
    $profileArabic = -join ([char[]]@(0x0627,0x0644,0x0639,0x062F,0x0644,0x0020,0x0627,0x0644,0x062A,0x062C,0x0631,0x064A,0x0628,0x064A))
    $profileBody = @{id=$profileId;display_name_ar=$profileArabic;display_name_fr='QA synthetic profile';function_fr='Adoul'} | ConvertTo-Json
    $null = Invoke-RestMethod 'http://127.0.0.1:8787/api/professional-profiles' -Headers $headers -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($profileBody))
    $catalog = Invoke-RestMethod 'http://127.0.0.1:8787/api/document-templates' -Headers $headers
    $marriage = $catalog | Where-Object id -eq 'ma.marriage' | Select-Object -First 1
    if (-not $marriage) { throw 'QA_PILOT_TEMPLATE_MISSING' }
    $stage = 'mobile-permissions'
    $challenge = Invoke-RestMethod 'http://127.0.0.1:8787/api/pairing' -Headers $headers -Method Post
    $code = ($challenge.url -split '#pair=',2)[1]
    if (-not $code) { throw 'QA_PAIRING_FAILED' }
    $paired = Invoke-RestMethod 'http://127.0.0.1:8787/api/pair' -Method Post -ContentType 'application/json' -Body (@{code=$code} | ConvertTo-Json)
    if (-not $paired.token) { throw 'QA_PAIRING_FAILED' }
    $mobileHeaders = @{Authorization=('Bearer ' + $paired.token);'Idempotency-Key'=[guid]::NewGuid().ToString()}
    $caseBody = @{template_id=$marriage.id;template_version=$marriage.version;mode='complete'} | ConvertTo-Json
    $case = Invoke-RestMethod 'http://127.0.0.1:8787/api/cases' -Headers $mobileHeaders -Method Post -ContentType 'application/json' -Body $caseBody
    foreach ($action in @('generate','complete','reopen')) { Assert-MobileActionForbidden $case.id $action $mobileHeaders }
    Add-Check 'mobile-cannot-generate-complete-or-reopen-own-case'
    Add-Check 'installed-engine-api-compatible-and-synthetic-records-created'
    Stop-Engine
    $profilePath = Join-Path $configurationDirectory 'professional-profiles.dpapi'
    $profileHash = (Get-FileHash -LiteralPath $profilePath -Algorithm SHA256).Hash
    $stage = 'same-version-repair'
    Install-Package $manifest.current
    Assert-InstalledFiles $manifest
    Assert-Hash $profilePath $profileHash
    Add-Check 'same-version-repair-preserves-profile-store'
    $stage = 'record-recovery'
    Start-Engine $manifest.version $manifest.api_version
    $profiles = Invoke-RestMethod 'http://127.0.0.1:8787/api/professional-profiles' -Headers $headers
    if (-not ($profiles | Where-Object id -eq $profileId)) { throw 'QA_PROFILE_RECOVERY_FAILED' }
    $recovered = Invoke-RestMethod ("http://127.0.0.1:8787/api/cases/{0}" -f $case.id) -Headers $headers
    if ($recovered.id -ne $case.id -or $recovered.revision -ne $case.revision) { throw 'QA_CASE_RECOVERY_FAILED' }
    $mobileRecovered = Invoke-RestMethod ("http://127.0.0.1:8787/api/cases/{0}" -f $case.id) -Headers $mobileHeaders
    if ($mobileRecovered.id -ne $case.id -or $mobileRecovered.revision -ne $case.revision) { throw 'QA_MOBILE_SESSION_RECOVERY_FAILED' }
    Add-Check 'mobile-session-and-own-case-recovered-after-repair'
    Add-Check 'installed-engine-recovers-profiles-and-case-after-termination-and-repair'
    $report.status = 'passed'
    $report.installed_file_count = $manifest.installed_files.Count
    $report.manual_gates_pending = @('standard-Windows-user','native-WebView-interface','native-save-cancel-and-Word-opening','supported-Word-document-layout','organization-signing')
} catch {
    $report.status = 'failed'
    $report.failed_stage = $stage
    $report.error_code = 'QA_STEP_FAILED'
} finally {
    try { Stop-Engine } catch {
        $report.status = 'failed'
        $report.failed_stage = 'engine-stop'
        $report.error_code = 'QA_ENGINE_STOP_FAILED'
    }
    $env:CNIE_DESKTOP_TOKEN = $previousDesktopToken
    $report.finished_at = [DateTime]::UtcNow.ToString('o')
    [IO.File]::WriteAllText((Join-Path $resultsDirectory 'result.json'),($report | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
}
if ($report.status -ne 'passed') { Write-Error ("QA failed at stage: {0}. See result.json; do not approve this installer." -f $stage); exit 1 }
Write-Host 'Automated installation checks passed. Manual and production-signing gates remain pending.'
