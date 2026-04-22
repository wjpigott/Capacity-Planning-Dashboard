function Get-AzServiceTierAvailability {
    <#
    .SYNOPSIS
        Checks availability of static-tier Azure PaaS services via pricing API validation.
    .DESCRIPTION
        For services without a dedicated capabilities API (Redis, Event Hubs, Service Bus,
        AI Search, APIM, ACR, Key Vault, etc.), validates regional availability by checking
        if the service has pricing entries in the specified region.
        Returns tier-level availability per region per service.
    .PARAMETER Region
        One or more Azure region codes.
    .PARAMETER ServiceFilter
        Filter to specific services. If omitted, checks all known static-tier services.
    .PARAMETER Environment
        Azure cloud environment override.
    .PARAMETER MaxRetries
        Max retry attempts for transient errors.
    .PARAMETER Quiet
        Suppress Write-Host display output.
    .EXAMPLE
        Get-AzServiceTierAvailability -Region eastus,westus2
    .EXAMPLE
        Get-AzServiceTierAvailability -Region eastus -ServiceFilter Redis,EventHubs -Quiet
    .OUTPUTS
        [PSCustomObject] with Region, Service, Available, PricingEntries
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string[]]$Region,
        [ValidateSet('Redis', 'EventHubs', 'ServiceBus', 'AISearch', 'APIM',
                     'ACR', 'KeyVault', 'FrontDoor', 'LogAnalytics', 'AppConfig',
                     'IoTHub', 'Grafana', 'StaticWebApps', 'SignalR', 'NotificationHubs')]
        [string[]]$ServiceFilter,
        [ValidateSet('AzureCloud', 'AzureUSGovernment', 'AzureChinaCloud', 'AzureGermanCloud')]
        [string]$Environment,
        [int]$MaxRetries = 3,
        [switch]$Quiet
    )

    # Service catalog: Azure Retail Pricing serviceName → known tiers
    $serviceCatalog = [ordered]@{
        'Redis'            = @{ PricingName = 'Azure Cache for Redis'; Tiers = @('Basic C0-C6', 'Standard C0-C6', 'Premium P1-P5', 'Enterprise E5-E200', 'Enterprise Flash F300-F1500') }
        'EventHubs'        = @{ PricingName = 'Event Hubs'; Tiers = @('Basic', 'Standard', 'Premium', 'Dedicated') }
        'ServiceBus'       = @{ PricingName = 'Service Bus'; Tiers = @('Basic', 'Standard', 'Premium') }
        'AISearch'         = @{ PricingName = 'Azure AI Search'; Tiers = @('Free', 'Basic', 'S1', 'S2', 'S3', 'S3 HD', 'L1', 'L2') }
        'APIM'             = @{ PricingName = 'API Management'; Tiers = @('Consumption', 'Developer', 'Basic', 'Standard', 'Premium', 'Isolated') }
        'ACR'              = @{ PricingName = 'Container Registry'; Tiers = @('Basic', 'Standard', 'Premium') }
        'KeyVault'         = @{ PricingName = 'Key Vault'; Tiers = @('Standard', 'Premium (HSM)') }
        'FrontDoor'        = @{ PricingName = 'Azure Front Door Service'; Tiers = @('Standard', 'Premium') }
        'LogAnalytics'     = @{ PricingName = 'Log Analytics'; Tiers = @('Pay-as-you-go', 'Commitment Tier 100GB', 'Commitment Tier 200GB', 'Commitment Tier 500GB') }
        'AppConfig'        = @{ PricingName = 'App Configuration'; Tiers = @('Free', 'Standard') }
        'IoTHub'           = @{ PricingName = 'IoT Hub'; Tiers = @('Free F1', 'Basic B1-B3', 'Standard S1-S3') }
        'Grafana'          = @{ PricingName = 'Azure Managed Grafana'; Tiers = @('Essential', 'Standard') }
        'StaticWebApps'    = @{ PricingName = 'Azure Static Web Apps'; Tiers = @('Free', 'Standard') }
        'SignalR'          = @{ PricingName = 'SignalR Service'; Tiers = @('Free', 'Standard', 'Premium') }
        'NotificationHubs' = @{ PricingName = 'Notification Hubs'; Tiers = @('Free', 'Basic', 'Standard') }
    }

    # Filter to requested services
    $servicesToScan = if ($ServiceFilter) {
        $ServiceFilter | ForEach-Object { @{ Key = $_; Value = $serviceCatalog[$_] } }
    }
    else {
        $serviceCatalog.GetEnumerator()
    }

    $endpoints = Resolve-AzureEndpoints -EnvironmentName $Environment
    $icons = Resolve-IconSet

    if (-not $Quiet) {
        $count = @($servicesToScan).Count
        Write-Host "Checking $count static-tier services across $($Region.Count) region(s)..." -ForegroundColor Yellow
    }

    $allResults = [System.Collections.Generic.List[PSCustomObject]]::new()

    foreach ($regionCode in $Region) {
        foreach ($svc in $servicesToScan) {
            $svcKey = if ($svc.Key) { $svc.Key } else { $svc.Name }
            $svcDef = if ($svc.Value) { $svc.Value } else { $serviceCatalog[$svcKey] }
            if (-not $svcDef) { continue }

            $pricingName = $svcDef.PricingName
            $armLocation = $regionCode.ToLower() -replace '\s', ''
            $filter = "armRegionName eq '$armLocation' and serviceName eq '$pricingName' and priceType eq 'Consumption'"
            $apiUrl = "$($endpoints.PricingApiUrl)`?`$filter=$([uri]::EscapeDataString($filter))&`$top=5"

            $entryCount = 0
            try {
                $response = Invoke-WithRetry -MaxRetries $MaxRetries -OperationName "Pricing ($svcKey/$regionCode)" -ScriptBlock {
                    Invoke-RestMethod -Uri $apiUrl -Method Get -TimeoutSec 15
                }
                $entryCount = ($response.Items | Measure-Object).Count
            }
            catch {
                Write-Verbose "Pricing check failed for $svcKey in $regionCode`: $($_.Exception.Message)"
            }

            $allResults.Add([PSCustomObject]@{
                Region         = $regionCode
                Service        = $svcKey
                ServiceDisplay = $pricingName
                Available      = $entryCount -gt 0
                PricingEntries = $entryCount
                KnownTiers     = ($svcDef.Tiers -join ', ')
                Status         = if ($entryCount -gt 0) { 'Available' } else { 'NotFound' }
            })
        }

        if (-not $Quiet) {
            $regionResults = $allResults | Where-Object { $_.Region -eq $regionCode }
            $available = @($regionResults | Where-Object { $_.Available }).Count
            $total = $regionResults.Count
            Write-Host "  $($icons.Check) $regionCode`: $available/$total services available" -ForegroundColor $(if ($available -eq $total) { 'Green' } elseif ($available -gt 0) { 'Yellow' } else { 'Red' })
        }
    }

    return $allResults
}
