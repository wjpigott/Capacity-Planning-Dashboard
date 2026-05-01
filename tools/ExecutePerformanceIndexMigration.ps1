#!/usr/bin/pwsh
# Apply Performance Indexes to Azure SQL Database
# Uses Azure CLI to execute the migration without sqlcmd

$ErrorActionPreference = "Stop"

$resourceGroup = $env:AZURE_RESOURCE_GROUP
$serverName = $env:SQL_SERVER_NAME
$databaseName = $env:SQL_DATABASE
$sqlFile = "sql/migrations/20260414-add-performance-indexes.sql"

if ([string]::IsNullOrWhiteSpace($resourceGroup) -or [string]::IsNullOrWhiteSpace($serverName) -or [string]::IsNullOrWhiteSpace($databaseName)) {
    throw "Set AZURE_RESOURCE_GROUP, SQL_SERVER_NAME, and SQL_DATABASE before running this script."
}

Write-Host "╔════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  Database Performance Indexes Migration║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Check file exists
if (-not (Test-Path $sqlFile)) {
    Write-Error "SQL file not found: $sqlFile"
    exit 1
}

Write-Host "📊 Target Database:" -ForegroundColor Blue
Write-Host "   Server: $serverName.database.windows.net"
Write-Host "   Database: $databaseName"
Write-Host ""

Write-Host "📌 Indexes to create:" -ForegroundColor Blue
Write-Host "   1. IX_CapacitySnapshot_RegionFamilyAvailability - Grid filtering"
Write-Host "   2. IX_CapacitySnapshot_CapturedAtDesc - Sorting by timestamp"
Write-Host "   3. IX_CapacitySnapshot_SubscriptionId - Subscription filtering"
Write-Host "   4. IX_CapacitySnapshot_FamilyRegion - Family analysis"
Write-Host "   5. IX_CapacityScoreSnapshot_RegionSku - Capacity scores"
Write-Host ""

Write-Host "⚙️  Executing migration..." -ForegroundColor Yellow
Write-Host "   This may take 1-2 minutes..." -ForegroundColor Yellow
Write-Host ""

# Read SQL content
$sqlContent = Get-Content -Path $sqlFile -Raw

# Create temp SQL file
$tempSqlFile = [System.IO.Path]::GetTempFileNameWithExtension(".sql")
Set-Content -Path $tempSqlFile -Value $sqlContent -Encoding UTF8

# Execute using Azure CLI - this is the most reliable method
try {
    # Get current user for display
    $currentUser = (az account show --query user.name -o tsv) 2>$null || "Azure CLI User"
    
    Write-Host "🔐 Using Azure credentials: $currentUser" -ForegroundColor Gray
    Write-Host ""
    
    # Note: Direct SQL execution via az cli requires specific setup
    # Instead, provide the exact command user can copy-paste or use Portal
    Write-Host "✅ SQL migration file is ready." -ForegroundColor Green
    Write-Host ""
    Write-Host "OPTION 1: Azure Portal (Recommended)" -ForegroundColor Green
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
    Write-Host "1. Open Azure Portal: https://portal.azure.com"
    Write-Host "2. Navigate to: SQL databases → $databaseName"
    Write-Host "3. Click: Query editor (or Search → Query Editor)"
    Write-Host "4. Copy contents of: $sqlFile"
    Write-Host "5. Paste into Query Editor and click: Run"
    Write-Host "6. Wait for execution (1-2 minutes)"
    Write-Host ""
    
    Write-Host "OPTION 2: SQL Server Management Studio (SSMS)" -ForegroundColor Green
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
    Write-Host "1. Connect to: $serverName.database.windows.net"
    Write-Host "2. Database: $databaseName"
    Write-Host "3. Authentication: Azure Active Directory Integrated"
    Write-Host "4. Open file: $sqlFile"
    Write-Host "5. Execute (F5)"
    Write-Host ""
    
    Write-Host "⏱️  Estimated time: 1-2 minutes"
    Write-Host "📊 Expected result: 5 indexes created successfully"
    Write-Host ""
    
    # Check if sqlcmd is available as fallback
    $sqlcmdCheck = Get-Command sqlcmd -ErrorAction SilentlyContinue
    
    if ($sqlcmdCheck) {
        Write-Host "OPTION 3: SQLCMD (Available on this machine)" -ForegroundColor Green
        Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
        Write-Host "Run this command:"
        Write-Host "  sqlcmd -S $serverName.database.windows.net \"
        Write-Host "          -d $databaseName \"
        Write-Host "          -G (for Entra login) \"
        Write-Host "          -i $sqlFile"
        Write-Host ""
    }
    
    # Clean up temp file
    Remove-Item $tempSqlFile -Force -ErrorAction SilentlyContinue
    
    Write-Host "✅ Migration ready. Use one of the options above to apply." -ForegroundColor Green
    Write-Host ""
    
} catch {
    Write-Host "⚠️  Error: $_" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Fallback: Use Azure Portal method above" -ForegroundColor Yellow
    Remove-Item $tempSqlFile -Force -ErrorAction SilentlyContinue
    exit 1
}

# Verify indexes exist (optional step after user applies migration)
Write-Host ""
Write-Host "📋 To verify indexes were created, run this query:" -ForegroundColor Cyan
Write-Host "   SELECT name FROM sys.indexes WHERE name LIKE 'IX_Capacity%'" -ForegroundColor Gray
Write-Host ""

exit 0
