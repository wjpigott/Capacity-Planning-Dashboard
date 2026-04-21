function Get-FunctionAppStacks {
    <#
    .SYNOPSIS
        Queries available Function App runtime stacks.
    .DESCRIPTION
        Calls Microsoft.Web/functionAppStacks to discover runtime stacks,
        versions, deprecation status, and end-of-life dates.
        This is a global (non-region-specific) API.
    #>
    param(
        [Parameter(Mandatory)][string]$AccessToken,
        [string]$ArmUrl = 'https://management.azure.com',
        [string]$ApiVersion = '2024-04-01',
        [int]$MaxRetries = 3
    )

    $uri = "$ArmUrl/providers/Microsoft.Web/functionAppStacks?api-version=$ApiVersion"

    $response = Invoke-WithRetry -MaxRetries $MaxRetries -OperationName 'Function App Stacks' -ScriptBlock {
        Invoke-RestMethod -Uri $uri -Headers @{ Authorization = "Bearer $AccessToken" } -Method GET -TimeoutSec 30
    }

    $results = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($stack in $response.value) {
        $stackName = $stack.properties.displayText
        foreach ($major in $stack.properties.majorVersions) {
            foreach ($minor in $major.minorVersions) {
                $linuxSettings = $minor.stackSettings.linuxRuntimeSettings
                $windowsSettings = $minor.stackSettings.windowsRuntimeSettings

                foreach ($platform in @('Linux', 'Windows')) {
                    $settings = if ($platform -eq 'Linux') { $linuxSettings } else { $windowsSettings }
                    if (-not $settings) { continue }

                    $results.Add([PSCustomObject]@{
                        Service        = 'Functions'
                        Stack          = $stackName
                        Version        = $minor.displayText
                        RuntimeVersion = $settings.runtimeVersion
                        Platform       = $platform
                        IsDefault      = [bool]$settings.isDefault
                        IsPreview      = [bool]$settings.isPreview
                        IsDeprecated   = [bool]$settings.isDeprecated
                        IsHidden       = [bool]$settings.isHidden
                        EndOfLife      = $settings.endOfLifeDate
                        AppInsights    = [bool]$settings.applicationInsights
                        Status         = if ($settings.isDeprecated) { 'Deprecated' } elseif ($settings.isPreview) { 'Preview' } else { 'Available' }
                    })
                }
            }
        }
    }

    return , $results
}
