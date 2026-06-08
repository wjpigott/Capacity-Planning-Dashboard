param(
    [Parameter(Mandatory = $false)]
    [string]$SubscriptionIdsJson,

    [Parameter(Mandatory = $false)]
    [string]$LocationsJson,

    [Parameter(Mandatory = $false)]
    [ValidateSet('All', 'CosmosDB', 'SqlDB', 'SqlMI', 'PostgreSQL', 'MySQL')]
    [string[]]$Services = @('All'),

    [Parameter(Mandatory = $false)]
    [switch]$IncludeCapabilities
)

$ErrorActionPreference = 'Stop'

function ConvertFrom-JsonArray {
    param([string]$JsonValue)

    if (-not $JsonValue) { return @() }

    try {
        $parsed = ConvertFrom-Json -InputObject $JsonValue -ErrorAction Stop
        if ($parsed -is [string]) {
            $value = $parsed.Trim()
            if ($value) { return @($value) }
            return @()
        }

        if ($parsed -is [System.Collections.IEnumerable]) {
            return @($parsed | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })
        }
    }
    catch {
        return @($JsonValue -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    }

    return @()
}

function ConvertFrom-SecureToken {
    param($Token)

    if ($Token -is [Security.SecureString]) {
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Token)
        try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    }

    return [string]$Token
}

function Get-BearerToken {
    if (Get-Command -Name Get-AzAccessToken -ErrorAction SilentlyContinue) {
        try {
            $tokenResult = Get-AzAccessToken -ResourceUrl 'https://management.azure.com/' -ErrorAction Stop
            $token = (ConvertFrom-SecureToken -Token $tokenResult.Token).Trim()
            if ($token) { return $token }
        }
        catch {
        }
    }

    if ($env:IDENTITY_ENDPOINT -and $env:IDENTITY_HEADER) {
        $tokenUri = "$($env:IDENTITY_ENDPOINT)?resource=https://management.azure.com/&api-version=2019-08-01"
        $response = Invoke-RestMethod -Method Get -Uri $tokenUri -Headers @{ 'X-IDENTITY-HEADER' = $env:IDENTITY_HEADER } -TimeoutSec 30 -ErrorAction Stop
        if ($response.access_token) { return [string]$response.access_token }
    }

    if ($env:MSI_ENDPOINT -and $env:MSI_SECRET) {
        $tokenUri = "$($env:MSI_ENDPOINT)?resource=https://management.azure.com/&api-version=2017-09-01"
        $response = Invoke-RestMethod -Method Get -Uri $tokenUri -Headers @{ Secret = $env:MSI_SECRET } -TimeoutSec 30 -ErrorAction Stop
        if ($response.access_token) { return [string]$response.access_token }
    }

    throw 'Unable to acquire an Azure Resource Manager token. Configure App Service managed identity or install/sign in with Az.Accounts.'
}

