# Clean web app deployment script
param(
    [string]$ResourceGroup = $env:AZURE_RESOURCE_GROUP,
    [string]$AppName = $env:AZURE_WEBAPP_NAME,
    [string]$SourcePath = (Resolve-Path "$PSScriptRoot"),
    [switch]$SkipTests
)

if ([string]::IsNullOrWhiteSpace($ResourceGroup) -or [string]::IsNullOrWhiteSpace($AppName)) {
    throw "Provide -ResourceGroup and -AppName, or set AZURE_RESOURCE_GROUP and AZURE_WEBAPP_NAME."
}

Write-Host "Starting clean web app deployment..."
Write-Host "Source: $SourcePath"

if (-not $SkipTests) {
    $packageJsonPath = Join-Path $SourcePath 'package.json'
    if (-not (Test-Path $packageJsonPath)) {
        Write-Host "✗ ERROR: package.json not found at $packageJsonPath"
        exit 1
    }

    Write-Host "Running test gate: npm test"
    Push-Location $SourcePath
    try {
        & npm test
        if ($LASTEXITCODE -ne 0) {
            Write-Host "✗ Tests failed; deployment aborted"
            exit $LASTEXITCODE
        }
        Write-Host "✓ Tests passed"
    } finally {
        Pop-Location
    }
} else {
    Write-Warning "Skipping npm test before deployment because -SkipTests was provided."
}

# Create clean staging directory
$stagingPath = "$env:TEMP\capdash-clean-deploy-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Write-Host "Staging: $stagingPath"

New-Item -Path $stagingPath -ItemType Directory -Force | Out-Null

# Copy files - be explicit about what to include
$filesToCopy = @(
    'app.js',
    'index.html',
    'server.js',
    'web.config',
    'styles.css',
    'sku-catalog.js',
    'package.json',
    'package-lock.json'
)

foreach ($file in $filesToCopy) {
    $source = Join-Path $SourcePath $file
    if (Test-Path $source) {
        Copy-Item $source -Destination $stagingPath -Verbose
    } else {
        Write-Warning "File not found: $file"
    }
}

# Copy directories recursively
$dirsToCopy = @('src', 'sql', 'scripts', 'tools', 'react')

foreach ($dir in $dirsToCopy) {
    $source = Join-Path $SourcePath $dir
    if (Test-Path $source) {
        $destination = Join-Path $stagingPath $dir
        Copy-Item -Path $source -Destination $destination -Recurse -Force -Verbose
        Write-Host "✓ Copied directory: $dir (contents: $($(Get-ChildItem $destination -Recurse | Measure-Object).Count) items)"
    } else {
        Write-Warning "Directory not found: $dir"
    }
}

# Verify tools directory
$toolsCheck = Join-Path $stagingPath 'tools\Get-AzVMAvailability\Get-AzVMAvailability.ps1'
if (Test-Path $toolsCheck) {
    Write-Host "✓ Verified: Get-AzVMAvailability.ps1 is in staging"
} else {
    Write-Host "✗ ERROR: Get-AzVMAvailability.ps1 NOT found in staging!"
    Write-Host "  Expected: $toolsCheck"
    Write-Host "  Staging contents:"
    Get-ChildItem $stagingPath -Recurse | Select-Object FullName | Format-Table -Wrap
    exit 1
}

$paasToolsCheck = Join-Path $stagingPath 'tools\Get-AzPaaSAvailability\Get-AzPaaSAvailability.ps1'
if (Test-Path $paasToolsCheck) {
    Write-Host "✓ Verified: Get-AzPaaSAvailability.ps1 is in staging"
} else {
    Write-Host "✗ ERROR: Get-AzPaaSAvailability.ps1 NOT found in staging!"
    Write-Host "  Expected: $paasToolsCheck"
    exit 1
}

# Create zip
$zipPath = "$env:TEMP\webpackage-capdash-verified-$(Get-Date -Format 'yyyyMMdd-HHmmss').zip"
Write-Host "Creating zip package: $zipPath"

Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Compress-Archive -Path "$stagingPath\*" -DestinationPath $zipPath -Force

$zipSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host "✓ Package created: $zipSize MB"

# Verify zip contents
Write-Host "Verifying zip contents..."
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$hasTools = $zip.Entries | Where-Object { $_.FullName -match 'tools/Get-AzVMAvailability/Get-AzVMAvailability.ps1' }
$hasPaaSTools = $zip.Entries | Where-Object { $_.FullName -match 'tools/Get-AzPaaSAvailability/Get-AzPaaSAvailability.ps1' }
$zip.Dispose()

if ($hasTools) {
    Write-Host "✓ Zip contains Get-AzVMAvailability.ps1"
} else {
    Write-Host "✗ ERROR: Get-AzVMAvailability.ps1 not found in zip!"
    exit 1
}

if ($hasPaaSTools) {
    Write-Host "✓ Zip contains Get-AzPaaSAvailability.ps1"
} else {
    Write-Host "✗ ERROR: Get-AzPaaSAvailability.ps1 not found in zip!"
    exit 1
}

# Deploy
Write-Host "Deploying to Azure App Service..."
Write-Host "Resource Group: $ResourceGroup"
Write-Host "App Name: $AppName"

$deployResult = az webapp deploy `
    --resource-group $ResourceGroup `
    --name $AppName `
    --src-path $zipPath `
    --type zip `
    --timeout 300 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Deployment command accepted (status 202)"
    Write-Host "Parsing result..."
    try {
        $json = $deployResult | ConvertFrom-Json
        Write-Host "  Status: $($json.status)"
        Write-Host "  provisioningState: $($json.provisioningState)"
        Write-Host "  Deployment ID: $($json.id)"
        if ($json.provisioningState -eq "Succeeded" -or $json.status -eq 4) {
            Write-Host "✓ Deployment SUCCEEDED"
        } else {
            Write-Host "⚠ Check deployment status"
        }
    } catch {
        Write-Host "Deploy output: $deployResult"
    }
} else {
    Write-Host "✗ Deployment failed with exit code $LASTEXITCODE"
    Write-Host "Output: $deployResult"
    exit 1
}

Write-Host ""
Write-Host "Deployment complete!"
Write-Host "Test the app at: https://$AppName.azurewebsites.net/"
