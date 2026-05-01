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

variable "worker_shared_secret" {
  type        = string
  description = "Optional shared secret between dashboard web app and worker function app"
  default     = ""
  sensitive   = true
}

variable "ingest_api_key" {
  type        = string
  description = "Shared secret for internal bootstrap and ingestion routes on the dashboard web app"
  default     = "change-me-ingest-key"
  sensitive   = true
}

variable "session_secret" {
  type        = string
  description = "Session secret used by the dashboard web app session middleware"
  default     = "change-me-session-secret"
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
  default     = false
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
