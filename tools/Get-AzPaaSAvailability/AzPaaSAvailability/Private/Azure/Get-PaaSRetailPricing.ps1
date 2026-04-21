function Get-PaaSRetailPricing {
    <#
    .SYNOPSIS
        Fetches retail pricing for a PaaS service from Azure Retail Prices API.
    .PARAMETER ServiceName
        The Azure service name for pricing filter (e.g., 'SQL Database', 'Azure Cosmos DB').
    .PARAMETER Region
        Azure region code (e.g., 'eastus').
    .PARAMETER PricingApiUrl
        Base URL for the pricing API.
    .PARAMETER MaxRetries
        Max retry attempts for transient errors.
    .PARAMETER MaxPages
        Maximum pricing API pages to fetch.
    #>
    param(
        [Parameter(Mandatory)][string]$ServiceName,
        [Parameter(Mandatory)][string]$Region,
        [string]$PricingApiUrl = 'https://prices.azure.com/api/retail/prices',
        [int]$MaxRetries = 3,
        [int]$MaxPages = 10
    )

    $armLocation = $Region.ToLower() -replace '\s', ''
    $filter = "armRegionName eq '$armLocation' and priceType eq 'Consumption' and serviceName eq '$ServiceName'"
    $apiUrl = "$PricingApiUrl`?`$filter=$([uri]::EscapeDataString($filter))"

    $prices = @{}
    $nextLink = $apiUrl
    $pageCount = 0

    try {
        while ($nextLink -and $pageCount -lt $MaxPages) {
            $uri = $nextLink
            $response = Invoke-WithRetry -MaxRetries $MaxRetries -OperationName "Pricing API ($ServiceName, page $($pageCount + 1))" -ScriptBlock {
                Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 30
            }
            $pageCount++

            foreach ($item in $response.Items) {
                if ($item.productName -match 'Windows' -or $item.skuName -match 'Low Priority') { continue }

                $key = "$($item.armSkuName)-$($item.skuName)"
                if (-not $prices.ContainsKey($key) -or $item.type -eq 'Consumption') {
                    $prices[$key] = @{
                        SkuName       = $item.armSkuName
                        MeterName     = $item.meterName
                        UnitPrice     = $item.unitPrice
                        UnitOfMeasure = $item.unitOfMeasure
                        ProductName   = $item.productName
                    }
                }
            }

            $nextLink = $response.NextPageLink
        }
    }
    catch {
        Write-Verbose "Failed to get pricing for $ServiceName in $Region`: $($_.Exception.Message)"
    }

    return $prices
}
