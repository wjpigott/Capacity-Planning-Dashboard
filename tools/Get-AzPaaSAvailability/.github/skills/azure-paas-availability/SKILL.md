---
name: azure-paas-availability
description: "Scan Azure regions for real-time PaaS service availability, SKUs, capacity, quota, and pricing using Get-AzPaaSAvailability. USE FOR: where can I deploy SQL Database, check Cosmos DB region access, PostgreSQL SKU availability, MySQL flexible server tiers, App Service plans per region, Container Apps workload profiles, AKS Kubernetes versions, Functions runtime stacks, Storage SKUs per region, compare PaaS across regions, zone redundancy check, PaaS region matrix, which PaaS services available in a region. DO NOT USE FOR: VM SKU scanning (use azure-vm-availability), AI model availability (use Get-AzAIModelAvailability), deploying PaaS resources (use azure-prepare), general Azure service recommendations without login."
license: MIT
metadata:
  author: Zachary Luz
  version: "1.0.0"
---

# Azure PaaS Availability — Live Service Scanner

> **AUTHORITATIVE GUIDANCE** — This skill teaches you when and how to invoke
> the `Get-AzPaaSAvailability` module via terminal for real-time Azure PaaS
> service scanning. The module is the execution engine; this skill is the
> routing layer.

## When to Use This Skill

Invoke this skill when the user wants to:
- Check **real-time** PaaS service availability across Azure regions
- Find which regions support specific SQL Database editions, vCore counts, or compute models
- Check **Cosmos DB** subscription-level region access (blocked, AZ-only, residency)
- See **PostgreSQL Flexible Server** tiers, IOPS, memory, and zone support per region
- See **MySQL Flexible Server** SKUs per server version (5.7/8.0/8.4/9.3)
- Find which regions have specific **App Service** plan tiers (with zone/Linux/container flags)
- Check **Container Apps** workload profiles (Consumption, D4-D32, E4-E32, GPU)
- See **AKS** Kubernetes version availability and upgrade paths per region
- Check **Functions** runtime stacks, versions, and deprecation dates
- See **Storage** SKUs per region with tier, kind, zone redundancy, and restrictions
- Validate **static-tier services** (Redis, Event Hubs, Service Bus, AI Search, APIM, etc.)
- Compare PaaS service coverage across multiple regions in a **Region Health Matrix**
- Export availability data to CSV/XLSX for reporting or planning

### When NOT to Use This Skill

| Scenario | Use Instead |
|----------|-------------|
| VM SKU capacity, quota, or pricing | `azure-vm-availability` (Get-AzVMAvailability) |
| AI model availability (OpenAI, Anthropic, etc.) | `Get-AzAIModelAvailability` |
| Deploy PaaS resources or infrastructure | `azure-prepare` → `azure-validate` → `azure-deploy` |
| General Azure service recommendation (no login) | `azure-compute` or Azure docs |
| Azure quota management via CLI | `azure-quotas` |

---

## Prerequisites

Before running, verify these requirements. **Stop and help the user fix any missing prerequisite.**

### 1. Module Must Be On The Machine

```powershell
# Check common locations
$paths = @(
    "$env:USERPROFILE\Get-AzPaaSAvailability\AzPaaSAvailability",
    "C:\Github\Personal\Get-AzPaaSAvailability\AzPaaSAvailability"
)
$found = $paths | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($found) { Write-Host "Found: $found" } else { Write-Host "NOT FOUND" }
```

**If not found**, tell the user:
```powershell
git clone https://github.com/ZacharyLuz/Get-AzPaaSAvailability.git
cd Get-AzPaaSAvailability
```

### 2. PowerShell 7+ Required

```powershell
$PSVersionTable.PSVersion  # Must be 7.0+
```

### 3. Azure Module & Login

```powershell
Get-Module Az.Accounts -ListAvailable   # Must be installed
Get-AzContext                            # Must have active login
```

If not logged in: `Connect-AzAccount`

---

## Decision Tree

