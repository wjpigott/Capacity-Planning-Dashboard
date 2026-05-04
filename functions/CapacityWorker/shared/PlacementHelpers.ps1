function Test-WorkerAuthorized {
    param(
        $Request,
        [string]$SharedSecret
    )

    if (-not $SharedSecret) {
        return $true
    }

    $providedSecret = $Request.Headers.'x-capacity-worker-key'
    return $providedSecret -and $providedSecret -eq $SharedSecret
}

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
            $statusCode = if ($ex.Response) { $ex.Response.StatusCode.value__ } else { $null }
            $isRetryable = $statusCode -in 429, 500, 503 -or $ex.Message -match '429|500|503|Too Many Requests|Internal Server Error|Service Unavailable|timed?\s*out|connection.*reset|connection.*refused'
            if (-not $isRetryable -or $attempt -ge $MaxRetries) {
                throw
            }

            Start-Sleep -Seconds ([math]::Min([math]::Pow(2, $attempt), 15))
        }
    }
}

function Ensure-AzureContext {
    param(
        [System.Collections.IDictionary]$Caches = @{}
    )

    function Get-PreferredSubscriptionId {
        $explicit = @(
            [System.Environment]::GetEnvironmentVariable('CAPACITY_SUBSCRIPTION_ID'),
            [System.Environment]::GetEnvironmentVariable('AZURE_SUBSCRIPTION_ID'),
            [System.Environment]::GetEnvironmentVariable('ARM_SUBSCRIPTION_ID')
        ) | Where-Object { $_ } | Select-Object -First 1

        if ($explicit) {
            return $explicit
        }

        $websiteOwnerName = [System.Environment]::GetEnvironmentVariable('WEBSITE_OWNER_NAME')
        if ($websiteOwnerName -match '^[0-9a-fA-F-]{36}') {
            return $matches[0]
        }

        return $null
    }

    function Set-UsableSubscriptionContext {
        param([object]$Context)

        $preferredSubscriptionId = Get-PreferredSubscriptionId

        if ($preferredSubscriptionId -and (Get-Command -Name 'Set-AzContext' -ErrorAction SilentlyContinue)) {
            try {
                $preferredSubscription = $null
                if (Get-Command -Name 'Get-AzSubscription' -ErrorAction SilentlyContinue) {
                    $preferredSubscription = Get-AzSubscription -SubscriptionId $preferredSubscriptionId -ErrorAction Stop | Select-Object -First 1
                }

                if ($preferredSubscription) {
                    $null = Set-AzContext -SubscriptionId $preferredSubscription.Id -TenantId $preferredSubscription.TenantId -ErrorAction Stop
                    $Caches.CurrentSubscriptionId = $preferredSubscription.Id
                    $Caches.CurrentSubscriptionName = $preferredSubscription.Name
                    $Caches.LastPlacementWarning = $null
                    return $true
                }
            }
            catch {
            }
        }

        if ($Context -and $Context.Subscription -and $Context.Subscription.Id) {
            if (Get-Command -Name 'Set-AzContext' -ErrorAction SilentlyContinue) {
                try {
                    $null = Set-AzContext -SubscriptionId $Context.Subscription.Id -TenantId $Context.Tenant.Id -ErrorAction Stop
                }
                catch {
                }
            }

            $Caches.CurrentSubscriptionId = $Context.Subscription.Id
            $Caches.CurrentSubscriptionName = $Context.Subscription.Name
            $Caches.LastPlacementWarning = $null
            return $true
        }

        if (-not (Get-Command -Name 'Get-AzSubscription' -ErrorAction SilentlyContinue)) {
            return $false
        }

        try {
            $subscription = Get-AzSubscription -ErrorAction Stop | Select-Object -First 1
            if (-not $subscription -or -not $subscription.Id) {
                return $false
            }

            if (Get-Command -Name 'Set-AzContext' -ErrorAction SilentlyContinue) {
                $null = Set-AzContext -SubscriptionId $subscription.Id -TenantId $subscription.TenantId -ErrorAction Stop
            }

            $Caches.CurrentSubscriptionId = $subscription.Id
            $Caches.CurrentSubscriptionName = $subscription.Name
            $Caches.LastPlacementWarning = $null
            return $true
        }
        catch {
            $Caches.LastPlacementWarning = "Failed to set Azure subscription context: $($_.Exception.Message)"
            return $false
        }
    }

    if (-not (Get-Command -Name 'Get-AzContext' -ErrorAction SilentlyContinue)) {
        $Caches.LastPlacementWarning = 'Get-AzContext is not available in this PowerShell host.'
        return $false
    }

    try {
        $currentContext = Get-AzContext -ErrorAction SilentlyContinue
        if (Set-UsableSubscriptionContext -Context $currentContext) {
            return $true
        }
    }
    catch {
    }

    try {
        $null = Connect-AzAccount -Identity -ErrorAction Stop
        $Caches.LoginAttempted = $true
        $currentContext = Get-AzContext -ErrorAction SilentlyContinue
        if (Set-UsableSubscriptionContext -Context $currentContext) {
            return $true
        }
    }
    catch {
        $Caches.LoginAttempted = $true
        $Caches.LastPlacementWarning = "Managed identity sign-in failed: $($_.Exception.Message)"
        return $false
    }

    $Caches.LastPlacementWarning = 'Managed identity sign-in did not produce an Azure subscription context.'
    return $false
}

