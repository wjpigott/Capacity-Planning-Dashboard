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
    [Parameter(Mandatory = $false)][string[]]$WorkerRbacSubscriptionIds = @(),
    [Parameter(Mandatory = $false)][string[]]$WorkerRbacManagementGroupNames = @(),
    [Parameter(Mandatory = $false)][bool]$AssignWorkerComputeRecommendationsRole = $true,
    [Parameter(Mandatory = $false)][bool]$AssignWorkerCostManagementReaderRole = $true,
    [Parameter(Mandatory = $false)][bool]$AssignWorkerBillingReaderRole = $true,
    [Parameter(Mandatory = $false)][AllowNull()][Nullable[bool]]$AuthEnabled = $null,
    [Parameter(Mandatory = $false)][string]$EntraTenantId,
    [Parameter(Mandatory = $false)][string]$EntraClientId,
    [Parameter(Mandatory = $false)][string]$EntraClientSecret,
    [Parameter(Mandatory = $false)][string]$AuthRedirectUri,
    [Parameter(Mandatory = $false)][string]$AdminGroupId,
    [Parameter(Mandatory = $false)][string]$SubscriptionId,
    [Parameter(Mandatory = $false)][switch]$UseAllAccessibleManagementGroups,
    [Parameter(Mandatory = $false)][bool]$DeployWebApp = $true,
    [Parameter(Mandatory = $false)][bool]$DeployWorkerApp = $true,
    [Parameter(Mandatory = $false)][bool]$ApplyDatabaseBootstrap = $true,
    [Parameter(Mandatory = $false)][string]$IngestApiKey,
    [Parameter(Mandatory = $false)][string]$SessionSecret
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$deployWebAppScript = Join-Path $repoRoot 'deploy-web-app.ps1'
$deployWorkerScript = Join-Path $repoRoot 'scripts' 'deploy-worker.ps1'
$webAppName = "app-capdash-$Environment-$WorkloadSuffix"
$functionAppName = "func-capdash-$Environment-$WorkloadSuffix-appsvc"
$sqlServerName = "sql-capdash-$Environment-$WorkloadSuffix.database.windows.net"
$sqlDatabaseName = "sqldb-capdash-$Environment"
$manualDatabaseInitializeCommand = ".\scripts\initialize-database.ps1 -SqlServer `"$sqlServerName`" -SqlDatabase `"$sqlDatabaseName`" -AppIdentityName `"$webAppName`""

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

