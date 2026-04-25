resource "azurerm_role_assignment" "quota_writer" {
  scope              = "/providers/Microsoft.Management/managementGroups/${var.management_group_name}"
  role_definition_id = "/providers/Microsoft.Management/managementGroups/${var.management_group_name}/providers/Microsoft.Authorization/roleDefinitions/e2217c0e-04bb-4724-9580-91cf9871bc01"
  principal_id       = var.principal_id
  principal_type     = "ServicePrincipal"
}