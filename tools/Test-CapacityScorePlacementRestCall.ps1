<#
.SYNOPSIS
    Sample REST test for the Capacity Score live placement API call.

.DESCRIPTION
    Uses the current Az PowerShell context to get an ARM bearer token, then calls
    the same Azure Compute placement-score REST API used by the Capacity Score
    Refresh Live Placement workflow:

      POST /subscriptions/{subscriptionId}/providers/Microsoft.Compute/locations/{anchorRegion}/placementScores/spot/generate?api-version=2025-06-05

    The request body contains desiredLocations, desiredSizes, and desiredCount.
    The response is a placement confidence signal for that request. It is not a
    capacity reservation and does not guarantee that a later deployment will
    succeed.

.EXAMPLE
    .\tools\Test-CapacityScorePlacementRestCall.ps1 -SkuNames Standard_E8s_v5 -Regions eastus2 -DesiredCount 10

.EXAMPLE
    .\tools\Test-CapacityScorePlacementRestCall.ps1 -SubscriptionId 00000000-0000-0000-0000-000000000000 -SkuNames Standard_E8s_v5,Standard_E16s_v5 -Regions eastus2,centralus -DesiredCount 25
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$SubscriptionId,

    [Parameter(Mandatory = $false)]
    [string[]]$SkuNames = @('Standard_E8s_v5'),

    [Parameter(Mandatory = $false)]
    [string[]]$Regions = @('eastus2'),

    [ValidateRange(1, 1000)]
    [int]$DesiredCount = 1,

    [Parameter(Mandatory = $false)]
    [string]$ApiVersion = '2025-06-05',

    [Parameter(Mandatory = $false)]
    [switch]$IncludeAvailabilityZone,

    [Parameter(Mandatory = $false)]
    [switch]$SummaryOnly
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

function Get-ResponseContentFromError {
    param(
        [Parameter(Mandatory = $true)]
        [System.Management.Automation.ErrorRecord]$ErrorRecord
    )

    $response = $ErrorRecord.Exception.Response
    if (-not $response) {
        return $ErrorRecord.Exception.Message
    }

    if ($response.PSObject.Properties.Match('Content').Count -gt 0 -and $response.Content) {
        return [string]$response.Content
    }

    try {
        $stream = $response.GetResponseStream()
        if (-not $stream) {
            return $ErrorRecord.Exception.Message
        }

        $reader = [System.IO.StreamReader]::new($stream)
        try {
            return $reader.ReadToEnd()
        }
        finally {
            $reader.Dispose()
        }
    }
    catch {
        return $ErrorRecord.Exception.Message
    }
}

function Get-ResponseStatusCodeFromError {
    param(
        [Parameter(Mandatory = $true)]
        [System.Management.Automation.ErrorRecord]$ErrorRecord
    )

    $response = $ErrorRecord.Exception.Response
    if (-not $response) {
        return $null
    }

    if ($response.PSObject.Properties.Match('StatusCode').Count -gt 0) {
        return [int]$response.StatusCode
    }

    if ($response.StatusCode) {
        return [int]$response.StatusCode.value__
    }

    return $null
}

function Get-FirstPropertyValue {
    param(
        [Parameter(Mandatory = $true)]
        [object]$InputObject,

        [Parameter(Mandatory = $true)]
        [string[]]$PropertyNames
    )

    foreach ($propertyName in $PropertyNames) {
        $property = $InputObject.PSObject.Properties[$propertyName]
        if ($property -and $null -ne $property.Value) {
            return $property.Value
        }
    }

    return $null
}

function ConvertTo-PlacementSummaryRows {
    param(
        [Parameter(Mandatory = $false)]
        [object]$Payload
    )

    $rawRows = @()
    if ($Payload -and $Payload.PSObject.Properties.Match('placementScores').Count -gt 0) {
        $rawRows = @($Payload.placementScores)
    }
    elseif ($Payload -and $Payload.PSObject.Properties.Match('value').Count -gt 0) {
        $rawRows = @($Payload.value)
    }
    elseif ($Payload -and $Payload.PSObject.Properties.Match('rows').Count -gt 0) {
        $rawRows = @($Payload.rows)
    }
    elseif ($Payload -is [System.Collections.IEnumerable] -and $Payload -isnot [string]) {
        $rawRows = @($Payload)
    }

    foreach ($row in $rawRows) {
        if (-not $row) { continue }

        $sku = Get-FirstPropertyValue -InputObject $row -PropertyNames @('sku', 'Sku', 'skuName', 'SkuName', 'vmSize', 'VmSize', 'armSkuName', 'ArmSkuName')
        $region = Get-FirstPropertyValue -InputObject $row -PropertyNames @('region', 'Region', 'location', 'Location', 'armRegionName', 'ArmRegionName')
        $score = Get-FirstPropertyValue -InputObject $row -PropertyNames @('score', 'Score', 'placementScore', 'PlacementScore', 'availabilityScore', 'AvailabilityScore')
        $isAvailable = Get-FirstPropertyValue -InputObject $row -PropertyNames @('isQuotaAvailable', 'IsQuotaAvailable', 'isAvailable', 'IsAvailable')
        $isRestricted = Get-FirstPropertyValue -InputObject $row -PropertyNames @('isRestricted', 'IsRestricted')

        [pscustomobject]@{
            SKU          = if ($sku) { [string]$sku } else { $null }
            Region       = if ($region) { [string]$region } else { $null }
            Score        = if ($score) { [string]$score } else { 'N/A' }
            IsAvailable  = $isAvailable
            IsRestricted = $isRestricted
        }
    }
}

