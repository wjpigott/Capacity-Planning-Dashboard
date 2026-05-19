param(
    [Parameter(Mandatory = $false)][ValidateSet('Bicep','Terraform')][string]$Provider = 'Bicep',
    [Parameter(Mandatory = $true)][string]$ResourceGroupName,
    [Parameter(Mandatory = $false)][string]$Location = 'centralus',
    [Parameter(Mandatory = $false)][ValidateSet('dev','test','prod')][string]$Environment = 'dev',
    [Parameter(Mandatory = $true)][string]$WorkloadSuffix,
    [Parameter(Mandatory = $false)][string]$ParameterFile,
    [Parameter(Mandatory = $true)][string]$SqlEntraAdminLogin,
    [Parameter(Mandatory = $true)][string]$SqlEntraAdminObjectId,
    [Parameter(Mandatory = $false)][string]$WorkerSharedSecret,
    [Parameter(Mandatory = $false)][string[]]$WebReaderSubscriptionIds = @(),
    [Parameter(Mandatory = $false)][string[]]$WebReaderManagementGroupNames = @(),
    [Parameter(Mandatory = $false)][string[]]$WebQuotaWriterSubscriptionIds = @(),
    [Parameter(Mandatory = $false)][string[]]$WebQuotaWriterManagementGroupNames = @(),
    [Parameter(Mandatory = $false)][string]$QuotaManagementGroupId,
    [Parameter(Mandatory = $false)][string]$KeyVaultNameOverride,
    [Parameter(Mandatory = $false)][string]$ExistingSqlServerName,
    [Parameter(Mandatory = $false)][string]$ExistingSqlServerResourceGroupName,
    [Parameter(Mandatory = $false)][string]$ExistingSqlDatabaseName,
    [Parameter(Mandatory = $false)][string]$ExistingKeyVaultName,
    [Parameter(Mandatory = $false)][string]$ExistingKeyVaultResourceGroupName,
    [Parameter(Mandatory = $false)][string]$ExistingWorkerStorageAccountName,
    [Parameter(Mandatory = $false)][string]$ExistingWorkerStorageResourceGroupName,
    [Parameter(Mandatory = $false)][string]$ExistingVirtualNetworkName,
    [Parameter(Mandatory = $false)][string]$ExistingVirtualNetworkResourceGroupName,
    [Parameter(Mandatory = $false)][string]$ExistingAppServiceIntegrationSubnetName,
    [Parameter(Mandatory = $false)][string]$ExistingPrivateEndpointSubnetName,
    [Parameter(Mandatory = $false)][string[]]$WorkerRbacSubscriptionIds = @(),
    [Parameter(Mandatory = $false)][string[]]$WorkerRbacManagementGroupNames = @(),
    [Parameter(Mandatory = $false)][bool]$AssignWorkerComputeRecommendationsRole = $true,
    [Parameter(Mandatory = $false)][bool]$AssignWorkerCostManagementReaderRole = $true,
    [Parameter(Mandatory = $false)][bool]$AssignWorkerBillingReaderRole = $true,
    [Parameter(Mandatory = $false)][bool]$AuthEnabled = $true,
    [Parameter(Mandatory = $false)][string]$EntraTenantId,
    [Parameter(Mandatory = $false)][string]$EntraClientId,
    [Parameter(Mandatory = $false)][string]$EntraClientSecret,
    [Parameter(Mandatory = $false)][string]$AuthRedirectUri,
    [Parameter(Mandatory = $false)][switch]$ManageEntraWebRedirectUri,
    [Parameter(Mandatory = $false)][string]$AdminGroupId,
    [Parameter(Mandatory = $false)][string]$ReportViewerGroupIds,
    [Parameter(Mandatory = $false)][bool]$CreateMissingEntraAccessGroups = $false,
    [Parameter(Mandatory = $false)][string]$AdminGroupDisplayName = 'CapacityAdmin',
    [Parameter(Mandatory = $false)][string]$ReportViewerGroupDisplayName = 'CapacityReportViewers',
    [Parameter(Mandatory = $false)][string]$SubscriptionId,
    [Parameter(Mandatory = $false)][switch]$UseAllAccessibleManagementGroups,
    [Parameter(Mandatory = $false)][bool]$RandomizeWorkloadSuffixOnNameConflict = $true,
    [Parameter(Mandatory = $false)][bool]$DeployWebApp = $true,
    [Parameter(Mandatory = $false)][bool]$SkipWebAppTests = $false,
    [Parameter(Mandatory = $false)][bool]$DeployWorkerApp = $true,
    [Parameter(Mandatory = $false)][bool]$ApplyDatabaseBootstrap = $true,
    [Parameter(Mandatory = $false)][string]$IngestApiKey,
    [Parameter(Mandatory = $false)][string]$SessionSecret
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$deployWebAppScript = Join-Path $repoRoot 'deploy-web-app.ps1'
$deployWorkerScript = Join-Path (Join-Path $repoRoot 'scripts') 'deploy-worker.ps1'
$bicepTemplateFile = Join-Path (Join-Path (Join-Path $repoRoot 'infra') 'bicep') 'main.bicep'
$script:ManagementGroupRbacFollowUps = @()
$script:ManagementGroupRbacFollowUpsShown = $false
$webAppName = "app-capdash-$Environment-$WorkloadSuffix"
$functionAppName = "func-capdash-$Environment-$WorkloadSuffix-appsvc"

function Resolve-DeploymentPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }

    $candidatePath = $Path
    if (-not [System.IO.Path]::IsPathRooted($candidatePath)) {
        $candidatePath = Join-Path $repoRoot $candidatePath
    }

    return (Resolve-Path $candidatePath).Path
}

function Invoke-NativeCommandAllowStderr([scriptblock]$Command) {
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $script:ErrorActionPreference = 'Continue'
        return & $Command
    }
    finally {
        $script:ErrorActionPreference = $previousErrorActionPreference
    }
}

function Set-DeploymentResourceNames([string]$Suffix) {
    $script:webAppName = "app-capdash-$Environment-$Suffix"
    $script:functionAppName = "func-capdash-$Environment-$Suffix-appsvc"
}

function Resolve-SqlServerHostName([string]$ServerName) {
    if ([string]::IsNullOrWhiteSpace($ServerName)) {
        return ''
    }

    if ($ServerName.Contains('.')) {
        return $ServerName.Trim()
    }

    return "$($ServerName.Trim()).database.windows.net"
}

function Get-DatabaseBootstrapFailureGuidance([string]$ManualDatabaseInitializeCommand) {
    return "Database bootstrap failed after infrastructure deployment. If Azure SQL blocks the bootstrap connection, change the SQL server networking setting to Selected networks and add your current client IP, then rerun the database bootstrap. You can also skip database bootstrap during deployment and run the scripts later from an Azure-connected host. Manual command: $ManualDatabaseInitializeCommand"
}

function New-WorkloadSuffixWithToken([string]$BaseSuffix) {
    $sanitizedBase = ($BaseSuffix.ToLowerInvariant() -replace '[^a-z0-9-]', '')
    if ([string]::IsNullOrWhiteSpace($sanitizedBase)) {
        $sanitizedBase = 'cap'
    }

    $tokenBytes = New-Object byte[] 3
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($tokenBytes)
    $token = (($tokenBytes | ForEach-Object { $_.ToString('x2') }) -join '')
    $prefixMaxLength = 12 - $token.Length - 1
    $prefix = if ($sanitizedBase.Length -gt $prefixMaxLength) { $sanitizedBase.Substring(0, $prefixMaxLength) } else { $sanitizedBase }
    $prefix = $prefix.Trim('-')
    if ($prefix.Length -lt 3) {
        $prefix = 'cap'
    }

    return "$prefix-$token"
}

