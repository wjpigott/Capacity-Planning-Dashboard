variable "principal_id" {
  type        = string
  description = "Principal ID of the worker managed identity that requires RBAC access."
}

variable "management_group_name" {
  type        = string
  description = "Target management group name for the worker RBAC role assignments."
}

variable "assign_compute_recommendations_role" {
  type        = bool
  description = "Assign Compute Recommendations Role on the target management group."
}

variable "assign_cost_management_reader_role" {
  type        = bool
  description = "Assign Cost Management Reader on the target management group."
}

variable "assign_billing_reader_role" {
  type        = bool
  description = "Assign Billing Reader on the target management group."
}