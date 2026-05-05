using './main.bicep'

param location = 'centralus'
param environment = 'dev'
param workloadSuffix = 'sample01'

// Supply at deployment time for Azure SQL Entra admin configuration.
param sqlEntraAdminLogin = 'user@contoso.com'
param sqlEntraAdminObjectId = '00000000-0000-0000-0000-000000000000'
param ingestApiKey = 'replace-with-secure-ingest-key'
param sessionSecret = 'replace-with-session-secret'

// Optional: set when quota discovery should target a known management group without tenant-wide enumeration.
// param quotaManagementGroupId = 'Demo-MG'

// Preferred for larger estates: scope dashboard read/query access by one or more management groups.
// The web app will derive INGEST_MANAGEMENT_GROUP_NAMES from these values so capacity ingestion
// targets descendant subscriptions without hand-maintaining long subscription lists.
// Example:
// param webReaderManagementGroupNames = [
//   'Platform'
//   'Corp-Online'
// ]

// Fallback for smaller customers without management groups.
// Example:
// param webReaderSubscriptionIds = [
//   '00000000-0000-0000-0000-000000000000'
// ]

// Private networking defaults for SQL connectivity from App Service.
param vnetAddressPrefix = '10.90.0.0/16'
param appServiceIntegrationSubnetPrefix = '10.90.1.0/24'
param privateEndpointSubnetPrefix = '10.90.2.0/24'
param sqlPublicNetworkAccess = 'Disabled'
param keyVaultPublicNetworkAccess = 'Disabled'

// Existing customer-managed network mode for separate-tenant/customer handoff testing.
// Supply all four names together. When set, Bicep skips VNet/subnet creation.
// param existingVirtualNetworkName = 'vnet-shared-platform'
// param existingVirtualNetworkResourceGroupName = 'rg-network-shared'
// param existingAppServiceIntegrationSubnetName = 'snet-capdash-appsvc'
// param existingPrivateEndpointSubnetName = 'snet-capdash-private-endpoints'
