using './main.bicep'

param location = 'centralus'
param environment = 'test'
param workloadSuffix = 'cap001'

// Supply at deployment time via secure pipeline/secret variable if you need to override bootstrap defaults.
param sqlAdminLogin = 'sqllocaladmin'
param sqlAdminPassword = 'ReplaceWithSecureSecretAtDeployTime!'

// Supply at deployment time for Azure SQL Entra admin configuration.
param sqlEntraAdminLogin = 'user@contoso.com'
param sqlEntraAdminObjectId = '00000000-0000-0000-0000-000000000000'

// Use a distinct address space from dev so future peering or shared-network scenarios do not collide.
param vnetAddressPrefix = '10.91.0.0/16'
param appServiceIntegrationSubnetPrefix = '10.91.1.0/24'
param privateEndpointSubnetPrefix = '10.91.2.0/24'
param sqlPublicNetworkAccess = 'Disabled'
param keyVaultPublicNetworkAccess = 'Disabled'

// Optional: enable worker subscription RBAC in one deployment by listing target subscription IDs.
// Example:
// param webReaderSubscriptionIds = [
//   '00000000-0000-0000-0000-000000000000'
// ]
// param workerSubscriptionRbacSubscriptionIds = [
//   '00000000-0000-0000-0000-000000000000'
// ]
// param assignWorkerComputeRecommendationsRole = true
// param assignWorkerCostManagementReaderRole = true
// param assignWorkerBillingReaderRole = true

// Optional: enable dashboard Entra sign-in by supplying your app registration values.
// Example:
// param authEnabled = true
// param entraTenantId = '00000000-0000-0000-0000-000000000000'
// param entraClientId = '00000000-0000-0000-0000-000000000000'
// param entraClientSecret = 'replace-with-secret-at-deploy-time'
// param adminGroupId = '00000000-0000-0000-0000-000000000000'
// param authRedirectUri = 'https://app-capdash-test-cap001.azurewebsites.net/auth/callback'
