# Capacity Planning Dashboard

This repository contains the initial platform scaffold for a native Azure capacity planning solution.

## What is included now

- Web UI with tabs, filters, action buttons, and a data grid
- Backend API foundation with capacity endpoints
- SQL schema for snapshots and latest-capacity view
- Azure infrastructure Bicep templates
- Deployment and sample data scripts
- Current-state architecture diagram source and rendered image in `docs/`

## Architecture

- Primary editable source (Draw.io): `docs/current-architecture.drawio`
- Current-state Mermaid source: `docs/current-architecture.mmd`
- Rendered PNG: `docs/current-architecture.png`

The current-state diagram reflects what is deployed now: App Service hosting the static UI + Express API, Azure SQL with Entra-only auth, managed identity database access, Key Vault RBAC integration, and App Insights/Log Analytics.

Use Draw.io for edits when readability/layout precision matters; keep the Mermaid file for quick text-based diffs and automation-friendly rendering.

## Implementation Status

Status legend:

- `[x]` Complete
- `[~]` In progress / partial
- `[ ]` Planned

### Track summary

| Track | Current Status | Notes |
| --- | --- | --- |
| Platform and infrastructure | `[x]` | App Service, SQL, Key Vault, App Insights, Log Analytics deployed via Bicep |
| Security and identity | `[~]` | Entra admin + AAD-only SQL auth, managed identity runtime access, no raw subscription IDs stored in snapshots; Entra RBAC for Admin sections pending |
| Live ingestion pipeline | `[x]` | Internal ingestion endpoint + scheduler + BS/DS family filtering + SQL snapshot writes |
| API and analytics | `[~]` | Capacity API, subscription catalog, family summary, masked subscription summary, and trend APIs complete; quota-group APIs still placeholder |
| UX and dashboard | `[~]` | Capacity grid, filters, tabs, analytics tables, and chart views complete; export/workflow pages still pending |
| Quota movement orchestration | `[ ]` | Discover/plan/apply backend flow and approvals not implemented yet |
| Operations and release | `[~]` | Deployment scripts and migration scripts complete; CI/CD pipeline and runbooks still pending |

### Detailed checklist

#### Platform and infrastructure

- [x] Azure resource group and core resources provisioned
- [x] Bicep-based environment deployment script
- [x] SQL schema for snapshots and latest view
- [x] Draw.io + Mermaid architecture artifacts in `docs/`

#### Security and identity

- [x] SQL configured with Entra admin and AAD-only auth
- [x] App Service system-assigned managed identity enabled
- [x] App identity granted SQL read/write roles for ingestion and read APIs
- [x] Internal ingestion endpoints protected by `INGEST_API_KEY`
- [x] Subscription identities masked (`subscriptionKey`) in stored analytics rows
- [ ] Entra ID RBAC — code support is in place via App Service auth headers and `/api/auth/me`, but platform enablement is still pending: enable App Service Authentication, register/assign the `CapacityAdmin` app role, and set `ADMIN_RBAC_MODE=enforce`

#### Live ingestion pipeline

- [x] Managed identity token flow for ARM ingestion
- [x] Region preset ingestion (`USMajor`)
- [x] Family filter ingestion (`standard_BS`, `standard_DS`)
- [x] Ingestion scheduler (`INGEST_ON_STARTUP`, `INGEST_INTERVAL_MINUTES`)
- [ ] Retry/backoff and dead-letter behavior for ingestion failures

#### API and analytics

- [x] `GET /api/capacity`
- [x] `GET /api/subscriptions` (subscription search/paging source for multi-select UX)
- [x] `GET /api/capacity/families` (quota-style family summary)
- [x] `GET /api/capacity/subscriptions` (masked subscription summary)
- [x] `GET /api/capacity/trends` (daily trend rollups)
- [x] `POST /internal/ingest/capacity`
- [x] `GET /internal/ingest/status`
- [x] `GET /api/quota/groups` live implementation
- [ ] Quota movement plan/apply endpoints

#### UX and dashboard

- [x] Capacity Explorer tab with filters and grid
- [x] Region group defaulting (`USMajor`)
- [x] Subscription search + multi-select filter UX (scales with search/limit)
- [x] Quota Insights tab tables for subscription summary + trends
- [x] Chart views for region availability and top SKU available quota
- [x] Ingestion status widget in UI
- [ ] Admin UI setting for scheduled refresh rates (quota discovery, capacity ingestion, and future background refresh jobs)
- [ ] Admin UI setting for quota discovery scope selection (management group and, if needed, quota group picker/default)
- [ ] Pagination for report grids (prefer server-side paging for large result sets)
- [ ] Export (CSV/XLSX) actions wired to backend

