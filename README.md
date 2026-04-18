# Capacity Planning Dashboard

This repository contains the initial platform scaffold for a native Azure capacity planning solution.
- Huge shout out to Zach Luz for builing out many of the API calls this solution utilizes in his repo: https://github.com/ZacharyLuz/Get-AzVMAvailability  

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

The next execution split is now scaffolded in-repo: a dedicated Azure Functions PowerShell 7 worker host under `functions/CapacityWorker/` for live placement and future quota move/apply orchestration.

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
| Worker execution host | `[~]` | Azure Functions PowerShell 7 worker runs on a dedicated App Service plan with managed-identity host storage; live placement worker still needs module restore validation |
| Security and identity | `[x]` | Entra admin + AAD-only SQL auth, managed identity runtime access, no raw subscription IDs stored in snapshots; Entra sign-in and admin group gating are enabled via `ADMIN_GROUP_ID` |
| Live ingestion pipeline | `[x]` | Internal ingestion endpoint + scheduler; family filtering is optional (omit `INGEST_QUOTA_FAMILY_FILTERS` to ingest all families) + SQL snapshot writes |
| API and analytics | `[~]` | Capacity API, subscription catalog, family summary, masked subscription summary, and trend APIs complete; quota discovery, plan, simulation, and apply APIs are live |
| UX and dashboard | `[~]` | Capacity grid, filters (region, resource type, SKU family search, availability, subscription), sidebar report navigation, analytics tables, and chart views complete; export/workflow pages still pending |
| Quota movement orchestration | `[~]` | Discover, capture, plan, simulate, and apply flows are live; approval workflow and request tracking still pending |
| Operations and release | `[~]` | Deployment scripts and migration scripts complete; CI/CD pipeline and runbooks still pending |

### Detailed checklist

#### Platform and infrastructure

- [x] Azure resource group and core resources provisioned
- [x] Bicep-based environment deployment script
- [x] SQL schema for snapshots and latest view
- [x] Draw.io + Mermaid architecture artifacts in `docs/`
- [x] Azure Functions worker scaffold and Bicep resources for PowerShell 7 execution

#### Security and identity

- [x] SQL configured with Entra admin and AAD-only auth
- [x] App Service system-assigned managed identity enabled
- [x] App identity granted SQL read/write roles for ingestion and read APIs
- [x] Internal ingestion endpoints protected by `INGEST_API_KEY`
- [x] Subscription identities masked (`subscriptionKey`) in stored analytics rows
- [x] Entra sign-in and admin group gating enabled via dashboard auth flow and `ADMIN_GROUP_ID`

#### Live ingestion pipeline

- [x] Managed identity token flow for ARM ingestion
- [x] Region preset ingestion (`USMajor`)
- [x] Family filter ingestion — optional; set `INGEST_QUOTA_FAMILY_FILTERS` to a comma-separated list to restrict, or omit entirely to ingest all VM families
- [x] Ingestion scheduler (DB-backed admin settings with environment fallback)
- [ ] Move recurring scheduler execution to Function App TimerTrigger jobs (ingestion + live placement)
- [ ] Retry/backoff and dead-letter behavior for ingestion failures

#### API and analytics

- [x] `GET /api/capacity`
- [x] `GET /api/capacity/paged` (server-side pagination for primary grid)
- [x] `GET /api/subscriptions` (subscription search/paging source for multi-select UX)
- [x] `GET /api/capacity/families` (quota-style family summary)
- [x] `GET /api/capacity/subscriptions` (masked subscription summary)
- [x] `GET /api/capacity/trends` (daily trend rollups)
- [x] `POST /internal/ingest/capacity`
- [x] `GET /internal/ingest/status`
- [x] `GET /api/quota/groups` live implementation
- [x] Quota movement plan/simulate/apply endpoints

#### UX and dashboard

