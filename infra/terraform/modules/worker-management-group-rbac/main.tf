locals {
  management_group_scope = "/providers/Microsoft.Management/managementGroups/${var.management_group_name}"

  roles = {
    compute_recommendations = {
      enabled = var.assign_compute_recommendations_role
      id      = "e82342c9-ac7f-422b-af64-e426d2e12b2d"
    }
    cost_management_reader = {
      enabled = var.assign_cost_management_reader_role
      id      = "72fafb9e-0641-4937-9268-a91bfd8191a3"
    }
    billing_reader = {
      enabled = var.assign_billing_reader_role
      id      = "fa23ad8b-c56e-40d8-ac0c-ce449e1d2c64"
    }
  }

  enabled_roles = { for key, value in local.roles : key => value if value.enabled }
}

resource "azurerm_role_assignment" "worker" {
  for_each = local.enabled_roles

  scope              = local.management_group_scope
  role_definition_id = "${local.management_group_scope}/providers/Microsoft.Authorization/roleDefinitions/${each.value.id}"
  principal_id       = var.principal_id
  principal_type     = "ServicePrincipal"
}