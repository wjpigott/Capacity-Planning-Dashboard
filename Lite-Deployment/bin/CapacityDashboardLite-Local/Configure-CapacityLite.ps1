[CmdletBinding()]
param(
    [string]$AppPath = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'

function Read-RequiredValue {
    param(
        [Parameter(Mandatory)][string]$Prompt,
        [string]$DefaultValue = ''
    )

    do {
        $displayPrompt = if ($DefaultValue) { "$Prompt [$DefaultValue]" } else { $Prompt }
        $value = Read-Host $displayPrompt
        if ([string]::IsNullOrWhiteSpace($value)) {
            $value = $DefaultValue
        }
    } while ([string]::IsNullOrWhiteSpace($value))

    return $value.Trim()
}

function Read-OptionalValue {
    param(
        [Parameter(Mandatory)][string]$Prompt,
        [string]$DefaultValue = ''
    )

    $displayPrompt = if ($DefaultValue) { "$Prompt [$DefaultValue]" } else { $Prompt }
    $value = Read-Host $displayPrompt
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $DefaultValue
    }

    return $value.Trim()
}

function Read-ChoiceValue {
    param(
        [Parameter(Mandatory)][string]$Prompt,
        [Parameter(Mandatory)][string[]]$Choices,
        [Parameter(Mandatory)][string]$DefaultValue
    )

    do {
        $value = Read-OptionalValue -Prompt "$Prompt ($($Choices -join '/'))" -DefaultValue $DefaultValue
    } while ($Choices -notcontains $value.ToLowerInvariant())

    return $value.ToLowerInvariant()
}

$resolvedAppPath = (Resolve-Path -LiteralPath $AppPath).Path
$samplePath = Join-Path $resolvedAppPath 'functions\CapacityWorker\local.settings.sample.json'
$settingsPath = Join-Path $resolvedAppPath 'functions\CapacityWorker\local.settings.json'

if (-not (Test-Path -LiteralPath $samplePath -PathType Leaf)) {
    throw "The Lite worker settings sample was not found: $samplePath"
}

Write-Host ''
Write-Host 'Capacity Dashboard Lite setup' -ForegroundColor Cyan
Write-Host 'This wizard creates the local worker settings file. It does not create an Azure identity or grant Azure permissions.' -ForegroundColor DarkGray
Write-Host ''

$defaultDataPath = Join-Path $env:LOCALAPPDATA 'CapacityDashboard\data'
$dataPath = Read-RequiredValue -Prompt 'Local folder for report data' -DefaultValue $defaultDataPath
$scopeType = Read-ChoiceValue -Prompt 'Azure scope type' -Choices @('subscription', 'management-group') -DefaultValue 'subscription'

$subscriptionId = ''
$managementGroupNames = ''
if ($scopeType -eq 'subscription') {
    $subscriptionId = Read-RequiredValue -Prompt 'Azure subscription ID'
}
else {
    $managementGroupNames = Read-RequiredValue -Prompt 'Management group name(s), comma-separated'
}

$reportRegions = Read-OptionalValue -Prompt 'Capture regions, comma-separated' -DefaultValue 'eastus,eastus2,centralus,westus,westus2,westus3'
$authMode = Read-ChoiceValue -Prompt 'Azure sign-in mode' -Choices @('interactive', 'secret', 'certificate') -DefaultValue 'interactive'

$tenantId = ''
$clientId = ''
$clientSecret = ''
$certificatePath = ''
$certificatePassword = ''
$configuredAuthMode = ''

switch ($authMode) {
    'secret' {
        $configuredAuthMode = 'service-principal-secret'
        $tenantId = Read-RequiredValue -Prompt 'Entra tenant ID'
        $clientId = Read-RequiredValue -Prompt 'Service principal application (client) ID'
        $clientSecret = Read-Host 'Service principal client secret' -AsSecureString
        $clientSecret = [System.Net.NetworkCredential]::new('', $clientSecret).Password
        if ([string]::IsNullOrWhiteSpace($clientSecret)) {
            throw 'A service principal client secret is required.'
        }
    }
    'certificate' {
        $configuredAuthMode = 'service-principal-certificate'
        $tenantId = Read-RequiredValue -Prompt 'Entra tenant ID'
        $clientId = Read-RequiredValue -Prompt 'Service principal application (client) ID'
        $certificatePath = Read-RequiredValue -Prompt 'Full path to the existing service principal certificate (.pfx)'
        if (-not (Test-Path -LiteralPath $certificatePath -PathType Leaf)) {
            throw "The certificate file was not found: $certificatePath"
        }
        $certificatePassword = Read-Host 'Certificate password (press Enter if none)' -AsSecureString
        $certificatePassword = [System.Net.NetworkCredential]::new('', $certificatePassword).Password
    }
    'interactive' {
        Write-Host ''
        Write-Host 'Interactive sign-in selected. Before starting the worker, run Connect-AzAccount in the worker PowerShell session.' -ForegroundColor Yellow
    }
}

$settings = Get-Content -LiteralPath $samplePath -Raw | ConvertFrom-Json
$settings.Values.WORKER_SHARED_SECRET = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$settings.Values.CAPACITY_SNAPSHOT_LOCAL_PATH = $dataPath
$settings.Values.CAPACITY_SUBSCRIPTION_ID = $subscriptionId
$settings.Values.CAPACITY_MANAGEMENT_GROUP_NAMES = $managementGroupNames
$settings.Values.CAPACITY_REPORT_REGIONS = $reportRegions
$settings.Values.CAPACITY_AZURE_AUTH_MODE = $configuredAuthMode
$settings.Values.CAPACITY_AZURE_TENANT_ID = $tenantId
$settings.Values.CAPACITY_AZURE_CLIENT_ID = $clientId
$settings.Values.CAPACITY_AZURE_CLIENT_SECRET = $clientSecret
$settings.Values.CAPACITY_AZURE_CLIENT_CERTIFICATE_PATH = $certificatePath
$settings.Values.CAPACITY_AZURE_CLIENT_CERTIFICATE_PASSWORD = $certificatePassword

$dataDirectory = [Environment]::ExpandEnvironmentVariables($dataPath)
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
$settings | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $settingsPath -Encoding UTF8

Write-Host ''
Write-Host "Setup complete. Settings were saved to: $settingsPath" -ForegroundColor Green
Write-Host "Report data will be stored in: $dataDirectory" -ForegroundColor Green
Write-Host 'Next, run .\Start-CapacityLite.ps1 to start the local services.' -ForegroundColor Cyan