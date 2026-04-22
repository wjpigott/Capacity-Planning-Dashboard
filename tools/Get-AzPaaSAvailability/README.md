# Get-AzPaaSAvailability

Scan Azure PaaS service availability, capacity, quota, and pricing across regions.

![PowerShell](https://img.shields.io/badge/PowerShell-7.0%2B-blue)
![Azure](https://img.shields.io/badge/Azure-Az%20Modules-0078D4)
![License](https://img.shields.io/badge/License-MIT-green)
![Version](https://img.shields.io/badge/Version-0.5.0-brightgreen)

## Disclosure & Disclaimer

The author is a Microsoft employee; however, this is a **personal open-source project**. It is **not** an official Microsoft product, nor is it endorsed, sponsored, or supported by Microsoft.

- **No warranty**: Provided "as-is" under the [MIT License](LICENSE).
- **No official support**: For Azure platform issues, use [Azure Support](https://azure.microsoft.com/support/).
- **No confidential information**: This tool uses only publicly documented Azure APIs.
- **Trademarks**: "Microsoft" and "Azure" are trademarks of Microsoft Corporation.

## See Also

**Part of the Azure Availability Scanner family:**

| Tool | Target |
|------|--------|
| [Get-AzVMAvailability](https://github.com/zacharyluz/Get-AzVMAvailability) | VM SKUs (IaaS compute) |
| [Get-AzAIModelAvailability](https://github.com/zacharyluz/Get-AzAIModelAvailability) | AI models (Cognitive Services) |
| **Get-AzPaaSAvailability** | **PaaS services (24 services)** |

## Installation

```powershell
# Clone the repository
git clone https://github.com/zacharyluz/Get-AzPaaSAvailability.git
cd Get-AzPaaSAvailability

# Install required Azure module (if needed)
Install-Module -Name Az.Accounts -Scope CurrentUser

# Optional: Install ImportExcel for styled XLSX exports
Install-Module -Name ImportExcel -Scope CurrentUser
```

## Quick Start

```powershell
# Import the module
Import-Module ./AzPaaSAvailability

# Scan all services in two regions
Get-AzPaaSAvailability -Region eastus,westus2

# Scan just SQL Database
Get-AzSqlAvailability -Region eastus -Edition Hyperscale

# Check Cosmos DB subscription access
Get-AzCosmosDBAvailability -Region eastus,westeurope

# Pipeline mode (objects only, no display)
$results = Get-AzPaaSAvailability -Region westus2 -Quiet
$results.SqlSkus | Where-Object { $_.ZoneRedundant }

# Export to XLSX
$results | Export-AzPaaSAvailabilityReport -Path C:\Temp
```

### Wrapper Script (No Import Required)

```powershell
# Interactive — prompts for region selection
.\Get-AzPaaSAvailability.ps1

# Automated scan with region preset
.\Get-AzPaaSAvailability.ps1 -RegionPreset USMajor -NoPrompt

# SQL-focused scan with auto-export
.\Get-AzPaaSAvailability.ps1 -Service SqlDatabase -Edition Hyperscale -AutoExport

# JSON output for automation
.\Get-AzPaaSAvailability.ps1 -Region eastus -NoPrompt -JsonOutput
```

## Services Covered (24 total)

### Tier 1 — Dedicated Capabilities API (9 services)

| Service | Cmdlet | What You Get |
|---------|--------|-------------|
| SQL Database + MI | `Get-AzSqlAvailability` | SKUs, vCore quota, zone redundancy, AHUB, status (Available/Visible/Disabled) |
| Cosmos DB | `Get-AzCosmosDBAvailability` | Subscription region access flags, AZ support, residency restrictions |
| PostgreSQL Flex | `Get-AzPostgreSqlAvailability` | Compute tiers, vCores, IOPS, memory, zone support, HA mode |
| MySQL Flex | `Get-AzMySqlAvailability` | SKUs per server version (5.7/8.0/8.4/9.3), storage, geo-backup |
| App Service | `Get-AzAppServiceAvailability` | SKU tier availability per region with zone/Linux/Functions/container flags |
| Container Apps | `Get-AzContainerAppsAvailability` | Workload profiles (Consumption, D4-D32, E4-E32, GPU) |
| AKS | `Get-AzAksAvailability` | Kubernetes versions, preview/GA status, upgrade paths |
| Functions | `Get-AzFunctionsAvailability` | Runtime stacks, versions, deprecation dates, platform (Linux/Windows) |
| Storage | `Get-AzStorageAvailability` | SKUs per region with tier, kind, zones, restrictions |

### Tier 2-4 — Pricing API Validation (15 services)

| Service | Known Tiers |
|---------|-------------|
| Redis Cache | Basic/Standard/Premium/Enterprise |
| Event Hubs | Basic/Standard/Premium/Dedicated |
| Service Bus | Basic/Standard/Premium |
| AI Search | Free/Basic/S1-S3/L1-L2 |
| API Management | Consumption/Developer/Basic/Standard/Premium |
| Container Registry | Basic/Standard/Premium |
| Key Vault | Standard/Premium (HSM) |
| Front Door | Standard/Premium |
| Log Analytics | Pay-as-you-go/Commitment Tiers |
| App Configuration | Free/Standard |
| IoT Hub | Free/Basic/Standard |
| Managed Grafana | Essential/Standard |
| Static Web Apps | Free/Standard |
| SignalR Service | Free/Standard/Premium |
| Notification Hubs | Free/Basic/Standard |

```powershell
# Check specific static-tier services
Get-AzServiceTierAvailability -Region eastus -ServiceFilter Redis,EventHubs,ServiceBus
```

## Region Health Matrix

When scanning multiple services, the orchestrator renders a unified matrix:

```
REGION HEALTH MATRIX — All Services
Region           | SQL         Cosmos      PgSQL       MySQL       AppSvc      ContApp     AKS         Funcs       Storage
eastus           | ⚠ 0         ✗ BLOCK     -           -           ✓ 9         ✓ 12        ✓ 25        ✓ 50        ✓ 26
westus2          | ✓ 160       ✓ OK        ✓ 71        ✓ 213       ✓ 9         ✓ 11        ✓ 25        ✓ 50        ✓ 26
```

## Module Architecture

```
AzPaaSAvailability/
├── AzPaaSAvailability.psd1              # Module manifest
├── AzPaaSAvailability.psm1              # Auto-loader
├── Public/                               # 13 exported functions
│   ├── Get-AzPaaSAvailability.ps1       # Orchestrator (all services + display)
│   ├── Get-AzSqlAvailability.ps1
│   ├── Get-AzCosmosDBAvailability.ps1
│   ├── Get-AzPostgreSqlAvailability.ps1
│   ├── Get-AzMySqlAvailability.ps1
│   ├── Get-AzAppServiceAvailability.ps1
│   ├── Get-AzContainerAppsAvailability.ps1
│   ├── Get-AzAksAvailability.ps1
│   ├── Get-AzFunctionsAvailability.ps1
│   ├── Get-AzStorageAvailability.ps1
│   ├── Get-AzServiceTierAvailability.ps1
│   ├── Show-AzPaaSRegionMatrix.ps1
│   └── Export-AzPaaSAvailabilityReport.ps1
└── Private/                              # 14 internal functions
    ├── Azure/     (retry, endpoints, token, pricing)
    ├── Providers/ (SQL, Cosmos, PgSQL, MySQL, AppSvc, ContainerApps, AKS, Functions, Storage, StaticTiers)
    ├── Format/    (banner, footer, status key, colors)
    └── Utility/   (SafeString, GeoGroup, StatusIcon, IconSet)
```

## Requirements

- PowerShell 7+
- Az.Accounts module
- Azure login (`Connect-AzAccount`)
- Optional: ImportExcel module (for XLSX export)

## Testing

```powershell
# Run all tests
Invoke-Pester ./tests -Output Detailed

# 51 tests covering:
# - Helper functions (SafeString, GeoGroup, Icons, StatusColor)
# - SQL capabilities parsing (System filter, status filter, AHUB, zones, editions)
# - SQL quota parsing (ServerQuota, vCore quota)
# - Cosmos DB access detection (full access, blocked, AZ-only, residency)
# - PostgreSQL capabilities (editions, zones, memory calc, storage)
# - MySQL capabilities (versions, SKUs, storage, geo-backup)
```

## License

MIT
