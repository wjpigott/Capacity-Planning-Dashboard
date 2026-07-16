using namespace System.Net

param($Request, $TriggerMetadata)

$sharedRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'shared'
. (Join-Path $sharedRoot 'PlacementHelpers.ps1')
. (Join-Path $sharedRoot 'ReportSnapshot.ps1')

if (-not (Test-WorkerAuthorized -Request $Request -SharedSecret $env:WORKER_SHARED_SECRET)) {
    Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{ StatusCode = [HttpStatusCode]::Unauthorized; Body = @{ ok = $false; error = 'Unauthorized worker request.' } })
    return
}

function Resolve-PaaSDatabaseQuotaWrapperPath {
    $workerRoot = Split-Path $PSScriptRoot -Parent
    $candidates = @(
        (Join-Path $sharedRoot 'Get-PaaSDatabaseQuotaReport.ps1'),
        (Join-Path $workerRoot '..\..\tools\Get-PaaSDatabaseQuotaReport.ps1')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    throw 'PaaS database quota scanner script was not found.'
}

try {
    if ($Request.Method -eq 'GET') {
        Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{ StatusCode = [HttpStatusCode]::OK; Body = @{ ok = $true; snapshot = Get-PaaSDatabaseQuotaSnapshot } })
        return
    }

    $body = if ($Request.Body -is [string] -and $Request.Body) { $Request.Body | ConvertFrom-Json } else { $Request.Body }
    $services = @($body.services | ForEach-Object { [string]$_ } | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
    if ($services.Count -eq 0) { $services = @('All') }
    $includeCapabilities = [bool]$body.includeCapabilities

    $caches = @{}
    if (-not (Ensure-AzureContext -Caches $caches)) {
        throw ($caches.LastPlacementWarning ?? 'Azure context is unavailable for the PaaS database quota snapshot.')
    }

    $subscriptionIds = Get-ReportSnapshotSubscriptionIds -Caches $caches
    $regions = Get-ReportSnapshotRegions
    $wrapperPath = Resolve-PaaSDatabaseQuotaWrapperPath
    $rawOutput = (& $wrapperPath -SubscriptionIdsJson ($subscriptionIds | ConvertTo-Json -Compress) -LocationsJson ($regions | ConvertTo-Json -Compress) -Services $services -IncludeCapabilities:$includeCapabilities 2>&1 | Out-String).Trim()
    $result = ConvertFrom-ReportSnapshotJson -Text $rawOutput

    $snapshot = [pscustomobject]@{
        capturedAtUtc = [DateTime]::UtcNow.ToString('o')
        rows = @($result.rows)
        summary = $result.summary
        metadata = $result.metadata
        requestedServices = @($services)
        requestedRegions = @($regions)
        requestedSubscriptions = @($subscriptionIds)
        includeCapabilities = $includeCapabilities
    }
    Save-PaaSDatabaseQuotaSnapshot -Snapshot $snapshot
    Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{ StatusCode = [HttpStatusCode]::OK; Body = @{ ok = $true; snapshot = $snapshot } })
}
catch {
    Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{ StatusCode = [HttpStatusCode]::InternalServerError; Body = @{ ok = $false; error = 'PaaS database quota snapshot failed.'; detail = $_.Exception.Message } })
}