$context = Get-AzContext
if (-not $context) {
    throw 'No Az context found. Run Connect-AzAccount and Select-AzSubscription first.'
}

if (-not $SubscriptionId) {
    $SubscriptionId = [string]$context.Subscription.Id
}

$normalizedSkus = @($SkuNames | Where-Object { $_ } | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
$normalizedRegions = @($Regions | Where-Object { $_ } | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ } | Select-Object -Unique)

if ($normalizedSkus.Count -eq 0) {
    throw 'At least one SKU name is required.'
}

if ($normalizedRegions.Count -eq 0) {
    throw 'At least one region is required.'
}

if ($normalizedSkus.Count -gt 5) {
    throw 'Capacity Score chunks live placement calls to a maximum of 5 SKUs per REST call. Re-run this script with 5 or fewer SKUs.'
}

if ($normalizedRegions.Count -gt 8) {
    throw 'Capacity Score chunks live placement calls to a maximum of 8 regions per REST call. Re-run this script with 8 or fewer regions.'
}

$resourceManagerUrl = $context.Environment.ResourceManagerUrl.TrimEnd('/')
$anchorRegion = $normalizedRegions[0]
$placementUri = "$resourceManagerUrl/subscriptions/$SubscriptionId/providers/Microsoft.Compute/locations/$anchorRegion/placementScores/spot/generate?api-version=$ApiVersion"
$requestBody = [ordered]@{
    desiredLocations = @($normalizedRegions)
    desiredSizes     = @($normalizedSkus | ForEach-Object { [ordered]@{ sku = $_ } })
    desiredCount     = $DesiredCount
}

if ($IncludeAvailabilityZone) {
    $requestBody.availabilityZone = $true
}

$requestJson = $requestBody | ConvertTo-Json -Depth 20

Write-Host 'REST call:' -ForegroundColor Cyan
Write-Host "POST $placementUri"
Write-Host ''
Write-Host 'Request body:' -ForegroundColor Cyan
Write-Host $requestJson
Write-Host ''

$bearerToken = Get-PlainTextToken -ResourceUrl $resourceManagerUrl
$headers = @{
    Authorization = "Bearer $bearerToken"
    'Content-Type' = 'application/json'
}

$statusCode = $null
$rawResponse = $null

try {
    $response = Invoke-WebRequest -Method POST -Uri $placementUri -Headers $headers -Body $requestJson -ContentType 'application/json'
    $statusCode = [int]$response.StatusCode
    $rawResponse = [string]$response.Content
}
catch {
    $statusCode = Get-ResponseStatusCodeFromError -ErrorRecord $_
    $rawResponse = Get-ResponseContentFromError -ErrorRecord $_
}
finally {
    $headers.Authorization = $null
    $bearerToken = $null
}

Write-Host 'HTTP status:' -ForegroundColor Cyan
if ($statusCode) {
    Write-Host $statusCode
}
else {
    Write-Host 'No HTTP status returned.'
}
Write-Host ''

$parsedPayload = $null
if ($rawResponse) {
    try {
        $parsedPayload = $rawResponse | ConvertFrom-Json -Depth 20
    }
    catch {
        $parsedPayload = $null
    }
}

$summaryRows = @(ConvertTo-PlacementSummaryRows -Payload $parsedPayload)
if ($summaryRows.Count -gt 0) {
    Write-Host 'Parsed placement rows:' -ForegroundColor Cyan
    $summaryRows | Format-Table -AutoSize
    Write-Host ''
}

if (-not $SummaryOnly) {
    Write-Host 'Raw response:' -ForegroundColor Cyan
    if ($parsedPayload) {
        $parsedPayload | ConvertTo-Json -Depth 30
    }
    else {
        $rawResponse
    }
}

if ($statusCode -and ($statusCode -lt 200 -or $statusCode -gt 299)) {
    throw "Placement score REST call failed with HTTP status $statusCode. See raw response above."
}