```
User request
    │
    ├─ "What VM should I use for X workload?"
    │   └─ Use azure-vm-availability or azure-compute (VM, not PaaS)
    │
    ├─ "Which regions have Hyperscale SQL?"
    │   └─ THIS SKILL → Get-AzSqlAvailability -Edition Hyperscale
    │
    ├─ "Is Cosmos DB available in westeurope for my subscription?"
    │   └─ THIS SKILL → Get-AzCosmosDBAvailability
    │
    ├─ "What PostgreSQL SKUs are available in eastus?"
    │   └─ THIS SKILL → Get-AzPostgreSqlAvailability
    │
    ├─ "What AKS versions can I use in westus2?"
    │   └─ THIS SKILL → Get-AzAksAvailability
    │
    ├─ "Which App Service plans support zone redundancy?"
    │   └─ THIS SKILL → Get-AzAppServiceAvailability
    │
    ├─ "Is Redis Cache Enterprise available in my region?"
    │   └─ THIS SKILL → Get-AzServiceTierAvailability -ServiceFilter Redis
    │
    ├─ "Compare PaaS service coverage across US regions"
    │   └─ THIS SKILL → Get-AzPaaSAvailability -RegionPreset USMajor
    │
    └─ "Export PaaS availability to Excel"
        └─ THIS SKILL → Get-AzPaaSAvailability ... -Quiet | Export-AzPaaSAvailabilityReport
```

---

## Core Workflows

### Workflow 1: PaaS Scan (9 First-Class Services)

**Scenario:** Compare PaaS service availability across regions. The orchestrator scans 9 API-backed services. For the 15 static-tier services, call `Get-AzServiceTierAvailability` separately (see Workflow 7).

```powershell
# Wrapper script — interactive region selection
.\Get-AzPaaSAvailability.ps1

# Wrapper script — automated, no prompts
.\Get-AzPaaSAvailability.ps1 -RegionPreset USMajor -NoPrompt

# Module — direct call (always use from Copilot)
Import-Module ./AzPaaSAvailability -Force
Get-AzPaaSAvailability -Region eastus,westus2,centralus
```

**Always use the module approach from Copilot** — it gives structured output.

### Workflow 2: SQL Database / Managed Instance

```powershell
Import-Module ./AzPaaSAvailability -Force

# All SQL Database SKUs in a region
Get-AzSqlAvailability -Region eastus

# Hyperscale only
Get-AzSqlAvailability -Region eastus,westus2 -Edition Hyperscale

# Serverless compute model
Get-AzSqlAvailability -Region eastus -ComputeModel Serverless

# SQL Managed Instance
Get-AzSqlAvailability -Region eastus -SqlResourceType ManagedInstance

# Include Visible/Disabled SKUs
Get-AzSqlAvailability -Region eastus -IncludeDisabled
```

### Workflow 3: Cosmos DB Subscription Access

```powershell
Import-Module ./AzPaaSAvailability -Force

# Check which regions your subscription can access
Get-AzCosmosDBAvailability -Region eastus,westeurope,southeastasia
```

Output shows: access flags, AZ support, residency restrictions per region.

### Workflow 4: PostgreSQL / MySQL Flexible Server

```powershell
Import-Module ./AzPaaSAvailability -Force

# PostgreSQL — tiers, vCores, IOPS, memory, zone support
Get-AzPostgreSqlAvailability -Region eastus,westus2

# MySQL — SKUs per server version (5.7/8.0/8.4/9.3)
Get-AzMySqlAvailability -Region eastus,westus2
```

### Workflow 5: App Service / Container Apps / Functions

```powershell
Import-Module ./AzPaaSAvailability -Force

# App Service plans per region (zone/Linux/Functions/container flags)
Get-AzAppServiceAvailability -Region eastus,westeurope

# Container Apps workload profiles (Consumption, D4-D32, GPU)
Get-AzContainerAppsAvailability -Region eastus,westus2

# Functions runtime stacks and versions (global catalog, not per-region)
Get-AzFunctionsAvailability
```

### Workflow 6: AKS / Storage

```powershell
Import-Module ./AzPaaSAvailability -Force

# AKS Kubernetes versions and upgrade paths
Get-AzAksAvailability -Region eastus,westus2

# Storage SKUs (tier, kind, zones, restrictions)
Get-AzStorageAvailability -Region eastus,westus2
```

### Workflow 7: Static-Tier Services (Redis, Event Hubs, Service Bus, etc.)

