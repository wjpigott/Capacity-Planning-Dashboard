function Get-CosmosDbLocationAccess {
    <#
    .SYNOPSIS
        Gets Cosmos DB location access flags for the subscription.
    .DESCRIPTION
        Calls Microsoft.DocumentDB/locations to discover per-region subscription access.
        Returns AZ support, subscription access (AZ and Regular), residency, backup options.
        This is a single call that returns ALL regions — no per-region looping needed.
    .PARAMETER SubscriptionId
        Azure subscription ID.
    .PARAMETER AccessToken
        Bearer token for ARM API.
    .PARAMETER ArmUrl
        ARM base URL.
    .PARAMETER ApiVersion
        Cosmos DB API version.
    .PARAMETER RegionFilter
        Optional array of region codes to filter results.
    .PARAMETER MaxRetries
        Max retry attempts.
    .OUTPUTS
        [PSCustomObject[]] — one object per region.
    #>
    param(
        [Parameter(Mandatory)][string]$SubscriptionId,
        [Parameter(Mandatory)][string]$AccessToken,
        [string]$ArmUrl = 'https://management.azure.com',
        [string]$ApiVersion = '2025-10-15',
        [string[]]$RegionFilter,
        [int]$MaxRetries = 3
    )

    $uri = "$ArmUrl/subscriptions/$SubscriptionId/providers/Microsoft.DocumentDB/locations?api-version=$ApiVersion"

    $response = Invoke-WithRetry -MaxRetries $MaxRetries -OperationName 'Cosmos DB Locations' -ScriptBlock {
        Invoke-RestMethod -Uri $uri -Headers @{ Authorization = "Bearer $AccessToken" } -Method GET -TimeoutSec 60
    }

    $results = [System.Collections.Generic.List[PSCustomObject]]::new()

    foreach ($loc in $response.value) {
        $regionName = $loc.name.ToLower() -replace '\s', ''

        if ($RegionFilter -and $RegionFilter.Count -gt 0 -and $regionName -notin $RegionFilter) { continue }

        $props = $loc.properties
        $accessAz = [bool]$props.isSubscriptionRegionAccessAllowedForAz
        $accessRegular = [bool]$props.isSubscriptionRegionAccessAllowedForRegular

        $actionRequired = 'None'
        if (-not $accessAz -and -not $accessRegular) {
            $actionRequired = 'Open SR — blocked for all account types'
        }
        elseif ($props.supportsAvailabilityZone -and -not $accessAz) {
            $actionRequired = 'Open SR — blocked for AZ accounts'
        }

        $results.Add([PSCustomObject]@{
            Region                = $regionName
            DisplayName           = $loc.name
            SupportsAZ            = [bool]$props.supportsAvailabilityZone
            AccessAllowedAZ       = $accessAz
            AccessAllowedRegular  = $accessRegular
            IsResidencyRestricted = [bool]$props.isResidencyRestricted
            BackupRedundancies    = @($props.backupStorageRedundancies) -join ','
            Status                = $props.status
            ActionRequired        = $actionRequired
        })
    }

    return , $results
}
