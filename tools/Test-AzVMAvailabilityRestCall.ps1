<#
.SYNOPSIS
    Sample REST test for Azure VM SKU availability and regional quota usage.

.DESCRIPTION
    Uses the current Az PowerShell context to get an ARM bearer token, then calls
    the same REST APIs used by Get-AzVMAvailability.ps1:
      - Microsoft.Compute/skus for SKU capabilities and restrictions
      - Microsoft.Compute/locations/{region}/usages for quota usage

    The REST response does not contain literal OK or LIMITED values. This script
    prints the restriction reasonCode/type values returned by ARM so they can be
    compared with the availability tool output.

.EXAMPLE
    .\tools\Test-AzVMAvailabilityRestCall.ps1 -FamilyFilter E -Region eastus2

.EXAMPLE
    .\tools\Test-AzVMAvailabilityRestCall.ps1 -Region eastus2 -SkuFilter Standard_E104i_v5,Standard_E128-32ads_v7 -ShowRaw
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$SubscriptionId,

    [Parameter(Mandatory = $false)]
    [string]$Region = 'eastus2',

    [Parameter(Mandatory = $false)]
    [string[]]$FamilyFilter = @('E'),

    [Parameter(Mandatory = $false)]
    [string[]]$SkuFilter,

    [Parameter(Mandatory = $false)]
    [switch]$ShowRaw
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PlainTextToken {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ResourceUrl
    )

    $tokenResult = Get-AzAccessToken -ResourceUrl $ResourceUrl
    if ($tokenResult.Token -is [System.Security.SecureString]) {
        return [System.Net.NetworkCredential]::new('', $tokenResult.Token).Password
    }

    return [string]$tokenResult.Token
}

function Get-SkuFamilyName {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SkuName
    )

    if ($SkuName -match 'Standard_([A-Z]+)\d') {
        return $matches[1]
    }

    return 'Unknown'
}

function Get-CapabilityValue {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Sku,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $capability = @($Sku.capabilities | Where-Object { $_.name -eq $Name } | Select-Object -First 1)
    if ($capability.Count -gt 0) {
        return $capability[0].value
    }

    return $null
}

function Get-RestRestrictionText {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Sku
    )

    $restrictions = @($Sku.restrictions)
    if ($restrictions.Count -eq 0) {
        return 'NoRestrictionsReturned'
    }

    $restrictionText = @($restrictions | ForEach-Object {
        $reasonCode = if ($_.reasonCode) { [string]$_.reasonCode } else { 'NoReasonCodeReturned' }
        $type = if ($_.type) { [string]$_.type } else { 'NoTypeReturned' }
        "reasonCode=$reasonCode,type=$type"
    } | Sort-Object -Unique)

    if ($restrictionText.Count -gt 0) {
        return ($restrictionText -join '; ')
    }

    return 'RestrictionsReturnedWithoutReasonCode'
}

function Get-RestZoneText {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Sku
    )

    $allZones = @($Sku.locationInfo | Select-Object -First 1 | ForEach-Object { $_.zones })
    $restrictedZones = @($Sku.restrictions |
        Where-Object { $_.type -eq 'Zone' -and $_.restrictionInfo -and $_.restrictionInfo.zones } |
        ForEach-Object { $_.restrictionInfo.zones } |
        Sort-Object -Unique)

    if ($restrictedZones.Count -gt 0) {
        return "restrictionInfo.zones=$($restrictedZones -join ',')"
    }

    if ($allZones.Count -gt 0) {
        return "locationInfo.zones=$($allZones -join ',')"
    }

    return 'NoZonesReturned'
}

function Find-QuotaForSkuFamily {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Sku,

        [Parameter(Mandatory = $true)]
        [object[]]$Usages
    )

    $skuQuotaFamily = [string]$Sku.family
    $quota = @($Usages | Where-Object { $_.name.value -eq $skuQuotaFamily } | Select-Object -First 1)
    if ($quota.Count -eq 0) {
        return $null
    }

    return $quota[0]
}

