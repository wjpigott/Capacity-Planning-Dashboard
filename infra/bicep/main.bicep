targetScope = 'resourceGroup'

@description('Location for all resources')
param location string = resourceGroup().location

@description('Environment short name (dev, test, prod)')
@allowed([
  'dev'
  'test'
  'prod'
])
param environment string = 'dev'

@description('Unique workload suffix (lowercase, 3-12 chars)')
@minLength(3)
@maxLength(12)
param workloadSuffix string

@description('Microsoft Entra administrator UPN for Azure SQL')
param sqlEntraAdminLogin string

@description('Microsoft Entra administrator object ID for Azure SQL')
param sqlEntraAdminObjectId string

@description('Address prefix for the virtual network used by App Service integration and private endpoints')
param vnetAddressPrefix string = '10.90.0.0/16'

@description('Address prefix for the App Service integration subnet')
param appServiceIntegrationSubnetPrefix string = '10.90.1.0/24'

@description('Address prefix for the private endpoint subnet')
param privateEndpointSubnetPrefix string = '10.90.2.0/24'

@description('SQL server public network access mode')
@allowed([
  'Enabled'
  'Disabled'
])
param sqlPublicNetworkAccess string = 'Disabled'

@description('Key Vault public network access mode')
@allowed([
  'Enabled'
  'Disabled'
])
param keyVaultPublicNetworkAccess string = 'Disabled'

@secure()
@description('Optional shared secret used between the dashboard web app and the worker function app')
param workerSharedSecret string = ''

@secure()
@description('Shared secret used to authorize internal bootstrap and ingestion routes on the dashboard web app')
param ingestApiKey string

@secure()
@description('Session secret used by the dashboard web app session middleware')
param sessionSecret string

@description('Optional subscription IDs where the dashboard web app managed identity should receive Reader access for subscription discovery and read-only ARM queries.')
param webReaderSubscriptionIds array = []

@description('Optional management group names where the dashboard web app managed identity should receive Reader access for subscription discovery and read-only ARM queries. Preferred for larger estates; keep subscription IDs for customers without management groups.')
param webReaderManagementGroupNames array = []

@description('Optional subscription IDs where the dashboard web app managed identity should receive GroupQuota Request Operator for quota apply writes. Include every subscription that can participate in quota moves.')
param webQuotaWriterSubscriptionIds array = []

@description('Optional management group names where the dashboard web app managed identity should receive GroupQuota Request Operator for quota apply writes. Preferred for larger estates; keep subscription IDs for customers without management groups.')
param webQuotaWriterManagementGroupNames array = []

@description('Optional management group ID used by the dashboard quota discovery UI when tenant-wide management group enumeration is not permitted.')
param quotaManagementGroupId string = ''

@description('Optional subscription IDs where the worker managed identity should receive subscription-level RBAC roles for live placement and pricing lookups.')
param workerSubscriptionRbacSubscriptionIds array = []

@description('Optional management group names where the worker managed identity should receive RBAC roles for live placement and pricing lookups. Preferred for larger estates; keep subscription IDs for customers without management groups.')
param workerRbacManagementGroupNames array = []

@description('Assign Compute Recommendations Role on each subscription listed in workerSubscriptionRbacSubscriptionIds.')
param assignWorkerComputeRecommendationsRole bool = true

@description('Assign Cost Management Reader on each subscription listed in workerSubscriptionRbacSubscriptionIds.')
param assignWorkerCostManagementReaderRole bool = true

@description('Assign Billing Reader on each subscription listed in workerSubscriptionRbacSubscriptionIds.')
param assignWorkerBillingReaderRole bool = true

@description('Enable Microsoft Entra sign-in for the dashboard app routes.')
param authEnabled bool = false

@description('Microsoft Entra tenant ID used by the dashboard auth flow.')
param entraTenantId string = ''

@description('Microsoft Entra application (client) ID used by the dashboard auth flow.')
param entraClientId string = ''

@secure()
@description('Microsoft Entra application client secret used by the dashboard auth flow.')
param entraClientSecret string = ''

@description('Optional redirect URI for the dashboard auth callback. Defaults to the Azure Web App callback URL when omitted.')
param authRedirectUri string = ''

@description('Optional Entra group object ID whose members should receive admin access in the dashboard.')
param adminGroupId string = ''