#### Quota movement orchestration

- [x] Discover quota groups from live APIs
- [ ] Generate candidate/move plans from analytics data
- [ ] Approval workflow for quota apply actions
- [ ] Safe apply with change caps, retries, and audit log views

#### Operations and release

- [x] Migration runner script (`scripts/apply-migration.ps1`)
- [x] Schema + seed scripts for dev initialization
- [ ] CI/CD pipeline for build/deploy/migrations
- [ ] Scheduled ingestion monitoring/alerts
- [ ] Release verification checklist + rollback playbook

## Local run

1. Copy `.env.example` to `.env` and provide SQL values (or leave blank for mock mode).
2. Install dependencies:

```powershell
npm install
```

3. Start API + UI server:

```powershell
npm start
```

4. Open:

- http://localhost:3000

## Infrastructure deployment

Use script-based deployment with Central US default:

```powershell
./scripts/deploy-infra.ps1 \
	-ResourceGroupName "<rg-name>" \
	-Environment dev \
	-WorkloadSuffix "cap001" \
	-SqlEntraAdminLogin "<entra-upn>" \
	-SqlEntraAdminObjectId "<entra-object-id>" \
	-SubscriptionId "<subscription-id>"
```

Notes:

- SQL is configured with Microsoft Entra admin and AAD-only authentication.
- `SqlAdminPassword` is optional; when omitted, the script generates a strong random value for server bootstrap.

## Initialize database

Apply schema:

```powershell
./scripts/apply-schema.ps1 \
	-SqlServer "<server>.database.windows.net" \
	-SqlDatabase "<database>" \
	-UseEntra \
	-EntraUser "<entra-upn>"
```

Load sample rows:

```powershell
./scripts/load-sample-data.ps1 \
	-SqlServer "<server>.database.windows.net" \
	-SqlDatabase "<database>" \
	-UseEntra \
	-EntraUser "<entra-upn>"
```

## Approval checkpoints

Approvals are required before:

1. Assigning any write permissions for quota movements.
2. Enabling production data ingestion across subscriptions.
3. Executing quota apply operations from UI/API.
4. Enabling public network access for production SQL/Key Vault (recommended to lock down with private networking).

## Security guardrails

- Do not commit subscription IDs, tenant IDs, resource group names, or credentials.
- Use managed identity for Azure resource access in hosted environments.
- Keep write identity separate from read identity.

## Subscription data ingestion strategy

**Cross-subscription, database-backed reporting (recommended):**

1. **Discovery**: On ingestion start, the managed identity enumerates all enabled Azure subscriptions it can access (or uses explicit `INGEST_SUBSCRIPTION_IDS` list).
2. **Batching**: Subscriptions are processed in batches of 100 to avoid ARM API rate limits (429 errors). A 2-second delay is inserted between batches.
3. **Retry-on-throttle**: If the service encounters a 429 (rate limit) or 503 (service unavailable) response, it uses exponential backoff with a max of 3 retries per request.
4. **Ingestion**: For each subscription, the service pulls Compute usage and SKU data from ARM, then writes snapshots to `dbo.CapacitySnapshot`.
5. **Dashboard**: Reports read from the SQL database, never from real-time ARM APIs. Subscription multi-select filtering works by querying the locally-stored snapshots.
6. **Result**: Lightweight, scalable dashboard with multi-subscription visibility; no per-query ARM calls; scheduled ingestion keeps data fresh; handles 100s-1000s of subscriptions without throttling.

**Configuration options:**

- **Auto-discover**: If `INGEST_SUBSCRIPTION_IDS` is not set, the service calls `/subscriptions` to enumerate all accessible subscriptions.
- **Explicit list**: Set `INGEST_SUBSCRIPTION_IDS=sub-1,sub-2,sub-3` to ingest only those subscriptions.
- **Frequency**: Control `INGEST_INTERVAL_MINUTES` to tune refresh cadence (e.g., 30 = every 30 minutes).
- **Batch tuning**: Subscription batch size (100) and inter-batch delay (2s) are hardcoded; adjust in `azureIngestionService.js` if needed for different ARM throttle profiles.

This design avoids the performance and cost penalties of real-time API calls during dashboard queries — all filtering happens on indexed SQL tables. Batching and retry logic ensure safe ingestion at scale.

## Live ingestion (Phase 1)

The dashboard now supports a secure internal ingestion path that reads Azure Compute quota usage and writes snapshots to `dbo.CapacitySnapshot`.

Defaults:

- Region preset: `USMajor`
- Family filters: `standard_BS`, `standard_DS`
- Source type written to SQL: `live-azure-ingest`

Required app settings:

