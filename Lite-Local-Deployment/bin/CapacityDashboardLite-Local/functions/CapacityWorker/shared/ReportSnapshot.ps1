function Get-ReportSnapshotRegions {
    $scope = Get-CapacityReportScope
    $savedRegions = @($scope.captureRegions)
    if ($savedRegions.Count -gt 0) {
        return $savedRegions
    }

    $configuredRegions = [string]$env:CAPACITY_REPORT_REGIONS
    if (-not [string]::IsNullOrWhiteSpace($configuredRegions)) {
        return @($configuredRegions -split ',' | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ } | Select-Object -Unique)
    }

    return @('eastus', 'eastus2', 'centralus', 'westus', 'westus2', 'westus3')
}

function Get-ReportSnapshotSubscriptionIds {
    param([hashtable]$Caches = @{})

    $scope = Get-CapacityReportScope
    $subscriptionIds = @($scope.subscriptionIds)
    $managementGroups = @($scope.managementGroupNames)

    if ($managementGroups.Count -gt 0) {
        $token = Get-AzAccessToken -ResourceUrl 'https://management.azure.com' -ErrorAction Stop
        $headers = @{ Authorization = "Bearer $($token.Token)" }
        foreach ($managementGroup in $managementGroups) {
            $nextLink = "https://management.azure.com/providers/Microsoft.Management/managementGroups/$([uri]::EscapeDataString($managementGroup))/descendants?api-version=2020-05-01"
            while ($nextLink) {
                $page = Invoke-RestMethod -Method Get -Uri $nextLink -Headers $headers -ErrorAction Stop
                foreach ($entry in @($page.value)) {
                    $entryId = [string]$entry.id
                    if ($entryId -match '/subscriptions/([0-9a-fA-F-]{36})(?:/|$)') {
                        $subscriptionIds += $matches[1]
                    }
                }
                $nextLink = $page.nextLink
            }
        }
    }

    $resolved = @($subscriptionIds | Select-Object -Unique)
    if ($resolved.Count -gt 0) {
        return $resolved
    }

    if ($Caches.CurrentSubscriptionId) {
        return @([string]$Caches.CurrentSubscriptionId)
    }

    throw 'Configure CAPACITY_SUBSCRIPTION_ID or CAPACITY_MANAGEMENT_GROUP_NAMES for report snapshots.'
}

function Get-ReportSnapshotStorageContext {
    $storageAccountName = [string]($env:CAPACITY_SNAPSHOT_STORAGE_ACCOUNT ?? $env:AzureWebJobsStorage__accountName)
    if ([string]::IsNullOrWhiteSpace($storageAccountName)) {
        throw 'CAPACITY_SNAPSHOT_STORAGE_ACCOUNT or AzureWebJobsStorage__accountName must be configured for report snapshots.'
    }

    return New-AzStorageContext -StorageAccountName $storageAccountName -UseConnectedAccount -ErrorAction Stop
}

function Use-LocalReportSnapshotStorage {
    $mode = [string]$env:CAPACITY_SNAPSHOT_STORAGE_MODE
    return $mode.Trim().ToLowerInvariant() -in @('local', 'filesystem', 'file')
}

function Get-LocalReportSnapshotDataPath {
    $configuredPath = [string]$env:CAPACITY_SNAPSHOT_LOCAL_PATH
    if (-not [string]::IsNullOrWhiteSpace($configuredPath)) {
        return [System.IO.Path]::GetFullPath([System.Environment]::ExpandEnvironmentVariables($configuredPath))
    }

    return Join-Path (Split-Path $PSScriptRoot -Parent) 'data'
}

function Get-LocalReportSnapshotFilePath {
    param([Parameter(Mandatory)][string]$FileName)

    $dataPath = Get-LocalReportSnapshotDataPath
    New-Item -ItemType Directory -Path $dataPath -Force -ErrorAction Stop | Out-Null
    return Join-Path $dataPath $FileName
}

function Get-ReportSnapshotContainerName {
    return 'capacity-report-snapshots'
}

