terraform {
  required_providers {
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
  }
}

variable "client_id" {
  type        = string
  description = "Existing Entra application client ID."
}

variable "generated_redirect_uri" {
  type        = string
  description = "Generated dashboard callback URI to preserve on the application registration."
}

variable "extra_redirect_uris" {
  type        = list(string)
  description = "Additional redirect URIs to preserve on the application registration."
  default     = []
}

data "azuread_application" "dashboard" {
  client_id = var.client_id
}

locals {
  existing_redirect_uris = try(tolist(data.azuread_application.dashboard.web[0].redirect_uris), [])
  managed_redirect_uris  = distinct(concat(local.existing_redirect_uris, var.extra_redirect_uris, [var.generated_redirect_uri]))
}

resource "azuread_application_redirect_uris" "dashboard_web" {
  application_id = data.azuread_application.dashboard.id
  type           = "Web"
  redirect_uris  = local.managed_redirect_uris
}