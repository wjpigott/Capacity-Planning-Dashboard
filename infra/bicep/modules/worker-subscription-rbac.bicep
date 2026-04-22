targetScope = 'subscription'

@description('Principal ID of the worker managed identity that requires access.')
param principalId string

@description('Assign Compute Recommendations Role at this subscription scope.')
param assignComputeRecommendationsRole bool = true

@description('Assign Cost Management Reader at this subscription scope.')
param assignCostManagementReaderRole bool = true

@description('Assign Billing Reader at this subscription scope.')
param assignBillingReaderRole bool = true

var roleDefinitions = [
  {
    enabled: assignComputeRecommendationsRole
    roleName: 'ComputeRecommendationsRole'
    roleDefinitionId: 'e82342c9-ac7f-422b-af64-e426d2e12b2d'
  }
  {
    enabled: assignCostManagementReaderRole
    roleName: 'CostManagementReader'
    roleDefinitionId: '72fafb9e-0641-4937-9268-a91bfd8191a3'
  }
  {
    enabled: assignBillingReaderRole
    roleName: 'BillingReader'
    roleDefinitionId: 'fa23ad8b-c56e-40d8-ac0c-ce449e1d2c64'
  }
]

resource workerSubscriptionRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for role in roleDefinitions: if (role.enabled) {
  name: guid(subscription().id, principalId, role.roleName)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', role.roleDefinitionId)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}]
