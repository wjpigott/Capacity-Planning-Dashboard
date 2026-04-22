function Get-AzPostgreSqlAvailability {
    <#
    .SYNOPSIS
        Scans Azure Database for PostgreSQL Flexible Server SKU availability across regions.
    .DESCRIPTION
        Queries the PostgreSQL Capabilities API to return per-region SKU availability
        with edition, vCores, memory, IOPS, zone support, and HA mode.
    .PARAMETER Region
        One or more Azure region codes to scan.
    .PARAMETER SubscriptionId
        Azure subscription ID. Defaults to current Az context.
    .PARAMETER Edition
        Filter to specific editions (Burstable, GeneralPurpose, MemoryOptimized).
    .PARAMETER Environment
        Azure cloud environment override.
    .PARAMETER MaxRetries
        Max retry attempts for transient API errors.
    .PARAMETER Quiet
        Suppress Write-Host display output.
    .EXAMPLE
        Get-AzPostgreSqlAvailability -Region eastus,westus2
    .EXAMPLE
        Get-AzPostgreSqlAvailability -Region westus2 -Edition MemoryOptimized -Quiet
    .OUTPUTS
        [PSCustomObject] with Region, Service, Edition, SKU, vCores, MemoryGB,
        MaxIOPS, Zones, ZoneRedundant, HAMode, StorageEditions, Status
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string[]]$Region,
        [string]$SubscriptionId,
        [ValidateSet('Burstable', 'GeneralPurpose', 'MemoryOptimized')]
        [string[]]$Edition,
        [ValidateSet('AzureCloud', 'AzureUSGovernment', 'AzureChinaCloud', 'AzureGermanCloud')]
        [string]$Environment,
        [int]$MaxRetries = 3,
        [switch]$Quiet
    )

    $endpoints = Resolve-AzureEndpoints -EnvironmentName $Environment
    $icons = Resolve-IconSet
    $armUrl = $endpoints.ResourceManagerUrl

    if (-not $SubscriptionId) {
        $ctx = Get-AzContext -ErrorAction Stop
        if (-not $ctx) { throw 'No Azure context. Run Connect-AzAccount first.' }
        $SubscriptionId = $ctx.Subscription.Id
    }

    $accessToken = Get-AzBearerToken -ResourceUrl $armUrl

    if (-not $Quiet) {
        Write-Host "Scanning PostgreSQL Flexible Server in $($Region.Count) region(s)..." -ForegroundColor Yellow
    }

    $allResults = [System.Collections.Generic.List[PSCustomObject]]::new()

    foreach ($regionCode in $Region) {
        try {
            $pgParams = @{
                Region         = $regionCode
                SubscriptionId = $SubscriptionId
                AccessToken    = $accessToken
                ArmUrl         = $armUrl
                MaxRetries     = $MaxRetries
            }
            if ($Edition) { $pgParams.EditionFilter = $Edition }

            $skus = Get-PostgreSqlCapabilities @pgParams

            foreach ($sku in $skus) { $allResults.Add($sku) }

            if (-not $Quiet) {
                Write-Host "  $($icons.Check) $regionCode`: $($skus.Count) SKUs" -ForegroundColor Green
            }
        }
        catch {
            if (-not $Quiet) {
                Write-Host "  $($icons.Error) $regionCode`: $($_.Exception.Message)" -ForegroundColor Red
            }
            else {
                Write-Verbose "PostgreSQL scan failed for $regionCode`: $($_.Exception.Message)"
            }
        }
    }

    return $allResults
}
