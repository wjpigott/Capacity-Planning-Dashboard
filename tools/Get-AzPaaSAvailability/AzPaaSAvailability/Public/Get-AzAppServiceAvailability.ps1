function Get-AzAppServiceAvailability {
    <#
    .SYNOPSIS
        Scans App Service Plan SKU availability across regions.
    .DESCRIPTION
        Queries per-SKU geo-region availability and parses feature flags
        (zone redundancy, Linux, Functions, containers).
    .EXAMPLE
        Get-AzAppServiceAvailability -Region eastus,westus2
    .EXAMPLE
        Get-AzAppServiceAvailability -Region eastus -SKU PremiumV3 -Quiet
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string[]]$Region,
        [string]$SubscriptionId,
        [ValidateSet('Free', 'Shared', 'Basic', 'Standard', 'Premium', 'PremiumV2', 'PremiumV3', 'Isolated', 'IsolatedV2')]
        [string[]]$SKU,
        [ValidateSet('AzureCloud', 'AzureUSGovernment', 'AzureChinaCloud', 'AzureGermanCloud')]
        [string]$Environment,
        [int]$MaxRetries = 3,
        [switch]$Quiet
    )

    $endpoints = Resolve-AzureEndpoints -EnvironmentName $Environment
    $icons = Resolve-IconSet
    if (-not $SubscriptionId) { $SubscriptionId = (Get-AzContext -ErrorAction Stop).Subscription.Id }
    $accessToken = Get-AzBearerToken -ResourceUrl $endpoints.ResourceManagerUrl

    if (-not $Quiet) { Write-Host 'Scanning App Service SKU availability...' -ForegroundColor Yellow }

    try {
        $results = Get-AppServiceGeoRegions -SubscriptionId $SubscriptionId -AccessToken $accessToken `
            -ArmUrl $endpoints.ResourceManagerUrl -RegionFilter $Region -SkuFilter $SKU -MaxRetries $MaxRetries

        if (-not $Quiet) {
            $byRegion = $results | Group-Object Region
            foreach ($g in $byRegion) { Write-Host "  $($icons.Check) $($g.Name): $($g.Count) SKU tiers" -ForegroundColor Green }
        }
        return $results
    }
    catch {
        if (-not $Quiet) { Write-Host "  $($icons.Error) App Service: $($_.Exception.Message)" -ForegroundColor Red }
        return @()
    }
}
