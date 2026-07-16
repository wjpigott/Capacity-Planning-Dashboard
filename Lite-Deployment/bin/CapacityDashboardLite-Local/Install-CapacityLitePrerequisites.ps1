[CmdletBinding()]
param(
    [switch]$SkipAzureModules
)

$ErrorActionPreference = 'Stop'

function Test-Command {
    param([Parameter(Mandatory)][string]$Name)

    return [bool](Get-Command -Name $Name -ErrorAction SilentlyContinue)
}

function Update-ProcessPath {
    $pathEntries = @(
        $env:Path
        [Environment]::GetEnvironmentVariable('Path', 'Machine')
        [Environment]::GetEnvironmentVariable('Path', 'User')
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_ -split ';' }

    $env:Path = ($pathEntries | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique) -join ';'
}

function Install-WingetPackage {
    param(
        [Parameter(Mandatory)][string]$PackageId,
        [Parameter(Mandatory)][string]$DisplayName,
        [Parameter(Mandatory)][string]$DownloadUrl,
        [switch]$AllowExistingPackage
    )

    if (-not (Test-Command -Name 'winget')) {
        throw "$DisplayName is required, but Windows Package Manager (winget) is not available. Install it from $DownloadUrl, then run this script again."
    }

    Write-Host "Installing $DisplayName..." -ForegroundColor Cyan
    & winget install --id $PackageId --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        if (-not $AllowExistingPackage) {
            throw "winget could not install $DisplayName. Install it from $DownloadUrl, then run this script again."
        }

        Write-Host "$DisplayName may already be installed; validating it next..." -ForegroundColor Yellow
    }

    Update-ProcessPath
}

function Test-AzModuleRequirement {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$RequiredMajorVersion
    )

    $installedModule = Get-Module -ListAvailable -Name $Name |
        Where-Object { $_.Version.Major -eq [int]$RequiredMajorVersion } |
        Sort-Object Version -Descending |
        Select-Object -First 1

    return $null -ne $installedModule
}

function Install-AzModuleRequirement {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$RequiredMajorVersion
    )

    if (Test-AzModuleRequirement -Name $Name -RequiredMajorVersion $RequiredMajorVersion) {
        Write-Host "$Name $RequiredMajorVersion.x is already installed." -ForegroundColor DarkGreen
        return
    }

    Write-Host "Installing $Name $RequiredMajorVersion.x from PowerShell Gallery..." -ForegroundColor Cyan
    if (Get-Command -Name Install-PSResource -ErrorAction SilentlyContinue) {
        Install-PSResource -Name $Name -Version "$RequiredMajorVersion.*" -Scope CurrentUser -Repository PSGallery -TrustRepository
    }
    else {
        $galleryModule = Find-Module -Name $Name -AllVersions -Repository PSGallery |
            Where-Object { $_.Version.Major -eq [int]$RequiredMajorVersion } |
            Sort-Object Version -Descending |
            Select-Object -First 1
        if ($null -eq $galleryModule) {
            throw "PowerShell Gallery does not offer $Name $RequiredMajorVersion.x."
        }

        Install-Module -Name $Name -RequiredVersion $galleryModule.Version.ToString() -Scope CurrentUser -Repository PSGallery -Force -AllowClobber
    }
}

function Update-NpmGlobalPath {
    $npmGlobalPrefix = (& npm config get prefix 2>$null).Trim()
    $candidatePaths = @(
        $npmGlobalPrefix
        (Join-Path $env:APPDATA 'npm')
        (Join-Path $env:LOCALAPPDATA 'npm')
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -Unique

    if ($candidatePaths) {
        $env:Path = "$($candidatePaths -join ';');$env:Path"
    }
}

Write-Host ''
Write-Host 'Capacity Dashboard Lite prerequisite check' -ForegroundColor Cyan
Write-Host ''

if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Host 'PowerShell 7 is not running.' -ForegroundColor Yellow
    Install-WingetPackage -PackageId 'Microsoft.PowerShell' -DisplayName 'PowerShell 7' -DownloadUrl 'https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows'
    Write-Host 'PowerShell 7 was installed. Open PowerShell 7 and run this script again to complete the remaining checks.' -ForegroundColor Yellow
    exit 0
}

if (Test-Command -Name 'dotnet') {
    $dotnetSdkVersions = @(& dotnet --list-sdks 2>$null)
    $hasSupportedDotnetSdk = $LASTEXITCODE -eq 0 -and ($dotnetSdkVersions | Where-Object { $_ -match '^(?:[8-9]|[1-9][0-9]+)\.' })
    if (-not $hasSupportedDotnetSdk) {
        Install-WingetPackage -PackageId 'Microsoft.DotNet.SDK.8' -DisplayName '.NET 8 SDK' -DownloadUrl 'https://dotnet.microsoft.com/download/dotnet/8.0' -AllowExistingPackage
    }
}
else {
    Install-WingetPackage -PackageId 'Microsoft.DotNet.SDK.8' -DisplayName '.NET 8 SDK' -DownloadUrl 'https://dotnet.microsoft.com/download/dotnet/8.0' -AllowExistingPackage
}

