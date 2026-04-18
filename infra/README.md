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
- Web App can optionally receive subscription-level `Reader` assignments during infra deployment to support cross-subscription discovery.
- Web App can optionally receive subscription-level `GroupQuota Request Operator` assignments during infra deployment by passing `webQuotaWriterSubscriptionIds` for quota apply writes.
- Function App uses managed identity and receives Key Vault Secrets User role on the deployed vault.
- Function App host storage should use identity-based `AzureWebJobsStorage` settings with storage data-plane RBAC instead of shared-key auth.
- Worker Function App runs on its own dedicated App Service plan instead of Flex Consumption.
- Web App and Function App set `WEBSITE_DNS_SERVER=168.63.129.16` and `WEBSITE_VNET_ROUTE_ALL=1` for private endpoint name resolution and routing.
- SQL defaults to private-access mode (`sqlPublicNetworkAccess = 'Disabled'`) and is reachable from App Service/Function App via VNet integration and private endpoint.
- Key Vault defaults to private-access mode (`keyVaultPublicNetworkAccess = 'Disabled'`) and is reachable from App Service/Function App via VNet integration and private endpoint.
- Live placement and pricing RBAC can now be assigned automatically during infra deployment by passing `workerSubscriptionRbacSubscriptionIds` (and optional role toggles) to apply `Compute Recommendations Role`, `Cost Management Reader`, and `Billing Reader` on those subscriptions.
- Dashboard subscription discovery RBAC can now be assigned automatically during infra deployment by passing `webReaderSubscriptionIds` to apply `Reader` on those subscriptions.
- Dashboard quota-apply RBAC can now be assigned automatically during infra deployment by passing `webQuotaWriterSubscriptionIds` to apply `GroupQuota Request Operator` on those subscriptions.
- Dashboard Entra sign-in can now be configured during infra deployment through app settings (`authEnabled`, `entraTenantId`, `entraClientId`, `entraClientSecret`, `adminGroupId`, and optional `authRedirectUri`).
- Split read/write identities in later phases (recommended) for least privilege.

## Networking parameters

- `vnetAddressPrefix` (default `10.90.0.0/16`)
- `appServiceIntegrationSubnetPrefix` (default `10.90.1.0/24`)
- `privateEndpointSubnetPrefix` (default `10.90.2.0/24`)
- `sqlPublicNetworkAccess` (`Disabled` by default; set `Enabled` only for temporary break-glass access)
- `keyVaultPublicNetworkAccess` (`Disabled` by default; set `Enabled` only for temporary break-glass access)

## Environment strategy

- Keep `dev` as the mutable build-and-verify environment.
- Stand up `test` as the stable demo environment in the same subscription using the same naming pattern with the environment token changed to `test`.
- Current naming example with `workloadSuffix = cap001`:
  - Web App: `app-capdash-test-cap001`
  - Function App: `func-capdash-test-cap001-appsvc`
  - SQL Server: `sql-capdash-test-cap001`
  - Key Vault: `kv-capdash-test-cap001`

## Deploy

```powershell
./scripts/deploy-infra.ps1 \
  -ResourceGroupName "CapacityDashboard-Test" \
  -Environment test \
  -WorkloadSuffix "cap001" \
  -ParameterFile "./infra/test.bicepparam" \
  -WebReaderSubscriptionIds @("<subscription-id-1>","<subscription-id-2>") \
  -WebQuotaWriterSubscriptionIds @("<subscription-id-1>","<subscription-id-2>") \
  -WorkerRbacSubscriptionIds @("<subscription-id-1>","<subscription-id-2>") \
  -AuthEnabled $true \
  -EntraTenantId "<tenant-id>" \
  -EntraClientId "<app-registration-client-id>" \
  -EntraClientSecret "<app-registration-client-secret>" \
  -AdminGroupId "<entra-group-object-id>" \
  -SqlEntraAdminLogin "<entra-upn>" \
  -SqlEntraAdminObjectId "<entra-object-id>" \
  -SubscriptionId "<subscription-id>"
```

Raw Bicep deployment is also supported:

```powershell
az deployment group create \
  --resource-group <resource-group-name> \
  --template-file ./infra/main.bicep \
  --parameters ./infra/test.bicepparam \
  --parameters sqlAdminPassword="<secure-password>" sqlEntraAdminLogin="<entra-upn>" sqlEntraAdminObjectId="<entra-object-id>"
```

## RBAC At Scale

Use `webQuotaWriterSubscriptionIds` in Bicep when you have a small, curated list of participating subscriptions.

For customers with hundreds or thousands of subscriptions, do not maintain a large subscription array in the resource-group deployment. Use `scripts/grant-quota-rbac.ps1` to assign `GroupQuota Request Operator` from a management-group-derived subscription list or from a maintained subscription inventory file.

Recommended pattern for large estates:

1. Assign `GroupQuota Request Operator` at the quota management group.
2. Enumerate the participating subscriptions from the customer management group or an approved subscription inventory export.
3. Apply `GroupQuota Request Operator` at each participating subscription scope.
4. Rerun the bulk assignment script as subscriptions enter or leave the quota-move scope.

Example:

```powershell
./scripts/grant-quota-rbac.ps1 \
  -PrincipalObjectId "<web-app-managed-identity-principal-id>" \
  -ManagementGroupId "Demo-MG" \
  -AssignManagementGroupRole
```

## Current gaps for blue-green style Bicep deployments

- The template provisions infrastructure only. App package deployment, Function zip deployment, SQL schema migration, and post-deploy app settings are still separate runbook steps.
- There is no traffic-routing layer in Bicep yet. `dev` and `test` can coexist, but cutover is manual because Front Door, Traffic Manager, or deployment slots are not modeled.
- SQL database data-plane grants (for example `db_datareader` and `db_datawriter`) are not ARM resources and still require post-deploy SQL role configuration.
- If your organization requires billing-scope role assignments (instead of subscription scope), those billing-scope assignments remain external to this resource-group deployment.
- Entra app registration creation and tenant-side consent/group assignment remain external to the template. The template now wires the dashboard auth settings, but you still need a real Entra app registration and group/object IDs.
- The template has no outputs or automation for database schema application; `apply-schema.ps1` and later migrations still need to run after infra creation.
- Terraform parity is not defined yet. This Bicep path is the operational baseline, but module boundaries and shared variables should be stabilized before porting to Terraform across other tenants.

## Next steps

1. Deploy the `test` resource group with `infra/test.bicepparam`.
2. Deploy the web app and worker packages to the new `test` app names.
3. Apply schema and migrations to `sqldb-capdash-test`.
4. Add a traffic-routing layer or slots if you want true blue-green cutover instead of separate stable environments.
