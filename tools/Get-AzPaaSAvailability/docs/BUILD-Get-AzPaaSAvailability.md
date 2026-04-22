# Get-AzPaaSAvailability — Build Document

## Overview

**Get-AzPaaSAvailability** is a PowerShell 7+ tool that scans Azure regions for PaaS compute service availability, capacity, quota, and pricing. It is the third tool in the Azure Availability Scanner family:

| Tool | Target | Status |
|------|--------|--------|
| `Get-AzVMAvailability` | VM SKUs (IaaS compute) | Released (v1.12.1) |
| `Get-AzAIModelAvailability` | AI models (Cognitive Services) | Released (v1.0.1) |
| **`Get-AzPaaSAvailability`** | **PaaS compute services** | **MVP planned** |

The tool answers: *"Can I deploy this PaaS service in this region with my subscription?"* — surfacing hidden quota limits, subscription-level access blocks, SKU availability status, zone redundancy, and pricing in one scan.

---

## MVP Scope: Two Services

### Service 1: Azure SQL Database & Managed Instance

Azure SQL has the richest PaaS capabilities API — it returns structured SKU objects with availability status, zone redundancy, performance tiers, and storage options per region. Combined with the subscription-level vCore quota API, it provides a complete analog to the VM tool's SKU + Quota pattern.

#### API Endpoints

| Purpose | Endpoint | API Version | Auth |
|---------|----------|------------|------|
| **SKU/Tier discovery** | `GET /subscriptions/{subId}/providers/Microsoft.Sql/locations/{region}/capabilities` | `2021-11-01` | Bearer token |
| **Quota (all metrics)** | `GET /subscriptions/{subId}/providers/Microsoft.Sql/locations/{region}/usages` | `2021-11-01` | Bearer token |
| **Quota (specific)** | `GET /subscriptions/{subId}/providers/Microsoft.Sql/locations/{region}/usages/{usageName}` | `2021-11-01` | Bearer token |
| **Pricing** | `GET https://prices.azure.com/api/retail/prices?$filter=serviceName eq 'SQL Database'` | N/A (public) | None |

#### SQL Capabilities API Response Structure

```
LocationCapabilities
├── name: "East US"
├── status: Available|Default|Visible|Disabled
├── supportedServerVersions[]                    ← SQL Database
│   └── supportedEditions[]
│       ├── name: "Hyperscale" | "BusinessCritical" | "GeneralPurpose"
│       ├── status: Available|Default|Disabled
│       ├── zoneRedundant: true|false
│       ├── supportedStorageCapabilities[]: GRS|LRS|ZRS|GZRS
│       └── supportedServiceLevelObjectives[]    ← Individual SKUs
│           ├── name: "HS_Gen5_8"
│           ├── status: Available|Default|Disabled|Visible
│           ├── performanceLevel: { value: 8, unit: "VCores" }
│           ├── sku: { name: "HS_Gen5", tier: "Hyperscale", family: "Gen5", capacity: 8 }
│           ├── zoneRedundant: true|false
│           ├── computeModel: "Provisioned" | "Serverless"
│           ├── supportedLicenseTypes[]: LicenseIncluded | BasePrice (AHUB)
│           └── supportedMaintenanceConfigurations[]
│
├── supportedManagedInstanceVersions[]            ← Managed Instance
│   └── supportedEditions[]
│       ├── name: "GeneralPurpose" | "BusinessCritical" | "Hyperscale"
│       └── supportedFamilies[]
│           ├── name: "Gen5"
│           ├── sku: "GP_Gen5"
│           └── supportedVcoresValues[]
│               ├── name: "8", value: 8
│               ├── instancePoolSupported: true|false
│               ├── standaloneSupported: true|false
│               ├── includedMaxSize: { limit: 262144, unit: "Megabytes" }
│               └── supportedStorageSizes[]
│
└── supportedInstancePoolEditions[]               ← Instance Pools
    └── supportedFamilies[]
        └── supportedVcoresValues[]
```