```powershell
Import-Module ./AzPaaSAvailability -Force

# All 15 static-tier services
Get-AzServiceTierAvailability -Region eastus

# Filter to specific services
Get-AzServiceTierAvailability -Region eastus -ServiceFilter Redis,EventHubs,ServiceBus

# Available services: Redis, EventHubs, ServiceBus, AISearch, APIM,
#   ACR, KeyVault, FrontDoor, LogAnalytics, AppConfig,
#   IoTHub, Grafana, StaticWebApps, SignalR, NotificationHubs
```

### Workflow 8: Region Health Matrix

When scanning multiple services via `Get-AzPaaSAvailability`, the orchestrator
renders a unified cross-service matrix automatically.

```powershell
# Scan all services, see the matrix
Get-AzPaaSAvailability -Region eastus,westus2,centralus
```

You can also call the matrix renderer directly on a saved result:

```powershell
$result = Get-AzPaaSAvailability -Region eastus,westus2 -Quiet
Show-AzPaaSRegionMatrix -ScanResult $result
```

### Workflow 9: Pipeline Capture & Export

```powershell
Import-Module ./AzPaaSAvailability -Force

# Capture results (suppress display)
$results = Get-AzPaaSAvailability -Region eastus,westus2 -Quiet

# Filter in pipeline
$results.SqlSkus | Where-Object { $_.ZoneRedundant -and $_.Edition -eq 'Hyperscale' }
$results.PostgreSqlSkus | Where-Object { $_.ZoneSupport }

# Export to XLSX (currently exports SQL + Cosmos DB sections)
$results | Export-AzPaaSAvailabilityReport -Path C:\Temp

# Export to CSV (currently exports SQL + Cosmos DB sections)
$results | Export-AzPaaSAvailabilityReport -Path C:\Temp -Format CSV

# JSON output via wrapper script
.\Get-AzPaaSAvailability.ps1 -Region eastus -NoPrompt -JsonOutput
```

### Workflow 10: Wrapper Script (Interactive + Automation)

The wrapper script (`.\Get-AzPaaSAvailability.ps1`) adds interactive region
selection and extra flags not on the module function:

```powershell
# Interactive — prompts for region preset
.\Get-AzPaaSAvailability.ps1

# Automated — skip prompts
.\Get-AzPaaSAvailability.ps1 -RegionPreset USMajor -NoPrompt

# SQL-focused scan with auto-export
.\Get-AzPaaSAvailability.ps1 -Service SqlDatabase -Edition Hyperscale -AutoExport

# JSON output for piping to other tools
.\Get-AzPaaSAvailability.ps1 -Region eastus -NoPrompt -JsonOutput
```

---

## Parameter Quick Reference

### Get-AzPaaSAvailability (Orchestrator)

| Parameter | Type | Purpose |
|-----------|------|---------|
| `-Region` | String[] | Azure region codes (e.g., "eastus","westus2") |
| `-RegionPreset` | String | Predefined set: USEastWest, USMajor, Europe, AsiaPacific, Global, USGov, China, ASR-EastWest, ASR-CentralUS |
| `-Service` | String | Filter: SqlDatabase, CosmosDB, PostgreSQL, MySQL, AppService, ContainerApps, AKS, Functions, Storage, All |
| `-Edition` | String[] | SQL edition filter: GeneralPurpose, BusinessCritical, Hyperscale |
| `-ComputeModel` | String | SQL compute: Provisioned, Serverless |
| `-SqlResourceType` | String | SqlDatabase or ManagedInstance |
| `-IncludeDisabled` | Switch | Show Visible/Disabled SKUs |
| `-FetchPricing` | Switch | Include retail pricing |
| `-Environment` | String | AzureCloud, AzureUSGovernment, AzureChinaCloud, AzureGermanCloud |
| `-MaxRetries` | Int | Retry attempts (default 3) |
| `-Quiet` | Switch | Suppress display, objects only — **use from Copilot** |

### Wrapper Script Extra Parameters

| Parameter | Type | Purpose |
|-----------|------|---------|
| `-NoPrompt` | Switch | Skip interactive menus — **use from Copilot** |
| `-JsonOutput` | Switch | Emit JSON to stdout |
| `-AutoExport` | Switch | Export without prompting |
| `-ExportPath` | String | Custom export directory |
| `-OutputFormat` | String | Auto, CSV, or XLSX |

