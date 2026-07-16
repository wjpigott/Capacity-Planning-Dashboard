using namespace System.Net

param(
    $Request,
    $TriggerMetadata
)

$sharedHelperPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'shared/PlacementHelpers.ps1'
. $sharedHelperPath

$sharedSecret = $env:WORKER_SHARED_SECRET
if (-not (Test-WorkerAuthorized -Request $Request -SharedSecret $sharedSecret)) {
    Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{
        StatusCode = [HttpStatusCode]::Unauthorized
        Body = @{ ok = $false; error = 'Unauthorized worker request.' }
    })
    return
}

Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{
    StatusCode = [HttpStatusCode]::NotImplemented
    Body = @{
        ok = $false
        error = 'Quota move apply orchestration has not been implemented yet in the worker.'
    }
})