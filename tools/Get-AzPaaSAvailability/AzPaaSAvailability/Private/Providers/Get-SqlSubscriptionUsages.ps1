function Get-SqlSubscriptionUsages {
    <#
    .SYNOPSIS
        Gets SQL subscription usage quotas for a region.
    .DESCRIPTION
        Calls Microsoft.Sql/locations/{region}/usages to retrieve
        ServerQuota, RegionalVCoreQuotaForSQLDBAndDW, and other metrics.
    .OUTPUTS
        Hashtable keyed by usage name (e.g., 'ServerQuota', 'RegionalVCoreQuotaForSQLDBAndDW').
        Each value is a hashtable with DisplayName, CurrentValue, Limit, Unit.
    #>
    param(
        [Parameter(Mandatory)][string]$Region,
        [Parameter(Mandatory)][string]$SubscriptionId,
        [Parameter(Mandatory)][string]$AccessToken,
        [string]$ArmUrl = 'https://management.azure.com',
        [string]$ApiVersion = '2021-11-01',
        [int]$MaxRetries = 3
    )

    $uri = "$ArmUrl/subscriptions/$SubscriptionId/providers/Microsoft.Sql/locations/$Region/usages?api-version=$ApiVersion"

    try {
        $response = Invoke-WithRetry -MaxRetries $MaxRetries -OperationName "SQL Usages ($Region)" -ScriptBlock {
            Invoke-RestMethod -Uri $uri -Headers @{ Authorization = "Bearer $AccessToken" } -Method GET -TimeoutSec 30
        }

        $usages = @{}
        foreach ($item in $response.value) {
            $usages[$item.name] = @{
                DisplayName  = $item.properties.displayName
                CurrentValue = [double]$item.properties.currentValue
                Limit        = [double]$item.properties.limit
                Unit         = $item.properties.unit
            }
        }
        return $usages
    }
    catch {
        Write-Verbose "Failed to get SQL usages for $Region`: $($_.Exception.Message)"
        return @{}
    }
}
