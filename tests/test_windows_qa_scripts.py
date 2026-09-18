from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
POWERSHELL = shutil.which("powershell.exe")
pytestmark = pytest.mark.skipif(os.name != "nt" or not POWERSHELL,
                                reason="Windows PowerShell integration checks")


@pytest.mark.parametrize("filename", ["prepare-windows-qa.ps1", "test-windows-sandbox.ps1",
                                      "smoke-packaged-engine.ps1"])
def test_windows_qa_scripts_parse_with_windows_powershell(filename):
    (ROOT / "scripts" / filename).read_text(encoding="ascii")
    path = str(ROOT / "scripts" / filename).replace("'", "''")
    command = (
        "$tokens=$null;$errors=$null;"
        f"$null=[Management.Automation.Language.Parser]::ParseFile('{path}',"
        "[ref]$tokens,[ref]$errors);if($errors.Count){exit 1}"
    )
    completed = subprocess.run([POWERSHELL, "-NoProfile", "-Command", command],
                               capture_output=True, timeout=15)
    assert completed.returncode == 0


def test_installation_runner_refuses_the_working_windows_account():
    if os.environ.get("USERNAME") == "WDAGUtilityAccount":
        pytest.skip("Do not execute the installation runner from unit tests inside Sandbox")
    completed = subprocess.run(
        [POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
         str(ROOT / "scripts" / "test-windows-sandbox.ps1")],
        capture_output=True, timeout=15,
    )
    assert completed.returncode != 0
    assert b"QA_SANDBOX_REQUIRED" in completed.stderr


@pytest.mark.parametrize("function,expression,error", [
    ("Install-Package", "Install-Package @{file='../outside.exe';sha256=('A'*64)}", "QA_MANIFEST_PACKAGE_INVALID"),
    ("Install-Package", "Install-Package @{file='current-setup.exe';sha256='invalid'}", "QA_MANIFEST_PACKAGE_INVALID"),
    ("Assert-InstalledFiles", "Assert-InstalledFiles @{installed_files=@(@{path='../outside.exe';sha256=('A'*64)})}", "QA_MANIFEST_PATH_INVALID"),
])
def test_installation_helpers_reject_unsafe_inputs_before_file_or_process_actions(function, expression, error):
    # Extract definitions only. Never evaluate the runner's top-level installation workflow.
    path = str(ROOT / "scripts" / "test-windows-sandbox.ps1").replace("'", "''")
    command = (
        "$tokens=$null;$errors=$null;"
        f"$ast=[Management.Automation.Language.Parser]::ParseFile('{path}',[ref]$tokens,[ref]$errors);"
        "$definition=$ast.Find({param($node)"
        f"$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq '{function}'"
        "},$true);. ([scriptblock]::Create($definition.Extent.Text));"
        "$installDirectory='C:\\e-notario-qa\\installed';"
        f"try {{{expression}}} catch {{if($_.Exception.Message -eq '{error}'){{exit 0}}else{{exit 2}}}};exit 1"
    )
    completed = subprocess.run([POWERSHELL, "-NoProfile", "-Command", command],
                               capture_output=True, timeout=15)
    assert completed.returncode == 0


@pytest.mark.parametrize("status", [200, 403, 500])
def test_mobile_permission_verifier_accepts_only_a_forbidden_response(status):
    # Definitions only: no installation, application launch or network request.
    path = str(ROOT / "scripts" / "test-windows-sandbox.ps1").replace("'", "''")
    mock = (
        "function Invoke-RestMethod { return @{status='unexpected-success'} };"
        if status == 200 else
        "function Invoke-RestMethod { $permissionFailure=[Exception]::new('synthetic-response');"
        "$permissionFailure | Add-Member -NotePropertyName Response -NotePropertyValue "
        f"([pscustomobject]@{{StatusCode={status}}});throw $permissionFailure }};"
    )
    expected = "exit 1" if status == 403 else "exit 0"
    success = "exit 0" if status == 403 else "exit 1"
    command = (
        "$tokens=$null;$errors=$null;"
        f"$ast=[Management.Automation.Language.Parser]::ParseFile('{path}',[ref]$tokens,[ref]$errors);"
        "$definition=$ast.Find({param($node)"
        "$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-MobileActionForbidden'"
        "},$true);. ([scriptblock]::Create($definition.Extent.Text));"
        f"{mock}"
        "try {Assert-MobileActionForbidden '11111111-2222-4333-8444-555555555555' 'reopen' @{}}"
        f"catch {{if($_.Exception.Message -eq 'QA_MOBILE_PERMISSION_FAILED'){{{expected}}}else{{exit 2}}}};{success}"
    )
    completed = subprocess.run([POWERSHELL, "-NoProfile", "-Command", command],
                               capture_output=True, timeout=15)
    assert completed.returncode == 0


def test_nsis_installed_executable_hash_applies_the_unique_tauri_marker(tmp_path):
    payload = b"prefix__TAURI_BUNDLE_TYPE_VAR_UNKsuffix"
    executable = tmp_path / "synthetic.exe"
    executable.write_bytes(payload)
    expected = __import__("hashlib").sha256(
        payload.replace(b"__TAURI_BUNDLE_TYPE_VAR_UNK", b"__TAURI_BUNDLE_TYPE_VAR_NSS")
    ).hexdigest().upper()
    path = str(ROOT / "scripts" / "prepare-windows-qa.ps1").replace("'", "''")
    executable_path = str(executable).replace("'", "''")
    command = (
        "$tokens=$null;$errors=$null;"
        f"$ast=[Management.Automation.Language.Parser]::ParseFile('{path}',[ref]$tokens,[ref]$errors);"
        "$definition=$ast.Find({param($node)"
        "$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-NsisInstalledExecutableHash'"
        "},$true);. ([scriptblock]::Create($definition.Extent.Text));"
        f"if((Get-NsisInstalledExecutableHash '{executable_path}') -eq '{expected}'){{exit 0}};exit 1"
    )
    completed = subprocess.run([POWERSHELL, "-NoProfile", "-Command", command],
                               capture_output=True, timeout=15)
    assert completed.returncode == 0
