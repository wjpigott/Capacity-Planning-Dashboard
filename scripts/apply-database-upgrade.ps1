param(
    [Parameter(Mandatory = $true)][string]$SqlServer,
    [Parameter(Mandatory = $true)][string]$SqlDatabase,
    [Parameter(Mandatory = $false)][string]$SqlFile = 'sql/migrations/20260427-add-paas-availability-and-ui-settings.sql',
    [Parameter(Mandatory = $false)][ValidateSet('ActiveDirectoryAzCli', 'ActiveDirectoryDefault', 'ActiveDirectoryInteractive', 'ActiveDirectoryDeviceCode', 'ActiveDirectoryIntegrated')][string]$AuthenticationMethod = 'ActiveDirectoryAzCli',
    [Parameter(Mandatory = $false)][string]$EntraUser,
    [Parameter(Mandatory = $false)][string]$AppIdentityName
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$resolvedSqlFile = if ([System.IO.Path]::IsPathRooted($SqlFile)) {
    $SqlFile
}
else {
    Join-Path $repoRoot $SqlFile
}

if (-not (Test-Path $resolvedSqlFile)) {
    throw "SQL file not found: $resolvedSqlFile"
}

$sqlcmd = Get-Command sqlcmd -ErrorAction SilentlyContinue
if (-not $sqlcmd -and (Test-Path 'C:\Program Files\SqlCmd\sqlcmd.exe')) {
    $sqlcmd = @{ Source = 'C:\Program Files\SqlCmd\sqlcmd.exe' }
}

if (-not $sqlcmd) {
    throw 'sqlcmd is required to apply database upgrades. Install SQL tools first.'
}

$args = @(
    '-S', $SqlServer,
    '-d', $SqlDatabase,
    '--authentication-method', $AuthenticationMethod,
    '-C',
    '-b',
    '-i', $resolvedSqlFile
)

if (-not [string]::IsNullOrWhiteSpace($EntraUser)) {
    $args += @('-U', $EntraUser)
}

 $executionSqlFile = $resolvedSqlFile
 $tempSqlFile = $null

 if (-not [string]::IsNullOrWhiteSpace($AppIdentityName)) {
    $sqlContent = Get-Content -Path $resolvedSqlFile -Raw
    if ($sqlContent.Contains('__APP_IDENTITY_NAME__')) {
        $tempSqlFile = Join-Path $env:TEMP ("capdash-db-upgrade-{0}.sql" -f ([guid]::NewGuid().ToString('N')))
        $sqlContent = $sqlContent.Replace('__APP_IDENTITY_NAME__', $AppIdentityName.Replace("'", "''"))
        Set-Content -Path $tempSqlFile -Value $sqlContent -Encoding utf8
        $executionSqlFile = $tempSqlFile
    }
 }

 $args[$args.IndexOf('-i') + 1] = $executionSqlFile

Write-Host "Applying SQL file: $resolvedSqlFile" -ForegroundColor Cyan
Write-Host "Target: $SqlServer / $SqlDatabase" -ForegroundColor Cyan
if (-not [string]::IsNullOrWhiteSpace($AppIdentityName)) {
    Write-Host "App identity: $AppIdentityName" -ForegroundColor Cyan
}

try {
    & $sqlcmd.Source @args

    if ($LASTEXITCODE -ne 0) {
        $guidance = ''
        if ($AuthenticationMethod -eq 'ActiveDirectoryAzCli') {
            $guidance = " Azure CLI authentication failed. Retry with -AuthenticationMethod ActiveDirectoryInteractive or -AuthenticationMethod ActiveDirectoryDeviceCode."
        }

        throw "sqlcmd failed for '$resolvedSqlFile' with exit code $LASTEXITCODE.$guidance"
    }
}
finally {
    if ($tempSqlFile -and (Test-Path $tempSqlFile)) {
        Remove-Item $tempSqlFile -Force
    }
}

Write-Host 'Database upgrade completed successfully.' -ForegroundColor Green