**Optional filter parameter:** `?include=supportedEditions|supportedManagedInstanceVersions|supportedElasticPoolEditions|supportedInstancePoolEditions` — restricts the response to specific capability groups for faster calls.

#### SQL Subscription Usages API Response

```json
{
  "value": [
    {
      "name": "ServerQuota",
      "properties": {
        "displayName": "Regional Server Quota for East US",
        "currentValue": 5,
        "limit": 20,
        "unit": "Count"
      }
    },
    {
      "name": "RegionalVCoreQuotaForSQLDBAndDW",
      "properties": {
        "displayName": "Regional vCore Quota for SQL DB and DW for East US",
        "currentValue": 24,
        "limit": 100,
        "unit": "Count"
      }
    },
    {
      "name": "SubscriptionFreeDatabaseCount",
      "properties": {
        "displayName": "Free Database Count per Subscription",
        "currentValue": 0,
        "limit": 1,
        "unit": "Count"
      }
    }
  ]
}
```

**Key metric:** `RegionalVCoreQuotaForSQLDBAndDW` — this is the deployment blocker. When `currentValue` approaches `limit`, customers cannot deploy additional vCore-based SQL DBs or Synapse DW instances. This is the SQL equivalent of VM family vCPU quotas.

#### SQL Output Format

```
REGION: eastus
=====================================================================================================
Edition            | SKU          | vCores | Zone | Compute    | License   | Status    | Quota (vCores)
-------------------|-------------|--------|------|------------|-----------|-----------|---------------
Hyperscale         | HS_Gen5_2   | 2      | ✗    | Provisioned| AHUB+Incl | Available | 24/100
Hyperscale         | HS_Gen5_4   | 4      | ✗    | Provisioned| AHUB+Incl | Available | 24/100
Hyperscale         | HS_Gen5_8   | 8      | ✗    | Provisioned| AHUB+Incl | Default   | 24/100
BusinessCritical   | BC_Gen5_4   | 4      | ✓    | Provisioned| AHUB+Incl | Available | 24/100
BusinessCritical   | BC_Gen5_8   | 8      | ✓    | Provisioned| AHUB+Incl | Available | 24/100
BusinessCritical   | BC_M_128    | 128    | ✗    | Provisioned| AHUB+Incl | Available | 24/100
GeneralPurpose     | GP_S_Gen5_2 | 2      | ✗    | Serverless | AHUB+Incl | Available | 24/100
-------------------|-------------|--------|------|------------|-----------|-----------|---------------
Server Quota: 5/20 | vCore Quota: 24/100
```

---

### Service 2: Azure Cosmos DB

Cosmos DB uses a different paradigm — instead of per-SKU availability, it exposes **subscription-level region access control**. The Locations API reveals whether your subscription is even allowed to create Cosmos DB accounts (AZ or non-AZ) in each region.

#### API Endpoints

| Purpose | Endpoint | API Version | Auth |
|---------|----------|------------|------|
| **Region access** | `GET /subscriptions/{subId}/providers/Microsoft.DocumentDB/locations` | `2025-10-15` | Bearer token |
| **Pricing** | `GET https://prices.azure.com/api/retail/prices?$filter=serviceName eq 'Azure Cosmos DB'` | N/A (public) | None |

#### Cosmos DB Locations API Response Structure

```json
{
  "value": [
    {
      "name": "westeurope",
      "type": "Microsoft.DocumentDB/locations",
      "properties": {
        "supportsAvailabilityZone": true,
        "isResidencyRestricted": false,
        "isSubscriptionRegionAccessAllowedForAz": false,
        "isSubscriptionRegionAccessAllowedForRegular": false,
        "backupStorageRedundancies": ["Geo", "Zone", "Local"],
        "status": "Online"
      }
    }
  ]
}
```

#### How to Interpret Cosmos DB Access Flags

