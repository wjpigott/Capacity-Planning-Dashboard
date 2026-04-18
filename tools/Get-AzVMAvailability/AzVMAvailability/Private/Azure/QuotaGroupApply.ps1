function ConvertTo-PlainTextQuotaToken {
    param([Parameter(Mandatory = $true)][object]$Token)

    if ($Token -is [System.Security.SecureString]) {
        return [System.Net.NetworkCredential]::new('', $Token).Password
    }

    return [string]$Token
}

function Get-QuotaManagedIdentityClientId {
    $candidateNames = @(
        'QUOTA_APPLY_MSI_CLIENT_ID',
        'QUOTA_WRITE_MSI_CLIENT_ID',
        'INGEST_MSI_CLIENT_ID',
        'AZURE_CLIENT_ID',
        'SQL_MSI_CLIENT_ID',
        'Sql__MsiClientId'
    )

    foreach ($name in $candidateNames) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            return $value.Trim()
        }
    }

    return $null
}

function Get-QuotaManagedIdentityResources {
    param([Parameter(Mandatory = $true)][string]$ArmUrl)

    $trimmed = $ArmUrl.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        return @('https://management.azure.com/')
    }

    $withSlash = $trimmed.TrimEnd('/') + '/'
    $withoutSlash = $trimmed.TrimEnd('/')

    return @($withSlash, $withoutSlash) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
}

function Invoke-QuotaManagedIdentityRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Endpoint,
        [Parameter(Mandatory = $true)][hashtable]$Headers,
        [Parameter(Mandatory = $true)][string]$Resource,
        [Parameter(Mandatory = $true)][string]$ApiVersion,
        [Parameter(Mandatory = $false)][string]$ClientId,
        [Parameter(Mandatory = $false)][string]$ClientIdParameterName = 'client_id'
    )

    $uriBuilder = [System.UriBuilder]::new($Endpoint)
    $queryParts = @(
        'resource=' + [System.Uri]::EscapeDataString($Resource),
        'api-version=' + [System.Uri]::EscapeDataString($ApiVersion)
    )
    if (-not [string]::IsNullOrWhiteSpace($ClientId)) {
        $queryParts += $ClientIdParameterName + '=' + [System.Uri]::EscapeDataString($ClientId)
    }
    $uriBuilder.Query = ($queryParts -join '&')

    return Invoke-RestMethod -Method GET -Uri $uriBuilder.Uri.AbsoluteUri -Headers $Headers -ErrorAction Stop
}

function Get-QuotaApiBearerTokenFromManagedIdentity {
    param([Parameter(Mandatory = $true)][string]$ArmUrl)

    $resources = @(Get-QuotaManagedIdentityResources -ArmUrl $ArmUrl)
    $clientId = Get-QuotaManagedIdentityClientId
    $requestErrors = @()

    if (-not [string]::IsNullOrWhiteSpace($env:IDENTITY_ENDPOINT) -and -not [string]::IsNullOrWhiteSpace($env:IDENTITY_HEADER)) {
        $headers = @{
            'X-IDENTITY-HEADER' = $env:IDENTITY_HEADER
            Metadata            = 'true'
        }

        foreach ($resource in $resources) {
            foreach ($candidateClientId in @($clientId, $null)) {
                if ([string]::IsNullOrWhiteSpace($candidateClientId) -and $candidateClientId -ne $null) {
                    continue
                }

                try {
                    $response = Invoke-QuotaManagedIdentityRequest -Endpoint $env:IDENTITY_ENDPOINT -Headers $headers -Resource $resource -ApiVersion '2019-08-01' -ClientId $candidateClientId -ClientIdParameterName 'client_id'
                    if (-not [string]::IsNullOrWhiteSpace($response.access_token)) {
                        return [string]$response.access_token
                    }
                }
                catch {
                    $clientIdLabel = if ([string]::IsNullOrWhiteSpace($candidateClientId)) { '<none>' } else { $candidateClientId }
                    $requestErrors += "IDENTITY_ENDPOINT resource=$resource clientId=${clientIdLabel}: $($_.Exception.Message)"
                }
            }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($env:MSI_ENDPOINT) -and -not [string]::IsNullOrWhiteSpace($env:MSI_SECRET)) {
        $headers = @{
            Secret   = $env:MSI_SECRET
            Metadata = 'true'
        }

        foreach ($resource in $resources) {
            foreach ($candidateClientId in @($clientId, $null)) {
                if ([string]::IsNullOrWhiteSpace($candidateClientId) -and $candidateClientId -ne $null) {
                    continue
                }

                try {
                    $response = Invoke-QuotaManagedIdentityRequest -Endpoint $env:MSI_ENDPOINT -Headers $headers -Resource $resource -ApiVersion '2017-09-01' -ClientId $candidateClientId -ClientIdParameterName 'clientid'
                    if (-not [string]::IsNullOrWhiteSpace($response.access_token)) {
                        return [string]$response.access_token
                    }
                }
                catch {
                    $clientIdLabel = if ([string]::IsNullOrWhiteSpace($candidateClientId)) { '<none>' } else { $candidateClientId }
                    $requestErrors += "MSI_ENDPOINT resource=$resource clientId=${clientIdLabel}: $($_.Exception.Message)"
                }
            }
        }
    }

    if ($requestErrors.Count -gt 0) {
        throw ($requestErrors -join ' | ')
    }

    return $null
}

function Get-QuotaApiBearerTokenFromAzureCli {
    param([Parameter(Mandatory = $true)][string]$ArmUrl)

    if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
        return $null
    }

    $token = (& az account get-access-token --resource $ArmUrl --query accessToken -o tsv 2>$null)
    if ([string]::IsNullOrWhiteSpace($token)) {
        return $null
    }

    return $token.Trim()
}

