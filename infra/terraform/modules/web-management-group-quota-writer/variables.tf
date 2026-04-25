variable "principal_id" {
  type        = string
  description = "Principal ID of the dashboard web app managed identity that requires GroupQuota Request Operator access."
}

variable "management_group_name" {
  type        = string
  description = "Target management group name for the GroupQuota Request Operator role assignment."
}