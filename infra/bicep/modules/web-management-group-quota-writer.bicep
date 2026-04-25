targetScope = 'tenant'

@description('Management group name where GroupQuota Request Operator should be assigned.')
param managementGroupName string

@description('Principal ID of the dashboard web app managed identity that requires GroupQuota Request Operator access.')
param principalId string

module managementGroupQuotaWriterAssignment './web-management-group-quota-writer-assignment.bicep' = {
  name: 'web-mg-quota-writer-assignment-${uniqueString(managementGroupName, principalId)}'
  scope: managementGroup(managementGroupName)
  params: {
    principalId: principalId
  }
}
