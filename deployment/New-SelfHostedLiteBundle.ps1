[CmdletBinding()]
param(
    [string]$OutputPath = (Join-Path $PSScriptRoot 'bin')
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path $PSScriptRoot -Parent
$appPath = Join-Path $OutputPath 'app'

if (Test-Path -LiteralPath $appPath) {
    Remove-Item -LiteralPath $appPath -Recurse -Force
}

New-Item -ItemType Directory -Path $appPath -Force | Out-Null

function Copy-DeploymentItem {
    param(
        [Parameter(Mandatory)][string]$RelativePath
    )

    $sourcePath = Join-Path $repositoryRoot $RelativePath
    $destinationPath = Join-Path $appPath $RelativePath
    if (-not (Test-Path -LiteralPath $sourcePath)) {
        throw "Required deployment item was not found: $RelativePath"
    }

    $destinationParent = Split-Path $destinationPath -Parent
    New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Recurse -Force
}

@(
    'server.js',
    'sku-catalog.js',
    'package.json',
    'src',
    'react',
    'functions\CapacityWorker',
    'tools\Get-PaaSDatabaseQuotaReport.ps1',
    'docs\SELF-HOSTED-LITE.md'
) | ForEach-Object { Copy-DeploymentItem -RelativePath $_ }

Remove-Item -LiteralPath (Join-Path $appPath 'functions\CapacityWorker\local.settings.json') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $appPath 'react\main.js') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $appPath 'react\main.compiled.js.map') -Force -ErrorAction SilentlyContinue

@'
node_modules/
functions/CapacityWorker/local.settings.json
*.pfx
*.pem
*.key
data/
'@ | Set-Content -LiteralPath (Join-Path $appPath '.gitignore') -Encoding ASCII

Write-Host "Self-hosted Lite deployment bundle staged at: $appPath" -ForegroundColor Green