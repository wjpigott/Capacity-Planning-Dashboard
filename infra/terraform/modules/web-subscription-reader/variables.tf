variable "principal_id" {
  type        = string
  description = "Principal ID of the dashboard web app managed identity that requires Reader access."
}

variable "subscription_id" {
  type        = string
  description = "Target subscription ID for the Reader role assignment."
}
