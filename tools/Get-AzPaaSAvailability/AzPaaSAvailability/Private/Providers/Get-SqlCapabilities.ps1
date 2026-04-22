function Get-SqlCapabilities {
    <#
    .SYNOPSIS
        Queries SQL Database/MI capabilities for a region via the ARM API.
    .DESCRIPTION
        Calls Microsoft.Sql/locations/{region}/capabilities to discover available
        editions, SKUs, zone redundancy, compute models, and license types.
    .PARAMETER Region
        Azure region code.
    .PARAMETER SubscriptionId
        Azure subscription ID.
    .PARAMETER AccessToken
        Bearer token for ARM API.
    .PARAMETER ArmUrl
        ARM base URL (supports sovereign clouds).
    .PARAMETER ApiVersion
        SQL API version.
    .PARAMETER ResourceType
        SqlDatabase, ManagedInstance, or ElasticPool.
    .PARAMETER EditionFilter
        Optional edition name filter.
    .PARAMETER ComputeModelFilter
        Optional compute model filter (Provisioned/Serverless).
    .PARAMETER IncludeDisabledSkus
        Include SKUs with Visible/Disabled status.
    .PARAMETER MaxRetries
        Max retry attempts.
    .OUTPUTS
        [PSCustomObject[]] — one object per SKU.
    #>
    param(
        [Parameter(Mandatory)][string]$Region,
        [Parameter(Mandatory)][string]$SubscriptionId,
        [Parameter(Mandatory)][string]$AccessToken,
        [string]$ArmUrl = 'https://management.azure.com',
        [string]$ApiVersion = '2021-11-01',
        [string]$ResourceType = 'SqlDatabase',
        [string[]]$EditionFilter,
        [string]$ComputeModelFilter,
        [switch]$IncludeDisabledSkus,
        [int]$MaxRetries = 3
    )

    $includeParam = switch ($ResourceType) {
        'SqlDatabase'    { 'supportedEditions' }
        'ManagedInstance' { 'supportedManagedInstanceVersions' }
        'ElasticPool'    { 'supportedElasticPoolEditions' }
        default          { 'supportedEditions' }
    }

    $uri = "$ArmUrl/subscriptions/$SubscriptionId/providers/Microsoft.Sql/locations/$Region/capabilities?include=$includeParam&api-version=$ApiVersion"

    $response = Invoke-WithRetry -MaxRetries $MaxRetries -OperationName "SQL Capabilities ($Region)" -ScriptBlock {
        Invoke-RestMethod -Uri $uri -Headers @{ Authorization = "Bearer $AccessToken" } -Method GET -TimeoutSec 60
    }

    $results = [System.Collections.Generic.List[PSCustomObject]]::new()

    if ($ResourceType -eq 'SqlDatabase') {
        foreach ($version in $response.supportedServerVersions) {
            foreach ($edition in $version.supportedEditions) {
                if ($edition.name -eq 'System') { continue }
                if ($EditionFilter -and $EditionFilter.Count -gt 0 -and $edition.name -notin $EditionFilter) { continue }

                $editionZoneRedundant = [bool]$edition.zoneRedundant
                $storageCapabilities = @($edition.supportedStorageCapabilities | ForEach-Object { $_.storageAccountType }) -join ','

                foreach ($slo in $edition.supportedServiceLevelObjectives) {
                    if (-not $IncludeDisabledSkus -and $slo.status -notin @('Available', 'Default')) { continue }
                    if ($ComputeModelFilter -and $slo.computeModel -and $slo.computeModel -ne $ComputeModelFilter) { continue }

                    $licenseTypes = @($slo.supportedLicenseTypes | ForEach-Object { $_.name })

                    $results.Add([PSCustomObject]@{
                        Region               = $Region
                        ResourceType         = 'SqlDatabase'
                        Edition              = $edition.name
                        SKU                  = $slo.name
                        Family               = $slo.sku.family
                        Tier                 = $slo.sku.tier
                        vCores               = [int]$slo.performanceLevel.value
                        PerformanceUnit      = $slo.performanceLevel.unit
                        ComputeModel         = $slo.computeModel
                        ZoneRedundant        = [bool]$slo.zoneRedundant
                        EditionZoneRedundant = $editionZoneRedundant
                        AHUBSupported        = ('BasePrice' -in $licenseTypes)
                        LicenseTypes         = ($licenseTypes -join ',')
                        StorageRedundancy    = $storageCapabilities
                        Status               = $slo.status
                        MaintenanceConfigs   = @($slo.supportedMaintenanceConfigurations | ForEach-Object { $_.name }) -join ','
                    })
                }
            }
        }
    }
    elseif ($ResourceType -eq 'ManagedInstance') {
        foreach ($version in $response.supportedManagedInstanceVersions) {
            foreach ($edition in $version.supportedEditions) {
                if ($EditionFilter -and $EditionFilter.Count -gt 0 -and $edition.name -notin $EditionFilter) { continue }

                $storageCapabilities = @($edition.supportedStorageCapabilities | ForEach-Object { $_.storageAccountType }) -join ','

                foreach ($family in $edition.supportedFamilies) {
                    foreach ($vcoreOption in $family.supportedVcoresValues) {
                        if (-not $IncludeDisabledSkus -and $vcoreOption.status -notin @('Available', 'Default')) { continue }

                        $licenseTypes = @($family.supportedLicenseTypes | ForEach-Object { $_.name })
                        $maxStorageGB = if ($vcoreOption.includedMaxSize) {
                            [math]::Round($vcoreOption.includedMaxSize.limit / 1024, 0)
                        } else { 0 }

                        $results.Add([PSCustomObject]@{
                            Region                = $Region
                            ResourceType          = 'ManagedInstance'
                            Edition               = $edition.name
                            SKU                   = "$($family.sku)_$($vcoreOption.value)"
                            Family                = $family.name
                            Tier                  = $edition.name
                            vCores                = [int]$vcoreOption.value
                            PerformanceUnit       = 'VCores'
                            ComputeModel          = 'Provisioned'
                            ZoneRedundant         = [bool]$edition.zoneRedundant
                            EditionZoneRedundant  = [bool]$edition.zoneRedundant
                            AHUBSupported         = ('BasePrice' -in $licenseTypes)
                            LicenseTypes          = ($licenseTypes -join ',')
                            StorageRedundancy     = $storageCapabilities
                            Status                = $vcoreOption.status
                            IncludedStorageGB     = $maxStorageGB
                            InstancePoolSupported = [bool]$vcoreOption.instancePoolSupported
                            StandaloneSupported   = [bool]$vcoreOption.standaloneSupported
                        })
                    }
                }
            }
        }
    }

    return , $results
}
