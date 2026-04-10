param(
    [Parameter(Mandatory = $true)][string]$ResourceGroupName,
    [Parameter(Mandatory = $false)][string]$Location = 'centralus',
    [Parameter(Mandatory = $false)][ValidateSet('dev','test','prod')][string]$Environment = 'dev',
    [Parameter(Mandatory = $true)][string]$WorkloadSuffix,
    [Parameter(Mandatory = $false)][string]$SqlAdminLogin = 'sqllocaladmin',
    [Parameter(Mandatory = $false)][string]$SqlAdminPassword,
    [Parameter(Mandatory = $true)][string]$SqlEntraAdminLogin,
    [Parameter(Mandatory = $true)][string]$SqlEntraAdminObjectId,
    [Parameter(Mandatory = $false)][string]$SubscriptionId
)

$ErrorActionPreference = 'Stop'

if ($SubscriptionId) {
    az account set --subscription $SubscriptionId | Out-Null
}

if ([string]::IsNullOrWhiteSpace($SqlAdminPassword)) {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $SqlAdminPassword = [Convert]::ToBase64String($bytes) + 'aA1!'
}

az group create --name $ResourceGroupName --location $Location | Out-Null

az deployment group create `
  --resource-group $ResourceGroupName `
  --template-file ./infra/main.bicep `
  --parameters location=$Location environment=$Environment workloadSuffix=$WorkloadSuffix sqlAdminLogin=$SqlAdminLogin sqlAdminPassword=$SqlAdminPassword sqlEntraAdminLogin=$SqlEntraAdminLogin sqlEntraAdminObjectId=$SqlEntraAdminObjectId
