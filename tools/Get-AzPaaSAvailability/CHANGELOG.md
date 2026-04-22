# Changelog

## [0.5.0] - 2026-03-25

### Added
- **9 Azure PaaS services** with dedicated scanning cmdlets:
  - `Get-AzSqlAvailability` — SQL Database + Managed Instance SKU/tier discovery, vCore quota, zone redundancy
  - `Get-AzCosmosDBAvailability` — Subscription-level region access flags (AZ + Regular)
  - `Get-AzPostgreSqlAvailability` — PostgreSQL Flexible Server compute tiers, IOPS, zones, HA
  - `Get-AzMySqlAvailability` — MySQL Flexible Server SKUs per server version
  - `Get-AzAppServiceAvailability` — App Service Plan SKU geo-region availability with feature flags
  - `Get-AzContainerAppsAvailability` — Container Apps workload profiles (D/E/GPU series)
  - `Get-AzAksAvailability` — AKS Kubernetes version availability with upgrade paths
  - `Get-AzFunctionsAvailability` — Functions runtime stacks with deprecation dates
  - `Get-AzStorageAvailability` — Storage account SKUs with restrictions and zone support
- **15 static-tier services** via `Get-AzServiceTierAvailability` (pricing API validation):
  Redis, Event Hubs, Service Bus, AI Search, APIM, ACR, Key Vault, Front Door,
  Log Analytics, App Config, IoT Hub, Grafana, Static Web Apps, SignalR, Notification Hubs
- `Get-AzPaaSAvailability` — orchestrator scanning all services with formatted display
- `Show-AzPaaSRegionMatrix` — unified Region Health Matrix (all services × regions)
- `Export-AzPaaSAvailabilityReport` — CSV/XLSX export
- 51 Pester unit tests across 4 test files
- Module-first architecture: Public/Private function separation, zero parent-scope dependencies
- Sovereign cloud support (Azure Government, China, Germany)
- SQL status key: Available/Default/Visible/Disabled with color-coded explainers

### Architecture
- PowerShell module (`AzPaaSAvailability.psd1` + `.psm1`)
- 13 exported public functions
- 14 private functions (Azure infrastructure, providers, formatting, utilities)
- Backward-compatible `Get-AzPaaSAvailability.ps1` wrapper script
