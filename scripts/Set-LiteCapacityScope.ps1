[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ResourceGroupName,
    [Parameter(Mandatory = $true)][string]$FunctionAppName,
    [Parameter(Mandatory = $false)][string]$SubscriptionIds,
    [Parameter(Mandatory = $false)][string]$ManagementGroupNames,
    [Parameter(Mandatory = $false)][string]$AzureSubscriptionId
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw 'Azure CLI was not found on PATH. Install Azure CLI and run az login first.'
}

if ($AzureSubscriptionId) {
    az account set --subscription $AzureSubscriptionId
    if ($LASTEXITCODE -ne 0) { throw "Failed to select Azure subscription '$AzureSubscriptionId'." }
}

$configuredSubscriptionIds = @($SubscriptionIds -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
$configuredManagementGroups = @($ManagementGroupNames -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
if ($configuredSubscriptionIds.Count -eq 0 -and $configuredManagementGroups.Count -eq 0) {
    throw 'Provide -SubscriptionIds, -ManagementGroupNames, or both.'
}

$workerPrincipalId = az functionapp identity show --resource-group $ResourceGroupName --name $FunctionAppName --query principalId --output tsv
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($workerPrincipalId)) {
    throw "Could not retrieve the managed identity for Function App '$FunctionAppName'."
}

$roleDefinitionIds = @(
    'acdd72a7-3385-48ef-bd42-f606fba81ae7', # Reader
    'e82342c9-ac7f-422b-af64-e426d2e12b2d'  # Compute Recommendations Role
)
$scopes = @($configuredSubscriptionIds | ForEach-Object { "/subscriptions/$_" }) + @($configuredManagementGroups | ForEach-Object { "/providers/Microsoft.Management/managementGroups/$_" })
foreach ($scope in $scopes) {
    foreach ($roleDefinitionId in $roleDefinitionIds) {
        az role assignment create --assignee-object-id $workerPrincipalId --assignee-principal-type ServicePrincipal --role $roleDefinitionId --scope $scope --output none 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Role $roleDefinitionId already exists or could not be created at '$scope'."
        }
    }
}

$subscriptionValue = $configuredSubscriptionIds -join ','
$managementGroupValue = $configuredManagementGroups -join ','
az functionapp config appsettings set --resource-group $ResourceGroupName --name $FunctionAppName --settings "CAPACITY_SUBSCRIPTION_ID=$subscriptionValue" "CAPACITY_MANAGEMENT_GROUP_NAMES=$managementGroupValue" --output none
if ($LASTEXITCODE -ne 0) { throw "Failed to update the scope settings for Function App '$FunctionAppName'." }

[pscustomobject]@{
    FunctionAppName = $FunctionAppName
    WorkerPrincipalId = $workerPrincipalId
    SubscriptionIds = $configuredSubscriptionIds
    ManagementGroupNames = $configuredManagementGroups
    RoleScopes = $scopes
    NextStep = 'Use Refresh Report Data from Capacity Grid or Region Matrix to capture the newly configured scope.'
} | Format-List