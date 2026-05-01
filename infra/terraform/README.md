# Capacity Dashboard – Terraform Infrastructure

Terraform equivalent of the Bicep templates in this folder. Provisions the full Azure baseline for the Capacity Dashboard solution, including the resource group itself.

## Resources (26 total)

| Resource | Terraform Resource |
|---|---|
| Resource Group | `azurerm_resource_group.rg` |
| Virtual Network + 2 subnets | `azurerm_virtual_network.vnet`, `azurerm_subnet` (×2) |
| App Service Plan (Web) – P1v3 | `azurerm_service_plan.web` |
| App Service Plan (Worker) – B1 | `azurerm_service_plan.worker` |
| Windows Web App | `azurerm_windows_web_app.web` |
| Windows Function App (PowerShell 7.4) | `azurerm_windows_function_app.worker` |
| Storage Account (Function App, no shared keys) | `azurerm_storage_account.function_storage` |
| Azure SQL Server (Entra-only auth) | `azurerm_mssql_server.sql` |
| SQL Database – S0 | `azurerm_mssql_database.db` |
| Key Vault (RBAC authorization) | `azurerm_key_vault.kv` |
| Application Insights + Log Analytics | `azurerm_application_insights.ai`, `azurerm_log_analytics_workspace.law` |
| SQL Private Endpoint + DNS zone + VNet link | `azurerm_private_endpoint.sql`, `azurerm_private_dns_zone.sql`, `azurerm_private_dns_zone_virtual_network_link.sql` |
| Key Vault Private Endpoint + DNS zone + VNet link | `azurerm_private_endpoint.kv`, `azurerm_private_dns_zone.kv`, `azurerm_private_dns_zone_virtual_network_link.kv` |
| Role Assignments (5) | KV Secrets User (×2), Storage Blob/Queue/Table (×3) |
| Cross-scope RBAC (modules) | `worker-subscription-rbac`, `worker-management-group-rbac`, `web-subscription-reader`, `web-management-group-reader`, `web-subscription-quota-writer`, `web-management-group-quota-writer` |

## File layout

```
infra/terraform/
├── backend.tf                  # Local backend configuration
├── providers.tf                # azurerm (~> 3.0) + random (~> 3.0) provider config
├── variables.tf                # All input variables (all have defaults)
├── main.tf                     # All resources and module calls
├── outputs.tf                  # 13 output values (all with descriptions)
├── terraform.tfvars.example    # Example variable overrides
├── README.md                   # This file
└── modules/
    ├── worker-subscription-rbac/             # Subscription-scope worker RBAC
    ├── worker-management-group-rbac/         # Management-group-scope worker RBAC
    ├── web-subscription-reader/              # Subscription-level Reader for web app
    ├── web-management-group-reader/          # Management-group-level Reader for web app
    ├── web-subscription-quota-writer/        # Subscription-level GroupQuota Request Operator
    └── web-management-group-quota-writer/    # Management-group-level GroupQuota Request Operator
```

## Prerequisites

- Terraform >= 1.5.0 and < 1.6.0
- Azure CLI authenticated (`az login`) with **Contributor** + **User Access Administrator** on the target subscription
- State is stored locally in `terraform.tfstate` (update `backend.tf` to use a remote backend if needed)

## Before first apply

`terraform.tfvars` is gitignored by the repo (`*.tfvars` in the root `.gitignore`).
Populate your local `infra/terraform/terraform.tfvars` before running Terraform if you want environment-specific values such as auth settings, secrets, and subscription RBAC lists.

Have these values ready before you create `terraform.tfvars` or run `terraform apply`:

- Azure subscription selected in Azure CLI with `az account set --subscription <subscription-id-or-name>`
- Microsoft Entra user or group that will be the Azure SQL Entra admin
    - `sql_entra_admin_login`
    - `sql_entra_admin_object_id`
- Shared secrets for the dashboard runtime
    - `ingest_api_key`
    - `session_secret`
    - optional `worker_shared_secret`
- Optional management-group default for quota workflows
    - `quota_management_group_id`
- Management-group names for the preferred cross-scope RBAC path in larger estates
    - `web_reader_management_group_names`
    - `web_quota_writer_management_group_names`
    - `worker_rbac_management_group_names`
- Subscription lists for the fallback cross-subscription access path
    - `web_reader_subscription_ids`
    - `web_quota_writer_subscription_ids`
    - `worker_subscription_rbac_subscription_ids`