| `supportsAvailabilityZone` | `isSubscriptionRegionAccessAllowedForAz` | `isSubscriptionRegionAccessAllowedForRegular` | What It Means |
|---|---|---|---|
| `true` | `true` | `true` | Full access — can create AZ and non-AZ accounts |
| `true` | `false` | `true` | Can create non-AZ accounts only; AZ blocked |
| `true` | `false` | `false` | **BLOCKED** — must open SR to get allowlisted |
| `false` | N/A | `true` | Region doesn't support AZ; non-AZ accounts OK |
| `false` | N/A | `false` | **BLOCKED** — must open SR to get allowlisted |

**Key insight:** When both `isSubscriptionRegionAccessAllowedForAz` and `isSubscriptionRegionAccessAllowedForRegular` are `false`, the subscription is blocked from creating ANY Cosmos DB accounts in that region. The customer must open an Azure Support Request to get allowlisted. This is exactly the kind of hidden deployment blocker that the VM tool surfaces for SKU restrictions.

#### Cosmos DB Output Format

```
COSMOS DB REGION ACCESS
=====================================================================================================
Region         | AZ Support | Access (AZ)    | Access (Regular) | Residency | Backup       | Status
---------------|------------|----------------|-----------------|-----------|--------------|-------
eastus         | ✓          | ✓ Allowed      | ✓ Allowed       | No        | Geo,Zone,Lcl | Online
eastus2        | ✓          | ✓ Allowed      | ✓ Allowed       | No        | Geo,Zone,Lcl | Online
westeurope     | ✓          | ✗ BLOCKED      | ✗ BLOCKED       | No        | Geo,Zone,Lcl | Online
southeastasia  | ✓          | ✓ Allowed      | ✗ BLOCKED       | No        | Geo,Lcl      | Online
brazilsouth    | ✗          | -              | ✓ Allowed       | No        | Geo,Lcl      | Online
---------------|-----------|-+--------------+|-----------------|-----------|--------------|-------
Action Required: westeurope, southeastasia — open SR to request allowlisting
```

---

## Architecture

### Script Structure

```
Get-AzPaaSAvailability.ps1
├── Comment-based help (.SYNOPSIS, .DESCRIPTION, .PARAMETER, .EXAMPLE)
├── [CmdletBinding()] param block
├── #region Configuration
│   ├── Constants, region presets, icon detection
│   └── Service-specific defaults
├── #region Helper Functions
│   ├── Get-SafeString              (from AI model tool)
│   ├── Invoke-WithRetry            (from AI model tool)
│   ├── Get-GeoGroup                (from AI model tool)
│   ├── Get-AzureEndpoints          (from AI model tool)
│   └── Test-ImportExcelModule      (from AI model tool)
├── #region SQL Functions
│   ├── Get-SqlCapabilities         (calls capabilities API)
│   ├── Get-SqlSubscriptionUsages   (calls usages API)
│   └── Format-SqlSkuRow            (formats output row)
├── #region Cosmos DB Functions
│   ├── Get-CosmosDbLocations       (calls locations API)
│   └── Format-CosmosDbRow          (formats output row)
├── #region Pricing Functions
│   └── Get-PaaSPricing             (calls retail prices API)
├── #region Initialize & Authenticate
├── #region Interactive Prompts
├── #region Data Collection
│   ├── Per-region SQL capabilities + usages
│   └── Cosmos DB locations (single call, all regions)
├── #region Display Results
│   ├── SQL per-region tables
│   ├── Cosmos DB access matrix
│   └── Cross-region comparison matrix
├── #region Completion Summary
└── #region Export (CSV/XLSX)
```

### Parameters

