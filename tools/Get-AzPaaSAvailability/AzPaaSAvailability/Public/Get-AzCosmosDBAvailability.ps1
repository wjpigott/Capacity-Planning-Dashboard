function Get-AzCosmosDBAvailability {
    <#
    .SYNOPSIS
        Scans Cosmos DB subscription-level region access across Azure regions.
    .DESCRIPTION
        Queries the Microsoft.DocumentDB/locations API to discover per-region:
        AZ support, subscription access flags, residency restrictions, backup redundancy.
        Surfaces hidden deployment blockers where subscriptions need allowlisting.
        Objects are always emitted to the pipeline. Use -Quiet to suppress Write-Host rendering.
    .PARAMETER Region
        One or more Azure region codes to filter results.
        If omitted, returns all regions from the API.
    .PARAMETER SubscriptionId
        Azure subscription ID. Defaults to current Az context.
    .PARAMETER Environment
        Azure cloud environment override.
    .PARAMETER MaxRetries
        Max retry attempts for transient API errors.
    .PARAMETER Quiet
        Suppress Write-Host display output. Objects still emit to pipeline.
    .EXAMPLE
        Get-AzCosmosDBAvailability -Region eastus,westus2,westeurope
        Checks Cosmos DB access for three regions.
    .EXAMPLE
        Get-AzCosmosDBAvailability | Where-Object { $_.ActionRequired -ne 'None' }
        Returns only blocked regions requiring a support request.
    .OUTPUTS
        [PSCustomObject] with properties: Region, DisplayName, SupportsAZ,
        AccessAllowedAZ, AccessAllowedRegular, IsResidencyRestricted,
        BackupRedundancies, Status, ActionRequired
    #>
    [CmdletBinding()]
    param(
        [string[]]$Region,

        [string]$SubscriptionId,

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
        Write-Host "Scanning Cosmos DB region access..." -ForegroundColor Yellow
    }

    try {
        $locations = Get-CosmosDbLocationAccess `
            -SubscriptionId $SubscriptionId `
            -AccessToken $accessToken `
            -ArmUrl $armUrl `
            -ApiVersion '2025-10-15' `
            -RegionFilter $Region `
            -MaxRetries $MaxRetries

        if (-not $Quiet) {
            $blockedCount = @($locations | Where-Object { $_.ActionRequired -ne 'None' }).Count
            $color = if ($blockedCount -gt 0) { 'Yellow' } else { 'Green' }
            Write-Host "  $($icons.Check) $($locations.Count) regions checked ($blockedCount blocked)" -ForegroundColor $color
        }

        return $locations
    }
    catch {
        if (-not $Quiet) {
            Write-Host "  $($icons.Error) Cosmos DB: $($_.Exception.Message)" -ForegroundColor Red
        }
        else {
            Write-Verbose "Cosmos DB scan failed: $($_.Exception.Message)"
        }
        return @()
    }
}