function Test-WebSiteNameUsable([string]$Name, [string]$ResourceGroupName) {
    $resourceShowOutput = ''
    $resourceShowExitCode = 0
    try {
        $resourceShowOutput = az resource show --resource-group $ResourceGroupName --resource-type 'Microsoft.Web/sites' --name $Name --query id --output tsv 2>&1
        $resourceShowExitCode = $LASTEXITCODE
    }
    catch {
        $resourceShowOutput = $_.Exception.Message
        $resourceShowExitCode = 1
    }

    if ($resourceShowExitCode -eq 0) {
        return $true
    }

    $resourceShowError = ($resourceShowOutput | Out-String).Trim()
    if (-not [string]::IsNullOrWhiteSpace($resourceShowError) -and $resourceShowError -notmatch 'ResourceNotFound|was not found') {
        Write-Warning "Could not check whether App Service '$Name' already exists in resource group '$ResourceGroupName'. Continuing with global name availability check. Azure CLI error: $resourceShowError"
    }

    try {
        $subscriptionIdForNameCheck = Invoke-NativeCommandAllowStderr { az account show --query id --output tsv 2>$null }
    }
    catch {
        Write-Warning "Could not check App Service name availability for $Name because the current Azure subscription could not be resolved. Continuing with the requested name. Azure CLI error: $($_.Exception.Message)"
        return $true
    }

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($subscriptionIdForNameCheck)) {
        Write-Warning "Could not check App Service name availability for $Name because the current Azure subscription could not be resolved. Continuing with the requested name."
        return $true
    }

    $availabilityRequest = @{
        name = $Name
        type = 'Microsoft.Web/sites'
    } | ConvertTo-Json -Compress

    $availabilityRequestFile = Join-Path $env:TEMP ("capdash-name-availability-{0}.json" -f ([guid]::NewGuid().ToString('N')))
    try {
        Set-Content -Path $availabilityRequestFile -Value $availabilityRequest -Encoding utf8
        $availabilityJson = az rest `
            --method post `
            --url "https://management.azure.com/subscriptions/$($subscriptionIdForNameCheck.Trim())/providers/Microsoft.Web/checknameavailability?api-version=2023-12-01" `
            --headers 'Content-Type=application/json' `
            --body "@$availabilityRequestFile" `
            --output json 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($availabilityJson)) {
            Write-Warning "Could not check App Service name availability for $Name. Continuing with the requested name."
            return $true
        }
    }
    catch {
        Write-Warning "Could not check App Service name availability for $Name. Continuing with the requested name. Azure CLI error: $($_.Exception.Message)"
        return $true
    }
    finally {
        if (Test-Path $availabilityRequestFile) {
            Remove-Item $availabilityRequestFile -Force
        }
    }

    $availability = $availabilityJson | ConvertFrom-Json
    return [bool]$availability.nameAvailable
}

function Resolve-AvailableWorkloadSuffix([string]$RequestedSuffix) {
    Set-DeploymentResourceNames -Suffix $RequestedSuffix
    if ((Test-WebSiteNameUsable -Name $webAppName -ResourceGroupName $ResourceGroupName) -and
        (Test-WebSiteNameUsable -Name $functionAppName -ResourceGroupName $ResourceGroupName)) {
        return $RequestedSuffix
    }

    if (-not $RandomizeWorkloadSuffixOnNameConflict) {
        throw "The requested App Service names $webAppName or $functionAppName are already in use. Choose a different -WorkloadSuffix or enable -RandomizeWorkloadSuffixOnNameConflict."
    }

    Write-Warning "The requested App Service host names are not available. Generating a randomized workload suffix from '$RequestedSuffix'."
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        $candidateSuffix = New-WorkloadSuffixWithToken -BaseSuffix $RequestedSuffix
        Set-DeploymentResourceNames -Suffix $candidateSuffix
        if ((Test-WebSiteNameUsable -Name $webAppName -ResourceGroupName $ResourceGroupName) -and
            (Test-WebSiteNameUsable -Name $functionAppName -ResourceGroupName $ResourceGroupName)) {
            Write-Host "Using randomized workload suffix '$candidateSuffix' for globally unique App Service names."
            return $candidateSuffix
        }
    }

    throw 'Could not find an available App Service name after 10 randomized suffix attempts.'
}

function Get-EntraGroupByDisplayName([string]$DisplayName) {
    $groupOutput = az ad group list --display-name $DisplayName --output json 2>&1
    if ($LASTEXITCODE -ne 0) {
        $errorText = ($groupOutput | Out-String).Trim()
        if ($errorText -match 'NormalizedResponse|msal\.throttled_http_client|msal_http_cache|binary_cache') {
            throw "Could not query Microsoft Entra groups because the local Azure CLI MSAL HTTP cache failed while requesting Microsoft Graph. Run 'az upgrade' if available, delete '%USERPROFILE%\.azure\msal_http_cache.bin', then run 'az login --tenant <tenant-id>' again. Original Azure CLI error: $errorText"
        }

        throw "Could not query Microsoft Entra groups. Verify the current Azure CLI login can read groups or pass explicit -AdminGroupId and -ReportViewerGroupIds values. Original Azure CLI error: $errorText"
    }

    $groupsJson = ($groupOutput | Out-String)
    $groups = @($groupsJson | ConvertFrom-Json)
    return $groups | Where-Object { $_.displayName -eq $DisplayName } | Select-Object -First 1
}

function Resolve-EntraAccessGroupId([string]$DisplayName, [string]$MailNickname, [string]$Purpose) {
    $existingGroup = Get-EntraGroupByDisplayName -DisplayName $DisplayName
    if ($existingGroup -and -not [string]::IsNullOrWhiteSpace($existingGroup.id)) {
        Write-Host "Using existing Entra group '$DisplayName' for $Purpose ($($existingGroup.id))."
        return $existingGroup.id
    }

    if (-not $CreateMissingEntraAccessGroups) {
        throw "Entra group '$DisplayName' was not found and automatic group creation is disabled by default. Ask an Entra administrator to create the group, pass the existing object ID with -AdminGroupId or -ReportViewerGroupIds, or rerun with -CreateMissingEntraAccessGroups `$true if this operator is allowed to create security groups."
    }

    Write-Host "Creating Entra group '$DisplayName'..."
    $groupJson = Invoke-NativeCommandAllowStderr { az ad group create --display-name $DisplayName --mail-nickname $MailNickname --output json 2>$null }
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($groupJson)) {
        throw "Could not create Entra group '$DisplayName'. The current Azure CLI identity may not have permission to create Entra security groups. Ask an Entra administrator to create the group and pass its object ID with -AdminGroupId or -ReportViewerGroupIds, or rerun from an identity with group creation rights."
    }

    $createdGroup = $groupJson | ConvertFrom-Json
    if (-not $createdGroup -or [string]::IsNullOrWhiteSpace($createdGroup.id)) {
        throw "Entra group '$DisplayName' was created but its object ID could not be read."
    }

    Write-Host "Created Entra group '$DisplayName' ($($createdGroup.id))."
    return $createdGroup.id
}

function Test-BicepParameterSupported([string]$ParameterName) {
    $templatePath = Join-Path $repoRoot 'infra\bicep\main.bicep'
    if (-not (Test-Path $templatePath)) {
        return $false
    }

    return [bool](Select-String -Path $templatePath -Pattern ("^\s*param\s+{0}\b" -f [regex]::Escape($ParameterName)) -Quiet)
}

function Test-TerraformVariableSupported([string]$VariableName) {
    $variablesPath = Join-Path $repoRoot 'infra\terraform\variables.tf'
    if (-not (Test-Path $variablesPath)) {
        return $false
    }

    $pattern = '^\s*variable\s+"' + [regex]::Escape($VariableName) + '"'
    return [bool](Select-String -Path $variablesPath -Pattern $pattern -Quiet)
}

function Add-BicepDeploymentParameter([string]$Name, [object]$Value, [switch]$RequiredWhenSet) {
    if (Test-BicepParameterSupported -ParameterName $Name) {
        return @('--parameters', "$Name=$Value")
    }

    $hasMeaningfulValue = $null -ne $Value -and -not [string]::IsNullOrWhiteSpace([string]$Value)
    if ($RequiredWhenSet -and $hasMeaningfulValue) {
        throw "The Bicep template does not support parameter '$Name'. Update infra/bicep/main.bicep before using this deployment option."
    }

    if ($hasMeaningfulValue) {
        Write-Warning "The Bicep template does not support parameter '$Name'. This value will be omitted."
    }

    return @()
}