- [x] Capacity Explorer tab with filters and grid
- [x] Region group defaulting (`USMajor`)
- [x] Subscription checkbox list with auto-select on first load
- [ ] Move subscriptions into a flyout filter section on the right-hand side of the screen
- [x] Resource Type filter (Compute / Disk / Other / All) scopes the SKU Family dropdown
- [x] SKU Family live search text input with filtered results dropdown alongside it
- [x] SKU family labels formatted for readability (`Standard_Dasv7` instead of `StandardDasv7Family`)
- [x] SKU Family dropdown canonicalization (case-insensitive dedupe + normalized casing/sort for easier lookup)
- [x] Quota Insights tab tables for subscription summary + trends
- [x] Chart views for region availability and top SKU available quota
- [x] Derived High/Medium/Low regional SKU capacity score view in reporting
- [x] On-demand live placement refresh using `Get-AzVMAvailability` placement scores
- [x] Worker-first live placement routing with local fallback for rollback safety
- [x] Ingestion status widget in UI
- [x] Admin UI setting for scheduled refresh rates (capacity ingestion and live placement refresh stored in SQL)
- [ ] Admin UI setting for quota discovery scope selection (management group and, if needed, quota group picker/default)
- [x] Pagination for report grids (prefer server-side paging for large result sets)
- [ ] Export (CSV/XLSX) actions wired to backend
- [ ] Separate pricing report (on-demand and spot) with $/Hr and $/Mo columns sourced from Get-AzVMAvailability

#### Quota movement orchestration

- [x] Discover quota groups from live APIs
- [x] Generate candidate/move plans from analytics data (read-only candidate generation, captured-run selection, move-plan building, simulation, and apply are live)
- [ ] Approval workflow for quota apply actions
- [ ] Safe apply with change caps, retries, and audit log views

Quota apply execution now runs through the dedicated `tools/Get-AzVMAvailability/Apply-QuotaGroupMove.ps1` entry point.
`Get-AzVMAvailability.ps1 -QuotaGroupApply` remains available for backward compatibility and delegates to that dedicated script.

Quota move/apply operations require write RBAC in addition to the read access used for discovery. The managed identity used by the dashboard for quota apply must have `GroupQuota Request Operator` on the management group referenced by `QUOTA_MANAGEMENT_GROUP_ID` (for example `Demo-MG`) and on every participating subscription scope used by the move. In practice that means both donor and recipient subscriptions need the role assignment when the quota apply path patches `quotaAllocations`. Without those grants, quota apply requests can authenticate successfully but still fail with `403 Forbidden` on `quotaAllocations` PATCH calls. For large estates, prefer the bulk rollout script at `scripts/grant-quota-rbac.ps1` instead of hand-maintaining long subscription arrays.

#### Operations and release

- [x] Migration runner script (`scripts/apply-migration.ps1`)
- [x] Schema + seed scripts for dev initialization
- [x] Worker packaging/deploy script scaffold
- [x] Database error log table for support visibility (`dbo.DashboardErrorLog`)
- [x] Live placement error display on reports (compact error badges visible in grid)
- [x] Operation history logging (`dbo.DashboardOperationLog`) for audit/support
- [x] Admin operation history UI showing recent ingest and refresh events
- [x] Live placement snapshot persistence (`dbo.LivePlacementSnapshot`) across sessions and desired-count refreshes
- [ ] Admin error log reviewer/dashboard for support triage
- [x] Daily scheduled live placement refresh with batching
- [ ] CI/CD pipeline for build/deploy/migrations
- [ ] Scheduled ingestion monitoring/alerts
- [ ] Deployment follow-up: investigate why `Compute Recommendations Role` assigned at the management-group scope did not satisfy `Microsoft.Compute/locations/placementScores/generate/action` for the worker managed identity, while the subscription-level assignment did
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

Optional worker-first settings:

- `CAPACITY_WORKER_BASE_URL`
- `CAPACITY_WORKER_SHARED_SECRET`
- `CAPACITY_WORKER_TIMEOUT_MS`
- `CAPACITY_WORKER_DISABLE_LOCAL_FALLBACK`

When `CAPACITY_WORKER_BASE_URL` is set, live placement refresh calls the Azure Function worker first. If the worker is unavailable and `CAPACITY_WORKER_DISABLE_LOCAL_FALLBACK` is not `true`, the dashboard falls back to the in-process App Service path to preserve rollback safety.

Capacity Recommender settings:

