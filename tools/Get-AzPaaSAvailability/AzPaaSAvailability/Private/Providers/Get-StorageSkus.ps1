function Get-StorageSkus {
    <#
    .SYNOPSIS
        Queries Azure Storage account SKUs per region.
    .DESCRIPTION
        Calls Microsoft.Storage/skus to discover all storage SKUs with capabilities,
        restrictions, zone support, and kind (StorageV2, BlobStorage, FileStorage, etc.).
        Filters to the specified regions.
    #>
    param(
        [Parameter(Mandatory)][string]$SubscriptionId,
        [Parameter(Mandatory)][string]$AccessToken,
        [string]$ArmUrl = 'https://management.azure.com',
        [string]$ApiVersion = '2023-05-01',
        [string[]]$RegionFilter,
        [int]$MaxRetries = 3
    )

    $uri = "$ArmUrl/subscriptions/$SubscriptionId/providers/Microsoft.Storage/skus?api-version=$ApiVersion"

    $response = Invoke-WithRetry -MaxRetries $MaxRetries -OperationName 'Storage SKUs' -ScriptBlock {
        Invoke-RestMethod -Uri $uri -Headers @{ Authorization = "Bearer $AccessToken" } -Method GET -TimeoutSec 60
    }

    $results = [System.Collections.Generic.List[PSCustomObject]]::new()

    foreach ($sku in $response.value) {
        if ($sku.resourceType -ne 'storageAccounts') { continue }

        foreach ($loc in $sku.locations) {
            $regionCode = $loc.ToLower() -replace '\s', ''
            if ($RegionFilter -and $RegionFilter.Count -gt 0 -and $regionCode -notin $RegionFilter) { continue }

            $locInfo = $sku.locationInfo | Where-Object { ($_.location -replace '\s', '').ToLower() -eq $regionCode } | Select-Object -First 1
            $zones = if ($locInfo -and $locInfo.zones) { @($locInfo.zones) -join ',' } else { '' }

            $restricted = $false
            $restrictionReason = ''
            foreach ($r in $sku.restrictions) {
                if ($r.values -contains $loc -or $r.values -contains $regionCode) {
                    $restricted = $true
                    $restrictionReason = $r.reasonCode
                }
            }

            $results.Add([PSCustomObject]@{
                Region       = $regionCode
                Service      = 'Storage'
                SKU          = $sku.name
                Tier         = $sku.tier
                Kind         = $sku.kind
                Zones        = $zones
                Restricted   = $restricted
                Restriction  = $restrictionReason
                Status       = if ($restricted) { 'Restricted' } else { 'Available' }
            })
        }
    }

    return , $results
}
