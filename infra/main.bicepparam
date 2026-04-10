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