- `GET_AZ_VM_AVAILABILITY_ROOT` — Path to the `Get-AzVMAvailability` repository root (optional in local dev; required in App Service production if recommender feature is used). Default: `../../Get-AzVMAvailability` relative to the `tools/` folder. If the external repository is not available at this location, set this environment variable to the correct path, or the Capacity Recommender will fail with "repo root not found."

## Dashboard web app deployment

Use zip/web package deploy for the dashboard App Service.

Current target:

- Resource group: `CapacityDashboard`
- App Service: `app-capdash-dev-cap001`

Important packaging rule:

- Do not zip the whole dashboard folder blindly.
- Exclude deployment artifacts, prior zip files, downloaded App Service logs, `.git`, and `node_modules`.
- Including `artifacts/`, `appservice-logs*/`, or prior `deploy*.zip` files makes uploads much larger and can cause Kudu extraction failures such as `PathTooLongException`.

Package only the runtime files and folders:

```powershell
$items = @(
	'app.js',
	'index.html',
	'styles.css',
	'package.json',
	'package-lock.json',
	'react',
	'src',
	'sql',
	'scripts',
	'functions',
	'docs',
	'api-contract.md'
)

Compress-Archive -Path $items -DestinationPath ..\webpackage-capdash-clean.zip -Force
```

Deploy the package with:

```powershell
az webapp deploy \
	--resource-group CapacityDashboard \
	--name app-capdash-dev-cap001 \
	--src-path ..\webpackage-capdash-clean.zip \
	--type zip
```

Verification checks after deploy:

- `curl.exe -i -s https://app-capdash-dev-cap001.azurewebsites.net/`
- `curl.exe -i -s https://app-capdash-dev-cap001.azurewebsites.net/api/auth/me`

For auth-specific outage recovery, runtime drift, and safe restore steps, use [docs/AUTH-RECOVERY-RUNBOOK.md](docs/AUTH-RECOVERY-RUNBOOK.md).

Expected behavior:

- Deployment should complete in roughly seconds to a small number of minutes, not stall on a huge upload.
- The clean package should stay small; the last known good package was about 456 KB.
- If deployment is slow or fails during extraction, inspect the zip contents first before retrying.

**Capacity Recommender configuration:**

If you plan to use the Capacity Recommender feature (which requires the `Get-AzVMAvailability` PowerShell script), you must configure the following environment variable on the App Service:

```powershell
az webapp config appsettings set \
	--resource-group CapacityDashboard \
	--name app-capdash-dev-cap001 \
	--settings GET_AZ_VM_AVAILABILITY_ROOT="/path/to/Get-AzVMAvailability"
```

The `GET_AZ_VM_AVAILABILITY_ROOT` environment variable tells the recommender wrapper where to find the external `Get-AzVMAvailability` PowerShell repository. Without this setting, the Capacity Recommender will return an error indicating the repository root was not found.

Quota apply uses the vendored `tools/Get-AzVMAvailability` copy that ships with this repo, so it does not depend on a separate external checkout.

## Infrastructure deployment

Use script-based deployment with Central US default:

```powershell
./scripts/deploy-infra.ps1 \
	-ResourceGroupName "<rg-name>" \
	-Environment dev \
	-WorkloadSuffix "cap001" \
	-WebReaderSubscriptionIds @("<subscription-id-1>","<subscription-id-2>") \
	-WorkerRbacSubscriptionIds @("<subscription-id-1>","<subscription-id-2>") \
	-SqlEntraAdminLogin "<entra-upn>" \
	-SqlEntraAdminObjectId "<entra-object-id>" \
	-SubscriptionId "<subscription-id>"
```

Stable demo environment:

- Treat `dev` as change-heavy and `test` as the stable demo environment.
- Use the same naming pattern with the environment token changed to `test`, for example `app-capdash-test-cap001` and `func-capdash-test-cap001-appsvc`.
- Use `./infra/test.bicepparam` plus a dedicated resource group such as `CapacityDashboard-Test` when deploying the demo environment.

Example:

```powershell
./scripts/deploy-infra.ps1 \
	-ResourceGroupName "CapacityDashboard-Test" \
	-Environment test \
	-WorkloadSuffix "cap001" \
	-ParameterFile "./infra/test.bicepparam" \
	-WebReaderSubscriptionIds @("<subscription-id-1>","<subscription-id-2>") \
	-WorkerRbacSubscriptionIds @("<subscription-id-1>","<subscription-id-2>") \
	-SqlEntraAdminLogin "<entra-upn>" \
	-SqlEntraAdminObjectId "<entra-object-id>" \
	-SubscriptionId "<subscription-id>"
```

Notes:

- SQL is configured with Microsoft Entra admin and AAD-only authentication.
- `SqlAdminPassword` is optional; when omitted, the script generates a strong random value for server bootstrap.
- The Bicep template now also provisions a Function App plus storage account for the PowerShell 7 worker host.
- `-ParameterFile` lets you keep environment defaults in a `.bicepparam` file while still overriding secure/runtime values from the command line.
- `-WebReaderSubscriptionIds` grants the dashboard web app `Reader` on the listed subscriptions so subscription discovery can see every target subscription.
- `-WorkerRbacSubscriptionIds` triggers subscription-level RBAC assignment for the worker identity (`Compute Recommendations Role`, `Cost Management Reader`, `Billing Reader`) in the same deployment.
- `-AuthEnabled` plus `-EntraTenantId`, `-EntraClientId`, `-EntraClientSecret`, and optional `-AdminGroupId` configure the built-in Entra sign-in flow used by the dashboard API.

Example with Entra sign-in enabled:

```powershell
./scripts/deploy-infra.ps1 \
	-ResourceGroupName "CapacityDashboard-Test" \
	-Environment test \
	-WorkloadSuffix "cap001" \
	-ParameterFile "./infra/test.bicepparam" \
	-WebReaderSubscriptionIds @("<subscription-id-1>","<subscription-id-2>") \
	-WorkerRbacSubscriptionIds @("<subscription-id-1>","<subscription-id-2>") \
	-AuthEnabled $true \
	-EntraTenantId "<tenant-id>" \
	-EntraClientId "<app-registration-client-id>" \
	-EntraClientSecret "<app-registration-client-secret>" \
	-AdminGroupId "<entra-group-object-id>" \
	-SqlEntraAdminLogin "<entra-upn>" \
	-SqlEntraAdminObjectId "<entra-object-id>" \
	-SubscriptionId "<subscription-id>"
```

Current Bicep deployment gaps for a fuller blue-green model are tracked in `infra/README.md`.

## Worker deployment

Package and deploy the worker host separately from the dashboard web app:

```powershell
./scripts/deploy-worker.ps1 \
	-ResourceGroupName "<rg-name>" \
	-FunctionAppName "func-capdash-dev-cap001-appsvc"
```

After the worker is deployed, point the dashboard at it by setting:

- `CAPACITY_WORKER_BASE_URL=https://<function-app-name>.azurewebsites.net`
- `CAPACITY_WORKER_SHARED_SECRET=<same secret configured as WORKER_SHARED_SECRET on the function app>`

Hosted worker guidance:

- Configure `AzureWebJobsStorage` with managed identity, not a shared-key connection string.
- Grant the worker identity storage data-plane access on the host storage account.
- The default infrastructure path uses a dedicated App Service plan for the worker instead of Flex Consumption.
- Enable PowerShell managed dependencies in `host.json` so `requirements.psd1` can restore Az modules on the worker.
- NOTE: when `-WorkerRbacSubscriptionIds` is provided during infra deployment, these worker subscription roles are assigned automatically. If omitted, assign them manually.
- NOTE: some organizations require billing-account-scope assignments for billing APIs; those billing-scope assignments are outside this resource-group deployment and may still require manual/central platform automation.

Current worker endpoints:

- `POST /api/live-placement`
- `POST /api/quota-move-apply` (placeholder scaffold for future quota move orchestration)

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
- **Frequency**: Use Admin -> Data Ingestion -> Scheduler Settings to store cadence in SQL (for example 30 = every 30 minutes). `INGEST_INTERVAL_MINUTES` remains the fallback default when SQL settings are unavailable.
- **Batch tuning**: Subscription batch size (100) and inter-batch delay (2s) are hardcoded; adjust in `azureIngestionService.js` if needed for different ARM throttle profiles.