```powershell
[CmdletBinding()]
param(
    # --- Common (same as AI model tool) ---
    [string[]]$SubscriptionId,
    [string[]]$Region,
    [string]$RegionPreset,        # USEastWest, USMajor, Europe, etc.
    [switch]$NoPrompt,
    [string]$ExportPath,
    [switch]$AutoExport,
    [string]$OutputFormat = "Auto",  # Auto, CSV, XLSX
    [switch]$UseAsciiIcons,
    [string]$Environment,          # AzureCloud, AzureUSGovernment, etc.
    [int]$MaxRetries = 3,

    # --- PaaS-specific ---
    [ValidateSet("SqlDatabase", "CosmosDB", "All")]
    [string]$Service = "All",      # Which PaaS service(s) to scan

    # --- SQL-specific filters ---
    [ValidateSet("GeneralPurpose", "BusinessCritical", "Hyperscale")]
    [string[]]$Edition,            # Filter SQL editions

    [ValidateSet("Provisioned", "Serverless")]
    [string]$ComputeModel,         # Filter SQL compute model

    [ValidateSet("SqlDatabase", "ManagedInstance", "ElasticPool")]
    [string]$SqlResourceType = "SqlDatabase",  # Which SQL resource type

    [switch]$IncludeDisabled,      # Show Disabled/Visible SKUs too

    # --- Output control ---
    [switch]$JsonOutput,           # Emit JSON instead of Write-Host
    [switch]$FetchPricing          # Include retail pricing (adds ~2-5s)
)
```

### Shared Patterns from Existing Tools

| Pattern | Source | Reuse Strategy |
|---------|--------|----------------|
| `Invoke-WithRetry` | Both tools | Copy verbatim — exponential backoff with 429/503/timeout handling |
| `Get-AzureEndpoints` | Both tools | Copy verbatim — sovereign cloud support |
| `Get-SafeString` | AI model tool | Copy verbatim |
| `Get-GeoGroup` | AI model tool | Copy verbatim |
| Region presets | Both tools | Same preset map (`USEastWest`, `USMajor`, `Europe`, etc.) |
| Icon detection | Both tools | Same Unicode/ASCII detection logic |
| Export pipeline | Both tools | Same CSV/XLSX dual-path with `ImportExcel` detection |
| Banner/header | Both tools | Same `=` separator + colored header pattern |
| `ForEach-Object -Parallel` | VM tool | Use for multi-region SQL scanning (PS7+) |
| String[] normalization | AI model tool | Handle comma-delimited `-File` input |

---

## Data Collection Flow

### SQL Database Flow

```
For each subscription:
  1. Get access token (Get-AzAccessToken)
  2. For each region (parallel if PS7+):
     a. GET .../Microsoft.Sql/locations/{region}/capabilities?api-version=2021-11-01
        → Parse supportedServerVersions → supportedEditions → supportedServiceLevelObjectives
        → Extract: SKU name, vCores, family, tier, zone redundancy, compute model, status
     b. GET .../Microsoft.Sql/locations/{region}/usages?api-version=2021-11-01
        → Extract: ServerQuota, RegionalVCoreQuotaForSQLDBAndDW (currentValue/limit)
     c. (If -FetchPricing) GET prices.azure.com with serviceName='SQL Database'
        → Match SKU meter names to SKU names
  3. Merge per-region results into display-ready objects
```

### Cosmos DB Flow

```
For each subscription:
  1. Get access token (Get-AzAccessToken)
  2. GET .../Microsoft.DocumentDB/locations?api-version=2025-10-15
     → Returns ALL regions in one call (no per-region loop needed)
     → Filter to user-selected regions
     → Extract: AZ support, subscription access flags, backup redundancies, status
  3. (If -FetchPricing) GET prices.azure.com with serviceName='Azure Cosmos DB'
```

### Pricing API Pattern

Same as VM tool — no auth required, OData filter:

```
# SQL Database pricing
$filter = "serviceName eq 'SQL Database' and armRegionName eq '{region}' and priceType eq 'Consumption'"

# Cosmos DB pricing (RU-based)
$filter = "serviceName eq 'Azure Cosmos DB' and armRegionName eq '{region}' and priceType eq 'Consumption'"
```

---

## Output Design

### Display Hierarchy

```
1. Banner (script name, version, subscription, regions, filters, cloud env)
2. Per-Service Sections:
   a. SQL Database
      - Per-region SKU tables (Edition | SKU | vCores | Zone | Compute | License | Status | Quota)
      - Managed Instance table (if SqlResourceType = ManagedInstance)
      - Quota summary per region
   b. Cosmos DB
      - Region access matrix (all regions in one table)
      - Action items for blocked regions
3. Cross-Service Summary
   - Which regions support both services
   - Blocked regions requiring SR action
4. Completion stats (time, scan scope)
5. Export prompt/auto-export
```