function Add-TerraformVariable([string]$Name, [object]$Value, [switch]$RequiredWhenSet) {
    if (Test-TerraformVariableSupported -VariableName $Name) {
        return "-var=$Name=$(ConvertTo-TerraformLiteral $Value)"
    }

    $hasMeaningfulValue = $null -ne $Value -and -not [string]::IsNullOrWhiteSpace([string]$Value)
    if ($RequiredWhenSet -and $hasMeaningfulValue) {
        throw "The Terraform module does not support variable '$Name'. Update infra/terraform before using this deployment option."
    }

    if ($hasMeaningfulValue) {
        Write-Warning "The Terraform module does not support variable '$Name'. This value will be omitted."
    }

    return @()
}

function Add-ManagementGroupRoleAssignment([string]$ManagementGroupName, [string]$PrincipalId, [string]$RoleDefinitionId, [string]$RoleName) {
    if ([string]::IsNullOrWhiteSpace($ManagementGroupName) -or [string]::IsNullOrWhiteSpace($PrincipalId)) {
        return
    }

    $scope = "/providers/Microsoft.Management/managementGroups/$ManagementGroupName"
    $existingAssignment = Invoke-NativeCommandAllowStderr { az role assignment list --assignee $PrincipalId --role $RoleDefinitionId --scope $scope --query '[0].id' --output tsv 2>$null }
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($existingAssignment)) {
        Write-Host "RBAC already present: $RoleName for principal $PrincipalId at management group $ManagementGroupName."
        return
    }

    Write-Host "Assigning $RoleName to principal $PrincipalId at management group $ManagementGroupName..."
    $assignmentOutput = az role assignment create --assignee-object-id $PrincipalId --assignee-principal-type ServicePrincipal --role $RoleDefinitionId --scope $scope --output json 2>&1
    if ($LASTEXITCODE -ne 0) {
        $errorText = ($assignmentOutput | Out-String).Trim()
        if ($errorText -match 'RoleAssignmentExists|role assignment already exists') {
            Write-Host "RBAC already present: $RoleName for principal $PrincipalId at management group $ManagementGroupName."
            return
        }

        $script:ManagementGroupRbacFollowUps += [pscustomobject]@{
            ManagementGroupName = $ManagementGroupName
            PrincipalId = $PrincipalId
            RoleDefinitionId = $RoleDefinitionId
            RoleName = $RoleName
            Error = $errorText
        }
        Write-Warning "Could not assign $RoleName at management group '$ManagementGroupName'. Deployment will continue and print follow-up instructions at the end."
    }
}

function Invoke-ManagementGroupRbacAssignments([string]$WebPrincipalId, [string]$WorkerPrincipalId) {
    $hasWebManagementGroupRbac = $WebReaderManagementGroupNames.Count -gt 0 -or $WebQuotaWriterManagementGroupNames.Count -gt 0
    $hasWorkerManagementGroupRbac = $WorkerRbacManagementGroupNames.Count -gt 0

    if ($hasWebManagementGroupRbac -and [string]::IsNullOrWhiteSpace($WebPrincipalId)) {
        $script:ManagementGroupRbacFollowUps += [pscustomobject]@{
            ManagementGroupName = '<selected management groups>'
            PrincipalId = '<web app managed identity principal id was not returned>'
            RoleDefinitionId = '<varies>'
            RoleName = 'Web app management group RBAC'
            Error = 'Infrastructure deployment completed, but the web app managed identity principal ID was not returned.'
        }
        Write-Warning 'Infrastructure deployment completed, but the web app managed identity principal ID was not returned. Deployment will continue; management group RBAC must be applied manually.'
        $hasWebManagementGroupRbac = $false
    }

    if ($hasWorkerManagementGroupRbac -and [string]::IsNullOrWhiteSpace($WorkerPrincipalId)) {
        $script:ManagementGroupRbacFollowUps += [pscustomobject]@{
            ManagementGroupName = '<selected management groups>'
            PrincipalId = '<worker managed identity principal id was not returned>'
            RoleDefinitionId = '<varies>'
            RoleName = 'Worker management group RBAC'
            Error = 'Infrastructure deployment completed, but the worker managed identity principal ID was not returned.'
        }
        Write-Warning 'Infrastructure deployment completed, but the worker managed identity principal ID was not returned. Deployment will continue; management group RBAC must be applied manually.'
        $hasWorkerManagementGroupRbac = $false
    }

    foreach ($managementGroupName in @($WebReaderManagementGroupNames | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)) {
        Add-ManagementGroupRoleAssignment -ManagementGroupName $managementGroupName -PrincipalId $WebPrincipalId -RoleDefinitionId 'acdd72a7-3385-48ef-bd42-f606fba81ae7' -RoleName 'Reader'
    }

    foreach ($managementGroupName in @($WebQuotaWriterManagementGroupNames | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)) {
        Add-ManagementGroupRoleAssignment -ManagementGroupName $managementGroupName -PrincipalId $WebPrincipalId -RoleDefinitionId 'e2217c0e-04bb-4724-9580-91cf9871bc01' -RoleName 'GroupQuota Request Operator'
    }

    foreach ($managementGroupName in @($WorkerRbacManagementGroupNames | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)) {
        if ($AssignWorkerComputeRecommendationsRole) {
            Add-ManagementGroupRoleAssignment -ManagementGroupName $managementGroupName -PrincipalId $WorkerPrincipalId -RoleDefinitionId 'e82342c9-ac7f-422b-af64-e426d2e12b2d' -RoleName 'Compute Recommendations Role'
        }
        if ($AssignWorkerCostManagementReaderRole) {
            Add-ManagementGroupRoleAssignment -ManagementGroupName $managementGroupName -PrincipalId $WorkerPrincipalId -RoleDefinitionId '72fafb9e-0641-4937-9268-a91bfd8191a3' -RoleName 'Cost Management Reader'
        }
        if ($AssignWorkerBillingReaderRole) {
            Add-ManagementGroupRoleAssignment -ManagementGroupName $managementGroupName -PrincipalId $WorkerPrincipalId -RoleDefinitionId 'fa23ad8b-c56e-40d8-ac0c-ce449e1d2c64' -RoleName 'Billing Reader'
        }
    }
}

function Show-ManagementGroupRbacFollowUps() {
    if ($script:ManagementGroupRbacFollowUpsShown -or $script:ManagementGroupRbacFollowUps.Count -eq 0) {
        return
    }

    $script:ManagementGroupRbacFollowUpsShown = $true

    Write-Host ''
    Write-Warning 'Deployment completed, but one or more management group RBAC assignments could not be applied by this identity.'
    Write-Host 'Ask a team with Owner or User Access Administrator on the listed management group scopes to run the matching role assignments.' -ForegroundColor Yellow
    Write-Host 'They can either run the suggested commands below or use scripts/grant-management-group-rbac.ps1 with the listed principal IDs.' -ForegroundColor Yellow

    foreach ($followUp in $script:ManagementGroupRbacFollowUps) {
        Write-Host ''
        Write-Host "Management group: $($followUp.ManagementGroupName)" -ForegroundColor Yellow
        Write-Host "Principal ID: $($followUp.PrincipalId)" -ForegroundColor Yellow
        Write-Host "Role: $($followUp.RoleName) ($($followUp.RoleDefinitionId))" -ForegroundColor Yellow
        if (-not [string]::IsNullOrWhiteSpace($followUp.Error)) {
            Write-Host "Original error: $($followUp.Error)" -ForegroundColor DarkYellow
        }

        if ($followUp.ManagementGroupName -notlike '<*' -and $followUp.PrincipalId -notlike '<*' -and $followUp.RoleDefinitionId -notlike '<*') {
            Write-Host 'Suggested command:' -ForegroundColor Yellow
            Write-Host "az role assignment create --assignee-object-id $($followUp.PrincipalId) --assignee-principal-type ServicePrincipal --role $($followUp.RoleDefinitionId) --scope /providers/Microsoft.Management/managementGroups/$($followUp.ManagementGroupName)" -ForegroundColor Yellow
        }
    }
}

