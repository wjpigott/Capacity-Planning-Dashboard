param(
    [Parameter(Mandatory = $false)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $false)]
    [string]$RegionsJson,

    [Parameter(Mandatory = $false)]
    [ValidateSet('USEastWest', 'USCentral', 'USMajor', 'Europe', 'AsiaPacific', 'Global', 'USGov', 'China', 'ASR-EastWest', 'ASR-CentralUS')]
    [string]$RegionPreset,

    [Parameter(Mandatory = $false)]
    [ValidateSet('All', 'SqlDatabase', 'CosmosDB', 'PostgreSQL', 'MySQL', 'AppService', 'ContainerApps', 'AKS', 'Functions', 'Storage')]
    [string]$Service = 'All',

    [Parameter(Mandatory = $false)]
    [ValidateSet('GeneralPurpose', 'BusinessCritical', 'Hyperscale')]
    [string[]]$Edition,

    [Parameter(Mandatory = $false)]
    [ValidateSet('Provisioned', 'Serverless')]
    [string]$ComputeModel,

    [Parameter(Mandatory = $false)]
    [ValidateSet('SqlDatabase', 'ManagedInstance')]
    [string]$SqlResourceType = 'SqlDatabase',

    [Parameter(Mandatory = $false)]
    [switch]$IncludeDisabled,

    [Parameter(Mandatory = $false)]
    [switch]$FetchPricing,

    [Parameter(Mandatory = $false)]
    [ValidateSet('AzureCloud', 'AzureUSGovernment', 'AzureChinaCloud', 'AzureGermanCloud')]
    [string]$Environment,

    [Parameter(Mandatory = $false)]
    [int]$MaxRetries = 3
)

function Ensure-AzureContext {
    $result = [pscustomobject]@{
        hasContext = $false
        loginAttempted = $false
        message = ''
    }

    function Resolve-AccessibleSubscriptionContext {
        $preferredSubscriptionId = @(
            $env:AZURE_SUBSCRIPTION_ID,
            $env:SUBSCRIPTION_ID,
            $env:ARM_SUBSCRIPTION_ID
        ) | Where-Object { $_ } | Select-Object -First 1

        if (-not (Get-Command -Name 'Get-AzSubscription' -ErrorAction SilentlyContinue)) {
            return $null
        }

        try {
            $subscriptions = @(Get-AzSubscription -ErrorAction Stop)
        }
        catch {
            return $null
        }

        if ($subscriptions.Count -eq 0) {
            return $null
        }

        $selectedSubscription = $null
        if ($preferredSubscriptionId) {
            $selectedSubscription = $subscriptions | Where-Object { $_.Id -eq $preferredSubscriptionId } | Select-Object -First 1
        }

        if (-not $selectedSubscription -and $subscriptions.Count -eq 1) {
            $selectedSubscription = $subscriptions[0]
        }

        if (-not $selectedSubscription) {
            return $null
        }

        if (-not (Get-Command -Name 'Set-AzContext' -ErrorAction SilentlyContinue)) {
            return $null
        }

        try {
            $null = Set-AzContext -SubscriptionId $selectedSubscription.Id -ErrorAction Stop
            return $selectedSubscription
        }
        catch {
            return $null
        }
    }

    if (-not (Get-Command -Name 'Get-AzContext' -ErrorAction SilentlyContinue)) {
        $result.message = 'Get-AzContext cmdlet is not available in this PowerShell host.'
        return $result
    }

    try {
        $ctx = Get-AzContext -ErrorAction SilentlyContinue
        if ($ctx -and $ctx.Subscription) {
            $result.hasContext = $true
            $result.message = "Using existing Azure context for subscription '$($ctx.Subscription.Id)'."
            return $result
        }
    }
    catch {
    }

    if (-not (Get-Command -Name 'Connect-AzAccount' -ErrorAction SilentlyContinue)) {
        $result.message = 'Connect-AzAccount cmdlet is not available in this PowerShell host.'
        return $result
    }

    try {
        $result.loginAttempted = $true
        $null = Connect-AzAccount -Identity -ErrorAction Stop
        $ctx = Get-AzContext -ErrorAction SilentlyContinue
        if ($ctx -and $ctx.Subscription) {
            $result.hasContext = $true
            $result.message = "Managed identity sign-in succeeded for subscription '$($ctx.Subscription.Id)'."
            return $result
        }

        $selectedSubscription = Resolve-AccessibleSubscriptionContext
        if ($selectedSubscription) {
            $result.hasContext = $true
            $result.message = "Managed identity sign-in succeeded and selected subscription '$($selectedSubscription.Id)'."
            return $result
        }

        $result.message = 'Managed identity sign-in completed, but no Azure subscription context is available.'
        return $result
    }
    catch {
        $result.message = "Managed identity sign-in failed: $($_.Exception.Message)"
        return $result
    }
}

