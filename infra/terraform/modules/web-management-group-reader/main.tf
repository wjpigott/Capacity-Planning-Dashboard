resource "azurerm_role_assignment" "reader" {
  scope                = "/providers/Microsoft.Management/managementGroups/${var.management_group_name}"
  role_definition_name = "Reader"
  principal_id         = var.principal_id
  principal_type       = "ServicePrincipal"
}