if (-not (Test-Command -Name 'dotnet')) {
    throw '.NET 8 SDK was installed but dotnet.exe is not available in this PowerShell session. Close PowerShell, open a new PowerShell 7 window, then run this script again.'
}

$dotnetSdkVersions = @(& dotnet --list-sdks 2>$null)
$hasSupportedDotnetSdk = $LASTEXITCODE -eq 0 -and ($dotnetSdkVersions | Where-Object { $_ -match '^(?:[8-9]|[1-9][0-9]+)\.' })
if (-not $hasSupportedDotnetSdk) {
    throw 'A .NET 8 SDK or later is required for PowerShell Functions. The installed dotnet command does not expose a compatible SDK.'
}

$dotnetVersion = (& dotnet --version).Trim()
Write-Host ".NET SDK $dotnetVersion is available." -ForegroundColor DarkGreen

if (-not (Test-Command -Name 'node') -or -not (Test-Command -Name 'npm')) {
    Install-WingetPackage -PackageId 'OpenJS.NodeJS.LTS' -DisplayName 'Node.js LTS' -DownloadUrl 'https://nodejs.org/en/download'
}

if (-not (Test-Command -Name 'node') -or -not (Test-Command -Name 'npm')) {
    throw 'Node.js LTS was installed but node.exe or npm.cmd is not available in this PowerShell session. Close PowerShell, open a new PowerShell 7 window, then run this script again.'
}

Write-Host "Node.js $(node --version) and npm $(npm --version) are available." -ForegroundColor DarkGreen

if (Test-Command -Name 'func') {
    Write-Host 'Azure Functions Core Tools v4 is already available.' -ForegroundColor DarkGreen
}
else {
    Write-Host 'Installing Azure Functions Core Tools v4 with npm...' -ForegroundColor Cyan
    & npm install --global azure-functions-core-tools@4 --unsafe-perm true --loglevel=error --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        throw 'npm could not install Azure Functions Core Tools v4. Install it from https://learn.microsoft.com/azure/azure-functions/functions-run-local, then run this script again.'
    }

    Update-ProcessPath
    Update-NpmGlobalPath
}

if (-not (Test-Command -Name 'func')) {
    throw 'Azure Functions Core Tools v4 was installed but func.cmd is not available in this PowerShell session. Close PowerShell, open a new PowerShell 7 window, then run this script again.'
}

Write-Host "Azure Functions Core Tools $(& func --version) is available." -ForegroundColor DarkGreen

if (Test-Command -Name 'azurite') {
    Write-Host 'Azurite is already available.' -ForegroundColor DarkGreen
}
else {
    if (-not (Test-Command -Name 'npm')) {
        throw 'Node.js/npm is not available in this PowerShell session after installation. Close PowerShell 7, open a new window, and run this script again.'
    }

    Write-Host 'Installing Azurite with npm...' -ForegroundColor Cyan
    & npm install --global azurite --loglevel=error --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        throw 'npm could not install Azurite. Install it from https://learn.microsoft.com/azure/storage/common/storage-use-azurite, then run this script again.'
    }

    Update-ProcessPath
    Update-NpmGlobalPath
}

if (-not (Test-Command -Name 'azurite')) {
    throw 'Azurite was installed but azurite.cmd is not available in this PowerShell session. Close PowerShell, open a new PowerShell 7 window, then run this script again.'
}

Write-Host "Azurite $(& azurite --version) is available." -ForegroundColor DarkGreen

if (-not $SkipAzureModules) {
    Install-AzModuleRequirement -Name 'Az.Accounts' -RequiredMajorVersion '3'
    Install-AzModuleRequirement -Name 'Az.Compute' -RequiredMajorVersion '9'
    Install-AzModuleRequirement -Name 'Az.Storage' -RequiredMajorVersion '8'
}

Write-Host ''
Write-Host 'Local software prerequisites are installed or available.' -ForegroundColor Green
Write-Host 'Azure access still requires a customer-provisioned identity with Reader and Compute Recommendations Role on every subscription or management group that will be scanned.' -ForegroundColor Yellow
Write-Host 'Open a new PowerShell 7 window if .NET, Node.js, Functions Core Tools, or Azurite were installed during this run, then run .\Configure-CapacityLite.ps1.' -ForegroundColor Cyan