function ConvertFrom-JsonArray {
    param([string]$JsonValue)

    if (-not $JsonValue) {
        return @()
    }

    try {
        $parsed = ConvertFrom-Json -InputObject $JsonValue
        if ($parsed -is [string]) {
            $value = $parsed.Trim().ToLower()
            if ($value) {
                return @($value)
            }
            return @()
        }

        if ($parsed -is [System.Collections.IEnumerable]) {
            return @($parsed | ForEach-Object { $_.ToString().Trim().ToLower() } | Where-Object { $_ })
        }
    }
    catch {
        $fallback = @($JsonValue -split ',') | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ }
        if ($fallback.Count -gt 0) {
            return @($fallback)
        }
    }

    return @()
}

function Normalize-Boolean {
    param($Value)

    if ($null -eq $Value) {
        return $null
    }

    try {
        return [bool]$Value
    }
    catch {
        return $null
    }
}

function Get-ScanRows {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$ScanResult,

        [Parameter(Mandatory = $true)]
        [datetime]$CapturedAtUtc
    )

    $rows = [System.Collections.Generic.List[object]]::new()

    foreach ($item in @($ScanResult.SqlSkus)) {
        $rows.Add([pscustomobject]@{
            capturedAtUtc = $CapturedAtUtc.ToString('o')
            category = 'sql-sku'
            service = 'SqlDatabase'
            region = $item.Region
            resourceType = $item.ResourceType
            name = $item.SKU
            displayName = $item.SKU
            edition = $item.Edition
            tier = $item.Tier
            family = $item.Family
            status = $item.Status
            available = @('Available', 'Default') -contains [string]$item.Status
            zoneRedundant = Normalize-Boolean $item.ZoneRedundant
            quotaCurrent = $item.VCoreQuotaUsed
            quotaLimit = $item.VCoreQuotaLimit
            metricPrimary = $item.vCores
            metricSecondary = $item.ComputeModel
            details = [pscustomobject]@{
                vCores = $item.vCores
                computeModel = $item.ComputeModel
                ahubSupported = Normalize-Boolean $item.AHUBSupported
                storageRedundancy = $item.StorageRedundancy
                serverQuotaUsed = $item.ServerQuotaUsed
                serverQuotaLimit = $item.ServerQuotaLimit
                vCoreQuotaUsed = $item.VCoreQuotaUsed
                vCoreQuotaLimit = $item.VCoreQuotaLimit
            }
        })
    }

    foreach ($item in @($ScanResult.CosmosDbLocations)) {
        $rows.Add([pscustomobject]@{
            capturedAtUtc = $CapturedAtUtc.ToString('o')
            category = 'cosmos-region'
            service = 'CosmosDB'
            region = $item.Region
            resourceType = 'CosmosDB'
            name = $item.DisplayName
            displayName = $item.DisplayName
            edition = $null
            tier = $null
            family = $null
            status = $item.Status
            available = Normalize-Boolean $item.AccessAllowedRegular
            zoneRedundant = Normalize-Boolean $item.SupportsAZ
            quotaCurrent = $null
            quotaLimit = $null
            metricPrimary = if ($item.AccessAllowedRegular) { 'Allowed' } else { 'Blocked' }
            metricSecondary = $item.ActionRequired
            details = [pscustomobject]@{
                supportsAz = Normalize-Boolean $item.SupportsAZ
                accessAllowedAz = Normalize-Boolean $item.AccessAllowedAZ
                accessAllowedRegular = Normalize-Boolean $item.AccessAllowedRegular
                isResidencyRestricted = Normalize-Boolean $item.IsResidencyRestricted
                backupRedundancies = $item.BackupRedundancies
                actionRequired = $item.ActionRequired
            }
        })
    }

    foreach ($item in @($ScanResult.PostgreSqlSkus)) {
        $rows.Add([pscustomobject]@{
            capturedAtUtc = $CapturedAtUtc.ToString('o')
            category = 'postgresql-sku'
            service = 'PostgreSQL'
            region = $item.Region
            resourceType = 'PostgreSQL'
            name = $item.SKU
            displayName = $item.SKU
            edition = $item.Edition
            tier = $item.Edition
            family = $null
            status = $item.Status
            available = @('Available', 'Default') -contains [string]$item.Status
            zoneRedundant = Normalize-Boolean $item.ZoneRedundant
            quotaCurrent = $null
            quotaLimit = $null
            metricPrimary = $item.vCores
            metricSecondary = $item.HAMode
            details = [pscustomobject]@{
                vCores = $item.vCores
                memoryGB = $item.MemoryGB
                maxIops = $item.MaxIOPS
                zones = $item.Zones
                zoneCount = $item.ZoneCount
                haMode = $item.HAMode
                storageEditions = $item.StorageEditions
            }
        })
    }

    foreach ($item in @($ScanResult.MySqlSkus)) {
        $rows.Add([pscustomobject]@{
            capturedAtUtc = $CapturedAtUtc.ToString('o')
            category = 'mysql-sku'
            service = 'MySQL'
            region = $item.Region
            resourceType = 'MySQL'
            name = $item.SKU
            displayName = $item.SKU
            edition = $item.Edition
            tier = $item.Edition
            family = $null
            status = $item.Status
            available = @('Available', 'Default') -contains [string]$item.Status
            zoneRedundant = $null
            quotaCurrent = $null
            quotaLimit = $null
            metricPrimary = $item.vCores
            metricSecondary = $item.ServerVersion
            details = [pscustomobject]@{
                serverVersion = $item.ServerVersion
                vCores = $item.vCores
                memoryGB = $item.MemoryGB
                maxIops = $item.MaxIOPS
                maxStorageGB = $item.MaxStorageGB
                haMode = $item.HAMode
                geoBackup = $item.GeoBackup
            }
        })
    }

    foreach ($item in @($ScanResult.AppServiceSkus)) {
        $rows.Add([pscustomobject]@{
            capturedAtUtc = $CapturedAtUtc.ToString('o')
            category = 'appservice-sku'
            service = 'AppService'
            region = $item.Region
            resourceType = 'AppService'
            name = $item.SKU
            displayName = $item.SKU
            edition = $item.SKU
            tier = $item.SKU
            family = $null
            status = $item.Status
            available = @('Available', 'Default') -contains [string]$item.Status
            zoneRedundant = Normalize-Boolean $item.ZoneRedundant
            quotaCurrent = $null
            quotaLimit = $null
            metricPrimary = if ($item.SupportsLinux) { 'Linux' } else { 'Windows' }
            metricSecondary = if ($item.SupportsFunctions) { 'Functions' } elseif ($item.SupportsContainers) { 'Containers' } else { '' }
            details = [pscustomobject]@{
                supportsLinux = Normalize-Boolean $item.SupportsLinux
                supportsWindows = Normalize-Boolean $item.SupportsWindows
                supportsFunctions = Normalize-Boolean $item.SupportsFunctions
                supportsContainers = Normalize-Boolean $item.SupportsContainers
            }
        })
    }

    foreach ($item in @($ScanResult.ContainerApps)) {
        $rows.Add([pscustomobject]@{
            capturedAtUtc = $CapturedAtUtc.ToString('o')
            category = 'containerapps-profile'
            service = 'ContainerApps'
            region = $item.Region
            resourceType = 'ContainerApps'
            name = $item.ProfileName
            displayName = $item.DisplayName
            edition = $item.Category
            tier = $item.Category
            family = $null
            status = $item.Status
            available = @('Available', 'Default') -contains [string]$item.Status
            zoneRedundant = $null
            quotaCurrent = $null
            quotaLimit = $null
            metricPrimary = $item.Cores
            metricSecondary = $item.MemoryGiB
            details = [pscustomobject]@{
                profileName = $item.ProfileName
                category = $item.Category
                cores = $item.Cores
                memoryGiB = $item.MemoryGiB
            }
        })
    }

    foreach ($item in @($ScanResult.AksVersions)) {
        $rows.Add([pscustomobject]@{
            capturedAtUtc = $CapturedAtUtc.ToString('o')
            category = 'aks-version'
            service = 'AKS'
            region = $item.Region
            resourceType = 'AKS'
            name = $item.Version
            displayName = $item.Version
            edition = if ($item.IsPreview) { 'Preview' } else { 'GA' }
            tier = if ($item.IsPreview) { 'Preview' } else { 'GA' }
            family = $null
            status = if ($item.IsPreview) { 'Preview' } else { 'Available' }
            available = $true
            zoneRedundant = $null
            quotaCurrent = $null
            quotaLimit = $null
            metricPrimary = $item.UpgradesTo
            metricSecondary = $item.SupportPlan
            details = $item
        })
    }

    foreach ($item in @($ScanResult.FunctionStacks)) {
        $rows.Add([pscustomobject]@{
            capturedAtUtc = $CapturedAtUtc.ToString('o')
            category = 'functions-stack'
            service = 'Functions'
            region = 'global'
            resourceType = 'Functions'
            name = "$($item.Stack) $($item.Version)"
            displayName = "$($item.Stack) $($item.Version)"
            edition = $item.Platform
            tier = $item.Platform
            family = $null
            status = if ($item.IsDeprecated) { 'Deprecated' } else { 'Available' }
            available = -not [bool]$item.IsDeprecated
            zoneRedundant = $null
            quotaCurrent = $null
            quotaLimit = $null
            metricPrimary = $item.Stack
            metricSecondary = $item.EndOfLifeDate
            details = $item
        })
    }

    foreach ($item in @($ScanResult.StorageSkus)) {
        $rows.Add([pscustomobject]@{
            capturedAtUtc = $CapturedAtUtc.ToString('o')
            category = 'storage-sku'
            service = 'Storage'
            region = $item.Region
            resourceType = 'Storage'
            name = $item.SKU
            displayName = $item.SKU
            edition = $item.Tier
            tier = $item.Tier
            family = $item.Kind
            status = $item.Status
            available = @('Available', 'Default') -contains [string]$item.Status
            zoneRedundant = Normalize-Boolean $item.ZoneRedundant
            quotaCurrent = $null
            quotaLimit = $null
            metricPrimary = $item.Kind
            metricSecondary = $item.Restrictions
            details = $item
        })
    }

    foreach ($item in @($ScanResult.StaticTierServices)) {
        $rows.Add([pscustomobject]@{
            capturedAtUtc = $CapturedAtUtc.ToString('o')
            category = 'static-tier'
            service = $item.Service
            region = $item.Region
            resourceType = 'StaticTier'
            name = $item.ServiceDisplay
            displayName = $item.ServiceDisplay
            edition = $item.KnownTiers
            tier = $item.KnownTiers
            family = $null
            status = $item.Status
            available = Normalize-Boolean $item.Available
            zoneRedundant = $null
            quotaCurrent = $null
            quotaLimit = $null
            metricPrimary = $item.PricingEntries
            metricSecondary = $item.KnownTiers
            details = $item
        })
    }

    return @($rows)
}

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
    $RepoRoot = Join-Path $PSScriptRoot 'Get-AzPaaSAvailability'
}

