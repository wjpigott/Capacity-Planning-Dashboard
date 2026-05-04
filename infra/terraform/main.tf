locals {
  use_existing_sql_server                      = trimspace(var.existing_sql_server_name) != ""
  use_existing_sql_database                    = trimspace(var.existing_sql_database_name) != ""
  use_existing_key_vault                       = trimspace(var.existing_key_vault_name) != ""
  use_existing_worker_storage_account          = trimspace(var.existing_worker_storage_account_name) != ""
  app_service_plan_name                        = "asp-capdash-${var.environment}-${var.workload_suffix}"
  worker_plan_name                             = "asp-capdash-worker-${var.environment}-${var.workload_suffix}"
  web_app_name                                 = "app-capdash-${var.environment}-${var.workload_suffix}"
  function_app_name                            = "func-capdash-${var.environment}-${var.workload_suffix}-appsvc"
  function_storage_name                        = "stcap${var.environment}${random_string.storage_suffix.result}"
  app_insights_name                            = "appi-capdash-${var.environment}-${var.workload_suffix}"
  log_analytics_name                           = "log-capdash-${var.environment}-${var.workload_suffix}"
  key_vault_name                               = var.key_vault_name_override != "" ? var.key_vault_name_override : "kv-capdash-${var.environment}-${var.workload_suffix}"
  sql_server_name                              = "sql-capdash-${var.environment}-${var.workload_suffix}"
  sql_database_name                            = "sqldb-capdash-${var.environment}"
  vnet_name                                    = "vnet-capdash-${var.environment}-${var.workload_suffix}"
  app_service_integration_subnet               = "snet-appsvc-integration"
  private_endpoint_subnet                      = "snet-private-endpoints"
  sql_private_endpoint_name                    = "pep-sql-capdash-${var.environment}-${var.workload_suffix}"
  sql_private_dns_zone_name                    = "privatelink.database.windows.net"
  sql_private_dns_zone_vnet_link               = "pdz-link-capdash-${var.environment}-${var.workload_suffix}"
  kv_private_endpoint_name                     = "pep-kv-capdash-${var.environment}-${var.workload_suffix}"
  kv_private_dns_zone_name                     = "privatelink.vaultcore.azure.net"
  kv_private_dns_zone_vnet_link                = "pdz-link-kv-capdash-${var.environment}-${var.workload_suffix}"
  effective_auth_redirect_uri                  = var.auth_redirect_uri != "" ? var.auth_redirect_uri : "https://${local.web_app_name}.azurewebsites.net/auth/callback"
  effective_sql_server_resource_group_name     = var.existing_sql_server_resource_group_name != "" ? var.existing_sql_server_resource_group_name : azurerm_resource_group.rg.name
  effective_sql_server_name                    = local.use_existing_sql_server ? var.existing_sql_server_name : local.sql_server_name
  effective_sql_server_fqdn                    = endswith(local.effective_sql_server_name, ".database.windows.net") ? local.effective_sql_server_name : "${local.effective_sql_server_name}.database.windows.net"
  effective_sql_database_name                  = local.use_existing_sql_database ? var.existing_sql_database_name : local.sql_database_name
  effective_key_vault_resource_group_name      = var.existing_key_vault_resource_group_name != "" ? var.existing_key_vault_resource_group_name : azurerm_resource_group.rg.name
  effective_key_vault_name                     = local.use_existing_key_vault ? var.existing_key_vault_name : local.key_vault_name
  effective_key_vault_id                       = local.use_existing_key_vault ? data.azurerm_key_vault.kv[0].id : azurerm_key_vault.kv[0].id
  effective_key_vault_uri                      = local.use_existing_key_vault ? data.azurerm_key_vault.kv[0].vault_uri : azurerm_key_vault.kv[0].vault_uri
  effective_worker_storage_resource_group_name = var.existing_worker_storage_account_resource_group_name != "" ? var.existing_worker_storage_account_resource_group_name : azurerm_resource_group.rg.name
  effective_worker_storage_name                = local.use_existing_worker_storage_account ? var.existing_worker_storage_account_name : local.function_storage_name
  ingest_api_key_secret_name                   = "capdash-ingest-api-key"
  session_secret_secret_name                   = "capdash-session-secret"
  worker_shared_secret_secret_name             = "capdash-worker-shared-secret"
  entra_client_secret_secret_name              = "capdash-entra-client-secret"
  ingest_api_key_key_vault_reference           = "@Microsoft.KeyVault(SecretUri=${local.effective_key_vault_uri}secrets/${local.ingest_api_key_secret_name})"
  session_secret_key_vault_reference           = "@Microsoft.KeyVault(SecretUri=${local.effective_key_vault_uri}secrets/${local.session_secret_secret_name})"
  worker_shared_secret_key_vault_reference     = var.worker_shared_secret != "" ? "@Microsoft.KeyVault(SecretUri=${local.effective_key_vault_uri}secrets/${local.worker_shared_secret_secret_name})" : ""
  entra_client_secret_key_vault_reference      = var.entra_client_secret != "" ? "@Microsoft.KeyVault(SecretUri=${local.effective_key_vault_uri}secrets/${local.entra_client_secret_secret_name})" : ""
}

