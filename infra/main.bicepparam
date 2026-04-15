using './main.bicep'

param location = 'centralus'
param environment = 'dev'
param workloadSuffix = 'sample01'

// Supply at deployment time via secure pipeline/secret variable if you need to override bootstrap defaults.
param sqlAdminLogin = 'sqllocaladmin'
param sqlAdminPassword = 'ReplaceWithSecureSecretAtDeployTime!'

// Supply at deployment time for Azure SQL Entra admin configuration.
param sqlEntraAdminLogin = 'user@contoso.com'
param sqlEntraAdminObjectId = '00000000-0000-0000-0000-000000000000'

// Private networking defaults for SQL connectivity from App Service.
param vnetAddressPrefix = '10.90.0.0/16'
param appServiceIntegrationSubnetPrefix = '10.90.1.0/24'
param privateEndpointSubnetPrefix = '10.90.2.0/24'
param sqlPublicNetworkAccess = 'Disabled'
param keyVaultPublicNetworkAccess = 'Disabled'