function Get-QuotaApiBearerToken {
    param([Parameter(Mandatory = $true)][string]$ArmUrl)

    $authErrors = @()

    if (-not (Get-Command Get-AzAccessToken -ErrorAction SilentlyContinue)) {
        try {
            Import-Module Az.Accounts -ErrorAction Stop | Out-Null
        }
        catch {
            $authErrors += "Import-Module Az.Accounts failed: $($_.Exception.Message)"
        }
    }

    if (Get-Command Get-AzAccessToken -ErrorAction SilentlyContinue) {
        try {
            $tokenResult = Get-AzAccessToken -ResourceUrl $ArmUrl -ErrorAction Stop
            return ConvertTo-PlainTextQuotaToken -Token $tokenResult.Token
        }
        catch {
            $authErrors += "Get-AzAccessToken failed: $($_.Exception.Message)"
        }
    }

    try {
        $managedIdentityToken = Get-QuotaApiBearerTokenFromManagedIdentity -ArmUrl $ArmUrl
        if (-not [string]::IsNullOrWhiteSpace($managedIdentityToken)) {
            return $managedIdentityToken
        }
    }
    catch {
        $authErrors += "Managed identity token request failed: $($_.Exception.Message)"
    }

    try {
        $azureCliToken = Get-QuotaApiBearerTokenFromAzureCli -ArmUrl $ArmUrl
        if (-not [string]::IsNullOrWhiteSpace($azureCliToken)) {
            return $azureCliToken
        }
    }
    catch {
        $authErrors += "Azure CLI token request failed: $($_.Exception.Message)"
    }

    if ($authErrors.Count -eq 0) {
        $authErrors += 'No supported Azure authentication method was available. Checked Get-AzAccessToken, App Service managed identity, and Azure CLI.'
    }

    throw ($authErrors -join ' | ')
}

function Invoke-QuotaApiRequest {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('GET', 'PUT', 'PATCH', 'DELETE')][string]$Method,
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$BearerToken,
        [Parameter(Mandatory = $false)][object]$Body
    )

    $headers = @{ Authorization = "Bearer $BearerToken" }
    if ($null -ne $Body) {
        return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 20) -ErrorAction Stop
    }

    return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -ErrorAction Stop
}

function Import-QuotaGroupMovePlan {
    param([Parameter(Mandatory = $true)][string]$ResolvedPlanFile)

    if (-not (Test-Path -LiteralPath $ResolvedPlanFile -PathType Leaf)) {
        throw "Plan file not found: $ResolvedPlanFile"
    }

    $rows = @(Import-Csv -Path $ResolvedPlanFile -ErrorAction Stop)
    if ($rows.Count -eq 0) {
        throw "Plan file is empty: $ResolvedPlanFile"
    }

    return $rows
}

