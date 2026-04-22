function Get-AzFunctionsAvailability {
    <#
    .SYNOPSIS
        Scans Azure Functions runtime stack availability.
    .DESCRIPTION
        Returns all available Function App runtime stacks with version,
        platform (Linux/Windows), deprecation status, and end-of-life dates.
    .EXAMPLE
        Get-AzFunctionsAvailability
    .EXAMPLE
        Get-AzFunctionsAvailability -Quiet | Where-Object { -not $_.IsDeprecated -and $_.Stack -eq '.NET' }
    #>
    [CmdletBinding()]
    param(
        [ValidateSet('AzureCloud', 'AzureUSGovernment', 'AzureChinaCloud', 'AzureGermanCloud')]
        [string]$Environment,
        [int]$MaxRetries = 3,
        [switch]$Quiet
    )

    $endpoints = Resolve-AzureEndpoints -EnvironmentName $Environment
    $icons = Resolve-IconSet
    $accessToken = Get-AzBearerToken -ResourceUrl $endpoints.ResourceManagerUrl

    if (-not $Quiet) { Write-Host 'Scanning Functions runtime stacks...' -ForegroundColor Yellow }

    try {
        $stacks = Get-FunctionAppStacks -AccessToken $accessToken -ArmUrl $endpoints.ResourceManagerUrl -MaxRetries $MaxRetries
        if (-not $Quiet) {
            $active = @($stacks | Where-Object { -not $_.IsDeprecated }).Count
            Write-Host "  $($icons.Check) $($stacks.Count) stack/version combos ($active active)" -ForegroundColor Green
        }
        return $stacks
    }
    catch {
        if (-not $Quiet) { Write-Host "  $($icons.Error) Functions: $($_.Exception.Message)" -ForegroundColor Red }
        return @()
    }
}