$useExistingSqlServer = -not [string]::IsNullOrWhiteSpace($ExistingSqlServerName)
$useExistingSqlDatabase = -not [string]::IsNullOrWhiteSpace($ExistingSqlDatabaseName)
$useExistingVirtualNetwork = -not [string]::IsNullOrWhiteSpace($ExistingVirtualNetworkName) -or
    -not [string]::IsNullOrWhiteSpace($ExistingAppServiceIntegrationSubnetName) -or
    -not [string]::IsNullOrWhiteSpace($ExistingPrivateEndpointSubnetName)
if ($useExistingSqlDatabase -and -not $useExistingSqlServer) {
    throw '-ExistingSqlDatabaseName requires -ExistingSqlServerName because an existing Azure SQL database must hang off an existing SQL server.'
}

if ($useExistingVirtualNetwork -and (
    [string]::IsNullOrWhiteSpace($ExistingVirtualNetworkName) -or
    [string]::IsNullOrWhiteSpace($ExistingAppServiceIntegrationSubnetName) -or
    [string]::IsNullOrWhiteSpace($ExistingPrivateEndpointSubnetName))) {
    throw '-ExistingVirtualNetworkName, -ExistingAppServiceIntegrationSubnetName, and -ExistingPrivateEndpointSubnetName must be supplied together. -ExistingVirtualNetworkResourceGroupName is optional and defaults to -ResourceGroupName.'
}

if ([string]::IsNullOrWhiteSpace($ExistingSqlServerResourceGroupName)) {
    $ExistingSqlServerResourceGroupName = $ResourceGroupName
}

if ([string]::IsNullOrWhiteSpace($ExistingKeyVaultResourceGroupName)) {
    $ExistingKeyVaultResourceGroupName = $ResourceGroupName
}

if ([string]::IsNullOrWhiteSpace($ExistingWorkerStorageResourceGroupName)) {
    $ExistingWorkerStorageResourceGroupName = $ResourceGroupName
}

if ([string]::IsNullOrWhiteSpace($ExistingVirtualNetworkResourceGroupName)) {
    $ExistingVirtualNetworkResourceGroupName = $ResourceGroupName
}

if ($SubscriptionId) {
    az account set --subscription $SubscriptionId | Out-Null
}

$WorkloadSuffix = Resolve-AvailableWorkloadSuffix -RequestedSuffix $WorkloadSuffix
Set-DeploymentResourceNames -Suffix $WorkloadSuffix

$supportsReportViewerGroupIds = if ($Provider -eq 'Terraform') {
    Test-TerraformVariableSupported -VariableName 'report_viewer_group_ids'
}
else {
    Test-BicepParameterSupported -ParameterName 'reportViewerGroupIds'
}

if ($AuthEnabled) {
    if ([string]::IsNullOrWhiteSpace($AdminGroupId)) {
        $AdminGroupId = Resolve-EntraAccessGroupId -DisplayName $AdminGroupDisplayName -MailNickname ($AdminGroupDisplayName.ToLowerInvariant() -replace '[^a-z0-9]', '') -Purpose 'dashboard admin access'
    }

    if ([string]::IsNullOrWhiteSpace($ReportViewerGroupIds) -and $supportsReportViewerGroupIds) {
        $ReportViewerGroupIds = Resolve-EntraAccessGroupId -DisplayName $ReportViewerGroupDisplayName -MailNickname ($ReportViewerGroupDisplayName.ToLowerInvariant() -replace '[^a-z0-9]', '') -Purpose 'dashboard report viewer access'
    }
    elseif ([string]::IsNullOrWhiteSpace($ReportViewerGroupIds)) {
        Write-Warning 'The current infrastructure template does not support report viewer group IDs. CapacityReportViewers will not be configured by this deployment.'
    }
}

$effectiveSqlServerHostName = if ($useExistingSqlServer) {
    Resolve-SqlServerHostName -ServerName $ExistingSqlServerName
} else {
    Resolve-SqlServerHostName -ServerName "sql-capdash-$Environment-$WorkloadSuffix"
}
$effectiveSqlDatabaseName = if ($useExistingSqlDatabase) { $ExistingSqlDatabaseName } else { "sqldb-capdash-$Environment" }
$manualDatabaseInitializeCommand = ".\scripts\initialize-database.ps1 -SqlServer `"$effectiveSqlServerHostName`" -SqlDatabase `"$effectiveSqlDatabaseName`" -AppIdentityName `"$webAppName`""

function New-GeneratedSecret([int]$ByteCount = 32) {
    $bytes = New-Object byte[] $ByteCount
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes)
}

function Get-SqlAdminAccessToken() {
    $token = Invoke-NativeCommandAllowStderr { az account get-access-token --resource https://database.windows.net/ --query accessToken --output tsv 2>$null }
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($token)) {
        throw 'Could not acquire an Azure SQL access token from the current Azure CLI login.'
    }

    return $token.Trim()
}

function Resolve-WebAppIngestApiKey([string]$ResourceGroupName, [string]$WebAppName, [string]$CurrentIngestApiKey) {
    return Resolve-WebAppSecretSettingValue -ResourceGroupName $ResourceGroupName -WebAppName $WebAppName -SettingName 'INGEST_API_KEY' -CurrentValue $CurrentIngestApiKey -Required
}

function Resolve-KeyVaultReferenceSecretValue([string]$SettingValue) {
    if ([string]::IsNullOrWhiteSpace($SettingValue)) {
        return $SettingValue
    }

    if ($SettingValue -notmatch '^@Microsoft\.KeyVault\((.+)\)$') {
        return $SettingValue
    }

    if ($SettingValue -notmatch 'SecretUri\s*=\s*([^,\)]+)') {
        throw 'The deployed app setting uses an unsupported Key Vault reference format. Expected SecretUri=...'
    }

    $secretUri = $matches[1].Trim().Trim("'").Trim('"')
    $resolvedValue = Invoke-NativeCommandAllowStderr { az keyvault secret show --id $secretUri --query value --output tsv 2>$null }
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($resolvedValue)) {
        throw "Could not resolve the Key Vault secret referenced by $secretUri."
    }

    return $resolvedValue.Trim()
}

function Resolve-WebAppSecretSettingValue(
    [string]$ResourceGroupName,
    [string]$WebAppName,
    [string]$SettingName,
    [string]$CurrentValue,
    [switch]$Required
) {
    if (-not [string]::IsNullOrWhiteSpace($CurrentValue)) {
        return $CurrentValue
    }

    $resolvedSetting = Invoke-NativeCommandAllowStderr { az webapp config appsettings list --resource-group $ResourceGroupName --name $WebAppName --query "[?name=='$SettingName'].value | [0]" --output tsv 2>$null }
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($resolvedSetting)) {
        if ($Required) {
            throw "Could not resolve $SettingName from the deployed web app settings. Pass -$($SettingName.Replace('_', '')) explicitly or verify the app setting exists."
        }

        return $CurrentValue
    }

    return Resolve-KeyVaultReferenceSecretValue -SettingValue $resolvedSetting.Trim()
}

function Resolve-TerraformCommand() {
    $terraform = Get-Command terraform -ErrorAction SilentlyContinue
    if ($terraform) {
        return $terraform.Source
    }

    $candidatePaths = @(
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\Hashicorp.Terraform_Microsoft.Winget.Source_8wekyb3d8bbwe\terraform.exe')
    )

    foreach ($candidatePath in $candidatePaths) {
        if ([string]::IsNullOrWhiteSpace($candidatePath)) {
            continue
        }

        if (Test-Path $candidatePath) {
            return $candidatePath
        }
    }

    return $null
}

function ConvertTo-TerraformLiteral([object]$Value) {
    if ($null -eq $Value) {
        return 'null'
    }

    if ($Value -is [bool]) {
        return $Value.ToString().ToLowerInvariant()
    }

    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        $items = @($Value | ForEach-Object { ConvertTo-TerraformLiteral $_ })
        return "[$($items -join ',')]"
    }

    $stringValue = [string]$Value
    $escapedValue = $stringValue.Replace('\', '\\').Replace('"', '\"')
    return '"' + $escapedValue + '"'
}