---

## Region Presets

| Preset | Regions |
|--------|---------|
| USEastWest | eastus, eastus2, westus, westus2 |
| USCentral | centralus, northcentralus, southcentralus, westcentralus |
| USMajor | eastus, eastus2, centralus, westus, westus2 |
| Europe | westeurope, northeurope, uksouth, francecentral, germanywestcentral |
| AsiaPacific | eastasia, southeastasia, japaneast, australiaeast, koreacentral |
| Global | eastus, westeurope, southeastasia, australiaeast, brazilsouth |
| USGov | usgovvirginia, usgovtexas, usgovarizona |
| China | chinaeast, chinanorth, chinaeast2, chinanorth2 |
| ASR-EastWest | eastus, westus2 |
| ASR-CentralUS | centralus, eastus2 |

---

## Services Covered (24 Total)

### Tier 1 — Dedicated Capabilities API (9 services)

| Service | Cmdlet | Data |
|---------|--------|------|
| SQL Database + MI | `Get-AzSqlAvailability` | SKUs, vCore quota, zone redundancy, AHUB, status |
| Cosmos DB | `Get-AzCosmosDBAvailability` | Subscription region access, AZ support, residency |
| PostgreSQL Flex | `Get-AzPostgreSqlAvailability` | Compute tiers, vCores, IOPS, memory, zones, HA |
| MySQL Flex | `Get-AzMySqlAvailability` | SKUs per version, storage, geo-backup |
| App Service | `Get-AzAppServiceAvailability` | Tier availability, zone/Linux/Functions/container |
| Container Apps | `Get-AzContainerAppsAvailability` | Workload profiles (Consumption to GPU) |
| AKS | `Get-AzAksAvailability` | Kubernetes versions, preview/GA, upgrade paths |
| Functions | `Get-AzFunctionsAvailability` | Runtime stacks, versions, deprecation, platform |
| Storage | `Get-AzStorageAvailability` | SKUs per region with tier, kind, zones, restrictions |

### Tier 2-4 — Pricing API Validation (15 services via `Get-AzServiceTierAvailability`)

Redis, Event Hubs, Service Bus, AI Search, APIM, ACR, Key Vault, Front Door,
Log Analytics, App Configuration, IoT Hub, Managed Grafana, Static Web Apps,
SignalR, Notification Hubs.

---

## Result Object Schema

`Get-AzPaaSAvailability` returns a `[PSCustomObject]` with these properties:

| Property | Type | Content |
|----------|------|---------|
| `SqlSkus` | Array | SQL Database/MI SKU details per region |
| `CosmosDbLocations` | Array | Cosmos DB region access details |
| `PostgreSqlSkus` | Array | PostgreSQL Flexible Server SKUs |
| `MySqlSkus` | Array | MySQL Flexible Server SKUs |
| `AppServiceSkus` | Array | App Service plan SKUs per region |
| `ContainerApps` | Array | Container Apps workload profiles |
| `AksVersions` | Array | AKS Kubernetes versions per region |
| `FunctionStacks` | Array | Functions runtime stacks and versions |
| `StorageSkus` | Array | Storage SKUs per region |
| `ScanMetadata` | Object | Version, regions, timing, service count |

---

## Interpreting Results

When presenting results to the user:

1. **SQL scans**: Highlight which editions and vCore counts are Available vs Visible/Disabled, note zone redundancy and AHUB support
2. **Cosmos DB**: Flag any BLOCKED regions — the user's subscription may need to be explicitly enabled
3. **Region Matrix**: Use the matrix to quickly identify service gaps across regions
4. **Static-tier services**: Pricing validation confirms the service tier exists in the region
5. **Always mention**: zone redundancy support, quota availability, and any restrictions

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Module not found | `git clone https://github.com/ZacharyLuz/Get-AzPaaSAvailability.git` |
| PowerShell 5.1 error | Use `pwsh` — module requires PowerShell 7.0+ |
| No Azure context | Run `Connect-AzAccount` first |
| Cosmos DB shows BLOCKED | Subscription not enabled for that region — file support ticket |
| Export fails | Install `ImportExcel` module: `Install-Module ImportExcel -Scope CurrentUser` |
| SQL quota shows `?` | Quota API didn't return data for that region |