This design avoids the performance and cost penalties of real-time API calls during dashboard queries — all filtering happens on indexed SQL tables. Batching and retry logic ensure safe ingestion at scale.

## Live ingestion (Phase 1)

The dashboard now supports a secure internal ingestion path that reads Azure Compute quota usage and writes snapshots to `dbo.CapacitySnapshot`.

Defaults:

- Region preset: `USMajor`
- Family filters: all families (no restriction by default; set `INGEST_QUOTA_FAMILY_FILTERS` to limit scope)
- Source type written to SQL: `live-azure-ingest`

Required app settings:

- `INGEST_API_KEY` (required to call internal ingestion routes)
- `INGEST_REGION_PRESET` (default `USMajor`)
- `INGEST_QUOTA_FAMILY_FILTERS` (optional; comma-separated VM family names to restrict ingestion, e.g. `standard_BS,standard_DS`; omit or leave empty to ingest all families)
- `INGEST_SUBSCRIPTION_HASH_SALT` (optional salt for masked subscription key hashing)
- `INGEST_SUBSCRIPTION_IDS` (optional comma-separated list; if omitted, enabled subscriptions are auto-discovered)
- `INGEST_ON_STARTUP` (`true`/`false`, fallback default when SQL schedule settings are not present)
- `INGEST_INTERVAL_MINUTES` (`0` disables scheduling, fallback default when SQL schedule settings are not present)
- `AUTH_ENABLED` (`true` enables the dashboard Entra sign-in flow)
- `ENTRA_TENANT_ID` (tenant ID used for Microsoft Entra sign-in)
- `ENTRA_CLIENT_ID` (app registration/client ID for the dashboard)
- `ENTRA_CLIENT_SECRET` (app registration client secret for the dashboard)
- `AUTH_REDIRECT_URI` (OAuth callback URI, for example `https://app-capdash-dev-cap001.azurewebsites.net/auth/callback`)
- `ADMIN_GROUP_ID` (Object ID of the Entra security group whose members can access Admin sections)
- `QUOTA_MANAGEMENT_GROUP_ID` (required for live quota discovery)
- `CAPACITY_WORKER_BASE_URL` (optional Function App base URL for worker-first live placement execution)
- `CAPACITY_WORKER_SHARED_SECRET` (optional shared secret header value for worker calls)
- `CAPACITY_WORKER_TIMEOUT_MS` (optional timeout for worker calls, default `60000`)
- `CAPACITY_WORKER_DISABLE_LOCAL_FALLBACK` (`true` disables App Service fallback when the worker is configured but unavailable)
- `GET_AZ_VM_AVAILABILITY_ROOT` (optional path to Get-AzVMAvailability repository; required in production if Capacity Recommender feature is used; default is relative path `../../Get-AzVMAvailability` from `tools/` folder)
- `LIVE_PLACEMENT_REFRESH_ON_STARTUP` (`true`/`false`, fallback default when SQL schedule settings are not present)
- `LIVE_PLACEMENT_REFRESH_INTERVAL_MINUTES` (`0` disables scheduling; `1440` gives a daily refresh; fallback default when SQL schedule settings are not present)
- `LIVE_PLACEMENT_REFRESH_REGION_PRESET` (default `USMajor`)
- `LIVE_PLACEMENT_REFRESH_DESIRED_COUNT` (default `1`; use `1` if you want scheduled results reused automatically in the Capacity Score grid)
- `LIVE_PLACEMENT_REFRESH_SUBSCRIPTION_IDS` (optional comma-separated list; falls back to `INGEST_SUBSCRIPTION_IDS` when omitted)
- `LIVE_PLACEMENT_REFRESH_REGION` (optional single-region override, default `all`)
- `LIVE_PLACEMENT_REFRESH_FAMILY` (optional family filter, default `all`)
- `LIVE_PLACEMENT_REFRESH_AVAILABILITY` (optional availability filter, default `all`)
- `LIVE_PLACEMENT_REFRESH_EXTRA_SKUS` (optional comma-separated extra SKUs for scheduled placement checks)