resource "random_string" "storage_suffix" {
  length  = 8
  special = false
  upper   = false
}

resource "azurerm_resource_group" "rg" {
  name     = var.resource_group_name
  location = var.resource_group_location != "" ? var.resource_group_location : var.location
}

data "azurerm_client_config" "current" {}

# ──────────────────────────────────────────────
# Virtual Network
# ──────────────────────────────────────────────
resource "azurerm_virtual_network" "vnet" {
  name                = local.vnet_name
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  address_space       = [var.vnet_address_prefix]
}

resource "azurerm_subnet" "app_service_integration" {
  name                 = local.app_service_integration_subnet
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = [var.app_service_integration_subnet_prefix]

  delegation {
    name = "webapp-delegation"
    service_delegation {
      name = "Microsoft.Web/serverFarms"
    }
  }
}

resource "azurerm_subnet" "private_endpoints" {
  name                              = local.private_endpoint_subnet
  resource_group_name               = azurerm_resource_group.rg.name
  virtual_network_name              = azurerm_virtual_network.vnet.name
  address_prefixes                  = [var.private_endpoint_subnet_prefix]
  private_endpoint_network_policies = "Disabled"
}

# ──────────────────────────────────────────────
# Log Analytics & Application Insights
# ──────────────────────────────────────────────
resource "azurerm_log_analytics_workspace" "law" {
  name                = local.log_analytics_name
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

resource "azurerm_application_insights" "ai" {
  name                = local.app_insights_name
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  application_type    = "web"
  workspace_id        = azurerm_log_analytics_workspace.law.id
}

# ──────────────────────────────────────────────
# Storage Account (Function App)
# ──────────────────────────────────────────────
resource "azurerm_storage_account" "function_storage" {
  count                           = local.use_existing_worker_storage_account ? 0 : 1
  name                            = local.function_storage_name
  location                        = var.location
  resource_group_name             = azurerm_resource_group.rg.name
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  account_kind                    = "StorageV2"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = false
  access_tier                     = "Hot"
}

data "azurerm_storage_account" "function_storage" {
  count               = local.use_existing_worker_storage_account ? 1 : 0
  name                = local.effective_worker_storage_name
  resource_group_name = local.effective_worker_storage_resource_group_name
}

# ──────────────────────────────────────────────
# App Service Plans
# ──────────────────────────────────────────────
resource "azurerm_service_plan" "web" {
  name                = local.app_service_plan_name
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  os_type             = "Windows"
  sku_name            = "P1v3"
}

resource "azurerm_service_plan" "worker" {
  name                = local.worker_plan_name
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  os_type             = "Windows"
  sku_name            = "B1"
}

# ──────────────────────────────────────────────
# Web App
# ──────────────────────────────────────────────
resource "azurerm_windows_web_app" "web" {
  name                      = local.web_app_name
  location                  = var.location
  resource_group_name       = azurerm_resource_group.rg.name
  service_plan_id           = azurerm_service_plan.web.id
  https_only                = true
  virtual_network_subnet_id = azurerm_subnet.app_service_integration.id

  identity {
    type = "SystemAssigned"
  }

  site_config {
    ftps_state             = "Disabled"
    minimum_tls_version    = "1.2"
    http2_enabled          = true
    vnet_route_all_enabled = true
  }

  depends_on = [
    azurerm_key_vault_secret.ingest_api_key,
    azurerm_key_vault_secret.session_secret,
    azurerm_key_vault_secret.worker_shared_secret,
    azurerm_key_vault_secret.entra_client_secret,
  ]

  app_settings = {
    "APPLICATIONINSIGHTS_CONNECTION_STRING" = azurerm_application_insights.ai.connection_string
    "Dashboard__Mode"                       = "MVP"
    "SQL_SERVER"                            = local.effective_sql_server_fqdn
    "SQL_DATABASE"                          = local.effective_sql_database_name
    "SQL_AUTH_MODE"                         = "managed-identity"
    "CAPACITY_WORKER_BASE_URL"              = "https://${azurerm_windows_function_app.worker.default_hostname}"
    "CAPACITY_RECOMMEND_USE_DIRECT_API"     = "true"
    "CAPACITY_RECOMMEND_SUBSCRIPTION_ID"    = data.azurerm_client_config.current.subscription_id
    "CAPACITY_RECOMMEND_WORKER_TIMEOUT_MS"  = "180000"
    "CAPACITY_WORKER_SHARED_SECRET"         = local.worker_shared_secret_key_vault_reference
    "INGEST_API_KEY"                        = local.ingest_api_key_key_vault_reference
    "SESSION_SECRET"                        = local.session_secret_key_vault_reference
    "QUOTA_MANAGEMENT_GROUP_ID"             = var.quota_management_group_id
    "INGEST_MANAGEMENT_GROUP_NAMES"         = join(",", var.web_reader_management_group_names)
    "NODE_ENV"                              = "production"
    "WEBSITE_NODE_DEFAULT_VERSION"          = "~20"
    "WEBSITE_DNS_SERVER"                    = "168.63.129.16"
    "AUTH_ENABLED"                          = tostring(var.auth_enabled)
    "ENTRA_TENANT_ID"                       = var.entra_tenant_id
    "ENTRA_CLIENT_ID"                       = var.entra_client_id
    "ENTRA_CLIENT_SECRET"                   = local.entra_client_secret_key_vault_reference
    "AUTH_REDIRECT_URI"                     = local.effective_auth_redirect_uri
    "ADMIN_GROUP_ID"                        = var.admin_group_id
    "SESSION_STORE_SQL_ENABLED"             = var.auth_enabled ? "true" : "false"
    "SCM_DO_BUILD_DURING_DEPLOYMENT"        = "true"
  }
}

module "dashboard_web_redirect_uris" {
  count  = var.manage_entra_web_redirect_uri && var.auth_enabled && var.entra_client_id != "" ? 1 : 0
  source = "./modules/dashboard-web-redirect-uris"

  client_id              = var.entra_client_id
  generated_redirect_uri = local.effective_auth_redirect_uri
  extra_redirect_uris    = var.extra_entra_web_redirect_uris

  depends_on = [azurerm_windows_web_app.web]
}

# ──────────────────────────────────────────────
# Function App (Worker)
# ──────────────────────────────────────────────
resource "azurerm_windows_function_app" "worker" {
  name                          = local.function_app_name
  location                      = var.location
  resource_group_name           = azurerm_resource_group.rg.name
  service_plan_id               = azurerm_service_plan.worker.id
  storage_account_name          = local.effective_worker_storage_name
  storage_uses_managed_identity = true
  https_only                    = true
  virtual_network_subnet_id     = azurerm_subnet.app_service_integration.id

  identity {
    type = "SystemAssigned"
  }

  site_config {
    ftps_state          = "Disabled"
    minimum_tls_version = "1.2"
    http2_enabled       = true
    always_on           = true
    application_stack {
      powershell_core_version = "7.4"
    }
    vnet_route_all_enabled = true
  }

  depends_on = [
    azurerm_key_vault_secret.worker_shared_secret,
  ]

  app_settings = {
    "APPLICATIONINSIGHTS_CONNECTION_STRING" = azurerm_application_insights.ai.connection_string
    "FUNCTIONS_EXTENSION_VERSION"           = "~4"
    "FUNCTIONS_WORKER_RUNTIME"              = "powershell"
    "WEBSITE_RUN_FROM_PACKAGE"              = "1"
    "WEBSITE_DNS_SERVER"                    = "168.63.129.16"
    "WORKER_SHARED_SECRET"                  = local.worker_shared_secret_key_vault_reference
  }
}

# ──────────────────────────────────────────────
# Key Vault
# ──────────────────────────────────────────────
resource "azurerm_key_vault" "kv" {
  count                         = local.use_existing_key_vault ? 0 : 1
  name                          = local.key_vault_name
  location                      = var.location
  resource_group_name           = azurerm_resource_group.rg.name
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "standard"
  enable_rbac_authorization     = true
  soft_delete_retention_days    = 90
  purge_protection_enabled      = false
  public_network_access_enabled = var.key_vault_public_network_access == "Enabled"
}

data "azurerm_key_vault" "kv" {
  count               = local.use_existing_key_vault ? 1 : 0
  name                = local.effective_key_vault_name
  resource_group_name = local.effective_key_vault_resource_group_name
}

resource "azurerm_key_vault_secret" "ingest_api_key" {
  name         = local.ingest_api_key_secret_name
  value        = var.ingest_api_key
  key_vault_id = local.effective_key_vault_id
}

resource "azurerm_key_vault_secret" "session_secret" {
  name         = local.session_secret_secret_name
  value        = var.session_secret
  key_vault_id = local.effective_key_vault_id
}

resource "azurerm_key_vault_secret" "worker_shared_secret" {
  count        = var.worker_shared_secret != "" ? 1 : 0
  name         = local.worker_shared_secret_secret_name
  value        = var.worker_shared_secret
  key_vault_id = local.effective_key_vault_id
}

resource "azurerm_key_vault_secret" "entra_client_secret" {
  count        = var.entra_client_secret != "" ? 1 : 0
  name         = local.entra_client_secret_secret_name
  value        = var.entra_client_secret
  key_vault_id = local.effective_key_vault_id
}

# ──────────────────────────────────────────────
# SQL Server & Database
# ──────────────────────────────────────────────
resource "azurerm_mssql_server" "sql" {
  count                         = local.use_existing_sql_server ? 0 : 1
  name                          = local.sql_server_name
  resource_group_name           = azurerm_resource_group.rg.name
  location                      = var.location
  version                       = "12.0"
  minimum_tls_version           = "1.2"
  public_network_access_enabled = var.sql_public_network_access == "Enabled"

  azuread_administrator {
    login_username              = var.sql_entra_admin_login
    object_id                   = var.sql_entra_admin_object_id
    tenant_id                   = data.azurerm_client_config.current.tenant_id
    azuread_authentication_only = true
  }
}

data "azurerm_mssql_server" "sql" {
  count               = local.use_existing_sql_server ? 1 : 0
  name                = local.effective_sql_server_name
  resource_group_name = local.effective_sql_server_resource_group_name
}

resource "azurerm_mssql_database" "db" {
  count     = local.use_existing_sql_database ? 0 : 1
  name      = local.sql_database_name
  server_id = local.use_existing_sql_server ? data.azurerm_mssql_server.sql[0].id : azurerm_mssql_server.sql[0].id
  sku_name  = "S0"
  collation = "SQL_Latin1_General_CP1_CI_AS"
}

# ──────────────────────────────────────────────
# SQL Private Endpoint & DNS
# ──────────────────────────────────────────────
resource "azurerm_private_dns_zone" "sql" {
  count               = local.use_existing_sql_server ? 0 : 1
  name                = local.sql_private_dns_zone_name
  resource_group_name = azurerm_resource_group.rg.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "sql" {
  count                 = local.use_existing_sql_server ? 0 : 1
  name                  = local.sql_private_dns_zone_vnet_link
  resource_group_name   = azurerm_resource_group.rg.name
  private_dns_zone_name = azurerm_private_dns_zone.sql[0].name
  virtual_network_id    = azurerm_virtual_network.vnet.id
  registration_enabled  = false
}

resource "azurerm_private_endpoint" "sql" {
  count               = local.use_existing_sql_server ? 0 : 1
  name                = local.sql_private_endpoint_name
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  subnet_id           = azurerm_subnet.private_endpoints.id

  private_service_connection {
    name                           = "sqlServerConnection"
    private_connection_resource_id = azurerm_mssql_server.sql[0].id
    subresource_names              = ["sqlServer"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [azurerm_private_dns_zone.sql[0].id]
  }
}

# ──────────────────────────────────────────────
# Key Vault Private Endpoint & DNS
# ──────────────────────────────────────────────
resource "azurerm_private_dns_zone" "kv" {
  count               = local.use_existing_key_vault ? 0 : 1
  name                = local.kv_private_dns_zone_name
  resource_group_name = azurerm_resource_group.rg.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "kv" {
  count                 = local.use_existing_key_vault ? 0 : 1
  name                  = local.kv_private_dns_zone_vnet_link
  resource_group_name   = azurerm_resource_group.rg.name
  private_dns_zone_name = azurerm_private_dns_zone.kv[0].name
  virtual_network_id    = azurerm_virtual_network.vnet.id
  registration_enabled  = false
}

resource "azurerm_private_endpoint" "kv" {
  count               = local.use_existing_key_vault ? 0 : 1
  name                = local.kv_private_endpoint_name
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  subnet_id           = azurerm_subnet.private_endpoints.id

  private_service_connection {
    name                           = "keyVaultConnection"
    private_connection_resource_id = azurerm_key_vault.kv[0].id
    subresource_names              = ["vault"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [azurerm_private_dns_zone.kv[0].id]
  }
}

# ──────────────────────────────────────────────
# Role Assignments – Key Vault Secrets User
# ──────────────────────────────────────────────
resource "azurerm_role_assignment" "web_to_kv" {
  scope                = local.use_existing_key_vault ? data.azurerm_key_vault.kv[0].id : azurerm_key_vault.kv[0].id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_windows_web_app.web.identity[0].principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_role_assignment" "worker_to_kv" {
  scope                = local.use_existing_key_vault ? data.azurerm_key_vault.kv[0].id : azurerm_key_vault.kv[0].id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_windows_function_app.worker.identity[0].principal_id
  principal_type       = "ServicePrincipal"
}

# ──────────────────────────────────────────────
# Role Assignments – Function Storage (Blob, Queue, Table)
# ──────────────────────────────────────────────
resource "azurerm_role_assignment" "worker_storage_blob" {
  scope                = local.use_existing_worker_storage_account ? data.azurerm_storage_account.function_storage[0].id : azurerm_storage_account.function_storage[0].id
  role_definition_name = "Storage Blob Data Owner"
  principal_id         = azurerm_windows_function_app.worker.identity[0].principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_role_assignment" "worker_storage_queue" {
  scope                = local.use_existing_worker_storage_account ? data.azurerm_storage_account.function_storage[0].id : azurerm_storage_account.function_storage[0].id
  role_definition_name = "Storage Queue Data Contributor"
  principal_id         = azurerm_windows_function_app.worker.identity[0].principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_role_assignment" "worker_storage_table" {
  scope                = local.use_existing_worker_storage_account ? data.azurerm_storage_account.function_storage[0].id : azurerm_storage_account.function_storage[0].id
  role_definition_name = "Storage Table Data Contributor"
  principal_id         = azurerm_windows_function_app.worker.identity[0].principal_id
  principal_type       = "ServicePrincipal"
}

# ──────────────────────────────────────────────
# Cross-subscription RBAC modules
# ──────────────────────────────────────────────
module "worker_subscription_rbac" {
  source   = "./modules/worker-subscription-rbac"
  for_each = toset(var.worker_subscription_rbac_subscription_ids)

  subscription_id                     = each.value
  principal_id                        = azurerm_windows_function_app.worker.identity[0].principal_id
  assign_compute_recommendations_role = var.assign_worker_compute_recommendations_role
  assign_cost_management_reader_role  = var.assign_worker_cost_management_reader_role
  assign_billing_reader_role          = var.assign_worker_billing_reader_role
}

module "worker_management_group_rbac" {
  source   = "./modules/worker-management-group-rbac"
  for_each = toset(var.worker_rbac_management_group_names)

  management_group_name               = each.value
  principal_id                        = azurerm_windows_function_app.worker.identity[0].principal_id
  assign_compute_recommendations_role = var.assign_worker_compute_recommendations_role
  assign_cost_management_reader_role  = var.assign_worker_cost_management_reader_role
  assign_billing_reader_role          = var.assign_worker_billing_reader_role
}

module "web_subscription_reader" {
  source   = "./modules/web-subscription-reader"
  for_each = toset(var.web_reader_subscription_ids)

  subscription_id = each.value
  principal_id    = azurerm_windows_web_app.web.identity[0].principal_id
}

module "web_management_group_reader" {
  source   = "./modules/web-management-group-reader"
  for_each = toset(var.web_reader_management_group_names)

  management_group_name = each.value
  principal_id          = azurerm_windows_web_app.web.identity[0].principal_id
}

module "web_subscription_quota_writer" {
  source   = "./modules/web-subscription-quota-writer"
  for_each = toset(var.web_quota_writer_subscription_ids)

  subscription_id = each.value
  principal_id    = azurerm_windows_web_app.web.identity[0].principal_id
}

module "web_management_group_quota_writer" {
  source   = "./modules/web-management-group-quota-writer"
  for_each = toset(var.web_quota_writer_management_group_names)

  management_group_name = each.value
  principal_id          = azurerm_windows_web_app.web.identity[0].principal_id
}
