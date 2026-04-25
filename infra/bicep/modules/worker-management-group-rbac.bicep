targetScope = 'tenant'

@description('Management group name where the worker roles should be assigned.')
param managementGroupName string

@description('Principal ID of the worker managed identity that requires access.')
param principalId string

@description('Assign Compute Recommendations Role at this management group scope.')
param assignComputeRecommendationsRole bool = true

@description('Assign Cost Management Reader at this management group scope.')
param assignCostManagementReaderRole bool = true

@description('Assign Billing Reader at this management group scope.')
param assignBillingReaderRole bool = true

module workerManagementGroupAssignments './worker-management-group-rbac-assignment.bicep' = {
  name: 'worker-mg-rbac-assignment-${uniqueString(managementGroupName, principalId)}'
  scope: managementGroup(managementGroupName)
  params: {
    principalId: principalId
    assignComputeRecommendationsRole: assignComputeRecommendationsRole
    assignCostManagementReaderRole: assignCostManagementReaderRole
    assignBillingReaderRole: assignBillingReaderRole
  }
}
