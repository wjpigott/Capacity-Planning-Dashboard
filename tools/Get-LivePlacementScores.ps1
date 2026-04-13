param(
    [Parameter(Mandatory = $false)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$SkuNamesJson,

    [Parameter(Mandatory = $true)]
    [string]$RegionsJson,

    [ValidateRange(1, 1000)]
    [int]$DesiredCount = 1,

    [int]$MaxRetries = 3
)

function Invoke-WithRetry {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$ScriptBlock,

        [int]$MaxRetries = 3,

        [string]$OperationName = 'API call'
    )

    $attempt = 0
    while ($true) {
        try {
            return & $ScriptBlock
        }
        catch {
            $attempt++
            $ex = $_.Exception
            $isRetryable = $false
            $waitSeconds = [math]::Pow(2, $attempt)

            $statusCode = if ($ex.Response) { $ex.Response.StatusCode.value__ } else { $null }
            if ($statusCode -eq 429 -or $ex.Message -match '429|Too Many Requests') {
                $isRetryable = $true
                if ($ex.Response -and $ex.Response.Headers) {
                    $retryAfter = $ex.Response.Headers['Retry-After']
                    if ($retryAfter) {
                        $parsedSeconds = 0
                        $retryDate = [datetime]::MinValue
                        if ([int]::TryParse($retryAfter, [ref]$parsedSeconds)) {
                            $waitSeconds = [math]::Max(1, $parsedSeconds)
                        }
                        elseif ([datetime]::TryParseExact($retryAfter, 'R', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal -bor [System.Globalization.DateTimeStyles]::AdjustToUniversal, [ref]$retryDate)) {
                            $waitSeconds = [int][math]::Ceiling(($retryDate - [datetime]::UtcNow).TotalSeconds)
                            if ($waitSeconds -lt 1) { $waitSeconds = 1 }
                        }
                    }
                }
            }
            elseif ($statusCode -eq 500 -or $ex.Message -match '500|Internal Server Error|InternalServerError') {
                $isRetryable = $true
            }
            elseif ($statusCode -eq 503 -or $ex.Message -match '503|ServiceUnavailable|Service Unavailable') {
                $isRetryable = $true
            }
            elseif ($ex -is [System.Net.WebException] -or
                $ex -is [System.Net.Http.HttpRequestException] -or
                $ex.InnerException -is [System.Net.WebException] -or
                $ex.InnerException -is [System.Net.Http.HttpRequestException] -or
                $ex.Message -match 'timed?\s*out|connection.*reset|connection.*refused') {
                $isRetryable = $true
            }

            if (-not $isRetryable -or $attempt -ge $MaxRetries) {
                throw
            }

            $jitter = Get-Random -Minimum 0 -Maximum ([math]::Max(1, [int]($waitSeconds * 0.25)))
            $waitSeconds += $jitter
            Start-Sleep -Seconds $waitSeconds
        }
    }
}

function Get-PlacementScores {
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSReviewUnusedParameter', 'DesiredCount', Justification = 'Used inside Invoke-WithRetry scriptblock closure')]
    param(
        [Parameter(Mandatory)]
        [string[]]$SkuNames,

        [Parameter(Mandatory)]
        [string[]]$Regions,

        [ValidateRange(1, 1000)]
        [int]$DesiredCount = 1,

        [switch]$IncludeAvailabilityZone,

        [int]$MaxRetries = 3,

        [System.Collections.IDictionary]$Caches = @{}
    )

    $scores = @{}
    $uniqueSkus = @($SkuNames | Where-Object { $_ } | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
    $uniqueRegions = @($Regions | Where-Object { $_ } | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ } | Select-Object -Unique)
    $normalizedSkus = @($uniqueSkus | Select-Object -First 5)
    $normalizedRegions = @($uniqueRegions | Select-Object -First 8)

    if ($normalizedSkus.Count -eq 0 -or $normalizedRegions.Count -eq 0) {
        $Caches.LastPlacementWarning = 'No valid SKU or region values were provided to the live placement lookup.'
        return $scores
    }

    if (-not (Get-Command -Name 'Invoke-AzSpotPlacementScore' -ErrorAction SilentlyContinue)) {
        $Caches.LastPlacementWarning = 'Invoke-AzSpotPlacementScore is not available in this PowerShell host.'
        return $scores
    }

    $anchorRegion = $normalizedRegions[0]
    $desiredSizes = @($normalizedSkus | ForEach-Object {
        @{ sku = $_ }
    })

    try {
        $response = Invoke-WithRetry -MaxRetries $MaxRetries -OperationName 'Spot Placement Score API' -ScriptBlock {
            Invoke-AzSpotPlacementScore -Location $anchorRegion -DesiredLocation $normalizedRegions -DesiredSize $desiredSizes -DesiredCount $DesiredCount -AvailabilityZone:$IncludeAvailabilityZone.IsPresent -ErrorAction Stop
        }
    }
    catch {
        $errorText = $_.Exception.Message
        $isForbidden = $errorText -match '403|forbidden|authorization|not authorized|insufficient privileges'
        if ($isForbidden) {
            if (-not $Caches.PlacementWarned403) {
                $Caches.PlacementWarned403 = $true
            }
            $Caches.LastPlacementWarning = 'Live placement lookup skipped: missing permissions for Invoke-AzSpotPlacementScore.'
            return $scores
        }

        $Caches.LastPlacementWarning = "Live placement lookup failed inside Get-PlacementScores: $errorText"
        return $scores
    }

    $rows = @()
    if ($null -eq $response) {
        return $scores
    }

    $responseRows = if ($response -is [System.Collections.IEnumerable] -and $response -isnot [string]) { @($response) } else { @($response) }

    foreach ($item in $responseRows) {
        if ($null -eq $item) { continue }

        if ($item.PSObject.Properties.Match('PlacementScore').Count -gt 0 -and $item.PlacementScore) {
            $rows += @($item.PlacementScore)
            continue
        }

        $rows += @($item)
    }

    foreach ($row in $rows) {
        if ($null -eq $row) { continue }

        $sku = @($row.Sku, $row.SkuName, $row.VmSize, $row.ArmSkuName) | Where-Object { $_ } | Select-Object -First 1
        $region = @($row.Region, $row.Location, $row.ArmRegionName) | Where-Object { $_ } | Select-Object -First 1
        $score = @($row.Score, $row.PlacementScore, $row.AvailabilityScore) | Where-Object { $_ } | Select-Object -First 1

        if (-not $sku -or -not $region) { continue }

        $key = "$sku|$($region.ToString().ToLower())"
        $scores[$key] = [pscustomobject]@{
            Score        = if ($score) { $score.ToString() } else { 'N/A' }
            IsAvailable  = if ($null -ne $row.IsAvailable) { [bool]$row.IsAvailable } elseif ($null -ne $row.IsQuotaAvailable) { [bool]$row.IsQuotaAvailable } else { $null }
            IsRestricted = if ($null -ne $row.IsRestricted) { [bool]$row.IsRestricted } else { $null }
        }
    }

    return $scores
}

