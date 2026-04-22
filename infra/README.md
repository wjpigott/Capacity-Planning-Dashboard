# Capacity Dashboard – Infrastructure

This directory contains two equivalent infrastructure-as-code implementations that provision the full Azure baseline for the Capacity Dashboard.

## Choose your path

| Path | Tool | When to use |
|---|---|---|
| [`bicep/`](bicep/) | Azure Bicep | Azure-native deployments; integrated with `scripts/deploy-infra.ps1` for end-to-end provisioning + web app publish + SQL bootstrap |
| [`terraform/`](terraform/) | Terraform | Multi-tenant, multi-cloud, or state-managed workflows; standalone `terraform apply` with local or remote backend |

Both implementations provision the same set of resources:

- App Service Plan + Web App (P1v3)
- Dedicated App Service Plan + Function App + Storage Account (PowerShell 7.4 worker)
- System-assigned Managed Identity on Web App and Function App
- Azure SQL Server (Entra-only auth) + SQL Database (S0)
- Virtual Network + App Service integration subnet + private endpoint subnet
- SQL Private Endpoint + Private DNS zone
- Key Vault (RBAC authorization) + Private Endpoint + Private DNS zone
- Application Insights + Log Analytics
- Role Assignments (Key Vault Secrets User, Storage Blob/Queue/Table)
- Cross-subscription RBAC modules (worker RBAC, web Reader, web GroupQuota Request Operator)

---

## Option A – Bicep (recommended for Azure-only)

### Prerequisites

- Azure CLI (`az login`)
- Contributor + User Access Administrator on the target subscription

### Script-based deploy (recommended)

The deploy script handles infra provisioning, web app publish, and SQL bootstrap in one run:

```powershell
./scripts/deploy-infra.ps1 `
  -ResourceGroupName "CapacityDashboard-Test" `
  -Environment test `
  -WorkloadSuffix "cap001" `
  -ParameterFile "./infra/bicep/test.bicepparam" `
  -SqlEntraAdminLogin "<entra-upn>" `
  -SqlEntraAdminObjectId "<entra-object-id>" `
  -SubscriptionId "<subscription-id>"
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

- Terraform >= 1.6.0
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