function Get-AccessibleManagementGroupNames() {
    try {
        $responseJson = Invoke-NativeCommandAllowStderr { az rest --method get --url 'https://management.azure.com/providers/Microsoft.Management/managementGroups?api-version=2023-04-01' --output json 2>$null }
    }
    catch {
        throw "Could not enumerate accessible management groups from the current Azure CLI login. Choose 'Specify management group names' in the wizard, or pass -WebReaderManagementGroupNames and -WorkerRbacManagementGroupNames explicitly. Azure CLI error: $($_.Exception.Message)"
    }

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($responseJson)) {
        throw "Could not enumerate accessible management groups from the current Azure CLI login. Choose 'Specify management group names' in the wizard, or pass -WebReaderManagementGroupNames and -WorkerRbacManagementGroupNames explicitly."
    }

    $response = $responseJson | ConvertFrom-Json -Depth 20
    if (-not $response -or -not $response.value) {
        return @()
    }

    return @(
        $response.value |
            Where-Object {
                -not [string]::IsNullOrWhiteSpace($_.name) -and
                $_.name -ne $_.properties.tenantId
            } |
            Select-Object -ExpandProperty name -Unique
    )
}

if ($UseAllAccessibleManagementGroups) {
    $accessibleManagementGroupNames = @(Get-AccessibleManagementGroupNames)
    if ($accessibleManagementGroupNames.Count -eq 0) {
        throw 'UseAllAccessibleManagementGroups was specified, but no non-root accessible management groups were found for the current Azure CLI login.'
    }

    if ($WebReaderManagementGroupNames.Count -eq 0) {
        $WebReaderManagementGroupNames = $accessibleManagementGroupNames
    }

    if ($WebQuotaWriterManagementGroupNames.Count -eq 0) {
        $WebQuotaWriterManagementGroupNames = $accessibleManagementGroupNames
    }

    if ($WorkerRbacManagementGroupNames.Count -eq 0) {
        $WorkerRbacManagementGroupNames = $accessibleManagementGroupNames
    }

    if ([string]::IsNullOrWhiteSpace($QuotaManagementGroupId) -and $accessibleManagementGroupNames.Count -eq 1) {
        $QuotaManagementGroupId = $accessibleManagementGroupNames[0]
    }

    Write-Host "Using accessible management groups for deployment: $($accessibleManagementGroupNames -join ', ')"
}

if ([string]::IsNullOrWhiteSpace($IngestApiKey)) {
    $IngestApiKey = Resolve-WebAppSecretSettingValue -ResourceGroupName $ResourceGroupName -WebAppName $webAppName -SettingName 'INGEST_API_KEY' -CurrentValue $IngestApiKey
}

if ([string]::IsNullOrWhiteSpace($SessionSecret)) {
    $SessionSecret = Resolve-WebAppSecretSettingValue -ResourceGroupName $ResourceGroupName -WebAppName $webAppName -SettingName 'SESSION_SECRET' -CurrentValue $SessionSecret
}

if ([string]::IsNullOrWhiteSpace($WorkerSharedSecret)) {
    $WorkerSharedSecret = Resolve-WebAppSecretSettingValue -ResourceGroupName $ResourceGroupName -WebAppName $webAppName -SettingName 'CAPACITY_WORKER_SHARED_SECRET' -CurrentValue $WorkerSharedSecret
}

if ([string]::IsNullOrWhiteSpace($EntraClientSecret)) {
    $EntraClientSecret = Resolve-WebAppSecretSettingValue -ResourceGroupName $ResourceGroupName -WebAppName $webAppName -SettingName 'ENTRA_CLIENT_SECRET' -CurrentValue $EntraClientSecret
}

if ($Provider -ne 'Terraform') {
    if ([string]::IsNullOrWhiteSpace($IngestApiKey)) {
        $IngestApiKey = New-GeneratedSecret
    }

    if ([string]::IsNullOrWhiteSpace($SessionSecret)) {
        $SessionSecret = New-GeneratedSecret
    }
}

if ($Provider -ne 'Terraform') {
    az group create --name $ResourceGroupName --location $Location | Out-Null
}

