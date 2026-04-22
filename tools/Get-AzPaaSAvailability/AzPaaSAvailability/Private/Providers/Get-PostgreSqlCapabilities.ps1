function Get-PostgreSqlCapabilities {
    <#
    .SYNOPSIS
        Queries PostgreSQL Flexible Server capabilities for a region.
    .DESCRIPTION
        Calls Microsoft.DBforPostgreSQL/locations/{region}/capabilities to discover
        available editions (Burstable/GeneralPurpose/MemoryOptimized), SKUs,
        zone availability, HA mode, IOPS, and storage options.
    .OUTPUTS
        [PSCustomObject[]] — one object per SKU.
    #>
    param(
        [Parameter(Mandatory)][string]$Region,
        [Parameter(Mandatory)][string]$SubscriptionId,
        [Parameter(Mandatory)][string]$AccessToken,
        [string]$ArmUrl = 'https://management.azure.com',
        [string]$ApiVersion = '2024-08-01',
        [string[]]$EditionFilter,
        [int]$MaxRetries = 3
    )

    $uri = "$ArmUrl/subscriptions/$SubscriptionId/providers/Microsoft.DBforPostgreSQL/locations/$Region/capabilities?api-version=$ApiVersion"

    $response = Invoke-WithRetry -MaxRetries $MaxRetries -OperationName "PostgreSQL Capabilities ($Region)" -ScriptBlock {
        Invoke-RestMethod -Uri $uri -Headers @{ Authorization = "Bearer $AccessToken" } -Method GET -TimeoutSec 60
    }

    $results = [System.Collections.Generic.List[PSCustomObject]]::new()

    foreach ($capSet in $response.value) {
        foreach ($edition in $capSet.supportedServerEditions) {
            if ($EditionFilter -and $EditionFilter.Count -gt 0 -and $edition.name -notin $EditionFilter) { continue }

            # Parse storage options
            $storageEditions = @($edition.supportedStorageEditions | ForEach-Object { $_.name }) -join ','

            foreach ($sku in $edition.supportedServerSkus) {
                # Parse zones from space-separated string
                $zones = if ($sku.supportedZones) { ($sku.supportedZones -split '\s+' | Where-Object { $_ }) } else { @() }
                $zoneCount = $zones.Count
                $zoneRedundant = $zoneCount -ge 3

                # Parse HA mode
                $haMode = if ($sku.supportedHaMode) { $sku.supportedHaMode } else { 'None' }
                $memoryGB = [math]::Round(($sku.vCores * $sku.supportedMemoryPerVcoreMb) / 1024, 1)

                $results.Add([PSCustomObject]@{
                    Region          = $Region
                    Service         = 'PostgreSQL'
                    Edition         = $edition.name
                    SKU             = $sku.name
                    vCores          = [int]$sku.vCores
                    MemoryGB        = $memoryGB
                    MaxIOPS         = [int]$sku.supportedIops
                    Zones           = ($zones -join ',')
                    ZoneCount       = $zoneCount
                    ZoneRedundant   = $zoneRedundant
                    HAMode          = $haMode
                    StorageEditions = $storageEditions
                    Status          = 'Available'
                })
            }
        }
    }

    return , $results
}
