# Capacity Dashboard Azure Infrastructure (MVP)

This template provisions a native Azure baseline for the dashboard solution.

## Resources

- App Service Plan + Web App
- Dedicated App Service Plan + Function App + Storage Account for PowerShell 7 worker execution
- System-assigned Managed Identity on Web App
- System-assigned Managed Identity on Function App
- Azure SQL Server + SQL Database
- Virtual Network + App Service integration subnet + private endpoint subnet
- SQL Private Endpoint + Private DNS zone link (`privatelink.database.windows.net`)
- Key Vault Private Endpoint + Private DNS zone link (`privatelink.vaultcore.azure.net`)
- Azure Key Vault (RBAC authorization)
- Application Insights + Log Analytics

## Security design

- No subscription IDs, tenant IDs, resource group names, or secrets are stored in this repo.
- SQL admin password is a secure deployment parameter.
- Web App uses managed identity and receives Key Vault Secrets User role on the deployed vault.
- Function App uses managed identity and receives Key Vault Secrets User role on the deployed vault.
- Function App host storage should use identity-based `AzureWebJobsStorage` settings with storage data-plane RBAC instead of shared-key auth.
- Worker Function App runs on its own dedicated App Service plan instead of Flex Consumption.
- Web App and Function App set `WEBSITE_DNS_SERVER=168.63.129.16` and `WEBSITE_VNET_ROUTE_ALL=1` for private endpoint name resolution and routing.
- SQL defaults to private-access mode (`sqlPublicNetworkAccess = 'Disabled'`) and is reachable from App Service/Function App via VNet integration and private endpoint.
- Key Vault defaults to private-access mode (`keyVaultPublicNetworkAccess = 'Disabled'`) and is reachable from App Service/Function App via VNet integration and private endpoint.
- Live placement requires additional Azure RBAC on the Function App managed identity: assign `Compute Recommendations Role`, or a custom role containing `Microsoft.Compute/locations/placementScores/generate/action`, at each target subscription or at an enclosing management group.
- Split read/write identities in later phases (recommended) for least privilege.

## Networking parameters

- `vnetAddressPrefix` (default `10.90.0.0/16`)
- `appServiceIntegrationSubnetPrefix` (default `10.90.1.0/24`)
- `privateEndpointSubnetPrefix` (default `10.90.2.0/24`)
- `sqlPublicNetworkAccess` (`Disabled` by default; set `Enabled` only for temporary break-glass access)
- `keyVaultPublicNetworkAccess` (`Disabled` by default; set `Enabled` only for temporary break-glass access)

## Deploy

```powershell
az deployment group create \
  --resource-group <resource-group-name> \
  --template-file infra/dashboard/main.bicep \
  --parameters infra/dashboard/main.bicepparam \
  --parameters sqlAdminPassword="<secure-password>"
```

## Next steps

1. Add backend API service (Container Apps or App Service) and connect dashboard UI.
2. Finish worker deployment and route live placement + quota apply flows through the Function App.
3. Add data ingestion workers and queue-based orchestration.
4. Replace SQL admin auth with Entra ID-based auth where possible.
