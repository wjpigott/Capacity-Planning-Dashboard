param(
    [Parameter(Mandatory = $true)][string]$ResourceGroupName,
    [Parameter(Mandatory = $false)][string]$Location = 'centralus',
    [Parameter(Mandatory = $false)][ValidateSet('dev','test','prod')][string]$Environment = 'dev',
    [Parameter(Mandatory = $true)][string]$WorkloadSuffix,
    [Parameter(Mandatory = $false)][string]$ParameterFile,
    [Parameter(Mandatory = $false)][string]$SqlAdminLogin = 'sqllocaladmin',
    [Parameter(Mandatory = $false)][string]$SqlAdminPassword,
    [Parameter(Mandatory = $true)][string]$SqlEntraAdminLogin,
    [Parameter(Mandatory = $true)][string]$SqlEntraAdminObjectId,
    [Parameter(Mandatory = $false)][string]$WorkerSharedSecret,
    [Parameter(Mandatory = $false)][string[]]$WebReaderSubscriptionIds = @(),
    [Parameter(Mandatory = $false)][string[]]$WebQuotaWriterSubscriptionIds = @(),
    [Parameter(Mandatory = $false)][string[]]$WorkerRbacSubscriptionIds = @(),
    [Parameter(Mandatory = $false)][bool]$AssignWorkerComputeRecommendationsRole = $true,
    [Parameter(Mandatory = $false)][bool]$AssignWorkerCostManagementReaderRole = $true,
    [Parameter(Mandatory = $false)][bool]$AssignWorkerBillingReaderRole = $true,
    [Parameter(Mandatory = $false)][bool]$AuthEnabled = $false,
    [Parameter(Mandatory = $false)][string]$EntraTenantId,
    [Parameter(Mandatory = $false)][string]$EntraClientId,
    [Parameter(Mandatory = $false)][string]$EntraClientSecret,
    [Parameter(Mandatory = $false)][string]$AuthRedirectUri,
    [Parameter(Mandatory = $false)][string]$AdminGroupId,
    [Parameter(Mandatory = $false)][string]$SubscriptionId,
    [Parameter(Mandatory = $false)][bool]$DeployWebApp = $true
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$deployWebAppScript = Join-Path $repoRoot 'deploy-web-app.ps1'
$webAppName = "app-capdash-$Environment-$WorkloadSuffix"

if ($SubscriptionId) {
    az account set --subscription $SubscriptionId | Out-Null
}

if ([string]::IsNullOrWhiteSpace($SqlAdminPassword)) {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $SqlAdminPassword = [Convert]::ToBase64String($bytes) + 'aA1!'
}

az group create --name $ResourceGroupName --location $Location | Out-Null

$deploymentArgs = @(
    'deployment', 'group', 'create',
    '--resource-group', $ResourceGroupName,
    '--template-file', './infra/main.bicep'
)

$temporaryParameterFile = $null
$resolvedParameterFile = $null

if ($ParameterFile) {
    $resolvedParameterFile = (Resolve-Path $ParameterFile).Path
}

$deploymentArgs += @(
    '--parameters', "location=$Location",
    '--parameters', "environment=$Environment",
    '--parameters', "workloadSuffix=$WorkloadSuffix",
    '--parameters', "sqlAdminLogin=$SqlAdminLogin",
    '--parameters', "sqlAdminPassword=$SqlAdminPassword",
    '--parameters', "sqlEntraAdminLogin=$SqlEntraAdminLogin",
    '--parameters', "sqlEntraAdminObjectId=$SqlEntraAdminObjectId"
)

if (-not [string]::IsNullOrWhiteSpace($WorkerSharedSecret)) {
    $deploymentArgs += @('--parameters', "workerSharedSecret=$WorkerSharedSecret")
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

if ($WorkerRbacSubscriptionIds.Count -gt 0 -or $WebReaderSubscriptionIds.Count -gt 0 -or $WebQuotaWriterSubscriptionIds.Count -gt 0) {
    if ($resolvedParameterFile -and [System.IO.Path]::GetExtension($resolvedParameterFile).Equals('.bicepparam', [System.StringComparison]::OrdinalIgnoreCase)) {
        $temporaryParameterFile = Join-Path (Split-Path -Path $resolvedParameterFile -Parent) ("capdash-rbac-{0}.bicepparam" -f ([guid]::NewGuid().ToString('N')))
        $webSubscriptionParamLines = $WebReaderSubscriptionIds | ForEach-Object { "  '$_'" }
        $webSubscriptionParamBlock = "[" + [Environment]::NewLine + ($webSubscriptionParamLines -join ([Environment]::NewLine)) + [Environment]::NewLine + "]"
        $webQuotaWriterSubscriptionParamLines = $WebQuotaWriterSubscriptionIds | ForEach-Object { "  '$_'" }
        $webQuotaWriterSubscriptionParamBlock = "[" + [Environment]::NewLine + ($webQuotaWriterSubscriptionParamLines -join ([Environment]::NewLine)) + [Environment]::NewLine + "]"
        $workerSubscriptionParamLines = $WorkerRbacSubscriptionIds | ForEach-Object { "  '$_'" }
        $workerSubscriptionParamBlock = "[" + [Environment]::NewLine + ($workerSubscriptionParamLines -join ([Environment]::NewLine)) + [Environment]::NewLine + "]"
        $assignWorkerComputeRecommendationsRoleBicep = $AssignWorkerComputeRecommendationsRole.ToString().ToLowerInvariant()
        $assignWorkerCostManagementReaderRoleBicep = $AssignWorkerCostManagementReaderRole.ToString().ToLowerInvariant()
        $assignWorkerBillingReaderRoleBicep = $AssignWorkerBillingReaderRole.ToString().ToLowerInvariant()
        $temporaryBicepParamContent = @(
            (Get-Content -Path $resolvedParameterFile -Raw),
            '',
            "param webReaderSubscriptionIds = $webSubscriptionParamBlock",
            "param webQuotaWriterSubscriptionIds = $webQuotaWriterSubscriptionParamBlock",
            "param workerSubscriptionRbacSubscriptionIds = $workerSubscriptionParamBlock",
            "param assignWorkerComputeRecommendationsRole = $assignWorkerComputeRecommendationsRoleBicep",
            "param assignWorkerCostManagementReaderRole = $assignWorkerCostManagementReaderRoleBicep",
            "param assignWorkerBillingReaderRole = $assignWorkerBillingReaderRoleBicep"
        ) -join [Environment]::NewLine
        Set-Content -Path $temporaryParameterFile -Value $temporaryBicepParamContent -Encoding utf8
        $resolvedParameterFile = $temporaryParameterFile
    }
    else {
        $temporaryParameterFile = Join-Path $env:TEMP ("capdash-rbac-{0}.json" -f ([guid]::NewGuid().ToString('N')))
        @{
            '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
            contentVersion = '1.0.0.0'
            parameters = @{
                webReaderSubscriptionIds = @{
                    value = $WebReaderSubscriptionIds
                }
                webQuotaWriterSubscriptionIds = @{
                    value = $WebQuotaWriterSubscriptionIds
                }
                workerSubscriptionRbacSubscriptionIds = @{
                    value = $WorkerRbacSubscriptionIds
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
            }
        } | ConvertTo-Json -Depth 10 | Set-Content -Path $temporaryParameterFile -Encoding utf8
    }
}

if ($resolvedParameterFile) {
    $parameterFileArgument = $resolvedParameterFile
    if ([System.IO.Path]::GetExtension($resolvedParameterFile).Equals('.json', [System.StringComparison]::OrdinalIgnoreCase)) {
        $parameterFileArgument = '@' + $resolvedParameterFile
    }
    $deploymentArgs += @('--parameters', $parameterFileArgument)
}

if (($WorkerRbacSubscriptionIds.Count -gt 0 -or $WebReaderSubscriptionIds.Count -gt 0 -or $WebQuotaWriterSubscriptionIds.Count -gt 0) -and $temporaryParameterFile -and [System.IO.Path]::GetExtension($temporaryParameterFile).Equals('.json', [System.StringComparison]::OrdinalIgnoreCase)) {
    $deploymentArgs += @('--parameters', ('@' + $temporaryParameterFile))
}

try {
    az @deploymentArgs

    if ($DeployWebApp) {
        if (-not (Test-Path $deployWebAppScript)) {
            throw "Web deployment script not found: $deployWebAppScript"
        }

        Write-Host "Infrastructure deployment succeeded. Deploying dashboard web package to $webAppName..."
        & $deployWebAppScript -ResourceGroup $ResourceGroupName -AppName $webAppName -SourcePath $repoRoot
    }
}
finally {
    if ($temporaryParameterFile -and (Test-Path $temporaryParameterFile)) {
        Remove-Item $temporaryParameterFile -Force
    }
}