### Color Coding

| Condition | Color | Meaning |
|-----------|-------|---------|
| `status = Available/Default` | Green | Ready to deploy |
| `status = Visible` | Yellow | Visible but may have constraints |
| `status = Disabled` | Red | Not available — may require SR |
| Cosmos `AccessAllowed = true` | Green | Subscription has access |
| Cosmos `AccessAllowed = false` | Red | **BLOCKED — open SR** |
| Quota ≥ 80% used | Yellow | Approaching limit |
| Quota = limit | Red | Fully consumed — increase needed |

---

## Export Schema

### SQL Details Sheet

| Column | Type | Source |
|--------|------|--------|
| Region | string | Loop variable |
| ResourceType | string | SqlDatabase / ManagedInstance / ElasticPool |
| Edition | string | `supportedEditions[].name` |
| SKU | string | `supportedServiceLevelObjectives[].name` |
| Family | string | `sku.family` (Gen4/Gen5/M/DC) |
| vCores | int | `performanceLevel.value` |
| ComputeModel | string | `computeModel` (Provisioned/Serverless) |
| ZoneRedundant | bool | `zoneRedundant` |
| AHUBSupported | bool | BasePrice in `supportedLicenseTypes` |
| StorageRedundancy | string | `supportedStorageCapabilities[].storageAccountType` joined |
| Status | string | `status` (Available/Default/Disabled/Visible) |
| ServerQuota_Used | int | Usages API `ServerQuota.currentValue` |
| ServerQuota_Limit | int | Usages API `ServerQuota.limit` |
| VCoreQuota_Used | int | Usages API `RegionalVCoreQuotaForSQLDBAndDW.currentValue` |
| VCoreQuota_Limit | int | Usages API `RegionalVCoreQuotaForSQLDBAndDW.limit` |
| PricePerHour | decimal | Retail Prices API (if -FetchPricing) |
| PricePerMonth | decimal | PricePerHour × 730 |

### Cosmos DB Sheet

| Column | Type | Source |
|--------|------|--------|
| Region | string | `name` |
| SupportsAZ | bool | `supportsAvailabilityZone` |
| SubscriptionAccessAZ | bool | `isSubscriptionRegionAccessAllowedForAz` |
| SubscriptionAccessRegular | bool | `isSubscriptionRegionAccessAllowedForRegular` |
| IsResidencyRestricted | bool | `isResidencyRestricted` |
| BackupRedundancies | string | `backupStorageRedundancies` joined |
| Status | string | `status` (Online/Initializing/Deleting) |
| ActionRequired | string | Derived: "Open SR for AZ access" / "Open SR for region access" / "None" |

---

## Key Design Decisions

### 1. Cosmos DB is NOT SKU-based — that's OK

The VM tool and SQL both have per-SKU rows. Cosmos DB doesn't — it's throughput-based (RU/s). But the **subscription access control** information is the highest-value signal for customers. The question isn't "which Cosmos SKU can I use?" — it's "can I create a Cosmos account in this region at all?" That binary access flag is the equivalent of the VM tool's `NotAllowedForSubscription` restriction.

### 2. SQL Capabilities response is LARGE

The full SQL Capabilities response for one region includes every edition, every SKU, every elastic pool config. Use the `?include=` parameter to scope it:

- `?include=supportedEditions` — SQL Database SKUs only (~80% smaller)
- `?include=supportedManagedInstanceVersions` — MI only
- `?include=supportedElasticPoolEditions` — Elastic Pool only

The script should use the `$SqlResourceType` parameter to select the right `include` value.

### 3. Cosmos DB is a single call (not per-region)

Unlike SQL Capabilities (one call per region), the Cosmos DB Locations API returns ALL regions in one call. This is faster but means the script doesn't need parallel scanning for Cosmos DB — just filter the response to the user's selected regions.

### 4. Pricing is opt-in via -FetchPricing

