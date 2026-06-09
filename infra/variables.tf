variable "location" {
  type        = string
  description = "Location for all resources"
  default     = "centralus"
}

variable "environment" {
  type        = string
  description = "Environment short name (dev, test, prod)"
  default     = "dev"
  validation {
    condition     = contains(["dev", "test", "prod"], var.environment)
    error_message = "Environment must be one of: dev, test, prod."
  }
}

variable "workload_suffix" {
  type        = string
  description = "Unique workload suffix (lowercase, 3-12 chars)"
  default     = "demo001"
  validation {
    condition     = length(var.workload_suffix) >= 3 && length(var.workload_suffix) <= 12
    error_message = "workload_suffix must be 3-12 characters."
  }
}

variable "sql_entra_admin_login" {
  type        = string
  description = "Microsoft Entra administrator UPN for Azure SQL"
}

variable "sql_entra_admin_object_id" {
  type        = string
  description = "Microsoft Entra administrator object ID for Azure SQL"
}

variable "vnet_address_prefix" {
  type        = string
  description = "Address prefix for the virtual network"
  default     = "10.90.0.0/16"
}

variable "app_service_integration_subnet_prefix" {
  type        = string
  description = "Address prefix for the App Service integration subnet"
  default     = "10.90.1.0/24"
}

variable "private_endpoint_subnet_prefix" {
  type        = string
  description = "Address prefix for the private endpoint subnet"
  default     = "10.90.2.0/24"
}

variable "existing_virtual_network_name" {
  type        = string
  description = "Existing virtual network name to reuse"
  default     = ""
}

variable "existing_virtual_network_resource_group_name" {
  type        = string
  description = "Resource group that contains the existing virtual network; defaults to the deployment resource group when empty"
  default     = ""
}

variable "existing_app_service_integration_subnet_name" {
  type        = string
  description = "Existing subnet delegated to Microsoft.Web/serverFarms for App Service integration"
  default     = ""
}

variable "existing_private_endpoint_subnet_name" {
  type        = string
  description = "Existing subnet for SQL and Key Vault private endpoints"
  default     = ""
}

variable "sql_public_network_access" {
  type        = string
  description = "SQL server public network access mode"
  default     = "Disabled"
  validation {
    condition     = contains(["Enabled", "Disabled"], var.sql_public_network_access)
    error_message = "Must be Enabled or Disabled."
  }
}

variable "key_vault_public_network_access" {
  type        = string
  description = "Key Vault public network access mode"
  default     = "Disabled"
  validation {
    condition     = contains(["Enabled", "Disabled"], var.key_vault_public_network_access)
    error_message = "Must be Enabled or Disabled."
  }
}

variable "function_public_network_access" {
  type        = string
  description = "Function App public network access mode. Keep Disabled when create_function_private_endpoint is true so worker ingress stays private."
  default     = "Disabled"
  validation {
    condition     = contains(["Enabled", "Disabled"], var.function_public_network_access)
    error_message = "Must be Enabled or Disabled."
  }
}

variable "worker_storage_public_network_access" {
  type        = string
  description = "Function worker storage account public network access mode. Keep Disabled when create_worker_storage_private_endpoints is true so the worker host storage path stays private."
  default     = "Disabled"
  validation {
    condition     = contains(["Enabled", "Disabled"], var.worker_storage_public_network_access)
    error_message = "Must be Enabled or Disabled."
  }
}

variable "create_function_private_endpoint" {
  type        = bool
  description = "Create a private endpoint and private DNS zone for the worker Function App. Recommended for production and security-reviewed environments."
  default     = true
}

variable "create_worker_storage_private_endpoints" {
  type        = bool
  description = "Create private endpoints and private DNS zones for the worker Function App host storage account. Recommended for production and security-reviewed environments."
  default     = true
}

variable "function_private_dns_zone_name" {
  type        = string
  description = "Private DNS zone name for Function App private endpoints"
  default     = "privatelink.azurewebsites.net"
}

variable "worker_shared_secret" {
  type        = string
  description = "Optional shared secret between dashboard web app and worker function app"
  default     = ""
  sensitive   = true
}

variable "ingest_api_key" {
  type        = string
  description = "Shared secret for internal bootstrap and ingestion routes on the dashboard web app. Leave empty to generate one with Terraform."
  default     = ""
  sensitive   = true
}

