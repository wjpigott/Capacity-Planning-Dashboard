# Azure PaaS Service Inventory — API Availability for Get-AzPaaSAvailability

## How to Read This Document

Each service is classified by **API richness** — how closely its APIs match the patterns in Get-AzVMAvailability:

| Signal | VM Tool Pattern | What We Need From PaaS |
|--------|----------------|----------------------|
| **SKU Discovery** | `Microsoft.Compute/skus` | Per-region list of available tiers/SKUs with status |
| **Restrictions** | SKU `restrictions[]` | Subscription-level blocks, allowlisting requirements |
| **Quota/Usage** | `Get-AzVMUsage` | currentValue / limit for the primary deployment-blocking metric |
| **Zone Info** | `locationInfo.zones` | AZ support per SKU or per region |
| **Pricing** | `prices.azure.com` | Retail pricing with serviceName filter |

---

## TIER 1 — Rich Capabilities API (Full SKU + Quota + Zone + Pricing)

These services have dedicated capabilities/SKU discovery APIs that return structured per-SKU availability with status, zone redundancy, and quota — directly analogous to the VM tool.

### 1. Azure SQL Database & Managed Instance ✅ IMPLEMENTED

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **Capabilities** | `GET .../Microsoft.Sql/locations/{r}/capabilities?api-version=2021-11-01` | Editions → SKUs with status (Available/Default/Visible/Disabled), vCores, zone redundancy, compute model, license types, storage redundancy |
| **Quota** | `GET .../Microsoft.Sql/locations/{r}/usages` | `ServerQuota`, `RegionalVCoreQuotaForSQLDBAndDW` (currentValue/limit) |
| **Pricing** | `prices.azure.com?serviceName=SQL Database` | Per-vCore-hour pricing |
| **Optional filter** | `?include=supportedEditions\|supportedManagedInstanceVersions\|supportedElasticPoolEditions` | Scopes response to specific resource type |

**Status:** ✅ Implemented in MVP (SQL Database + Managed Instance)

---

### 2. Azure Cosmos DB ✅ IMPLEMENTED

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **Region Access** | `GET .../Microsoft.DocumentDB/locations?api-version=2025-10-15` | Per-region: `supportsAvailabilityZone`, `isSubscriptionRegionAccessAllowedForAz`, `isSubscriptionRegionAccessAllowedForRegular`, `isResidencyRestricted`, `backupStorageRedundancies`, `status` |
| **Pricing** | `prices.azure.com?serviceName=Azure Cosmos DB` | Per-100-RU/hr pricing |

**Status:** ✅ Implemented in MVP. Single API call returns ALL regions.

---

### 3. Azure Database for PostgreSQL — Flexible Server

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **Capabilities** | `GET .../Microsoft.DBforPostgreSQL/flexibleServers/capabilities?api-version=2024-08-01` | Compute tiers (Burstable/GeneralPurpose/MemoryOptimized), specific SKU names (Standard_D2s_v3 etc.), storage options (32GB–64TB), HA support, zone availability, node types, supported PostgreSQL versions |
| **Quota** | via Azure Resource Manager quota APIs | vCore quotas per family |
| **Pricing** | `prices.azure.com?serviceName=Azure Database for PostgreSQL` | Per-vCore-hour by tier |

**Key fields:** `supportedServerEditions[]` → `supportedStorageEditions[]`, `supportedServerSkus[]` with `name`, `vCores`, `supportedHaMode`
**Zone info:** Per-SKU `supportedZones[]` 
**Implementation complexity:** Medium — nested JSON similar to SQL capabilities

---

### 4. Azure Database for MySQL — Flexible Server

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **Capabilities** | `GET .../Microsoft.DBforMySQL/flexibleServers/capabilities?api-version=2023-12-30` | Same pattern as PostgreSQL: compute tiers, SKU names, storage, HA, zone support |
| **Quota** | via Azure Resource Manager quota APIs | vCore quotas per family |
| **Pricing** | `prices.azure.com?serviceName=Azure Database for MySQL` | Per-vCore-hour by tier |

**Implementation complexity:** Low — nearly identical structure to PostgreSQL. Could share a common parser with PostgreSQL.

---

