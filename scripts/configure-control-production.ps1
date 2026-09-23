param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-z]{20}$')][string]$ProjectRef,
    [Parameter(Mandatory=$true)][ValidatePattern('^https://[A-Za-z0-9.-]+$')][string]$PortalUrl,
    [string]$KeyId = 'valiris-lease-2026-09-a'
)

$ErrorActionPreference = 'Stop'
$workspaceDirectory = Split-Path -Parent $PSScriptRoot
$python = Join-Path $workspaceDirectory '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw 'Python environment not found.' }

$keyDirectory = Join-Path $env:LOCALAPPDATA 'Valiris\deployment'
$backupPath = Join-Path $keyDirectory "$KeyId.dpapi"
$metadataPath = Join-Path $keyDirectory "$KeyId.json"
$tempMaterial = Join-Path ([IO.Path]::GetTempPath()) ("valiris-key-{0}.json" -f [guid]::NewGuid())
$tempSecrets = Join-Path ([IO.Path]::GetTempPath()) ("valiris-secrets-{0}.env" -f [guid]::NewGuid())
$privateDer = $null

New-Item -ItemType Directory -Path $keyDirectory -Force | Out-Null
Add-Type -AssemblyName System.Security
$entropy = [Text.Encoding]::UTF8.GetBytes('Valiris Desk/lease-signing/v1')

try {
    if ((Test-Path -LiteralPath $backupPath) -or (Test-Path -LiteralPath $metadataPath)) {
        if (-not ((Test-Path -LiteralPath $backupPath) -and (Test-Path -LiteralPath $metadataPath))) {
            throw 'Lease key backup is incomplete; stop and recover it before deployment.'
        }
        $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
        if ($metadata.kid -ne $KeyId -or $metadata.project_ref -ne $ProjectRef) {
            throw 'Existing lease key metadata does not match this deployment.'
        }
        $protected = [IO.File]::ReadAllBytes($backupPath)
        $privateDer = [Security.Cryptography.ProtectedData]::Unprotect(
            $protected,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
        $privateBase64 = [Convert]::ToBase64String($privateDer)
        $publicBase64url = $metadata.public_key_base64url
    } else {
        @'
import base64, json, sys
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, PublicFormat, NoEncryption

key = Ed25519PrivateKey.generate()
private_der = key.private_bytes(Encoding.DER, PrivateFormat.PKCS8, NoEncryption())
public_raw = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
with open(sys.argv[1], 'w', encoding='utf-8') as output:
    json.dump({
        'private_pkcs8_b64': base64.b64encode(private_der).decode('ascii'),
        'public_b64url': base64.urlsafe_b64encode(public_raw).decode('ascii').rstrip('='),
    }, output, separators=(',', ':'))
'@ | & $python - $tempMaterial
        if ($LASTEXITCODE -ne 0) { throw 'Lease key generation failed.' }
        $material = Get-Content -LiteralPath $tempMaterial -Raw | ConvertFrom-Json
        $privateBase64 = $material.private_pkcs8_b64
        $publicBase64url = $material.public_b64url
        $privateDer = [Convert]::FromBase64String($privateBase64)
        $protected = [Security.Cryptography.ProtectedData]::Protect(
            $privateDer,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
        [IO.File]::WriteAllBytes($backupPath,$protected)
        $metadata = [ordered]@{
            schema = 'valiris.lease-key-backup/v1'
            kid = $KeyId
            public_key_base64url = $publicBase64url
            project_ref = $ProjectRef
            created_at_utc = [DateTimeOffset]::UtcNow.ToString('o')
            private_key_backup = [IO.Path]::GetFileName($backupPath)
            protection = 'Windows DPAPI CurrentUser'
        } | ConvertTo-Json
        [IO.File]::WriteAllText($metadataPath,$metadata,[Text.UTF8Encoding]::new($false))
    }

    $secretLines = @(
        "CONTROL_PORTAL_URL=$PortalUrl",
        "CONTROL_LEASE_PRIVATE_KEY_PKCS8_B64=$privateBase64",
        "CONTROL_LEASE_KEY_ID=$KeyId"
    )
    [IO.File]::WriteAllLines($tempSecrets,$secretLines,[Text.UTF8Encoding]::new($false))
    npx --yes supabase@latest secrets set --project-ref $ProjectRef --env-file $tempSecrets --output pretty
    if ($LASTEXITCODE -ne 0) { throw 'Supabase secret upload failed.' }

    [pscustomobject]@{
        key_id = $KeyId
        public_key_base64url = $publicBase64url
        backup = $backupPath
        project_ref = $ProjectRef
    } | ConvertTo-Json
} finally {
    if (Test-Path -LiteralPath $tempSecrets) { Remove-Item -LiteralPath $tempSecrets -Force }
    if (Test-Path -LiteralPath $tempMaterial) { Remove-Item -LiteralPath $tempMaterial -Force }
    if ($privateDer) { [Array]::Clear($privateDer,0,$privateDer.Length) }
}