SQL Database pricing meters are complex (per-vCore-hour base + storage), and Cosmos DB pricing is RU-based. Making pricing opt-in keeps the default scan fast (~2-5s for SQL + Cosmos vs ~8-15s with pricing).

### 5. No Az.Sql module dependency

Like the VM tool (which avoids Az.Compute for REST calls), this tool uses direct REST API calls via `Invoke-RestMethod`. Only `Az.Accounts` is required for `Get-AzContext` and `Get-AzAccessToken`.

---

## Development Phases

### Phase 1: MVP (Target: ~800-1000 lines)

- [ ] Script skeleton with param block, configuration, helper functions
- [ ] `Get-SqlCapabilities` — parse capabilities API for SQL Database SKUs
- [ ] `Get-SqlSubscriptionUsages` — parse usages API for quotas
- [ ] `Get-CosmosDbLocations` — parse locations API for access flags
- [ ] Per-region SQL display tables
- [ ] Cosmos DB access matrix display
- [ ] CSV/XLSX export
- [ ] Pester tests for helper functions + mock API responses

### Phase 2: Enhanced SQL (add ~200 lines)

- [ ] Managed Instance capabilities parsing
- [ ] Elastic Pool capabilities parsing
- [ ] `?include=` parameter optimization
- [ ] SQL pricing integration

### Phase 3: Additional Services (add ~300 lines each)

- [ ] App Service Plans (`Microsoft.Web/georegions` + `Microsoft.Web/locations/usages`)
- [ ] PostgreSQL Flexible Server (`Microsoft.DBforPostgreSQL/locations/{r}/capabilities`)
- [ ] Container Apps workload profiles (`Microsoft.App/locations/{r}/availableManagedEnvironmentsWorkloadProfileTypes`)

### Phase 4: Cross-Service Features

- [ ] Unified region health matrix across all services
- [ ] `-Fleet` mode (BOM validation like VM tool)
- [ ] `-Recommend` mode for tier selection

---

## Testing Strategy

### Unit Tests (Pester)

```powershell
Describe 'Get-SqlCapabilities' {
    It 'parses Available SKUs correctly' { ... }
    It 'filters by Edition' { ... }
    It 'detects zone redundancy' { ... }
    It 'handles empty response' { ... }
    It 'respects Disabled status filter' { ... }
}

Describe 'Get-CosmosDbLocations' {
    It 'detects blocked subscription access' { ... }
    It 'identifies AZ-only blocks' { ... }
    It 'filters to selected regions' { ... }
    It 'handles offline regions' { ... }
}

Describe 'Get-SqlSubscriptionUsages' {
    It 'extracts vCore quota currentValue and limit' { ... }
    It 'extracts ServerQuota correctly' { ... }
    It 'calculates quota percentage' { ... }
}

Describe 'Format-SqlSkuRow' {
    It 'truncates long SKU names' { ... }
    It 'shows correct license type display' { ... }
}
```

### Integration Tests

- Validate against live Azure subscription (requires `Connect-AzAccount`)
- Verify response schema matches expected structure
- Test sovereign cloud endpoints (if accessible)

### Mock Data

Create mock JSON responses from the API docs for offline testing:
- `tests/mocks/sql-capabilities-eastus.json`
- `tests/mocks/sql-usages-eastus.json`
- `tests/mocks/cosmosdb-locations.json`

---

## Repository Structure

```
Get-AzPaaSAvailability/
├── Get-AzPaaSAvailability.ps1          # Main script
├── README.md                            # Usage docs (same format as VM/AI tools)
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE                              # MIT
├── PSScriptAnalyzerSettings.psd1        # Copied from AI model tool
├── Protect_Main_Branch.json
├── .github/
│   ├── copilot-instructions.md
│   └── ISSUE_TEMPLATE/
│       ├── bug_report.md
│       └── feature_request.md
├── tests/
│   ├── SqlCapabilities.Tests.ps1
│   ├── CosmosDbLocations.Tests.ps1
│   ├── HelperFunctions.Tests.ps1
│   └── mocks/
│       ├── sql-capabilities-eastus.json
│       ├── sql-usages-eastus.json
│       └── cosmosdb-locations.json
├── tools/
│   └── Validate-Script.ps1             # Pre-commit validation
└── examples/
    └── sample-queries.md
```

