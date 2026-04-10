param(
    [Parameter(Mandatory = $true)][string]$SqlServer,
    [Parameter(Mandatory = $true)][string]$SqlDatabase,
    [Parameter(Mandatory = $true)][string]$MigrationFile,
    [Parameter(Mandatory = $false)][string]$SqlUser,
    [Parameter(Mandatory = $false)][string]$SqlPassword,
    [Parameter(Mandatory = $false)][string]$EntraUser,
    [Parameter(Mandatory = $false)][switch]$UseEntra
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $MigrationFile)) {
    throw "Migration file not found: $MigrationFile"
}

$sqlcmd = Get-Command sqlcmd -ErrorAction SilentlyContinue
if (-not $sqlcmd -and (Test-Path 'C:\Program Files\SqlCmd\sqlcmd.exe')) {
    $sqlcmd = @{ Source = 'C:\Program Files\SqlCmd\sqlcmd.exe' }
}
if (-not $sqlcmd) {
    throw 'sqlcmd is required to apply migration files. Install SQL tools first.'
}

if ($UseEntra) {
    $args = @('-S', $SqlServer, '-d', $SqlDatabase, '-G', '-i', $MigrationFile)
    if (-not [string]::IsNullOrWhiteSpace($EntraUser)) {
        $args += @('-U', $EntraUser)
    }
    & $sqlcmd.Source @args
}
else {
    if ([string]::IsNullOrWhiteSpace($SqlUser) -or [string]::IsNullOrWhiteSpace($SqlPassword)) {
        throw 'For SQL authentication, provide both -SqlUser and -SqlPassword, or use -UseEntra.'
    }
    & $sqlcmd.Source -S $SqlServer -d $SqlDatabase -U $SqlUser -P $SqlPassword -i $MigrationFile
}

Write-Host 'Migration applied successfully.' -ForegroundColor Green
