# Capacity Dashboard Azure Infrastructure (MVP)

This template provisions a native Azure baseline for the dashboard solution and can optionally reuse customer-managed shared dependencies.

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

Existing shared-service reuse is supported for:

- Azure SQL Server and optionally the Azure SQL Database
- Azure Key Vault
- Worker host Storage Account

## Security design

- No subscription IDs, tenant IDs, resource group names, or secrets are stored in this repo.
- Web App uses managed identity and receives Key Vault Secrets User role on the deployed vault.
- Web App can optionally receive subscription-level `Reader` assignments during infra deployment to support cross-subscription discovery.
- Web App can optionally receive subscription-level `GroupQuota Request Operator` assignments during infra deployment by passing `webQuotaWriterSubscriptionIds` for quota apply writes.
- Function App uses managed identity and receives Key Vault Secrets User role on the deployed vault.
- Function App host storage should use identity-based `AzureWebJobsStorage` settings with storage data-plane RBAC instead of shared-key auth.
- Worker Function App runs on its own dedicated App Service plan instead of Flex Consumption.
- Web App and Function App set `WEBSITE_DNS_SERVER=168.63.129.16` and `WEBSITE_VNET_ROUTE_ALL=1` for private endpoint name resolution and routing.
- SQL defaults to private-access mode (`sqlPublicNetworkAccess = 'Disabled'`) and is reachable from App Service/Function App via VNet integration and private endpoint.
- Key Vault defaults to private-access mode (`keyVaultPublicNetworkAccess = 'Disabled'`) and is reachable from App Service/Function App via VNet integration and private endpoint.
- Existing SQL, Key Vault, and worker storage can now be reused by passing the matching `existing*Name` parameters.
- When `existingSqlServerName` or `existingKeyVaultName` is set, the template assumes customer-managed private connectivity already exists for that dependency and does not create a new private endpoint or private DNS zone for it.
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

## Existing resource parameters

- `existingSqlServerName`
- `existingSqlDatabaseName` (optional; requires `existingSqlServerName`)
- `existingKeyVaultName`
- `existingWorkerStorageAccountName`

Optional resource-group overrides are also available for reuse scenarios:

- `existingSqlServerResourceGroupName`
- `existingKeyVaultResourceGroupName`
- `existingWorkerStorageAccountResourceGroupName`

## Environment strategy

- Keep `dev` as the mutable build-and-verify environment.
- Stand up `test` as the stable demo environment in the same subscription using the same naming pattern with the environment token changed to `test`.
- Treat the React app as the primary UI for future production rollout. The classic root UI can remain for compatibility in dev/test, but it should not drive the production deployment shape.
- Current naming example with `workloadSuffix = demo001`:
- Web App: `<web-app-name>`
- Function App: `<function-app-name>`
- SQL Server: `<sql-server-name>`
- Key Vault: `<key-vault-name>`

## Deploy

```powershell
./scripts/deploy-infra.ps1 \
  -ResourceGroupName "<resource-group-name>" \
  -Environment test \
  -WorkloadSuffix "demo001" \
  -ParameterFile "./infra/bicep/test.bicepparam" \
  -QuotaManagementGroupId "<management-group-id>" \
  -WebReaderManagementGroupNames @("<management-group-name-1>","<management-group-name-2>") \
  -WebQuotaWriterManagementGroupNames @("<management-group-name-1>","<management-group-name-2>") \
  -WorkerRbacManagementGroupNames @("<management-group-name-1>","<management-group-name-2>") \
  -AuthEnabled $true \
  -EntraTenantId "<tenant-id>" \
  -EntraClientId "<app-registration-client-id>" \
  -EntraClientSecret "<app-registration-client-secret>" \
  -AdminGroupId "<entra-group-object-id>" \
  -SqlEntraAdminLogin "<entra-upn>" \
  -SqlEntraAdminObjectId "<entra-object-id>" \
  -SubscriptionId "<subscription-id>"
```

The script-based path is the recommended operator workflow because it now:

- deploys the infrastructure from Bicep
- deploys the dashboard web package, including `react/`, to the matching App Service name
- deploys the worker Function App package to the matching Function App name

Customer deployment note:

- Treat database initialization as a separate explicit post-deploy step for customer environments, even when you use `deploy-infra.ps1`.
- This is the same recommendation for both Bicep and Terraform deployments.
- `deploy-infra.ps1` does not automatically switch to local `sqlcmd` execution just because the operator machine has SQL connectivity. Its built-in path still calls the deployed web app bootstrap endpoints unless you disable that step.
- When the customer runbook requires a separate DBA or network-approved initialization step, pass `-ApplyDatabaseBootstrap $false` during infra/app deployment and then run `scripts/initialize-database.ps1` explicitly afterward.
- If Azure SQL stays private-only, run `scripts/initialize-database.ps1` from an approved network path such as an ExpressRoute-connected admin workstation, a self-hosted deployment runner, or an Azure VM that can reach the SQL endpoint.
- Do not assume a random operator laptop or hosted CI runner can reach the SQL endpoint just because the customer has ExpressRoute.
- Keep the web app managed identity at runtime roles such as `db_datareader` and `db_datawriter` after initialization rather than relying on permanent DDL rights in the app.

