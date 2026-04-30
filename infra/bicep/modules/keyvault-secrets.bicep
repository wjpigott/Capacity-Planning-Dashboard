@description('Target Key Vault name.')
param keyVaultName string

@secure()
@description('Shared secret used to authorize internal bootstrap and ingestion routes on the dashboard web app.')
param ingestApiKey string

@secure()
@description('Session secret used by the dashboard web app session middleware.')
param sessionSecret string

@secure()
@description('Optional shared secret used between the dashboard web app and the worker function app.')
param workerSharedSecret string = ''

@secure()
@description('Optional Microsoft Entra application client secret used by the dashboard auth flow.')
param entraClientSecret string = ''

var ingestApiKeySecretName = 'capdash-ingest-api-key'
var sessionSecretSecretName = 'capdash-session-secret'
var workerSharedSecretSecretName = 'capdash-worker-shared-secret'
var entraClientSecretSecretName = 'capdash-entra-client-secret'

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource ingestApiKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: ingestApiKeySecretName
  properties: {
    value: ingestApiKey
  }
}

resource sessionSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: sessionSecretSecretName
  properties: {
    value: sessionSecret
  }
}

resource workerSharedSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(workerSharedSecret)) {
  parent: kv
  name: workerSharedSecretSecretName
  properties: {
    value: workerSharedSecret
  }
}

resource entraClientSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(entraClientSecret)) {
  parent: kv
  name: entraClientSecretSecretName
  properties: {
    value: entraClientSecret
  }
}
