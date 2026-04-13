# Capacity Dashboard Azure Infrastructure (MVP)

This template provisions a native Azure baseline for the dashboard solution.

## Resources

- App Service Plan + Web App
- Dedicated App Service Plan + Function App + Storage Account for PowerShell 7 worker execution
- System-assigned Managed Identity on Web App
- System-assigned Managed Identity on Function App
- Azure SQL Server + SQL Database
- Azure Key Vault (RBAC authorization)
- Application Insights + Log Analytics

## Security design

- No subscription IDs, tenant IDs, resource group names, or secrets are stored in this repo.
- SQL admin password is a secure deployment parameter.
- Web App uses managed identity and receives Key Vault Secrets User role on the deployed vault.
- Function App uses managed identity and receives Key Vault Secrets User role on the deployed vault.
- Function App host storage should use identity-based `AzureWebJobsStorage` settings with storage data-plane RBAC instead of shared-key auth.
- Worker Function App runs on its own dedicated App Service plan instead of Flex Consumption.
- Live placement requires additional Azure RBAC on the Function App managed identity: assign `Compute Recommendations Role`, or a custom role containing `Microsoft.Compute/locations/placementScores/generate/action`, at each target subscription or at an enclosing management group.
- Split read/write identities in later phases (recommended) for least privilege.

## Deploy

```powershell
az deployment group create \
  --resource-group <resource-group-name> \
  --template-file infra/dashboard/main.bicep \
  --parameters infra/dashboard/main.bicepparam \
  --parameters sqlAdminPassword="<secure-password>"
```

## Next steps

1. Lock down SQL networking and Key Vault networking for production.
2. Add private endpoints and VNet integration.
3. Add backend API service (Container Apps or App Service) and connect dashboard UI.
4. Finish worker deployment and route live placement + quota apply flows through the Function App.
5. Add data ingestion workers and queue-based orchestration.
6. Replace SQL admin auth with Entra ID-based auth where possible.