function Get-ArmAccessTokenValue {
    $tokenResult = Get-AzAccessToken -ResourceUrl 'https://management.azure.com/' -ErrorAction Stop
    $tokenValue = $tokenResult.Token

    if ($tokenValue -is [System.Security.SecureString]) {
        $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($tokenValue)
        try {
            return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        }
        finally {
            [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
    }

    return [string]$tokenValue
}

function Add-PlacementRowsToScoreMap {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Scores,

        [object[]]$PlacementRows
    )

    foreach ($row in @($PlacementRows)) {
        if ($null -eq $row) { continue }

        $sku = @($row.Sku, $row.sku, $row.SkuName, $row.VmSize, $row.ArmSkuName) | Where-Object { $_ } | Select-Object -First 1
        $region = @($row.Region, $row.region, $row.Location, $row.ArmRegionName) | Where-Object { $_ } | Select-Object -First 1
        $score = @($row.Score, $row.score, $row.PlacementScore, $row.AvailabilityScore) | Where-Object { $_ } | Select-Object -First 1

        if (-not $sku -or -not $region) { continue }

        $isAvailable = $null
        if ($null -ne $row.IsAvailable) { $isAvailable = [bool]$row.IsAvailable }
        elseif ($null -ne $row.isAvailable) { $isAvailable = [bool]$row.isAvailable }
        elseif ($null -ne $row.isQuotaAvailable) { $isAvailable = [bool]$row.isQuotaAvailable }

        $isRestricted = $null
        if ($null -ne $row.IsRestricted) { $isRestricted = [bool]$row.IsRestricted }
        elseif ($null -ne $row.isRestricted) { $isRestricted = [bool]$row.isRestricted }

        $Scores["$sku|$($region.ToString().ToLower())"] = [pscustomobject]@{
            Score        = if ($score) { $score.ToString() } else { 'N/A' }
            IsAvailable  = $isAvailable
            IsRestricted = $isRestricted
        }
    }
}

function Invoke-SpotPlacementScoreRest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SubscriptionId,

        [Parameter(Mandatory = $true)]
        [string]$AnchorRegion,

        [Parameter(Mandatory = $true)]
        [string[]]$SkuNames,

        [Parameter(Mandatory = $true)]
        [string[]]$Regions,

        [ValidateRange(1, 1000)]
        [int]$DesiredCount = 1,

        [switch]$IncludeAvailabilityZone,

        [int]$MaxRetries = 3
    )

    $encodedSubscriptionId = [System.Uri]::EscapeDataString($SubscriptionId)
    $encodedAnchorRegion = [System.Uri]::EscapeDataString($AnchorRegion)
    $uri = "https://management.azure.com/subscriptions/$encodedSubscriptionId/providers/Microsoft.Compute/locations/$encodedAnchorRegion/placementScores/spot/generate?api-version=2025-06-05"
    $body = @{
        desiredLocations = @($Regions)
        desiredSizes = @($SkuNames | ForEach-Object { @{ sku = $_ } })
        desiredCount = $DesiredCount
    }

    if ($IncludeAvailabilityZone.IsPresent) {
        $body.availabilityZones = $true
    }

    $accessToken = Get-ArmAccessTokenValue
    return Invoke-WithRetry -MaxRetries $MaxRetries -OperationName 'Spot Placement Score REST API' -ScriptBlock {
        Invoke-RestMethod `
            -Method Post `
            -Uri $uri `
            -Headers @{ Authorization = "Bearer $accessToken"; 'Content-Type' = 'application/json' } `
            -Body ($body | ConvertTo-Json -Depth 8 -Compress) `
            -ErrorAction Stop
    }
}

function Get-PlacementScores {
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSReviewUnusedParameter', 'DesiredCount', Justification = 'Used inside Invoke-WithRetry scriptblock closure')]
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSReviewUnusedParameter', 'IncludeAvailabilityZone', Justification = 'Used inside Invoke-WithRetry scriptblock closure')]
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
    if ($uniqueSkus.Count -gt 5) {
        Write-Verbose "Placement score: truncating from $($uniqueSkus.Count) to 5 SKUs (API limit)."
    }
    if ($uniqueRegions.Count -gt 8) {
        Write-Verbose "Placement score: truncating from $($uniqueRegions.Count) to 8 regions (API limit)."
    }
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

    $subscriptionId = @(
        $Caches.CurrentSubscriptionId,
        [System.Environment]::GetEnvironmentVariable('CAPACITY_SUBSCRIPTION_ID'),
        [System.Environment]::GetEnvironmentVariable('AZURE_SUBSCRIPTION_ID'),
        [System.Environment]::GetEnvironmentVariable('ARM_SUBSCRIPTION_ID')
    ) | Where-Object { $_ } | Select-Object -First 1

    if ($subscriptionId -and (Get-Command -Name 'Get-AzAccessToken' -ErrorAction SilentlyContinue)) {
        try {
            $restResponse = Invoke-SpotPlacementScoreRest -SubscriptionId $subscriptionId -AnchorRegion $anchorRegion -SkuNames $normalizedSkus -Regions $normalizedRegions -DesiredCount $DesiredCount -IncludeAvailabilityZone:$IncludeAvailabilityZone.IsPresent -MaxRetries $MaxRetries
            $restRows = @($restResponse.placementScores)
            if ($restRows.Count -gt 0) {
                Add-PlacementRowsToScoreMap -Scores $scores -PlacementRows $restRows
                $Caches.LastPlacementWarning = $null
                $Caches.LastPlacementTransport = 'arm-rest'
                return $scores
            }
        }
        catch {
            $Caches.LastPlacementRestError = $_.Exception.Message
        }
    }

    try {
        $response = Invoke-WithRetry -MaxRetries $MaxRetries -OperationName 'Spot Placement Score API' -ScriptBlock {
            Invoke-AzSpotPlacementScore -Location $anchorRegion -DesiredLocation $normalizedRegions -DesiredSize $desiredSizes -DesiredCount $DesiredCount -AvailabilityZone:$IncludeAvailabilityZone.IsPresent -ErrorAction Stop
        }
    }
    catch {
        $errorText = $_.Exception.Message
        $Caches.LastPlacementErrorType = $_.Exception.GetType().FullName
        $Caches.LastPlacementErrorRecord = ($_ | Out-String).Trim()
        $isForbidden = $errorText -match '403|forbidden|authorization|not authorized|insufficient privileges'
        if ($isForbidden) {
            $Caches.LastPlacementWarning = 'Live placement lookup skipped: missing permissions (Compute Recommendations Role).'
            return $scores
        }

        $Caches.LastPlacementWarning = "Live placement lookup failed: $errorText"
        return $scores
    }

    $placementRows = @()
    if ($null -eq $response) {
        return $scores
    }

    $responseRows = if ($response -is [System.Collections.IEnumerable] -and $response -isnot [string]) { @($response) } else { @($response) }

    foreach ($item in $responseRows) {
        if ($null -eq $item) { continue }

        if ($item.PSObject.Properties.Match('PlacementScore').Count -gt 0 -and $item.PlacementScore) {
            $placementRows += @($item.PlacementScore)
            continue
        }

        $placementRows += @($item)
    }

    foreach ($row in $placementRows) {
        Add-PlacementRowsToScoreMap -Scores $scores -PlacementRows @($row)
    }

    return $scores
}