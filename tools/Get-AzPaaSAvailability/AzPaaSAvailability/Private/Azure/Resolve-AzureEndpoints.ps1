function Resolve-AzureEndpoints {
    <#
    .SYNOPSIS
        Resolves Azure ARM and pricing API endpoints for the current cloud environment.
    .DESCRIPTION
        Auto-detects the Azure environment (Commercial, Government, China, etc.)
        and returns the appropriate API endpoints. Supports sovereign clouds.
    .PARAMETER EnvironmentName
        Explicit environment name override (AzureCloud, AzureUSGovernment, etc.).
    .OUTPUTS
        Hashtable with EnvironmentName, ResourceManagerUrl, PricingApiUrl.
    #>
    param(
        [string]$EnvironmentName
    )

    $AzEnvironment = $null

    if ($EnvironmentName) {
        try {
            $AzEnvironment = Get-AzEnvironment -Name $EnvironmentName -ErrorAction Stop
            if (-not $AzEnvironment) {
                Write-Warning "Environment '$EnvironmentName' not found. Using default Commercial cloud."
            }
            else { Write-Verbose "Using explicit environment: $EnvironmentName" }
        }
        catch {
            Write-Warning "Could not get environment '$EnvironmentName': $_. Using default Commercial cloud."
        }
    }

    if (-not $AzEnvironment) {
        try {
            $context = Get-AzContext -ErrorAction Stop
            if ($context) { $AzEnvironment = $context.Environment }
        }
        catch { Write-Warning "Could not get Azure context. Using default Commercial cloud endpoints." }
    }

    if (-not $AzEnvironment) {
        return @{
            EnvironmentName    = 'AzureCloud'
            ResourceManagerUrl = 'https://management.azure.com'
            PricingApiUrl      = 'https://prices.azure.com/api/retail/prices'
        }
    }

    $armUrl = ($AzEnvironment.ResourceManagerUrl ?? 'https://management.azure.com').TrimEnd('/')

    $portalUrl = $AzEnvironment.ManagementPortalUrl
    if ($portalUrl) {
        $pricingUrl = ($portalUrl -replace '^(https?://)?portal\.', '${1}prices.').TrimEnd('/')
        $pricingApiUrl = "$pricingUrl/api/retail/prices"
    }
    else {
        $pricingApiUrl = switch ($AzEnvironment.Name) {
            'AzureUSGovernment' { 'https://prices.azure.us/api/retail/prices' }
            'AzureChinaCloud'   { 'https://prices.azure.cn/api/retail/prices' }
            'AzureGermanCloud'  { 'https://prices.microsoftazure.de/api/retail/prices' }
            default             { 'https://prices.azure.com/api/retail/prices' }
        }
    }

    $endpoints = @{
        EnvironmentName    = $AzEnvironment.Name
        ResourceManagerUrl = $armUrl
        PricingApiUrl      = $pricingApiUrl
    }

    Write-Verbose "Azure Environment: $($endpoints.EnvironmentName)"
    Write-Verbose "Resource Manager URL: $($endpoints.ResourceManagerUrl)"
    Write-Verbose "Pricing API URL: $($endpoints.PricingApiUrl)"

    return $endpoints
}
