targetScope = 'tenant'

@description('Management group name where the Reader role should be assigned.')
param managementGroupName string

@description('Principal ID of the dashboard web app managed identity that requires Reader access.')
param principalId string

module managementGroupReaderAssignment './web-management-group-reader-assignment.bicep' = {
  name: 'web-mg-reader-assignment-${uniqueString(managementGroupName, principalId)}'
  scope: managementGroup(managementGroupName)
  params: {
    principalId: principalId
  }
}
