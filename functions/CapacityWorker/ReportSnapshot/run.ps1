using namespace System.Net

param($Request, $TriggerMetadata)

$sharedRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'shared'
. (Join-Path $sharedRoot 'PlacementHelpers.ps1')
. (Join-Path $sharedRoot 'ReportSnapshot.ps1')

if (-not (Test-WorkerAuthorized -Request $Request -SharedSecret $env:WORKER_SHARED_SECRET)) {
    Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{ StatusCode = [HttpStatusCode]::Unauthorized; Body = @{ ok = $false; error = 'Unauthorized worker request.' } })
    return
}

try {
    $body = if ($Request.Body -is [string] -and $Request.Body) { $Request.Body | ConvertFrom-Json } else { $Request.Body }
    if ($Request.Method -eq 'POST' -and $body.action -eq 'saveScope') {
        $scope = Set-CapacityReportScope -Scope $body.scope
        Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{ StatusCode = [HttpStatusCode]::OK; Body = @{ ok = $true; scope = $scope } })
        return
    }
    if ($Request.Method -eq 'GET' -and $Request.Query.action -eq 'scope') {
        Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{ StatusCode = [HttpStatusCode]::OK; Body = @{ ok = $true; scope = Get-CapacityReportScope } })
        return
    }
    $refresh = $Request.Method -eq 'POST'
    $snapshot = if ($refresh) { New-CapacityReportSnapshot } else { Get-CapacityReportSnapshot }
    Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{ StatusCode = [HttpStatusCode]::OK; Body = @{ ok = $true; snapshot = $snapshot; refresh = $refresh } })
}
catch {
    Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{ StatusCode = [HttpStatusCode]::InternalServerError; Body = @{ ok = $false; error = 'Capacity report snapshot failed.'; detail = $_.Exception.Message } })
}