variable "session_secret" {
  type        = string
  description = "Session secret used by the dashboard web app session middleware. Leave empty to generate one with Terraform."
  default     = ""
  sensitive   = true
}

variable "web_reader_subscription_ids" {
  type        = list(string)
  description = "Subscription IDs where the web app managed identity should receive Reader access"
  default     = []
}

variable "web_quota_writer_subscription_ids" {
  type        = list(string)
  description = "Subscription IDs where the web app managed identity should receive GroupQuota Request Operator"
  default     = []
}

variable "quota_management_group_id" {
  type        = string
  description = "Optional management group ID for quota discovery UI"
  default     = ""
}

variable "worker_subscription_rbac_subscription_ids" {
  type        = list(string)
  description = "Subscription IDs where the worker managed identity should receive RBAC roles"
  default     = []
}

variable "assign_worker_compute_recommendations_role" {
  type        = bool
  description = "Assign Compute Recommendations Role on worker RBAC subscriptions"
  default     = true
}

variable "assign_worker_cost_management_reader_role" {
  type        = bool
  description = "Assign Cost Management Reader on worker RBAC subscriptions"
  default     = true
}

variable "assign_worker_billing_reader_role" {
  type        = bool
  description = "Assign Billing Reader on worker RBAC subscriptions"
  default     = true
}

variable "auth_enabled" {
  type        = bool
  description = "Enable Microsoft Entra sign-in for the dashboard app routes"
  default     = true
}

variable "web_easy_auth_enabled" {
  type        = bool
  description = "Enable App Service Authentication / Easy Auth on the dashboard Web App"
  default     = false
}

variable "web_easy_auth_allowed_client_applications" {
  type        = list(string)
  description = "Client application IDs allowed by Web App Easy Auth for bearer-authenticated API/internal calls"
  default     = []
}

variable "web_easy_auth_allowed_audiences" {
  type        = list(string)
  description = "Optional explicit Web App Easy Auth token audiences"
  default     = []
}

variable "ingest_api_key_enabled" {
  type        = bool
  description = "Allow x-ingest-key fallback for internal routes"
  default     = true
}

variable "worker_auth_mode" {
  type        = string
  description = "Dashboard-to-worker authentication mode"
  default     = "shared-secret"
  validation {
    condition     = contains(["shared-secret", "entra"], var.worker_auth_mode)
    error_message = "worker_auth_mode must be shared-secret or entra."
  }
}

variable "function_easy_auth_enabled" {
  type        = bool
  description = "Enable App Service Authentication / Easy Auth on the worker Function App"
  default     = false
}

variable "worker_auth_client_id" {
  type        = string
  description = "Microsoft Entra application client ID used by worker Function App Easy Auth"
  default     = ""
}

variable "worker_auth_token_audience" {
  type        = string
  description = "Token audience used by the dashboard Web App for worker Function App calls"
  default     = ""
}

variable "function_easy_auth_allowed_client_applications" {
  type        = list(string)
  description = "Client application IDs allowed by Function App Easy Auth"
  default     = []
}

variable "function_easy_auth_allowed_audiences" {
  type        = list(string)
  description = "Optional explicit Function App Easy Auth token audiences"
  default     = []
}

variable "entra_tenant_id" {
  type        = string
  description = "Microsoft Entra tenant ID for the dashboard auth flow"
  default     = ""
}

variable "entra_client_id" {
  type        = string
  description = "Microsoft Entra application (client) ID for the dashboard auth flow"
  default     = ""
}

variable "entra_client_secret" {
  type        = string
  description = "Microsoft Entra application client secret for the dashboard auth flow"
  default     = ""
  sensitive   = true
}

variable "auth_redirect_uri" {
  type        = string
  description = "Optional redirect URI for the dashboard auth callback"
  default     = ""
}

variable "admin_group_id" {
  type        = string
  description = "Optional Entra group object ID for admin access in the dashboard"
  default     = ""
}

variable "resource_group_name" {
  type        = string
  description = "Name of the existing resource group to deploy into"
  default     = "rg-capacity-dashboard-dev"
}

variable "admin_ssh_public_key" {
  type        = string
  description = "Unused – declared to suppress TFC workspace warning from stale tfvars."
  default     = ""
}
