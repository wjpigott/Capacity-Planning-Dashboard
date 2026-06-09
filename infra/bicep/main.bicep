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

@description('Function App public network access mode. Keep Disabled when createFunctionPrivateEndpoint is true so worker ingress stays private.')
@allowed([
  'Enabled'
  'Disabled'
])
param functionPublicNetworkAccess string = 'Disabled'

@description('Function worker storage account public network access mode. Keep Disabled when createWorkerStoragePrivateEndpoints is true so the worker host storage path stays private.')
@allowed([
  'Enabled'
  'Disabled'
])
param workerStoragePublicNetworkAccess string = 'Disabled'

@description('Create a private endpoint and private DNS zone for the worker Function App. Recommended for production and security-reviewed environments.')
param createFunctionPrivateEndpoint bool = true

@description('Create private endpoints and private DNS zones for the worker Function App host storage account. Recommended for production and security-reviewed environments.')
param createWorkerStoragePrivateEndpoints bool = true

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

@description('Whether this template should create management-group-scope RBAC assignments. Set false when the deployment wrapper applies those assignments after infrastructure deployment.')
param deployManagementGroupRbacAssignments bool = true

@description('Optional management group ID used by the dashboard quota discovery UI when tenant-wide management group enumeration is not permitted.')
param quotaManagementGroupId string = ''

@description('Existing Azure SQL server name to reuse. Provide the short resource name, not the FQDN.')
param existingSqlServerName string = ''

@description('Resource group that contains the existing Azure SQL server. Defaults to the deployment resource group when empty.')
param existingSqlServerResourceGroupName string = ''

@description('Existing Azure SQL database name to reuse when the dashboard should attach to an existing database on the existing SQL server.')
param existingSqlDatabaseName string = ''

@description('Existing Key Vault name to reuse.')
param existingKeyVaultName string = ''

@description('Resource group that contains the existing Key Vault. Defaults to the deployment resource group when empty.')
param existingKeyVaultResourceGroupName string = ''

@description('Existing storage account name to reuse for the worker host.')
param existingWorkerStorageAccountName string = ''

@description('Resource group that contains the existing worker storage account. Defaults to the deployment resource group when empty.')
param existingWorkerStorageAccountResourceGroupName string = ''

@description('Existing virtual network name to reuse. When set, the template skips VNet/subnet creation and uses the existing subnet names below.')
param existingVirtualNetworkName string = ''

@description('Resource group that contains the existing virtual network. Defaults to the deployment resource group when empty.')
param existingVirtualNetworkResourceGroupName string = ''

@description('Existing subnet name delegated to Microsoft.Web/serverFarms for Web App and Function App VNet integration. Required when existingVirtualNetworkName is set.')
param existingAppServiceIntegrationSubnetName string = ''

@description('Existing subnet name for SQL and Key Vault private endpoints. Required when existingVirtualNetworkName is set and the template creates private endpoints.')
param existingPrivateEndpointSubnetName string = ''

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
param authEnabled bool = true

@description('Enable App Service Authentication / Easy Auth on the dashboard Web App. Use with bearer-authenticated internal automation after validation.')
param webEasyAuthEnabled bool = false

@description('Client application IDs allowed by Web App Easy Auth for bearer-authenticated API/internal calls. Leave empty for normal browser sign-in without an app allow-list.')
param webEasyAuthAllowedClientApplications array = []

@description('Optional explicit Web App Easy Auth token audiences. Defaults to api://<entraClientId> and <entraClientId> when omitted.')
param webEasyAuthAllowedAudiences array = []

@description('Allow x-ingest-key fallback for internal routes. Set false only after Web App Easy Auth bearer automation is validated.')
param ingestApiKeyEnabled bool = true

@description('Dashboard-to-worker authentication mode.')
@allowed([
  'shared-secret'
  'entra'
])
param workerAuthMode string = 'shared-secret'

@description('Enable App Service Authentication / Easy Auth on the worker Function App. Required for workerAuthMode=entra.')
param functionEasyAuthEnabled bool = false

@description('Microsoft Entra application (client) ID used by the worker Function App Easy Auth audience.')
param workerAuthClientId string = ''

@description('Token audience used by the dashboard Web App when acquiring a Microsoft Entra token for the worker Function App.')
param workerAuthTokenAudience string = ''

