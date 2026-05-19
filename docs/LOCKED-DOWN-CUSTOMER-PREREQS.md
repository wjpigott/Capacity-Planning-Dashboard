# Locked-Down Customer Environment Prerequisites

Use this checklist when deploying the Capacity Planning Dashboard into a tightly controlled customer environment where shared services, networking, identity, and database administration are owned by customer platform teams.

The goal is to have the required Azure resources, private networking, DNS, identities, and operator access ready before a deployment operator runs the dashboard deployment scripts from the customer-approved network.

## Deployment Source

Use the current project repository:

```text
https://github.com/wjpigott/Capacity-Planning-Dashboard
```

Do not use older `capacity-dashboard` clones or cached folders. In controlled environments, confirm the deployment machine can either pull this repository directly from GitHub or receive a customer-approved copy of the same repository content.

## Operator Machine Requirement

If the user's computer running the deployment is not on the customer's ExpressRoute, private DNS, or internal firewall path. For private SQL, private Key Vault, and private endpoint validation, the deployment must run from a customer-approved machine that can reach those private endpoints.

Recommended options:

- Customer-managed jump box or admin VM reachable by RDP.
- Self-hosted deployment runner inside the customer network.
- Privileged admin workstation with private DNS resolution and firewall access to the target VNet/private endpoints.

The deployment machine needs outbound access to the services used during setup:

- GitHub repository access: `https://github.com/wjpigott/Capacity-Planning-Dashboard`
- Azure CLI login and Azure Resource Manager APIs.
- Terraform provider downloads if Terraform is used directly.
- Node/npm package restore if the web package deployment test gate runs locally.
- Azure SQL endpoint access when running `scripts/initialize-database.ps1` directly.

If outbound internet is blocked, the customer should provide an approved package mirror, pre-staged repository zip, Terraform provider cache, and npm package cache before the deployment window.

Recommended tooling on the customer-approved machine:

- Visual Studio Code with the GitHub Copilot extension enabled for operator troubleshooting and script review, if customer policy allows it.
- Git for cloning or updating the approved repository copy.
- PowerShell 7 for running the deployment and database helper scripts consistently.
- Azure CLI for subscription selection, deployment, identity lookup, and RBAC follow-up commands.
- Node.js and npm, followed by `npm install` from the repository root before web package deployment. The local test gate loads runtime dependencies such as `mssql`, `@azure/identity`, and `@azure/msal-node`.
- Terraform if the Terraform deployment path is used.
- `sqlcmd` for manual database initialization and DBA handoff scripts.

## Pre-Created Azure Resources

The customer platform team should pre-create or approve the following resources before deployment. Some resources can be created by the dashboard infrastructure templates, but in locked-down environments these are often centrally managed and should be ready ahead of time.

| Resource | Required preparation |
| --- | --- |
| Resource group | Target resource group for the dashboard environment. Confirm region, tags, policies, locks, and who has deployment rights. |
| Virtual network | Existing VNet for private connectivity. Provide the VNet name and resource group if it is outside the dashboard resource group. |
| App Service integration subnet | Subnet delegated to `Microsoft.Web/serverFarms`. This is used for web app/function app VNet integration. |
| Private endpoint subnet | Subnet for private endpoints. Network policies and route tables must allow private endpoint use according to customer standards. |
| Azure SQL server and database | SQL server and database, Microsoft Entra admin configured, and network rules/private endpoint ready. Azure SQL should be reachable from the deployment machine if manual bootstrap is required. |
| Key Vault | Vault for runtime secrets. Prefer RBAC authorization. Confirm private endpoint, DNS, purge protection/soft-delete policy, and customer ownership model. |
| Worker storage account | Function App host storage account. Configure private endpoints and data-plane RBAC for the worker identity after it exists. |
| Application Insights / Log Analytics | Monitoring workspace and Application Insights may be template-created unless the customer requires central logging resources. Confirm retention and data residency requirements. |
| App Service plan / Web App / Function App | The default deployment creates these. If the customer requires them to be pre-created, confirm the current templates and scripts support that operating model before the deployment window. |

