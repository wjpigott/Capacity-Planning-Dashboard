using namespace System.Net

param(
    $Request,
    $TriggerMetadata
)

$sharedHelperPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'shared/PlacementHelpers.ps1'
. $sharedHelperPath

$sharedSecret = $env:WORKER_SHARED_SECRET
if (-not (Test-WorkerAuthorized -Request $Request -SharedSecret $sharedSecret)) {
    Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{
        StatusCode = [HttpStatusCode]::Unauthorized
        Body = @{ ok = $false; error = 'Unauthorized worker request.' }
    })
    return
}

$body = if ($Request.Body -is [string]) { $Request.Body | ConvertFrom-Json } else { $Request.Body }
$skuNames = @($body.skus)
$regions = @($body.regions)
$desiredCount = if ($null -ne $body.desiredCount) { [int]$body.desiredCount } else { 1 }

$caches = @{}
$azComputeModules = @(Get-Module -ListAvailable Az.Compute | Select-Object -ExpandProperty Version | ForEach-Object { $_.ToString() })
$hasAzContext = Ensure-AzureContext -Caches $caches
$scores = Get-PlacementScores -SkuNames $skuNames -Regions $regions -DesiredCount $desiredCount -Caches $caches

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

Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{
    StatusCode = [HttpStatusCode]::OK
    Body = @{
        rows = @($rows)
        diagnostics = @{
            executionMode = 'function-app'
            powerShellEdition = $PSVersionTable.PSEdition
            powerShellVersion = $PSVersionTable.PSVersion.ToString()
            placementCmdletAvailable = [bool](Get-Command -Name 'Invoke-AzSpotPlacementScore' -ErrorAction SilentlyContinue)
            azComputeModuleVersions = @($azComputeModules)
            hasAzContext = [bool]$hasAzContext
            loginAttempted = [bool]$caches.LoginAttempted
            currentSubscriptionId = $caches.CurrentSubscriptionId
            warning = $caches.LastPlacementWarning
            transport = $caches.LastPlacementTransport
            restError = $caches.LastPlacementRestError
            errorType = $caches.LastPlacementErrorType
            errorRecord = $caches.LastPlacementErrorRecord
        }
    }
})