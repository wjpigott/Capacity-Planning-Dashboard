variable "principal_id" {
  type        = string
  description = "Principal ID of the dashboard web app managed identity that requires GroupQuota Request Operator access."
}

variable "subscription_id" {
  type        = string
  description = "Target subscription ID for the GroupQuota Request Operator role assignment."
}
