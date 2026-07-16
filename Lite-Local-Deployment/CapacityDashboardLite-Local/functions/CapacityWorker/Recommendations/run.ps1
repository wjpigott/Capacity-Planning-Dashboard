using namespace System.Net
using namespace System.Diagnostics

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
    $totalStopwatch = [Stopwatch]::StartNew()
    $parseStopwatch = [Stopwatch]::StartNew()
    $body = if ($Request.Body -is [string]) { $Request.Body | ConvertFrom-Json } else { $Request.Body }
    $targetSku = [string]$body.targetSku
    $regions = @($body.regions)
    $topN = if ($null -ne $body.topN) { [int]$body.topN } else { 10 }
    $minScore = if ($null -ne $body.minScore) { [int]$body.minScore } else { 50 }
    $showPricing = [bool]$body.showPricing
    $showSpot = [bool]$body.showSpot
    $parseStopwatch.Stop()

    if (-not $targetSku) {
        throw 'Target SKU is required.'
    }
    if ($regions.Count -eq 0) {
        throw 'At least one region is required.'
    }

    $caches = @{}
    $contextStopwatch = [Stopwatch]::StartNew()
    $hasAzContext = Ensure-AzureContext -Caches $caches
    $contextStopwatch.Stop()
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
        SkipRegionValidation = $true
    }
    if ($showPricing) {
        $invokeArgs.ShowPricing = $true
    }
    if ($showSpot) {
        $invokeArgs.ShowSpot = $true
    }

    $scriptStopwatch = [Stopwatch]::StartNew()
    Push-Location $repoRoot
    try {
        $rawOutput = (& $scriptPath @invokeArgs 2>&1 | Out-String).Trim()
    }
    finally {
        Pop-Location
    }
    $scriptStopwatch.Stop()

    if (-not $rawOutput) {
        throw 'Worker recommendation script returned no output.'
    }

    $jsonParseStopwatch = [Stopwatch]::StartNew()
    $contract = ConvertFrom-MixedJsonText -Text $rawOutput
    $jsonParseStopwatch.Stop()
    if (-not $contract) {
        throw "Worker recommendation script returned invalid JSON. Output: $rawOutput"
    }

    $totalStopwatch.Stop()

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
                targetSku = $targetSku
                regionCount = $regions.Count
                timings = @{
                    totalMs = [math]::Round($totalStopwatch.Elapsed.TotalMilliseconds, 0)
                    requestParseMs = [math]::Round($parseStopwatch.Elapsed.TotalMilliseconds, 0)
                    azureContextMs = [math]::Round($contextStopwatch.Elapsed.TotalMilliseconds, 0)
                    scriptExecutionMs = [math]::Round($scriptStopwatch.Elapsed.TotalMilliseconds, 0)
                    jsonParseMs = [math]::Round($jsonParseStopwatch.Elapsed.TotalMilliseconds, 0)
                }
                output = @{
                    rawOutputLength = $rawOutput.Length
                }
                scriptDiagnostics = $contract.diagnostics
            }
        }
    })
}
catch {
    if ($totalStopwatch) {
        $totalStopwatch.Stop()
    }
    if ($parseStopwatch) {
        $parseStopwatch.Stop()
    }
    if ($contextStopwatch) {
        $contextStopwatch.Stop()
    }
    if ($scriptStopwatch) {
        $scriptStopwatch.Stop()
    }
    if ($jsonParseStopwatch) {
        $jsonParseStopwatch.Stop()
    }

    $detail = $_.Exception.Message
    if ($detail.Length -gt 3500) {
        $detail = $detail.Substring(0, 3500)
    }

    Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{
        StatusCode = [HttpStatusCode]::InternalServerError
        Body = @{
            ok = $false
            error = 'Failed to retrieve worker recommendations.'
            detail = "$detail | targetSku=$targetSku | regionCount=$($regions.Count) | topN=$topN | minScore=$minScore | showPricing=$showPricing | showSpot=$showSpot"
            diagnostics = @{
                executionMode = 'function-app'
                warning = $caches.LastPlacementWarning
                targetSku = $targetSku
                regionCount = $regions.Count
                timings = @{
                    totalMs = if ($totalStopwatch) { [math]::Round($totalStopwatch.Elapsed.TotalMilliseconds, 0) } else { $null }
                    requestParseMs = if ($parseStopwatch) { [math]::Round($parseStopwatch.Elapsed.TotalMilliseconds, 0) } else { $null }
                    azureContextMs = if ($contextStopwatch) { [math]::Round($contextStopwatch.Elapsed.TotalMilliseconds, 0) } else { $null }
                    scriptExecutionMs = if ($scriptStopwatch) { [math]::Round($scriptStopwatch.Elapsed.TotalMilliseconds, 0) } else { $null }
                    jsonParseMs = if ($jsonParseStopwatch) { [math]::Round($jsonParseStopwatch.Elapsed.TotalMilliseconds, 0) } else { $null }
                }
            }
        }
    })
}
