variable "principal_id" {
  type        = string
  description = "Principal ID of the worker managed identity that requires access."
}

variable "subscription_id" {
  type        = string
  description = "Target subscription ID for role assignments."
}

variable "assign_compute_recommendations_role" {
  type        = bool
  description = "Assign Compute Recommendations Role at this subscription scope."
  default     = true
}

variable "assign_cost_management_reader_role" {
  type        = bool
  description = "Assign Cost Management Reader at this subscription scope."
  default     = true
}

variable "assign_billing_reader_role" {
  type        = bool
  description = "Assign Billing Reader at this subscription scope."
  default     = true
}
