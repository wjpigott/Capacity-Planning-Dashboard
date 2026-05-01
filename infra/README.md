# Capacity Dashboard – Infrastructure

This directory contains two equivalent infrastructure-as-code implementations that provision the full Azure baseline for the Capacity Dashboard.

## Choose your path

| Path | Tool | When to use |
|---|---|---|
| [`bicep/`](bicep/) | Azure Bicep | Azure-native deployments; integrated with `scripts/deploy-infra.ps1` for end-to-end provisioning + web app publish + SQL bootstrap |
| [`terraform/`](terraform/) | Terraform | Multi-tenant, multi-cloud, or state-managed workflows; standalone `terraform apply` with local or remote backend, including the same management-group-first RBAC path used by Bicep |

Both implementations provision the same set of resources by default:

- App Service Plan + Web App (P1v3)
- Dedicated App Service Plan + Function App + Storage Account (PowerShell 7.4 worker)
- System-assigned Managed Identity on Web App and Function App
- Azure SQL Server (Entra-only auth) + SQL Database (S0)
- Virtual Network + App Service integration subnet + private endpoint subnet
- SQL Private Endpoint + Private DNS zone
- Key Vault (RBAC authorization) + Private Endpoint + Private DNS zone
- Application Insights + Log Analytics
- Role Assignments (Key Vault Secrets User, Storage Blob/Queue/Table)
- Cross-scope RBAC modules (worker RBAC, web Reader, web GroupQuota Request Operator at management-group or subscription scope)

Both implementations can also reuse existing shared platform dependencies instead of creating new ones for:

- Azure SQL Server and optionally the Azure SQL Database
- Azure Key Vault
- Worker host Storage Account

## Design principles

- No subscription IDs, tenant IDs, resource group names, or secrets are stored in this repo.
- Web App uses managed identity and receives Key Vault Secrets User role on the deployed vault.
- Web App can optionally receive management-group-scoped `Reader` assignments during infra deployment through `webReaderManagementGroupNames`, with subscription-level `webReaderSubscriptionIds` kept as the fallback for small customers.
- The same Web App `Reader` access is sufficient for the Phase 2A provider-discovered AI model catalog; no extra RBAC or Bicep resources are required for xAI/Meta/Mistral-style catalog reads.
- Web App can optionally receive management-group-scoped `GroupQuota Request Operator` assignments during infra deployment through `webQuotaWriterManagementGroupNames`, with subscription-level `webQuotaWriterSubscriptionIds` kept as the fallback for small customers.
- Function App uses managed identity and receives Key Vault Secrets User role on the deployed vault.
- Function App host storage should use identity-based `AzureWebJobsStorage` settings with storage data-plane RBAC instead of shared-key auth.
- Worker Function App runs on its own dedicated App Service plan instead of Flex Consumption.
- Web App and Function App set `WEBSITE_DNS_SERVER=168.63.129.16` and `WEBSITE_VNET_ROUTE_ALL=1` for private endpoint name resolution and routing.
- SQL defaults to private-access mode (`sqlPublicNetworkAccess = 'Disabled'`) and is reachable from App Service/Function App via VNet integration and private endpoint.
- Key Vault defaults to private-access mode (`keyVaultPublicNetworkAccess = 'Disabled'`) and is reachable from App Service/Function App via VNet integration and private endpoint.
- Customer-managed shared services can now be attached instead of created by passing the existing-resource parameters through `scripts/deploy-infra.ps1` or the raw Bicep/Terraform inputs.
- When an existing SQL server or Key Vault is reused, the dashboard templates stop creating a new private endpoint and DNS zone for that dependency and assume the customer-managed private connectivity path already exists.
- Live placement and pricing RBAC can now be assigned automatically during infra deployment by passing `workerRbacManagementGroupNames` for larger estates, with `workerSubscriptionRbacSubscriptionIds` kept as the fallback for customers without management groups.
- Dashboard subscription discovery RBAC can now be assigned automatically during infra deployment by passing `webReaderManagementGroupNames` for larger estates, with `webReaderSubscriptionIds` kept as the fallback for customers without management groups.
- Dashboard quota-apply RBAC can now be assigned automatically during infra deployment by passing `webQuotaWriterManagementGroupNames` for larger estates, with `webQuotaWriterSubscriptionIds` kept as the fallback for customers without management groups.
- Dashboard Entra sign-in can now be configured during infra deployment through app settings (`authEnabled`, `entraTenantId`, `entraClientId`, `entraClientSecret`, `adminGroupId`, and optional `authRedirectUri`).
- Split read/write identities in later phases (recommended) for least privilege.

