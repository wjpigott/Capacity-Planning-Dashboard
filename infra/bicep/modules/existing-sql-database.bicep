targetScope = 'resourceGroup'

@description('Location for the database resource.')
param location string

@description('Existing Azure SQL server name in this resource group.')
param sqlServerName string

@description('Dashboard database name to create on the existing SQL server.')
param sqlDatabaseName string

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' existing = {
  name: sqlServerName
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