If you want dashboard sign-in enabled, create the Microsoft Entra app registration first. Terraform does not create the app registration for you.

`auth_enabled` now defaults to `true` for deployed environments.

Required app registration inputs when `auth_enabled = true`:

- `entra_tenant_id`
- `entra_client_id`
- `entra_client_secret`
- optional `admin_group_id`
- optional `auth_redirect_uri`

Optional app registration management:

- Set `manage_entra_web_redirect_uri = true` if you want Terraform to append the generated dashboard callback URL to the existing app registration's web redirect URIs.
- Terraform will look up the app registration by `entra_client_id` and preserve any existing web redirect URIs it can read.
- The identity running Terraform must be allowed to read and update Entra applications. With a service principal, that means `Application.ReadWrite.OwnedBy` or `Application.ReadWrite.All`, plus ownership of the app when using `OwnedBy`.
- If you need to preserve redirect URIs that Terraform cannot read yet or want to keep non-production callbacks explicit, add them to `extra_entra_web_redirect_uris`.

Recommended app registration setup:

- Redirect URI: `https://<web-app-name>.azurewebsites.net/auth/callback`
- Add the admin security group up front if you plan to gate Admin routes with `admin_group_id`

## Region and naming guidance

- Default deployment region is `centralus`.
- If you are deploying into an existing resource group in a different region, keep the resource group's actual region in `resource_group_location` and use `location` for the new resources.
- Do not assume globally unique names such as the Function App host name or Key Vault name are available. If Azure reports that a name already exists, change `workload_suffix` and re-run the plan.
- If only the Key Vault name is blocked by soft-delete retention, set `key_vault_name_override` to a different globally unique vault name instead of renaming the entire environment.
- Azure SQL region availability is subscription-dependent. If Azure rejects SQL provisioning in one region, change `location` to a supported region and re-run `terraform plan` before `apply`.

Example for an existing East US resource group with resources deployed in Central US:

```hcl
resource_group_name     = "CapacityPlanning"
resource_group_location = "eastus"
location                = "centralus"
environment             = "dev"
workload_suffix         = "cap003"
```

## Existing resource groups

The Terraform configuration declares the resource group as a managed resource. That means:

- If the resource group does not exist yet, Terraform can create it.
- If the resource group already exists, import it before the first apply.

Example import:

```powershell
terraform import -var-file="terraform.tfvars" azurerm_resource_group.rg "/subscriptions/<subscription-id>/resourceGroups/<resource-group-name>"
```

## Quick start

All variables have sensible defaults, so a minimal deploy requires no tfvars file:

```powershell
cd infra/terraform
terraform init
terraform apply
```

To customize, copy and edit the example tfvars:

```powershell
Copy-Item terraform.tfvars.example terraform.tfvars
```

If you use `./scripts/deploy-infra.ps1 -Provider Terraform`, Terraform still auto-loads `infra/terraform/terraform.tfvars` by default. Pass `-AuthEnabled`, `-EntraTenantId`, `-IngestApiKey`, `-SessionSecret`, or the other flags only when you intentionally want the wrapper command line to override what is already in `terraform.tfvars`.

The script-based Terraform path also publishes both application packages after the infrastructure apply:

- the dashboard web app package to the Web App
- the worker Function App package to the Function App

```hcl
# terraform.tfvars
resource_group_name       = "rg-capacity-dashboard-dev"
resource_group_location   = "centralus"
location                  = "centralus"
environment               = "dev"
workload_suffix           = "demo001"
sql_entra_admin_login     = "user@contoso.com"
sql_entra_admin_object_id = "00000000-0000-0000-0000-000000000000"
ingest_api_key            = "your-ingest-key"
session_secret            = "your-session-secret"
quota_management_group_id = "Demo-MG"
# web_reader_management_group_names       = ["Demo-MG", "LandingZones-MG"]
# web_quota_writer_management_group_names = ["Demo-MG", "LandingZones-MG"]
# worker_rbac_management_group_names      = ["Demo-MG", "LandingZones-MG"]
```

Then apply:

```powershell
terraform apply -var-file="terraform.tfvars"
```

## Post-deploy database initialization

Treat database initialization as a separate explicit post-deploy step for customer environments. This is the same recommendation as the Bicep deployment path.