@description('Client application IDs allowed by Function App Easy Auth. Use the intended dashboard managed identity/client IDs for production.')
param functionEasyAuthAllowedClientApplications array = []

@description('Optional explicit Function App Easy Auth token audiences. Defaults to workerAuthTokenAudience when omitted.')
param functionEasyAuthAllowedAudiences array = []

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

@description('Optional comma-separated Entra group object IDs whose members can view dashboard reports. Admin group members can also view reports. Leave empty to preserve authenticated-user report access.')
param reportViewerGroupIds string = ''

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
var functionPrivateEndpointName = 'pep-func-capdash-${environment}-${workloadSuffix}'
var workerStoragePrivateEndpointNamePrefix = 'pep-stfunc-capdash-${environment}-${workloadSuffix}'
var keyVaultDnsSuffixRaw = az.environment().suffixes.keyvaultDns
var keyVaultDnsSuffix = startsWith(keyVaultDnsSuffixRaw, '.') ? substring(keyVaultDnsSuffixRaw, 1) : keyVaultDnsSuffixRaw
var keyVaultPrivateDnsZoneName = startsWith(keyVaultDnsSuffix, 'vaultcore.')
  ? 'privatelink.${keyVaultDnsSuffix}'
  : replace(keyVaultDnsSuffix, 'vault.', 'privatelink.vaultcore.')
var keyVaultPrivateDnsZoneVnetLinkName = 'pdz-link-kv-capdash-${environment}-${workloadSuffix}'
var functionPrivateDnsZoneName = 'privatelink.azurewebsites.net'
var functionPrivateDnsZoneVnetLinkName = 'pdz-link-func-capdash-${environment}-${workloadSuffix}'
var entraLoginEndpoint = az.environment().authentication.loginEndpoint
var entraIssuer = empty(entraTenantId) ? '' : '${entraLoginEndpoint}${entraTenantId}/v2.0'
var effectiveWebEasyAuthAllowedAudiences = empty(webEasyAuthAllowedAudiences) && !empty(entraClientId) ? [
  'api://${entraClientId}'
  entraClientId
] : webEasyAuthAllowedAudiences
var effectiveFunctionEasyAuthAllowedAudiences = empty(functionEasyAuthAllowedAudiences) && !empty(workerAuthTokenAudience) ? [
  workerAuthTokenAudience
] : functionEasyAuthAllowedAudiences
var workerStoragePrivateEndpointServices = [
  'blob'
  'queue'
  'table'
  'file'
]
var workerStoragePrivateDnsZoneVnetLinkNamePrefix = 'pdz-link-stfunc-capdash-${environment}-${workloadSuffix}'
var workerStoragePrivateEndpointNames = [for (service, index) in workerStoragePrivateEndpointServices: workerStoragePrivateEndpoints[index].name]
var effectiveAuthRedirectUri = empty(authRedirectUri)
  ? 'https://${webAppName}.azurewebsites.net/auth/callback'
  : authRedirectUri