# ── Terraform deployment path ────────────────────────────────────────────────
function Deploy-Terraform {
    $tfDir = Join-Path (Join-Path $repoRoot 'infra') 'terraform'
    if (-not (Test-Path (Join-Path $tfDir 'main.tf'))) {
        throw "Terraform files not found at $tfDir"
    }

    $terraform = Resolve-TerraformCommand
    if (-not $terraform) {
        throw 'Terraform CLI is required for -Provider Terraform. Install it from https://developer.hashicorp.com/terraform/downloads or add the existing terraform.exe location to PATH.'
    }

    Push-Location $tfDir
    try {
        Write-Host "Running Terraform init..."
        & $terraform init -input=false
        if ($LASTEXITCODE -ne 0) { throw 'terraform init failed' }

        $tfVars = @(
            "-var=location=$Location",
            "-var=environment=$Environment",
            "-var=workload_suffix=$WorkloadSuffix",
            "-var=resource_group_name=$ResourceGroupName",
            "-var=sql_entra_admin_login=$SqlEntraAdminLogin",
            "-var=sql_entra_admin_object_id=$SqlEntraAdminObjectId",
            "-var=assign_worker_compute_recommendations_role=$($AssignWorkerComputeRecommendationsRole.ToString().ToLowerInvariant())",
            "-var=assign_worker_cost_management_reader_role=$($AssignWorkerCostManagementReaderRole.ToString().ToLowerInvariant())",
            "-var=assign_worker_billing_reader_role=$($AssignWorkerBillingReaderRole.ToString().ToLowerInvariant())"
        )

        if (-not [string]::IsNullOrWhiteSpace($IngestApiKey))        { $tfVars += "-var=ingest_api_key=$IngestApiKey" }
        if (-not [string]::IsNullOrWhiteSpace($SessionSecret))       { $tfVars += "-var=session_secret=$SessionSecret" }
        $tfVars += "-var=auth_enabled=$($AuthEnabled.ToString().ToLowerInvariant())"

        if (-not [string]::IsNullOrWhiteSpace($WorkerSharedSecret))    { $tfVars += "-var=worker_shared_secret=$WorkerSharedSecret" }
        if (-not [string]::IsNullOrWhiteSpace($KeyVaultNameOverride))  { $tfVars += "-var=key_vault_name_override=$KeyVaultNameOverride" }
        if (-not [string]::IsNullOrWhiteSpace($QuotaManagementGroupId)){ $tfVars += "-var=quota_management_group_id=$QuotaManagementGroupId" }
        if (-not [string]::IsNullOrWhiteSpace($ExistingSqlServerName))                { $tfVars += "-var=existing_sql_server_name=$ExistingSqlServerName" }
        if (-not [string]::IsNullOrWhiteSpace($ExistingSqlServerResourceGroupName))   { $tfVars += "-var=existing_sql_server_resource_group_name=$ExistingSqlServerResourceGroupName" }
        if (-not [string]::IsNullOrWhiteSpace($ExistingSqlDatabaseName))              { $tfVars += "-var=existing_sql_database_name=$ExistingSqlDatabaseName" }
        if (-not [string]::IsNullOrWhiteSpace($ExistingKeyVaultName))                 { $tfVars += "-var=existing_key_vault_name=$ExistingKeyVaultName" }
        if (-not [string]::IsNullOrWhiteSpace($ExistingKeyVaultResourceGroupName))    { $tfVars += "-var=existing_key_vault_resource_group_name=$ExistingKeyVaultResourceGroupName" }
        if (-not [string]::IsNullOrWhiteSpace($ExistingWorkerStorageAccountName))     { $tfVars += "-var=existing_worker_storage_account_name=$ExistingWorkerStorageAccountName" }
        if (-not [string]::IsNullOrWhiteSpace($ExistingWorkerStorageResourceGroupName)){ $tfVars += "-var=existing_worker_storage_account_resource_group_name=$ExistingWorkerStorageResourceGroupName" }
        if (-not [string]::IsNullOrWhiteSpace($ExistingVirtualNetworkName))           { $tfVars += Add-TerraformVariable -Name 'existing_virtual_network_name' -Value $ExistingVirtualNetworkName -RequiredWhenSet }
        if (-not [string]::IsNullOrWhiteSpace($ExistingVirtualNetworkResourceGroupName)){ $tfVars += Add-TerraformVariable -Name 'existing_virtual_network_resource_group_name' -Value $ExistingVirtualNetworkResourceGroupName }
        if (-not [string]::IsNullOrWhiteSpace($ExistingAppServiceIntegrationSubnetName)){ $tfVars += Add-TerraformVariable -Name 'existing_app_service_integration_subnet_name' -Value $ExistingAppServiceIntegrationSubnetName -RequiredWhenSet }
        if (-not [string]::IsNullOrWhiteSpace($ExistingPrivateEndpointSubnetName))    { $tfVars += Add-TerraformVariable -Name 'existing_private_endpoint_subnet_name' -Value $ExistingPrivateEndpointSubnetName -RequiredWhenSet }
        if (-not [string]::IsNullOrWhiteSpace($EntraTenantId))         { $tfVars += "-var=entra_tenant_id=$EntraTenantId" }
        if (-not [string]::IsNullOrWhiteSpace($EntraClientId))         { $tfVars += "-var=entra_client_id=$EntraClientId" }
        if (-not [string]::IsNullOrWhiteSpace($EntraClientSecret))     { $tfVars += "-var=entra_client_secret=$EntraClientSecret" }
        if (-not [string]::IsNullOrWhiteSpace($AuthRedirectUri))       { $tfVars += "-var=auth_redirect_uri=$AuthRedirectUri" }
        if ($ManageEntraWebRedirectUri.IsPresent)                      { $tfVars += "-var=manage_entra_web_redirect_uri=true" }
        if (-not [string]::IsNullOrWhiteSpace($AdminGroupId))          { $tfVars += "-var=admin_group_id=$AdminGroupId" }
        if (-not [string]::IsNullOrWhiteSpace($ReportViewerGroupIds))  { $tfVars += Add-TerraformVariable -Name 'report_viewer_group_ids' -Value $ReportViewerGroupIds }
        if ($PSBoundParameters.ContainsKey('WebReaderSubscriptionIds') -or $WebReaderSubscriptionIds.Count -gt 0)                   { $tfVars += Add-TerraformVariable -Name 'web_reader_subscription_ids' -Value $WebReaderSubscriptionIds }
        if ($PSBoundParameters.ContainsKey('WebReaderManagementGroupNames') -or $WebReaderManagementGroupNames.Count -gt 0)         { $tfVars += Add-TerraformVariable -Name 'web_reader_management_group_names' -Value $WebReaderManagementGroupNames }
        if ($PSBoundParameters.ContainsKey('WebQuotaWriterSubscriptionIds') -or $WebQuotaWriterSubscriptionIds.Count -gt 0)         { $tfVars += Add-TerraformVariable -Name 'web_quota_writer_subscription_ids' -Value $WebQuotaWriterSubscriptionIds }
        if ($PSBoundParameters.ContainsKey('WebQuotaWriterManagementGroupNames') -or $WebQuotaWriterManagementGroupNames.Count -gt 0){ $tfVars += Add-TerraformVariable -Name 'web_quota_writer_management_group_names' -Value $WebQuotaWriterManagementGroupNames }
        if ($PSBoundParameters.ContainsKey('WorkerRbacSubscriptionIds') -or $WorkerRbacSubscriptionIds.Count -gt 0)                 { $tfVars += Add-TerraformVariable -Name 'worker_subscription_rbac_subscription_ids' -Value $WorkerRbacSubscriptionIds }
        if ($PSBoundParameters.ContainsKey('WorkerRbacManagementGroupNames') -or $WorkerRbacManagementGroupNames.Count -gt 0)       { $tfVars += Add-TerraformVariable -Name 'worker_rbac_management_group_names' -Value $WorkerRbacManagementGroupNames }

        $resolvedTerraformParameterFile = Resolve-DeploymentPath -Path $ParameterFile
        if ($resolvedTerraformParameterFile) {
            $tfVars += "-var-file=$resolvedTerraformParameterFile"
        }

        $tfVars += "-var=workload_suffix=$WorkloadSuffix"
        $tfVars += "-var=auth_enabled=$($AuthEnabled.ToString().ToLowerInvariant())"
        if (-not [string]::IsNullOrWhiteSpace($AdminGroupId))          { $tfVars += "-var=admin_group_id=$AdminGroupId" }
        if (-not [string]::IsNullOrWhiteSpace($ReportViewerGroupIds))  { $tfVars += Add-TerraformVariable -Name 'report_viewer_group_ids' -Value $ReportViewerGroupIds }

        Write-Host "Running Terraform apply..."
    & $terraform apply -auto-approve -input=false @tfVars
        if ($LASTEXITCODE -ne 0) { throw 'terraform apply failed' }

        if ([string]::IsNullOrWhiteSpace($script:IngestApiKey)) {
            $generatedIngestApiKey = & $terraform output -raw effective_ingest_api_key 2>$null
            if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($generatedIngestApiKey)) {
                throw 'Terraform deployment succeeded, but the generated ingest API key could not be read from Terraform output for database bootstrap.'
            }

            $script:IngestApiKey = $generatedIngestApiKey.Trim()
        }

        $terraformWebAppName = & $terraform output -raw web_app_name 2>$null
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($terraformWebAppName)) {
            $script:webAppName = $terraformWebAppName.Trim()
        }

        $terraformFunctionAppName = & $terraform output -raw function_app_name 2>$null
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($terraformFunctionAppName)) {
            $script:functionAppName = $terraformFunctionAppName.Trim()
        }

        Write-Host "Terraform deployment succeeded." -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
}

# ── Bicep deployment path ────────────────────────────────────────────────────
$deploymentArgs = @(
    'deployment', 'group', 'create',
    '--resource-group', $ResourceGroupName,
    '--template-file', $bicepTemplateFile
)

$temporaryParameterFile = $null
$resolvedParameterFile = $null

if ($ParameterFile) {
    $resolvedParameterFile = Resolve-DeploymentPath -Path $ParameterFile
}

$deploymentArgs += @(
    '--parameters', "location=$Location",
    '--parameters', "environment=$Environment",
    '--parameters', "workloadSuffix=$WorkloadSuffix",
    '--parameters', "sqlEntraAdminLogin=$SqlEntraAdminLogin",
    '--parameters', "sqlEntraAdminObjectId=$SqlEntraAdminObjectId",
    '--parameters', "ingestApiKey=$IngestApiKey",
    '--parameters', "sessionSecret=$SessionSecret"
)

if (-not [string]::IsNullOrWhiteSpace($WorkerSharedSecret)) {
    $deploymentArgs += @('--parameters', "workerSharedSecret=$WorkerSharedSecret")
}

if (-not [string]::IsNullOrWhiteSpace($QuotaManagementGroupId)) {
    $deploymentArgs += @('--parameters', "quotaManagementGroupId=$QuotaManagementGroupId")
}

$deploymentArgs += @('--parameters', "existingSqlServerName=$ExistingSqlServerName")
$deploymentArgs += @('--parameters', "existingSqlServerResourceGroupName=$ExistingSqlServerResourceGroupName")
$deploymentArgs += @('--parameters', "existingSqlDatabaseName=$ExistingSqlDatabaseName")
$deploymentArgs += @('--parameters', "existingKeyVaultName=$ExistingKeyVaultName")
$deploymentArgs += @('--parameters', "existingKeyVaultResourceGroupName=$ExistingKeyVaultResourceGroupName")
$deploymentArgs += @('--parameters', "existingWorkerStorageAccountName=$ExistingWorkerStorageAccountName")
$deploymentArgs += @('--parameters', "existingWorkerStorageAccountResourceGroupName=$ExistingWorkerStorageResourceGroupName")
if ($useExistingVirtualNetwork) {
    $deploymentArgs += Add-BicepDeploymentParameter -Name 'existingVirtualNetworkName' -Value $ExistingVirtualNetworkName -RequiredWhenSet
    $deploymentArgs += Add-BicepDeploymentParameter -Name 'existingVirtualNetworkResourceGroupName' -Value $ExistingVirtualNetworkResourceGroupName
    $deploymentArgs += Add-BicepDeploymentParameter -Name 'existingAppServiceIntegrationSubnetName' -Value $ExistingAppServiceIntegrationSubnetName -RequiredWhenSet
    $deploymentArgs += Add-BicepDeploymentParameter -Name 'existingPrivateEndpointSubnetName' -Value $ExistingPrivateEndpointSubnetName -RequiredWhenSet
}

