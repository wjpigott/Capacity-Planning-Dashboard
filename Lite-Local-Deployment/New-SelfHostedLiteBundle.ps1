[CmdletBinding()]
param(
    [string]$OutputPath = (Join-Path $PSScriptRoot 'bin')
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path $PSScriptRoot -Parent
$appPath = Join-Path $OutputPath 'CapacityDashboardLite-Local'
$legacyAppPath = Join-Path $OutputPath 'app'

if (Test-Path -LiteralPath $appPath) {
    Remove-Item -LiteralPath $appPath -Recurse -Force
}
if (Test-Path -LiteralPath $legacyAppPath) {
    Remove-Item -LiteralPath $legacyAppPath -Recurse -Force
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
    'package-lock.json',
    'Lite-Local-Deployment\Install-CapacityLitePrerequisites.ps1',
    'Lite-Local-Deployment\Configure-CapacityLite.ps1',
    'Lite-Local-Deployment\Start-CapacityLite.ps1',
    'src',
    'react',
    'functions\CapacityWorker',
    'tools\Get-PaaSDatabaseQuotaReport.ps1',
    'docs\SELF-HOSTED-LITE.pdf'
) | ForEach-Object { Copy-DeploymentItem -RelativePath $_ }

$packagedScriptPath = Join-Path $appPath 'Lite-Local-Deployment'
Move-Item -LiteralPath (Join-Path $packagedScriptPath 'Install-CapacityLitePrerequisites.ps1') -Destination (Join-Path $appPath 'Install-CapacityLitePrerequisites.ps1') -Force
Move-Item -LiteralPath (Join-Path $packagedScriptPath 'Configure-CapacityLite.ps1') -Destination (Join-Path $appPath 'Configure-CapacityLite.ps1') -Force
Move-Item -LiteralPath (Join-Path $packagedScriptPath 'Start-CapacityLite.ps1') -Destination (Join-Path $appPath 'Start-CapacityLite.ps1') -Force
Remove-Item -LiteralPath $packagedScriptPath -Force

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

Write-Host "Capacity Dashboard Lite Local bundle staged at: $appPath" -ForegroundColor Green