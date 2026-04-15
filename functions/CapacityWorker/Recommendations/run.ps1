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

try {
    $body = if ($Request.Body -is [string]) { $Request.Body | ConvertFrom-Json } else { $Request.Body }
    $targetSku = [string]$body.targetSku
    $regions = @($body.regions)
    $topN = if ($null -ne $body.topN) { [int]$body.topN } else { 10 }
    $minScore = if ($null -ne $body.minScore) { [int]$body.minScore } else { 50 }
    $showPricing = [bool]$body.showPricing
    $showSpot = [bool]$body.showSpot

    if (-not $targetSku) {
        throw 'Target SKU is required.'
    }
    if ($regions.Count -eq 0) {
        throw 'At least one region is required.'
    }

    $caches = @{}
    $hasAzContext = Ensure-AzureContext -Caches $caches
    if (-not $hasAzContext) {
        throw ($caches.LastPlacementWarning ?? 'Azure context is unavailable in worker session.')
    }

    $repoRoot = Join-Path $sharedRoot 'Get-AzVMAvailability'
    $scriptPath = Join-Path $repoRoot 'Get-AzVMAvailability.ps1'
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
        throw "Worker recommendation script not found at $scriptPath"
    }

    $invokeArgs = @{
        Recommend = $targetSku
        Region = @($regions | ForEach-Object { $_.ToString().Trim().ToLower() } | Where-Object { $_ })
        TopN = $topN
        MinScore = $minScore
        JsonOutput = $true
        NoPrompt = $true
    }
    if ($showPricing) {
        $invokeArgs.ShowPricing = $true
    }
    if ($showSpot) {
        $invokeArgs.ShowSpot = $true
    }

    Push-Location $repoRoot
    try {
        $rawOutput = (& $scriptPath @invokeArgs 2>&1 | Out-String).Trim()
    }
    finally {
        Pop-Location
    }

    if (-not $rawOutput) {
        throw 'Worker recommendation script returned no output.'
    }

    $contract = ConvertFrom-MixedJsonText -Text $rawOutput
    if (-not $contract) {
        throw "Worker recommendation script returned invalid JSON. Output: $rawOutput"
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
                warning = $caches.LastPlacementWarning
                scriptPath = $scriptPath
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
            error = 'Failed to retrieve worker recommendations.'
            detail = $_.Exception.Message
        }
    })
}