var useExistingSqlServer = !empty(existingSqlServerName)
var useExistingSqlDatabase = !empty(existingSqlDatabaseName)
var useExistingKeyVault = !empty(existingKeyVaultName)
var useExistingWorkerStorageAccount = !empty(existingWorkerStorageAccountName)
var useExistingVirtualNetwork = !empty(existingVirtualNetworkName) || !empty(existingAppServiceIntegrationSubnetName) || !empty(existingPrivateEndpointSubnetName)
var effectiveSqlServerResourceGroupName = empty(existingSqlServerResourceGroupName) ? resourceGroup().name : existingSqlServerResourceGroupName
var effectiveSqlServerName = useExistingSqlServer ? existingSqlServerName : sqlServerName
var effectiveSqlDatabaseName = useExistingSqlDatabase ? existingSqlDatabaseName : sqlDatabaseName
var effectiveSqlServerFqdn = contains(effectiveSqlServerName, '.') ? effectiveSqlServerName : '${effectiveSqlServerName}${az.environment().suffixes.sqlServerHostname}'
var effectiveKeyVaultResourceGroupName = empty(existingKeyVaultResourceGroupName) ? resourceGroup().name : existingKeyVaultResourceGroupName
var effectiveKeyVaultName = useExistingKeyVault ? existingKeyVaultName : keyVaultName
var effectiveKeyVaultUri = 'https://${effectiveKeyVaultName}.${keyVaultDnsSuffix}/'
var effectiveWorkerStorageAccountResourceGroupName = empty(existingWorkerStorageAccountResourceGroupName) ? resourceGroup().name : existingWorkerStorageAccountResourceGroupName
var effectiveWorkerStorageAccountName = useExistingWorkerStorageAccount ? existingWorkerStorageAccountName : functionStorageName
var effectiveVirtualNetworkResourceGroupName = empty(existingVirtualNetworkResourceGroupName) ? resourceGroup().name : existingVirtualNetworkResourceGroupName
var effectiveVirtualNetworkName = useExistingVirtualNetwork ? existingVirtualNetworkName : vnetName
var effectiveAppServiceIntegrationSubnetName = useExistingVirtualNetwork ? existingAppServiceIntegrationSubnetName : appServiceIntegrationSubnetName
var effectivePrivateEndpointSubnetName = useExistingVirtualNetwork ? existingPrivateEndpointSubnetName : privateEndpointSubnetName
var effectiveVirtualNetworkId = useExistingVirtualNetwork
  ? resourceId(effectiveVirtualNetworkResourceGroupName, 'Microsoft.Network/virtualNetworks', effectiveVirtualNetworkName)
  : resourceId('Microsoft.Network/virtualNetworks', vnetName)
var effectiveAppServiceIntegrationSubnetId = useExistingVirtualNetwork
  ? resourceId(effectiveVirtualNetworkResourceGroupName, 'Microsoft.Network/virtualNetworks/subnets', effectiveVirtualNetworkName, effectiveAppServiceIntegrationSubnetName)
  : resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, appServiceIntegrationSubnetName)
var effectivePrivateEndpointSubnetId = useExistingVirtualNetwork
  ? resourceId(effectiveVirtualNetworkResourceGroupName, 'Microsoft.Network/virtualNetworks/subnets', effectiveVirtualNetworkName, effectivePrivateEndpointSubnetName)
  : resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, privateEndpointSubnetName)
var ingestApiKeySecretName = 'capdash-ingest-api-key'
var sessionSecretSecretName = 'capdash-session-secret'
var workerSharedSecretSecretName = 'capdash-worker-shared-secret'
var entraClientSecretSecretName = 'capdash-entra-client-secret'
var ingestApiKeyKeyVaultReference = '@Microsoft.KeyVault(SecretUri=${effectiveKeyVaultUri}secrets/${ingestApiKeySecretName})'
var sessionSecretKeyVaultReference = '@Microsoft.KeyVault(SecretUri=${effectiveKeyVaultUri}secrets/${sessionSecretSecretName})'
var workerSharedSecretKeyVaultReference = empty(workerSharedSecret) ? '' : '@Microsoft.KeyVault(SecretUri=${effectiveKeyVaultUri}secrets/${workerSharedSecretSecretName})'
var entraClientSecretKeyVaultReference = empty(entraClientSecret) ? '' : '@Microsoft.KeyVault(SecretUri=${effectiveKeyVaultUri}secrets/${entraClientSecretSecretName})'
var effectiveWorkerSharedSecretReference = workerAuthMode == 'entra' ? '' : workerSharedSecretKeyVaultReference

resource vnet 'Microsoft.Network/virtualNetworks@2023-09-01' = if (!useExistingVirtualNetwork) {
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

resource functionStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = if (!useExistingWorkerStorageAccount) {
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
    publicNetworkAccess: workerStoragePublicNetworkAccess
    accessTier: 'Hot'
  }
}

resource workerStoragePrivateDnsZones 'Microsoft.Network/privateDnsZones@2020-06-01' = [for service in workerStoragePrivateEndpointServices: if (createWorkerStoragePrivateEndpoints) {
  name: 'privatelink.${service}.core.windows.net'
  location: 'global'
}]

resource workerStoragePrivateDnsZoneVnetLinks 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = [for (service, index) in workerStoragePrivateEndpointServices: if (createWorkerStoragePrivateEndpoints) {
  parent: workerStoragePrivateDnsZones[index]
  name: '${workerStoragePrivateDnsZoneVnetLinkNamePrefix}-${service}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: effectiveVirtualNetworkId
    }
  }
  dependsOn: [
    vnet
  ]
}]

