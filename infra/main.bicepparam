using './main.bicep'

param location = 'eastus'
param environment = 'dev'
param workloadSuffix = 'sample01'

// Supply at deployment time via secure pipeline/secret variable.
param sqlAdminLogin = 'sqladminlocal'
param sqlAdminPassword = 'ReplaceWithSecureSecretAtDeployTime!'
