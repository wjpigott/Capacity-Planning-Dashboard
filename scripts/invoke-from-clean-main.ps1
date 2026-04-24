param(
    [Parameter(Mandatory = $false)]
    [string]$Ref = 'github/main',

    [Parameter(Mandatory = $false)]
    [string]$ScriptRelativePath = 'scripts/deploy-infra.ps1',

    [Parameter(Mandatory = $false)]
    [string]$WorktreePath = (Join-Path ([System.IO.Path]::GetTempPath()) ("capacity-dashboard-clean-main-{0}" -f ([guid]::NewGuid().ToString('N')))),

    [Parameter(Mandatory = $false)]
    [switch]$SkipFetch,

    [Parameter(Mandatory = $false)]
    [switch]$KeepWorktree,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ForwardedArguments
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$resolvedScriptRelativePath = $ScriptRelativePath -replace '/', '\\'
$fetchRemote = $null
$fetchBranch = $null

if ($Ref -match '^(?<remote>[^/]+)/(?<branch>.+)$') {
    $fetchRemote = $matches.remote
    $fetchBranch = $matches.branch
}

if (Test-Path $WorktreePath) {
    throw "Worktree path already exists: $WorktreePath"
}

try {
    if (-not $SkipFetch -and $fetchRemote -and $fetchBranch) {
        Write-Host "Fetching latest $fetchRemote/$fetchBranch..."
        git -C $repoRoot fetch $fetchRemote $fetchBranch --quiet
        if ($LASTEXITCODE -ne 0) {
            throw "git fetch $fetchRemote $fetchBranch failed."
        }
    }

    Write-Host "Creating clean worktree at $WorktreePath for $Ref..."
    git -C $repoRoot worktree add --detach $WorktreePath $Ref
    if ($LASTEXITCODE -ne 0) {
        throw "git worktree add failed for ref $Ref"
    }

    $scriptPath = Join-Path $WorktreePath $resolvedScriptRelativePath
    if (-not (Test-Path $scriptPath)) {
        throw "Script not found in clean worktree: $scriptPath"
    }

    Write-Host "Running $resolvedScriptRelativePath from clean worktree..."
    & pwsh -NoProfile -File $scriptPath @ForwardedArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Deployment script failed with exit code $LASTEXITCODE"
    }
}
finally {
    if (-not $KeepWorktree -and (Test-Path $WorktreePath)) {
        Write-Host "Removing clean worktree $WorktreePath..."
        git -C $repoRoot worktree remove $WorktreePath --force | Out-Null
    }
}