$repoPath = Resolve-Path -Path $RepoRoot -ErrorAction SilentlyContinue
if (-not $repoPath) {
    throw "Get-AzPaaSAvailability repository root was not found. Tried '$RepoRoot'."
}

$modulePath = Join-Path $repoPath.Path 'AzPaaSAvailability'
Import-Module $modulePath -Force -ErrorAction Stop

$contextStatus = Ensure-AzureContext
if (-not $contextStatus.hasContext) {
    throw "Azure context is required for PaaS availability scans but is unavailable. $($contextStatus.message)"
}

$regions = ConvertFrom-JsonArray -JsonValue $RegionsJson

$params = @{
    Quiet = $true
}

if ($regions.Count -gt 0) { $params.Region = $regions }
if ($RegionPreset) { $params.RegionPreset = $RegionPreset }
if ($Service -and $Service -ne 'All') { $params.Service = $Service }
if ($Edition) { $params.Edition = $Edition }
if ($ComputeModel) { $params.ComputeModel = $ComputeModel }
if ($SqlResourceType -and $SqlResourceType -ne 'SqlDatabase') { $params.SqlResourceType = $SqlResourceType }
if ($IncludeDisabled.IsPresent) { $params.IncludeDisabled = $true }
if ($FetchPricing.IsPresent) { $params.FetchPricing = $true }
if ($Environment) { $params.Environment = $Environment }
if ($MaxRetries -ne 3) { $params.MaxRetries = $MaxRetries }