Runtime note:

- The current Azure App Service host is Windows PowerShell `5.1`, which is sufficient for the Node/Express app itself but not sufficient for PowerShell-dependent Azure helpers that rely on newer Az module support.
- A dedicated PowerShell `7` Azure Function worker is now scaffolded as the preferred execution host for live placement and future quota group write operations.
- Until the worker is deployed and configured, the dashboard can still fall back to the local App Service path for rollback safety.

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

Example trigger (all families — omit `familyFilters` or pass empty array):

```powershell
Invoke-RestMethod -Method Post -Uri "https://<your-app>.azurewebsites.net/internal/ingest/capacity" -Headers @{ "x-ingest-key" = "<ingest-key>" } -Body (@{ regionPreset = "USMajor" } | ConvertTo-Json) -ContentType "application/json"
```

Example trigger (restricted to specific families):

```powershell
Invoke-RestMethod -Method Post -Uri "https://<your-app>.azurewebsites.net/internal/ingest/capacity" -Headers @{ "x-ingest-key" = "<ingest-key>" } -Body (@{ regionPreset = "USMajor"; familyFilters = @("standard_D","standard_E") } | ConvertTo-Json) -ContentType "application/json"
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
- `analysisRunId` `UNIQUEIDENTIFIER`
- `capturedAtUtc` `DATETIME2`
- `sourceCapturedAtUtc` `DATETIME2`
- `managementGroupId` `NVARCHAR(128)`
- `groupQuotaName` `NVARCHAR(128)`
- `subscriptionId` `NVARCHAR(64)`
- `subscriptionName` `NVARCHAR(256)`
- `region` `NVARCHAR(64)`
- `quotaName` `NVARCHAR(128)`
- `availabilityState` `NVARCHAR(32)`
- `quotaCurrent` `INT`
- `quotaLimit` `INT`
- `quotaAvailable` `INT`
- `suggestedMovable` `INT`
- `safetyBuffer` `INT`
- `subscriptionHash` `NVARCHAR(128)`
- `candidateStatus` `NVARCHAR(32)`

Status:
- Table exists in schema and is now written by the Admin `Capture History` flow for read-only candidate analysis runs.

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
- `GET /api/capacity/scores`
- `GET /api/capacity/scores/history`
- `GET /api/capacity/subscriptions`
- `GET /api/capacity/trends`

Data sources:
- `dbo.CapacityLatest` for current grid/subscription/family reporting.
- `dbo.CapacitySnapshot` for trend rollups.
- `dbo.CapacityScoreSnapshot` for historical regional SKU High/Medium/Low score snapshots captured during ingestion.

Key query behavior:
- Shared filters: region preset, region, resource type, family, availability, subscription IDs.
- Subscription filter is applied against `ISNULL(subscriptionId, 'legacy-data')`.
- Subscription selection in the reporting UI is rendered as a checkbox list (not multi-select highlight), and all loaded subscriptions are auto-selected on first load.
- **Resource Type filter** (`Compute` / `Disk` / `Other` / `All`) controls which families appear in the SKU Family dropdown. Defaults to `Compute` on load. Changing it resets the family selection and updates the grid.
- **SKU Family** has a live search text input above it; typing filters the dropdown options in real time to matching formatted labels or raw family values. The search resets when Resource Type changes.
- `SKU Family` dropdown options are entirely data-driven from `dbo.CapacityLatest.skuFamily`; there are no hardcoded pinned families. Family labels are formatted for readability (`Standard_Dasv7` instead of `StandardDasv7Family`).
- Region presets such as `US Commercial` and `Commercial Americas` act as a first-stage scope. The `Region` dropdown stays enabled for those presets so you can leave it at `All` or further narrow to one member region inside the preset.
- When a family that has a representative SKU mapping (defined in `FAMILY_EXTRA_SKU_MAP`) is selected, `Refresh Live Placement` automatically injects those SKUs into the live placement request.
- `GET /api/capacity/scores` remains a derived current-state dashboard score from `dbo.CapacityLatest`. The Score History table has been removed from the UI; persisted score snapshots remain in `dbo.CapacityScoreSnapshot` for backend use.
- `GET /api/capacity/families` in the reporting UX is intentionally requested with `family=all` so the Family Summary report remains populated even when the grid is currently scoped to a specific family.
- Summary KPI cards are report-aware: Region Matrix shows family/region readiness metrics, while Capacity Grid and other views keep row/quota/cost totals.
- On the Capacity Grid, the KPI cards use the full filtered result set, not only the currently visible page. Example: `Constrained Rows` reflects all filtered constrained rows across pagination.
- The High/Medium/Low dashboard score is intentionally separate from the live Azure Placement Score API used by `Get-AzVMAvailability`.
- `Desired Placement Count` in the `Capacity Score` view only affects the on-demand `Refresh Live Placement` action.
- The value is passed through to `Get-AzVMAvailability` as `DesiredCount`, which tells Azure placement scoring how many VMs you want to place at once. Example: `1` asks "can I likely place one VM here?" while `5` asks for the likelihood of placing five VMs together.
- The live placement UI clamps `Desired Placement Count` to `1000`. If a larger number is entered, the refresh status line reports the requested value and the effective value sent to the live placement API.
- Increasing `Desired Placement Count` raises the bar for a `High` live placement result, because the placement API is evaluating a larger simultaneous allocation request.
- `Desired Placement Count` does not change the persisted dashboard score history in `dbo.CapacityScoreSnapshot`.
- Live placement refreshes now persist snapshot rows to `dbo.LivePlacementSnapshot` for the effective desired count used by the refresh. The Capacity Score grid auto-hydrates from SQL snapshots for the currently selected desired count.

#### Data Ingestion (Admin page)

Admin UI APIs:
- `POST /api/admin/ingest/capacity`
- `GET /api/admin/ingest/status`
- `GET /api/admin/ingest/schedule`
- `PUT /api/admin/ingest/schedule`

Protected internal APIs:
- `POST /internal/ingest/capacity`
- `GET /internal/ingest/status`
- `POST /internal/db/ensure-phase3-schema`

Current UI behavior:
- `Refresh Subscriptions` refreshes the subscription catalog and updates the inline status banner.
- Capacity ingestion now persists both raw `dbo.CapacitySnapshot` rows and aggregated `dbo.CapacityScoreSnapshot` history for the same captured timestamp.
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
- `GET /api/quota/candidates` generates read-only quota candidate rows for the selected management group and quota group using current capacity data.
- `POST /api/quota/candidates/capture` persists the current candidate run into `dbo.QuotaCandidateSnapshot` with run metadata and source timestamps.
- `GET /api/quota/candidate-runs` lists captured `analysisRunId` history for the selected management group, quota group, and optional region/family filters.
- `GET /api/quota/plan` builds a read-only move plan from the selected captured `dbo.QuotaCandidateSnapshot` run.
- `POST /api/quota/simulate` computes projected donor/recipient quota availability after the proposed plan without writing to Azure.

Planned data/API direction:
- Discover group quotas from Microsoft.Quota APIs.
- Extend candidate analytics with configurable thresholds and report views over captured runs.

#### Quota Movements (Admin page)

Current API state:
- `GET /api/quota/candidate-runs` lets the Admin UI choose which captured `analysisRunId` to use for planning.
- `GET /api/quota/plan` powers `Build Move Plan` as a read-only workflow sourced from the selected captured candidate run in SQL.
- `POST /api/quota/simulate` powers `Simulate Impact` as a read-only projection over the selected captured run and proposed plan.
- `Apply Movements` is still a frontend placeholder; backend write routes are not yet implemented.

Execution prerequisite:
- When quota group move/apply execution is implemented, do not assume the App Service default shell is enough. The runtime will need PowerShell `7` and the relevant Az/Quota modules or API-capable helper tooling available on the executing host.

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
- Admin access is enforced by the dashboard auth middleware using the signed-in user's Entra group claims. Set `ADMIN_GROUP_ID` to the Object ID of the Entra security group allowed to see Admin sections and call admin-only APIs.

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