$deploymentArgs += @('--parameters', "authEnabled=$($AuthEnabled.ToString().ToLowerInvariant())")

if (-not [string]::IsNullOrWhiteSpace($EntraTenantId)) {
    $deploymentArgs += @('--parameters', "entraTenantId=$EntraTenantId")
}

if (-not [string]::IsNullOrWhiteSpace($EntraClientId)) {
    $deploymentArgs += @('--parameters', "entraClientId=$EntraClientId")
}

if (-not [string]::IsNullOrWhiteSpace($EntraClientSecret)) {
    $deploymentArgs += @('--parameters', "entraClientSecret=$EntraClientSecret")
}

if (-not [string]::IsNullOrWhiteSpace($AuthRedirectUri)) {
    $deploymentArgs += @('--parameters', "authRedirectUri=$AuthRedirectUri")
}

if (-not [string]::IsNullOrWhiteSpace($AdminGroupId)) {
    $deploymentArgs += @('--parameters', "adminGroupId=$AdminGroupId")
}

$deploymentArgs += Add-BicepDeploymentParameter -Name 'reportViewerGroupIds' -Value $ReportViewerGroupIds

$hasManagementGroupRbac = $WorkerRbacManagementGroupNames.Count -gt 0 -or $WebReaderManagementGroupNames.Count -gt 0 -or $WebQuotaWriterManagementGroupNames.Count -gt 0
if ($hasManagementGroupRbac) {
    $deploymentArgs += Add-BicepDeploymentParameter -Name 'deployManagementGroupRbacAssignments' -Value 'false'
}

if ($resolvedParameterFile -and [System.IO.Path]::GetExtension($resolvedParameterFile).Equals('.bicepparam', [System.StringComparison]::OrdinalIgnoreCase)) {
    $temporaryParameterFile = Join-Path (Split-Path -Path $resolvedParameterFile -Parent) ("capdash-runtime-{0}.bicepparam" -f ([guid]::NewGuid().ToString('N')))
    $temporaryBicepParamLines = @(
        (Get-Content -Path $resolvedParameterFile -Raw).TrimEnd(),
        '',
        "param ingestApiKey = '$IngestApiKey'",
        "param sessionSecret = '$SessionSecret'"
    )

    if ($WorkerRbacSubscriptionIds.Count -gt 0 -or $WorkerRbacManagementGroupNames.Count -gt 0 -or $WebReaderSubscriptionIds.Count -gt 0 -or $WebReaderManagementGroupNames.Count -gt 0 -or $WebQuotaWriterSubscriptionIds.Count -gt 0 -or $WebQuotaWriterManagementGroupNames.Count -gt 0) {
        $webSubscriptionParamLines = $WebReaderSubscriptionIds | ForEach-Object { "  '$_'" }
        $webSubscriptionParamBlock = "[" + [Environment]::NewLine + ($webSubscriptionParamLines -join ([Environment]::NewLine)) + [Environment]::NewLine + "]"
        $webManagementGroupParamLines = $WebReaderManagementGroupNames | ForEach-Object { "  '$_'" }
        $webManagementGroupParamBlock = "[" + [Environment]::NewLine + ($webManagementGroupParamLines -join ([Environment]::NewLine)) + [Environment]::NewLine + "]"
        $webQuotaWriterSubscriptionParamLines = $WebQuotaWriterSubscriptionIds | ForEach-Object { "  '$_'" }
        $webQuotaWriterSubscriptionParamBlock = "[" + [Environment]::NewLine + ($webQuotaWriterSubscriptionParamLines -join ([Environment]::NewLine)) + [Environment]::NewLine + "]"
        $webQuotaWriterManagementGroupParamLines = $WebQuotaWriterManagementGroupNames | ForEach-Object { "  '$_'" }
        $webQuotaWriterManagementGroupParamBlock = "[" + [Environment]::NewLine + ($webQuotaWriterManagementGroupParamLines -join ([Environment]::NewLine)) + [Environment]::NewLine + "]"
        $workerSubscriptionParamLines = $WorkerRbacSubscriptionIds | ForEach-Object { "  '$_'" }
        $workerSubscriptionParamBlock = "[" + [Environment]::NewLine + ($workerSubscriptionParamLines -join ([Environment]::NewLine)) + [Environment]::NewLine + "]"
        $workerManagementGroupParamLines = $WorkerRbacManagementGroupNames | ForEach-Object { "  '$_'" }
        $workerManagementGroupParamBlock = "[" + [Environment]::NewLine + ($workerManagementGroupParamLines -join ([Environment]::NewLine)) + [Environment]::NewLine + "]"
        $assignWorkerComputeRecommendationsRoleBicep = $AssignWorkerComputeRecommendationsRole.ToString().ToLowerInvariant()
        $assignWorkerCostManagementReaderRoleBicep = $AssignWorkerCostManagementReaderRole.ToString().ToLowerInvariant()
        $assignWorkerBillingReaderRoleBicep = $AssignWorkerBillingReaderRole.ToString().ToLowerInvariant()
        $temporaryBicepParamLines += @(
            "param webReaderSubscriptionIds = $webSubscriptionParamBlock",
            "param webReaderManagementGroupNames = $webManagementGroupParamBlock",
            "param webQuotaWriterSubscriptionIds = $webQuotaWriterSubscriptionParamBlock",
            "param webQuotaWriterManagementGroupNames = $webQuotaWriterManagementGroupParamBlock",
            "param workerSubscriptionRbacSubscriptionIds = $workerSubscriptionParamBlock",
            "param workerRbacManagementGroupNames = $workerManagementGroupParamBlock",
            "param assignWorkerComputeRecommendationsRole = $assignWorkerComputeRecommendationsRoleBicep",
            "param assignWorkerCostManagementReaderRole = $assignWorkerCostManagementReaderRoleBicep",
            "param assignWorkerBillingReaderRole = $assignWorkerBillingReaderRoleBicep",
            "param deployManagementGroupRbacAssignments = false"
        )
    }

    $temporaryBicepParamContent = $temporaryBicepParamLines -join [Environment]::NewLine
    Set-Content -Path $temporaryParameterFile -Value $temporaryBicepParamContent -Encoding utf8
    $resolvedParameterFile = $temporaryParameterFile
}
elseif ($WorkerRbacSubscriptionIds.Count -gt 0 -or $WorkerRbacManagementGroupNames.Count -gt 0 -or $WebReaderSubscriptionIds.Count -gt 0 -or $WebReaderManagementGroupNames.Count -gt 0 -or $WebQuotaWriterSubscriptionIds.Count -gt 0 -or $WebQuotaWriterManagementGroupNames.Count -gt 0) {
        $temporaryParameterFile = Join-Path $env:TEMP ("capdash-rbac-{0}.json" -f ([guid]::NewGuid().ToString('N')))
        @{
            '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
            contentVersion = '1.0.0.0'
            parameters = @{
                webReaderSubscriptionIds = @{
                    value = $WebReaderSubscriptionIds
                }
                webReaderManagementGroupNames = @{
                    value = $WebReaderManagementGroupNames
                }
                webQuotaWriterSubscriptionIds = @{
                    value = $WebQuotaWriterSubscriptionIds
                }
                webQuotaWriterManagementGroupNames = @{
                    value = $WebQuotaWriterManagementGroupNames
                }
                workerSubscriptionRbacSubscriptionIds = @{
                    value = $WorkerRbacSubscriptionIds
                }
                workerRbacManagementGroupNames = @{
                    value = $WorkerRbacManagementGroupNames
                }
                assignWorkerComputeRecommendationsRole = @{
                    value = $AssignWorkerComputeRecommendationsRole
                }
                assignWorkerCostManagementReaderRole = @{
                    value = $AssignWorkerCostManagementReaderRole
                }
                assignWorkerBillingReaderRole = @{
                    value = $AssignWorkerBillingReaderRole
                }
                deployManagementGroupRbacAssignments = @{
                    value = $false
                }
            }
        } | ConvertTo-Json -Depth 10 | Set-Content -Path $temporaryParameterFile -Encoding utf8
}