- `deploy-infra.ps1 -Provider Terraform` does not automatically switch to local `sqlcmd` execution just because the operator machine can reach Azure SQL. Its built-in behavior still calls the deployed web app bootstrap endpoints unless you disable that step.
- When the customer runbook requires a separate DBA or network-approved initialization step, pass `-ApplyDatabaseBootstrap $false` during infra/app deployment and then run `scripts/initialize-database.ps1` explicitly afterward.
- Run `scripts/initialize-database.ps1` as the Azure SQL Entra admin after the infrastructure and app deploy complete.
- If Azure SQL remains private-only, execute that script from an approved network path such as an ExpressRoute-connected admin workstation, a self-hosted deployment runner, or an Azure VM that can reach the SQL endpoint.
- Do not assume a random operator laptop or hosted CI runner can reach the database just because the customer has ExpressRoute.
- Keep the web app managed identity at runtime roles such as `db_datareader` and `db_datawriter` after initialization rather than relying on permanent DDL rights in the app.

Example:

```powershell
./scripts/initialize-database.ps1 \
    -SqlServer "sql-capdash-<environment>-<suffix>.database.windows.net" \
    -SqlDatabase "sqldb-capdash-<environment>" \
    -AppIdentityName "app-capdash-<environment>-<suffix>"
```

## Variables

All variables have defaults and can be overridden via tfvars or CLI flags.

| Variable | Default | Description |
|---|---|---|
| `location` | `centralus` | Azure region for all resources |
| `resource_group_location` | `""` | Optional resource group region override when the resource group already exists in a different region |
| `environment` | `dev` | Environment token (`dev`, `test`, `prod`) |
| `workload_suffix` | `demo001` | Unique suffix (3-12 chars) for resource naming |
| `key_vault_name_override` | `""` | Optional explicit Key Vault name when the default `kv-capdash-<environment>-<suffix>` is unavailable |
| `resource_group_name` | `rg-capacity-dashboard-dev` | Resource group name (created by Terraform) |
| `sql_entra_admin_login` | *(set in defaults)* | Entra admin UPN for SQL Server |
| `sql_entra_admin_object_id` | *(set in defaults)* | Entra admin object ID for SQL Server |
| `existing_sql_server_name` | `""` | Existing Azure SQL server name to reuse |
| `existing_sql_server_resource_group_name` | `""` | Optional resource group override for the existing Azure SQL server |
| `existing_sql_database_name` | `""` | Existing Azure SQL database name to reuse; requires `existing_sql_server_name` |
| `ingest_api_key` | `change-me-ingest-key` | Shared secret for ingestion routes (sensitive) |
| `session_secret` | `change-me-session-secret` | Session middleware secret (sensitive) |
| `vnet_address_prefix` | `10.90.0.0/16` | VNet address space |
| `app_service_integration_subnet_prefix` | `10.90.1.0/24` | App Service integration subnet |
| `private_endpoint_subnet_prefix` | `10.90.2.0/24` | Private endpoint subnet |
| `sql_public_network_access` | `Disabled` | SQL Server public access |
| `key_vault_public_network_access` | `Disabled` | Key Vault public access |
| `existing_key_vault_name` | `""` | Existing Key Vault name to reuse |
| `existing_key_vault_resource_group_name` | `""` | Optional resource group override for the existing Key Vault |
| `worker_shared_secret` | `""` | Shared secret between web app and worker (sensitive) |
| `existing_worker_storage_account_name` | `""` | Existing worker storage account name to reuse |
| `existing_worker_storage_account_resource_group_name` | `""` | Optional resource group override for the existing worker storage account |
| `quota_management_group_id` | `""` | Management group ID for quota discovery |
| `auth_enabled` | `true` | Enable Entra sign-in |
| `entra_tenant_id` | `""` | Entra tenant ID |
| `entra_client_id` | `""` | Entra app client ID |
| `entra_client_secret` | `""` | Entra app client secret (sensitive) |
| `auth_redirect_uri` | `""` | Auth callback URI (auto-generated if empty) |
| `manage_entra_web_redirect_uri` | `false` | Update the existing Entra app registration web redirect URIs |
| `extra_entra_web_redirect_uris` | `[]` | Extra web redirect URIs to preserve when Terraform manages Entra redirects |
| `admin_group_id` | `""` | Entra group for admin access |
| `web_reader_management_group_names` | `[]` | Management groups for web app Reader role |
| `web_quota_writer_management_group_names` | `[]` | Management groups for GroupQuota Request Operator |
| `worker_rbac_management_group_names` | `[]` | Management groups for worker RBAC roles |
| `web_reader_subscription_ids` | `[]` | Subscription fallback for web app Reader role |
| `web_quota_writer_subscription_ids` | `[]` | Subscription fallback for GroupQuota Request Operator |
| `worker_subscription_rbac_subscription_ids` | `[]` | Subscription fallback for worker RBAC roles |
| `assign_worker_compute_recommendations_role` | `true` | Toggle Compute Recommendations Role |
| `assign_worker_cost_management_reader_role` | `true` | Toggle Cost Management Reader |
| `assign_worker_billing_reader_role` | `true` | Toggle Billing Reader |
| `admin_ssh_public_key` | `""` | Unused – declared for backward compatibility |

