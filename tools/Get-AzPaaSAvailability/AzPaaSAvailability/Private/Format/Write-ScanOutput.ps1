function Write-ScanBanner {
    <#
    .SYNOPSIS
        Writes the script header banner with scan parameters.
    #>
    param(
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][string[]]$SubscriptionIds,
        [Parameter(Mandatory)][string[]]$Regions,
        [Parameter(Mandatory)][string[]]$Services,
        [string[]]$Filters,
        [Parameter(Mandatory)][hashtable]$Icons,
        [Parameter(Mandatory)][string]$EnvironmentName,
        [int]$OutputWidth = 113
    )

    Write-Host "`n" -NoNewline
    Write-Host ("=" * $OutputWidth) -ForegroundColor Gray
    Write-Host "GET-AZPAASAVAILABILITY v$Version" -ForegroundColor Magenta
    Write-Host ("=" * $OutputWidth) -ForegroundColor Gray
    Write-Host "Subscription(s): $($SubscriptionIds -join ', ')" -ForegroundColor Cyan
    Write-Host "Regions: $($Regions -join ', ')" -ForegroundColor Cyan
    Write-Host "Services: $($Services -join ', ')" -ForegroundColor Cyan

    if ($Filters -and $Filters.Count -gt 0) {
        Write-Host ($Filters -join ' | ') -ForegroundColor Yellow
    }

    $iconType = if ($Icons.Check -eq [string][char]0x2713 -or $Icons.Check -eq '✓') { 'Unicode' } else { 'ASCII' }
    Write-Host "Icons: $iconType | Cloud: $EnvironmentName" -ForegroundColor DarkGray
    Write-Host ("=" * $OutputWidth) -ForegroundColor Gray
}

function Write-ScanComplete {
    <#
    .SYNOPSIS
        Writes the scan completion footer.
    #>
    param(
        [Parameter(Mandatory)][timespan]$Elapsed,
        [Parameter(Mandatory)][string[]]$StatsLines,
        [Parameter(Mandatory)][int]$RegionCount,
        [int]$OutputWidth = 113
    )

    Write-Host ""
    Write-Host ("=" * $OutputWidth) -ForegroundColor Gray
    Write-Host "PAAS AVAILABILITY SCAN COMPLETE" -ForegroundColor Green
    Write-Host "$($StatsLines -join ' | ') | Regions: $RegionCount | Time: $([math]::Round($Elapsed.TotalSeconds, 1))s" -ForegroundColor DarkGray
    Write-Host "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor DarkGray
    Write-Host ("=" * $OutputWidth) -ForegroundColor Gray
}

function Write-StatusKey {
    <#
    .SYNOPSIS
        Writes the color-coded status key legend.
    #>
    param([int]$OutputWidth = 113)

    Write-Host "STATUS KEY:" -ForegroundColor DarkGray -NoNewline
    Write-Host " Available" -ForegroundColor Green -NoNewline
    Write-Host " = provisionable |" -ForegroundColor DarkGray -NoNewline
    Write-Host " Default" -ForegroundColor Green -NoNewline
    Write-Host " = provisionable (default) |" -ForegroundColor DarkGray -NoNewline
    Write-Host " Visible" -ForegroundColor Yellow -NoNewline
    Write-Host " = exists, sub can't provision |" -ForegroundColor DarkGray -NoNewline
    Write-Host " Disabled" -ForegroundColor Red -NoNewline
    Write-Host " = explicitly disabled" -ForegroundColor DarkGray
}

function Get-StatusColor {
    <#
    .SYNOPSIS
        Returns the console color for a SQL capability status.
    #>
    param([Parameter(Mandatory)][string]$Status)
    switch ($Status) {
        'Available' { return 'Green' }
        'Default'   { return 'Green' }
        'Visible'   { return 'Yellow' }
        'Disabled'  { return 'Red' }
        default     { return 'Gray' }
    }
}