$capturedAtUtc = [datetime]::UtcNow
$scanResult = Get-AzPaaSAvailability @params

$staticTierRows = @()
if ($Service -eq 'All' -or -not $Service) {
    $staticTierParams = @{
        Region = $(if ($regions.Count -gt 0) { $regions } else { $scanResult.ScanMetadata.Regions })
        MaxRetries = $MaxRetries
        Quiet = $true
    }
    if ($Environment) { $staticTierParams.Environment = $Environment }
    $staticTierRows = @(Get-AzServiceTierAvailability @staticTierParams)
}

$normalizedRows = Get-ScanRows -ScanResult ([pscustomobject]@{
    SqlSkus = @($scanResult.SqlSkus)
    CosmosDbLocations = @($scanResult.CosmosDbLocations)
    PostgreSqlSkus = @($scanResult.PostgreSqlSkus)
    MySqlSkus = @($scanResult.MySqlSkus)
    AppServiceSkus = @($scanResult.AppServiceSkus)
    ContainerApps = @($scanResult.ContainerApps)
    AksVersions = @($scanResult.AksVersions)
    FunctionStacks = @($scanResult.FunctionStacks)
    StorageSkus = @($scanResult.StorageSkus)
    StaticTierServices = @($staticTierRows)
}) -CapturedAtUtc $capturedAtUtc

$result = [pscustomobject]@{
    capturedAtUtc = $capturedAtUtc.ToString('o')
    rows = @($normalizedRows)
    summary = [pscustomobject]@{
        regionCount = @($scanResult.ScanMetadata.Regions).Count
        serviceCount = @($scanResult.ScanMetadata.Services).Count
        rowCount = @($normalizedRows).Count
        services = @($scanResult.ScanMetadata.Services)
        regions = @($scanResult.ScanMetadata.Regions)
        staticTierIncluded = ($staticTierRows.Count -gt 0)
    }
    metadata = [pscustomobject]@{
        scanMetadata = $scanResult.ScanMetadata
        contextMessage = $contextStatus.message
    }
}

$result | ConvertTo-Json -Depth 10