var appServicePlanName = 'asp-capdash-${environment}-${workloadSuffix}'
var workerPlanName = 'asp-capdash-worker-${environment}-${workloadSuffix}'
var webAppName = 'app-capdash-${environment}-${workloadSuffix}'
var functionAppName = 'func-capdash-${environment}-${workloadSuffix}-appsvc'
var functionStorageName = 'stcap${environment}${uniqueString(resourceGroup().id, workloadSuffix, 'worker')}'
var appInsightsName = 'appi-capdash-${environment}-${workloadSuffix}'
var logAnalyticsName = 'log-capdash-${environment}-${workloadSuffix}'
var keyVaultName = 'kv-capdash-${environment}-${workloadSuffix}'
var sqlServerName = 'sql-capdash-${environment}-${workloadSuffix}'
var sqlDatabaseName = 'sqldb-capdash-${environment}'
var vnetName = 'vnet-capdash-${environment}-${workloadSuffix}'
var appServiceIntegrationSubnetName = 'snet-appsvc-integration'
var privateEndpointSubnetName = 'snet-private-endpoints'
var sqlPrivateEndpointName = 'pep-sql-capdash-${environment}-${workloadSuffix}'
var sqlPrivateDnsZoneName = 'privatelink${az.environment().suffixes.sqlServerHostname}'
var sqlPrivateDnsZoneVnetLinkName = 'pdz-link-capdash-${environment}-${workloadSuffix}'
var keyVaultPrivateEndpointName = 'pep-kv-capdash-${environment}-${workloadSuffix}'
var keyVaultDnsSuffixRaw = az.environment().suffixes.keyvaultDns
var keyVaultDnsSuffix = startsWith(keyVaultDnsSuffixRaw, '.') ? substring(keyVaultDnsSuffixRaw, 1) : keyVaultDnsSuffixRaw
var keyVaultPrivateDnsZoneName = startsWith(keyVaultDnsSuffix, 'vaultcore.')
  ? 'privatelink.${keyVaultDnsSuffix}'
  : replace(keyVaultDnsSuffix, 'vault.', 'privatelink.vaultcore.')
var keyVaultPrivateDnsZoneVnetLinkName = 'pdz-link-kv-capdash-${environment}-${workloadSuffix}'
var effectiveAuthRedirectUri = empty(authRedirectUri)
  ? 'https://${webAppName}.azurewebsites.net/auth/callback'
  : authRedirectUri

resource vnet 'Microsoft.Network/virtualNetworks@2023-09-01' = {
  name: vnetName
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        vnetAddressPrefix
      ]
    }
    subnets: [
      {
        name: appServiceIntegrationSubnetName
        properties: {
          addressPrefix: appServiceIntegrationSubnetPrefix
          delegations: [
            {
              name: 'webapp-delegation'
              properties: {
                serviceName: 'Microsoft.Web/serverFarms'
              }
            }
          ]
        }
      }
      {
        name: privateEndpointSubnetName
        properties: {
          addressPrefix: privateEndpointSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource appServiceIntegrationSubnet 'Microsoft.Network/virtualNetworks/subnets@2023-09-01' existing = {
  parent: vnet
  name: appServiceIntegrationSubnetName
}

resource privateEndpointSubnet 'Microsoft.Network/virtualNetworks/subnets@2023-09-01' existing = {
  parent: vnet
  name: privateEndpointSubnetName
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource functionStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: functionStorageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    accessTier: 'Hot'
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  sku: {
    name: 'P1v3'
    tier: 'PremiumV3'
    size: 'P1v3'
    capacity: 1
  }
  properties: {
    reserved: false
  }
}

resource workerPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: workerPlanName
  location: location
  sku: {
    name: 'B1'
    tier: 'Basic'
    size: 'B1'
    capacity: 1
  }
  properties: {
    reserved: false
  }
}

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    virtualNetworkSubnetId: appServiceIntegrationSubnet.id
    siteConfig: {
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      appSettings: [
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'Dashboard__Mode'
          value: 'MVP'
        }
        {
          name: 'SQL_SERVER'
          value: '${sqlServerName}${az.environment().suffixes.sqlServerHostname}'
        }
        {
          name: 'SQL_DATABASE'
          value: sqlDatabaseName
        }
        {
          name: 'SQL_AUTH_MODE'
          value: 'managed-identity'
        }
        {
          name: 'CAPACITY_WORKER_BASE_URL'
          value: 'https://${functionApp.properties.defaultHostName}'
        }
        {
          name: 'CAPACITY_WORKER_SHARED_SECRET'
          value: workerSharedSecret
        }
        {
          name: 'INGEST_API_KEY'
          value: ingestApiKey
        }
        {
          name: 'SESSION_SECRET'
          value: sessionSecret
        }
        {
          name: 'QUOTA_MANAGEMENT_GROUP_ID'
          value: quotaManagementGroupId
        }
        {
          name: 'INGEST_MANAGEMENT_GROUP_NAMES'
          value: join(webReaderManagementGroupNames, ',')
        }
        {
          name: 'NODE_ENV'
          value: 'production'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
        {
          name: 'AUTH_ENABLED'
          value: string(authEnabled)
        }
        {
          name: 'ENTRA_TENANT_ID'
          value: entraTenantId
        }
        {
          name: 'ENTRA_CLIENT_ID'
          value: entraClientId
        }
        {
          name: 'ENTRA_CLIENT_SECRET'
          value: entraClientSecret
        }
        {
          name: 'AUTH_REDIRECT_URI'
          value: effectiveAuthRedirectUri
        }
        {
          name: 'ADMIN_GROUP_ID'
          value: adminGroupId
        }
        {
          name: 'SESSION_STORE_SQL_ENABLED'
          value: authEnabled ? 'true' : 'false'
        }
        {
          name: 'WEBSITE_DNS_SERVER'
          value: '168.63.129.16'
        }
        {
          name: 'WEBSITE_VNET_ROUTE_ALL'
          value: '1'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
        }
      ]
    }
  }
}

