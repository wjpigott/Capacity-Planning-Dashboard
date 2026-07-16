# Capacity Worker Function App

This function app is the PowerShell 7 execution host for operations that should not run inside the dashboard web app process.

Current endpoints:

- `POST /api/live-placement`
- `POST /api/paas-availability`
- `GET /api/report-snapshot`
- `POST /api/report-snapshot`
- `POST /api/quota-move-apply` (placeholder scaffold)

Phase 1 Azure AI capacity tracking does **not** add worker endpoints. Azure OpenAI quota + model catalog ingestion stay in the dashboard web app process behind feature flags, so the worker remains focused on PowerShell execution paths.

The dashboard can call this worker when `CAPACITY_WORKER_BASE_URL` is configured.

Report snapshots:

- `POST /api/report-snapshot` scans the configured subscriptions and regions, then writes `capacity-report-snapshots/latest.json` to the configured storage account.
- `GET /api/report-snapshot` returns the last stored snapshot without scanning.
- `GET /api/report-snapshot?action=scope` returns the saved report scope; `POST /api/report-snapshot` with `{ "action": "saveScope", "scope": { "subscriptionIds": [], "managementGroupNames": [], "captureRegions": [] } }` updates `capacity-report-snapshots/scope.json` for the Lite Admin UI.
- `POST /api/paas-db-quota-snapshot` captures PaaS database quota for the same saved scope, and `GET /api/paas-db-quota-snapshot` returns its last snapshot. It is stored separately as `paas-db-quota.json` so the slower PaaS scan does not run during normal capacity snapshot refreshes.
- `ReportSnapshotTimer` invokes the same capture every six hours.
- Set `CAPACITY_SNAPSHOT_STORAGE_ACCOUNT`, `CAPACITY_SUBSCRIPTION_ID`, and `CAPACITY_REPORT_REGIONS` on the worker. For a multi-subscription fallback scope, set `CAPACITY_MANAGEMENT_GROUP_NAMES` to a comma-separated list of management-group names; the worker resolves their descendant subscriptions for each snapshot. Capacity Admins can save `captureRegions` as comma-separated Azure region codes; a non-empty saved list takes precedence over `CAPACITY_REPORT_REGIONS`, while a blank saved list retains the deployment fallback. Grant its managed identity `Reader` and `Compute Recommendations Role` on each target subscription or on the configured parent management group; saving scope does not grant RBAC.

Host storage:

- The worker should use identity-based `AzureWebJobsStorage` settings in Azure.
- Grant the Function App identity storage data-plane roles on the host storage account.
- Do not rely on shared-key storage access for hosted environments.
- In locked-down environments, route host storage through private endpoints for Blob, Queue, Table, and File services with the matching `privatelink.<service>.core.windows.net` DNS zones, and integrate the Function App with the VNet hosting those endpoints.
- The default hosted path is a dedicated App Service-backed Function App rather than Flex Consumption.
- NOTE: for `POST /api/live-placement`, the Function App managed identity also needs Azure RBAC on each target subscription. The minimum built-in role confirmed for the placement score API is `Compute Recommendations Role`, which includes `Microsoft.Compute/locations/placementScores/generate/action`. Scope this to the subscriptions the worker queries, or to a parent management group if that is how access is administered.

Worker request authentication:

- Preferred hardening path: enable App Service Authentication on the Function App and have the dashboard Web App send a Microsoft Entra bearer token acquired for the worker audience.
- Keep HTTP trigger `authLevel` as `anonymous` in Easy Auth mode because App Service Authentication rejects unauthenticated traffic before the PowerShell function code runs.
- Shared-secret mode remains the rollback/default path until Easy Auth is promoted by infrastructure and deployment docs.

Optional shared-secret fallback:

- Set `WORKER_SHARED_SECRET` in the Function App.
- Set the same value as `CAPACITY_WORKER_SHARED_SECRET` in the dashboard app.

Local development:

1. Copy `local.settings.sample.json` to `local.settings.json`.
2. Start the function host with Azure Functions Core Tools.
3. Point the dashboard at the worker by setting `CAPACITY_WORKER_BASE_URL`.

## Self-hosted Lite worker

The worker can run on a Windows laptop or Windows Server without an Azure Function App, Azure Storage Account, or Azure SQL Database. In this mode, Azure is used only for the capacity, placement, quota, and pricing APIs that the worker queries.

Install these local prerequisites:

- Node.js LTS
- PowerShell 7
- Azure Functions Core Tools v4
- Azurite
- Az PowerShell modules from `requirements.psd1`

Copy `local.settings.sample.json` to `local.settings.json` and retain these settings:

```json
{
	"AzureWebJobsStorage": "UseDevelopmentStorage=true",
	"CAPACITY_SNAPSHOT_STORAGE_MODE": "local",
	"CAPACITY_SNAPSHOT_LOCAL_PATH": "C:\\CapacityDashboard\\data"
}
```

`AzureWebJobsStorage` is used only by the local Functions runtime for timer coordination. Run Azurite locally before starting the Function host. The report snapshot and saved report scope are persisted to `latest.json` and `scope.json` under `CAPACITY_SNAPSHOT_LOCAL_PATH`; they never use Azure Blob Storage in local mode.

For a laptop pilot, sign in to Az PowerShell before starting the host and set `CAPACITY_SUBSCRIPTION_ID`:

```powershell
Connect-AzAccount
Set-AzContext -SubscriptionId '<subscription-id>'
```

To scan every descendant subscription in one or more management groups, set `CAPACITY_MANAGEMENT_GROUP_NAMES` to a comma-separated list and leave `CAPACITY_SUBSCRIPTION_ID` empty. The identity running the worker needs permission to enumerate the management group and read the target subscriptions.

For an unattended Windows Server installation, set `CAPACITY_AZURE_AUTH_MODE` to `service-principal-certificate` and configure `CAPACITY_AZURE_TENANT_ID`, `CAPACITY_AZURE_CLIENT_ID`, and `CAPACITY_AZURE_CLIENT_CERTIFICATE_PATH`. `service-principal-secret` is also supported through `CAPACITY_AZURE_CLIENT_SECRET` when certificate authentication is unavailable. Grant the selected identity Azure RBAC at the subscriptions or management groups it scans.

Start the local worker and dashboard in separate terminals:

```powershell
azurite
func start --script-root ./functions/CapacityWorker

$env:CAPACITY_DEPLOYMENT_PROFILE = 'lite'
$env:CAPACITY_WORKER_BASE_URL = 'http://127.0.0.1:7071'
$env:CAPACITY_WORKER_AUTH_MODE = 'shared-secret'
$env:CAPACITY_WORKER_SHARED_SECRET = '<same-value-as-WORKER_SHARED_SECRET>'
$env:AUTH_ENABLED = 'false'
npm start
```

The local worker exposes the existing endpoints at `http://127.0.0.1:7071/api/*`. The report timer continues to run every six hours, or an administrator can request an on-demand report refresh through the dashboard.

Module restore:

- `host.json` enables PowerShell managed dependencies.
- `requirements.psd1` should restore the Az modules needed by live placement on dedicated App Service hosting.
