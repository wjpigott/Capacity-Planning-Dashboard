param(
    [Parameter(Mandatory = $true)][string[]]$ManagementGroupNames,
    [Parameter(Mandatory = $false)][string]$WebPrincipalId,
    [Parameter(Mandatory = $false)][string]$WorkerPrincipalId,
    [Parameter(Mandatory = $false)][bool]$AssignWebReader = $true,
    [Parameter(Mandatory = $false)][bool]$AssignWebQuotaWriter = $true,
    [Parameter(Mandatory = $false)][bool]$AssignWorkerComputeRecommendationsRole = $true,
    [Parameter(Mandatory = $false)][bool]$AssignWorkerCostManagementReaderRole = $true,
    [Parameter(Mandatory = $false)][bool]$AssignWorkerBillingReaderRole = $true,
    [Parameter(Mandatory = $false)][switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

$roleDefinitions = @{
    Reader = 'acdd72a7-3385-48ef-bd42-f606fba81ae7'
    GroupQuotaRequestOperator = 'e2217c0e-04bb-4724-9580-91cf9871bc01'
    ComputeRecommendationsRole = 'e82342c9-ac7f-422b-af64-e426d2e12b2d'
    CostManagementReader = '72fafb9e-0641-4937-9268-a91bfd8191a3'
    BillingReader = 'fa23ad8b-c56e-40d8-ac0c-ce449e1d2c64'
}

function Test-CommandAvailable([string]$CommandName) {
    return $null -ne (Get-Command $CommandName -ErrorAction SilentlyContinue)
}

function Ensure-ManagementGroupRoleAssignment([string]$ManagementGroupName, [string]$PrincipalId, [string]$RoleName, [string]$RoleDefinitionId) {
    if ([string]::IsNullOrWhiteSpace($PrincipalId)) {
        throw "Principal ID is required before assigning $RoleName at management group '$ManagementGroupName'."
    }

    $scope = "/providers/Microsoft.Management/managementGroups/$ManagementGroupName"
    $existing = az role assignment list --assignee $PrincipalId --role $RoleDefinitionId --scope $scope --query '[0].id' --output tsv 2>$null
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($existing)) {
        Write-Host "Exists  $RoleName for principal $PrincipalId at $scope" -ForegroundColor DarkGray
        return
    }

    if ($WhatIf) {
        Write-Host "WhatIf  $RoleName for principal $PrincipalId at $scope" -ForegroundColor Yellow
        return
    }

    $createOutput = az role assignment create `
        --assignee-object-id $PrincipalId `
        --assignee-principal-type ServicePrincipal `
        --role $RoleDefinitionId `
        --scope $scope `
        --output none 2>&1

    if ($LASTEXITCODE -ne 0) {
        $createOutputText = ($createOutput | Out-String).Trim()
        if ($createOutputText -match 'RoleAssignmentExists') {
            Write-Host "Exists  $RoleName for principal $PrincipalId at $scope" -ForegroundColor DarkGray
            return
        }

        throw "Failed to assign $RoleName for principal $PrincipalId at $scope. Run this script with an identity that has Owner or User Access Administrator at that management group."
    }

    Write-Host "Created $RoleName for principal $PrincipalId at $scope" -ForegroundColor Green
}

if (-not (Test-CommandAvailable 'az')) {
    throw 'Azure CLI was not found on PATH. Install Azure CLI and run az login before assigning RBAC.'
}

$account = az account show --query '{name:name,id:id,tenantId:tenantId,user:user.name}' --output json 2>$null | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $null -eq $account) {
    throw 'Azure CLI is not logged in. Run az login with an identity that has Owner or User Access Administrator at the target management group.'
}

Write-Host "Azure CLI account: $($account.name) / $($account.id) / $($account.user)" -ForegroundColor Cyan

foreach ($managementGroupName in @($ManagementGroupNames | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)) {
    if ($AssignWebReader) {
        Ensure-ManagementGroupRoleAssignment -ManagementGroupName $managementGroupName -PrincipalId $WebPrincipalId -RoleName 'Reader' -RoleDefinitionId $roleDefinitions.Reader
    }

    if ($AssignWebQuotaWriter) {
        Ensure-ManagementGroupRoleAssignment -ManagementGroupName $managementGroupName -PrincipalId $WebPrincipalId -RoleName 'GroupQuota Request Operator' -RoleDefinitionId $roleDefinitions.GroupQuotaRequestOperator
    }

    if ($AssignWorkerComputeRecommendationsRole) {
        Ensure-ManagementGroupRoleAssignment -ManagementGroupName $managementGroupName -PrincipalId $WorkerPrincipalId -RoleName 'Compute Recommendations Role' -RoleDefinitionId $roleDefinitions.ComputeRecommendationsRole
    }

    if ($AssignWorkerCostManagementReaderRole) {
        Ensure-ManagementGroupRoleAssignment -ManagementGroupName $managementGroupName -PrincipalId $WorkerPrincipalId -RoleName 'Cost Management Reader' -RoleDefinitionId $roleDefinitions.CostManagementReader
    }

    if ($AssignWorkerBillingReaderRole) {
        Ensure-ManagementGroupRoleAssignment -ManagementGroupName $managementGroupName -PrincipalId $WorkerPrincipalId -RoleName 'Billing Reader' -RoleDefinitionId $roleDefinitions.BillingReader
    }
}

Write-Host 'Management group RBAC processing complete.' -ForegroundColor Cyan
