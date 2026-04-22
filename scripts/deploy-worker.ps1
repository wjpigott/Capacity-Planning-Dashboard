param(
    [Parameter(Mandatory = $true)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory = $true)]
    [string]$FunctionAppName,

    [string]$SourcePath = (Join-Path $PSScriptRoot '..\functions\CapacityWorker')
)

$resolvedSource = (Resolve-Path $SourcePath).Path
$zipPath = Join-Path $env:TEMP "$FunctionAppName-worker.zip"
$stagingPath = Join-Path $env:TEMP "$FunctionAppName-worker-staging"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$paasWrapperSource = Join-Path $repoRoot 'tools\Get-PaaSAvailabilityReport.ps1'
$paasRepoSource = Join-Path $repoRoot 'tools\Get-AzPaaSAvailability'

if (Test-Path $stagingPath) {
    Remove-Item $stagingPath -Recurse -Force
}

New-Item -ItemType Directory -Path $stagingPath | Out-Null
Copy-Item -Path (Join-Path $resolvedSource '*') -Destination $stagingPath -Recurse -Force

$workerSharedPath = Join-Path $stagingPath 'shared'
if (-not (Test-Path $workerSharedPath)) {
    New-Item -ItemType Directory -Path $workerSharedPath | Out-Null
}

if (Test-Path $paasWrapperSource) {
    Copy-Item -Path $paasWrapperSource -Destination (Join-Path $workerSharedPath 'Get-PaaSAvailabilityReport.ps1') -Force
}

if (Test-Path $paasRepoSource) {
    Copy-Item -Path $paasRepoSource -Destination (Join-Path $workerSharedPath 'Get-AzPaaSAvailability') -Recurse -Force
}

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

Compress-Archive -Path (Join-Path $stagingPath '*') -DestinationPath $zipPath -Force

az functionapp deployment source config-zip --resource-group $ResourceGroupName --name $FunctionAppName --src $zipPath --timeout 600