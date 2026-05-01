# Apply database performance indexes
# Uses Entra-based authentication via az account

$resourceGroup = $env:AZURE_RESOURCE_GROUP
$serverName = $env:SQL_SERVER_NAME
$databaseName = $env:SQL_DATABASE

if ([string]::IsNullOrWhiteSpace($resourceGroup) -or [string]::IsNullOrWhiteSpace($serverName) -or [string]::IsNullOrWhiteSpace($databaseName)) {
    throw "Set AZURE_RESOURCE_GROUP, SQL_SERVER_NAME, and SQL_DATABASE before running this script."
}

# Get access token for Azure SQL
Write-Host "Getting Azure SQL access token..." -ForegroundColor Cyan
$token = az account get-access-token --resource https://database.windows.net --query accessToken -o tsv

if (-not $token) {
    Write-Error "Failed to get access token. Ensure you're logged in with: az login"
    exit 1
}

# Build connection string
$serverFqdn = "$serverName.database.windows.net"
$sqlFilePath = "c:\repos\Capacity\dashboard\sql\migrations\20260414-add-performance-indexes.sql"

Write-Host "Connecting to SQL Server: $serverFqdn" -ForegroundColor Cyan
Write-Host "Database: $databaseName" -ForegroundColor Cyan
Write-Host "Running migration file: $sqlFilePath" -ForegroundColor Cyan

# Read SQL file and split by GO statements
$sqlContent = Get-Content -Path $sqlFilePath -Raw
$sqlBatches = $sqlContent -split "\bGO\b" | Where-Object { $_.Trim() -ne "" }

# Connect and execute each batch
Write-Host "Executing $($sqlBatches.Count) SQL batches..." -ForegroundColor Yellow

try {
    # Use SqlServer module or invoke directly
    $connectionString = "Server=$serverFqdn;Database=$databaseName;Authentication=Active Directory Interactive;"
    
    # Alternative using sqlcmd with access token
    $tempSqlFile = [System.IO.Path]::GetTempFileName() + ".sql"
    Set-Content -Path $tempSqlFile -Value $sqlContent
    
    # Call sqlcmd with token auth
    sqlcmd -S $serverFqdn -d $databaseName -U (az account show --query user.name -o tsv) -P $token -i $tempSqlFile -N
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Migration completed successfully!" -ForegroundColor Green
    } else {
        Write-Host "Migration completed with warnings. Check output above." -ForegroundColor Yellow
    }
    
    Remove-Item $tempSqlFile -Force
} catch {
    Write-Error "Migration failed: $_"
    exit 1
}
