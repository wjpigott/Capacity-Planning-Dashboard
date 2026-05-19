param(
    [Parameter(Mandatory = $true)][string]$SqlServer,
    [Parameter(Mandatory = $true)][string]$SqlDatabase,
    [Parameter(Mandatory = $true)][string]$AppIdentityName,
    [Parameter(Mandatory = $false)][string[]]$RuntimeRoles = @('db_datareader', 'db_datawriter'),
    [Parameter(Mandatory = $false)][switch]$GrantBootstrapRole,
    [Parameter(Mandatory = $false)][ValidateSet('ActiveDirectoryAzCli', 'ActiveDirectoryDefault', 'ActiveDirectoryInteractive', 'ActiveDirectoryDeviceCode', 'ActiveDirectoryIntegrated')][string]$AuthenticationMethod = 'ActiveDirectoryInteractive',
    [Parameter(Mandatory = $false)][string]$EntraUser
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$schemaFile = Join-Path $repoRoot 'sql\schema.sql'
$migrationFiles = Get-ChildItem (Join-Path $repoRoot 'sql\migrations\*.sql') | Sort-Object Name

$sqlcmd = Get-Command sqlcmd -ErrorAction SilentlyContinue
if (-not $sqlcmd -and (Test-Path 'C:\Program Files\SqlCmd\sqlcmd.exe')) {
    $sqlcmd = @{ Source = 'C:\Program Files\SqlCmd\sqlcmd.exe' }
}
if (-not $sqlcmd) {
    throw 'sqlcmd is required to initialize the database. Install SQL tools first.'
}

$sqlcmdHelp = (& $sqlcmd.Source '--help' 2>&1 | Out-String)
$supportsAuthenticationMethod = $sqlcmdHelp -match '--authentication-method'

function Get-SqlCmdAuthenticationArgs() {
    if ($supportsAuthenticationMethod) {
        return @('--authentication-method', $AuthenticationMethod)
    }

    if ($AuthenticationMethod -like 'ActiveDirectory*') {
        return @('-G')
    }

    throw "The installed sqlcmd does not support --authentication-method, and '$AuthenticationMethod' cannot be mapped to legacy sqlcmd arguments. Install the newer sqlcmd or use an ActiveDirectory* authentication method."
}

function Invoke-SqlCmdNative([string[]]$Arguments, [string]$Description) {
    $output = & $sqlcmd.Source @Arguments 2>&1
    $exitCode = $LASTEXITCODE

    if ($output) {
        $output | ForEach-Object { Write-Host $_ }
    }

    if ($exitCode -ne 0) {
        $outputText = ($output | Out-String).Trim()
        $guidance = ''
        if ($AuthenticationMethod -eq 'ActiveDirectoryAzCli') {
            $guidance = ' If Azure CLI authentication is not supported by this sqlcmd build, retry with -AuthenticationMethod ActiveDirectoryInteractive -EntraUser <your-upn>, or install the newer sqlcmd that supports --authentication-method ActiveDirectoryAzCli.'
        }

        if ([string]::IsNullOrWhiteSpace($outputText)) {
            throw "$Description failed with exit code $exitCode.$guidance"
        }

        throw "$Description failed with exit code $exitCode. sqlcmd output: $outputText$guidance"
    }

    return ($output | Out-String).Trim()
}

function Invoke-SqlCmdFile([string]$InputFile) {
    $args = @(
        '-S', $SqlServer,
        '-d', $SqlDatabase,
        '-C',
        '-b',
        '-i', $InputFile
    )

    $args += Get-SqlCmdAuthenticationArgs

    if (-not [string]::IsNullOrWhiteSpace($EntraUser)) {
        $args += @('-U', $EntraUser)
    }

    [void](Invoke-SqlCmdNative -Arguments $args -Description "sqlcmd file '$InputFile'")
}

function Invoke-SqlCmdQuery([string]$QueryText) {
    $tempFile = Join-Path $env:TEMP ("capdash-db-init-{0}.sql" -f ([guid]::NewGuid().ToString('N')))
    Set-Content -Path $tempFile -Value $QueryText -Encoding utf8
    try {
        Invoke-SqlCmdFile -InputFile $tempFile
    }
    finally {
        if (Test-Path $tempFile) {
            Remove-Item $tempFile -Force
        }
    }
}

function Invoke-SqlCmdQueryCapture([string]$QueryText) {
    $args = @(
        '-S', $SqlServer,
        '-d', $SqlDatabase,
        '-C',
        '-b',
        '-h', '-1',
        '-W',
        '-Q', $QueryText
    )

    $args += Get-SqlCmdAuthenticationArgs

    if (-not [string]::IsNullOrWhiteSpace($EntraUser)) {
        $args += @('-U', $EntraUser)
    }

    return Invoke-SqlCmdNative -Arguments $args -Description 'sqlcmd query'
}

function Test-DatabaseTableExists([string]$SchemaName, [string]$TableName) {
    $safeSchemaName = $SchemaName.Replace("'", "''")
    $safeTableName = $TableName.Replace("'", "''")
    $query = @"
SET NOCOUNT ON;
SELECT CASE
    WHEN OBJECT_ID(N'$safeSchemaName.$safeTableName', 'U') IS NULL THEN 0
    ELSE 1
END;
"@

    return (Invoke-SqlCmdQueryCapture -QueryText $query) -eq '1'
}

$normalizedRoles = [System.Collections.Generic.List[string]]::new()
foreach ($role in $RuntimeRoles) {
    $candidate = [string]$role
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        continue
    }

    $normalized = $candidate.Trim().ToLowerInvariant()
    if ($normalized -in @('db_datareader', 'db_datawriter', 'db_ddladmin') -and -not $normalizedRoles.Contains($normalized)) {
        $normalizedRoles.Add($normalized)
    }
}

