# Self-Hosted Capacity Dashboard Lite

This profile runs the Capacity Dashboard Lite UI, PowerShell worker functions, timer scheduler, and report snapshot files on a Windows laptop or Windows Server. It does not require Azure App Service, Azure Functions, Azure Storage, Azure SQL, Key Vault, or private endpoints.

Azure remains necessary only as the external control plane: the worker calls Azure Resource Manager capacity, placement, quota, and pricing APIs using an identity with the required Azure RBAC.

## Components

- Node.js hosts the dashboard at `http://127.0.0.1:3000` by default.
- Azure Functions Core Tools hosts the PowerShell worker at `http://127.0.0.1:7071`.
- Azurite provides the Functions host's local timer and runtime storage.
- `CAPACITY_SNAPSHOT_LOCAL_PATH` stores the report snapshot and saved scope as JSON files.

## Required configuration

Set these worker values in `functions/CapacityWorker/local.settings.json`:

```json
{
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "powershell",
    "WORKER_SHARED_SECRET": "use-a-unique-random-secret",
    "CAPACITY_SNAPSHOT_STORAGE_MODE": "local",
    "CAPACITY_SNAPSHOT_LOCAL_PATH": "C:\\CapacityDashboard\\data",
    "CAPACITY_SUBSCRIPTION_ID": "<subscription-id>",
    "CAPACITY_MANAGEMENT_GROUP_NAMES": "",
    "CAPACITY_AZURE_AUTH_MODE": "service-principal-certificate",
    "CAPACITY_AZURE_TENANT_ID": "<tenant-id>",
    "CAPACITY_AZURE_CLIENT_ID": "<application-id>",
    "CAPACITY_AZURE_CLIENT_CERTIFICATE_PATH": "C:\\CapacityDashboard\\identity.pfx"
  }
}
```

Set these dashboard process variables:

```powershell
$env:CAPACITY_DEPLOYMENT_PROFILE = 'lite'
$env:CAPACITY_WORKER_BASE_URL = 'http://127.0.0.1:7071'
$env:CAPACITY_WORKER_AUTH_MODE = 'shared-secret'
$env:CAPACITY_WORKER_SHARED_SECRET = '<same-value-as-WORKER_SHARED_SECRET>'
```

For a single-user laptop pilot, leave `CAPACITY_AZURE_AUTH_MODE` empty and authenticate Az PowerShell interactively with `Connect-AzAccount` before starting the worker. For an unattended Windows Server, use certificate authentication and protect the certificate with Windows certificate/private-key permissions.

## Management-group scope

Set `CAPACITY_MANAGEMENT_GROUP_NAMES` to one or more comma-separated management-group names when the worker should discover and scan their descendant subscriptions. Leave `CAPACITY_SUBSCRIPTION_ID` empty in that configuration. The worker resolves descendants from Azure Resource Manager for each snapshot and writes the resulting subscription IDs only to the local snapshot file.

The local service identity must be allowed to enumerate the management group and read the subscriptions below it. Existing dashboard administrators can also save subscription, management-group, and capture-region scope through the Lite Admin experience; in self-hosted mode, the selection is persisted to local `scope.json` rather than Azure Blob Storage. A non-empty saved capture-region list overrides `CAPACITY_REPORT_REGIONS`; leave it blank to use the configured fallback.

## Data location and recovery

The local data directory contains:

- `latest.json`: most recently captured capacity report.
- `paas-db-quota.json`: most recently captured PaaS DB Quota report.
- `scope.json`: administrator-selected subscription, management-group, and capture-region scope.

Back up this directory if report continuity matters. Removing `latest.json` or `paas-db-quota.json` causes the corresponding report to show no data until its next refresh. Removing `scope.json` returns the worker to its configured subscription or management-group scope.

## Operations

Run Azurite, the Function host, and the Node dashboard as separate Windows services for a shared Windows Server deployment. Bind the dashboard to loopback only unless a reverse proxy terminates HTTPS and controls access. Keep the Function worker on loopback and use its shared secret even when it is not externally exposed.

The current implementation retains the worker's existing Azure API behavior. Quota apply operations can change Azure quota allocations and should be enabled only after the service identity has the intended least-privilege role assignments.

PaaS DB Quota is refreshed independently from Capacity Grid. It uses the saved Lite Azure Scope, including saved capture regions, and stores its result in `paas-db-quota.json`. The PaaS scan queries several resource providers, so use the dedicated **Refresh PaaS DB Quota** action when current database quota data is needed.