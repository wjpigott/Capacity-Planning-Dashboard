function Get-AzSqlAvailability {
    <#
    .SYNOPSIS
        Scans Azure SQL Database or Managed Instance SKU availability across regions.
    .DESCRIPTION
        Queries the SQL Capabilities API and Subscription Usages API to return
        per-region SKU availability with status, zone redundancy, quota, and optional pricing.
        Objects are always emitted to the pipeline. Use -Quiet to suppress Write-Host rendering.
    .PARAMETER Region
        One or more Azure region codes to scan.
    .PARAMETER SubscriptionId
        Azure subscription ID. Defaults to current Az context.
    .PARAMETER SqlResourceType
        SqlDatabase (default) or ManagedInstance.
    .PARAMETER Edition
        Filter to specific editions (GeneralPurpose, BusinessCritical, Hyperscale).
    .PARAMETER ComputeModel
        Filter to Provisioned or Serverless.
    .PARAMETER IncludeDisabled
        Include SKUs with Visible/Disabled status.
    .PARAMETER FetchPricing
        Include retail pricing data.
    .PARAMETER Environment
        Azure cloud environment override.
    .PARAMETER MaxRetries
        Max retry attempts for transient API errors.
    .PARAMETER Quiet
        Suppress Write-Host display output. Objects still emit to pipeline.
    .EXAMPLE
        Get-AzSqlAvailability -Region eastus,westus2
        Returns SQL Database SKU availability for two regions.
    .EXAMPLE
        Get-AzSqlAvailability -Region eastus -SqlResourceType ManagedInstance -IncludeDisabled
        Returns all MI SKUs including Visible/Disabled.
    .OUTPUTS
        [PSCustomObject] with properties: Region, ResourceType, Edition, SKU, Family,
        vCores, ComputeModel, ZoneRedundant, AHUBSupported, Status, StorageRedundancy,
        ServerQuotaUsed, ServerQuotaLimit, VCoreQuotaUsed, VCoreQuotaLimit
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string[]]$Region,

        [string]$SubscriptionId,

        [ValidateSet('SqlDatabase', 'ManagedInstance')]
        [string]$SqlResourceType = 'SqlDatabase',

        [ValidateSet('GeneralPurpose', 'BusinessCritical', 'Hyperscale')]
        [string[]]$Edition,

        [ValidateSet('Provisioned', 'Serverless')]
        [string]$ComputeModel,

        [switch]$IncludeDisabled,

        [switch]$FetchPricing,

        [ValidateSet('AzureCloud', 'AzureUSGovernment', 'AzureChinaCloud', 'AzureGermanCloud')]
        [string]$Environment,

        [int]$MaxRetries = 3,

        [switch]$Quiet
    )

    $endpoints = Resolve-AzureEndpoints -EnvironmentName $Environment
    $icons = Resolve-IconSet
    $armUrl = $endpoints.ResourceManagerUrl
    $apiVersion = '2021-11-01'

    if (-not $SubscriptionId) {
        $ctx = Get-AzContext -ErrorAction Stop
        if (-not $ctx) { throw 'No Azure context. Run Connect-AzAccount first.' }
        $SubscriptionId = $ctx.Subscription.Id
    }

    $accessToken = Get-AzBearerToken -ResourceUrl $armUrl

    if (-not $Quiet) {
        Write-Host "Scanning SQL $SqlResourceType in $($Region.Count) region(s)..." -ForegroundColor Yellow
    }

    $allResults = [System.Collections.Generic.List[PSCustomObject]]::new()

    foreach ($regionCode in $Region) {
        try {
            $skus = Get-SqlCapabilities `
                -Region $regionCode `
                -SubscriptionId $SubscriptionId `
                -AccessToken $accessToken `
                -ArmUrl $armUrl `
                -ApiVersion $apiVersion `
                -ResourceType $SqlResourceType `
                -EditionFilter $Edition `
                -ComputeModelFilter $ComputeModel `
                -IncludeDisabledSkus:$IncludeDisabled `
                -MaxRetries $MaxRetries

            $usages = Get-SqlSubscriptionUsages `
                -Region $regionCode `
                -SubscriptionId $SubscriptionId `
                -AccessToken $accessToken `
                -ArmUrl $armUrl `
                -ApiVersion $apiVersion `
                -MaxRetries $MaxRetries

            $serverQuota = $usages['ServerQuota']
            $vCoreQuota = $usages['RegionalVCoreQuotaForSQLDBAndDW']

            # Enrich SKU objects with quota data
            foreach ($sku in $skus) {
                $sku | Add-Member -NotePropertyName ServerQuotaUsed -NotePropertyValue $(if ($serverQuota) { [int]$serverQuota.CurrentValue } else { $null }) -Force
                $sku | Add-Member -NotePropertyName ServerQuotaLimit -NotePropertyValue $(if ($serverQuota) { [int]$serverQuota.Limit } else { $null }) -Force
                $sku | Add-Member -NotePropertyName VCoreQuotaUsed -NotePropertyValue $(if ($vCoreQuota) { [int]$vCoreQuota.CurrentValue } else { $null }) -Force
                $sku | Add-Member -NotePropertyName VCoreQuotaLimit -NotePropertyValue $(if ($vCoreQuota) { [int]$vCoreQuota.Limit } else { $null }) -Force
                $allResults.Add($sku)
            }

            if (-not $Quiet) {
                if ($skus.Count -eq 0 -and -not $IncludeDisabled) {
                    $allSkus = Get-SqlCapabilities -Region $regionCode -SubscriptionId $SubscriptionId `
                        -AccessToken $accessToken -ArmUrl $armUrl -ApiVersion $apiVersion `
                        -ResourceType $SqlResourceType -EditionFilter $Edition `
                        -ComputeModelFilter $ComputeModel -IncludeDisabledSkus -MaxRetries $MaxRetries
                    $visibleCount = @($allSkus | Where-Object { $_.Status -eq 'Visible' }).Count
                    $disabledCount = @($allSkus | Where-Object { $_.Status -eq 'Disabled' }).Count
                    if ($allSkus.Count -gt 0) {
                        $bd = @(); if ($visibleCount) { $bd += "$visibleCount Visible" }; if ($disabledCount) { $bd += "$disabledCount Disabled" }
                        Write-Host "  $($icons.Warning) $regionCode`: 0 available ($($bd -join ', ') — use -IncludeDisabled)" -ForegroundColor Yellow
                    }
                    else {
                        Write-Host "  $($icons.Check) $regionCode`: 0 SKUs" -ForegroundColor DarkGray
                    }
                }
                else {
                    Write-Host "  $($icons.Check) $regionCode`: $($skus.Count) SKUs" -ForegroundColor Green
                }
            }
        }
        catch {
            if (-not $Quiet) {
                Write-Host "  $($icons.Error) $regionCode`: $($_.Exception.Message)" -ForegroundColor Red
            }
            else {
                Write-Verbose "SQL scan failed for $regionCode`: $($_.Exception.Message)"
            }
        }
    }

    return $allResults
}