- `INGEST_API_KEY` (required to call internal ingestion routes)
- `INGEST_REGION_PRESET` (default `USMajor`)
- `INGEST_QUOTA_FAMILY_FILTERS` (default `standard_BS,standard_DS`)
- `INGEST_SUBSCRIPTION_HASH_SALT` (optional salt for masked subscription key hashing)
- `INGEST_SUBSCRIPTION_IDS` (optional comma-separated list; if omitted, enabled subscriptions are auto-discovered)
- `INGEST_ON_STARTUP` (`true`/`false`)
- `INGEST_INTERVAL_MINUTES` (`0` disables scheduling)
- `ADMIN_RBAC_MODE` (`off` by default; set to `enforce` after App Service Authentication is enabled)
- `ADMIN_ROLE_NAME` (`CapacityAdmin` by default)
- `QUOTA_MANAGEMENT_GROUP_ID` (required for live quota discovery)

Required database permissions for the app identity:

- `db_datareader` (read dashboard rows)
- `db_datawriter` (insert ingestion snapshots)

Internal endpoints:

- `POST /internal/ingest/capacity` (requires `x-ingest-key` header)
- `GET /internal/ingest/status` (requires `x-ingest-key` header)

Admin UI endpoints:

- `POST /api/admin/ingest/capacity` (same-origin route used by the Admin portal Run Ingest Now action)
- `GET /api/admin/ingest/status` (same-origin route used by the Admin portal status banner)
- `GET /api/auth/me` (returns App Service auth context and resolved Admin access state)
- `GET /api/quota/management-groups` (returns accessible management groups for the Quota Discovery scope picker)

Read APIs for analytics:

- `GET /api/subscriptions?search=<text>&limit=<n>` (subscription catalog for scalable filtering)
- `GET /api/capacity/subscriptions` (masked subscription summary)
- `GET /api/capacity/trends?days=7` (daily trend rollup)
- `GET /api/capacity/families` (quota-style family summary)

Example trigger:

```powershell
Invoke-RestMethod -Method Post -Uri "https://<your-app>.azurewebsites.net/internal/ingest/capacity" -Headers @{ "x-ingest-key" = "<ingest-key>" } -Body (@{ regionPreset = "USMajor"; familyFilters = @("standard_BS","standard_DS") } | ConvertTo-Json) -ContentType "application/json"
```

## Database and API Mapping by Area

This section documents which tables/views are used by each product area and which APIs are called.

### SQL objects and structure

#### `dbo.CapacitySnapshot` (base ingestion table)

- `snapshotId` `BIGINT IDENTITY` (PK)
- `capturedAtUtc` `DATETIME2`
- `sourceType` `NVARCHAR(50)`
- `subscriptionKey` `NVARCHAR(64)`
- `subscriptionId` `NVARCHAR(64)`
- `subscriptionName` `NVARCHAR(256)`
- `region` `NVARCHAR(64)`
- `skuName` `NVARCHAR(128)`
- `skuFamily` `NVARCHAR(128)`
- `vCpu` `INT`
- `memoryGB` `DECIMAL(10,2)`
- `zonesCsv` `NVARCHAR(256)`
- `availabilityState` `NVARCHAR(32)`
- `quotaCurrent` `INT`
- `quotaLimit` `INT`
- `monthlyCostEstimate` `DECIMAL(18,2)`

Purpose:
- Append-only snapshot history written by live ingestion.
- Trend APIs query this table directly.

#### `dbo.CapacityLatest` (reporting view)

Definition:
- `CREATE OR ALTER VIEW` over `dbo.CapacitySnapshot`.
- Uses `ROW_NUMBER()` partitioned by `ISNULL(subscriptionKey,'legacy-data'), region, skuName` and keeps `rn = 1`.

Columns exposed:
- `capturedAtUtc`, `subscriptionKey`, `subscriptionId`, `subscriptionName`, `region`, `skuName`, `skuFamily`, `vCpu`, `memoryGB`, `zonesCsv`, `availabilityState`, `quotaCurrent`, `quotaLimit`, `monthlyCostEstimate`.

Purpose:
- Current-state reporting for grid/filter/subscription/family summary endpoints.

#### `dbo.QuotaCandidateSnapshot` (planned quota movement analytics)

- `candidateId` `BIGINT IDENTITY` (PK)
- `capturedAtUtc` `DATETIME2`
- `region` `NVARCHAR(64)`
- `quotaName` `NVARCHAR(128)`
- `suggestedMovable` `INT`
- `safetyBuffer` `INT`
- `subscriptionHash` `NVARCHAR(128)`
- `candidateStatus` `NVARCHAR(32)`

