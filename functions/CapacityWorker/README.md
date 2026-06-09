# Capacity Worker Function App

This function app is the PowerShell 7 execution host for operations that should not run inside the dashboard web app process.

Current endpoints:

- `POST /api/live-placement`
- `POST /api/paas-availability`
- `POST /api/quota-move-apply` (placeholder scaffold)

Phase 1 Azure AI capacity tracking does **not** add worker endpoints. Azure OpenAI quota + model catalog ingestion stay in the dashboard web app process behind feature flags, so the worker remains focused on PowerShell execution paths.

The dashboard can call this worker when `CAPACITY_WORKER_BASE_URL` is configured.

Host storage:

- The worker should use identity-based `AzureWebJobsStorage` settings in Azure.
- Grant the Function App identity storage data-plane roles on the host storage account.
- Do not rely on shared-key storage access for hosted environments.
- In locked-down environments, route host storage through private endpoints for blob, queue, table, and file services with the matching `privatelink.<service>.core.windows.net` DNS zones.
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

Module restore:

- `host.json` enables PowerShell managed dependencies.
- `requirements.psd1` should restore the Az modules needed by live placement on dedicated App Service hosting.