function ConvertTo-ReportScopeList {
    param($Value)

    return @($Value | ForEach-Object { [string]$_ } | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
}

function New-CapacityReportScopeResponse {
    param(
        [Parameter(Mandatory)]$Scope,
        [string]$Source = 'admin-configured'
    )

    return [pscustomobject]@{
        subscriptionIds = @($Scope.subscriptionIds)
        managementGroupNames = @($Scope.managementGroupNames)
        captureRegions = @($Scope.captureRegions)
        updatedAtUtc = $Scope.updatedAtUtc
        source = $Source
    }
}

function Get-CapacityReportScope {
    if (Use-LocalReportSnapshotStorage) {
        $scopePath = Get-LocalReportSnapshotFilePath -FileName 'scope.json'
        if (Test-Path -LiteralPath $scopePath -PathType Leaf) {
            $saved = Get-Content -LiteralPath $scopePath -Raw | ConvertFrom-Json -ErrorAction Stop
            return New-CapacityReportScopeResponse -Scope ([pscustomobject]@{ subscriptionIds = ConvertTo-ReportScopeList $saved.subscriptionIds; managementGroupNames = ConvertTo-ReportScopeList $saved.managementGroupNames; captureRegions = ConvertTo-ReportScopeList $saved.captureRegions | ForEach-Object { $_.ToLowerInvariant() }; updatedAtUtc = $saved.updatedAtUtc })
        }

        return New-CapacityReportScopeResponse -Scope ([pscustomobject]@{ subscriptionIds = ConvertTo-ReportScopeList $env:CAPACITY_SUBSCRIPTION_ID; managementGroupNames = ConvertTo-ReportScopeList $env:CAPACITY_MANAGEMENT_GROUP_NAMES; captureRegions = ConvertTo-ReportScopeList $env:CAPACITY_REPORT_REGIONS | ForEach-Object { $_.ToLowerInvariant() }; updatedAtUtc = $null }) -Source 'deployment-configured'
    }

    $caches = @{}
    if (-not (Ensure-AzureContext -Caches $caches)) {
        throw ($caches.LastPlacementWarning ?? 'Azure context is unavailable for the capacity report scope.')
    }

    $context = Get-ReportSnapshotStorageContext
    $containerName = Get-ReportSnapshotContainerName
    $temporaryFile = Join-Path ([System.IO.Path]::GetTempPath()) "capacity-report-scope-$([guid]::NewGuid().ToString('N')).json"
    try {
        $blob = Get-AzStorageBlob -Container $containerName -Blob 'scope.json' -Context $context -ErrorAction SilentlyContinue
        if ($blob) {
            Get-AzStorageBlobContent -Container $containerName -Blob 'scope.json' -Destination $temporaryFile -Context $context -Force -ErrorAction Stop | Out-Null
            $saved = Get-Content -LiteralPath $temporaryFile -Raw | ConvertFrom-Json -ErrorAction Stop
            return New-CapacityReportScopeResponse -Scope ([pscustomobject]@{ subscriptionIds = ConvertTo-ReportScopeList $saved.subscriptionIds; managementGroupNames = ConvertTo-ReportScopeList $saved.managementGroupNames; captureRegions = ConvertTo-ReportScopeList $saved.captureRegions | ForEach-Object { $_.ToLowerInvariant() }; updatedAtUtc = $saved.updatedAtUtc })
        }
    }
    finally {
        Remove-Item -LiteralPath $temporaryFile -Force -ErrorAction SilentlyContinue
    }

    return New-CapacityReportScopeResponse -Scope ([pscustomobject]@{ subscriptionIds = ConvertTo-ReportScopeList $env:CAPACITY_SUBSCRIPTION_ID; managementGroupNames = ConvertTo-ReportScopeList $env:CAPACITY_MANAGEMENT_GROUP_NAMES; captureRegions = @(); updatedAtUtc = $null }) -Source 'deployment-configured'
}

function Set-CapacityReportScope {
    param([Parameter(Mandatory)]$Scope)

    $saved = New-CapacityReportScopeResponse -Scope ([pscustomobject]@{ subscriptionIds = ConvertTo-ReportScopeList $Scope.subscriptionIds; managementGroupNames = ConvertTo-ReportScopeList $Scope.managementGroupNames; captureRegions = ConvertTo-ReportScopeList $Scope.captureRegions | ForEach-Object { $_.ToLowerInvariant() }; updatedAtUtc = [DateTime]::UtcNow.ToString('o') })
    if ($saved.subscriptionIds.Count -eq 0 -and $saved.managementGroupNames.Count -eq 0) { throw 'Provide at least one subscription ID or management group name.' }

    if (Use-LocalReportSnapshotStorage) {
        $scopePath = Get-LocalReportSnapshotFilePath -FileName 'scope.json'
        $saved | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $scopePath -Encoding UTF8
        return $saved
    }

    $caches = @{}
    if (-not (Ensure-AzureContext -Caches $caches)) {
        throw ($caches.LastPlacementWarning ?? 'Azure context is unavailable for the capacity report scope.')
    }
    $context = Get-ReportSnapshotStorageContext
    $containerName = Ensure-ReportSnapshotContainer -Context $context
    $temporaryFile = Join-Path ([System.IO.Path]::GetTempPath()) "capacity-report-scope-$([guid]::NewGuid().ToString('N')).json"
    try {
        $saved | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $temporaryFile -Encoding UTF8
        Set-AzStorageBlobContent -File $temporaryFile -Container $containerName -Blob 'scope.json' -Context $context -Force -ErrorAction Stop | Out-Null
        return $saved
    }
    finally {
        Remove-Item -LiteralPath $temporaryFile -Force -ErrorAction SilentlyContinue
    }
}

function Ensure-ReportSnapshotContainer {
    param([Parameter(Mandatory)]$Context)

    $containerName = Get-ReportSnapshotContainerName
    $container = Get-AzStorageContainer -Name $containerName -Context $Context -ErrorAction SilentlyContinue
    if (-not $container) {
        $null = New-AzStorageContainer -Name $containerName -Context $Context -Permission Off -ErrorAction Stop
    }

    return $containerName
}

function ConvertFrom-ReportSnapshotJson {
    param([Parameter(Mandatory)][string]$Text)

    try {
        return $Text | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        $firstBrace = $Text.IndexOf('{')
        $lastBrace = $Text.LastIndexOf('}')
        if ($firstBrace -lt 0 -or $lastBrace -le $firstBrace) {
            throw 'Capacity scan returned no JSON snapshot payload.'
        }

        return $Text.Substring($firstBrace, $lastBrace - $firstBrace + 1) | ConvertFrom-Json -ErrorAction Stop
    }
}

function Get-CapacityReportSnapshot {
    if (Use-LocalReportSnapshotStorage) {
        $snapshotPath = Get-LocalReportSnapshotFilePath -FileName 'latest.json'
        if (-not (Test-Path -LiteralPath $snapshotPath -PathType Leaf)) {
            return $null
        }

        return Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json -ErrorAction Stop
    }

    $caches = @{}
    if (-not (Ensure-AzureContext -Caches $caches)) {
        throw ($caches.LastPlacementWarning ?? 'Azure context is unavailable for the capacity report snapshot.')
    }

    $context = Get-ReportSnapshotStorageContext
    $containerName = Get-ReportSnapshotContainerName
    $blobName = 'latest.json'
    $temporaryFile = Join-Path ([System.IO.Path]::GetTempPath()) "capacity-report-$([guid]::NewGuid().ToString('N')).json"

    try {
        $blob = Get-AzStorageBlob -Container $containerName -Blob $blobName -Context $context -ErrorAction SilentlyContinue
        if (-not $blob) {
            return $null
        }

        Get-AzStorageBlobContent -Container $containerName -Blob $blobName -Destination $temporaryFile -Context $context -Force -ErrorAction Stop | Out-Null
        return Get-Content -LiteralPath $temporaryFile -Raw | ConvertFrom-Json -ErrorAction Stop
    }
    finally {
        Remove-Item -LiteralPath $temporaryFile -Force -ErrorAction SilentlyContinue
    }
}

function New-CapacityReportSnapshot {
    $caches = @{}
    if (-not (Ensure-AzureContext -Caches $caches)) {
        throw ($caches.LastPlacementWarning ?? 'Azure context is unavailable for the capacity report snapshot.')
    }

    $regions = Get-ReportSnapshotRegions
    $snapshotSubscriptionIds = Get-ReportSnapshotSubscriptionIds -Caches $caches
    $sharedRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'shared'
    $scriptPath = Join-Path $sharedRoot 'Get-AzVMAvailability\Get-AzVMAvailability.ps1'
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
        throw "Capacity scan script not found at $scriptPath"
    }

    Push-Location (Split-Path $scriptPath -Parent)
    try {
        $rawOutput = (& $scriptPath -SubscriptionId $snapshotSubscriptionIds -Region $regions -JsonOutput -NoPrompt -SkipRegionValidation 2>&1 | Out-String).Trim()
    }
    finally {
        Pop-Location
    }

    if (-not $rawOutput) {
        throw 'Capacity scan returned no JSON output.'
    }

    $snapshot = ConvertFrom-ReportSnapshotJson -Text $rawOutput
    $snapshot | Add-Member -NotePropertyName snapshotCapturedAtUtc -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
    $snapshot | Add-Member -NotePropertyName snapshotRegions -NotePropertyValue @($regions) -Force
    $snapshot | Add-Member -NotePropertyName snapshotSubscriptionIds -NotePropertyValue $snapshotSubscriptionIds -Force

    if (Use-LocalReportSnapshotStorage) {
        $snapshotPath = Get-LocalReportSnapshotFilePath -FileName 'latest.json'
        $snapshot | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $snapshotPath -Encoding UTF8
    }
    else {
        $context = Get-ReportSnapshotStorageContext
        $containerName = Ensure-ReportSnapshotContainer -Context $context
        $temporaryFile = Join-Path ([System.IO.Path]::GetTempPath()) "capacity-report-$([guid]::NewGuid().ToString('N')).json"
        try {
            $snapshot | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temporaryFile -Encoding UTF8
            Set-AzStorageBlobContent -File $temporaryFile -Container $containerName -Blob 'latest.json' -Context $context -Force -ErrorAction Stop | Out-Null
        }
        finally {
            Remove-Item -LiteralPath $temporaryFile -Force -ErrorAction SilentlyContinue
        }
    }

    return $snapshot
}

