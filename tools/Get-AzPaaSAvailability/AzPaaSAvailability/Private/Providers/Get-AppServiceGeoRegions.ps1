function Get-AppServiceGeoRegions {
    <#
    .SYNOPSIS
        Queries App Service geo-region availability per SKU tier.
    .DESCRIPTION
        Calls Microsoft.Web/geoRegions to discover which regions support each SKU tier.
        The orgDomain field encodes feature flags (ZONEREDUNDANCY, LINUX, FUNCTIONS, etc.).
    #>
    param(
        [Parameter(Mandatory)][string]$SubscriptionId,
        [Parameter(Mandatory)][string]$AccessToken,
        [string]$ArmUrl = 'https://management.azure.com',
        [string]$ApiVersion = '2024-04-01',
        [string[]]$RegionFilter,
        [string[]]$SkuFilter,
        [int]$MaxRetries = 3
    )

    $skus = if ($SkuFilter) { $SkuFilter } else {
        @('Free', 'Shared', 'Basic', 'Standard', 'Premium', 'PremiumV2', 'PremiumV3', 'Isolated', 'IsolatedV2')
    }

    $results = [System.Collections.Generic.List[PSCustomObject]]::new()

    foreach ($sku in $skus) {
        $uri = "$ArmUrl/subscriptions/$SubscriptionId/providers/Microsoft.Web/geoRegions?sku=$sku&api-version=$ApiVersion"
        try {
            $response = Invoke-WithRetry -MaxRetries $MaxRetries -OperationName "App Service GeoRegions ($sku)" -ScriptBlock {
                Invoke-RestMethod -Uri $uri -Headers @{ Authorization = "Bearer $AccessToken" } -Method GET -TimeoutSec 30
            }
            foreach ($region in $response.value) {
                $regionCode = ($region.name -replace '\s', '').ToLower()
                if ($RegionFilter -and $RegionFilter.Count -gt 0 -and $regionCode -notin $RegionFilter) { continue }

                $flags = if ($region.properties.orgDomain) { $region.properties.orgDomain -split ';' } else { @() }
                $results.Add([PSCustomObject]@{
                    Region         = $regionCode
                    DisplayName    = $region.properties.displayName
                    SKU            = $sku
                    ZoneRedundant  = 'ZONEREDUNDANCY' -in $flags
                    Linux          = ('LINUX' -in $flags) -or ('LINUXV3' -in $flags)
                    Functions      = 'FUNCTIONS' -in $flags
                    FlexConsumption = 'FLEXCONSUMPTION' -in $flags
                    Containers     = ('XENON' -in $flags) -or ('XENONV3' -in $flags)
                    Status         = 'Available'
                })
            }
        }
        catch {
            Write-Verbose "App Service GeoRegions failed for SKU $sku`: $($_.Exception.Message)"
        }
    }

    return , $results
}
