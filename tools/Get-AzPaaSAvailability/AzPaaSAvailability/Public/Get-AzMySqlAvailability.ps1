function Get-AzMySqlAvailability {
    <#
    .SYNOPSIS
        Scans Azure Database for MySQL Flexible Server SKU availability across regions.
    .DESCRIPTION
        Queries the MySQL Capabilities API to return per-region SKU availability
        with edition, server version, vCores, memory, IOPS, HA, and storage limits.
    .PARAMETER Region
        One or more Azure region codes to scan.
    .PARAMETER SubscriptionId
        Azure subscription ID. Defaults to current Az context.
    .PARAMETER Edition
        Filter to specific editions (Burstable, GeneralPurpose, MemoryOptimized).
    .PARAMETER ServerVersion
        Filter to specific MySQL versions (e.g., '8.0.21', '8.4', '9.3').
    .PARAMETER Environment
        Azure cloud environment override.
    .PARAMETER MaxRetries
        Max retry attempts for transient API errors.
    .PARAMETER Quiet
        Suppress Write-Host display output.
    .EXAMPLE
        Get-AzMySqlAvailability -Region eastus,westus2
    .EXAMPLE
        Get-AzMySqlAvailability -Region eastus -ServerVersion '8.4' -Edition GeneralPurpose -Quiet
    .OUTPUTS
        [PSCustomObject] with Region, Service, Edition, ServerVersion, SKU, vCores,
        MemoryGB, MaxIOPS, MaxStorageGB, HAMode, GeoBackup, Status
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string[]]$Region,
        [string]$SubscriptionId,
        [ValidateSet('Burstable', 'GeneralPurpose', 'MemoryOptimized')]
        [string[]]$Edition,
        [string[]]$ServerVersion,
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
        Write-Host "Scanning MySQL Flexible Server in $($Region.Count) region(s)..." -ForegroundColor Yellow
    }

    $allResults = [System.Collections.Generic.List[PSCustomObject]]::new()

    foreach ($regionCode in $Region) {
        try {
            $myParams = @{
                Region         = $regionCode
                SubscriptionId = $SubscriptionId
                AccessToken    = $accessToken
                ArmUrl         = $armUrl
                MaxRetries     = $MaxRetries
            }
            if ($Edition) { $myParams.EditionFilter = $Edition }
            if ($ServerVersion) { $myParams.VersionFilter = $ServerVersion }

            $skus = Get-MySqlCapabilities @myParams

            foreach ($sku in $skus) { $allResults.Add($sku) }

            if (-not $Quiet) {
                $uniqueSkus = @($skus | Select-Object -ExpandProperty SKU -Unique).Count
                Write-Host "  $($icons.Check) $regionCode`: $($skus.Count) SKU/version combos ($uniqueSkus unique SKUs)" -ForegroundColor Green
            }
        }
        catch {
            if (-not $Quiet) {
                Write-Host "  $($icons.Error) $regionCode`: $($_.Exception.Message)" -ForegroundColor Red
            }
            else {
                Write-Verbose "MySQL scan failed for $regionCode`: $($_.Exception.Message)"
            }
        }
    }

    return $allResults
}
