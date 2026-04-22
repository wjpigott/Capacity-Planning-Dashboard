function Get-StaticServiceAvailability {
    <#
    .SYNOPSIS
        Checks availability of static-tier PaaS services via pricing API validation.
    .DESCRIPTION
        For services without a capabilities API (Redis, Event Hubs, Service Bus,
        AI Search, APIM, ACR, Key Vault, etc.), validates availability by checking
        if the service has pricing entries in the specified region.
    .PARAMETER ServiceName
        The Azure Retail Pricing serviceName value.
    .PARAMETER Region
        Azure region code.
    .PARAMETER TierMap
        Hashtable mapping tier name to known characteristics.
    .PARAMETER PricingApiUrl
        Retail pricing API base URL.
    .PARAMETER MaxRetries
        Max retry attempts.
    .OUTPUTS
        [PSCustomObject[]] — one object per tier found.
    #>
    param(
        [Parameter(Mandatory)][string]$ServiceName,
        [Parameter(Mandatory)][string]$Region,
        [Parameter(Mandatory)][hashtable]$TierMap,
        [string]$PricingApiUrl = 'https://prices.azure.com/api/retail/prices',
        [int]$MaxRetries = 3
    )

    $armLocation = $Region.ToLower() -replace '\s', ''
    $filter = "armRegionName eq '$armLocation' and serviceName eq '$ServiceName' and priceType eq 'Consumption'"
    $apiUrl = "$PricingApiUrl`?`$filter=$([uri]::EscapeDataString($filter))&`$top=100"

    $results = [System.Collections.Generic.List[PSCustomObject]]::new()
    $foundTiers = @{}

    try {
        $response = Invoke-WithRetry -MaxRetries $MaxRetries -OperationName "Pricing check ($ServiceName/$Region)" -ScriptBlock {
            Invoke-RestMethod -Uri $apiUrl -Method Get -TimeoutSec 30
        }

        foreach ($item in $response.Items) {
            $tier = $item.skuName
            if (-not $tier -or $foundTiers.ContainsKey($tier)) { continue }
            $foundTiers[$tier] = $true
        }
    }
    catch {
        Write-Verbose "Pricing check failed for $ServiceName in $Region`: $($_.Exception.Message)"
    }

    foreach ($tierName in $TierMap.Keys) {
        $available = $foundTiers.Count -gt 0
        $results.Add([PSCustomObject]@{
            Region  = $Region
            Service = $ServiceName
            Tier    = $tierName
            Details = $TierMap[$tierName]
            Status  = if ($available) { 'Available' } else { 'Unknown' }
        })
    }

    return , $results
}