When reusing customer-managed services, use the deployment wrapper switches instead of forcing the templates to create duplicates:

```powershell
./scripts/deploy-infra.ps1 `
  -ExistingSqlServerName "<sql-server-name>" `
  -ExistingSqlDatabaseName "<sql-database-name>" `
  -ExistingKeyVaultName "<key-vault-name>" `
  -ExistingWorkerStorageAccountName "<storage-account-name>" `
  -ExistingVirtualNetworkName "<vnet-name>" `
  -ExistingAppServiceIntegrationSubnetName "<app-service-integration-subnet>" `
  -ExistingPrivateEndpointSubnetName "<private-endpoint-subnet>"
```

If reused resources live outside the dashboard resource group, also provide the matching resource group override switches:

- `-ExistingSqlServerResourceGroupName`
- `-ExistingKeyVaultResourceGroupName`
- `-ExistingWorkerStorageResourceGroupName`
- `-ExistingVirtualNetworkResourceGroupName`

## Private Networking And DNS

Private endpoints and DNS need to be working before the app or database bootstrap is validated.

Prepare private DNS zones and VNet links for the resource types in use:

| Service | Common private DNS zone |
| --- | --- |
| Azure SQL | `privatelink.database.windows.net` |
| Key Vault | `privatelink.vaultcore.azure.net` |
| Storage Blob | `privatelink.blob.core.windows.net` |
| Storage Queue | `privatelink.queue.core.windows.net` |
| Storage Table | `privatelink.table.core.windows.net` |
| Storage File | `privatelink.file.core.windows.net` |
| App Service private endpoint, if used | `privatelink.azurewebsites.net` |

Validate from the deployment machine or jump box:

- SQL server FQDN resolves to a private IP when private SQL is required.
- Key Vault FQDN resolves to a private IP when public access is disabled.
- Storage endpoints used by the Function App host resolve privately when storage public access is disabled.
- The deployment machine can reach Azure SQL on port `1433` if `scripts/initialize-database.ps1` will be run manually.
- App Service outbound traffic can reach SQL, Key Vault, and storage over the approved private path.

## Microsoft Entra Preparation

Create the Microsoft Entra application registration before deployment when dashboard sign-in is enabled.

Required app registration settings:

- Redirect URI: `https://<web-app-name>.azurewebsites.net/auth/callback`
- Client secret or customer-approved credential mechanism.
- Token configuration: add a **Groups** claim, select **Security groups**, expand **ID**, and keep **Group ID** selected.
- Record the tenant ID, client ID, and client secret for deployment. Store secrets according to customer policy, normally in Key Vault.

Create or identify these Entra security groups:

| Group | Purpose |
| --- | --- |
| `CapacityAdmin` | Grants dashboard admin access when its object ID is configured as `ADMIN_GROUP_ID`. |
| `CapacityReportViewers` | Grants report viewer access when its object ID is included in `REPORT_VIEWER_GROUP_IDS`. |

Record each group object ID. The dashboard compares group object IDs from the ID token to `ADMIN_GROUP_ID` and `REPORT_VIEWER_GROUP_IDS`; display names alone are not enough.

If group creation is centrally managed, pass the object IDs explicitly during deployment instead of relying on script discovery:

```powershell
-AdminGroupId "<capacity-admin-group-object-id>" `
-ReportViewerGroupIds @("<capacity-report-viewers-group-object-id>")
```

## Azure RBAC Preparation

Some RBAC can only be assigned after the deployment creates system-assigned managed identities for the Web App and Function App. The platform team should be ready to assign these roles, or give the deployment identity `Owner` or `User Access Administrator` at the required scopes.

Dashboard web app managed identity:

- `Reader` at the subscriptions or management groups that the dashboard reads.
- `Billing Reader` at subscriptions or billing scopes if billing/cost data is used.
- `GroupQuota Request Operator` at the management group and participating subscriptions if quota apply workflows are enabled.
- `Key Vault Secrets User` on the dashboard Key Vault.
- SQL database roles granted by `scripts/initialize-database.ps1`: `db_datareader` and `db_datawriter`.

Function App worker managed identity:

- `Compute Recommendations Role` at the required subscription or management group scopes.
- `Cost Management Reader` where recommendation/reporting workflows need cost data.
- `Billing Reader` where billing data is used.
- Storage data-plane roles on the Function App host storage account:
  - `Storage Blob Data Owner`
  - `Storage Queue Data Contributor`
  - `Storage Table Data Contributor`

The helper below can be run by an identity with rights at the management group after the Web App and Function App identities exist:

```powershell
./scripts/grant-management-group-rbac.ps1 `
  -ManagementGroupNames @("<management-group-name>") `
  -WebPrincipalId "<dashboard-web-managed-identity-principal-id>" `
  -WorkerPrincipalId "<function-worker-managed-identity-principal-id>"
```