Use `-DeployWebApp $false` only when you intentionally want an infra-only run.

Quota management-group note:

- Set `-QuotaManagementGroupId` when you expect the Admin quota experience to default to a known management group, or when tenant-wide management-group enumeration is restricted and the UI needs a fallback management group to return.
- Without this setting, `/api/quota/management-groups` depends entirely on the web app identity being able to enumerate management groups through `Microsoft.Management/managementGroups`.

Manual SQL tooling note:

- `sqlcmd` is still a prerequisite for the standalone schema/migration/sample-data scripts under `scripts/`.
- For customer or private SQL environments, prefer an explicit database initialization step from a known-good network path over relying on the web app to retain schema-creation rights.
- If the customer uses ExpressRoute, that helps only when the machine or self-hosted runner executing `scripts/initialize-database.ps1` is actually on that ExpressRoute-connected path and Azure SQL allows that path.
- If the customer DBA team owns a pre-created Entra-only SQL server, use `scripts/initialize-database.ps1` from an Azure-connected host with Entra SQL admin rights, or hand that script to the DBA team as the post-deploy runbook step.

Raw Bicep deployment is also supported:

```powershell
az deployment group create \
  --resource-group <resource-group-name> \
  --template-file ./infra/bicep/main.bicep \
  --parameters ./infra/bicep/test.bicepparam \
  --parameters sqlEntraAdminLogin="<entra-upn>" sqlEntraAdminObjectId="<entra-object-id>"
```

Example reusing existing shared services:

```powershell
az deployment group create \
  --resource-group <resource-group-name> \
  --template-file ./infra/bicep/main.bicep \
  --parameters sqlEntraAdminLogin="<entra-upn>" sqlEntraAdminObjectId="<entra-object-id>" \
  --parameters existingSqlServerName="sql-shared-test" \
  --parameters existingSqlDatabaseName="sqldb-shared-capdash" \
  --parameters existingKeyVaultName="kv-shared-test" \
  --parameters existingWorkerStorageAccountName="stsharedworker01"
```

## RBAC At Scale

Use `webQuotaWriterManagementGroupNames` when the customer uses management groups and quota-write access should inherit from one or more named management groups.

Use `webReaderManagementGroupNames` and `workerRbacManagementGroupNames` as the preferred operator inputs for larger estates. They accept management group names, not full ARM IDs, and support multiple management groups in a CAF-style layout.

If the deploying operator already has access to the full set of non-root management groups, `scripts/deploy-infra.ps1 -UseAllAccessibleManagementGroups` can populate the three management-group arrays automatically. The helper intentionally skips the tenant root group; use the explicit arrays instead when you need a narrower or custom scope.

Keep `webReaderSubscriptionIds`, `webQuotaWriterSubscriptionIds`, and `workerSubscriptionRbacSubscriptionIds` for small customers that do not use management groups or that want a tightly curated subscription-scoped fallback.

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

- Raw template deployment still provisions infrastructure only. The script-based workflow now chains the dashboard web app publish and worker Function App zip deployment, but SQL schema migration and some post-deploy app settings remain separate runbook steps.
- There is no traffic-routing layer in Bicep yet. `dev` and `test` can coexist, but cutover is manual because Front Door, Traffic Manager, or deployment slots are not modeled.
- A React-only production packaging/deployment path is not modeled separately yet. The next production pass should decide whether the classic UI is omitted entirely or retained only as a compatibility fallback.
- SQL database data-plane grants (for example `db_datareader` and `db_datawriter`) are not ARM resources and still require post-deploy SQL role configuration. The repo now includes `scripts/initialize-database.ps1` for that step when SQL is customer-managed.
- If your organization requires billing-scope role assignments (instead of subscription scope), those billing-scope assignments remain external to this resource-group deployment.
- Entra app registration creation and tenant-side consent/group assignment remain external to the template. The template now wires the dashboard auth settings, but you still need a real Entra app registration and group/object IDs.
- The template has no outputs or automation for database schema application; `apply-schema.ps1` and later migrations still need to run after infra creation.
- Terraform parity is not defined yet. This Bicep path is the operational baseline, but module boundaries and shared variables should be stabilized before porting to Terraform across other tenants.

## Next steps

1. Deploy the `test` resource group with `infra/bicep/test.bicepparam`.
2. Run `deploy-infra.ps1` to deploy the web app and worker packages to the new `test` app names. If the database must be initialized separately, include `-ApplyDatabaseBootstrap $false` on `deploy-infra.ps1`.
3. Run `scripts/initialize-database.ps1` as the Azure SQL Entra admin from a network path that can reach the SQL endpoint, then verify the web app identity has only the intended runtime database roles.
4. Add a traffic-routing layer or slots if you want true blue-green cutover instead of separate stable environments.
