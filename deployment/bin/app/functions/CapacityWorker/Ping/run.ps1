using namespace System.Net

param(
    $Request,
    $TriggerMetadata
)

Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{
    StatusCode = [HttpStatusCode]::OK
    Body = @{
        ok = $true
        worker = 'capacity-worker'
    }
})