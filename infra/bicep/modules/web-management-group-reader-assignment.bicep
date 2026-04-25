targetScope = 'managementGroup'

@description('Principal ID of the dashboard web app managed identity that requires Reader access.')
param principalId string

resource webManagementGroupReaderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(managementGroup().id, principalId, 'Reader')
  properties: {
    roleDefinitionId: tenantResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
