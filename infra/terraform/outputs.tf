output "web_app_name" {
  description = "Web App resource name"
  value       = azurerm_windows_web_app.web.name
}

output "web_app_url" {
  description = "Web App HTTPS URL"
  value       = "https://${azurerm_windows_web_app.web.default_hostname}"
}

output "managed_identity_principal_id" {
  description = "Web App managed identity principal ID"
  value       = azurerm_windows_web_app.web.identity[0].principal_id
}

output "function_app_name" {
  description = "Function App resource name"
  value       = azurerm_windows_function_app.worker.name
}

output "function_app_url" {
  description = "Function App HTTPS URL"
  value       = "https://${azurerm_windows_function_app.worker.default_hostname}"
}

output "function_managed_identity_principal_id" {
  description = "Function App managed identity principal ID"
  value       = azurerm_windows_function_app.worker.identity[0].principal_id
}

output "sql_server_fqdn" {
  description = "SQL Server fully qualified domain name"
  value       = local.effective_sql_server_fqdn
}

output "sql_server_name" {
  description = "SQL Server resource name"
  value       = local.effective_sql_server_name
}

output "sql_database_name" {
  description = "SQL Database name"
  value       = local.effective_sql_database_name
}

output "key_vault_name" {
  description = "Key Vault resource name"
  value       = local.effective_key_vault_name
}

output "virtual_network_name" {
  description = "Virtual network resource name"
  value       = azurerm_virtual_network.vnet.name
}

output "sql_private_endpoint_name" {
  description = "SQL private endpoint resource name"
  value       = local.use_existing_sql_server ? null : azurerm_private_endpoint.sql[0].name
}

output "key_vault_private_endpoint_name" {
  description = "Key Vault private endpoint resource name"
  value       = local.use_existing_key_vault ? null : azurerm_private_endpoint.kv[0].name
}
