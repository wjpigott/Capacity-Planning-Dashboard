targetScope = 'managementGroup'

@description('Principal ID of the dashboard web app managed identity that requires GroupQuota Request Operator access.')
param principalId string

resource webManagementGroupQuotaWriterRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(managementGroup().id, principalId, 'GroupQuotaRequestOperator')
  properties: {
    roleDefinitionId: tenantResourceId('Microsoft.Authorization/roleDefinitions', 'e2217c0e-04bb-4724-9580-91cf9871bc01')
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