### 5. App Service (Web Apps + Function Apps)

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **Geo Regions** | `GET .../providers/Microsoft.Web/geoRegions?sku={sku}&api-version=2024-04-01` | Which regions support each SKU tier (Free/Shared/Basic/Standard/Premium/PremiumV2/PremiumV3/Isolated/IsolatedV2) |
| **Available Stacks** | `GET .../providers/Microsoft.Web/availableStacks?api-version=2024-04-01` | Runtime stacks (dotnet, node, python, java, php) with versions, deprecation flags |
| **SKU availability** | `GET .../subscriptions/{subId}/providers/Microsoft.Web/geoRegions?sku={sku}` | Subscription-scoped region availability per SKU |
| **Quota/Usage** | `GET .../subscriptions/{subId}/providers/Microsoft.Web/locations/{r}/usages` | App Service Plan quotas (numberOfWorkers, memory, etc.) |
| **Pricing** | `prices.azure.com?serviceName=Azure App Service` | Per-instance-hour by SKU |

**Key insight:** Unlike SQL, App Service uses a "geo-region" model — you query which regions support a given SKU, not which SKUs are available in a given region. The tool needs to invert this for the region-first display.
**Zone info:** Available via `properties.zoneRedundant` on App Service Plan resources
**Implementation complexity:** Medium — geo-region inversion required, but APIs are fast

---

### 6. Container Apps

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **Workload Profiles** | `GET .../Microsoft.App/locations/{r}/availableManagedEnvironmentsWorkloadProfileTypes?api-version=2024-03-01` | Available workload profile types per region: Consumption, Dedicated (D4–D32, E4–E32, NC-series GPU profiles) with `displayName`, `cores`, `memoryGiB`, `category` |
| **Quota/Usage** | via Azure Resource Manager quota APIs | Managed environment quotas |
| **Pricing** | `prices.azure.com?serviceName=Azure Container Apps` | Per-vCPU-second + per-GiB-second |

**Key fields:** `properties.displayName`, `properties.cores`, `properties.memoryGiB`, `properties.category` (Consumption/GeneralPurpose/MemoryOptimized/GPU)
**Implementation complexity:** Low — flat response, one call per region

---

## TIER 2 — SKU Discovery via Resource Provider (Less structured, still useful)

These services have SKU information but through less structured APIs — often the provider registration or resource type enumeration rather than a dedicated capabilities endpoint.

### 7. Azure Cache for Redis

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **SKUs** | Static — Basic (C0–C6), Standard (C0–C6), Premium (P1–P5), Enterprise (E5–E200), Enterprise Flash (F300–F1500) | No dynamic capabilities API; SKU catalog is documented/fixed |
| **Existing instances** | `GET .../Microsoft.Cache/redis?api-version=2024-03-01` | Lists existing caches with SKU, capacity, zones, features |
| **Check availability** | `GET .../Microsoft.Cache/locations/{r}/checkNameAvailability` | Tests if Redis name is available (confirms region support) |
| **Pricing** | `prices.azure.com?serviceName=Azure Cache for Redis` | Per-hour by tier/capacity |