function Resolve-WebAppIngestApiKey([string]$ResourceGroupName, [string]$WebAppName, [string]$CurrentIngestApiKey) {
    if (-not [string]::IsNullOrWhiteSpace($CurrentIngestApiKey)) {
        return $CurrentIngestApiKey
    }

    $resolvedKey = az webapp config appsettings list --resource-group $ResourceGroupName --name $WebAppName --query "[?name=='INGEST_API_KEY'].value | [0]" --output tsv 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($resolvedKey)) {
        throw 'Could not resolve INGEST_API_KEY from the deployed web app settings. Pass -IngestApiKey explicitly or verify the app setting exists.'
    }

    return $resolvedKey.Trim()
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
    $responseJson = az rest --method get --url 'https://management.azure.com/providers/Microsoft.Management/managementGroups?api-version=2023-04-01' --output json 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($responseJson)) {
        throw 'Could not enumerate accessible management groups from the current Azure CLI login.'
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

if ($SubscriptionId) {
    az account set --subscription $SubscriptionId | Out-Null
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
    $tfDir = Join-Path $repoRoot 'infra' 'terraform'
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
        if ($PSBoundParameters.ContainsKey('AuthEnabled') -and $null -ne $AuthEnabled) {
            $tfVars += "-var=auth_enabled=$($AuthEnabled.ToString().ToLowerInvariant())"
        }

        if (-not [string]::IsNullOrWhiteSpace($WorkerSharedSecret))    { $tfVars += "-var=worker_shared_secret=$WorkerSharedSecret" }
        if (-not [string]::IsNullOrWhiteSpace($KeyVaultNameOverride))  { $tfVars += "-var=key_vault_name_override=$KeyVaultNameOverride" }
        if (-not [string]::IsNullOrWhiteSpace($QuotaManagementGroupId)){ $tfVars += "-var=quota_management_group_id=$QuotaManagementGroupId" }
        if (-not [string]::IsNullOrWhiteSpace($EntraTenantId))         { $tfVars += "-var=entra_tenant_id=$EntraTenantId" }
        if (-not [string]::IsNullOrWhiteSpace($EntraClientId))         { $tfVars += "-var=entra_client_id=$EntraClientId" }
        if (-not [string]::IsNullOrWhiteSpace($EntraClientSecret))     { $tfVars += "-var=entra_client_secret=$EntraClientSecret" }
        if (-not [string]::IsNullOrWhiteSpace($AuthRedirectUri))       { $tfVars += "-var=auth_redirect_uri=$AuthRedirectUri" }
        if (-not [string]::IsNullOrWhiteSpace($AdminGroupId))          { $tfVars += "-var=admin_group_id=$AdminGroupId" }
        $tfVars += "-var=web_reader_subscription_ids=$(ConvertTo-TerraformLiteral $WebReaderSubscriptionIds)"
        $tfVars += "-var=web_reader_management_group_names=$(ConvertTo-TerraformLiteral $WebReaderManagementGroupNames)"
        $tfVars += "-var=web_quota_writer_subscription_ids=$(ConvertTo-TerraformLiteral $WebQuotaWriterSubscriptionIds)"
        $tfVars += "-var=web_quota_writer_management_group_names=$(ConvertTo-TerraformLiteral $WebQuotaWriterManagementGroupNames)"
        $tfVars += "-var=worker_subscription_rbac_subscription_ids=$(ConvertTo-TerraformLiteral $WorkerRbacSubscriptionIds)"
        $tfVars += "-var=worker_rbac_management_group_names=$(ConvertTo-TerraformLiteral $WorkerRbacManagementGroupNames)"

        if ($ParameterFile -and (Test-Path $ParameterFile)) {
            $tfVars += "-var-file=$((Resolve-Path $ParameterFile).Path)"
        }

        Write-Host "Running Terraform apply..."
    & $terraform apply -auto-approve -input=false @tfVars
        if ($LASTEXITCODE -ne 0) { throw 'terraform apply failed' }

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
    '--template-file', './infra/bicep/main.bicep'
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

if ($PSBoundParameters.ContainsKey('AuthEnabled') -and $null -ne $AuthEnabled) {
    $deploymentArgs += @('--parameters', "authEnabled=$($AuthEnabled.ToString().ToLowerInvariant())")
}

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
            "param assignWorkerBillingReaderRole = $assignWorkerBillingReaderRoleBicep"
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

try {
    if ($Provider -eq 'Terraform') {
        Deploy-Terraform
    }
    else {
        az @deploymentArgs
        if ($LASTEXITCODE -ne 0) {
            throw 'az deployment group create failed'
        }
    }

    if ($DeployWebApp) {
        if (-not (Test-Path $deployWebAppScript)) {
            throw "Web deployment script not found: $deployWebAppScript"
        }

        Write-Host "Infrastructure deployment succeeded. Deploying dashboard web package to $webAppName..."
        & $deployWebAppScript -ResourceGroup $ResourceGroupName -AppName $webAppName -SourcePath $repoRoot
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
                    throw "Database bootstrap failed. Managed-identity bootstrap error: $bootstrapError Admin-assisted bootstrap error: $($_.Exception.Message) If the SQL server is private or DBA-managed, run $manualDatabaseInitializeCommand from an Azure-connected host using an Entra SQL admin login. If the customer pre-created SQL, substitute the actual server and database names."
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
}
finally {
    if ($temporaryParameterFile -and (Test-Path $temporaryParameterFile)) {
        Remove-Item $temporaryParameterFile -Force
    }
}