---

## Option A – Bicep (recommended for Azure-only)

### Prerequisites

- Azure CLI (`az login`)
- Contributor + User Access Administrator on the target subscription

### Script-based deploy (recommended)

The deploy script handles infra provisioning, web app publish, and SQL bootstrap in one run:

```powershell
./scripts/deploy-infra.ps1 `
  -ResourceGroupName "<resource-group-name>" `
  -Environment test `
  -WorkloadSuffix "demo001" `
  -ParameterFile "./infra/bicep/test.bicepparam" `
  -SqlEntraAdminLogin "<entra-upn>" `
  -SqlEntraAdminObjectId "<entra-object-id>" `
  -SubscriptionId "<subscription-id>"
```

### Reuse existing shared services

Use these deploy-script switches when the customer already has shared Azure dependencies in place:

- `-ExistingSqlServerName "<sql-server-name>"`
- `-ExistingSqlDatabaseName "<sql-database-name>"`
- `-ExistingKeyVaultName "<key-vault-name>"`
- `-ExistingWorkerStorageAccountName "<storage-account-name>"`

Providing an existing resource name is enough to switch that dependency into reuse mode. `-ExistingSqlDatabaseName` is optional and only applies when you also pass `-ExistingSqlServerName`.

Example:

```powershell
./scripts/deploy-infra.ps1 `
  -ResourceGroupName "<resource-group-name>" `
  -Environment test `
  -WorkloadSuffix "demo001" `
  -SqlEntraAdminLogin "<entra-upn>" `
  -SqlEntraAdminObjectId "<entra-object-id>" `
  -ExistingSqlServerName "sql-shared-test" `
  -ExistingSqlDatabaseName "sqldb-shared-capdash" `
  -ExistingKeyVaultName "kv-shared-test" `
  -ExistingWorkerStorageAccountName "stsharedworker01"
```

### Raw Bicep deploy (infra only)

```powershell
az deployment group create `
  --resource-group <resource-group-name> `
  --template-file ./infra/bicep/main.bicep `
  --parameters ./infra/bicep/test.bicepparam `
  --parameters sqlEntraAdminLogin="<entra-upn>" sqlEntraAdminObjectId="<entra-object-id>"
```

See [`bicep/README.md`](bicep/README.md) for full parameter reference, RBAC at scale guidance, networking options, and environment strategy.

---

## Option B – Terraform

### Prerequisites

- Terraform >= 1.5.0 and < 1.6.0
- Azure CLI authenticated (`az login`) with Contributor + User Access Administrator
- State is local by default; update `backend.tf` to use a remote backend if needed

### Quick start

```powershell
cd infra/terraform
terraform init
terraform apply
```

### Custom variables

```powershell
Copy-Item infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
# Edit terraform.tfvars, then:
cd infra/terraform
terraform apply -var-file="terraform.tfvars"
```

See [`terraform/README.md`](terraform/README.md) for the full variable table, file layout, and module details.

---

## Post-deploy steps (both paths)

1. Deploy the web app package if not using the Bicep script path (`deploy-web-app.ps1`).
2. Deploy the worker function app zip package (`scripts/deploy-worker.ps1`).
3. Apply SQL schema and migrations (`scripts/apply-schema.ps1` or the web app bootstrap endpoint).
4. Configure Entra app registration and consent (external to both templates).
