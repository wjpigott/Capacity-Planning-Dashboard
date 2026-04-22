function Get-AzAksAvailability {
    <#
    .SYNOPSIS
        Scans AKS Kubernetes version availability across regions.
    .EXAMPLE
        Get-AzAksAvailability -Region eastus,westus2
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

    if (-not $Quiet) { Write-Host "Scanning AKS versions in $($Region.Count) region(s)..." -ForegroundColor Yellow }

    $allResults = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($r in $Region) {
        try {
            $versions = Get-AksOrchestrators -Region $r -SubscriptionId $SubscriptionId `
                -AccessToken $accessToken -ArmUrl $endpoints.ResourceManagerUrl -MaxRetries $MaxRetries
            foreach ($v in $versions) { $allResults.Add($v) }
            $gaCount = @($versions | Where-Object { -not $_.IsPreview }).Count
            if (-not $Quiet) { Write-Host "  $($icons.Check) $r`: $($versions.Count) versions ($gaCount GA)" -ForegroundColor Green }
        }
        catch {
            if (-not $Quiet) { Write-Host "  $($icons.Error) $r`: $($_.Exception.Message)" -ForegroundColor Red }
        }
    }
    return $allResults
}
