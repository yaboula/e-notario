param(
    [ValidateSet('Clean','Upgrade')][string]$Scenario = 'Clean',
    [string]$PreviousInstaller
)

$ErrorActionPreference = 'Stop'
$workspaceDirectory = Split-Path -Parent $PSScriptRoot

function Get-NsisInstalledExecutableHash([string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    $sourceMarker = '__TAURI_BUNDLE_TYPE_VAR_UNK'
    $targetMarker = '__TAURI_BUNDLE_TYPE_VAR_NSS'
    $text = [Text.Encoding]::ASCII.GetString($bytes)
    $offset = $text.IndexOf($sourceMarker,[StringComparison]::Ordinal)
    if ($offset -lt 0 -or $text.LastIndexOf($sourceMarker,[StringComparison]::Ordinal) -ne $offset) {
        throw 'QA_TAURI_BUNDLE_MARKER_INVALID'
    }
    $replacement = [Text.Encoding]::ASCII.GetBytes($targetMarker)
    [Array]::Copy($replacement,0,$bytes,$offset,$replacement.Length)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','') }
    finally { $sha.Dispose() }
}

$configuration = Get-Content -LiteralPath (Join-Path $workspaceDirectory 'apps/desktop/src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$version = $configuration.version
if ($version -notmatch '-(alpha|beta|rc)\.') { throw 'This local QA kit is restricted to prerelease builds. Use the signed release procedure for production.' }
$releaseDirectory = Join-Path $workspaceDirectory 'apps/desktop/src-tauri/target/release'
$installer = Join-Path $releaseDirectory ('bundle/nsis/e-notario_{0}_x64-setup.exe' -f $version)
$mainExecutable = Join-Path $releaseDirectory 'e-notario.exe'
$sidecarDirectory = Join-Path $workspaceDirectory 'apps/desktop/src-tauri/binaries/cnie-capture'
foreach ($required in @($installer,$mainExecutable,(Join-Path $sidecarDirectory 'cnie-capture.exe'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw 'Build the current NSIS prerelease and sidecar before preparing QA.' }
}
if ((Get-Item -LiteralPath $mainExecutable).VersionInfo.ProductVersion -ne $version) { throw 'The main executable does not match the configured version.' }
if ((Get-Item -LiteralPath $installer).VersionInfo.ProductVersion -ne $version) { throw 'The installer does not match the configured version.' }
if ($Scenario -eq 'Upgrade') {
    if (-not $PreviousInstaller) { $PreviousInstaller = Join-Path $releaseDirectory 'bundle/nsis/e-notario_0.7.2_x64-setup.exe' }
    if (-not (Test-Path -LiteralPath $PreviousInstaller -PathType Leaf)) { throw 'The 0.7.2 baseline installer is required for upgrade QA.' }
    if ((Get-Item -LiteralPath $PreviousInstaller).VersionInfo.ProductVersion -ne '0.7.2') { throw 'The upgrade baseline must be version 0.7.2.' }
}

$installedFiles = @(@{path='e-notario.exe';sha256=(Get-NsisInstalledExecutableHash $mainExecutable)})
foreach ($file in Get-ChildItem -LiteralPath $sidecarDirectory -Recurse -File) {
    $relative = $file.FullName.Substring($sidecarDirectory.Length).TrimStart([char[]]'\/').Replace('\','/')
    $installedFiles += @{path=('sidecar/' + $relative);sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash}
}
$kitDirectory = Join-Path $workspaceDirectory ('build/windows-qa/{0}-{1}' -f $Scenario.ToLowerInvariant(),[guid]::NewGuid())
$inputDirectory = Join-Path $kitDirectory 'input'
$outputDirectory = Join-Path $kitDirectory 'results'
$null = New-Item -ItemType Directory -Path $inputDirectory,$outputDirectory
Copy-Item -LiteralPath $installer -Destination (Join-Path $inputDirectory 'current-setup.exe')
$runnerPath = Join-Path $inputDirectory 'test-windows-sandbox.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'test-windows-sandbox.ps1') -Destination $runnerPath
$previous = $null
if ($Scenario -eq 'Upgrade') {
    Copy-Item -LiteralPath $PreviousInstaller -Destination (Join-Path $inputDirectory 'previous-setup.exe')
    $previous = @{file='previous-setup.exe';version='0.7.2';sha256=(Get-FileHash -LiteralPath $PreviousInstaller -Algorithm SHA256).Hash}
}
$manifest = @{
    schema='enotario.windows-qa/v1';scenario=$Scenario;version=$version;api_version=2
    current=@{file='current-setup.exe';sha256=(Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash}
    previous=$previous;installed_files=$installedFiles
    build_main_executable_sha256=(Get-FileHash -LiteralPath $mainExecutable -Algorithm SHA256).Hash
    runner_sha256=(Get-FileHash -LiteralPath $runnerPath -Algorithm SHA256).Hash
    authenticode_status=(Get-AuthenticodeSignature -LiteralPath $installer).Status.ToString()
    production_approved=$false
} | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $inputDirectory 'manifest.json'),$manifest,[Text.UTF8Encoding]::new($false))
$escapedInput = [Security.SecurityElement]::Escape($inputDirectory)
$escapedOutput = [Security.SecurityElement]::Escape($outputDirectory)
$sandboxConfiguration = @"
<Configuration>
  <VGpu>Disable</VGpu>
  <Networking>Default</Networking>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <MappedFolders>
    <MappedFolder><HostFolder>$escapedInput</HostFolder><SandboxFolder>C:\e-notario-qa\input</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$escapedOutput</HostFolder><SandboxFolder>C:\e-notario-qa\results</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\e-notario-qa\input\test-windows-sandbox.ps1</Command></LogonCommand>
</Configuration>
"@
$sandboxPath = Join-Path $kitDirectory 'run.wsb'
[IO.File]::WriteAllText($sandboxPath,$sandboxConfiguration,[Text.UTF8Encoding]::new($false))
Write-Host 'Prerelease QA kit prepared. It is not a production distribution.'
Write-Host "Sandbox configuration: $sandboxPath"
Write-Host "Results directory: $outputDirectory"
Write-Host 'Open run.wsb only with Windows Sandbox. Never run the test script on your working PC.'