resource workerStoragePrivateEndpoints 'Microsoft.Network/privateEndpoints@2023-09-01' = [for service in workerStoragePrivateEndpointServices: if (createWorkerStoragePrivateEndpoints) {
  name: '${workerStoragePrivateEndpointNamePrefix}-${service}'
  location: location
  properties: {
    subnet: {
      id: effectivePrivateEndpointSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'workerStorage${service}Connection'
        properties: {
          privateLinkServiceId: resourceId(effectiveWorkerStorageAccountResourceGroupName, 'Microsoft.Storage/storageAccounts', effectiveWorkerStorageAccountName)
          groupIds: [
            service
          ]
        }
      }
    ]
  }
  dependsOn: [
    functionStorage
    vnet
  ]
}]

resource workerStoragePrivateEndpointDnsZoneGroups 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-09-01' = [for (service, index) in workerStoragePrivateEndpointServices: if (createWorkerStoragePrivateEndpoints) {
  parent: workerStoragePrivateEndpoints[index]
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'worker-storage-${service}-private-dns'
        properties: {
          privateDnsZoneId: workerStoragePrivateDnsZones[index].id
        }
      }
    ]
  }
}]

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
    virtualNetworkSubnetId: effectiveAppServiceIntegrationSubnetId
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
          value: effectiveSqlServerFqdn
        }
        {
          name: 'SQL_DATABASE'
          value: effectiveSqlDatabaseName
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
          name: 'CAPACITY_RECOMMEND_USE_DIRECT_API'
          value: 'true'
        }
        {
          name: 'CAPACITY_RECOMMEND_SUBSCRIPTION_ID'
          value: subscription().subscriptionId
        }
        {
          name: 'CAPACITY_RECOMMEND_WORKER_TIMEOUT_MS'
          value: '180000'
        }
        {
          name: 'CAPACITY_WORKER_SHARED_SECRET'
          value: effectiveWorkerSharedSecretReference
        }
        {
          name: 'CAPACITY_WORKER_AUTH_MODE'
          value: workerAuthMode
        }
        {
          name: 'CAPACITY_WORKER_TOKEN_AUDIENCE'
          value: workerAuthTokenAudience
        }
        {
          name: 'INGEST_EASY_AUTH_BEARER_ENABLED'
          value: string(webEasyAuthEnabled)
        }
        {
          name: 'INGEST_API_KEY_ENABLED'
          value: string(ingestApiKeyEnabled)
        }
        {
          name: 'INGEST_API_KEY'
          value: ingestApiKeyKeyVaultReference
        }
        {
          name: 'SESSION_SECRET'
          value: sessionSecretKeyVaultReference
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
          value: entraClientSecretKeyVaultReference
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
          name: 'REPORT_VIEWER_GROUP_IDS'
          value: reportViewerGroupIds
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
  dependsOn: [
    vnet
  ]
}

resource webAppAuthSettings 'Microsoft.Web/sites/config@2022-03-01' = if (webEasyAuthEnabled) {
  parent: webApp
  name: 'authsettingsV2'
  properties: {
    platform: {
      enabled: true
      runtimeVersion: '~1'
    }
    globalValidation: {
      requireAuthentication: true
      unauthenticatedClientAction: 'Return401'
      redirectToProvider: 'azureActiveDirectory'
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: entraClientId
          clientSecretSettingName: 'ENTRA_CLIENT_SECRET'
          openIdIssuer: entraIssuer
        }
        validation: {
          allowedAudiences: effectiveWebEasyAuthAllowedAudiences
          defaultAuthorizationPolicy: {
            allowedApplications: webEasyAuthAllowedClientApplications
            allowedPrincipals: {}
          }
        }
      }
    }
  }
}

resource webAppVnetIntegration 'Microsoft.Web/sites/networkConfig@2023-12-01' = {
  parent: webApp
  name: 'virtualNetwork'
  properties: {
    subnetResourceId: effectiveAppServiceIntegrationSubnetId
    swiftSupported: true
  }
  dependsOn: [
    vnet
  ]
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
    publicNetworkAccess: functionPublicNetworkAccess
    virtualNetworkSubnetId: effectiveAppServiceIntegrationSubnetId
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
          value: effectiveWorkerStorageAccountName
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
          value: effectiveWorkerSharedSecretReference
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
  dependsOn: [
    vnet
  ]
}

