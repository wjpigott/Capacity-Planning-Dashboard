function Get-MySqlCapabilities {
    <#
    .SYNOPSIS
        Queries MySQL Flexible Server capabilities for a region.
    .DESCRIPTION
        Calls Microsoft.DBforMySQL/locations/{region}/capabilities to discover
        available editions (Burstable/GeneralPurpose/MemoryOptimized), SKUs per
        server version, HA mode, IOPS, and storage options.
    .OUTPUTS
        [PSCustomObject[]] — one object per SKU/version combination.
    #>
    param(
        [Parameter(Mandatory)][string]$Region,
        [Parameter(Mandatory)][string]$SubscriptionId,
        [Parameter(Mandatory)][string]$AccessToken,
        [string]$ArmUrl = 'https://management.azure.com',
        [string]$ApiVersion = '2023-12-30',
        [string[]]$EditionFilter,
        [string[]]$VersionFilter,
        [int]$MaxRetries = 3
    )

    $uri = "$ArmUrl/subscriptions/$SubscriptionId/providers/Microsoft.DBforMySQL/locations/$Region/capabilities?api-version=$ApiVersion"

    $response = Invoke-WithRetry -MaxRetries $MaxRetries -OperationName "MySQL Capabilities ($Region)" -ScriptBlock {
        Invoke-RestMethod -Uri $uri -Headers @{ Authorization = "Bearer $AccessToken" } -Method GET -TimeoutSec 60
    }

    $results = [System.Collections.Generic.List[PSCustomObject]]::new()

    foreach ($capSet in $response.value) {
        # MySQL zone and HA info is on the root capability set
        $rootZone = $capSet.zone
        $rootHA = @($capSet.supportedHAMode) -join ','
        $geoBackup = @($capSet.supportedGeoBackupRegions) -join ','

        foreach ($edition in $capSet.supportedFlexibleServerEditions) {
            if ($EditionFilter -and $EditionFilter.Count -gt 0 -and $edition.name -notin $EditionFilter) { continue }

            # Parse storage limits
            $storageInfo = $edition.supportedStorageEditions | Select-Object -First 1
            $maxStorageGB = if ($storageInfo.maxStorageSize) { [math]::Round($storageInfo.maxStorageSize / 1024, 0) } else { 0 }

            foreach ($ver in $edition.supportedServerVersions) {
                if ($VersionFilter -and $VersionFilter.Count -gt 0 -and $ver.name -notin $VersionFilter) { continue }

                foreach ($sku in $ver.supportedSkus) {
                    $memoryGB = [math]::Round(($sku.vCores * $sku.supportedMemoryPerVCoreMB) / 1024, 1)

                    $results.Add([PSCustomObject]@{
                        Region        = $Region
                        Service       = 'MySQL'
                        Edition       = $edition.name
                        ServerVersion = $ver.name
                        SKU           = $sku.name
                        vCores        = [int]$sku.vCores
                        MemoryGB      = $memoryGB
                        MaxIOPS       = [int]$sku.supportedIops
                        MaxStorageGB  = $maxStorageGB
                        HAMode        = $rootHA
                        GeoBackup     = $geoBackup
                        Status        = 'Available'
                    })
                }
            }
        }
    }

    return , $results
}
