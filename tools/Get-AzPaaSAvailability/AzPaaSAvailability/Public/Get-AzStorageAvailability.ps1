function Get-AzStorageAvailability {
    <#
    .SYNOPSIS
        Scans Azure Storage account SKU availability across regions.
    .DESCRIPTION
        Returns all storage SKUs with tier, kind, zone support, and restrictions.
    .EXAMPLE
        Get-AzStorageAvailability -Region eastus,westus2
    .EXAMPLE
        Get-AzStorageAvailability -Region eastus -Quiet | Where-Object { $_.Kind -eq 'StorageV2' }
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string[]]$Region,
        [string]$SubscriptionId,
        [ValidateSet('AzureCloud', 'AzureUSGovernment', 'AzureChinaCloud', 'AzureGermanCloud')]
        [string]$Environment,
        [int]$MaxRetries = 3,
        [switch]$Quiet
    )

    $endpoints = Resolve-AzureEndpoints -EnvironmentName $Environment
    $icons = Resolve-IconSet
    if (-not $SubscriptionId) { $SubscriptionId = (Get-AzContext -ErrorAction Stop).Subscription.Id }
    $accessToken = Get-AzBearerToken -ResourceUrl $endpoints.ResourceManagerUrl

    if (-not $Quiet) { Write-Host 'Scanning Storage SKUs...' -ForegroundColor Yellow }

    try {
        $results = Get-StorageSkus -SubscriptionId $SubscriptionId -AccessToken $accessToken `
            -ArmUrl $endpoints.ResourceManagerUrl -RegionFilter $Region -MaxRetries $MaxRetries
        if (-not $Quiet) {
            $byRegion = $results | Group-Object Region
            foreach ($g in $byRegion) {
                $restricted = @($g.Group | Where-Object { $_.Restricted }).Count
                Write-Host "  $($icons.Check) $($g.Name): $($g.Count) SKUs$(if ($restricted) { " ($restricted restricted)" })" -ForegroundColor $(if ($restricted) { 'Yellow' } else { 'Green' })
            }
        }
        return $results
    }
    catch {
        if (-not $Quiet) { Write-Host "  $($icons.Error) Storage: $($_.Exception.Message)" -ForegroundColor Red }
        return @()
    }
}