function Invoke-ArmGet {
    param(
        [Parameter(Mandatory = $true)][string]$Token,
        [Parameter(Mandatory = $true)][string]$Uri,
        [switch]$QuietNotFound
    )

    try {
        return Invoke-RestMethod -Method Get -Uri $Uri -Headers @{ Authorization = "Bearer $Token"; 'Content-Type' = 'application/json' } -TimeoutSec 45 -ErrorAction Stop
    }
    catch {
        $statusCode = $null
        if ($_.Exception -and $_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        if ($QuietNotFound -and ($statusCode -eq 400 -or $statusCode -eq 404 -or ($statusCode -ge 500 -and $statusCode -lt 600))) {
            return $null
        }
        throw
    }
}

function Invoke-ArmGetAll {
    param(
        [Parameter(Mandatory = $true)][string]$Token,
        [Parameter(Mandatory = $true)][string]$Uri,
        [switch]$QuietNotFound
    )

    $items = [System.Collections.Generic.List[object]]::new()
    $next = $Uri
    while ($next) {
        $page = Invoke-ArmGet -Token $Token -Uri $next -QuietNotFound:$QuietNotFound
        if (-not $page) { break }
        if ($page.value) { $items.AddRange([object[]]$page.value) }
        $next = $page.nextLink
    }
    return @($items)
}

function New-UsageRow {
    param(
        [string]$SubscriptionId,
        [string]$SubscriptionName,
        [string]$Service,
        [string]$Region,
        [string]$Metric,
        $CurrentUsage,
        $Limit,
        [string]$Unit = 'Count',
        [object]$Details = $null
    )

    $numericCurrent = if ($null -ne $CurrentUsage -and $CurrentUsage -ne 'N/A') { [double]$CurrentUsage } else { $null }
    $numericLimit = if ($null -ne $Limit -and $Limit -ne 'N/A') { [double]$Limit } else { $null }
    $available = if ($null -ne $numericCurrent -and $null -ne $numericLimit) { $numericLimit - $numericCurrent } else { $null }
    $percentUsed = if ($null -ne $numericCurrent -and $numericLimit -gt 0) { [math]::Round(($numericCurrent / $numericLimit) * 100, 1) } else { $null }

    [pscustomobject]@{
        dataset = 'usage'
        subscriptionId = $SubscriptionId
        subscriptionName = $SubscriptionName
        service = $Service
        region = $Region
        metric = $Metric
        currentUsage = $numericCurrent
        limit = $numericLimit
        available = $available
        percentUsed = $percentUsed
        unit = $Unit
        accessAllowedForRegion = $null
        accessAllowedForAZ = $null
        notes = $null
        details = $Details
    }
}

function New-AccessRow {
    param(
        [string]$SubscriptionId,
        [string]$SubscriptionName,
        [string]$Service,
        [string]$Region,
        $AccessAllowedForRegion,
        $AccessAllowedForAZ,
        [string]$Notes,
        [object]$Details = $null
    )

    [pscustomobject]@{
        dataset = 'access'
        subscriptionId = $SubscriptionId
        subscriptionName = $SubscriptionName
        service = $Service
        region = $Region
        metric = 'Region and zone access'
        currentUsage = $null
        limit = $null
        available = $null
        percentUsed = $null
        unit = $null
        accessAllowedForRegion = $AccessAllowedForRegion
        accessAllowedForAZ = $AccessAllowedForAZ
        notes = $Notes
        details = $Details
    }
}

function New-CapabilityRow {
    param(
        [string]$SubscriptionId,
        [string]$SubscriptionName,
        [string]$Service,
        [string]$Region,
        [string]$Metric,
        [string]$Notes,
        [object]$Details
    )

    [pscustomobject]@{
        dataset = 'capability'
        subscriptionId = $SubscriptionId
        subscriptionName = $SubscriptionName
        service = $Service
        region = $Region
        metric = $Metric
        currentUsage = $null
        limit = $null
        available = $null
        percentUsed = $null
        unit = $null
        accessAllowedForRegion = $null
        accessAllowedForAZ = $null
        notes = $Notes
        details = $Details
    }
}

function Normalize-Region {
    param([string]$Value)
    return ($Value.ToLower() -replace '[\s-]', '')
}

function Get-RegionAzSupportMap {
    param([string]$Token, [string]$SubscriptionId)

    $map = @{}
    $uri = "https://management.azure.com/subscriptions/$SubscriptionId/locations?api-version=2022-12-01"
    $response = Invoke-ArmGet -Token $Token -Uri $uri
    foreach ($location in @($response.value)) {
        $map[(Normalize-Region $location.name)] = [bool]($location.availabilityZoneMappings -and $location.availabilityZoneMappings.Count -gt 0)
    }
    return $map
}

function Resolve-SubscriptionName {
    param([string]$Token, [string]$SubscriptionId)

    try {
        $subscription = Invoke-ArmGet -Token $Token -Uri "https://management.azure.com/subscriptions/$SubscriptionId?api-version=2020-01-01" -QuietNotFound
        if ($subscription -and $subscription.displayName) {
            return [string]$subscription.displayName
        }
    }
    catch {
    }

    return $SubscriptionId
}

function Add-SqlRows {
    param($Rows, [string]$Token, [string]$SubscriptionId, [string]$SubscriptionName, [string]$Region, [bool]$IncludeSqlDb, [bool]$IncludeSqlMi, [bool]$IncludeCaps, [bool]$RegionHasAZ)

    $usageUri = "https://management.azure.com/subscriptions/$SubscriptionId/providers/Microsoft.Sql/locations/$Region/usages?api-version=2025-01-01"
    $usageResponse = Invoke-ArmGet -Token $Token -Uri $usageUri -QuietNotFound
    foreach ($item in @($usageResponse.value)) {
        $name = [string]$item.name
        $displayName = if ($item.properties.displayName) { [string]$item.properties.displayName } else { $name }
        $isSqlDb = $IncludeSqlDb -and ($name -eq 'RegionalVCoreQuotaForSQLDBAndDW' -or $displayName -match 'SQL DB|SQL Database|Data Warehouse|DW')
        $isSqlMi = $IncludeSqlMi -and (($name -match 'ManagedInstance|SqlMI|SubnetFor') -or ($displayName -match '^VCore Quota$|^Subnet Quota$|Managed Instance'))
        if ($isSqlDb -or $isSqlMi) {
            $Rows.Add((New-UsageRow -SubscriptionId $SubscriptionId -SubscriptionName $SubscriptionName -Service $(if ($isSqlMi) { 'SQL MI' } else { 'SQL DB' }) -Region $Region -Metric $displayName -CurrentUsage $item.properties.currentValue -Limit $item.properties.limit -Unit $item.properties.unit -Details $item))
        }
    }

    $capabilitiesUri = "https://management.azure.com/subscriptions/$SubscriptionId/providers/Microsoft.Sql/locations/$Region/capabilities?api-version=2025-01-01"
    $capabilities = Invoke-ArmGet -Token $Token -Uri $capabilitiesUri -QuietNotFound
    if (-not $capabilities) { return }

    $regionAvailable = ([string]$capabilities.status) -eq 'Available'
    if ($IncludeSqlDb) {
        $Rows.Add((New-AccessRow -SubscriptionId $SubscriptionId -SubscriptionName $SubscriptionName -Service 'SQL DB' -Region $Region -AccessAllowedForRegion $regionAvailable -AccessAllowedForAZ 'N/A' -Notes $(if ($regionAvailable) { 'AZ access data not currently exposed for SQL DB' } else { 'Region access blocked - open support request' }) -Details @{ status = $capabilities.status }))
    }

    if ($IncludeSqlMi) {
        $zrFamilies = @()
        $nonZrFamilies = @()
        foreach ($version in @($capabilities.supportedManagedInstanceVersions)) {
            foreach ($edition in @($version.supportedEditions)) {
                foreach ($family in @($edition.supportedFamilies)) {
                    $familyName = "$($edition.name)/$($family.name)"
                    if ($family.zoneRedundant) { $zrFamilies += $familyName } else { $nonZrFamilies += $familyName }
                    if ($IncludeCaps) {
                        $Rows.Add((New-CapabilityRow -SubscriptionId $SubscriptionId -SubscriptionName $SubscriptionName -Service 'SQL MI' -Region $Region -Metric $familyName -Notes $family.status -Details $family))
                    }
                }
            }
        }
        $anyZr = $zrFamilies.Count -gt 0
        $allZr = $anyZr -and $nonZrFamilies.Count -eq 0
        $azAccess = if (-not $regionAvailable) { $false } elseif (-not $RegionHasAZ) { 'AZNotSupported' } elseif ($allZr) { $true } elseif ($anyZr) { 'Partial' } else { $false }
        $notes = if (-not $regionAvailable) { 'Region access blocked - open support request' } elseif ($RegionHasAZ -and $anyZr) { "ZR families: $($zrFamilies -join ', ')" } elseif ($RegionHasAZ) { 'ZR disabled for all families - open support request' } else { '' }
        $Rows.Add((New-AccessRow -SubscriptionId $SubscriptionId -SubscriptionName $SubscriptionName -Service 'SQL MI' -Region $Region -AccessAllowedForRegion $regionAvailable -AccessAllowedForAZ $azAccess -Notes $notes -Details @{ status = $capabilities.status; zrFamilies = $zrFamilies }))
    }
}

function Add-CosmosRows {
    param($Rows, [string]$Token, [string]$SubscriptionId, [string]$SubscriptionName, [string]$Region, [object[]]$Accounts, $LocationsResponse, [bool]$RegionHasAZ)

    $normalizedRegion = Normalize-Region $Region
    $location = @($LocationsResponse.value) | Where-Object { (Normalize-Region (($_.id -split '/locations/')[-1])) -eq $normalizedRegion } | Select-Object -First 1
    $regionAccounts = @($Accounts | Where-Object { (Normalize-Region $_.location) -eq $normalizedRegion })
    $Rows.Add((New-UsageRow -SubscriptionId $SubscriptionId -SubscriptionName $SubscriptionName -Service 'Cosmos DB' -Region $Region -Metric 'Database accounts in region' -CurrentUsage $regionAccounts.Count -Limit $null -Unit 'Count'))

    if (-not $location) {
        $Rows.Add((New-AccessRow -SubscriptionId $SubscriptionId -SubscriptionName $SubscriptionName -Service 'Cosmos DB' -Region $Region -AccessAllowedForRegion $false -AccessAllowedForAZ $(if ($RegionHasAZ) { $false } else { 'AZNotSupported' }) -Notes 'Service not available in this region'))
        return
    }

    $props = $location.properties
    $regionBlocked = $props.isSubscriptionRegionAccessAllowedForRegular -eq $false
    $azBlocked = $RegionHasAZ -and ($props.isSubscriptionRegionAccessAllowedForAz -eq $false)
    $notes = if ($regionBlocked -and $azBlocked) { 'Region and AZ access blocked - open support request' } elseif ($regionBlocked) { 'Region access blocked - open support request' } elseif ($azBlocked) { 'AZ access blocked - open support request' } else { '' }
    $Rows.Add((New-AccessRow -SubscriptionId $SubscriptionId -SubscriptionName $SubscriptionName -Service 'Cosmos DB' -Region $Region -AccessAllowedForRegion $props.isSubscriptionRegionAccessAllowedForRegular -AccessAllowedForAZ $(if (-not $RegionHasAZ) { 'AZNotSupported' } else { $props.isSubscriptionRegionAccessAllowedForAz }) -Notes $notes -Details $props))
}

function Add-PostgreSqlRows {
    param($Rows, [string]$Token, [string]$SubscriptionId, [string]$SubscriptionName, [string]$Region, [bool]$IncludeCaps, [bool]$RegionHasAZ)

    $usageUri = "https://management.azure.com/subscriptions/$SubscriptionId/providers/Microsoft.DBforPostgreSQL/locations/$Region/resourceType/flexibleServers/usages?api-version=2025-06-01-preview"
    foreach ($quota in @(Invoke-ArmGetAll -Token $Token -Uri $usageUri -QuietNotFound)) {
        $metric = if ($quota.name.localizedValue) { $quota.name.localizedValue } else { $quota.name.value }
        $Rows.Add((New-UsageRow -SubscriptionId $SubscriptionId -SubscriptionName $SubscriptionName -Service 'PostgreSQL Flex' -Region $Region -Metric $metric -CurrentUsage $quota.currentValue -Limit $quota.limit -Unit $quota.unit -Details $quota))
    }

    $capabilitiesUri = "https://management.azure.com/subscriptions/$SubscriptionId/providers/Microsoft.DBforPostgreSQL/locations/$Region/capabilities?api-version=2024-08-01"
    $capabilities = Invoke-ArmGet -Token $Token -Uri $capabilitiesUri -QuietNotFound
    $cap = @($capabilities.value) | Where-Object { $_.name -eq 'FlexibleServerCapabilities' } | Select-Object -First 1
    if (-not $cap) { return }
    $restricted = $cap.restricted -eq 'Enabled'
    $zrHa = $cap.zoneRedundantHaSupported -eq 'Enabled'
    $notes = if ($restricted -and $RegionHasAZ -and -not $zrHa) { 'Region and AZ access blocked - open support request' } elseif ($restricted) { 'Region access blocked - open support request' } elseif ($RegionHasAZ -and -not $zrHa) { 'AZ access blocked - open support request' } else { '' }
    $Rows.Add((New-AccessRow -SubscriptionId $SubscriptionId -SubscriptionName $SubscriptionName -Service 'PostgreSQL Flex' -Region $Region -AccessAllowedForRegion (-not $restricted) -AccessAllowedForAZ $(if (-not $RegionHasAZ) { 'AZNotSupported' } else { $zrHa }) -Notes $notes -Details $cap))
    if ($IncludeCaps) {
        $Rows.Add((New-CapabilityRow -SubscriptionId $SubscriptionId -SubscriptionName $SubscriptionName -Service 'PostgreSQL Flex' -Region $Region -Metric 'Flexible server capabilities' -Notes $cap.reason -Details $cap))
    }
}

function Add-MySqlRows {
    param($Rows, [string]$Token, [string]$SubscriptionId, [string]$SubscriptionName, [string]$Region, [bool]$IncludeCaps, [bool]$RegionHasAZ)

    $capabilitiesUri = "https://management.azure.com/subscriptions/$SubscriptionId/providers/Microsoft.DBforMySQL/locations/$Region/capabilities?api-version=2023-12-30"
    $capabilities = Invoke-ArmGet -Token $Token -Uri $capabilitiesUri -QuietNotFound
    if (-not $capabilities) { return }
    $items = @($capabilities.value)
    $restricted = $items.Count -eq 0
    $zrSupported = @($items | Where-Object { $_.supportedHAMode -contains 'ZoneRedundant' }).Count -gt 0
    $notes = if ($restricted -and $RegionHasAZ) { 'Region and AZ access blocked - open support request' } elseif ($restricted) { 'Region access blocked - open support request' } elseif ($RegionHasAZ -and -not $zrSupported) { 'AZ access blocked - open support request' } else { '' }
    $Rows.Add((New-AccessRow -SubscriptionId $SubscriptionId -SubscriptionName $SubscriptionName -Service 'MySQL Flex' -Region $Region -AccessAllowedForRegion (-not $restricted) -AccessAllowedForAZ $(if (-not $RegionHasAZ) { 'AZNotSupported' } else { $zrSupported }) -Notes $notes -Details @{ capabilityCount = $items.Count }))
    if ($IncludeCaps) {
        foreach ($item in $items) {
            $Rows.Add((New-CapabilityRow -SubscriptionId $SubscriptionId -SubscriptionName $SubscriptionName -Service 'MySQL Flex' -Region $Region -Metric "Zone $($item.zone)" -Notes ($item.supportedHAMode -join ', ') -Details $item))
        }
    }
}

$context = $null
if (Get-Command -Name Get-AzContext -ErrorAction SilentlyContinue) {
    $context = Get-AzContext -ErrorAction SilentlyContinue
    if ((-not $context -or -not $context.Account) -and (Get-Command -Name Connect-AzAccount -ErrorAction SilentlyContinue)) {
        $null = Connect-AzAccount -Identity -ErrorAction SilentlyContinue
        $context = Get-AzContext -ErrorAction SilentlyContinue
    }
}

$subscriptionIds = ConvertFrom-JsonArray -JsonValue $SubscriptionIdsJson
if ($subscriptionIds.Count -eq 0 -and $context -and $context.Subscription -and $context.Subscription.Id) {
    $subscriptionIds = @($context.Subscription.Id)
}
if ($subscriptionIds.Count -eq 0) { throw 'At least one subscription is required.' }

$locations = @(ConvertFrom-JsonArray -JsonValue $LocationsJson | ForEach-Object { Normalize-Region $_ })
if ($locations.Count -eq 0) { throw 'At least one location is required.' }

$selectedServices = @($Services | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($selectedServices.Count -eq 0) { $selectedServices = @('All') }
$runAll = $selectedServices -contains 'All'
$runSqlDb = $runAll -or ($selectedServices -contains 'SqlDB')
$runSqlMi = $runAll -or ($selectedServices -contains 'SqlMI')
$runCosmos = $runAll -or ($selectedServices -contains 'CosmosDB')
$runPostgreSql = $runAll -or ($selectedServices -contains 'PostgreSQL')
$runMySql = $runAll -or ($selectedServices -contains 'MySQL')

$capturedAtUtc = [datetime]::UtcNow
$scanStartedAt = Get-Date
$rows = [System.Collections.Generic.List[object]]::new()
$subscriptions = @()
$token = $null

foreach ($subscriptionId in $subscriptionIds) {
    $token = Get-BearerToken
    $subscriptionName = Resolve-SubscriptionName -Token $token -SubscriptionId $subscriptionId
    $subscriptions += [pscustomobject]@{ subscriptionId = $subscriptionId; subscriptionName = $subscriptionName }
    $azMap = Get-RegionAzSupportMap -Token $token -SubscriptionId $subscriptionId

    $cosmosLocations = $null
    $cosmosAccounts = @()
    if ($runCosmos) {
        $cosmosLocations = Invoke-ArmGet -Token $token -Uri "https://management.azure.com/subscriptions/$subscriptionId/providers/Microsoft.DocumentDB/locations?api-version=2024-11-15" -QuietNotFound
        $cosmosAccounts = @(Invoke-ArmGetAll -Token $token -Uri "https://management.azure.com/subscriptions/$subscriptionId/providers/Microsoft.DocumentDB/databaseAccounts?api-version=2024-11-15" -QuietNotFound)
        $rows.Add((New-UsageRow -SubscriptionId $subscriptionId -SubscriptionName $subscriptionName -Service 'Cosmos DB' -Region 'subscription' -Metric 'Total database accounts' -CurrentUsage $cosmosAccounts.Count -Limit 50 -Unit 'Count'))
    }

    foreach ($location in $locations) {
        $regionHasAZ = if ($azMap.ContainsKey($location)) { [bool]$azMap[$location] } else { $true }
        if ($runSqlDb -or $runSqlMi) { Add-SqlRows -Rows $rows -Token $token -SubscriptionId $subscriptionId -SubscriptionName $subscriptionName -Region $location -IncludeSqlDb $runSqlDb -IncludeSqlMi $runSqlMi -IncludeCaps ([bool]$IncludeCapabilities) -RegionHasAZ $regionHasAZ }
        if ($runCosmos -and $cosmosLocations) { Add-CosmosRows -Rows $rows -Token $token -SubscriptionId $subscriptionId -SubscriptionName $subscriptionName -Region $location -Accounts $cosmosAccounts -LocationsResponse $cosmosLocations -RegionHasAZ $regionHasAZ }
        if ($runPostgreSql) { Add-PostgreSqlRows -Rows $rows -Token $token -SubscriptionId $subscriptionId -SubscriptionName $subscriptionName -Region $location -IncludeCaps ([bool]$IncludeCapabilities) -RegionHasAZ $regionHasAZ }
        if ($runMySql) { Add-MySqlRows -Rows $rows -Token $token -SubscriptionId $subscriptionId -SubscriptionName $subscriptionName -Region $location -IncludeCaps ([bool]$IncludeCapabilities) -RegionHasAZ $regionHasAZ }
    }
}

$result = [pscustomobject]@{
    capturedAtUtc = $capturedAtUtc.ToString('o')
    rows = @($rows)
    summary = [pscustomobject]@{
        rowCount = @($rows).Count
        subscriptionCount = @($subscriptions).Count
        regionCount = @($locations).Count
        warningCount = @($rows | Where-Object { $_.dataset -eq 'usage' -and $null -ne $_.percentUsed -and $_.percentUsed -ge 80 }).Count
        blockedAccessCount = @($rows | Where-Object { $_.dataset -eq 'access' -and (($_.accessAllowedForRegion -eq $false) -or ($_.accessAllowedForAZ -eq $false)) }).Count
        services = @($selectedServices)
        regions = @($locations)
        subscriptions = @($subscriptions)
        includeCapabilities = [bool]$IncludeCapabilities
        scanDurationMs = [int]((Get-Date) - $scanStartedAt).TotalMilliseconds
    }
    metadata = [pscustomobject]@{
        source = 'Capacity-Planning-Dashboard Get-PaaSDatabaseQuotaReport.ps1'
        inspiredBy = 'https://github.com/naspinall-MS/az-quota-helper'
        account = if ($context -and $context.Account) { $context.Account.Id } elseif ($env:WEBSITE_SITE_NAME) { "managed-identity:$($env:WEBSITE_SITE_NAME)" } else { 'managed-identity' }
    }
}

$result | ConvertTo-Json -Depth 32