$context = Get-AzContext
if (-not $context) {
    throw 'No Az context found. Run Connect-AzAccount and Select-AzSubscription first.'
}

if (-not $SubscriptionId) {
    $SubscriptionId = [string]$context.Subscription.Id
}

$resourceManagerUrl = $context.Environment.ResourceManagerUrl.TrimEnd('/')
$bearerToken = Get-PlainTextToken -ResourceUrl $resourceManagerUrl
$headers = @{
    Authorization = "Bearer $bearerToken"
    'Content-Type' = 'application/json'
}

$skuUri = "$resourceManagerUrl/subscriptions/$SubscriptionId/providers/Microsoft.Compute/skus?api-version=2021-07-01&`$filter=location eq '$Region'"
$usageUri = "$resourceManagerUrl/subscriptions/$SubscriptionId/providers/Microsoft.Compute/locations/$Region/usages?api-version=2023-09-01"

Write-Host 'REST calls:' -ForegroundColor Cyan
Write-Host "GET $skuUri"
Write-Host "GET $usageUri"
Write-Host ''

try {
    $skuResponse = Invoke-RestMethod -Method GET -Uri $skuUri -Headers $headers
    $usageResponse = Invoke-RestMethod -Method GET -Uri $usageUri -Headers $headers
}
finally {
    $headers.Authorization = $null
    $bearerToken = $null
}

$allSkus = @($skuResponse.value | Where-Object { $_.resourceType -eq 'virtualMachines' })

if ($FamilyFilter -and $FamilyFilter.Count -gt 0) {
    $allSkus = @($allSkus | Where-Object {
        $derivedFamily = Get-SkuFamilyName -SkuName $_.name
        $FamilyFilter -contains $derivedFamily
    })
}

if ($SkuFilter -and $SkuFilter.Count -gt 0) {
    $allSkus = @($allSkus | Where-Object {
        $skuName = [string]$_.name
        $matched = $false
        foreach ($pattern in $SkuFilter) {
            if ($skuName -like $pattern) {
                $matched = $true
                break
            }
        }
        $matched
    })
}

$rows = foreach ($sku in ($allSkus | Sort-Object name)) {
    $quota = Find-QuotaForSkuFamily -Sku $sku -Usages @($usageResponse.value)
    $availableQuota = if ($quota) { [int]$quota.limit - [int]$quota.currentValue } else { $null }
    $restrictionReasons = @($sku.restrictions | ForEach-Object { $_.reasonCode } | Sort-Object -Unique)

    [pscustomobject]@{
        SKU             = [string]$sku.name
        Family          = Get-SkuFamilyName -SkuName $sku.name
        QuotaFamily     = [string]$sku.family
        vCPU            = Get-CapabilityValue -Sku $sku -Name 'vCPUs'
        MemGiB          = Get-CapabilityValue -Sku $sku -Name 'MemoryGB'
        Gen             = (Get-CapabilityValue -Sku $sku -Name 'HyperVGenerations') -replace 'V', ''
        Arch            = Get-CapabilityValue -Sku $sku -Name 'CpuArchitectureType'
        RestZones       = Get-RestZoneText -Sku $sku
        RestRestriction = Get-RestRestrictionText -Sku $sku
        QuotaUsed       = if ($quota) { $quota.currentValue } else { $null }
        QuotaLimit      = if ($quota) { $quota.limit } else { $null }
        QuotaAvailable  = $availableQuota
        RestrictionType = (@($sku.restrictions | ForEach-Object { $_.type } | Sort-Object -Unique) -join ',')
        Reason          = ($restrictionReasons -join ',')
    }
}

$rows | Format-Table -AutoSize

if ($ShowRaw) {
    [pscustomobject]@{
        SkuUri   = $skuUri
        UsageUri = $usageUri
        Skus     = @($allSkus)
        Usages   = @($usageResponse.value)
    } | ConvertTo-Json -Depth 20
}