param(
    [Parameter(Mandatory = $true)][string]$ResourceGroupName,
    [Parameter(Mandatory = $false)][string]$Location = 'centralus',
    [Parameter(Mandatory = $false)][ValidateSet('dev','test','prod')][string]$Environment = 'dev',
    [Parameter(Mandatory = $true)][string]$WorkloadSuffix,
    [Parameter(Mandatory = $false)][string]$ParameterFile,
    [Parameter(Mandatory = $true)][string]$SqlEntraAdminLogin,
    [Parameter(Mandatory = $true)][string]$SqlEntraAdminObjectId,
    [Parameter(Mandatory = $false)][string]$WorkerSharedSecret,
    [Parameter(Mandatory = $false)][string[]]$WebReaderSubscriptionIds = @(),
    [Parameter(Mandatory = $false)][string[]]$WebQuotaWriterSubscriptionIds = @(),
    [Parameter(Mandatory = $false)][string]$QuotaManagementGroupId,
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
    [Parameter(Mandatory = $false)][bool]$DeployWebApp = $true,
    [Parameter(Mandatory = $false)][bool]$ApplyDatabaseBootstrap = $true,
    [Parameter(Mandatory = $false)][string]$IngestApiKey,
    [Parameter(Mandatory = $false)][string]$SessionSecret
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$deployWebAppScript = Join-Path $repoRoot 'deploy-web-app.ps1'
$webAppName = "app-capdash-$Environment-$WorkloadSuffix"
$sqlServerName = "sql-capdash-$Environment-$WorkloadSuffix.database.windows.net"
$sqlDatabaseName = "sqldb-capdash-$Environment"

function New-GeneratedSecret([int]$ByteCount = 32) {
    $bytes = New-Object byte[] $ByteCount
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes)
}

function Get-SqlAdminAccessToken() {
    $token = az account get-access-token --resource https://database.windows.net/ --query accessToken --output tsv 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($token)) {
        throw 'Could not acquire an Azure SQL access token from the current Azure CLI login.'
    }

    return $token.Trim()
}

if ($SubscriptionId) {
    az account set --subscription $SubscriptionId | Out-Null
}

if ([string]::IsNullOrWhiteSpace($IngestApiKey)) {
    $IngestApiKey = New-GeneratedSecret
}

if ([string]::IsNullOrWhiteSpace($SessionSecret)) {
    $SessionSecret = New-GeneratedSecret
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

if ($resolvedParameterFile -and [System.IO.Path]::GetExtension($resolvedParameterFile).Equals('.bicepparam', [System.StringComparison]::OrdinalIgnoreCase)) {
    $temporaryParameterFile = Join-Path (Split-Path -Path $resolvedParameterFile -Parent) ("capdash-runtime-{0}.bicepparam" -f ([guid]::NewGuid().ToString('N')))
    $temporaryBicepParamLines = @(
        (Get-Content -Path $resolvedParameterFile -Raw).TrimEnd(),
        '',
        "param ingestApiKey = '$IngestApiKey'",
        "param sessionSecret = '$SessionSecret'"
    )

    if ($WorkerRbacSubscriptionIds.Count -gt 0 -or $WebReaderSubscriptionIds.Count -gt 0 -or $WebQuotaWriterSubscriptionIds.Count -gt 0) {
        $webSubscriptionParamLines = $WebReaderSubscriptionIds | ForEach-Object { "  '$_'" }
        $webSubscriptionParamBlock = "[" + [Environment]::NewLine + ($webSubscriptionParamLines -join ([Environment]::NewLine)) + [Environment]::NewLine + "]"
        $webQuotaWriterSubscriptionParamLines = $WebQuotaWriterSubscriptionIds | ForEach-Object { "  '$_'" }
        $webQuotaWriterSubscriptionParamBlock = "[" + [Environment]::NewLine + ($webQuotaWriterSubscriptionParamLines -join ([Environment]::NewLine)) + [Environment]::NewLine + "]"
        $workerSubscriptionParamLines = $WorkerRbacSubscriptionIds | ForEach-Object { "  '$_'" }
        $workerSubscriptionParamBlock = "[" + [Environment]::NewLine + ($workerSubscriptionParamLines -join ([Environment]::NewLine)) + [Environment]::NewLine + "]"
        $assignWorkerComputeRecommendationsRoleBicep = $AssignWorkerComputeRecommendationsRole.ToString().ToLowerInvariant()
        $assignWorkerCostManagementReaderRoleBicep = $AssignWorkerCostManagementReaderRole.ToString().ToLowerInvariant()
        $assignWorkerBillingReaderRoleBicep = $AssignWorkerBillingReaderRole.ToString().ToLowerInvariant()
        $temporaryBicepParamLines += @(
            "param webReaderSubscriptionIds = $webSubscriptionParamBlock",
            "param webQuotaWriterSubscriptionIds = $webQuotaWriterSubscriptionParamBlock",
            "param workerSubscriptionRbacSubscriptionIds = $workerSubscriptionParamBlock",
            "param assignWorkerComputeRecommendationsRole = $assignWorkerComputeRecommendationsRoleBicep",
            "param assignWorkerCostManagementReaderRole = $assignWorkerCostManagementReaderRoleBicep",
            "param assignWorkerBillingReaderRole = $assignWorkerBillingReaderRoleBicep"
        )
    }

    $temporaryBicepParamContent = $temporaryBicepParamLines -join [Environment]::NewLine
    Set-Content -Path $temporaryParameterFile -Value $temporaryBicepParamContent -Encoding utf8
    $resolvedParameterFile = $temporaryParameterFile
}
elseif ($WorkerRbacSubscriptionIds.Count -gt 0 -or $WebReaderSubscriptionIds.Count -gt 0 -or $WebQuotaWriterSubscriptionIds.Count -gt 0) {
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

    if ($ApplyDatabaseBootstrap) {
        if (-not $DeployWebApp) {
            Write-Warning 'Skipping database bootstrap because -DeployWebApp was set to $false and the bootstrap endpoint is provided by the deployed web app package.'
        }
        else {
            $bootstrapUri = "https://$webAppName.azurewebsites.net/internal/db/bootstrap"
            $adminBootstrapUri = "https://$webAppName.azurewebsites.net/internal/db/bootstrap-admin"
            $headers = @{ 'x-ingest-key' = $IngestApiKey }
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
                        'x-ingest-key' = $IngestApiKey
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
                    $manualCommand = ".\scripts\initialize-database.ps1 -SqlServer `"$sqlServerName`" -SqlDatabase `"$sqlDatabaseName`" -AppIdentityName `"$webAppName`""
                    throw "Database bootstrap failed. Managed-identity bootstrap error: $bootstrapError Admin-assisted bootstrap error: $($_.Exception.Message) If the SQL server is private or DBA-managed, run $manualCommand from an Azure-connected host using an Entra SQL admin login. If the customer pre-created SQL, substitute the actual server and database names."
                }
            }

            if ($bootstrapResult) {
                Write-Host "Database bootstrap completed successfully."
            }
        }
    }
}
finally {
    if ($temporaryParameterFile -and (Test-Path $temporaryParameterFile)) {
        Remove-Item $temporaryParameterFile -Force
    }
}
