<#
.SYNOPSIS
    Pre-commit validation script for Get-AzPaaSAvailability.
.DESCRIPTION
    Runs syntax validation, PSScriptAnalyzer linting, and Pester tests
    against the module and wrapper script.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$failed = 0
$passed = 0
$skipped = 0

Write-Host "`n=== Get-AzPaaSAvailability Validation ===" -ForegroundColor Cyan
Write-Host ""

#region Check 1: Syntax Validation
Write-Host "[1/4] Syntax Validation..." -ForegroundColor Yellow

$scripts = @(
    (Join-Path $PSScriptRoot '..' 'Get-AzPaaSAvailability.ps1'),
    (Join-Path $PSScriptRoot '..' 'AzPaaSAvailability' 'AzPaaSAvailability.psm1'),
    (Get-ChildItem (Join-Path $PSScriptRoot '..' 'AzPaaSAvailability' '*.ps1') -Recurse).FullName
) | Where-Object { $_ }

# Validate .psd1 manifest separately
$manifestCheckPath = Join-Path $PSScriptRoot '..' 'AzPaaSAvailability' 'AzPaaSAvailability.psd1'
if (Test-Path $manifestCheckPath) {
    try {
        $null = Import-PowerShellDataFile $manifestCheckPath -ErrorAction Stop
    }
    catch {
        Write-Host "  SYNTAX ERROR: $manifestCheckPath" -ForegroundColor Red
        Write-Host "    $($_.Exception.Message)" -ForegroundColor Red
        $syntaxErrors++
    }
}

$syntaxErrors = 0
foreach ($script in $scripts) {
    if (-not (Test-Path $script)) { continue }
    try {
        $null = [scriptblock]::Create((Get-Content $script -Raw))
    }
    catch {
        Write-Host "  SYNTAX ERROR: $script" -ForegroundColor Red
        Write-Host "    $($_.Exception.Message)" -ForegroundColor Red
        $syntaxErrors++
    }
}

if ($syntaxErrors -eq 0) {
    Write-Host "  PASS: All scripts have valid syntax" -ForegroundColor Green
    $passed++
}
else {
    Write-Host "  FAIL: $syntaxErrors syntax error(s)" -ForegroundColor Red
    $failed++
}
#endregion

#region Check 2: PSScriptAnalyzer
Write-Host "[2/4] PSScriptAnalyzer Linting..." -ForegroundColor Yellow

$settingsPath = Join-Path $PSScriptRoot '..' 'PSScriptAnalyzerSettings.psd1'
if (-not (Get-Module PSScriptAnalyzer -ListAvailable)) {
    Write-Host "  SKIP: PSScriptAnalyzer not installed" -ForegroundColor DarkGray
    $skipped++
}
elseif (-not (Test-Path -LiteralPath $settingsPath)) {
    Write-Host "  FAIL: Settings file not found at '$settingsPath'" -ForegroundColor Red
    $failed++
}
else {
    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
    try {
        $results = Invoke-ScriptAnalyzer -Path $repoRoot -Recurse -Settings $settingsPath -ErrorAction Stop
        $warnings = @($results | Where-Object Severity -in 'Warning', 'Error')

        if ($warnings.Count -eq 0) {
            Write-Host "  PASS: No warnings or errors" -ForegroundColor Green
            $passed++
        }
        else {
            Write-Host "  FAIL: $($warnings.Count) issue(s):" -ForegroundColor Red
            foreach ($w in $warnings) {
                Write-Host "    $($w.ScriptName):$($w.Line) [$($w.RuleName)] $($w.Message)" -ForegroundColor Red
            }
            $failed++
        }
    }
    catch {
        Write-Host "  FAIL: Invoke-ScriptAnalyzer failed: $($_.Exception.Message)" -ForegroundColor Red
        $failed++
    }
}
#endregion

#region Check 3: Pester Tests
Write-Host "[3/4] Pester Tests..." -ForegroundColor Yellow

$testsPath = Join-Path $PSScriptRoot '..' 'tests'
if (-not (Test-Path $testsPath)) {
    Write-Host "  SKIP: No tests directory found" -ForegroundColor DarkGray
    $skipped++
}
elseif (-not (Get-Module Pester -ListAvailable)) {
    Write-Host "  SKIP: Pester not installed" -ForegroundColor DarkGray
    $skipped++
}
else {
    try {
        $pesterResults = Invoke-Pester -Path $testsPath -Output Minimal -PassThru -ErrorAction Stop
        if ($pesterResults.FailedCount -eq 0) {
            Write-Host "  PASS: $($pesterResults.PassedCount) tests passed" -ForegroundColor Green
            $passed++
        }
        else {
            Write-Host "  FAIL: $($pesterResults.FailedCount) test(s) failed" -ForegroundColor Red
            $failed++
        }
    }
    catch {
        Write-Host "  FAIL: Pester execution failed: $($_.Exception.Message)" -ForegroundColor Red
        $failed++
    }
}
#endregion

#region Check 4: Version Consistency
Write-Host "[4/4] Version Consistency..." -ForegroundColor Yellow

$manifestPath = Join-Path $PSScriptRoot '..' 'AzPaaSAvailability' 'AzPaaSAvailability.psd1'
if (Test-Path $manifestPath) {
    $manifest = Import-PowerShellDataFile $manifestPath
    $manifestVersion = $manifest.ModuleVersion

    # Check if orchestrator has matching version
    $orchestratorPath = Join-Path $PSScriptRoot '..' 'AzPaaSAvailability' 'Public' 'Get-AzPaaSAvailability.ps1'
    if (Test-Path $orchestratorPath) {
        $content = Get-Content $orchestratorPath -Raw
        if ($content -match "\`\$version\s*=\s*'([^']+)'") {
            $scriptVersion = $Matches[1]
            if ($scriptVersion -eq $manifestVersion) {
                Write-Host "  PASS: Manifest ($manifestVersion) matches orchestrator ($scriptVersion)" -ForegroundColor Green
                $passed++
            }
            else {
                Write-Host "  FAIL: Manifest ($manifestVersion) != orchestrator ($scriptVersion)" -ForegroundColor Red
                $failed++
            }
        }
        else {
            Write-Host "  SKIP: No version variable found in orchestrator" -ForegroundColor DarkGray
        }
    }
}
else {
    Write-Host "  SKIP: Module manifest not found" -ForegroundColor DarkGray
}
#endregion

#region Summary
Write-Host "`n=== Results ===" -ForegroundColor Cyan
Write-Host "  Passed: $passed" -ForegroundColor Green
Write-Host "  Failed: $failed" -ForegroundColor $(if ($failed -gt 0) { 'Red' } else { 'Green' })
if ($skipped -gt 0) {
    Write-Host "  Skipped: $skipped" -ForegroundColor DarkGray
}
Write-Host ""

if ($failed -gt 0) {
    Write-Host "VALIDATION FAILED" -ForegroundColor Red
    exit 1
}
elseif ($skipped -gt 0) {
    Write-Host "ALL CHECKS PASSED ($skipped skipped — install missing tools for full coverage)" -ForegroundColor Yellow
}
else {
    Write-Host "ALL CHECKS PASSED" -ForegroundColor Green
}
#endregion