---

## API Reference Quick Links

| API | Documentation |
|-----|--------------|
| SQL Capabilities | https://learn.microsoft.com/en-us/rest/api/sql/capabilities/list-by-location |
| SQL Subscription Usages (List) | https://learn.microsoft.com/en-us/rest/api/sql/subscription-usages/list-by-location |
| SQL Subscription Usages (Get) | https://learn.microsoft.com/en-us/rest/api/sql/subscription-usages/get |
| Cosmos DB Locations | https://learn.microsoft.com/en-us/rest/api/cosmos-db-resource-provider/locations/list |
| Azure Retail Prices | https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices |

---

## Cross-Tool Comparison

### Data Collection Pattern

| Step | VM Tool | AI Model Tool | PaaS Tool (MVP) |
|------|---------|---------------|-----------------|
| Auth | `Get-AzAccessToken` | `Get-AzAccessToken` | `Get-AzAccessToken` |
| Discovery | `Get-AzComputeResourceSku` | `CognitiveServices/.../models` | `Microsoft.Sql/.../capabilities` + `DocumentDB/locations` |
| Restrictions | SKU `restrictions[]` with reason codes | Model `lifecycleStatus` | SQL `status` enum + Cosmos `isSubscriptionRegionAccessAllowed*` |
| Quota | `Get-AzVMUsage` per region | `modelCapacities` per model | `Microsoft.Sql/.../usages` per region |
| Pricing | `prices.azure.com` (VM) | — | `prices.azure.com` (SQL Database, Cosmos DB) |
| Zone info | SKU `locationInfo.zones` | — | SQL `zoneRedundant` bool + Cosmos `supportsAvailabilityZone` |
| Parallel scan | `ForEach-Object -Parallel` | Sequential | `ForEach-Object -Parallel` for SQL; single call for Cosmos |

### Output Pattern

| Element | VM Tool | AI Model Tool | PaaS Tool |
|---------|---------|---------------|-----------|
| Per-region table | SKU rows with capacity status | Provider summary rows | SQL SKU rows + Cosmos access rows |
| Cross-region matrix | Family × Region | Provider × Region | Service × Region |
| Drill-down | Per-SKU details | Per-model details | Per-edition SQL details |
| Color coding | Green/Yellow/Red by capacity | Green/Yellow by model count | Green/Yellow/Red by status + quota |
| Export | CSV/XLSX dual-path | CSV/XLSX dual-path | CSV/XLSX dual-path |

---

## Estimated Effort

| Component | Lines | Complexity |
|-----------|-------|-----------|
| Param block + configuration | ~80 | Low — copy pattern from AI model tool |
| Helper functions (reused) | ~120 | Low — verbatim copy |
| SQL Capabilities parsing | ~150 | Medium — nested JSON traversal |
| SQL Usages parsing | ~40 | Low — flat response |
| Cosmos DB parsing | ~60 | Low — flat response |
| Pricing integration | ~80 | Medium — meter name matching |
| Display/rendering | ~200 | Medium — table formatting |
| Interactive prompts | ~80 | Low — copy pattern |
| Export pipeline | ~100 | Low — copy pattern |
| **Total MVP** | **~900** | |

---

## Open Questions

1. **Should Managed Instance be in MVP or Phase 2?** The capabilities API returns MI data in the same call — parsing it adds ~50 lines but makes the tool more complete for enterprise customers.

2. **Cosmos DB pricing display:** RU-based pricing doesn't map to vCore tables. Options: show $/100 RU/hr, or skip pricing for Cosmos in MVP.

3. **New repo or subfolder?** Following the pattern of separate repos (`Get-AzVMAvailability`, `Get-AzAIModelAvailability`), this should be `Get-AzPaaSAvailability` as its own repo.

4. **Name:** `Get-AzPaaSAvailability` vs `Get-AzServiceAvailability`? The former is more specific; the latter is more extensible if we add non-PaaS services later.