resource functionAppAuthSettings 'Microsoft.Web/sites/config@2022-03-01' = if (functionEasyAuthEnabled) {
  parent: functionApp
  name: 'authsettingsV2'
  properties: {
    platform: {
      enabled: true
      runtimeVersion: '~1'
    }
    globalValidation: {
      requireAuthentication: true
      unauthenticatedClientAction: 'Return401'
      redirectToProvider: 'azureActiveDirectory'
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: workerAuthClientId
          openIdIssuer: entraIssuer
        }
        validation: {
          allowedAudiences: effectiveFunctionEasyAuthAllowedAudiences
          defaultAuthorizationPolicy: {
            allowedApplications: functionEasyAuthAllowedClientApplications
            allowedPrincipals: {}
          }
        }
      }
    }
  }
}

resource functionAppVnetIntegration 'Microsoft.Web/sites/networkConfig@2023-12-01' = {
  parent: functionApp
  name: 'virtualNetwork'
  properties: {
    subnetResourceId: effectiveAppServiceIntegrationSubnetId
    swiftSupported: true
  }
  dependsOn: [
    vnet
  ]
}

resource functionPrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = if (createFunctionPrivateEndpoint) {
  name: functionPrivateDnsZoneName
  location: 'global'
}

resource functionPrivateDnsZoneVnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (createFunctionPrivateEndpoint) {
  parent: functionPrivateDnsZone
  name: functionPrivateDnsZoneVnetLinkName
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: effectiveVirtualNetworkId
    }
  }
  dependsOn: [
    vnet
  ]
}

resource functionPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-09-01' = if (createFunctionPrivateEndpoint) {
  name: functionPrivateEndpointName
  location: location
  properties: {
    subnet: {
      id: effectivePrivateEndpointSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'functionAppConnection'
        properties: {
          privateLinkServiceId: functionApp.id
          groupIds: [
            'sites'
          ]
        }
      }
    ]
  }
  dependsOn: [
    vnet
  ]
}

resource functionPrivateEndpointDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-09-01' = if (createFunctionPrivateEndpoint) {
  parent: functionPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'function-private-dns'
        properties: {
          privateDnsZoneId: functionPrivateDnsZone.id
        }
      }
    ]
  }
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = if (!useExistingKeyVault) {
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

module keyVaultSecrets './modules/keyvault-secrets.bicep' = if (!useExistingKeyVault) {
  name: 'keyVaultSecrets-${uniqueString(effectiveKeyVaultName, deployment().name)}'
  params: {
    keyVaultName: effectiveKeyVaultName
    ingestApiKey: ingestApiKey
    sessionSecret: sessionSecret
    workerSharedSecret: workerSharedSecret
    entraClientSecret: entraClientSecret
  }
  dependsOn: [
    kv
  ]
}

module existingKeyVaultSecrets './modules/keyvault-secrets.bicep' = if (useExistingKeyVault) {
  name: 'existingKeyVaultSecrets-${uniqueString(effectiveKeyVaultName, deployment().name)}'
  scope: resourceGroup(effectiveKeyVaultResourceGroupName)
  params: {
    keyVaultName: effectiveKeyVaultName
    ingestApiKey: ingestApiKey
    sessionSecret: sessionSecret
    workerSharedSecret: workerSharedSecret
    entraClientSecret: entraClientSecret
  }
}

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = if (!useExistingSqlServer) {
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

resource sqlPrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = if (!useExistingSqlServer) {
  name: sqlPrivateDnsZoneName
  location: 'global'
}

resource sqlPrivateDnsZoneVnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (!useExistingSqlServer) {
  parent: sqlPrivateDnsZone
  name: sqlPrivateDnsZoneVnetLinkName
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: effectiveVirtualNetworkId
    }
  }
  dependsOn: [
    vnet
  ]
}

resource sqlPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-09-01' = if (!useExistingSqlServer) {
  name: sqlPrivateEndpointName
  location: location
  properties: {
    subnet: {
      id: effectivePrivateEndpointSubnetId
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
  dependsOn: [
    vnet
  ]
}

resource sqlPrivateEndpointDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-09-01' = if (!useExistingSqlServer) {
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

resource keyVaultPrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = if (!useExistingKeyVault) {
  name: keyVaultPrivateDnsZoneName
  location: 'global'
}

resource keyVaultPrivateDnsZoneVnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (!useExistingKeyVault) {
  parent: keyVaultPrivateDnsZone
  name: keyVaultPrivateDnsZoneVnetLinkName
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: effectiveVirtualNetworkId
    }
  }
  dependsOn: [
    vnet
  ]
}