function Ensure-AzureContext {
    param(
        [System.Collections.IDictionary]$Caches = @{}
    )

    if (-not (Get-Command -Name 'Get-AzContext' -ErrorAction SilentlyContinue)) {
        $Caches.LastPlacementWarning = 'Get-AzContext is not available in this PowerShell host.'
        return $false
    }

    try {
        $currentContext = Get-AzContext -ErrorAction SilentlyContinue
        if ($currentContext -and $currentContext.Subscription) {
            return $true
        }
    }
    catch {
    }

    if (-not (Get-Command -Name 'Connect-AzAccount' -ErrorAction SilentlyContinue)) {
        $Caches.LastPlacementWarning = 'Connect-AzAccount is not available in this PowerShell host.'
        return $false
    }

    try {
        $null = Connect-AzAccount -Identity -ErrorAction Stop
        $Caches.LoginAttempted = $true
        $currentContext = Get-AzContext -ErrorAction SilentlyContinue
        if ($currentContext -and $currentContext.Subscription) {
            return $true
        }

        $Caches.LastPlacementWarning = 'Managed identity sign-in did not produce an Azure subscription context.'
        return $false
    }
    catch {
        $Caches.LoginAttempted = $true
        $Caches.LastPlacementWarning = "Managed identity sign-in failed: $($_.Exception.Message)"
        return $false
    }
}

$skuNames = @()
$regions = @()

if ($SkuNamesJson) {
    $skuNames = @((ConvertFrom-Json -InputObject $SkuNamesJson))
}

if ($RegionsJson) {
    $regions = @((ConvertFrom-Json -InputObject $RegionsJson))
}

if ($skuNames.Count -eq 0 -or $regions.Count -eq 0) {
    '[]'
    exit 0
}

$caches = @{}
$azComputeModules = @(Get-Module -ListAvailable Az.Compute | Select-Object -ExpandProperty Version | ForEach-Object { $_.ToString() })
$hasAzContext = Ensure-AzureContext -Caches $caches
$scores = Get-PlacementScores -SkuNames $skuNames -Regions $regions -DesiredCount $DesiredCount -MaxRetries $MaxRetries -Caches $caches

$rows = foreach ($entry in $scores.GetEnumerator()) {
    $parts = $entry.Key -split '\|', 2
    [pscustomobject]@{
        sku          = $parts[0]
        region       = $parts[1]
        score        = $entry.Value.Score
        isAvailable  = $entry.Value.IsAvailable
        isRestricted = $entry.Value.IsRestricted
    }
}

[pscustomobject]@{
    rows = @($rows)
    diagnostics = [pscustomobject]@{
        powerShellEdition = $PSVersionTable.PSEdition
        powerShellVersion = $PSVersionTable.PSVersion.ToString()
        placementCmdletAvailable = [bool](Get-Command -Name 'Invoke-AzSpotPlacementScore' -ErrorAction SilentlyContinue)
        azComputeModuleVersions = @($azComputeModules)
        hasAzContext = [bool]$hasAzContext
        loginAttempted = [bool]$caches.LoginAttempted
        warning = $caches.LastPlacementWarning
    }
} | ConvertTo-Json -Depth 6