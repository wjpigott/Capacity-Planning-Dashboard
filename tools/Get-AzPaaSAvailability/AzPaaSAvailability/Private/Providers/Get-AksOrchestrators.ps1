function Get-AksOrchestrators {
    <#
    .SYNOPSIS
        Queries AKS available Kubernetes versions for a region.
    #>
    param(
        [Parameter(Mandatory)][string]$Region,
        [Parameter(Mandatory)][string]$SubscriptionId,
        [Parameter(Mandatory)][string]$AccessToken,
        [string]$ArmUrl = 'https://management.azure.com',
        [string]$ApiVersion = '2023-11-01',
        [int]$MaxRetries = 3
    )

    $uri = "$ArmUrl/subscriptions/$SubscriptionId/providers/Microsoft.ContainerService/locations/$Region/orchestrators?api-version=$ApiVersion&resource-type=managedClusters"

    $response = Invoke-WithRetry -MaxRetries $MaxRetries -OperationName "AKS Orchestrators ($Region)" -ScriptBlock {
        Invoke-RestMethod -Uri $uri -Headers @{ Authorization = "Bearer $AccessToken" } -Method GET -TimeoutSec 30
    }

    $results = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($orch in $response.properties.orchestrators) {
        $upgrades = @($orch.upgrades | ForEach-Object { $_.orchestratorVersion }) -join ','
        $results.Add([PSCustomObject]@{
            Region      = $Region
            Service     = 'AKS'
            Version     = $orch.orchestratorVersion
            IsPreview   = [bool]$orch.isPreview
            IsDefault   = [bool]$orch.default
            UpgradePaths = $upgrades
            Status      = if ($orch.isPreview) { 'Preview' } else { 'Available' }
        })
    }

    return , $results
}