if ($resolvedParameterFile) {
    $parameterFileArgument = $resolvedParameterFile
    if ([System.IO.Path]::GetExtension($resolvedParameterFile).Equals('.json', [System.StringComparison]::OrdinalIgnoreCase)) {
        $parameterFileArgument = '@' + $resolvedParameterFile
    }
    $deploymentArgs += @('--parameters', $parameterFileArgument)
}

if (($WorkerRbacSubscriptionIds.Count -gt 0 -or $WorkerRbacManagementGroupNames.Count -gt 0 -or $WebReaderSubscriptionIds.Count -gt 0 -or $WebReaderManagementGroupNames.Count -gt 0 -or $WebQuotaWriterSubscriptionIds.Count -gt 0 -or $WebQuotaWriterManagementGroupNames.Count -gt 0) -and $temporaryParameterFile -and [System.IO.Path]::GetExtension($temporaryParameterFile).Equals('.json', [System.StringComparison]::OrdinalIgnoreCase)) {
    $deploymentArgs += @('--parameters', ('@' + $temporaryParameterFile))
}

$deploymentArgs += @('--parameters', "workloadSuffix=$WorkloadSuffix")
$deploymentArgs += @('--parameters', "authEnabled=$($AuthEnabled.ToString().ToLowerInvariant())")
if (-not [string]::IsNullOrWhiteSpace($AdminGroupId)) {
    $deploymentArgs += @('--parameters', "adminGroupId=$AdminGroupId")
}
$deploymentArgs += Add-BicepDeploymentParameter -Name 'reportViewerGroupIds' -Value $ReportViewerGroupIds
if ($hasManagementGroupRbac) {
    $deploymentArgs += Add-BicepDeploymentParameter -Name 'deployManagementGroupRbacAssignments' -Value 'false'
}

try {
    $webPrincipalId = $null
    $workerPrincipalId = $null
    if ($Provider -eq 'Terraform') {
        Deploy-Terraform
    }
    else {
        $deploymentResultJson = az @deploymentArgs --output json
        if ($LASTEXITCODE -ne 0) {
            throw 'az deployment group create failed'
        }

        if (-not [string]::IsNullOrWhiteSpace($deploymentResultJson)) {
            $deploymentResult = $deploymentResultJson | ConvertFrom-Json -Depth 100
            if ($deploymentResult.properties.outputs.webAppName.value) {
                $webAppName = $deploymentResult.properties.outputs.webAppName.value
            }

            if ($deploymentResult.properties.outputs.functionAppName.value) {
                $functionAppName = $deploymentResult.properties.outputs.functionAppName.value
            }
            if ($deploymentResult.properties.outputs.managedIdentityPrincipalId.value) {
                $webPrincipalId = $deploymentResult.properties.outputs.managedIdentityPrincipalId.value
            }
            if ($deploymentResult.properties.outputs.functionManagedIdentityPrincipalId.value) {
                $workerPrincipalId = $deploymentResult.properties.outputs.functionManagedIdentityPrincipalId.value
            }
        }

        Invoke-ManagementGroupRbacAssignments -WebPrincipalId $webPrincipalId -WorkerPrincipalId $workerPrincipalId
    }

    $manualDatabaseInitializeCommand = ".\scripts\initialize-database.ps1 -SqlServer `"$effectiveSqlServerHostName`" -SqlDatabase `"$effectiveSqlDatabaseName`" -AppIdentityName `"$webAppName`""
    $databaseBootstrapFailureGuidance = Get-DatabaseBootstrapFailureGuidance -ManualDatabaseInitializeCommand $manualDatabaseInitializeCommand

    if ($DeployWebApp) {
        if (-not (Test-Path $deployWebAppScript)) {
            throw "Web deployment script not found: $deployWebAppScript"
        }

        if (-not $SkipWebAppTests -and -not (Get-Command npm -ErrorAction SilentlyContinue)) {
            Write-Warning 'npm was not found on PATH. Continuing web deployment with the npm test gate skipped.'
            $SkipWebAppTests = $true
        }

        Write-Host "Infrastructure deployment succeeded. Deploying dashboard web package to $webAppName..."
        if ($SkipWebAppTests) {
            & $deployWebAppScript -ResourceGroup $ResourceGroupName -AppName $webAppName -SourcePath $repoRoot -SkipTests
        }
        else {
            & $deployWebAppScript -ResourceGroup $ResourceGroupName -AppName $webAppName -SourcePath $repoRoot
        }
    }

    if ($DeployWorkerApp) {
        if (-not (Test-Path $deployWorkerScript)) {
            throw "Worker deployment script not found: $deployWorkerScript"
        }

        Write-Host "Infrastructure deployment succeeded. Deploying worker package to $functionAppName..."
        & $deployWorkerScript -ResourceGroupName $ResourceGroupName -FunctionAppName $functionAppName
    }

    if ($ApplyDatabaseBootstrap) {
        if (-not $DeployWebApp) {
            Write-Warning 'Skipping database bootstrap because -DeployWebApp was set to $false and the bootstrap endpoint is provided by the deployed web app package.'
            Write-Host 'Run this command from an Azure-connected host when you are ready to initialize the database:' -ForegroundColor Yellow
            Write-Host $manualDatabaseInitializeCommand -ForegroundColor Yellow
        }
        else {
            $bootstrapUri = "https://$webAppName.azurewebsites.net/internal/db/bootstrap"
            $adminBootstrapUri = "https://$webAppName.azurewebsites.net/internal/db/bootstrap-admin"
            $resolvedBootstrapIngestApiKey = Resolve-WebAppIngestApiKey -ResourceGroupName $ResourceGroupName -WebAppName $webAppName -CurrentIngestApiKey $IngestApiKey
            $headers = @{ 'x-ingest-key' = $resolvedBootstrapIngestApiKey }
            $bootstrapResult = $null
            $bootstrapError = $null

            for ($attempt = 1; $attempt -le 12; $attempt++) {
                try {
                    Write-Host "Running dashboard SQL bootstrap (attempt $attempt/12)..."
                    $bootstrapResult = Invoke-RestMethod -Method Post -Uri $bootstrapUri -Headers $headers -TimeoutSec 300
                    break
                }
                catch {
                    $bootstrapError = $_.Exception.Message
                    if ($attempt -eq 12) {
                        Write-Warning "Managed-identity bootstrap failed after 12 attempts: $bootstrapError"
                        Write-Warning $databaseBootstrapFailureGuidance
                        break
                    }

                    Write-Warning "Database bootstrap endpoint not ready yet: $($_.Exception.Message)"
                    Start-Sleep -Seconds 10
                }
            }

            if (-not $bootstrapResult) {
                try {
                    Write-Host 'Attempting admin-assisted SQL bootstrap using the current Azure CLI login...'
                    $sqlAccessToken = Get-SqlAdminAccessToken
                    $adminHeaders = @{
                        'x-ingest-key' = $resolvedBootstrapIngestApiKey
                        'Content-Type' = 'application/json'
                    }
                    $adminBootstrapBody = @{
                        sqlAccessToken = $sqlAccessToken
                        appIdentityName = $webAppName
                        runtimeRoles = @('db_datareader', 'db_datawriter')
                    } | ConvertTo-Json -Depth 5 -Compress

                    $bootstrapResult = Invoke-RestMethod -Method Post -Uri $adminBootstrapUri -Headers $adminHeaders -Body $adminBootstrapBody -TimeoutSec 300
                }
                catch {
                    throw "$databaseBootstrapFailureGuidance Managed-identity bootstrap error: $bootstrapError Admin-assisted bootstrap error: $($_.Exception.Message) If the customer pre-created SQL, substitute the actual server and database names."
                }
            }

            if ($bootstrapResult) {
                Write-Host "Database bootstrap completed successfully."
            }
        }
    }
    else {
        Write-Host 'Database bootstrap was skipped. Run this command from an Azure-connected host when you are ready to initialize the database:' -ForegroundColor Yellow
        Write-Host $manualDatabaseInitializeCommand -ForegroundColor Yellow
    }

    Show-ManagementGroupRbacFollowUps
}
finally {
    Show-ManagementGroupRbacFollowUps

    if ($temporaryParameterFile -and (Test-Path $temporaryParameterFile)) {
        Remove-Item $temporaryParameterFile -Force
    }
}