resource webAppVnetIntegration 'Microsoft.Web/sites/networkConfig@2023-12-01' = {
  parent: webApp
  name: 'virtualNetwork'
  properties: {
    subnetResourceId: appServiceIntegrationSubnet.id
    swiftSupported: true
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: workerPlan.id
    httpsOnly: true
    virtualNetworkSubnetId: appServiceIntegrationSubnet.id
    siteConfig: {
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      alwaysOn: true
      powerShellVersion: '7.4'
      appSettings: [
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'AzureWebJobsStorage__accountName'
          value: functionStorage.name
        }
        {
          name: 'AzureWebJobsStorage__credential'
          value: 'managedidentity'
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'powershell'
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'WORKER_SHARED_SECRET'
          value: workerSharedSecret
        }
        {
          name: 'WEBSITE_DNS_SERVER'
          value: '168.63.129.16'
        }
        {
          name: 'WEBSITE_VNET_ROUTE_ALL'
          value: '1'
        }
      ]
    }
  }
}

resource functionAppVnetIntegration 'Microsoft.Web/sites/networkConfig@2023-12-01' = {
  parent: functionApp
  name: 'virtualNetwork'
  properties: {
    subnetResourceId: appServiceIntegrationSubnet.id
    swiftSupported: true
  }
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: keyVaultPublicNetworkAccess
  }
}

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: sqlServerName
  location: location
  properties: {
    administrators: {
      administratorType: 'ActiveDirectory'
      azureADOnlyAuthentication: true
      login: sqlEntraAdminLogin
      principalType: 'User'
      sid: sqlEntraAdminObjectId
      tenantId: tenant().tenantId
    }
    version: '12.0'
    publicNetworkAccess: sqlPublicNetworkAccess
    minimalTlsVersion: '1.2'
  }
}

resource sqlPrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: sqlPrivateDnsZoneName
  location: 'global'
}

resource sqlPrivateDnsZoneVnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: sqlPrivateDnsZone
  name: sqlPrivateDnsZoneVnetLinkName
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource sqlPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-09-01' = {
  name: sqlPrivateEndpointName
  location: location
  properties: {
    subnet: {
      id: privateEndpointSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'sqlServerConnection'
        properties: {
          privateLinkServiceId: sqlServer.id
          groupIds: [
            'sqlServer'
          ]
        }
      }
    ]
  }
}

resource sqlPrivateEndpointDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-09-01' = {
  parent: sqlPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'sql-private-dns'
        properties: {
          privateDnsZoneId: sqlPrivateDnsZone.id
        }
      }
    ]
  }
}

resource keyVaultPrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: keyVaultPrivateDnsZoneName
  location: 'global'
}

resource keyVaultPrivateDnsZoneVnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: keyVaultPrivateDnsZone
  name: keyVaultPrivateDnsZoneVnetLinkName
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource keyVaultPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-09-01' = {
  name: keyVaultPrivateEndpointName
  location: location
  properties: {
    subnet: {
      id: privateEndpointSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'keyVaultConnection'
        properties: {
          privateLinkServiceId: kv.id
          groupIds: [
            'vault'
          ]
        }
      }
    ]
  }
}

resource keyVaultPrivateEndpointDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-09-01' = {
  parent: keyVaultPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'kv-private-dns'
        properties: {
          privateDnsZoneId: keyVaultPrivateDnsZone.id
        }
      }
    ]
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: sqlDatabaseName
  location: location
  sku: {
    name: 'S0'
    tier: 'Standard'
  }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
  }
}

resource webToKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, webApp.id, 'KeyVaultSecretsUser')
  scope: kv
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerToKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, functionApp.id, 'KeyVaultSecretsUser')
  scope: kv
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerToFunctionStorageBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(functionStorage.id, functionApp.id, 'StorageBlobDataOwner')
  scope: functionStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b')
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerToFunctionStorageQueueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(functionStorage.id, functionApp.id, 'StorageQueueDataContributor')
  scope: functionStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '974c5e8b-45b9-4653-ba55-5f855dd0fb88')
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerToFunctionStorageTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(functionStorage.id, functionApp.id, 'StorageTableDataContributor')
  scope: functionStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3')
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

module workerSubscriptionRbacAssignments './modules/worker-subscription-rbac.bicep' = [for targetSubscriptionId in workerSubscriptionRbacSubscriptionIds: {
  name: 'worker-sub-rbac-${uniqueString(targetSubscriptionId, functionApp.id)}'
  scope: subscription(targetSubscriptionId)
  params: {
    principalId: functionApp.identity.principalId
    assignComputeRecommendationsRole: assignWorkerComputeRecommendationsRole
    assignCostManagementReaderRole: assignWorkerCostManagementReaderRole
    assignBillingReaderRole: assignWorkerBillingReaderRole
  }
}]

module workerManagementGroupRbacAssignments './modules/worker-management-group-rbac.bicep' = [for targetManagementGroupName in workerRbacManagementGroupNames: {
  name: 'worker-mg-rbac-${uniqueString(targetManagementGroupName, functionApp.id)}'
  scope: tenant()
  params: {
    managementGroupName: targetManagementGroupName
    principalId: functionApp.identity.principalId
    assignComputeRecommendationsRole: assignWorkerComputeRecommendationsRole
    assignCostManagementReaderRole: assignWorkerCostManagementReaderRole
    assignBillingReaderRole: assignWorkerBillingReaderRole
  }
}]

module webSubscriptionReaderAssignments './modules/webSubscriptionReader.bicep' = [for targetSubscriptionId in webReaderSubscriptionIds: {
  name: 'web-sub-reader-${uniqueString(targetSubscriptionId, webApp.id)}'
  scope: subscription(targetSubscriptionId)
  params: {
    principalId: webApp.identity.principalId
  }
}]

module webManagementGroupReaderAssignments './modules/web-management-group-reader.bicep' = [for targetManagementGroupName in webReaderManagementGroupNames: {
  name: 'web-mg-reader-${uniqueString(targetManagementGroupName, webApp.id)}'
  scope: tenant()
  params: {
    managementGroupName: targetManagementGroupName
    principalId: webApp.identity.principalId
  }
}]

module webSubscriptionQuotaWriterAssignments './modules/webSubscriptionQuotaWriter.bicep' = [for targetSubscriptionId in webQuotaWriterSubscriptionIds: {
  name: 'web-sub-quota-writer-${uniqueString(targetSubscriptionId, webApp.id)}'
  scope: subscription(targetSubscriptionId)
  params: {
    principalId: webApp.identity.principalId
  }
}]

module webManagementGroupQuotaWriterAssignments './modules/web-management-group-quota-writer.bicep' = [for targetManagementGroupName in webQuotaWriterManagementGroupNames: {
  name: 'web-mg-quota-writer-${uniqueString(targetManagementGroupName, webApp.id)}'
  scope: tenant()
  params: {
    managementGroupName: targetManagementGroupName
    principalId: webApp.identity.principalId
  }
}]

output webAppName string = webApp.name
output webAppUrl string = 'https://${webApp.properties.defaultHostName}'
output managedIdentityPrincipalId string = webApp.identity.principalId
output functionAppName string = functionApp.name
output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'
output functionManagedIdentityPrincipalId string = functionApp.identity.principalId
output sqlServerFqdn string = '${sqlServer.name}${az.environment().suffixes.sqlServerHostname}'
output sqlServerName string = sqlServer.name
output sqlDatabaseName string = sqlDatabase.name
output keyVaultName string = kv.name
output virtualNetworkName string = vnet.name
output sqlPrivateEndpointName string = sqlPrivateEndpoint.name
output keyVaultPrivateEndpointName string = keyVaultPrivateEndpoint.name