Use `-WhatIf` first during planning.

## Database Bootstrap Requirement

The dashboard does not work correctly until the database schema, migrations, and app identity database roles are applied.

In locked-down SQL environments, expect to run this command from the approved customer machine or hand it to the DBA team:

```powershell
./scripts/initialize-database.ps1 `
  -SqlServer "<sql-server-name>.database.windows.net" `
  -SqlDatabase "<sql-database-name>" `
  -AppIdentityName "<web-app-managed-identity-name>" `
  -AuthenticationMethod ActiveDirectoryInteractive
```

This command applies `sql/schema.sql`, runs all SQL migrations, creates the external provider user for the Web App managed identity, and grants runtime roles.

If this command is skipped or cannot reach SQL, the app may deploy successfully but return HTTP 500 errors for DB-backed APIs until database initialization succeeds.

## Deployment Machine Checklist

Before the operator starts:

- RDP/jump-box access is approved and tested.
- The machine can access the correct GitHub repository or an approved offline copy.
- Visual Studio Code with GitHub Copilot is installed and approved for use if the customer allows assisted troubleshooting on the deployment machine.
- Git is installed for repository clone/pull operations.
- PowerShell 7 is installed for the deployment scripts.
- Azure CLI is installed and `az login` works for the deployment identity.
- Terraform is installed if the Terraform path is used.
- Node.js and npm are installed, and `npm install` can complete from the repo root or approved package cache.
- `sqlcmd` is installed for manual database initialization.
- Private DNS resolution works for SQL, Key Vault, and storage from the machine.
- Firewall rules allow the machine to reach private SQL if database initialization is run manually.
- The deployment identity has enough rights, or the customer RBAC/DBA teams are available during the deployment window.

## Recommended Deployment Sequence

1. Customer platform team pre-creates shared resources, private endpoints, DNS zones, Entra app registration, and Entra groups.
2. Deployment operator connects to the approved internal machine.
3. Clone or stage `https://github.com/wjpigott/Capacity-Planning-Dashboard` on that machine.
4. Run `npm install` from the repository root.
5. Run the guided deployment or direct `scripts/deploy-infra.ps1` command with existing-resource switches and explicit group IDs.
6. Capture Web App and Function App managed identity principal IDs from deployment output or Azure CLI.
7. Assign management-group/subscription RBAC for web and worker identities.
8. Run `scripts/initialize-database.ps1` from the approved network path or have the DBA team run it.
9. Restart the Web App after identity/RBAC/database changes.
10. Validate `https://<web-app-name>.azurewebsites.net/api/auth/me` and the dashboard root URL.

## Customer Inputs To Collect

Collect these values before the deployment window:

- Azure subscription ID and tenant ID.
- Resource group name and region.
- Existing SQL server name, database name, and resource group.
- SQL Entra admin login and object ID.
- Existing Key Vault name and resource group.
- Existing worker storage account name and resource group.
- Existing VNet name, resource group, integration subnet, and private endpoint subnet.
- Entra app registration client ID, tenant ID, redirect URI approval, and secret handling process.
- `CapacityAdmin` group object ID.
- `CapacityReportViewers` group object ID.
- Management group names for Reader/quota/worker RBAC.
- Whether public network access is disabled for SQL, Key Vault, storage, and App Service.
- Approved machine or runner where deployment and database bootstrap will run.
