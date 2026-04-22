<#
.SYNOPSIS
    Backward-compatible wrapper for Get-AzPaaSAvailability module.
.DESCRIPTION
    Imports the AzPaaSAvailability module and calls Get-AzPaaSAvailability
    with the same parameters as the original monolith script.
    Use this for quick runs without explicit Import-Module.
.EXAMPLE
    .\Get-AzPaaSAvailability.ps1 -Region eastus,westus2
.EXAMPLE
    .\Get-AzPaaSAvailability.ps1 -Service SqlDatabase -Edition Hyperscale -RegionPreset USMajor
#>
[CmdletBinding()]
param(
    [string[]]$Region,
    [ValidateSet('USEastWest', 'USCentral', 'USMajor', 'Europe', 'AsiaPacific', 'Global', 'USGov', 'China', 'ASR-EastWest', 'ASR-CentralUS')]
    [string]$RegionPreset,
    [ValidateSet('SqlDatabase', 'CosmosDB', 'All')]
    [string]$Service = 'All',
    [ValidateSet('GeneralPurpose', 'BusinessCritical', 'Hyperscale')]
    [string[]]$Edition,
    [ValidateSet('Provisioned', 'Serverless')]
    [string]$ComputeModel,
    [ValidateSet('SqlDatabase', 'ManagedInstance')]
    [string]$SqlResourceType = 'SqlDatabase',
    [switch]$IncludeDisabled,
    [switch]$FetchPricing,
    [string]$ExportPath,
    [switch]$AutoExport,
    [switch]$NoPrompt,
    [ValidateSet('Auto', 'CSV', 'XLSX')]
    [string]$OutputFormat = 'Auto',
    [ValidateSet('AzureCloud', 'AzureUSGovernment', 'AzureChinaCloud', 'AzureGermanCloud')]
    [string]$Environment,
    [int]$MaxRetries = 3,
    [switch]$JsonOutput
)

# Import the module from the same directory
$modulePath = Join-Path $PSScriptRoot 'AzPaaSAvailability'
Import-Module $modulePath -Force -ErrorAction Stop

# Resolve regions if not provided
if (-not $Region -and -not $RegionPreset) {
    if ($NoPrompt) {
        $Region = @('eastus', 'eastus2', 'westus2')
        Write-Host "Using default regions: $($Region -join ', ')" -ForegroundColor DarkGray
    }
    else {
        $presets = @{
            'USEastWest'  = @('eastus', 'eastus2', 'westus', 'westus2')
            'USMajor'     = @('eastus', 'eastus2', 'centralus', 'westus', 'westus2')
            'Europe'      = @('westeurope', 'northeurope', 'uksouth', 'francecentral', 'germanywestcentral')
            'AsiaPacific' = @('eastasia', 'southeastasia', 'japaneast', 'australiaeast', 'koreacentral')
            'Global'      = @('eastus', 'westeurope', 'southeastasia', 'australiaeast', 'brazilsouth')
        }
        Write-Host "`nAvailable region presets:" -ForegroundColor Yellow
        $names = @($presets.Keys | Sort-Object)
        for ($i = 0; $i -lt $names.Count; $i++) {
            Write-Host "  $($i+1). $($names[$i]) ($($presets[$names[$i]] -join ', '))" -ForegroundColor White
        }
        Write-Host "`nSelect preset (1-$($names.Count)), or type region codes: " -ForegroundColor Yellow -NoNewline
        $selection = Read-Host
        if ($selection -match '^\d+$' -and [int]$selection -ge 1 -and [int]$selection -le $names.Count) {
            $RegionPreset = $names[[int]$selection - 1]
        }
        elseif ($selection) {
            $Region = @($selection -split ',' | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })
        }
        else {
            $Region = @('eastus', 'eastus2', 'westus2')
        }
    }
}

# Build splat
$params = @{}
if ($Region) { $params.Region = $Region }
if ($RegionPreset) { $params.RegionPreset = $RegionPreset }
if ($Service -ne 'All') { $params.Service = $Service }
if ($Edition) { $params.Edition = $Edition }
if ($ComputeModel) { $params.ComputeModel = $ComputeModel }
if ($SqlResourceType -ne 'SqlDatabase') { $params.SqlResourceType = $SqlResourceType }
if ($IncludeDisabled) { $params.IncludeDisabled = $true }
if ($FetchPricing) { $params.FetchPricing = $true }
if ($Environment) { $params.Environment = $Environment }
if ($MaxRetries -ne 3) { $params.MaxRetries = $MaxRetries }

$result = Get-AzPaaSAvailability @params

if ($JsonOutput) {
    $result | ConvertTo-Json -Depth 10
}

if ($ExportPath -or $AutoExport) {
    $exportDir = $ExportPath
    if (-not $exportDir) {
        $isCS = $env:CLOUD_SHELL -eq 'true' -or (Test-Path '/home/system' -ErrorAction SilentlyContinue)
        $exportDir = if ($isCS) { '/home/system' } else { 'C:\Temp\AzPaaSAvailability' }
    }
    Export-AzPaaSAvailabilityReport -ScanResult $result -Path $exportDir -Format $OutputFormat
}
