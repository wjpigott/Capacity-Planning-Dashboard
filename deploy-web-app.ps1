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

$scriptVersion = '2026-06-08.1'
Write-Host "Starting clean web app deployment..."
Write-Host "deploy-web-app.ps1 version: $scriptVersion"
Write-Host "Source: $SourcePath"

function Invoke-NativeCommandAllowStderr([scriptblock]$Command) {
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $script:ErrorActionPreference = 'Continue'
        return & $Command
    }
    finally {
        $script:ErrorActionPreference = $previousErrorActionPreference
    }
}

function Test-LatestWebDeploymentSucceeded([string]$ResourceGroup, [string]$AppName) {
    for ($attempt = 1; $attempt -le 6; $attempt++) {
        $latestDeploymentJson = Invoke-NativeCommandAllowStderr {
            az webapp log deployment list --resource-group $ResourceGroup --name $AppName --query '[0]' --output json 2>$null
        }

        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($latestDeploymentJson)) {
            try {
                $latestDeployment = $latestDeploymentJson | ConvertFrom-Json
                if ($latestDeployment.status -eq 4) {
                    Write-Host "Latest Kudu deployment completed successfully: $($latestDeployment.id)"
                    return $true
                }
            }
            catch {
                Write-Warning "Could not parse latest deployment status: $($_.Exception.Message)"
            }
        }

        Start-Sleep -Seconds 10
    }

    return $false
}

if (-not $SkipTests) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "npm was not found on PATH. Install Node.js LTS so npm is available, or rerun deploy-web-app.ps1 with -SkipTests if tests were already run elsewhere."
    }

    $packageJsonPath = Join-Path $SourcePath 'package.json'
    if (-not (Test-Path $packageJsonPath)) {
        throw "package.json not found at $packageJsonPath"
    }

    Write-Host "Running test gate: npm test"
    Push-Location $SourcePath
    try {
        & npm test
        if ($LASTEXITCODE -ne 0) {
            throw "Tests failed; deployment aborted. npm test exited with code $LASTEXITCODE."
        }
        Write-Host "Tests passed"
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
    'server.js',
    'web.config',
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
        Write-Host "Copied directory: $dir (contents: $($(Get-ChildItem $destination -Recurse | Measure-Object).Count) items)"
    } else {
        Write-Warning "Directory not found: $dir"
    }
}

# Verify tools directory
$toolsCheck = Join-Path $stagingPath 'tools\Get-AzVMAvailability\Get-AzVMAvailability.ps1'
if (Test-Path $toolsCheck) {
    Write-Host "Verified: Get-AzVMAvailability.ps1 is in staging"
} else {
    Write-Host "ERROR: Get-AzVMAvailability.ps1 NOT found in staging!"
    Write-Host "  Expected: $toolsCheck"
    Write-Host "  Staging contents:"
    Get-ChildItem $stagingPath -Recurse | Select-Object FullName | Format-Table -Wrap
    throw "Get-AzVMAvailability.ps1 was not found in staging."
}

$paasToolsCheck = Join-Path $stagingPath 'tools\Get-AzPaaSAvailability\Get-AzPaaSAvailability.ps1'
if (Test-Path $paasToolsCheck) {
    Write-Host "Verified: Get-AzPaaSAvailability.ps1 is in staging"
} else {
    throw "Get-AzPaaSAvailability.ps1 was not found in staging. Expected: $paasToolsCheck"
}

$paasDbQuotaWrapperCheck = Join-Path $stagingPath 'tools\Get-PaaSDatabaseQuotaReport.ps1'
if (Test-Path $paasDbQuotaWrapperCheck) {
    Write-Host "Verified: Get-PaaSDatabaseQuotaReport.ps1 is in staging"
} else {
    throw "Get-PaaSDatabaseQuotaReport.ps1 was not found in staging. Expected: $paasDbQuotaWrapperCheck"
}

# Create zip
$zipPath = "$env:TEMP\webpackage-capdash-verified-$(Get-Date -Format 'yyyyMMdd-HHmmss').zip"
Write-Host "Creating zip package: $zipPath"

Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Compress-Archive -Path "$stagingPath\*" -DestinationPath $zipPath -Force

$zipSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host "Package created: $zipSize MB"

# Verify zip contents
Write-Host "Verifying zip contents..."
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$zipEntryNames = @($zip.Entries | ForEach-Object { $_.FullName -replace '\\', '/' })
$zip.Dispose()
$hasTools = $zipEntryNames -contains 'tools/Get-AzVMAvailability/Get-AzVMAvailability.ps1'
$hasPaaSTools = $zipEntryNames -contains 'tools/Get-AzPaaSAvailability/Get-AzPaaSAvailability.ps1'
$hasPaaSDbQuotaWrapper = $zipEntryNames -contains 'tools/Get-PaaSDatabaseQuotaReport.ps1'

if ($hasTools) {
    Write-Host "Zip contains Get-AzVMAvailability.ps1"
} else {
    Write-Host "ERROR: Get-AzVMAvailability.ps1 not found in zip!"
    Write-Host "Tool entries found in zip:"
    $zipEntryNames | Where-Object { $_ -like 'tools/*' } | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" }
    throw "Get-AzVMAvailability.ps1 was not found in the deployment zip."
}

if ($hasPaaSTools) {
    Write-Host "Zip contains Get-AzPaaSAvailability.ps1"
} else {
    Write-Host "ERROR: Get-AzPaaSAvailability.ps1 not found in zip!"
    Write-Host "Tool entries found in zip:"
    $zipEntryNames | Where-Object { $_ -like 'tools/*' } | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" }
    throw "Get-AzPaaSAvailability.ps1 was not found in the deployment zip."
}

if ($hasPaaSDbQuotaWrapper) {
    Write-Host "Zip contains Get-PaaSDatabaseQuotaReport.ps1"
} else {
    Write-Host "ERROR: Get-PaaSDatabaseQuotaReport.ps1 not found in zip!"
    Write-Host "Tool entries found in zip:"
    $zipEntryNames | Where-Object { $_ -like 'tools/*' } | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" }
    throw "Get-PaaSDatabaseQuotaReport.ps1 was not found in the deployment zip."
}

# Deploy
Write-Host "Deploying to Azure App Service..."
Write-Host "Resource Group: $ResourceGroup"
Write-Host "App Name: $AppName"

$deployArgs = @(
    'webapp', 'deploy',
    '--resource-group', $ResourceGroup,
    '--name', $AppName,
    '--src-path', $zipPath,
    '--type', 'zip',
    '--timeout', '300'
)

$deployResult = Invoke-NativeCommandAllowStderr { az @deployArgs 2>&1 }

if ($LASTEXITCODE -eq 0) {
    Write-Host "Deployment command accepted"
    Write-Host "Parsing result..."
    try {
        $json = $deployResult | ConvertFrom-Json
        Write-Host "  Status: $($json.status)"
        Write-Host "  provisioningState: $($json.provisioningState)"
        Write-Host "  Deployment ID: $($json.id)"
        if ($json.provisioningState -eq "Succeeded" -or $json.status -eq 4) {
            Write-Host "Deployment SUCCEEDED"
        } else {
            Write-Host "Check deployment status"
        }
    } catch {
        Write-Host "Deploy output: $deployResult"
    }
} else {
    Write-Host "Deployment failed with exit code $LASTEXITCODE"
    Write-Host "Output: $deployResult"
    if (Test-LatestWebDeploymentSucceeded -ResourceGroup $ResourceGroup -AppName $AppName) {
        Write-Warning "Azure CLI returned a deployment error, but Kudu reports the latest deployment succeeded. Continuing."
        Write-Host ""
        Write-Host "Deployment complete!"
        Write-Host "Test the app at: https://$AppName.azurewebsites.net/"
        return
    }

    throw "Azure App Service zip deployment failed with exit code $LASTEXITCODE."
}

Write-Host ""
Write-Host "Deployment complete!"
Write-Host "Test the app at: https://$AppName.azurewebsites.net/"
