function Show-AzPaaSRegionMatrix {
    <#
    .SYNOPSIS
        Displays a cross-service Region Health Matrix showing service availability per region.
    .DESCRIPTION
        Takes the output from Get-AzPaaSAvailability and renders a unified matrix:
        one row per region, one column per service, with counts and status indicators.
    .PARAMETER ScanResult
        Output object from Get-AzPaaSAvailability.
    .PARAMETER Icons
        Icon set hashtable. Auto-detected if not provided.
    .PARAMETER OutputWidth
        Display width in characters.
    .EXAMPLE
        $r = Get-AzPaaSAvailability -Region eastus,westus2 -Quiet
        Show-AzPaaSRegionMatrix -ScanResult $r
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][PSCustomObject]$ScanResult,
        [hashtable]$Icons,
        [int]$OutputWidth = 140
    )

    if (-not $Icons) { $Icons = Resolve-IconSet }
    $regions = $ScanResult.ScanMetadata.Regions

    Write-Host ''
    Write-Host ('=' * $OutputWidth) -ForegroundColor Gray
    Write-Host 'REGION HEALTH MATRIX — All Services' -ForegroundColor Green
    Write-Host ('=' * $OutputWidth) -ForegroundColor Gray
    Write-Host ''

    # Build header
    $colWidth = 12
    $regionCol = 16
    $services = @('SQL', 'Cosmos', 'PgSQL', 'MySQL', 'AppSvc', 'ContApp', 'AKS', 'Funcs', 'Storage')
    $header = ("{0,-$regionCol}" -f 'Region') + ' | '
    $header += ($services | ForEach-Object { "{0,-$colWidth}" -f $_ }) -join ''
    Write-Host $header -ForegroundColor White
    Write-Host ('-' * $OutputWidth) -ForegroundColor DarkGray

    foreach ($regionCode in $regions) {
        $row = "{0,-$regionCol}" -f $regionCode
        $row += ' | '
        $hasIssue = $false

        # SQL
        $sqlCount = @($ScanResult.SqlSkus | Where-Object { $_.Region -eq $regionCode }).Count
        $cell = if ($sqlCount -gt 0) { "$($Icons.Check) $sqlCount" } else { "$($Icons.Warning) 0" }
        if ($sqlCount -eq 0) { $hasIssue = $true }
        $row += "{0,-$colWidth}" -f $cell

        # Cosmos DB
        $cosmos = $ScanResult.CosmosDbLocations | Where-Object { $_.Region -eq $regionCode }
        $cell = if ($cosmos) {
            if ($cosmos.AccessAllowedRegular) { "$($Icons.Check) OK" } else { "$($Icons.Error) BLOCK"; $hasIssue = $true }
        } else { '-' }
        $row += "{0,-$colWidth}" -f $cell

        # PostgreSQL
        $pgCount = @($ScanResult.PostgreSqlSkus | Where-Object { $_.Region -eq $regionCode }).Count
        $cell = if ($pgCount -gt 0) { "$($Icons.Check) $pgCount" } else { '-' }
        $row += "{0,-$colWidth}" -f $cell

        # MySQL
        $myCount = @($ScanResult.MySqlSkus | Where-Object { $_.Region -eq $regionCode }).Count
        $cell = if ($myCount -gt 0) { "$($Icons.Check) $myCount" } else { '-' }
        $row += "{0,-$colWidth}" -f $cell

        # App Service
        $asCount = @($ScanResult.AppServiceSkus | Where-Object { $_.Region -eq $regionCode }).Count
        $cell = if ($asCount -gt 0) { "$($Icons.Check) $asCount" } else { '-' }
        $row += "{0,-$colWidth}" -f $cell

        # Container Apps
        $caCount = @($ScanResult.ContainerApps | Where-Object { $_.Region -eq $regionCode }).Count
        $cell = if ($caCount -gt 0) { "$($Icons.Check) $caCount" } else { '-' }
        $row += "{0,-$colWidth}" -f $cell

        # AKS
        $aksCount = @($ScanResult.AksVersions | Where-Object { $_.Region -eq $regionCode }).Count
        $cell = if ($aksCount -gt 0) { "$($Icons.Check) $aksCount" } else { '-' }
        $row += "{0,-$colWidth}" -f $cell

        # Functions (global, same for all regions)
        $funcCount = @($ScanResult.FunctionStacks | Where-Object { -not $_.IsDeprecated }).Count
        $cell = if ($funcCount -gt 0) { "$($Icons.Check) $funcCount" } else { '-' }
        $row += "{0,-$colWidth}" -f $cell

        # Storage
        $stCount = @($ScanResult.StorageSkus | Where-Object { $_.Region -eq $regionCode }).Count
        $cell = if ($stCount -gt 0) { "$($Icons.Check) $stCount" } else { '-' }
        $row += "{0,-$colWidth}" -f $cell

        $rowColor = if ($hasIssue) { 'Yellow' } else { 'Green' }
        Write-Host $row -ForegroundColor $rowColor
    }

    Write-Host ('-' * $OutputWidth) -ForegroundColor DarkGray
    Write-Host ''
    Write-Host 'HOW TO READ:' -ForegroundColor DarkGray
    Write-Host "  $($Icons.Check) N  = N SKUs/versions available" -ForegroundColor Green
    Write-Host "  $($Icons.Error) BLOCK = Subscription blocked (open SR)" -ForegroundColor Red
    Write-Host "  $($Icons.Warning) 0  = No available SKUs (may have Visible/Disabled — use -IncludeDisabled)" -ForegroundColor Yellow
    Write-Host '  -    = Not scanned or not applicable' -ForegroundColor DarkGray
}
