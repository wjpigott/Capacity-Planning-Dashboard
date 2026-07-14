param(
    [Parameter(Mandatory = $true)][string]$ResourceGroupName,
    [Parameter(Mandatory = $true)][string]$AppName,
    [Parameter(Mandatory = $false)][string]$AppServicePlanName = "$AppName-plan",
    [Parameter(Mandatory = $false)][string]$Location = 'centralus',
    [Parameter(Mandatory = $false)][ValidateSet('B1','S1','P0v3')][string]$Sku = 'B1',
    [Parameter(Mandatory = $false)][bool]$AuthEnabled = $true,
    [Parameter(Mandatory = $false)][string]$EntraTenantId,
    [Parameter(Mandatory = $false)][string]$EntraClientId,
    [Parameter(Mandatory = $false)][string]$EntraClientSecret,
    [Parameter(Mandatory = $false)][string]$SessionSecret,
    [Parameter(Mandatory = $false)][string]$AuthRedirectUri,
    [Parameter(Mandatory = $false)][string]$AdminGroupId,
    [Parameter(Mandatory = $false)][string]$ReportViewerGroupIds,
    [Parameter(Mandatory = $false)][string]$SubscriptionId,
    [Parameter(Mandatory = $false)][string]$ManagementGroupNames,
    [Parameter(Mandatory = $false)][string]$FunctionAppName,
    [Parameter(Mandatory = $false)][string]$FunctionAppServicePlanName = "$AppName-worker-plan",
    [Parameter(Mandatory = $false)][string]$StorageAccountName,
    [Parameter(Mandatory = $false)][string]$ReportRegions = 'eastus,eastus2,centralus,westus,westus2,westus3',
    [Parameter(Mandatory = $false)][string]$VirtualNetworkName = "$AppName-vnet",
    [Parameter(Mandatory = $false)][string]$VirtualNetworkAddressPrefix = '10.221.0.0/16',
    [Parameter(Mandatory = $false)][string]$FunctionIntegrationSubnetName = 'snet-function-integration',
    [Parameter(Mandatory = $false)][string]$FunctionIntegrationSubnetPrefix = '10.221.1.0/24',
    [Parameter(Mandatory = $false)][string]$PrivateEndpointSubnetName = 'snet-private-endpoints',
    [Parameter(Mandatory = $false)][string]$PrivateEndpointSubnetPrefix = '10.221.2.0/24',
    [Parameter(Mandatory = $false)][switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$deployWebAppScript = Join-Path $repoRoot 'deploy-web-app.ps1'
$deployWorkerScript = Join-Path $PSScriptRoot 'deploy-worker.ps1'

function Test-AzureResourceExists([string[]]$Arguments) {
    & az @Arguments --output none 2>$null
    return $LASTEXITCODE -eq 0
}

function Invoke-AzureCli([string]$Description, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Description failed." }
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw 'Azure CLI was not found on PATH. Install Azure CLI and run az login before deploying Capacity Dashboard Lite.'
}

if (-not (Test-Path $deployWebAppScript)) {
    throw "Could not find the web deployment script at $deployWebAppScript"
}

if (-not (Test-Path $deployWorkerScript)) {
    throw "Could not find the worker deployment script at $deployWorkerScript"
}

if (-not [string]::IsNullOrWhiteSpace($SubscriptionId)) {
    & az account set --subscription $SubscriptionId
    if ($LASTEXITCODE -ne 0) { throw "Failed to select Azure subscription '$SubscriptionId'." }
}

if ($AuthEnabled -and ([string]::IsNullOrWhiteSpace($EntraTenantId) -or [string]::IsNullOrWhiteSpace($EntraClientId) -or [string]::IsNullOrWhiteSpace($EntraClientSecret) -or [string]::IsNullOrWhiteSpace($SessionSecret))) {
    throw 'When -AuthEnabled $true is used, provide -EntraTenantId, -EntraClientId, -EntraClientSecret, and -SessionSecret.'
}

if ([string]::IsNullOrWhiteSpace($AuthRedirectUri)) {
    $AuthRedirectUri = "https://$AppName.azurewebsites.net/auth/callback"
}

if ([string]::IsNullOrWhiteSpace($FunctionAppName)) {
    $FunctionAppName = ($AppName -replace '^app-', 'func-')
}

if ([string]::IsNullOrWhiteSpace($StorageAccountName)) {
    $StorageAccountName = "stcaplite$(Get-Random -Minimum 100000000 -Maximum 999999999)"
}

if ($StorageAccountName -notmatch '^[a-z0-9]{3,24}$') {
    throw "StorageAccountName '$StorageAccountName' must use 3-24 lowercase letters or numbers."
}

Write-Host "Deploying Capacity Dashboard Lite to separate App Service '$AppName'."
Write-Host 'Lite does not provision, configure, or bootstrap Azure SQL.'

if (-not (Test-AzureResourceExists @('group', 'show', '--name', $ResourceGroupName))) {
    Write-Host "Creating resource group '$ResourceGroupName' in '$Location'."
    & az group create --name $ResourceGroupName --location $Location --output none
    if ($LASTEXITCODE -ne 0) { throw "Failed to create resource group '$ResourceGroupName'." }
}

if (-not (Test-AzureResourceExists @('appservice', 'plan', 'show', '--resource-group', $ResourceGroupName, '--name', $AppServicePlanName))) {
    Write-Host "Creating Windows App Service plan '$AppServicePlanName' ($Sku)."
    & az appservice plan create --resource-group $ResourceGroupName --name $AppServicePlanName --location $Location --sku $Sku --output none
    if ($LASTEXITCODE -ne 0) { throw "Failed to create App Service plan '$AppServicePlanName'." }
}

if (-not (Test-AzureResourceExists @('appservice', 'plan', 'show', '--resource-group', $ResourceGroupName, '--name', $FunctionAppServicePlanName))) {
    Write-Host "Creating Windows Function App plan '$FunctionAppServicePlanName' ($Sku)."
    & az appservice plan create --resource-group $ResourceGroupName --name $FunctionAppServicePlanName --location $Location --sku $Sku --output none
    if ($LASTEXITCODE -ne 0) { throw "Failed to create Function App plan '$FunctionAppServicePlanName'." }
}

if (-not (Test-AzureResourceExists @('storage', 'account', 'show', '--resource-group', $ResourceGroupName, '--name', $StorageAccountName))) {
    Write-Host "Creating worker storage account '$StorageAccountName'."
    & az storage account create --resource-group $ResourceGroupName --name $StorageAccountName --location $Location --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false --public-network-access Enabled --output none
    if ($LASTEXITCODE -ne 0) { throw "Failed to create worker storage account '$StorageAccountName'." }
}

if (-not (Test-AzureResourceExists @('functionapp', 'show', '--resource-group', $ResourceGroupName, '--name', $FunctionAppName))) {
    Write-Host "Creating PowerShell Function App '$FunctionAppName'."
    & az functionapp create --resource-group $ResourceGroupName --name $FunctionAppName --plan $FunctionAppServicePlanName --storage-account $StorageAccountName --runtime powershell --runtime-version 7.6 --functions-version 4 --configure-networking-later --output none
    if ($LASTEXITCODE -ne 0) { throw "Failed to create Function App '$FunctionAppName'." }
}

if (-not (Test-AzureResourceExists @('network', 'vnet', 'show', '--resource-group', $ResourceGroupName, '--name', $VirtualNetworkName))) {
    Write-Host "Creating worker virtual network '$VirtualNetworkName'."
    Invoke-AzureCli "Creating virtual network '$VirtualNetworkName'" {
        az network vnet create --resource-group $ResourceGroupName --name $VirtualNetworkName --location $Location --address-prefixes $VirtualNetworkAddressPrefix --subnet-name $FunctionIntegrationSubnetName --subnet-prefixes $FunctionIntegrationSubnetPrefix --output none
    }
}

if (-not (Test-AzureResourceExists @('network', 'vnet', 'subnet', 'show', '--resource-group', $ResourceGroupName, '--vnet-name', $VirtualNetworkName, '--name', $FunctionIntegrationSubnetName))) {
    Invoke-AzureCli "Creating Function integration subnet '$FunctionIntegrationSubnetName'" {
        az network vnet subnet create --resource-group $ResourceGroupName --vnet-name $VirtualNetworkName --name $FunctionIntegrationSubnetName --address-prefixes $FunctionIntegrationSubnetPrefix --output none
    }
}
Invoke-AzureCli "Delegating Function integration subnet '$FunctionIntegrationSubnetName'" {
    az network vnet subnet update --resource-group $ResourceGroupName --vnet-name $VirtualNetworkName --name $FunctionIntegrationSubnetName --delegations Microsoft.Web/serverFarms --output none
}

if (-not (Test-AzureResourceExists @('network', 'vnet', 'subnet', 'show', '--resource-group', $ResourceGroupName, '--vnet-name', $VirtualNetworkName, '--name', $PrivateEndpointSubnetName))) {
    Invoke-AzureCli "Creating private endpoint subnet '$PrivateEndpointSubnetName'" {
        az network vnet subnet create --resource-group $ResourceGroupName --vnet-name $VirtualNetworkName --name $PrivateEndpointSubnetName --address-prefixes $PrivateEndpointSubnetPrefix --disable-private-endpoint-network-policies true --output none
    }
}

$storageScope = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.Storage/storageAccounts/$StorageAccountName"
$privateStorageServices = @(
    @{ Name = 'blob'; Zone = 'privatelink.blob.core.windows.net' },
    @{ Name = 'queue'; Zone = 'privatelink.queue.core.windows.net' },
    @{ Name = 'table'; Zone = 'privatelink.table.core.windows.net' },
    @{ Name = 'file'; Zone = 'privatelink.file.core.windows.net' }
)
foreach ($privateStorageService in $privateStorageServices) {
    $serviceName = $privateStorageService.Name
    $zoneName = $privateStorageService.Zone
    $zoneLinkName = "pdz-link-$($AppName -replace '^app-', '')-$serviceName"
    $endpointName = "pep-$StorageAccountName-$serviceName"

    if (-not (Test-AzureResourceExists @('network', 'private-dns', 'zone', 'show', '--resource-group', $ResourceGroupName, '--name', $zoneName))) {
        Invoke-AzureCli "Creating private DNS zone '$zoneName'" {
            az network private-dns zone create --resource-group $ResourceGroupName --name $zoneName --output none
        }
    }
    if (-not (Test-AzureResourceExists @('network', 'private-dns', 'link', 'vnet', 'show', '--resource-group', $ResourceGroupName, '--zone-name', $zoneName, '--name', $zoneLinkName))) {
        Invoke-AzureCli "Linking private DNS zone '$zoneName'" {
            az network private-dns link vnet create --resource-group $ResourceGroupName --zone-name $zoneName --name $zoneLinkName --virtual-network $VirtualNetworkName --registration-enabled false --output none
        }
    }
    if (-not (Test-AzureResourceExists @('network', 'private-endpoint', 'show', '--resource-group', $ResourceGroupName, '--name', $endpointName))) {
        Invoke-AzureCli "Creating private $serviceName endpoint '$endpointName'" {
            az network private-endpoint create --resource-group $ResourceGroupName --name $endpointName --vnet-name $VirtualNetworkName --subnet $PrivateEndpointSubnetName --private-connection-resource-id $storageScope --group-id $serviceName --connection-name "pec-$StorageAccountName-$serviceName" --output none
        }
    }
    if (-not (Test-AzureResourceExists @('network', 'private-endpoint', 'dns-zone-group', 'show', '--resource-group', $ResourceGroupName, '--endpoint-name', $endpointName, '--name', 'default'))) {
        Invoke-AzureCli "Associating private DNS zone '$zoneName' with '$endpointName'" {
            az network private-endpoint dns-zone-group create --resource-group $ResourceGroupName --endpoint-name $endpointName --name default --private-dns-zone $zoneName --zone-name $serviceName --output none
        }
    }
}

Invoke-AzureCli "Integrating Function App '$FunctionAppName' with '$FunctionIntegrationSubnetName'" {
    az functionapp vnet-integration add --resource-group $ResourceGroupName --name $FunctionAppName --vnet $VirtualNetworkName --subnet $FunctionIntegrationSubnetName --output none
}
Invoke-AzureCli "Configuring private network routing for '$FunctionAppName'" {
    az functionapp config appsettings set --resource-group $ResourceGroupName --name $FunctionAppName --settings 'WEBSITE_VNET_ROUTE_ALL=1' 'WEBSITE_DNS_SERVER=168.63.129.16' --output none
}

if (-not (Test-AzureResourceExists @('webapp', 'show', '--resource-group', $ResourceGroupName, '--name', $AppName))) {
    Write-Host "Creating Windows Node.js App Service '$AppName'."
    & az webapp create --resource-group $ResourceGroupName --plan $AppServicePlanName --name $AppName --runtime 'NODE:20LTS' --output none
    if ($LASTEXITCODE -ne 0) { throw "Failed to create App Service '$AppName'. Choose another globally unique -AppName and retry." }
}

Write-Host 'Assigning a system-managed identity to the Lite App Service.'
$identityJson = az webapp identity assign --resource-group $ResourceGroupName --name $AppName --output json
if ($LASTEXITCODE -ne 0) { throw "Failed to assign a managed identity to '$AppName'." }
$principalId = ($identityJson | ConvertFrom-Json).principalId
if ([string]::IsNullOrWhiteSpace($principalId)) { throw "Azure did not return a managed identity principal ID for '$AppName'." }

Write-Host 'Assigning a system-managed identity to the Function App.'
$workerIdentityJson = az functionapp identity assign --resource-group $ResourceGroupName --name $FunctionAppName --output json
if ($LASTEXITCODE -ne 0) { throw "Failed to assign a managed identity to '$FunctionAppName'." }
$workerPrincipalId = ($workerIdentityJson | ConvertFrom-Json).principalId
if ([string]::IsNullOrWhiteSpace($workerPrincipalId)) { throw "Azure did not return a managed identity principal ID for '$FunctionAppName'." }

$workerSharedSecret = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
foreach ($roleDefinitionId in @('b7e6dc6d-f1e8-4753-8033-0f276bb0955b', '974c5e8b-45b9-4653-ba55-5f855dd0fb88', '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3')) {
    & az role assignment create --assignee-object-id $workerPrincipalId --assignee-principal-type ServicePrincipal --role $roleDefinitionId --scope $storageScope --output none 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Storage role assignment $roleDefinitionId already exists or could not be created."
    }
}

$configuredSubscriptionIds = @($SubscriptionId -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
foreach ($configuredSubscriptionId in $configuredSubscriptionIds) {
    $subscriptionScope = "/subscriptions/$configuredSubscriptionId"
    foreach ($roleDefinitionId in @('acdd72a7-3385-48ef-bd42-f606fba81ae7', 'e82342c9-ac7f-422b-af64-e426d2e12b2d')) {
        & az role assignment create --assignee-object-id $workerPrincipalId --assignee-principal-type ServicePrincipal --role $roleDefinitionId --scope $subscriptionScope --output none 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Role assignment $roleDefinitionId already exists or could not be created at subscription '$configuredSubscriptionId'."
        }
    }
}

$configuredManagementGroups = @($ManagementGroupNames -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
foreach ($managementGroupName in $configuredManagementGroups) {
    $managementGroupScope = "/providers/Microsoft.Management/managementGroups/$managementGroupName"
    foreach ($roleDefinitionId in @('acdd72a7-3385-48ef-bd42-f606fba81ae7', 'e82342c9-ac7f-422b-af64-e426d2e12b2d')) {
        & az role assignment create --assignee-object-id $workerPrincipalId --assignee-principal-type ServicePrincipal --role $roleDefinitionId --scope $managementGroupScope --output none 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Role assignment $roleDefinitionId already exists or could not be created at management group '$managementGroupName'."
        }
    }
}

Write-Host 'Applying worker application settings.'
& az functionapp config appsettings set --resource-group $ResourceGroupName --name $FunctionAppName --settings @(
    'FUNCTIONS_EXTENSION_VERSION=~4',
    'FUNCTIONS_WORKER_RUNTIME=powershell',
    'WEBSITE_RUN_FROM_PACKAGE=1',
    "AzureWebJobsStorage__accountName=$StorageAccountName",
    'AzureWebJobsStorage__credential=managedidentity',
    "CAPACITY_SNAPSHOT_STORAGE_ACCOUNT=$StorageAccountName",
    "CAPACITY_SUBSCRIPTION_ID=$SubscriptionId",
    "CAPACITY_MANAGEMENT_GROUP_NAMES=$($configuredManagementGroups -join ',')",
    "CAPACITY_REPORT_REGIONS=$ReportRegions",
    "WORKER_SHARED_SECRET=$workerSharedSecret"
) --output none
if ($LASTEXITCODE -ne 0) { throw "Failed to configure '$FunctionAppName'." }

$appSettings = @(
    'CAPACITY_DEPLOYMENT_PROFILE=lite',
    'SESSION_STORE_SQL_ENABLED=false',
    'CAPACITY_LIVE_REFRESH_INGEST=false',
    'CAPACITY_RECOMMEND_USE_DIRECT_API=true',
    "CAPACITY_RECOMMEND_SUBSCRIPTION_ID=$SubscriptionId",
    "CAPACITY_WORKER_BASE_URL=https://$FunctionAppName.azurewebsites.net",
    "CAPACITY_WORKER_SHARED_SECRET=$workerSharedSecret",
    'CAPACITY_WORKER_DISABLE_LOCAL_FALLBACK=true',
    'NODE_ENV=production',
    "AUTH_ENABLED=$($AuthEnabled.ToString().ToLowerInvariant())"
)

if ($AuthEnabled) {
    $appSettings += @(
        "ENTRA_TENANT_ID=$EntraTenantId",
        "ENTRA_CLIENT_ID=$EntraClientId",
        "ENTRA_CLIENT_SECRET=$EntraClientSecret",
        "SESSION_SECRET=$SessionSecret",
        "AUTH_REDIRECT_URI=$AuthRedirectUri"
    )
    if (-not [string]::IsNullOrWhiteSpace($AdminGroupId)) {
        $appSettings += "ADMIN_GROUP_ID=$AdminGroupId"
    }
    if (-not [string]::IsNullOrWhiteSpace($ReportViewerGroupIds)) {
        $appSettings += "REPORT_VIEWER_GROUP_IDS=$ReportViewerGroupIds"
    }
}

Write-Host 'Applying Lite application settings.'
& az webapp config appsettings set --resource-group $ResourceGroupName --name $AppName --settings @appSettings --output none
if ($LASTEXITCODE -ne 0) { throw "Failed to configure Lite application settings for '$AppName'." }

Write-Host 'Publishing the verified web package.'
& $deployWebAppScript -ResourceGroup $ResourceGroupName -AppName $AppName -SubscriptionId $SubscriptionId -SkipTests:$SkipTests
if ($LASTEXITCODE -ne 0) { throw "Web package deployment failed for '$AppName'." }

Write-Host 'Publishing the Capacity worker package.'
& $deployWorkerScript -ResourceGroupName $ResourceGroupName -FunctionAppName $FunctionAppName
if ($LASTEXITCODE -ne 0) { throw "Worker package deployment failed for '$FunctionAppName'." }

Write-Host "Capacity Dashboard Lite is available at https://$AppName.azurewebsites.net/"
Write-Host "Assign the Lite app managed identity '$principalId' the Azure roles required for its target subscriptions or management groups before using the live tools. At minimum, start with Reader; validate whether your scope also needs Compute Recommendations Role for placement scoring."
Write-Host "Assign the worker managed identity '$workerPrincipalId' Reader at the target subscription or management group before its first report snapshot."