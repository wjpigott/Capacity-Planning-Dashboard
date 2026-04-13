param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$SkuNamesJson,

    [Parameter(Mandatory = $true)]
    [string]$RegionsJson,

    [ValidateRange(1, 1000)]
    [int]$DesiredCount = 1,

    [int]$MaxRetries = 3
)

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

$invokeWithRetryPath = Join-Path $RepoRoot 'AzVMAvailability\Private\Azure\Invoke-WithRetry.ps1'
$placementScoresPath = Join-Path $RepoRoot 'AzVMAvailability\Private\Azure\Get-PlacementScores.ps1'

if (-not (Test-Path -LiteralPath $invokeWithRetryPath -PathType Leaf)) {
    throw "Get-AzVMAvailability helper not found: $invokeWithRetryPath"
}

if (-not (Test-Path -LiteralPath $placementScoresPath -PathType Leaf)) {
    throw "Get-AzVMAvailability helper not found: $placementScoresPath"
}

. $invokeWithRetryPath
. $placementScoresPath

$scores = Get-PlacementScores -SkuNames $skuNames -Regions $regions -DesiredCount $DesiredCount -MaxRetries $MaxRetries -Caches @{}

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

$rows | ConvertTo-Json -Depth 4