param(
    [Parameter(Mandatory = $true)][string]$SqlServer,
    [Parameter(Mandatory = $true)][string]$SqlDatabase,
    [Parameter(Mandatory = $false)][string]$SqlUser,
    [Parameter(Mandatory = $false)][string]$SqlPassword,
    [Parameter(Mandatory = $false)][string]$EntraUser,
    [Parameter(Mandatory = $false)][switch]$UseEntra
)

$ErrorActionPreference = 'Stop'

$query = @"
INSERT INTO dbo.CapacitySnapshot (capturedAtUtc, sourceType, region, skuName, skuFamily, availabilityState, quotaCurrent, quotaLimit, monthlyCostEstimate)
VALUES
(SYSUTCDATETIME(), 'sample', 'centralus', 'Standard_D4s_v5', 'standardDSv5Family', 'OK', 20, 100, 280.00),
(SYSUTCDATETIME(), 'sample', 'eastus', 'Standard_E8s_v5', 'standardESv5Family', 'LIMITED', 40, 80, 620.00),
(SYSUTCDATETIME(), 'sample', 'eastus2', 'Standard_D8s_v5', 'standardDSv5Family', 'OK', 28, 96, 540.00),
(SYSUTCDATETIME(), 'sample', 'westus', 'Standard_F8s_v2', 'standardFSv2Family', 'LIMITED', 52, 72, 510.00),
(SYSUTCDATETIME(), 'sample', 'westus2', 'Standard_D16s_v5', 'standardDSv5Family', 'CONSTRAINED', 75, 80, 1240.00);
"@

$sqlcmd = Get-Command sqlcmd -ErrorAction SilentlyContinue
if (-not $sqlcmd -and (Test-Path 'C:\Program Files\SqlCmd\sqlcmd.exe')) {
    $sqlcmd = @{ Source = 'C:\Program Files\SqlCmd\sqlcmd.exe' }
}
if (-not $sqlcmd) {
    throw 'sqlcmd is required to run this script. Install SQL tools first.'
}

if ($UseEntra) {
    $args = @('-S', $SqlServer, '-d', $SqlDatabase, '-G', '-Q', $query)
    if (-not [string]::IsNullOrWhiteSpace($EntraUser)) {
        $args += @('-U', $EntraUser)
    }
    & $sqlcmd.Source @args
}
else {
    if ([string]::IsNullOrWhiteSpace($SqlUser) -or [string]::IsNullOrWhiteSpace($SqlPassword)) {
        throw 'For SQL authentication, provide both -SqlUser and -SqlPassword, or use -UseEntra.'
    }
    & $sqlcmd.Source -S $SqlServer -d $SqlDatabase -U $SqlUser -P $SqlPassword -Q $query
}
