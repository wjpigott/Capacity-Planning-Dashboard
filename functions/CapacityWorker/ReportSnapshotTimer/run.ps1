param($Timer)

$sharedRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'shared'
. (Join-Path $sharedRoot 'PlacementHelpers.ps1')
. (Join-Path $sharedRoot 'ReportSnapshot.ps1')

try {
    $snapshot = New-CapacityReportSnapshot
    Write-Information "Capacity report snapshot captured at $($snapshot.snapshotCapturedAtUtc)."
}
catch {
    Write-Error "Capacity report snapshot timer failed: $($_.Exception.Message)"
    throw
}