Quota management-group note:

- Set `quota_management_group_id` when you expect the Admin quota experience to default to a known management group, or when tenant-wide management-group enumeration is restricted and the UI needs a fallback management group to return.

Existing shared-service reuse note:

- Set `existing_sql_server_name`, `existing_key_vault_name`, or `existing_worker_storage_account_name` when the customer already owns those Azure dependencies.
- Set `existing_sql_database_name` only when the dashboard should attach to an existing database on that existing SQL server.
- When `existing_sql_server_name` or `existing_key_vault_name` is set, Terraform assumes the customer-managed private endpoint and DNS path already exists for that dependency and will not create a new SQL or Key Vault private endpoint for it.
- Without this value, `/api/quota/management-groups` depends entirely on the web app identity being able to enumerate management groups through `Microsoft.Management/managementGroups`.

Management-group RBAC note:

- Prefer `*_management_group_names` for larger estates so the web app and worker inherit access across descendant subscriptions without maintaining long subscription lists.
- Keep the `*_subscription_ids` variables only as the fallback for smaller customers or tightly curated subscription scopes.
- When `web_reader_management_group_names` is populated, Terraform also sets the `INGEST_MANAGEMENT_GROUP_NAMES` app setting on the dashboard web app so runtime ingestion expands those management groups into descendant subscriptions.

## Outputs

| Output | Description |
|---|---|
| `web_app_name` | Web App resource name |
| `web_app_url` | Web App HTTPS URL |
| `managed_identity_principal_id` | Web App managed identity principal ID |
| `function_app_name` | Function App resource name |
| `function_app_url` | Function App HTTPS URL |
| `function_managed_identity_principal_id` | Function App managed identity principal ID |
| `sql_server_fqdn` | SQL Server FQDN |
| `sql_server_name` | SQL Server resource name |
| `sql_database_name` | SQL Database name |
| `key_vault_name` | Key Vault resource name |
| `virtual_network_name` | VNet resource name |
| `sql_private_endpoint_name` | SQL private endpoint name |
| `key_vault_private_endpoint_name` | Key Vault private endpoint name |

## Naming convention

With `environment = "dev"` and `workload_suffix = "demo001"`:

| Resource | Name |
|---|---|
| Resource Group | `rg-capacity-dashboard-dev` |
| Web App | `<web-app-name>` |
| Function App | `<function-app-name>` |
| SQL Server | `<sql-server-name>` |
| Key Vault | `<key-vault-name>` |
| VNet | `<vnet-name>` |
| Storage Account | `stcapdev<random8>` |

## Provider configuration

- **azurerm ~> 3.0** with `storage_use_azuread = true` (identity-based storage access)
- `key_vault.purge_soft_delete_on_destroy = false` (Key Vault names remain reserved after destroy)
- `resource_group.prevent_deletion_if_contains_resources = false` (allows clean destroy even when App Insights creates hidden resources)

## Security design

- No secrets, subscription IDs, or tenant IDs stored in source control
- Sensitive variables marked with `sensitive = true` in Terraform
- SQL Server uses Entra-only authentication (no SQL auth)
- SQL and Key Vault default to private network access via private endpoints
- Web App and Function App use system-assigned managed identities
- Function App storage uses identity-based access (`shared_access_key_enabled = false`)
- VNet integration routes all traffic through the virtual network (`vnet_route_all_enabled = true`)
- TLS 1.2 minimum enforced on all services
- FTPS disabled on both App Service and Function App

## Backend

Local backend — state is stored in `infra/terraform.tfstate`. To use a remote backend, update `backend.tf` and run `terraform init -migrate-state`.

## Known operational notes

- Key Vault names are globally reserved after soft-delete. Changing `workload_suffix` avoids name conflicts with previously destroyed vaults.