if (-not $normalizedRoles.Contains('db_datareader')) {
    $normalizedRoles.Add('db_datareader')
}

if (-not $normalizedRoles.Contains('db_datawriter')) {
    $normalizedRoles.Add('db_datawriter')
}

if ($GrantBootstrapRole -and -not $normalizedRoles.Contains('db_ddladmin')) {
    $normalizedRoles.Add('db_ddladmin')
}

if (Test-DatabaseTableExists -SchemaName 'dbo' -TableName 'CapacitySnapshot') {
    Write-Host 'Skipping base schema because dbo.CapacitySnapshot already exists.'
}
else {
    Write-Host "Applying schema: $schemaFile"
    Invoke-SqlCmdFile -InputFile $schemaFile
}

foreach ($migration in $migrationFiles) {
    Write-Host "Applying migration: $($migration.Name)"
    Invoke-SqlCmdFile -InputFile $migration.FullName
}

$roleStatements = @()
$roleIndex = 0
foreach ($roleName in $normalizedRoles) {
    $varName = "@grantRoleSql$roleIndex"
    $roleStatements += @"
IF NOT EXISTS (
    SELECT 1
    FROM sys.database_role_members AS roleMembers
    INNER JOIN sys.database_principals AS rolePrincipal
        ON rolePrincipal.principal_id = roleMembers.role_principal_id
    INNER JOIN sys.database_principals AS memberPrincipal
        ON memberPrincipal.principal_id = roleMembers.member_principal_id
    WHERE rolePrincipal.name = N'$roleName'
      AND memberPrincipal.name = N'$AppIdentityName'
)
BEGIN
    DECLARE $varName NVARCHAR(4000) = N'ALTER ROLE $roleName ADD MEMBER ' + QUOTENAME(N'$AppIdentityName');
    EXEC sp_executesql $varName;
END;
"@
    $roleIndex++
}

$grantQuery = @"
IF NOT EXISTS (
    SELECT 1
    FROM sys.database_principals
    WHERE name = N'$AppIdentityName'
)
BEGIN
    DECLARE @createUserSql NVARCHAR(4000) = N'CREATE USER ' + QUOTENAME(N'$AppIdentityName') + N' FROM EXTERNAL PROVIDER';
    EXEC sp_executesql @createUserSql;
END;

$(($roleStatements -join [Environment]::NewLine))
"@

Write-Host "Granting database roles to: $AppIdentityName"
Invoke-SqlCmdQuery -QueryText $grantQuery

Write-Host 'Database initialization completed successfully.' -ForegroundColor Green