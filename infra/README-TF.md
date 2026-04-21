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
| Cross-subscription RBAC (modules) | `worker-subscription-rbac`, `web-subscription-reader`, `web-subscription-quota-writer` |

## File layout

```
infra/
├── backend.tf                  # Local backend configuration
├── providers.tf                # azurerm (~> 3.0) + random (~> 3.0) provider config
├── variables.tf                # All input variables (all have defaults)
├── main.tf                     # All resources and module calls
├── outputs.tf                  # 13 output values (all with descriptions)
├── terraform.tfvars.example    # Example variable overrides
├── README-TF.md                # This file
└── modules/
    ├── worker-subscription-rbac/       # Compute Recommendations, Cost Mgmt Reader, Billing Reader
    ├── web-subscription-reader/        # Subscription-level Reader for web app
    └── web-subscription-quota-writer/  # GroupQuota Request Operator for web app
```

## Prerequisites

- Terraform >= 1.6.0
- Azure CLI authenticated (`az login`) with **Contributor** + **User Access Administrator** on the target subscription
- State is stored locally in `terraform.tfstate` (update `backend.tf` to use a remote backend if needed)

## Quick start

All variables have sensible defaults, so a minimal deploy requires no tfvars file:

```powershell
cd infra
terraform init
terraform apply
```

To customize, copy and edit the example tfvars:

```powershell
Copy-Item terraform.tfvars.example terraform.tfvars
```

```hcl
# terraform.tfvars
location                  = "centralus"
environment               = "dev"
workload_suffix           = "cap002"
resource_group_name       = "CapacityDashboard-Dev"
sql_entra_admin_login     = "user@contoso.com"
sql_entra_admin_object_id = "00000000-0000-0000-0000-000000000000"
ingest_api_key            = "your-ingest-key"
session_secret            = "your-session-secret"
```

Then apply:

```powershell
terraform apply -var-file="terraform.tfvars"
```

## Variables

All variables have defaults and can be overridden via tfvars or CLI flags.

| Variable | Default | Description |
|---|---|---|
| `location` | `centralus` | Azure region for all resources |
| `environment` | `dev` | Environment token (`dev`, `test`, `prod`) |
| `workload_suffix` | `cap002` | Unique suffix (3-12 chars) for resource naming |
| `resource_group_name` | `CapacityDashboard-Dev` | Resource group name (created by Terraform) |
| `sql_entra_admin_login` | *(set in defaults)* | Entra admin UPN for SQL Server |
| `sql_entra_admin_object_id` | *(set in defaults)* | Entra admin object ID for SQL Server |
| `ingest_api_key` | `change-me-ingest-key` | Shared secret for ingestion routes (sensitive) |
| `session_secret` | `change-me-session-secret` | Session middleware secret (sensitive) |
| `vnet_address_prefix` | `10.90.0.0/16` | VNet address space |
| `app_service_integration_subnet_prefix` | `10.90.1.0/24` | App Service integration subnet |
| `private_endpoint_subnet_prefix` | `10.90.2.0/24` | Private endpoint subnet |
| `sql_public_network_access` | `Disabled` | SQL Server public access |
| `key_vault_public_network_access` | `Disabled` | Key Vault public access |
| `worker_shared_secret` | `""` | Shared secret between web app and worker (sensitive) |
| `quota_management_group_id` | `""` | Management group ID for quota discovery |
| `auth_enabled` | `false` | Enable Entra sign-in |
| `entra_tenant_id` | `""` | Entra tenant ID |
| `entra_client_id` | `""` | Entra app client ID |
| `entra_client_secret` | `""` | Entra app client secret (sensitive) |
| `auth_redirect_uri` | `""` | Auth callback URI (auto-generated if empty) |
| `admin_group_id` | `""` | Entra group for admin access |
| `web_reader_subscription_ids` | `[]` | Subscriptions for web app Reader role |
| `web_quota_writer_subscription_ids` | `[]` | Subscriptions for GroupQuota Request Operator |
| `worker_subscription_rbac_subscription_ids` | `[]` | Subscriptions for worker RBAC roles |
| `assign_worker_compute_recommendations_role` | `true` | Toggle Compute Recommendations Role |
| `assign_worker_cost_management_reader_role` | `true` | Toggle Cost Management Reader |
| `assign_worker_billing_reader_role` | `true` | Toggle Billing Reader |
| `admin_ssh_public_key` | `""` | Unused – declared for backward compatibility |

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

With `environment = "dev"` and `workload_suffix = "cap002"`:

| Resource | Name |
|---|---|
| Resource Group | `CapacityDashboard-Dev` |
| Web App | `app-capdash-dev-cap002` |
| Function App | `func-capdash-dev-cap002-appsvc` |
| SQL Server | `sql-capdash-dev-cap002` |
| Key Vault | `kv-capdash-dev-cap002` |
| VNet | `vnet-capdash-dev-cap002` |
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
