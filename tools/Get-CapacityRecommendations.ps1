param(
    [Parameter(Mandatory = $false)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$TargetSku,

    [Parameter(Mandatory = $true)]
    [string]$RegionsJson,

    [ValidateRange(1, 25)]
    [int]$TopN = 10,

    [ValidateRange(0, 100)]
    [int]$MinScore = 50,

    [switch]$ShowPricing,

    [switch]$ShowSpot
)

function Initialize-AzureContext {
    $result = [pscustomobject]@{
        hasContext = $false
        loginAttempted = $false
        message = ''
    }

    if (-not (Get-Command -Name 'Get-AzContext' -ErrorAction SilentlyContinue)) {
        $result.message = 'Get-AzContext cmdlet is not available in this PowerShell host.'
        return $result
    }

    try {
        $ctx = Get-AzContext -ErrorAction SilentlyContinue
        if ($ctx -and $ctx.Subscription) {
            $result.hasContext = $true
            $result.message = "Using existing Azure context for subscription '$($ctx.Subscription.Id)'."
            return $result
        }
    }
    catch {
    }

    if (Get-Command -Name 'Connect-AzAccount' -ErrorAction SilentlyContinue) {
        try {
            $result.loginAttempted = $true
            $null = Connect-AzAccount -Identity -ErrorAction Stop
            $ctx = Get-AzContext -ErrorAction SilentlyContinue
            if ($ctx -and $ctx.Subscription) {
                $result.hasContext = $true
                $result.message = "Managed identity sign-in succeeded for subscription '$($ctx.Subscription.Id)'."
                return $result
            }
            $result.message = 'Managed identity sign-in completed, but no Azure subscription context is available.'
            return $result
        }
        catch {
            $result.message = "Managed identity sign-in failed: $($_.Exception.Message)"
            return $result
        }
    }

    $result.message = 'Connect-AzAccount cmdlet is not available in this PowerShell host.'
    return $result
}

function ConvertFrom-JsonArray {
    param([string]$JsonValue)

    if (-not $JsonValue) {
        return @()
    }

    function Normalize-RegionToken {
        param([string]$Value)

        return ($Value -replace '[\s_\-]', '').Trim().ToLower()
    }

    try {
        $parsed = ConvertFrom-Json -InputObject $JsonValue

        # ConvertFrom-Json may unwrap single-item arrays to a scalar string.
        if ($parsed -is [string]) {
            $normalized = Normalize-RegionToken -Value $parsed
            if ($normalized) {
                return @($normalized)
            }

            return @()
        }

        if ($parsed -is [System.Collections.IEnumerable]) {
            return @($parsed | ForEach-Object { Normalize-RegionToken -Value ($_.ToString()) } | Where-Object { $_ })
        }
    }
    catch {
        # Allow comma-separated fallback when JSON parsing fails.
        $fallback = @($JsonValue -split ',') | ForEach-Object { Normalize-RegionToken -Value $_ } | Where-Object { $_ }
        if ($fallback.Count -gt 0) {
            return @($fallback)
        }
    }

    return @()
}

function Get-CapacityRecommendationScriptPath {
    param(
        [string]$LocalRepoRoot
    )

    # The recommendation script requires the full repository structure (including AzVMAvailability module).
    # We use the local repo path directly for reliability and dependency resolution.
    $localScriptPath = Join-Path $LocalRepoRoot 'Get-AzVMAvailability.ps1'

    if (Test-Path -LiteralPath $localScriptPath -PathType Leaf) {
        return $localScriptPath
    }

    throw "Get-AzVMAvailability.ps1 not found at '$localScriptPath'. Ensure Get-AzVMAvailability repository is cloned at $LocalRepoRoot or set GET_AZ_VM_AVAILABILITY_ROOT environment variable to the correct location."
}

$regions = ConvertFrom-JsonArray -JsonValue $RegionsJson
if (-not $RepoRoot) {
    $RepoRoot = Join-Path $PSScriptRoot 'Get-AzVMAvailability'
}

$repoPath = Resolve-Path -Path $RepoRoot -ErrorAction SilentlyContinue
if (-not $repoPath) {
    # Repo not found at default path. Check if env var provides alternate location.
    $altRoot = [System.Environment]::GetEnvironmentVariable('GET_AZ_VM_AVAILABILITY_ROOT')
    if ($altRoot) {
        $repoPath = Resolve-Path -Path $altRoot -ErrorAction SilentlyContinue
    }
}

if (-not $repoPath) {
    # Backward compatibility for local dev layouts where repo is a sibling of dashboard.
    $legacyRoot = Join-Path $PSScriptRoot '..\..\Get-AzVMAvailability'
    $repoPath = Resolve-Path -Path $legacyRoot -ErrorAction SilentlyContinue
}

if (-not $repoPath) {
    throw "Get-AzVMAvailability repository root was not found. Tried bundled path '$RepoRoot', GET_AZ_VM_AVAILABILITY_ROOT, and legacy sibling path '..\\..\\Get-AzVMAvailability'."
}

# Get script path: tries GitHub, uses cache, falls back to local repo
$scriptPath = Get-CapacityRecommendationScriptPath -LocalRepoRoot $($repoPath.Path)

if (-not $TargetSku) {
    throw 'Target SKU is required.'
}

if ($regions.Count -eq 0) {
    throw 'At least one region is required.'
}

$contextStatus = Initialize-AzureContext
if (-not $contextStatus.hasContext) {
    throw "Azure context is required for recommendations but is unavailable. $($contextStatus.message)"
}

$regionsJson = $regions | ConvertTo-Json -Compress

# Invoke from the local repo directory so the script can find the AzVMAvailability module.
# Use a child pwsh process to prevent script-level `exit` from terminating this wrapper silently.
# The child script signs in with managed identity in-session so Azure context is guaranteed there.
$currentPwsh = (Get-Process -Id $PID).Path
$childRunnerPath = Join-Path ([System.IO.Path]::GetTempPath()) ("capacity-recommend-child-" + [guid]::NewGuid().ToString('N') + ".ps1")

$childRunnerContent = @'
param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptPath,

    [Parameter(Mandatory = $true)]
    [string]$TargetSku,

    [Parameter(Mandatory = $true)]
    [string]$RegionsJson,

    [Parameter(Mandatory = $true)]
    [int]$TopN,

    [Parameter(Mandatory = $true)]
    [int]$MinScore,

    [switch]$ShowPricing,

    [switch]$ShowSpot
)

