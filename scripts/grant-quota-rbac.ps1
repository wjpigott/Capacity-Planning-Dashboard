param(
    [Parameter(Mandatory = $true)][string]$PrincipalObjectId,
    [Parameter(Mandatory = $false)][string]$ManagementGroupId,
    [Parameter(Mandatory = $false)][string[]]$SubscriptionIds = @(),
    [Parameter(Mandatory = $false)][string]$SubscriptionListPath,
    [Parameter(Mandatory = $false)][switch]$AssignManagementGroupRole,
    [Parameter(Mandatory = $false)][switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

function Get-TargetSubscriptionIds {
    $resolved = New-Object System.Collections.Generic.List[string]

    foreach ($subscriptionId in $SubscriptionIds) {
        if (-not [string]::IsNullOrWhiteSpace($subscriptionId)) {
            $resolved.Add($subscriptionId.Trim())
        }
    }

    if ($SubscriptionListPath) {
        Get-Content -Path $SubscriptionListPath | ForEach-Object {
            if (-not [string]::IsNullOrWhiteSpace($_)) {
                $resolved.Add($_.Trim())
            }
        }
    }

    if ($resolved.Count -eq 0 -and $ManagementGroupId) {
        $fromMgmtGroup = az account management-group subscription show-sub-under-mg --name $ManagementGroupId --query "[].name" -o tsv
        foreach ($subscriptionId in $fromMgmtGroup) {
            if (-not [string]::IsNullOrWhiteSpace($subscriptionId)) {
                $resolved.Add($subscriptionId.Trim())
            }
        }
    }

    return @($resolved | Sort-Object -Unique)
}

function Test-RoleAssignmentExists {
    param(
        [Parameter(Mandatory = $true)][string]$Scope
    )

    $existing = az role assignment list --assignee $PrincipalObjectId --scope $Scope --query "[?roleDefinitionName=='GroupQuota Request Operator'] | length(@)" -o tsv
    return ($existing -as [int]) -gt 0
}

function Ensure-QuotaRoleAssignment {
    param(
        [Parameter(Mandatory = $true)][string]$Scope
    )

    if (Test-RoleAssignmentExists -Scope $Scope) {
        Write-Host "Exists  $Scope" -ForegroundColor DarkGray
        return
    }

    if ($WhatIf) {
        Write-Host "WhatIf  $Scope" -ForegroundColor Yellow
        return
    }

    az role assignment create --assignee-object-id $PrincipalObjectId --assignee-principal-type ServicePrincipal --role "GroupQuota Request Operator" --scope $Scope -o none
    Write-Host "Created $Scope" -ForegroundColor Green
}

$targets = @(Get-TargetSubscriptionIds)

if ($AssignManagementGroupRole) {
    if (-not $ManagementGroupId) {
        throw 'ManagementGroupId is required when -AssignManagementGroupRole is used.'
    }

    Ensure-QuotaRoleAssignment -Scope "/providers/Microsoft.Management/managementGroups/$ManagementGroupId"
}

if ($targets.Count -eq 0) {
    throw 'No subscription targets resolved. Provide -SubscriptionIds, -SubscriptionListPath, or -ManagementGroupId.'
}

foreach ($subscriptionId in $targets) {
    Ensure-QuotaRoleAssignment -Scope "/subscriptions/$subscriptionId"
}

Write-Host "Processed $($targets.Count) subscription scope(s)." -ForegroundColor Cyan