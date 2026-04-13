param(
    [Parameter(Mandatory = $true)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory = $true)]
    [string]$FunctionAppName,

    [string]$SourcePath = (Join-Path $PSScriptRoot '..\functions\CapacityWorker')
)

$resolvedSource = (Resolve-Path $SourcePath).Path
$zipPath = Join-Path $env:TEMP "$FunctionAppName-worker.zip"

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

Compress-Archive -Path (Join-Path $resolvedSource '*') -DestinationPath $zipPath -Force

az functionapp deployment source config-zip --resource-group $ResourceGroupName --name $FunctionAppName --src $zipPath --timeout 600