function Invoke-QuotaGroupMoveApply {
    param(
        [Parameter(Mandatory = $true)][array]$PlanRows,
        [Parameter(Mandatory = $true)][string]$ResolvedPlanFile,
        [Parameter(Mandatory = $true)][string]$ResolvedReportPath,
        [Parameter(Mandatory = $true)][string]$ResolvedArmUrl,
        [Parameter(Mandatory = $true)][string]$ResolvedQuotaApiVersion,
        [Parameter(Mandatory = $true)][string]$ResolvedManagementGroup,
        [Parameter(Mandatory = $true)][string]$ResolvedQuotaGroupName,
        [Parameter(Mandatory = $true)][string]$BearerToken,
        [Parameter(Mandatory = $true)][int]$ResolvedMaxChanges,
        [Parameter(Mandatory = $true)][int]$ResolvedMaxRetries,
        [Parameter(Mandatory = $true)][bool]$SkipConfirmation,
        [Parameter(Mandatory = $false)][bool]$SuppressConsole = $false
    )

    $readyRows = @($PlanRows | Where-Object { $_.ReadyToApply -eq $true -or $_.ReadyToApply -eq 'True' })
    if ($readyRows.Count -eq 0) {
        if (-not $SuppressConsole) {
            Write-Warning "No plan rows are ReadyToApply. Skipping apply."
        }
        return [pscustomobject]@{
            PlanFile                = $ResolvedPlanFile
            ReportFile              = $null
            SubmittedChangeCount    = 0
            SubmittedRequestedCores = 0
            FailureCount            = 0
            Results                 = @()
        }
    }

    $rowsToApply = @($readyRows | Select-Object -First $ResolvedMaxChanges)
    if (-not $SkipConfirmation) {
        if (-not $SuppressConsole) {
            Write-Host "About to apply quota allocation changes for $($rowsToApply.Count) row(s) to group '$ResolvedQuotaGroupName' in management group '$ResolvedManagementGroup'." -ForegroundColor Yellow
        }
        $confirm = Read-Host "Type APPLY to continue"
        if ($confirm -ne 'APPLY') {
            throw "Quota-group apply canceled by user."
        }
    }

    if (-not (Test-Path -LiteralPath $ResolvedReportPath -PathType Container)) {
        New-Item -ItemType Directory -Path $ResolvedReportPath -Force | Out-Null
    }

    $applyResults = [System.Collections.Generic.List[PSCustomObject]]::new()
    $submittedChangeCount = 0
    $submittedRequestedCores = [double]0
    $grouped = $rowsToApply | Group-Object SubscriptionId, Region
    foreach ($g in $grouped) {
        $sample = $g.Group[0]
        $requestedCores = [double](@($g.Group | Measure-Object -Property SuggestedMovable -Sum).Sum)
        $patchBody = @{
            properties = @{
                value = @(
                    $g.Group | ForEach-Object {
                        @{
                            properties = @{
                                resourceName = ([string]$_.QuotaName).ToLowerInvariant()
                                limit        = [int64][math]::Round([double]$_.ProposedLimit, 0)
                            }
                        }
                    }
                )
            }
        }

        $patchUri = "$ResolvedArmUrl/providers/Microsoft.Management/managementGroups/$ResolvedManagementGroup/subscriptions/$($sample.SubscriptionId)/providers/Microsoft.Quota/groupQuotas/$ResolvedQuotaGroupName/resourceProviders/Microsoft.Compute/quotaAllocations/$($sample.Region)?api-version=$ResolvedQuotaApiVersion"

        try {
            [void](Invoke-WithRetry -ScriptBlock {
                    Invoke-QuotaApiRequest -Method PATCH -Uri $patchUri -BearerToken $BearerToken -Body $patchBody
                } -MaxRetries $ResolvedMaxRetries -OperationName "Quota group batch apply ($($sample.SubscriptionId)/$($sample.Region), $(@($g.Group).Count) families)")
            $submittedChangeCount += @($g.Group).Count
            $submittedRequestedCores += $requestedCores
            $applyResults.Add([pscustomobject]@{ SubscriptionId = $sample.SubscriptionId; Region = $sample.Region; QuotaName = '*batch*'; RowsSubmitted = @($g.Group).Count; RequestedCores = $requestedCores; Status = 'Submitted'; Error = '' })
        }
        catch {
            $batchError = $_.Exception.Message
            if (-not $SuppressConsole) {
                Write-Warning "Quota-group batch apply failed for subscription '$($sample.SubscriptionId)' region '$($sample.Region)'. Retrying each quota family individually. Error: $batchError"
            }
            $applyResults.Add([pscustomobject]@{ SubscriptionId = $sample.SubscriptionId; Region = $sample.Region; QuotaName = '*batch*'; RowsSubmitted = @($g.Group).Count; RequestedCores = $requestedCores; Status = 'BatchFailed'; Error = $batchError })

            foreach ($row in $g.Group) {
                $singleRequestedCores = [double]$row.SuggestedMovable
                $singlePatchBody = @{
                    properties = @{
                        value = @(
                            @{
                                properties = @{
                                    resourceName = ([string]$row.QuotaName).ToLowerInvariant()
                                    limit        = [int64][math]::Round([double]$row.ProposedLimit, 0)
                                }
                            }
                        )
                    }
                }

                try {
                    [void](Invoke-WithRetry -ScriptBlock {
                            Invoke-QuotaApiRequest -Method PATCH -Uri $patchUri -BearerToken $BearerToken -Body $singlePatchBody
                        } -MaxRetries $ResolvedMaxRetries -OperationName "Quota group single apply ($($sample.SubscriptionId)/$($sample.Region)/$([string]$row.QuotaName))")
                    $submittedChangeCount += 1
                    $submittedRequestedCores += $singleRequestedCores
                    $applyResults.Add([pscustomobject]@{ SubscriptionId = $sample.SubscriptionId; Region = $sample.Region; QuotaName = [string]$row.QuotaName; RowsSubmitted = 1; RequestedCores = $singleRequestedCores; Status = 'SubmittedSingle'; Error = '' })
                }
                catch {
                    $applyResults.Add([pscustomobject]@{ SubscriptionId = $sample.SubscriptionId; Region = $sample.Region; QuotaName = [string]$row.QuotaName; RowsSubmitted = 1; RequestedCores = $singleRequestedCores; Status = 'FailedSingle'; Error = $_.Exception.Message })
                }
            }
        }
    }

    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $applyFile = Join-Path $ResolvedReportPath "AzVMAvailability-QuotaGroupApply-$timestamp.csv"
    $applyResults | Export-Csv -Path $applyFile -NoTypeInformation -Encoding UTF8
    if (-not $SuppressConsole) {
        Write-Host "Quota-group apply report: $applyFile" -ForegroundColor Green
    }

    $failureCount = @($applyResults | Where-Object { $_.Status -in @('BatchFailed', 'FailedSingle') }).Count
    if ($submittedChangeCount -gt 0) {
        if (-not $SuppressConsole) {
            Write-Host ("Quota-group apply summary: submitted {0} change(s), requested move of {1} core(s) to group '{2}'." -f $submittedChangeCount, ([int64][math]::Round($submittedRequestedCores, 0)), $ResolvedQuotaGroupName) -ForegroundColor Green
        }
    }
    else {
        if (-not $SuppressConsole) {
            Write-Warning ("Quota-group apply summary: no quota changes were submitted for group '{0}'." -f $ResolvedQuotaGroupName)
        }
    }

    if ($failureCount -gt 0) {
        if (-not $SuppressConsole) {
            Write-Warning ("Quota-group apply summary: {0} submission batch(es) failed. See apply report for details." -f $failureCount)
        }
    }

    return [pscustomobject]@{
        PlanFile                = $ResolvedPlanFile
        ReportFile              = $applyFile
        SubmittedChangeCount    = $submittedChangeCount
        SubmittedRequestedCores = [int64][math]::Round($submittedRequestedCores, 0)
        FailureCount            = $failureCount
        Results                 = @($applyResults)
    }
}