resource keyVaultPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-09-01' = if (!useExistingKeyVault) {
  name: keyVaultPrivateEndpointName
  location: location
  properties: {
    subnet: {
      id: effectivePrivateEndpointSubnetId
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
  dependsOn: [
    vnet
  ]
}

resource keyVaultPrivateEndpointDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-09-01' = if (!useExistingKeyVault) {
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

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01-preview' = if (!useExistingSqlDatabase && !useExistingSqlServer) {
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

resource webToKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!useExistingKeyVault) {
  name: guid(kv.id, webApp.id, 'KeyVaultSecretsUser')
  scope: kv
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerToKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!useExistingKeyVault) {
  name: guid(kv.id, functionApp.id, 'KeyVaultSecretsUser')
  scope: kv
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerToFunctionStorageBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!useExistingWorkerStorageAccount) {
  name: guid(functionStorage.id, functionApp.id, 'StorageBlobDataOwner')
  scope: functionStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b')
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerToFunctionStorageQueueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!useExistingWorkerStorageAccount) {
  name: guid(functionStorage.id, functionApp.id, 'StorageQueueDataContributor')
  scope: functionStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '974c5e8b-45b9-4653-ba55-5f855dd0fb88')
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerToFunctionStorageTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!useExistingWorkerStorageAccount) {
  name: guid(functionStorage.id, functionApp.id, 'StorageTableDataContributor')
  scope: functionStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3')
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

module existingSqlDatabaseModule './modules/existing-sql-database.bicep' = if (!useExistingSqlDatabase && useExistingSqlServer) {
  scope: resourceGroup(effectiveSqlServerResourceGroupName)
  params: {
    location: location
    sqlServerName: effectiveSqlServerName
    sqlDatabaseName: sqlDatabaseName
  }
}

module existingKeyVaultRoleAssignments './modules/existing-keyvault-role-assignments.bicep' = if (useExistingKeyVault) {
  scope: resourceGroup(effectiveKeyVaultResourceGroupName)
  params: {
    keyVaultName: effectiveKeyVaultName
    webPrincipalId: webApp.identity.principalId
    workerPrincipalId: functionApp.identity.principalId
  }
}

module existingWorkerStorageRoleAssignments './modules/existing-storage-role-assignments.bicep' = if (useExistingWorkerStorageAccount) {
  scope: resourceGroup(effectiveWorkerStorageAccountResourceGroupName)
  params: {
    storageAccountName: effectiveWorkerStorageAccountName
    workerPrincipalId: functionApp.identity.principalId
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

module workerManagementGroupRbacAssignments './modules/worker-management-group-rbac.bicep' = [for targetManagementGroupName in workerRbacManagementGroupNames: if (deployManagementGroupRbacAssignments) {
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

module webManagementGroupReaderAssignments './modules/web-management-group-reader.bicep' = [for targetManagementGroupName in webReaderManagementGroupNames: if (deployManagementGroupRbacAssignments) {
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

module webManagementGroupQuotaWriterAssignments './modules/web-management-group-quota-writer.bicep' = [for targetManagementGroupName in webQuotaWriterManagementGroupNames: if (deployManagementGroupRbacAssignments) {
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
output sqlServerFqdn string = effectiveSqlServerFqdn
output sqlServerName string = effectiveSqlServerName
output sqlDatabaseName string = effectiveSqlDatabaseName
output keyVaultName string = effectiveKeyVaultName
output virtualNetworkName string = effectiveVirtualNetworkName
output sqlPrivateEndpointName string = useExistingSqlServer ? '' : sqlPrivateEndpoint.name
output keyVaultPrivateEndpointName string = useExistingKeyVault ? '' : keyVaultPrivateEndpoint.name
output functionPrivateEndpointName string = createFunctionPrivateEndpoint ? functionPrivateEndpoint.name : ''
output workerStoragePrivateEndpointNames array = createWorkerStoragePrivateEndpoints ? workerStoragePrivateEndpointNames : []