$ErrorActionPreference = 'Stop'

if (Get-Command -Name 'Get-AzContext' -ErrorAction SilentlyContinue) {
    $ctx = Get-AzContext -ErrorAction SilentlyContinue
    if (-not ($ctx -and $ctx.Subscription)) {
        if (-not (Get-Command -Name 'Connect-AzAccount' -ErrorAction SilentlyContinue)) {
            throw 'Connect-AzAccount cmdlet is not available in child PowerShell session.'
        }

        $null = Connect-AzAccount -Identity -ErrorAction Stop
        $ctx = Get-AzContext -ErrorAction SilentlyContinue
        if (-not ($ctx -and $ctx.Subscription)) {
            throw 'Managed identity sign-in in child session did not produce an Azure subscription context.'
        }
    }
}

$regions = @()
if ($RegionsJson) {
    $regions = @((ConvertFrom-Json -InputObject $RegionsJson))
}

$invokeArgs = @{
    Recommend  = $TargetSku
    Region     = $regions
    TopN       = $TopN
    MinScore   = $MinScore
    JsonOutput = $true
    NoPrompt   = $true
}

if ($ShowPricing.IsPresent) {
    $invokeArgs.ShowPricing = $true
}

if ($ShowSpot.IsPresent) {
    $invokeArgs.ShowSpot = $true
}

$result = & $ScriptPath @invokeArgs 2>&1
$result | Out-String
'@

Set-Content -LiteralPath $childRunnerPath -Value $childRunnerContent -Encoding UTF8

$childArgs = @(
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    $childRunnerPath,
    '-ScriptPath',
    $scriptPath,
    '-TargetSku',
    $TargetSku,
    '-RegionsJson',
    $regionsJson,
    '-TopN',
    [string]$TopN,
    '-MinScore',
    [string]$MinScore
)

if ($ShowPricing.IsPresent) {
    $childArgs += '-ShowPricing'
}

if ($ShowSpot.IsPresent) {
    $childArgs += '-ShowSpot'
}

Push-Location $repoPath.Path
try {
    $output = & $currentPwsh @childArgs 2>&1
    $childExitCode = $LASTEXITCODE
}
finally {
    Pop-Location
    if (Test-Path -LiteralPath $childRunnerPath -PathType Leaf) {
        Remove-Item -LiteralPath $childRunnerPath -Force -ErrorAction SilentlyContinue
    }
}

$text = ($output | Out-String).Trim()

if (-not $text) {
    throw "Recommendation command produced no output. Child exit code: $childExitCode. Context message: $($contextStatus.message)"
}

try {
    $contract = $text | ConvertFrom-Json -ErrorAction Stop
}
catch {
    $firstBrace = $text.IndexOf('{')
    $lastBrace = $text.LastIndexOf('}')
    if ($firstBrace -lt 0 -or $lastBrace -le $firstBrace) {
        throw "Recommendation command did not return valid JSON. Output: $text"
    }

    $jsonSlice = $text.Substring($firstBrace, ($lastBrace - $firstBrace + 1))
    $contract = $jsonSlice | ConvertFrom-Json -ErrorAction Stop
}

$warnings = @($contract.warnings)
$result = [pscustomobject]@{
    schemaVersion      = $contract.schemaVersion
    mode               = $contract.mode
    generatedAt        = $contract.generatedAt
    minScore           = $contract.minScore
    topN               = $contract.topN
    pricingEnabled     = $contract.pricingEnabled
    placementEnabled   = $contract.placementEnabled
    spotPricingEnabled = $contract.spotPricingEnabled
    target             = $contract.target
    targetAvailability = @($contract.targetAvailability)
    recommendations    = @($contract.recommendations)
    warnings           = @($warnings)
    belowMinSpec       = @($contract.belowMinSpec)
}

$result | ConvertTo-Json -Depth 7
