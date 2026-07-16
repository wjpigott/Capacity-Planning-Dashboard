[CmdletBinding()]
param(
    [string]$AppPath = $PSScriptRoot,
    [int]$DashboardPort = 3000
)

$ErrorActionPreference = 'Stop'

function Get-DotnetSdkRoot {
    $dotnetCommand = Get-Command -Name 'dotnet' -CommandType Application -ErrorAction SilentlyContinue
    $candidateExecutables = @(
        if ($dotnetCommand) { $dotnetCommand.Source }
        if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'dotnet\dotnet.exe' }
        if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'dotnet\dotnet.exe' }
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -Unique

    foreach ($dotnetExecutable in $candidateExecutables) {
        $sdkVersions = @(& $dotnetExecutable --list-sdks 2>$null)
        if ($LASTEXITCODE -eq 0 -and ($sdkVersions | Where-Object { $_ -match '^(?:[8-9]|[1-9][0-9]+)\.' })) {
            return Split-Path -Path $dotnetExecutable -Parent
        }
    }

    throw 'A .NET 8 SDK or later is required to start the PowerShell Functions worker. Run .\Install-CapacityLitePrerequisites.ps1, close all PowerShell windows, open a new PowerShell 7 window, and try again.'
}

$resolvedAppPath = (Resolve-Path -LiteralPath $AppPath).Path
$settingsPath = Join-Path $resolvedAppPath 'functions\CapacityWorker\local.settings.json'
if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) {
    throw "Lite has not been configured. Run .\Configure-CapacityLite.ps1 first. Missing: $settingsPath"
}

$settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
$workerSecret = [string]$settings.Values.WORKER_SHARED_SECRET
if ([string]::IsNullOrWhiteSpace($workerSecret) -or $workerSecret -eq 'replace-with-a-local-worker-secret') {
    throw 'The Lite worker shared secret is not configured. Run .\Configure-CapacityLite.ps1 again.'
}

foreach ($command in @('azurite', 'func', 'npm')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command '$command' was not found. Run .\Install-CapacityLitePrerequisites.ps1, then open a new PowerShell 7 window and try again."
    }
}

$dotnetSdkRoot = Get-DotnetSdkRoot
$workerPath = Join-Path $resolvedAppPath 'functions\CapacityWorker'
$workerCommand = "`$env:DOTNET_ROOT = '$dotnetSdkRoot'; `$env:Path = '$dotnetSdkRoot;' + `$env:Path; Set-Location -LiteralPath '$workerPath'; func start --port 7071 --host 127.0.0.1"
if ([string]::IsNullOrWhiteSpace([string]$settings.Values.CAPACITY_AZURE_AUTH_MODE)) {
    $workerCommand = "Connect-AzAccount; $workerCommand"
}
$dashboardCommand = "`$env:CAPACITY_DEPLOYMENT_PROFILE = 'lite'; `$env:CAPACITY_WORKER_BASE_URL = 'http://127.0.0.1:7071'; `$env:CAPACITY_WORKER_AUTH_MODE = 'shared-secret'; `$env:CAPACITY_WORKER_SHARED_SECRET = '$workerSecret'; `$env:AUTH_ENABLED = 'false'; `$env:PORT = '$DashboardPort'; Set-Location -LiteralPath '$resolvedAppPath'; npm start"

Write-Host 'Starting Azurite, Capacity Worker, and Capacity Dashboard in separate PowerShell windows...' -ForegroundColor Cyan
Start-Process pwsh -ArgumentList '-NoExit', '-Command', 'azurite'
Start-Process pwsh -ArgumentList '-NoExit', '-Command', $workerCommand
Start-Process pwsh -ArgumentList '-NoExit', '-Command', $dashboardCommand

Write-Host "Lite services are starting. Open http://127.0.0.1:$DashboardPort after the dashboard window reports it is listening." -ForegroundColor Green