Status:
- Table exists in schema, but active API writers/readers are not yet implemented in this phase.

#### `dbo.QuotaApplyRequestLog` (planned apply audit)

- `requestLogId` `BIGINT IDENTITY` (PK)
- `createdAtUtc` `DATETIME2`
- `requestedBy` `NVARCHAR(256)`
- `operationId` `NVARCHAR(128)`
- `state` `NVARCHAR(64)`
- `payloadJson` `NVARCHAR(MAX)`
- `resultJson` `NVARCHAR(MAX)`

Status:
- Table exists in schema, but quota apply orchestration endpoints are not yet implemented.

### Area-to-API-to-data mapping

#### Capacity Reports (Reporting page)

Primary app APIs:
- `GET /api/capacity`
- `GET /api/subscriptions`
- `GET /api/capacity/families`
- `GET /api/capacity/subscriptions`
- `GET /api/capacity/trends`

Data sources:
- `dbo.CapacityLatest` for current grid/subscription/family reporting.
- `dbo.CapacitySnapshot` for trend rollups.

Key query behavior:
- Shared filters: region preset, region, family, availability, subscription IDs.
- Subscription filter is applied against `ISNULL(subscriptionId, 'legacy-data')`.

#### Data Ingestion (Admin page)

Admin UI APIs:
- `POST /api/admin/ingest/capacity`
- `GET /api/admin/ingest/status`

Protected internal APIs:
- `POST /internal/ingest/capacity`
- `GET /internal/ingest/status`
- `POST /internal/db/ensure-phase3-schema`

Current UI behavior:
- `Refresh Subscriptions` refreshes the subscription catalog and updates the inline status banner.
- `Run Ingest Now` starts a live ingestion run through the app server, updates button/status state, and refreshes report data after completion.

External Azure APIs called by ingestion:
- `GET https://management.azure.com/subscriptions?api-version=2020-01-01`
	- Enumerates accessible subscriptions and resolves display names.
- `GET https://management.azure.com/subscriptions/{subscriptionId}/providers/Microsoft.Compute/locations/{region}/usages?api-version=2024-03-01`
	- Reads Compute quota usage values (`currentValue`, `limit`).
- `GET https://management.azure.com/subscriptions/{subscriptionId}/providers/Microsoft.Compute/skus?$filter=location eq '{region}'&api-version=2024-03-01`
	- Reads SKU capabilities and zone metadata for representative rows.

Write target:
- `INSERT` into `dbo.CapacitySnapshot` (one row per family/region/subscription observation).

#### Quota Discovery (Admin page)

Current API state:
- `GET /api/quota/groups` lists live GroupQuota resources for `QUOTA_MANAGEMENT_GROUP_ID` and includes associated subscription IDs.
- `GET /api/quota/management-groups` lists accessible management groups so the Admin UI can select the discovery scope before loading quota groups.

Planned data/API direction:
- Discover group quotas from Microsoft.Quota APIs.
- Persist candidate analytics into `dbo.QuotaCandidateSnapshot`.

#### Quota Movements (Admin page)

Current API state:
- UI actions are currently frontend placeholders (no backend apply/simulate routes yet).

Planned data/API direction:
- Execute quota apply/simulate workflows.
- Persist audit trail into `dbo.QuotaApplyRequestLog`.

### Security and identity behavior for API/database calls

- Dashboard app uses App Service managed identity for:
	- Azure ARM ingestion reads.
	- Azure SQL access (AAD MSI auth mode).
- Required RBAC for each ingested subscription:
	- At minimum, permission to read `Microsoft.Compute/locations/usages` and SKU metadata (Reader role at subscription scope is sufficient for current read APIs).
- Internal ingestion APIs are gated by `INGEST_API_KEY`.
- Admin UI RBAC support reads App Service Authentication headers (`x-ms-client-principal`) when present. Enforce it only after Easy Auth is enabled and the `CapacityAdmin` app role is assigned.

## SQL migration

To add masked subscription-key support to existing databases, run:

```powershell
./scripts/apply-migration.ps1 \
	-SqlServer "<server>.database.windows.net" \
	-SqlDatabase "<database>" \
	-MigrationFile "./sql/migrations/20260410-add-subscriptionkey.sql" \
	-UseEntra \
	-EntraUser "<entra-upn>"
```

To add subscription id/name + SKU metadata columns used by charts and family summary, run:

```powershell
./scripts/apply-migration.ps1 \
	-SqlServer "<server>.database.windows.net" \
	-SqlDatabase "<database>" \
	-MigrationFile "./sql/migrations/20260410-add-subscription-columns-and-sku-metadata.sql" \
	-UseEntra \
	-EntraUser "<entra-upn>"
```
