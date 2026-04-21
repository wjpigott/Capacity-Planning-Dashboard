function Get-AzPaaSAvailability {
    <#
    .SYNOPSIS
        Scans Azure PaaS service availability, capacity, quota, and pricing across regions.
    .DESCRIPTION
        Orchestrator function that calls service-specific scan functions and renders
        a unified display with cross-service summary. Supports SQL Database, SQL MI,
        and Cosmos DB. Objects are always emitted to the pipeline.
    .PARAMETER Region
        One or more Azure region codes to scan.
    .PARAMETER RegionPreset
        Predefined region set (USEastWest, USMajor, Europe, etc.).
    .PARAMETER Service
        Which service(s) to scan: SqlDatabase, CosmosDB, or All (default).
    .PARAMETER Edition
        Filter SQL editions.
    .PARAMETER ComputeModel
        Filter SQL compute model.
    .PARAMETER SqlResourceType
        SqlDatabase or ManagedInstance.
    .PARAMETER IncludeDisabled
        Include Visible/Disabled SKUs.
    .PARAMETER FetchPricing
        Include retail pricing.
    .PARAMETER Environment
        Azure cloud environment override.
    .PARAMETER MaxRetries
        Max retry attempts.
    .PARAMETER Quiet
        Suppress all Write-Host display. Objects still emit to pipeline.
    .EXAMPLE
        Get-AzPaaSAvailability -Region eastus,westus2
        Scans all PaaS services in two regions with formatted display.
    .EXAMPLE
        $results = Get-AzPaaSAvailability -Region eastus -Quiet
        Captures structured results without terminal output.
    .EXAMPLE
        Get-AzPaaSAvailability -Service SqlDatabase -Edition Hyperscale -Region eastus
        Scans only Hyperscale SQL availability.
    .OUTPUTS
        [PSCustomObject] with SqlSkus, SqlUsages, CosmosDbLocations, and ScanMetadata.
    #>
    [CmdletBinding()]
    param(
        [string[]]$Region,

        [ValidateSet('USEastWest', 'USCentral', 'USMajor', 'Europe', 'AsiaPacific', 'Global', 'USGov', 'China', 'ASR-EastWest', 'ASR-CentralUS')]
        [string]$RegionPreset,

        [ValidateSet('SqlDatabase', 'CosmosDB', 'PostgreSQL', 'MySQL', 'AppService', 'ContainerApps', 'AKS', 'Functions', 'Storage', 'All')]
        [string]$Service = 'All',

        [ValidateSet('GeneralPurpose', 'BusinessCritical', 'Hyperscale')]
        [string[]]$Edition,

        [ValidateSet('Provisioned', 'Serverless')]
        [string]$ComputeModel,

        [ValidateSet('SqlDatabase', 'ManagedInstance')]
        [string]$SqlResourceType = 'SqlDatabase',

        [switch]$IncludeDisabled,

        [switch]$FetchPricing,

        [ValidateSet('AzureCloud', 'AzureUSGovernment', 'AzureChinaCloud', 'AzureGermanCloud')]
        [string]$Environment,

        [int]$MaxRetries = 3,

        [switch]$Quiet
    )

    #region Resolve regions
    $RegionPresets = @{
        'USEastWest'    = @('eastus', 'eastus2', 'westus', 'westus2')
        'USCentral'     = @('centralus', 'northcentralus', 'southcentralus', 'westcentralus')
        'USMajor'       = @('eastus', 'eastus2', 'centralus', 'westus', 'westus2')
        'Europe'        = @('westeurope', 'northeurope', 'uksouth', 'francecentral', 'germanywestcentral')
        'AsiaPacific'   = @('eastasia', 'southeastasia', 'japaneast', 'australiaeast', 'koreacentral')
        'Global'        = @('eastus', 'westeurope', 'southeastasia', 'australiaeast', 'brazilsouth')
        'USGov'         = @('usgovvirginia', 'usgovtexas', 'usgovarizona')
        'China'         = @('chinaeast', 'chinanorth', 'chinaeast2', 'chinanorth2')
        'ASR-EastWest'  = @('eastus', 'westus2')
        'ASR-CentralUS' = @('centralus', 'eastus2')
    }

    if ($RegionPreset) {
        $Region = $RegionPresets[$RegionPreset]
        if ($RegionPreset -eq 'USGov' -and -not $Environment) { $Environment = 'AzureUSGovernment' }
        elseif ($RegionPreset -eq 'China' -and -not $Environment) { $Environment = 'AzureChinaCloud' }
    }

    if (-not $Region -or $Region.Count -eq 0) {
        throw 'No regions specified. Use -Region or -RegionPreset.'
    }
    #endregion

    $scanSql = $Service -in @('SqlDatabase', 'All')
    $scanCosmos = $Service -in @('CosmosDB', 'All')
    $scanPostgreSql = $Service -in @('PostgreSQL', 'All')
    $scanMySql = $Service -in @('MySQL', 'All')
    $scanAppService = $Service -in @('AppService', 'All')
    $scanContainerApps = $Service -in @('ContainerApps', 'All')
    $scanAks = $Service -in @('AKS', 'All')
    $scanFunctions = $Service -in @('Functions', 'All')
    $scanStorage = $Service -in @('Storage', 'All')
    $endpoints = Resolve-AzureEndpoints -EnvironmentName $Environment
    $icons = Resolve-IconSet
    $scanStart = Get-Date
    $version = '0.5.0'

    #region Banner
    if (-not $Quiet) {
        $serviceList = @()
        if ($scanSql) { $serviceList += "SQL ($SqlResourceType)" }
        if ($scanCosmos) { $serviceList += 'Cosmos DB' }
        if ($scanPostgreSql) { $serviceList += 'PostgreSQL Flex' }
        if ($scanMySql) { $serviceList += 'MySQL Flex' }
        if ($scanAppService) { $serviceList += 'App Service' }
        if ($scanContainerApps) { $serviceList += 'Container Apps' }
        if ($scanAks) { $serviceList += 'AKS' }
        if ($scanFunctions) { $serviceList += 'Functions' }
        if ($scanStorage) { $serviceList += 'Storage' }

        $filters = @()
        if ($Edition) { $filters += "Editions: $($Edition -join ', ')" }
        if ($ComputeModel) { $filters += "Compute: $ComputeModel" }
        if ($FetchPricing) { $filters += 'Pricing: ON' }

        $ctx = Get-AzContext -ErrorAction SilentlyContinue
        $subDisplay = if ($ctx) { $ctx.Subscription.Id } else { 'unknown' }

        Write-ScanBanner -Version $version -SubscriptionIds @($subDisplay) -Regions $Region `
            -Services $serviceList -Filters $filters -Icons $icons `
            -EnvironmentName $endpoints.EnvironmentName
    }
    #endregion

    #region Scan
    $sqlResults = @()
    $cosmosResults = @()

    if ($scanSql) {
        $sqlParams = @{
            Region          = $Region
            SqlResourceType = $SqlResourceType
            MaxRetries      = $MaxRetries
            Quiet           = [bool]$Quiet
            IncludeDisabled = [bool]$IncludeDisabled
            FetchPricing    = [bool]$FetchPricing
        }
        if ($Edition) { $sqlParams.Edition = $Edition }
        if ($ComputeModel) { $sqlParams.ComputeModel = $ComputeModel }
        if ($Environment) { $sqlParams.Environment = $Environment }

        $sqlResults = Get-AzSqlAvailability @sqlParams
    }

    if ($scanCosmos) {
        $cosmosParams = @{
            Region     = $Region
            MaxRetries = $MaxRetries
            Quiet      = [bool]$Quiet
        }
        if ($Environment) { $cosmosParams.Environment = $Environment }

        $cosmosResults = Get-AzCosmosDBAvailability @cosmosParams
    }

    $pgResults = @()
    if ($scanPostgreSql) {
        $pgParams = @{ Region = $Region; MaxRetries = $MaxRetries; Quiet = [bool]$Quiet }
        if ($Edition) { $pgParams.Edition = $Edition }
        if ($Environment) { $pgParams.Environment = $Environment }
        $pgResults = Get-AzPostgreSqlAvailability @pgParams
    }

    $myResults = @()
    if ($scanMySql) {
        $myParams = @{ Region = $Region; MaxRetries = $MaxRetries; Quiet = [bool]$Quiet }
        if ($Edition) { $myParams.Edition = $Edition }
        if ($Environment) { $myParams.Environment = $Environment }
        $myResults = Get-AzMySqlAvailability @myParams
    }

    $appSvcResults = @()
    if ($scanAppService) {
        $asParams = @{ Region = $Region; MaxRetries = $MaxRetries; Quiet = [bool]$Quiet }
        if ($Environment) { $asParams.Environment = $Environment }
        $appSvcResults = Get-AzAppServiceAvailability @asParams
    }

    $caResults = @()
    if ($scanContainerApps) {
        $caParams = @{ Region = $Region; MaxRetries = $MaxRetries; Quiet = [bool]$Quiet }
        if ($Environment) { $caParams.Environment = $Environment }
        $caResults = Get-AzContainerAppsAvailability @caParams
    }

    $aksResults = @()
    if ($scanAks) {
        $aksParams = @{ Region = $Region; MaxRetries = $MaxRetries; Quiet = [bool]$Quiet }
        if ($Environment) { $aksParams.Environment = $Environment }
        $aksResults = Get-AzAksAvailability @aksParams
    }

    $funcResults = @()
    if ($scanFunctions) {
        $funcParams = @{ MaxRetries = $MaxRetries; Quiet = [bool]$Quiet }
        if ($Environment) { $funcParams.Environment = $Environment }
        $funcResults = Get-AzFunctionsAvailability @funcParams
    }

    $storageResults = @()
    if ($scanStorage) {
        $stParams = @{ Region = $Region; MaxRetries = $MaxRetries; Quiet = [bool]$Quiet }
        if ($Environment) { $stParams.Environment = $Environment }
        $storageResults = Get-AzStorageAvailability @stParams
    }
    #endregion

    #region Display (non-Quiet)
    if (-not $Quiet) {
        $outputWidth = 120

        # SQL display
        if ($scanSql -and $sqlResults.Count -gt 0) {
            $groupedByRegion = $sqlResults | Group-Object Region
            foreach ($group in $groupedByRegion) {
                $regionCode = $group.Name
                $skus = $group.Group

                Write-Host ''
                Write-Host ('=' * $outputWidth) -ForegroundColor Gray
                Write-Host "SQL $($SqlResourceType.ToUpper()): $regionCode" -ForegroundColor Cyan
                Write-Host ('=' * $outputWidth) -ForegroundColor Gray

                $headerFmt = "{0,-18} {1,-16} {2,6} {3,5} {4,-12} {5,-6} {6,-10} {7,-18} {8,-14}"
                Write-Host ($headerFmt -f 'Edition', 'SKU', 'vCores', 'Zone', 'Compute', 'AHUB', 'Status', 'Storage', 'Quota(vCores)') -ForegroundColor White
                Write-Host ('-' * $outputWidth) -ForegroundColor DarkGray

                $firstSku = $skus | Select-Object -First 1
                $quotaDisplay = if ($null -ne $firstSku.VCoreQuotaLimit) { "$($firstSku.VCoreQuotaUsed)/$($firstSku.VCoreQuotaLimit)" } else { '-' }

                foreach ($sku in ($skus | Sort-Object Edition, vCores)) {
                    $zoneIcon = if ($sku.ZoneRedundant) { $icons.Check } else { $icons.Error }
                    $ahub = if ($sku.AHUBSupported) { 'Yes' } else { 'No' }
                    $stor = $sku.StorageRedundancy
                    $skuDisp = if ($sku.SKU.Length -gt 16) { $sku.SKU.Substring(0, 13) + '...' } else { $sku.SKU }

                    Write-Host ($headerFmt -f $sku.Edition, $skuDisp, $sku.vCores, $zoneIcon, $sku.ComputeModel, $ahub, $sku.Status, $stor, $quotaDisplay) -ForegroundColor (Get-StatusColor $sku.Status)
                }

                Write-Host ('-' * $outputWidth) -ForegroundColor DarkGray

                $uniqueStatuses = @($skus | ForEach-Object { $_.Status } | Sort-Object -Unique)
                if (($uniqueStatuses | Where-Object { $_ -notin @('Available', 'Default') }) -or $IncludeDisabled) {
                    Write-StatusKey
                }

                if ($null -ne $firstSku.ServerQuotaLimit) {
                    Write-Host "Server Quota: $($firstSku.ServerQuotaUsed)/$($firstSku.ServerQuotaLimit)" -ForegroundColor DarkGray -NoNewline
                    Write-Host ' | ' -ForegroundColor DarkGray -NoNewline
                }
                if ($null -ne $firstSku.VCoreQuotaLimit -and $firstSku.VCoreQuotaLimit -gt 0) {
                    $pct = [math]::Round(($firstSku.VCoreQuotaUsed / $firstSku.VCoreQuotaLimit) * 100, 0)
                    $qColor = if ($pct -ge 80) { 'Red' } elseif ($pct -ge 50) { 'Yellow' } else { 'Green' }
                    Write-Host "vCore Quota: $($firstSku.VCoreQuotaUsed)/$($firstSku.VCoreQuotaLimit) ($pct%)" -ForegroundColor $qColor
                }
                else { Write-Host 'vCore Quota: unavailable' -ForegroundColor DarkGray }

                Write-Host "Total: $($skus.Count) SKUs" -ForegroundColor DarkGray
            }
        }

        # Cosmos DB display
        if ($scanCosmos -and $cosmosResults.Count -gt 0) {
            Write-Host ''
            Write-Host ('=' * $outputWidth) -ForegroundColor Gray
            Write-Host 'COSMOS DB REGION ACCESS' -ForegroundColor Cyan
            Write-Host ('=' * $outputWidth) -ForegroundColor Gray

            $hFmt = "{0,-18} {1,5} {2,-15} {3,-17} {4,-10} {5,-15} {6,-8}"
            Write-Host ($hFmt -f 'Region', 'AZ', 'Access (AZ)', 'Access (Regular)', 'Residency', 'Backup', 'Status') -ForegroundColor White
            Write-Host ('-' * $outputWidth) -ForegroundColor DarkGray

            foreach ($loc in ($cosmosResults | Sort-Object Region)) {
                $azIcon = if ($loc.SupportsAZ) { $icons.Check } else { $icons.Error }
                $azAccess = if ($loc.SupportsAZ) { if ($loc.AccessAllowedAZ) { "$($icons.Check) Allowed" } else { "$($icons.Error) BLOCKED" } } else { '-' }
                $regAccess = if ($loc.AccessAllowedRegular) { "$($icons.Check) Allowed" } else { "$($icons.Error) BLOCKED" }
                $resid = if ($loc.IsResidencyRestricted) { 'Yes' } else { 'No' }
                $backup = if ($loc.BackupRedundancies.Length -gt 15) { $loc.BackupRedundancies.Substring(0, 12) + '...' } else { $loc.BackupRedundancies }
                $rowColor = if ($loc.ActionRequired -ne 'None') { 'Red' } elseif (-not $loc.SupportsAZ) { 'Yellow' } else { 'Green' }

                Write-Host ($hFmt -f $loc.Region, $azIcon, $azAccess, $regAccess, $resid, $backup, $loc.Status) -ForegroundColor $rowColor
            }
            Write-Host ('-' * $outputWidth) -ForegroundColor DarkGray

            $blocked = @($cosmosResults | Where-Object { $_.ActionRequired -ne 'None' })
            if ($blocked.Count -gt 0) {
                Write-Host ''
                Write-Host "$($icons.Warning) ACTION REQUIRED:" -ForegroundColor Red
                foreach ($br in $blocked) { Write-Host "  $($br.Region): $($br.ActionRequired)" -ForegroundColor Yellow }
            }
            else { Write-Host 'All scanned regions are accessible.' -ForegroundColor Green }
        }

        # Region Health Matrix (when multiple services scanned)
        $scannedCount = @($scanSql, $scanCosmos, $scanPostgreSql, $scanMySql, $scanAppService, $scanContainerApps, $scanAks, $scanFunctions, $scanStorage) | Where-Object { $_ }
        if ($scannedCount.Count -ge 2) {
            $matrixData = [PSCustomObject]@{
                SqlSkus           = $sqlResults
                CosmosDbLocations = $cosmosResults
                PostgreSqlSkus    = $pgResults
                MySqlSkus         = $myResults
                AppServiceSkus    = $appSvcResults
                ContainerApps     = $caResults
                AksVersions       = $aksResults
                FunctionStacks    = $funcResults
                StorageSkus       = $storageResults
                ScanMetadata      = [PSCustomObject]@{ Regions = $Region }
            }
            Show-AzPaaSRegionMatrix -ScanResult $matrixData -Icons $icons
        }

        # Scan complete
        $elapsed = (Get-Date) - $scanStart
        $stats = @()
        if ($scanSql) { $stats += "SQL: $($sqlResults.Count) SKUs" }
        if ($scanCosmos) { $stats += "Cosmos DB: $($cosmosResults.Count) regions" }
        if ($scanPostgreSql) { $stats += "PostgreSQL: $($pgResults.Count) SKUs" }
        if ($scanMySql) { $stats += "MySQL: $($myResults.Count) SKUs" }
        if ($scanAppService) { $stats += "App Service: $($appSvcResults.Count) SKU/regions" }
        if ($scanContainerApps) { $stats += "Container Apps: $($caResults.Count) profiles" }
        if ($scanAks) { $stats += "AKS: $($aksResults.Count) versions" }
        if ($scanFunctions) { $stats += "Functions: $($funcResults.Count) stacks" }
        if ($scanStorage) { $stats += "Storage: $($storageResults.Count) SKUs" }
        Write-ScanComplete -Elapsed $elapsed -StatsLines $stats -RegionCount $Region.Count
    }
    #endregion

    # Build result object
    $result = [PSCustomObject]@{
        SqlSkus            = $sqlResults
        CosmosDbLocations  = $cosmosResults
        PostgreSqlSkus     = $pgResults
        MySqlSkus          = $myResults
        AppServiceSkus     = $appSvcResults
        ContainerApps      = $caResults
        AksVersions        = $aksResults
        FunctionStacks     = $funcResults
        StorageSkus        = $storageResults
        ScanMetadata       = [PSCustomObject]@{
            Version      = $version
            Regions      = $Region
            Services     = @(
                $(if ($scanSql) { 'SqlDatabase' }),
                $(if ($scanCosmos) { 'CosmosDB' }),
                $(if ($scanPostgreSql) { 'PostgreSQL' }),
                $(if ($scanMySql) { 'MySQL' }),
                $(if ($scanAppService) { 'AppService' }),
                $(if ($scanContainerApps) { 'ContainerApps' }),
                $(if ($scanAks) { 'AKS' }),
                $(if ($scanFunctions) { 'Functions' }),
                $(if ($scanStorage) { 'Storage' })
            ) | Where-Object { $_ }
            ScanDuration = [math]::Round(((Get-Date) - $scanStart).TotalSeconds, 1)
            GeneratedAt  = (Get-Date -Format 'o')
        }
    }

    # Only emit to pipeline when output is being captured (piped, assigned, redirected).
    # In interactive terminal mode, the Write-Host display is the output — suppress the
    # raw object dump that produces 2000+ noisy @{...} lines.
    if ($Quiet -or [Console]::IsOutputRedirected) {
        return $result
    }
    else {
        # Store in a well-known variable so the user can access it after the run
        Set-Variable -Name 'AzPaaSLastResult' -Value $result -Scope Global -Force
        Write-Host "Tip: Results stored in " -ForegroundColor DarkGray -NoNewline
        Write-Host '$AzPaaSLastResult' -ForegroundColor Cyan -NoNewline
        Write-Host " — or use -Quiet to capture: " -ForegroundColor DarkGray -NoNewline
        Write-Host '$r = Get-AzPaaSAvailability ... -Quiet' -ForegroundColor Cyan
    }
}