**Key insight:** Redis doesn't have a capabilities API like SQL. But you can enumerate the known SKU matrix and check pricing + provider registration per region. Enterprise tiers have limited regional availability.
**Implementation:** Build a static SKU table, validate against pricing API per region (if pricing exists for that SKU in that region, it's available)

---

### 8. Azure AI Search (Cognitive Search)

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **SKUs** | Static — Free, Basic, S1, S2, S3, S3 HD, L1, L2 | No dynamic capabilities API |
| **Service Stats** | `GET .../Microsoft.Search/searchServices?api-version=2024-06-01-preview` | Lists existing services with SKU, partitions, replicas |
| **Quota** | `GET .../Microsoft.Search/locations/{r}/usages` | Service count limits per subscription per region |
| **Pricing** | `prices.azure.com?serviceName=Azure AI Search` | Per-hour by tier |

**Implementation:** Static SKU table + quota API + pricing validation

---

### 9. Azure Kubernetes Service (AKS)

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **Orchestrator versions** | `GET .../Microsoft.ContainerService/locations/{r}/orchestrators?api-version=2024-09-01` | Kubernetes versions available per region with `isPreview`, `isDefault` |
| **VM SKUs** | Already covered by Get-AzVMAvailability (node pools use VM SKUs) | — |
| **OS images** | `GET .../Microsoft.ContainerService/locations/{r}/osImages?api-version=2024-09-01` | Available node OS images |
| **Pricing** | `prices.azure.com?serviceName=Azure Kubernetes Service` | AKS management fee (free/standard/premium tier) |

**Key insight:** AKS node pool capacity is VM SKU capacity (your existing tool). The AKS-specific value is orchestrator version availability and AKS tier features per region.
**Implementation complexity:** Low — complement to VM tool

---

### 10. Azure SignalR Service

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **SKU list** | `GET .../Microsoft.SignalRService/locations/{r}/usages?api-version=2024-03-01` | Quotas per region |
| **Check availability** | `GET .../Microsoft.SignalRService/locations/{r}/checkNameAvailability` | Region + name validation |
| **Pricing** | `prices.azure.com?serviceName=Azure SignalR Service` | Per-unit-hour |

---

### 11. Azure Spring Apps (deprecated → Container Apps)

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **SKUs** | `GET .../Microsoft.AppPlatform/skus?api-version=2024-05-01-preview` | Enterprise/Standard/Basic tier availability |
| **Note** | Microsoft is **deprecating Azure Spring Apps** in favor of Container Apps | Include with deprecation notice |

---

## TIER 3 — Throughput/Capacity-Based (Not SKU-based, but quota-relevant)

These services don't have per-SKU availability but have quota/capacity limits that block deployments.

### 12. Azure Event Hubs

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **Clusters** | `GET .../Microsoft.EventHub/clusters?api-version=2024-01-01` | Dedicated cluster capacity |
| **Namespaces** | `GET .../Microsoft.EventHub/namespaces?api-version=2024-01-01` | Existing namespaces with SKU (Basic/Standard/Premium), capacity units |
| **Check availability** | `GET .../Microsoft.EventHub/checkNameAvailability` | Name/region validation |
| **Pricing** | `prices.azure.com?serviceName=Event Hubs` | Per-TU-hour or per-PU-hour |

**Tiers:** Basic (1 consumer group), Standard (20 CGs, 1 TU default), Premium (1 PU, zone isolation), Dedicated (20 CU cluster)

---

### 13. Azure Service Bus

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **Namespaces** | `GET .../Microsoft.ServiceBus/namespaces?api-version=2022-10-01-preview` | Existing namespaces with SKU (Basic/Standard/Premium), capacity MU |
| **Check availability** | `GET .../Microsoft.ServiceBus/checkNameAvailability` | Name/region validation |
| **Quota** | Premium tier has messaging unit (MU) quotas | 1, 2, 4, 8, 16 MUs |
| **Pricing** | `prices.azure.com?serviceName=Service Bus` | Per-hour by tier + MU |

---

### 14. Azure Storage Accounts

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **SKUs** | `GET .../Microsoft.Storage/skus?api-version=2023-05-01` | All storage SKU names per region with `kind` (Storage, StorageV2, BlobStorage, BlockBlobStorage, FileStorage), `tier` (Standard, Premium), `capabilities` |
| **Check availability** | `GET .../Microsoft.Storage/checkNameAvailability` | Name validation |
| **Quota/Usage** | `GET .../Microsoft.Storage/locations/{r}/usages` | Storage account count limits |
| **Pricing** | `prices.azure.com?serviceName=Storage` | Per-GB-month, per-transaction |

**Key fields:** `properties.capabilities[]` with `name` (supportsFileEncryption, supportsHns, etc.), `restrictions[]` with reason codes
**Implementation complexity:** Low — structured similarly to Compute SKUs

---

### 15. Azure API Management

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **SKUs** | Static — Consumption, Developer, Basic, Standard, Premium, Isolated | Region-dependent |
| **Check availability** | `GET .../Microsoft.ApiManagement/checkNameAvailability` | Name/region validation |
| **Quota** | Per-region service count limits | Varies by tier |
| **Pricing** | `prices.azure.com?serviceName=API Management` | Per-hour by tier |

---

### 16. Azure Functions (Flex Consumption)

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **SKUs** | App Service APIs apply for Dedicated/Premium plans | Flex Consumption uses `Microsoft.Web/locations/{r}/functionAppStacks` |
| **Function Stacks** | `GET .../providers/Microsoft.Web/functionAppStacks?api-version=2024-04-01` | Runtime stacks (dotnet-isolated, node, python, java, powershell) with `isDefault`, `isDeprecated`, `endOfLifeDate` |
| **Pricing** | `prices.azure.com?serviceName=Functions` | Per-execution + per-GB-second |

**Note:** Consumption plan capacity is abstracted (auto-scales). Dedicated/Premium plans use App Service SKUs (covered by #5). Flex Consumption is the new tier with instance-based scaling.

---

### 17. Azure Cognitive Services / AI Services

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **Account types** | `GET .../Microsoft.CognitiveServices/locations/{r}/resourceTypes?api-version=2024-10-01` | Available Cognitive Services kinds per region |
| **Models** | Already covered by Get-AzAIModelAvailability | — |
| **Quota** | `GET .../Microsoft.CognitiveServices/locations/{r}/usages?api-version=2024-10-01` | TPM quotas, deployment limits |
| **Pricing** | `prices.azure.com?serviceName=Cognitive Services` | Per-1K transactions |

**Note:** Model availability is your existing AI tool. The PaaS tool could add the *account type* availability (which kinds of Cognitive Services are available per region: Speech, Vision, Language, OpenAI, etc.)

---

### 18. Azure Data Factory / Synapse

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **Check availability** | `GET .../Microsoft.DataFactory/locations/{r}/checkNameAvailability` | Region availability |
| **Integration runtime types** | Static — Azure, Self-hosted, Azure-SSIS | SSIS IR uses VM SKUs |
| **Pricing** | `prices.azure.com?serviceName=Azure Data Factory v2` | Per-pipeline-hour, per-DIU |

---

### 19. Azure Logic Apps

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **Consumption** | Serverless — always available where region exists | No SKU API needed |
| **Standard** | Uses App Service Plan SKUs (WS1/WS2/WS3) | Covered by App Service |
| **Pricing** | `prices.azure.com?serviceName=Logic Apps` | Per-action, per-connector |

---

### 20. Azure Notification Hubs

| API | Endpoint | What It Returns |
|-----|----------|----------------|
| **Check availability** | `GET .../Microsoft.NotificationHubs/checkNamespaceAvailability` | Region validation |
| **Tiers** | Free, Basic, Standard | Static per region |
| **Pricing** | `prices.azure.com?serviceName=Notification Hubs` | Per-push + per-namespace |

---

## TIER 4 — Provider Registration + Pricing Only

These services don't have SKU discovery APIs but can be validated by checking if the resource provider is registered and if pricing exists for the region.

| # | Service | Provider | Pricing serviceName | Tiers |
|---|---------|----------|-------------------|-------|
| 21 | **Azure Front Door** | Microsoft.Cdn / Microsoft.Network | `Azure Front Door Service` | Standard, Premium |
| 22 | **Azure DNS** | Microsoft.Network | `Azure DNS` | Public, Private |
| 23 | **Azure Key Vault** | Microsoft.KeyVault | `Key Vault` | Standard, Premium (HSM) |
| 24 | **Azure Monitor / Log Analytics** | Microsoft.OperationalInsights | `Log Analytics` | Per-GB, Commitment tiers |
| 25 | **Azure Container Registry** | Microsoft.ContainerRegistry | `Container Registry` | Basic, Standard, Premium |
| 26 | **Azure App Configuration** | Microsoft.AppConfiguration | `App Configuration` | Free, Standard |
| 27 | **Azure IoT Hub** | Microsoft.Devices | `IoT Hub` | Free, Basic (B1–B3), Standard (S1–S3) |
| 28 | **Azure Managed Grafana** | Microsoft.Dashboard | `Azure Managed Grafana` | Essential, Standard |
| 29 | **Azure Static Web Apps** | Microsoft.Web | `Azure Static Web Apps` | Free, Standard |
| 30 | **Azure Communication Services** | Microsoft.Communication | `Communication Services` | Pay-as-you-go |

---

## Implementation Plan

### Phase 1 — MVP ✅ DONE
- [x] Azure SQL Database (capabilities + usages + pricing)
- [x] Azure SQL Managed Instance (capabilities)
- [x] Azure Cosmos DB (locations access flags)

### Phase 2 — Database Family (v0.2.0)
- [ ] PostgreSQL Flexible Server (capabilities API — same pattern as SQL)
- [ ] MySQL Flexible Server (capabilities API — same parser, different provider)
- [ ] Shared `Get-DatabaseCapabilities` function with provider parameter

### Phase 3 — Compute PaaS (v0.3.0)
- [ ] App Service Plans (geoRegions + available stacks + usages)
- [ ] Container Apps (workload profiles per region)
- [ ] Azure Functions stacks (function app runtime availability)
- [ ] AKS orchestrator versions (complement to VM tool)

### Phase 4 — Data & Messaging (v0.4.0)
- [ ] Event Hubs (tier availability + cluster quotas)
- [ ] Service Bus (tier availability + MU quotas)
- [ ] Azure Storage (SKU list + quotas per region)
- [ ] Azure AI Search (static tiers + quota API)

### Phase 5 — Full Catalog (v0.5.0)
- [ ] Redis Cache (static SKU matrix + pricing validation)
- [ ] API Management (tier availability)
- [ ] Cognitive Services account types (complement to AI model tool)
- [ ] Azure Container Registry (tier availability)
- [ ] Key Vault, App Configuration, Front Door, etc. (Tier 4 services)

### Phase 6 — Cross-Service Intelligence (v1.0.0)
- [ ] **Region Health Matrix** — single table showing all services' availability per region
- [ ] **Fleet mode** — BOM-style "I need SQL Hyperscale + Cosmos DB + AKS + Redis in eastus2 — can I get it?"
- [ ] **Recommend mode** — "I need a relational DB with zone redundancy and AHUB — what are my cheapest options?"
- [ ] **Compare mode** — side-by-side region comparison (like VM tool's multi-region matrix)
- [ ] **Export** — unified XLSX with one sheet per service + summary sheet

---

## Architecture Impact

### `-Service` Parameter Growth

Current: `SqlDatabase | CosmosDB | All`

Target:
```powershell
[ValidateSet(
    "SqlDatabase", "CosmosDB",                          # Phase 1 ✅
    "PostgreSQL", "MySQL",                               # Phase 2
    "AppService", "ContainerApps", "Functions", "AKS",  # Phase 3
    "EventHubs", "ServiceBus", "Storage", "AISearch",   # Phase 4
    "Redis", "APIM", "CognitiveServices", "ACR",        # Phase 5
    "All"
)]
[string[]]$Service = "All"
```

Note: `$Service` becomes `[string[]]` (array) to support multi-select like `-Service SqlDatabase,CosmosDB,AppService`.

### Function per Service Pattern

Each service gets a pair of functions:
```
Get-{Service}Capabilities    → Calls the provider API, returns [PSCustomObject[]]
Format-{Service}Display      → Handles the Write-Host rendering
```

Shared functions:
```
Get-PaaSPricing              → Already exists, reusable across all services
Get-PaaSQuota                → New generic quota function for providers that use ARM quota API
Test-ProviderRegistered      → Check if a resource provider is registered in the subscription
```

### Estimated Final Size

| Phase | New Lines | Running Total | Services |
|-------|-----------|---------------|----------|
| Phase 1 (MVP) | ~1,260 | 1,260 | 3 |
| Phase 2 | ~200 | 1,460 | 5 |
| Phase 3 | ~500 | 1,960 | 9 |
| Phase 4 | ~400 | 2,360 | 13 |
| Phase 5 | ~400 | 2,760 | 18+ |
| Phase 6 | ~500 | 3,260 | 18+ (cross-service features) |

Target: ~3,000–3,500 lines (vs. 4,442 for the VM tool). Leaner because PaaS APIs do more structured work than the VM tool's raw SKU parsing.

---

## API Reference Quick Index

| Service | Provider Namespace | Capabilities Endpoint | Quota Endpoint | Pricing serviceName |
|---------|--------------------|----------------------|---------------|-------------------|
| SQL Database | Microsoft.Sql | `.../locations/{r}/capabilities` | `.../locations/{r}/usages` | `SQL Database` |
| SQL MI | Microsoft.Sql | Same (with `?include=`) | Same | `SQL Database` |
| Cosmos DB | Microsoft.DocumentDB | `.../locations` | N/A | `Azure Cosmos DB` |
| PostgreSQL Flex | Microsoft.DBforPostgreSQL | `.../flexibleServers/capabilities` | ARM quota API | `Azure Database for PostgreSQL` |
| MySQL Flex | Microsoft.DBforMySQL | `.../flexibleServers/capabilities` | ARM quota API | `Azure Database for MySQL` |
| App Service | Microsoft.Web | `.../geoRegions?sku={sku}` | `.../locations/{r}/usages` | `Azure App Service` |
| Container Apps | Microsoft.App | `.../locations/{r}/availableManagedEnvironmentsWorkloadProfileTypes` | ARM quota API | `Azure Container Apps` |
| Functions | Microsoft.Web | `.../functionAppStacks` | App Service usages | `Functions` |
| AKS | Microsoft.ContainerService | `.../locations/{r}/orchestrators` | N/A (VM quotas) | `Azure Kubernetes Service` |
| Event Hubs | Microsoft.EventHub | N/A (static tiers) | Namespace limits | `Event Hubs` |
| Service Bus | Microsoft.ServiceBus | N/A (static tiers) | Namespace limits | `Service Bus` |
| Storage | Microsoft.Storage | `.../skus` | `.../locations/{r}/usages` | `Storage` |
| Redis | Microsoft.Cache | N/A (static SKUs) | N/A | `Azure Cache for Redis` |
| AI Search | Microsoft.Search | N/A (static tiers) | `.../locations/{r}/usages` | `Azure AI Search` |
| APIM | Microsoft.ApiManagement | N/A (static tiers) | Per-region limits | `API Management` |
| ACR | Microsoft.ContainerRegistry | N/A (static tiers) | N/A | `Container Registry` |
| Cognitive Services | Microsoft.CognitiveServices | `.../locations/{r}/resourceTypes` | `.../locations/{r}/usages` | `Cognitive Services` |
