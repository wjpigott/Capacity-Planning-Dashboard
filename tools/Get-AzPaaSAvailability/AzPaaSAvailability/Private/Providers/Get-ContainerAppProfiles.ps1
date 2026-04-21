function Get-ContainerAppProfiles {
    <#
    .SYNOPSIS
        Queries Container Apps available workload profiles for a region.
    .DESCRIPTION
        Calls Microsoft.App/locations/{region}/availableManagedEnvironmentsWorkloadProfileTypes
        to discover Consumption + Dedicated profile types (D-series, E-series, GPU).
    #>
    param(
        [Parameter(Mandatory)][string]$Region,
        [Parameter(Mandatory)][string]$SubscriptionId,
        [Parameter(Mandatory)][string]$AccessToken,
        [string]$ArmUrl = 'https://management.azure.com',
        [string]$ApiVersion = '2024-03-01',
        [int]$MaxRetries = 3
    )

    $uri = "$ArmUrl/subscriptions/$SubscriptionId/providers/Microsoft.App/locations/$Region/availableManagedEnvironmentsWorkloadProfileTypes?api-version=$ApiVersion"

    $response = Invoke-WithRetry -MaxRetries $MaxRetries -OperationName "Container Apps Profiles ($Region)" -ScriptBlock {
        Invoke-RestMethod -Uri $uri -Headers @{ Authorization = "Bearer $AccessToken" } -Method GET -TimeoutSec 30
    }

    $results = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($profile in $response.value) {
        $p = $profile.properties
        $results.Add([PSCustomObject]@{
            Region      = $Region
            Service     = 'ContainerApps'
            ProfileName = $profile.name
            DisplayName = $p.displayName
            Category    = $p.category
            Cores       = [int]$p.cores
            MemoryGiB   = [int]$p.memoryGiB
            Status      = 'Available'
        })
    }

    # Add implicit Consumption profile
    $results.Add([PSCustomObject]@{
        Region      = $Region
        Service     = 'ContainerApps'
        ProfileName = 'Consumption'
        DisplayName = 'Consumption'
        Category    = 'Consumption'
        Cores       = 0
        MemoryGiB   = 0
        Status      = 'Available'
    })

    return , $results
}
