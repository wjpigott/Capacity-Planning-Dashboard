function Get-AzContainerAppsAvailability {
    <#
    .SYNOPSIS
        Scans Container Apps workload profile availability across regions.
    .EXAMPLE
        Get-AzContainerAppsAvailability -Region eastus,westus2
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

    if (-not $Quiet) { Write-Host "Scanning Container Apps in $($Region.Count) region(s)..." -ForegroundColor Yellow }

    $allResults = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($r in $Region) {
        try {
            $profiles = Get-ContainerAppProfiles -Region $r -SubscriptionId $SubscriptionId `
                -AccessToken $accessToken -ArmUrl $endpoints.ResourceManagerUrl -MaxRetries $MaxRetries
            foreach ($p in $profiles) { $allResults.Add($p) }
            if (-not $Quiet) { Write-Host "  $($icons.Check) $r`: $($profiles.Count) profiles" -ForegroundColor Green }
        }
        catch {
            if (-not $Quiet) { Write-Host "  $($icons.Error) $r`: $($_.Exception.Message)" -ForegroundColor Red }
        }
    }
    return $allResults
}
