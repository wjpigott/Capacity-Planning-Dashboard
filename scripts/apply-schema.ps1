param(
    [Parameter(Mandatory = $true)][string]$SqlServer,
    [Parameter(Mandatory = $true)][string]$SqlDatabase,
    [Parameter(Mandatory = $false)][string]$SqlUser,
    [Parameter(Mandatory = $false)][string]$SqlPassword,
    [Parameter(Mandatory = $false)][string]$EntraUser,
    [Parameter(Mandatory = $false)][switch]$UseEntra,
    [Parameter(Mandatory = $false)][string]$SchemaFile = './sql/schema.sql'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $SchemaFile)) {
    throw "Schema file not found: $SchemaFile"
}

$sqlcmd = Get-Command sqlcmd -ErrorAction SilentlyContinue
if (-not $sqlcmd) {
    throw 'sqlcmd is required to apply schema. Install SQL tools first.'
}

if ($UseEntra) {
    $args = @('-S', $SqlServer, '-d', $SqlDatabase, '-G', '-i', $SchemaFile)
    if (-not [string]::IsNullOrWhiteSpace($EntraUser)) {
        $args += @('-U', $EntraUser)
    }
    & sqlcmd @args
}
else {
    if ([string]::IsNullOrWhiteSpace($SqlUser) -or [string]::IsNullOrWhiteSpace($SqlPassword)) {
        throw 'For SQL authentication, provide both -SqlUser and -SqlPassword, or use -UseEntra.'
    }
    & sqlcmd -S $SqlServer -d $SqlDatabase -U $SqlUser -P $SqlPassword -i $SchemaFile
}

Write-Host 'Schema applied successfully.' -ForegroundColor Green
