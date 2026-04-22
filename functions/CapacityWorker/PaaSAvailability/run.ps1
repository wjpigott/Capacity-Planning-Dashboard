using namespace System.Net

param(
    $Request,
    $TriggerMetadata
)

$sharedRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'shared'
. (Join-Path $sharedRoot 'PlacementHelpers.ps1')

$sharedSecret = $env:WORKER_SHARED_SECRET
if (-not (Test-WorkerAuthorized -Request $Request -SharedSecret $sharedSecret)) {
    Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{
        StatusCode = [HttpStatusCode]::Unauthorized
        Body = @{ ok = $false; error = 'Unauthorized worker request.' }
    })
    return
}

function ConvertFrom-MixedJsonText {
    param([string]$Text)

    if (-not $Text) {
        return $null
    }

    try {
        return $Text | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
    }

    $firstBrace = $Text.IndexOf('{')
    $lastBrace = $Text.LastIndexOf('}')
    if ($firstBrace -lt 0 -or $lastBrace -le $firstBrace) {
        return $null
    }

    try {
        return $Text.Substring($firstBrace, ($lastBrace - $firstBrace + 1)) | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        return $null
    }
}

function Resolve-FirstExistingPath {
    param([string[]]$Candidates)

    foreach ($candidate in $Candidates) {
        if (-not $candidate) {
            continue
        }

        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    return $null
}

try {
    $body = if ($Request.Body -is [string]) { $Request.Body | ConvertFrom-Json } else { $Request.Body }
    $service = if ($body.service) { [string]$body.service } else { 'All' }
    $regions = @($body.regions)
    $regionPreset = if ($body.regionPreset) { [string]$body.regionPreset } else { $null }
    $edition = @($body.edition)
    $computeModel = if ($body.computeModel) { [string]$body.computeModel } else { $null }
    $sqlResourceType = if ($body.sqlResourceType) { [string]$body.sqlResourceType } else { 'SqlDatabase' }
    $includeDisabled = [bool]$body.includeDisabled
    $fetchPricing = [bool]$body.fetchPricing

    $workerRoot = Split-Path $PSScriptRoot -Parent
    $wrapperPath = Resolve-FirstExistingPath -Candidates @(
        (Join-Path $sharedRoot 'Get-PaaSAvailabilityReport.ps1'),
        (Join-Path $workerRoot '..\..\tools\Get-PaaSAvailabilityReport.ps1')
    )
    $repoRoot = Resolve-FirstExistingPath -Candidates @(
        (Join-Path $sharedRoot 'Get-AzPaaSAvailability'),
        (Join-Path $workerRoot '..\..\tools\Get-AzPaaSAvailability')
    )

    if (-not $wrapperPath) {
        throw 'Worker PaaS wrapper script was not found.'
    }
    if (-not $repoRoot) {
        throw 'Worker Get-AzPaaSAvailability repository was not found.'
    }

    $caches = @{}
    $hasAzContext = Ensure-AzureContext -Caches $caches
    if (-not $hasAzContext) {
        throw ($caches.LastPlacementWarning ?? 'Azure context is unavailable in worker session.')
    }

    $invokeArgs = @{
        RepoRoot = $repoRoot
        Service = $service
        SqlResourceType = $sqlResourceType
    }
    if ($regions.Count -gt 0) {
        $normalizedRegions = @($regions | Where-Object { $null -ne $_ } | ForEach-Object { $_.ToString().Trim().ToLower() } | Where-Object { $_ })
        if ($normalizedRegions.Count -gt 0) {
            $invokeArgs.RegionsJson = ($normalizedRegions | ConvertTo-Json -Compress)
        }
    }
    if ($regionPreset) {
        $invokeArgs.RegionPreset = $regionPreset
    }
    if ($edition.Count -gt 0) {
        $invokeArgs.Edition = @($edition | Where-Object { $null -ne $_ } | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })
    }
    if ($computeModel) {
        $invokeArgs.ComputeModel = $computeModel
    }
    if ($includeDisabled) {
        $invokeArgs.IncludeDisabled = $true
    }
    if ($fetchPricing) {
        $invokeArgs.FetchPricing = $true
    }

    $rawOutput = (& $wrapperPath @invokeArgs 2>&1 | Out-String).Trim()
    if (-not $rawOutput) {
        throw 'Worker PaaS availability script returned no output.'
    }

    $contract = ConvertFrom-MixedJsonText -Text $rawOutput
    if (-not $contract) {
        throw "Worker PaaS availability script returned invalid JSON. Output: $rawOutput"
    }

    Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{
        StatusCode = [HttpStatusCode]::OK
        Body = @{
            ok = $true
            result = $contract
            diagnostics = @{
                executionMode = 'function-app'
                powerShellEdition = $PSVersionTable.PSEdition
                powerShellVersion = $PSVersionTable.PSVersion.ToString()
                hasAzContext = [bool]$hasAzContext
                loginAttempted = [bool]$caches.LoginAttempted
                currentSubscriptionId = $caches.CurrentSubscriptionId
                currentSubscriptionName = $caches.CurrentSubscriptionName
                warning = $caches.LastPlacementWarning
                wrapperPath = $wrapperPath
                repoRoot = $repoRoot
            }
        }
    })
}
catch {
    Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{
        StatusCode = [HttpStatusCode]::InternalServerError
        Body = @{
            ok = $false
            error = 'Failed to retrieve worker PaaS availability.'
            detail = $_.Exception.Message
        }
    })
}