function Get-PaaSDatabaseQuotaSnapshot {
    if (Use-LocalReportSnapshotStorage) {
        $snapshotPath = Get-LocalReportSnapshotFilePath -FileName 'paas-db-quota.json'
        if (-not (Test-Path -LiteralPath $snapshotPath -PathType Leaf)) {
            return $null
        }

        return Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json -ErrorAction Stop
    }

    $context = Get-ReportSnapshotStorageContext
    $blob = Get-AzStorageBlob -Container (Get-ReportSnapshotContainerName) -Blob 'paas-db-quota.json' -Context $context -ErrorAction SilentlyContinue
    if (-not $blob) {
        return $null
    }

    $temporaryFile = Join-Path ([System.IO.Path]::GetTempPath()) "capacity-paas-db-quota-$([guid]::NewGuid().ToString('N')).json"
    try {
        Get-AzStorageBlobContent -Container (Get-ReportSnapshotContainerName) -Blob 'paas-db-quota.json' -Destination $temporaryFile -Context $context -Force -ErrorAction Stop | Out-Null
        return Get-Content -LiteralPath $temporaryFile -Raw | ConvertFrom-Json -ErrorAction Stop
    }
    finally {
        Remove-Item -LiteralPath $temporaryFile -Force -ErrorAction SilentlyContinue
    }
}

function Save-PaaSDatabaseQuotaSnapshot {
    param([Parameter(Mandatory)]$Snapshot)

    if (Use-LocalReportSnapshotStorage) {
        $snapshotPath = Get-LocalReportSnapshotFilePath -FileName 'paas-db-quota.json'
        $Snapshot | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $snapshotPath -Encoding UTF8
        return
    }

    $context = Get-ReportSnapshotStorageContext
    $containerName = Ensure-ReportSnapshotContainer -Context $context
    $temporaryFile = Join-Path ([System.IO.Path]::GetTempPath()) "capacity-paas-db-quota-$([guid]::NewGuid().ToString('N')).json"
    try {
        $Snapshot | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $temporaryFile -Encoding UTF8
        Set-AzStorageBlobContent -File $temporaryFile -Container $containerName -Blob 'paas-db-quota.json' -Context $context -Force -ErrorAction Stop | Out-Null
    }
    finally {
        Remove-Item -LiteralPath $temporaryFile -Force -ErrorAction SilentlyContinue
    }
}