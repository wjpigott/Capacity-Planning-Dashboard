param(
    [Parameter(Mandatory = $false)]
    [string]$AnswersFile,

    [Parameter(Mandatory = $false)]
    [string]$SaveAnswers,

    [Parameter(Mandatory = $false)]
    [switch]$PlanOnly,

    [Parameter(Mandatory = $false)]
    [switch]$PreflightOnly,

    [Parameter(Mandatory = $false)]
    [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$deployScript = Join-Path $repoRoot 'scripts\deploy-infra.ps1'

if (-not (Test-Path $deployScript)) {
    throw "Deployment engine not found: $deployScript"
}

$answers = @{}
$secretNames = @('EntraClientSecret', 'IngestApiKey', 'SessionSecret', 'WorkerSharedSecret')

function ConvertTo-Hashtable([object]$InputObject) {
    if ($null -eq $InputObject) {
        return $null
    }

    if ($InputObject -is [System.Collections.IDictionary]) {
        $result = @{}
        foreach ($key in $InputObject.Keys) {
            $result[$key] = ConvertTo-Hashtable $InputObject[$key]
        }
        return $result
    }

    if ($InputObject -is [System.Collections.IEnumerable] -and -not ($InputObject -is [string])) {
        return @($InputObject | ForEach-Object { ConvertTo-Hashtable $_ })
    }

    if ($InputObject -is [pscustomobject]) {
        $result = @{}
        foreach ($property in $InputObject.PSObject.Properties) {
            $result[$property.Name] = ConvertTo-Hashtable $property.Value
        }
        return $result
    }

    return $InputObject
}

function Read-AnswersFile([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return @{}
    }

    if (-not (Test-Path $Path)) {
        throw "Answers file not found: $Path"
    }

    $json = Get-Content -Path $Path -Raw
    if ([string]::IsNullOrWhiteSpace($json)) {
        return @{}
    }

    return ConvertTo-Hashtable ($json | ConvertFrom-Json -Depth 20)
}

function Get-Answer([string]$Name, [object]$DefaultValue = $null) {
    if ($answers.ContainsKey($Name) -and $null -ne $answers[$Name] -and "$($answers[$Name])" -ne '') {
        return $answers[$Name]
    }

    return $DefaultValue
}

function Set-Answer([string]$Name, [object]$Value) {
    $answers[$Name] = $Value
    return $Value
}

function ConvertTo-BoolValue([object]$Value, [bool]$DefaultValue = $false) {
    if ($null -eq $Value) {
        return $DefaultValue
    }

    if ($Value -is [bool]) {
        return $Value
    }

    $text = "$Value".Trim().ToLowerInvariant()
    if ($text -in @('y', 'yes', 'true', '1')) {
        return $true
    }

    if ($text -in @('n', 'no', 'false', '0')) {
        return $false
    }

    return $DefaultValue
}

function ConvertTo-StringArray([object]$Value) {
    if ($null -eq $Value) {
        return @()
    }

    if ($Value -is [string]) {
        return @(
            $Value -split ',' |
                ForEach-Object { $_.Trim() } |
                Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        )
    }

    if ($Value -is [System.Collections.IEnumerable]) {
        return @($Value | ForEach-Object { "$($_)".Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }

    return @("$Value".Trim())
}

function Prompt-String([string]$Name, [string]$Question, [string]$DefaultValue = '', [switch]$Required) {
    $existingValue = Get-Answer -Name $Name -DefaultValue $DefaultValue
    if ($NonInteractive) {
        if ($Required -and [string]::IsNullOrWhiteSpace($existingValue)) {
            throw "Missing required answer '$Name' for non-interactive mode."
        }
        return Set-Answer -Name $Name -Value $existingValue
    }

    while ($true) {
        $suffix = if ([string]::IsNullOrWhiteSpace($existingValue)) { '' } else { " [$existingValue]" }
        $response = Read-Host "$Question$suffix"
        if ([string]::IsNullOrWhiteSpace($response)) {
            $response = $existingValue
        }

        if (-not $Required -or -not [string]::IsNullOrWhiteSpace($response)) {
            return Set-Answer -Name $Name -Value $response
        }

        Write-Host 'A value is required.' -ForegroundColor Yellow
    }
}

function Prompt-YesNo([string]$Name, [string]$Question, [bool]$DefaultValue = $false) {
    $existingValue = ConvertTo-BoolValue -Value (Get-Answer -Name $Name -DefaultValue $DefaultValue) -DefaultValue $DefaultValue
    if ($NonInteractive) {
        return Set-Answer -Name $Name -Value $existingValue
    }

    $defaultText = if ($existingValue) { 'Y/n' } else { 'y/N' }
    while ($true) {
        $response = Read-Host "$Question ($defaultText)"
        if ([string]::IsNullOrWhiteSpace($response)) {
            return Set-Answer -Name $Name -Value $existingValue
        }

        $text = $response.Trim().ToLowerInvariant()
        if ($text -in @('y', 'yes')) {
            return Set-Answer -Name $Name -Value $true
        }

        if ($text -in @('n', 'no')) {
            return Set-Answer -Name $Name -Value $false
        }

        Write-Host 'Answer yes or no.' -ForegroundColor Yellow
    }
}

function Prompt-Choice([string]$Name, [string]$Question, [string[]]$Choices, [string]$DefaultValue) {
    $existingValue = "$((Get-Answer -Name $Name -DefaultValue $DefaultValue))"
    if ($NonInteractive) {
        if ($Choices -notcontains $existingValue) {
            throw "Answer '$Name' must be one of: $($Choices -join ', ')."
        }
        return Set-Answer -Name $Name -Value $existingValue
    }

    while ($true) {
        Write-Host $Question
        for ($choiceIndex = 0; $choiceIndex -lt $Choices.Count; $choiceIndex++) {
            $marker = if ($Choices[$choiceIndex] -eq $existingValue) { '*' } else { ' ' }
            Write-Host ("  {0}. [{1}] {2}" -f ($choiceIndex + 1), $marker, $Choices[$choiceIndex])
        }

        $response = Read-Host "Choose 1-$($Choices.Count) [$existingValue]"
        if ([string]::IsNullOrWhiteSpace($response)) {
            return Set-Answer -Name $Name -Value $existingValue
        }

        $selectedIndex = 0
        if ([int]::TryParse($response, [ref]$selectedIndex) -and $selectedIndex -ge 1 -and $selectedIndex -le $Choices.Count) {
            return Set-Answer -Name $Name -Value $Choices[$selectedIndex - 1]
        }

        $matchingChoice = $Choices | Where-Object { $_.Equals($response, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
        if ($matchingChoice) {
            return Set-Answer -Name $Name -Value $matchingChoice
        }

        Write-Host 'Choose one of the listed options.' -ForegroundColor Yellow
    }
}

function Prompt-List([string]$Name, [string]$Question, [string[]]$DefaultValue = @()) {
    $existingValue = ConvertTo-StringArray (Get-Answer -Name $Name -DefaultValue $DefaultValue)
    if ($NonInteractive) {
        return Set-Answer -Name $Name -Value $existingValue
    }

    $defaultText = if ($existingValue.Count -gt 0) { " [$($existingValue -join ',')]" } else { '' }
    $response = Read-Host "$Question$defaultText"
    if ([string]::IsNullOrWhiteSpace($response)) {
        return Set-Answer -Name $Name -Value $existingValue
    }

    return Set-Answer -Name $Name -Value (ConvertTo-StringArray $response)
}

function ConvertFrom-SecureStringToPlainText([securestring]$SecureValue) {
    if ($null -eq $SecureValue) {
        return ''
    }

    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        if ($bstr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
    }
}

function Prompt-Secret([string]$Name, [string]$Question, [switch]$Required) {
    $existingValue = Get-Answer -Name $Name -DefaultValue ''
    if (-not [string]::IsNullOrWhiteSpace($existingValue) -and $existingValue -ne '<prompt>') {
        return Set-Answer -Name $Name -Value $existingValue
    }

    if ($NonInteractive) {
        if ($Required) {
            throw "Missing secret '$Name' for non-interactive mode."
        }
        return Set-Answer -Name $Name -Value ''
    }

    while ($true) {
        $secureValue = Read-Host $Question -AsSecureString
        $plainText = ConvertFrom-SecureStringToPlainText -SecureValue $secureValue
        if (-not $Required -or -not [string]::IsNullOrWhiteSpace($plainText)) {
            return Set-Answer -Name $Name -Value $plainText
        }

        Write-Host 'A value is required.' -ForegroundColor Yellow
    }
}

function New-GeneratedSecret([int]$ByteCount = 32) {
    $bytes = New-Object byte[] $ByteCount
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes)
}

function Test-CommandAvailable([string]$CommandName) {
    return $null -ne (Get-Command $CommandName -ErrorAction SilentlyContinue)
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

function Get-AzAccountContext() {
    if (-not (Test-CommandAvailable 'az')) {
        return $null
    }

    try {
        $accountJson = Invoke-NativeCommandAllowStderr { az account show --output json 2>$null }
    }
    catch {
        return $null
    }

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($accountJson)) {
        return $null
    }

    return $accountJson | ConvertFrom-Json
}

function Get-SignedInUserSummary() {
    try {
        $userOutput = az ad signed-in-user show --query '{login:userPrincipalName,id:id}' --output json 2>&1
    }
    catch {
        $errorText = $_.Exception.Message
        if ($errorText -match 'InteractionRequired|TokenIssuedBeforeRevocationTimestamp|Continuous access evaluation') {
            Write-Warning "Azure CLI could not read the signed-in user from Microsoft Graph, so the wizard will ask for the SQL Entra admin details manually. Original Azure CLI error: $errorText"
        }
        else {
            Write-Warning "Could not read the signed-in Azure CLI user. Enter the SQL Entra admin login and object ID manually when prompted. Original Azure CLI error: $errorText"
        }

        return $null
    }

    $userJson = ($userOutput | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($userJson)) {
        if ($userJson -match 'InteractionRequired|TokenIssuedBeforeRevocationTimestamp|Continuous access evaluation') {
            Write-Warning "Azure CLI could not read the signed-in user from Microsoft Graph, so the wizard will ask for the SQL Entra admin details manually. Original Azure CLI error: $userJson"
        }
        else {
            Write-Warning "Could not read the signed-in Azure CLI user. Enter the SQL Entra admin login and object ID manually when prompted. Original Azure CLI error: $userJson"
        }

        return $null
    }

    return $userJson | ConvertFrom-Json
}

function Get-EntraGroupIdByDisplayName([string]$DisplayName) {
    try {
        $groupOutput = az ad group list --display-name $DisplayName --output json 2>&1
    }
    catch {
        $errorText = $_.Exception.Message
        if ($errorText -match 'InteractionRequired|TokenIssuedBeforeRevocationTimestamp|Continuous access evaluation') {
            throw 'Microsoft Graph group lookup is unavailable in this Azure CLI session.'
        }

        throw "The current Azure CLI login cannot read Microsoft Entra groups. Choose explicit group object IDs to continue without display-name group lookup, or use an identity that can read groups. Original Azure CLI error: $errorText"
    }

    if ($LASTEXITCODE -ne 0) {
        $errorText = ($groupOutput | Out-String).Trim()
        if ($errorText -match 'InteractionRequired|TokenIssuedBeforeRevocationTimestamp|Continuous access evaluation') {
            throw 'Microsoft Graph group lookup is unavailable in this Azure CLI session.'
        }

        if ($errorText -match 'NormalizedResponse|msal\.throttled_http_client|msal_http_cache|binary_cache') {
            throw "Azure CLI is logged in, but its local MSAL HTTP cache failed while requesting Microsoft Graph. Run 'az upgrade' if available, delete '%USERPROFILE%\.azure\msal_http_cache.bin', then run 'az login --tenant <tenant-id>' again. Original Azure CLI error: $errorText"
        }

        throw "The current Azure CLI login cannot read Microsoft Entra groups. Choose explicit group object IDs to continue without display-name group lookup, or use an identity that can read groups. Original Azure CLI error: $errorText"
    }

    $groupsJson = ($groupOutput | Out-String)
    $groups = @($groupsJson | ConvertFrom-Json)
    $group = $groups | Where-Object { $_.displayName -eq $DisplayName } | Select-Object -First 1
    if (-not $group -or [string]::IsNullOrWhiteSpace($group.id)) {
        return ''
    }

    return $group.id
}

function Test-EntraGroupReadAccess([string]$DisplayName) {
    return -not [string]::IsNullOrWhiteSpace((Get-EntraGroupIdByDisplayName -DisplayName $DisplayName))
}

function Test-AzureDeploymentPreflight([string]$SubscriptionId, [bool]$AuthEnabled, [string]$AccessGroupMode, [string]$AdminGroupId, [string]$ReportViewerGroupIds, [string]$AdminGroupDisplayName, [string]$ReportViewerGroupDisplayName, [string]$ExpectedWebAppName, [string]$ExpectedFunctionAppName) {
    Write-Host ''
    Write-Host 'Running Azure CLI preflight checks...' -ForegroundColor Cyan

    if (-not (Test-CommandAvailable 'az')) {
        throw "Azure CLI was not found on PATH. Install Azure CLI, then run 'az login' before deploying."
    }

    try {
        $accountJson = Invoke-NativeCommandAllowStderr { az account show --output json 2>$null }
    }
    catch {
        throw "Azure CLI is not logged in or could not return the current account. Run 'az login --tenant <tenant-id>' and select the target subscription before deploying. Azure CLI error: $($_.Exception.Message)"
    }

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($accountJson)) {
        throw "Azure CLI is not logged in. Run 'az login --tenant <tenant-id>' and select the target subscription before deploying."
    }

    $account = $accountJson | ConvertFrom-Json
    if (-not [string]::IsNullOrWhiteSpace($SubscriptionId)) {
        try {
            $subscriptionJson = Invoke-NativeCommandAllowStderr { az account show --subscription $SubscriptionId --output json 2>$null }
        }
        catch {
            throw "Azure CLI cannot access subscription '$SubscriptionId'. Run 'az account list --output table' to confirm access, then run 'az account set --subscription $SubscriptionId'. Azure CLI error: $($_.Exception.Message)"
        }

        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($subscriptionJson)) {
            throw "Azure CLI cannot access subscription '$SubscriptionId'. Run 'az account list --output table' to confirm access, then run 'az account set --subscription $SubscriptionId'."
        }
    }

    Write-Host "Azure CLI account OK: $($account.name) / $($account.id)" -ForegroundColor Green

    $requiresDefaultGroupLookup = $AuthEnabled -and $AccessGroupMode -ne 'Use explicit group object IDs'
    if ($requiresDefaultGroupLookup) {
        if ([string]::IsNullOrWhiteSpace($AdminGroupId)) {
            $adminGroupExists = Test-EntraGroupReadAccess -DisplayName $AdminGroupDisplayName
            if (-not $adminGroupExists -and $AccessGroupMode -ne 'Create missing default groups') {
                throw "Entra group '$AdminGroupDisplayName' was not found. Ask an Entra administrator to create it, choose explicit group object IDs, or choose the create-missing-groups option if your login can create security groups."
            }
        }

        if ([string]::IsNullOrWhiteSpace($ReportViewerGroupIds)) {
            $viewerGroupExists = Test-EntraGroupReadAccess -DisplayName $ReportViewerGroupDisplayName
            if (-not $viewerGroupExists -and $AccessGroupMode -ne 'Create missing default groups') {
                throw "Entra group '$ReportViewerGroupDisplayName' was not found. Ask an Entra administrator to create it, choose explicit group object IDs, or choose the create-missing-groups option if your login can create security groups."
            }
        }

        Write-Host 'Microsoft Entra group read access OK.' -ForegroundColor Green
    }

    if (-not [string]::IsNullOrWhiteSpace($ExpectedWebAppName) -and -not [string]::IsNullOrWhiteSpace($ExpectedFunctionAppName)) {
        Write-Host "Expected callback URL: https://$ExpectedWebAppName.azurewebsites.net/auth/callback" -ForegroundColor Green
    }
}

function Add-DeployArgument([System.Collections.ArrayList]$Arguments, [string]$Name, [object]$Value, [switch]$Switch, [switch]$AllowEmpty) {
    if ($Switch) {
        if (ConvertTo-BoolValue -Value $Value -DefaultValue $false) {
            [void]$Arguments.Add($Name)
        }
        return
    }

    if ($null -eq $Value) {
        return
    }

    if ($Value -is [string] -and [string]::IsNullOrWhiteSpace($Value) -and -not $AllowEmpty) {
        return
    }

    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string]) -and @($Value).Count -eq 0) {
        return
    }

    [void]$Arguments.Add($Name)
    [void]$Arguments.Add($Value)
}

function Format-CommandValue([object]$Value, [bool]$IsSecret) {
    if ($IsSecret) {
        return '<secret>'
    }

    if ($Value -is [bool]) {
        return '$' + $Value.ToString().ToLowerInvariant()
    }

    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        $items = @($Value | ForEach-Object { '"' + ("$($_)".Replace('"', '`"')) + '"' })
        return '@(' + ($items -join ', ') + ')'
    }

    return '"' + ("$Value".Replace('"', '`"')) + '"'
}

function Show-CommandPreview([System.Collections.ArrayList]$Arguments) {
    $secretArgumentNames = @('-EntraClientSecret', '-IngestApiKey', '-SessionSecret', '-WorkerSharedSecret')
    $parts = @('& .\scripts\deploy-infra.ps1')
    for ($argumentIndex = 0; $argumentIndex -lt $Arguments.Count; $argumentIndex++) {
        $argumentName = $Arguments[$argumentIndex]
        if ($argumentName -is [string] -and $argumentName.StartsWith('-')) {
            if (($argumentIndex + 1) -lt $Arguments.Count -and -not (($Arguments[$argumentIndex + 1] -is [string]) -and $Arguments[$argumentIndex + 1].StartsWith('-'))) {
                $argumentValue = $Arguments[$argumentIndex + 1]
                $parts += ("  {0} {1}" -f $argumentName, (Format-CommandValue -Value $argumentValue -IsSecret ($secretArgumentNames -contains $argumentName)))
                $argumentIndex++
            }
            else {
                $parts += "  $argumentName"
            }
        }
    }

    Write-Host ''
    Write-Host 'Command preview:' -ForegroundColor Cyan
    $separator = ' `' + [Environment]::NewLine
    Write-Host ($parts -join $separator)
}

function Get-ScriptParameterNames([string]$Path) {
    $tokens = $null
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors -and $parseErrors.Count -gt 0) {
        throw "Could not parse deployment engine parameter list from $Path. $($parseErrors[0].Message)"
    }

    $parameterNames = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    if ($ast.ParamBlock) {
        foreach ($parameter in $ast.ParamBlock.Parameters) {
            [void]$parameterNames.Add($parameter.Name.VariablePath.UserPath)
        }
    }

    return $parameterNames
}

function Test-MeaningfulUnsupportedValue([object]$Value) {
    if ($null -eq $Value) {
        return $false
    }

    if ($Value -is [bool]) {
        return $Value
    }

    if ($Value -is [string]) {
        return -not [string]::IsNullOrWhiteSpace($Value)
    }

    if ($Value -is [System.Collections.IEnumerable]) {
        return @($Value).Count -gt 0
    }

    return $true
}

function ConvertTo-DeployParameterMap([System.Collections.ArrayList]$Arguments, [System.Collections.Generic.HashSet[string]]$SupportedParameterNames) {
    $parameterMap = @{}
    $unsupportedFatalParameters = @(
        'ExistingVirtualNetworkName',
        'ExistingVirtualNetworkResourceGroupName',
        'ExistingAppServiceIntegrationSubnetName',
        'ExistingPrivateEndpointSubnetName',
        'ManageEntraWebRedirectUri',
        'ReportViewerGroupIds',
        'CreateMissingEntraAccessGroups'
    )

    for ($argumentIndex = 0; $argumentIndex -lt $Arguments.Count; $argumentIndex++) {
        $argumentName = $Arguments[$argumentIndex]
        if (-not ($argumentName -is [string]) -or -not $argumentName.StartsWith('-')) {
            throw "Unexpected deployment argument at index ${argumentIndex}: $argumentName"
        }

        $parameterName = $argumentName.TrimStart('-')
        $hasValue = ($argumentIndex + 1) -lt $Arguments.Count -and -not (($Arguments[$argumentIndex + 1] -is [string]) -and $Arguments[$argumentIndex + 1].StartsWith('-'))
        $parameterValue = if ($hasValue) { $Arguments[$argumentIndex + 1] } else { $true }

        if (-not $SupportedParameterNames.Contains($parameterName)) {
            if ((Test-MeaningfulUnsupportedValue -Value $parameterValue) -and ($unsupportedFatalParameters -contains $parameterName)) {
                throw "The deployment engine at $deployScript does not support -$parameterName. Update scripts/deploy-infra.ps1 before using that wizard option, or rerun the wizard without that option."
            }

            if (Test-MeaningfulUnsupportedValue -Value $parameterValue) {
                Write-Warning "The deployment engine does not support -$parameterName. The wizard will omit it for this run."
            }

            if ($hasValue) {
                $argumentIndex++
            }
            continue
        }

        if ($hasValue) {
            $parameterMap[$parameterName] = $parameterValue
            $argumentIndex++
        }
        else {
            $parameterMap[$parameterName] = $true
        }
    }

    return $parameterMap
}

function Show-Plan([hashtable]$Plan) {
    Write-Host ''
    Write-Host 'Deployment plan:' -ForegroundColor Cyan
    $Plan.GetEnumerator() | Sort-Object Name | ForEach-Object {
        $value = $_.Value
        if ($value -is [System.Collections.IEnumerable] -and -not ($value -is [string])) {
            $value = @($value) -join ', '
        }
        if ([string]::IsNullOrWhiteSpace("$value")) {
            $value = '(not set)'
        }
        Write-Host ("  {0}: {1}" -f $_.Name, $value)
    }
}

function Save-AnswerFile([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return
    }

    $safeAnswers = [ordered]@{}
    foreach ($key in ($answers.Keys | Sort-Object)) {
        if ($secretNames -contains $key) {
            if (-not [string]::IsNullOrWhiteSpace($answers[$key])) {
                $safeAnswers[$key] = '<prompt>'
            }
            continue
        }

        $safeAnswers[$key] = $answers[$key]
    }

    $directory = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($directory) -and -not (Test-Path $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    $safeAnswers | ConvertTo-Json -Depth 10 | Set-Content -Path $Path -Encoding utf8
    Write-Host "Saved non-secret answers to $Path" -ForegroundColor Green
}

$answers = Read-AnswersFile -Path $AnswersFile

Write-Host 'Capacity Dashboard deployment wizard' -ForegroundColor Cyan
Write-Host 'This script collects answers, previews the deployment command, then calls scripts/deploy-infra.ps1.'
Write-Host 'Secrets entered here are not written to saved answer files.' -ForegroundColor Yellow
Write-Host ''

$azAccount = Get-AzAccountContext
if ($null -eq $azAccount) {
    Write-Warning 'Azure CLI is not logged in. Run az login before deploying. You can still generate a command preview.'
}
else {
    Write-Host "Current Azure context: $($azAccount.name) / $($azAccount.id)" -ForegroundColor Green
}

$provider = Prompt-Choice -Name 'Provider' -Question 'Which infrastructure provider should be used?' -Choices @('Bicep', 'Terraform') -DefaultValue 'Bicep'
if ($provider -eq 'Terraform' -and -not (Test-CommandAvailable 'terraform')) {
    Write-Warning 'Terraform was selected but terraform.exe was not found on PATH. The final deploy will fail until Terraform is installed.'
}

$subscriptionDefault = if ($azAccount) { $azAccount.id } else { '' }
$tenantDefault = if ($azAccount) { $azAccount.tenantId } else { '' }

$subscriptionId = Prompt-String -Name 'SubscriptionId' -Question 'Azure subscription ID or name' -DefaultValue $subscriptionDefault -Required
$resourceGroupName = Prompt-String -Name 'ResourceGroupName' -Question 'Resource group name' -Required
$location = Prompt-String -Name 'Location' -Question 'Azure region for new resources' -DefaultValue 'centralus' -Required
$environment = Prompt-Choice -Name 'Environment' -Question 'Environment label?' -Choices @('dev', 'test', 'prod') -DefaultValue 'dev'
$workloadSuffix = Prompt-String -Name 'WorkloadSuffix' -Question 'Workload suffix for generated resource names' -DefaultValue 'demo001' -Required
$expectedWebAppName = "app-capdash-$environment-$workloadSuffix"
$expectedAuthRedirectUri = "https://$expectedWebAppName.azurewebsites.net/auth/callback"
$randomizeNames = Prompt-YesNo -Name 'RandomizeWorkloadSuffixOnNameConflict' -Question 'Randomize the workload suffix if an App Service host name is already taken?' -DefaultValue $true

$defaultParameterFile = ''
if ($provider -eq 'Bicep') {
    $candidateParameterFile = Join-Path $repoRoot 'infra\bicep\main.bicepparam'
    if (Test-Path $candidateParameterFile) {
        $useBicepParameterFile = Prompt-YesNo -Name 'UseBicepParameterFile' -Question 'Use infra/bicep/main.bicepparam as a parameter file?' -DefaultValue $false
        if ($useBicepParameterFile) {
            $defaultParameterFile = './infra/bicep/main.bicepparam'
        }
    }
}
else {
    $candidateTfvars = Join-Path $repoRoot 'infra\terraform\terraform.tfvars'
    if (Test-Path $candidateTfvars) {
        $defaultParameterFile = './infra/terraform/terraform.tfvars'
    }
}
$parameterFile = Prompt-String -Name 'ParameterFile' -Question 'Optional parameter/tfvars file path' -DefaultValue $defaultParameterFile

$authEnabled = Prompt-YesNo -Name 'AuthEnabled' -Question 'Enable Entra sign-in for the dashboard?' -DefaultValue $true
$entraTenantId = ''
$entraClientId = ''
$entraClientSecret = ''
$authRedirectUri = ''
$manageEntraWebRedirectUri = $false
$adminGroupId = ''
$reportViewerGroupIds = ''
$createMissingGroups = $false

if ($authEnabled) {
    $entraTenantId = Prompt-String -Name 'EntraTenantId' -Question 'Entra tenant ID for dashboard sign-in' -DefaultValue $tenantDefault -Required
    $entraClientId = Prompt-String -Name 'EntraClientId' -Question 'Entra app registration client ID' -Required
    $entraClientSecret = Prompt-Secret -Name 'EntraClientSecret' -Question 'Entra app registration client secret' -Required
    $authRedirectUri = Prompt-String -Name 'AuthRedirectUri' -Question 'Auth redirect URI for the Entra app registration' -DefaultValue $expectedAuthRedirectUri
    if ($provider -eq 'Terraform') {
        $manageEntraWebRedirectUri = Prompt-YesNo -Name 'ManageEntraWebRedirectUri' -Question 'Allow Terraform wrapper to add the generated callback URI to the app registration?' -DefaultValue $false
    }

    while ($true) {
        $groupMode = Prompt-Choice -Name 'AccessGroupMode' -Question 'How should dashboard access groups be configured?' -Choices @('Reuse CapacityAdmin/CapacityReportViewers', 'Use explicit group object IDs', 'Create missing default groups') -DefaultValue 'Reuse CapacityAdmin/CapacityReportViewers'
        if ($groupMode -eq 'Use explicit group object IDs') {
            $adminGroupId = Prompt-String -Name 'AdminGroupId' -Question 'Admin group object ID' -Required
            $reportViewerGroupIds = Prompt-String -Name 'ReportViewerGroupIds' -Question 'Report viewer group object ID or comma-separated IDs' -Required
            break
        }

        if ($groupMode -eq 'Create missing default groups') {
            $createMissingGroups = Prompt-YesNo -Name 'CreateMissingEntraAccessGroups' -Question 'Confirm this identity is allowed to create Entra security groups?' -DefaultValue $false
            if ($createMissingGroups) {
                break
            }

            if ($NonInteractive) {
                throw "Answer file selected 'Create missing default groups' but did not confirm CreateMissingEntraAccessGroups. Set AccessGroupMode to 'Reuse CapacityAdmin/CapacityReportViewers', provide explicit group IDs, or set CreateMissingEntraAccessGroups to true."
            }

            Write-Warning 'Group creation was not confirmed. Choose reuse mode if the default groups already exist, or choose explicit group object IDs if another team owns Entra group creation.'
            $answers.Remove('AccessGroupMode')
            $answers.Remove('CreateMissingEntraAccessGroups')
            continue
        }

        if ($groupMode -eq 'Reuse CapacityAdmin/CapacityReportViewers') {
            try {
                $resolvedAdminGroupId = Get-EntraGroupIdByDisplayName -DisplayName 'CapacityAdmin'
                $resolvedReportViewerGroupId = Get-EntraGroupIdByDisplayName -DisplayName 'CapacityReportViewers'

                if ([string]::IsNullOrWhiteSpace($resolvedAdminGroupId) -or [string]::IsNullOrWhiteSpace($resolvedReportViewerGroupId)) {
                    throw 'CapacityAdmin or CapacityReportViewers was not found by display name.'
                }

                $adminGroupId = Set-Answer -Name 'AdminGroupId' -Value $resolvedAdminGroupId
                $reportViewerGroupIds = Set-Answer -Name 'ReportViewerGroupIds' -Value $resolvedReportViewerGroupId
                Write-Host 'Resolved CapacityAdmin and CapacityReportViewers group object IDs.' -ForegroundColor Green
            }
            catch {
                if ($NonInteractive) {
                    throw
                }

                Write-Warning "Microsoft Graph group lookup is unavailable, so the wizard will use explicit group Object IDs instead of resolving CapacityAdmin and CapacityReportViewers by display name."
                $groupMode = Set-Answer -Name 'AccessGroupMode' -Value 'Use explicit group object IDs'
                $adminGroupId = Prompt-String -Name 'AdminGroupId' -Question 'Admin group object ID' -Required
                $reportViewerGroupIds = Prompt-String -Name 'ReportViewerGroupIds' -Question 'Report viewer group object ID or comma-separated IDs' -Required
            }

            break
        }

        break
    }
}

$useCurrentUserForSqlAdmin = $false
$signedInUser = $null
if ($azAccount) {
    $signedInUser = Get-SignedInUserSummary
    if ($signedInUser -and -not [string]::IsNullOrWhiteSpace($signedInUser.id)) {
        $useCurrentUserForSqlAdmin = Prompt-YesNo -Name 'UseCurrentUserForSqlAdmin' -Question "Use current Azure signed-in user as SQL Entra admin ($($signedInUser.login))?" -DefaultValue $true
    }
}

if ($useCurrentUserForSqlAdmin) {
    $sqlEntraAdminLogin = Set-Answer -Name 'SqlEntraAdminLogin' -Value $signedInUser.login
    $sqlEntraAdminObjectId = Set-Answer -Name 'SqlEntraAdminObjectId' -Value $signedInUser.id
}
else {
    $sqlEntraAdminLogin = Prompt-String -Name 'SqlEntraAdminLogin' -Question 'SQL Entra admin user principal name or group display name' -Required
    $sqlEntraAdminObjectId = Prompt-String -Name 'SqlEntraAdminObjectId' -Question 'SQL Entra admin object ID' -Required
}

$existingSqlServerName = ''
$existingSqlServerResourceGroupName = ''
$existingSqlDatabaseName = ''
if (Prompt-YesNo -Name 'UseExistingSql' -Question 'Does the customer already have an Azure SQL server to reuse?' -DefaultValue $false) {
    $existingSqlServerName = Prompt-String -Name 'ExistingSqlServerName' -Question 'Existing SQL server name' -Required
    $existingSqlServerResourceGroupName = Prompt-String -Name 'ExistingSqlServerResourceGroupName' -Question 'Existing SQL server resource group' -DefaultValue $resourceGroupName
    if (Prompt-YesNo -Name 'UseExistingSqlDatabase' -Question 'Reuse an existing SQL database on that server?' -DefaultValue $false) {
        $existingSqlDatabaseName = Prompt-String -Name 'ExistingSqlDatabaseName' -Question 'Existing SQL database name' -Required
    }
}

$existingKeyVaultName = ''
$existingKeyVaultResourceGroupName = ''
$keyVaultNameOverride = ''
if (Prompt-YesNo -Name 'UseExistingKeyVault' -Question 'Does the customer already have a Key Vault to reuse?' -DefaultValue $false) {
    $existingKeyVaultName = Prompt-String -Name 'ExistingKeyVaultName' -Question 'Existing Key Vault name' -Required
    $existingKeyVaultResourceGroupName = Prompt-String -Name 'ExistingKeyVaultResourceGroupName' -Question 'Existing Key Vault resource group' -DefaultValue $resourceGroupName
}
elseif ($provider -eq 'Terraform') {
    $keyVaultNameOverride = Prompt-String -Name 'KeyVaultNameOverride' -Question 'Optional Key Vault name override for Terraform soft-delete/name conflicts'
}

$existingWorkerStorageAccountName = ''
$existingWorkerStorageResourceGroupName = ''
if (Prompt-YesNo -Name 'UseExistingWorkerStorage' -Question 'Does the customer already have a worker storage account to reuse?' -DefaultValue $false) {
    $existingWorkerStorageAccountName = Prompt-String -Name 'ExistingWorkerStorageAccountName' -Question 'Existing worker storage account name' -Required
    $existingWorkerStorageResourceGroupName = Prompt-String -Name 'ExistingWorkerStorageResourceGroupName' -Question 'Existing worker storage account resource group' -DefaultValue $resourceGroupName
}

$existingVirtualNetworkName = ''
$existingVirtualNetworkResourceGroupName = ''
$existingAppServiceIntegrationSubnetName = ''
$existingPrivateEndpointSubnetName = ''
if (Prompt-YesNo -Name 'UseExistingVirtualNetwork' -Question 'Does the customer already have a Virtual Network to reuse?' -DefaultValue $false) {
    $existingVirtualNetworkName = Prompt-String -Name 'ExistingVirtualNetworkName' -Question 'Existing Virtual Network name' -Required
    $existingVirtualNetworkResourceGroupName = Prompt-String -Name 'ExistingVirtualNetworkResourceGroupName' -Question 'Existing Virtual Network resource group' -DefaultValue $resourceGroupName
    $existingAppServiceIntegrationSubnetName = Prompt-String -Name 'ExistingAppServiceIntegrationSubnetName' -Question 'Subnet delegated to Microsoft.Web/serverFarms' -Required
    $existingPrivateEndpointSubnetName = Prompt-String -Name 'ExistingPrivateEndpointSubnetName' -Question 'Private endpoint subnet name' -Required
}

$rbacMode = Prompt-Choice -Name 'RbacMode' -Question 'How should Azure RBAC scope be configured?' -Choices @('Use all accessible management groups', 'Specify management group names', 'Specify subscription IDs', 'Skip RBAC assignments') -DefaultValue 'Specify management group names'
$useAllAccessibleManagementGroups = $false
$webReaderManagementGroupNames = @()
$webQuotaWriterManagementGroupNames = @()
$workerRbacManagementGroupNames = @()
$webReaderSubscriptionIds = @()
$webQuotaWriterSubscriptionIds = @()
$workerRbacSubscriptionIds = @()
$quotaManagementGroupId = ''

if ($rbacMode -eq 'Use all accessible management groups') {
    $useAllAccessibleManagementGroups = $true
    $quotaManagementGroupId = Prompt-String -Name 'QuotaManagementGroupId' -Question 'Optional default quota management group ID/name'
}
elseif ($rbacMode -eq 'Specify management group names') {
    $webReaderManagementGroupNames = Prompt-List -Name 'WebReaderManagementGroupNames' -Question 'Management group names for Web App Reader access (comma-separated)'
    $workerRbacManagementGroupNames = Prompt-List -Name 'WorkerRbacManagementGroupNames' -Question 'Management group names for worker RBAC (comma-separated)' -DefaultValue $webReaderManagementGroupNames
    $quotaManagementGroupId = Prompt-String -Name 'QuotaManagementGroupId' -Question 'Default quota management group ID/name' -DefaultValue (@($webReaderManagementGroupNames) | Select-Object -First 1)
    if (Prompt-YesNo -Name 'EnableQuotaWriteRbac' -Question 'Grant quota write RBAC for quota apply workflows now?' -DefaultValue $false) {
        $webQuotaWriterManagementGroupNames = Prompt-List -Name 'WebQuotaWriterManagementGroupNames' -Question 'Management group names for GroupQuota Request Operator (comma-separated)' -DefaultValue $webReaderManagementGroupNames
    }
}
elseif ($rbacMode -eq 'Specify subscription IDs') {
    $webReaderSubscriptionIds = Prompt-List -Name 'WebReaderSubscriptionIds' -Question 'Subscription IDs for Web App Reader access (comma-separated)'
    $workerRbacSubscriptionIds = Prompt-List -Name 'WorkerRbacSubscriptionIds' -Question 'Subscription IDs for worker RBAC (comma-separated)' -DefaultValue $webReaderSubscriptionIds
    if (Prompt-YesNo -Name 'EnableQuotaWriteRbac' -Question 'Grant quota write RBAC for quota apply workflows now?' -DefaultValue $false) {
        $webQuotaWriterSubscriptionIds = Prompt-List -Name 'WebQuotaWriterSubscriptionIds' -Question 'Subscription IDs for GroupQuota Request Operator (comma-separated)' -DefaultValue $webReaderSubscriptionIds
    }
}

$assignWorkerComputeRecommendationsRole = Prompt-YesNo -Name 'AssignWorkerComputeRecommendationsRole' -Question 'Assign worker Compute Recommendations Role?' -DefaultValue $true
$assignWorkerCostManagementReaderRole = Prompt-YesNo -Name 'AssignWorkerCostManagementReaderRole' -Question 'Assign worker Cost Management Reader Role?' -DefaultValue $true
$assignWorkerBillingReaderRole = Prompt-YesNo -Name 'AssignWorkerBillingReaderRole' -Question 'Assign worker Billing Reader Role?' -DefaultValue $true

$ingestApiKey = ''
if (Prompt-YesNo -Name 'ProvideIngestApiKey' -Question 'Provide an existing INGEST_API_KEY instead of letting deployment resolve/generate one?' -DefaultValue $false) {
    $ingestApiKey = Prompt-Secret -Name 'IngestApiKey' -Question 'INGEST_API_KEY value' -Required
}

$sessionSecret = ''
if (Prompt-YesNo -Name 'ProvideSessionSecret' -Question 'Provide an existing SESSION_SECRET instead of letting deployment resolve/generate one?' -DefaultValue $false) {
    $sessionSecret = Prompt-Secret -Name 'SessionSecret' -Question 'SESSION_SECRET value' -Required
}

$workerSecretMode = Prompt-Choice -Name 'WorkerSharedSecretMode' -Question 'Worker shared secret handling?' -Choices @('Generate', 'Provide existing', 'Skip') -DefaultValue 'Generate'
$workerSharedSecret = ''
if ($workerSecretMode -eq 'Generate') {
    $workerSharedSecret = Set-Answer -Name 'WorkerSharedSecret' -Value (New-GeneratedSecret -ByteCount 32)
}
elseif ($workerSecretMode -eq 'Provide existing') {
    $workerSharedSecret = Prompt-Secret -Name 'WorkerSharedSecret' -Question 'CAPACITY_WORKER_SHARED_SECRET / WORKER_SHARED_SECRET value' -Required
}

$deployWebApp = Prompt-YesNo -Name 'DeployWebApp' -Question 'Deploy the dashboard web package after infrastructure succeeds?' -DefaultValue $true
$skipWebAppTests = $false
if ($deployWebApp -and -not (Test-CommandAvailable 'npm')) {
    Write-Warning 'npm was not found on PATH. The web package can still be deployed, but the pre-deploy npm test gate will be skipped on this machine.'
    $skipWebAppTests = Set-Answer -Name 'SkipWebAppTests' -Value $true
}
$deployWorkerApp = Prompt-YesNo -Name 'DeployWorkerApp' -Question 'Deploy the worker package after infrastructure succeeds?' -DefaultValue $true
$defaultBootstrap = [string]::IsNullOrWhiteSpace($existingSqlServerName) -and [string]::IsNullOrWhiteSpace($existingVirtualNetworkName)
$applyDatabaseBootstrap = Prompt-YesNo -Name 'ApplyDatabaseBootstrap' -Question 'Run database bootstrap through the deployed web app?' -DefaultValue $defaultBootstrap
if ($applyDatabaseBootstrap -and -not $deployWebApp) {
    Write-Warning 'Database bootstrap uses the deployed web app package. It will be skipped because web package deployment is disabled.'
    $applyDatabaseBootstrap = Set-Answer -Name 'ApplyDatabaseBootstrap' -Value $false
}

$deployArguments = New-Object System.Collections.ArrayList
Add-DeployArgument -Arguments $deployArguments -Name '-Provider' -Value $provider
Add-DeployArgument -Arguments $deployArguments -Name '-ResourceGroupName' -Value $resourceGroupName
Add-DeployArgument -Arguments $deployArguments -Name '-Location' -Value $location
Add-DeployArgument -Arguments $deployArguments -Name '-Environment' -Value $environment
Add-DeployArgument -Arguments $deployArguments -Name '-WorkloadSuffix' -Value $workloadSuffix
Add-DeployArgument -Arguments $deployArguments -Name '-ParameterFile' -Value $parameterFile
Add-DeployArgument -Arguments $deployArguments -Name '-SqlEntraAdminLogin' -Value $sqlEntraAdminLogin
Add-DeployArgument -Arguments $deployArguments -Name '-SqlEntraAdminObjectId' -Value $sqlEntraAdminObjectId
Add-DeployArgument -Arguments $deployArguments -Name '-WorkerSharedSecret' -Value $workerSharedSecret
Add-DeployArgument -Arguments $deployArguments -Name '-WebReaderSubscriptionIds' -Value $webReaderSubscriptionIds
Add-DeployArgument -Arguments $deployArguments -Name '-WebReaderManagementGroupNames' -Value $webReaderManagementGroupNames
Add-DeployArgument -Arguments $deployArguments -Name '-WebQuotaWriterSubscriptionIds' -Value $webQuotaWriterSubscriptionIds
Add-DeployArgument -Arguments $deployArguments -Name '-WebQuotaWriterManagementGroupNames' -Value $webQuotaWriterManagementGroupNames
Add-DeployArgument -Arguments $deployArguments -Name '-QuotaManagementGroupId' -Value $quotaManagementGroupId
Add-DeployArgument -Arguments $deployArguments -Name '-KeyVaultNameOverride' -Value $keyVaultNameOverride
Add-DeployArgument -Arguments $deployArguments -Name '-ExistingSqlServerName' -Value $existingSqlServerName
Add-DeployArgument -Arguments $deployArguments -Name '-ExistingSqlServerResourceGroupName' -Value $existingSqlServerResourceGroupName
Add-DeployArgument -Arguments $deployArguments -Name '-ExistingSqlDatabaseName' -Value $existingSqlDatabaseName
Add-DeployArgument -Arguments $deployArguments -Name '-ExistingKeyVaultName' -Value $existingKeyVaultName
Add-DeployArgument -Arguments $deployArguments -Name '-ExistingKeyVaultResourceGroupName' -Value $existingKeyVaultResourceGroupName
Add-DeployArgument -Arguments $deployArguments -Name '-ExistingWorkerStorageAccountName' -Value $existingWorkerStorageAccountName
Add-DeployArgument -Arguments $deployArguments -Name '-ExistingWorkerStorageResourceGroupName' -Value $existingWorkerStorageResourceGroupName
Add-DeployArgument -Arguments $deployArguments -Name '-ExistingVirtualNetworkName' -Value $existingVirtualNetworkName
Add-DeployArgument -Arguments $deployArguments -Name '-ExistingVirtualNetworkResourceGroupName' -Value $existingVirtualNetworkResourceGroupName
Add-DeployArgument -Arguments $deployArguments -Name '-ExistingAppServiceIntegrationSubnetName' -Value $existingAppServiceIntegrationSubnetName
Add-DeployArgument -Arguments $deployArguments -Name '-ExistingPrivateEndpointSubnetName' -Value $existingPrivateEndpointSubnetName
Add-DeployArgument -Arguments $deployArguments -Name '-WorkerRbacSubscriptionIds' -Value $workerRbacSubscriptionIds
Add-DeployArgument -Arguments $deployArguments -Name '-WorkerRbacManagementGroupNames' -Value $workerRbacManagementGroupNames
Add-DeployArgument -Arguments $deployArguments -Name '-AssignWorkerComputeRecommendationsRole' -Value $assignWorkerComputeRecommendationsRole
Add-DeployArgument -Arguments $deployArguments -Name '-AssignWorkerCostManagementReaderRole' -Value $assignWorkerCostManagementReaderRole
Add-DeployArgument -Arguments $deployArguments -Name '-AssignWorkerBillingReaderRole' -Value $assignWorkerBillingReaderRole
Add-DeployArgument -Arguments $deployArguments -Name '-AuthEnabled' -Value $authEnabled
Add-DeployArgument -Arguments $deployArguments -Name '-EntraTenantId' -Value $entraTenantId
Add-DeployArgument -Arguments $deployArguments -Name '-EntraClientId' -Value $entraClientId
Add-DeployArgument -Arguments $deployArguments -Name '-EntraClientSecret' -Value $entraClientSecret
Add-DeployArgument -Arguments $deployArguments -Name '-AuthRedirectUri' -Value $authRedirectUri
Add-DeployArgument -Arguments $deployArguments -Name '-ManageEntraWebRedirectUri' -Value $manageEntraWebRedirectUri -Switch
Add-DeployArgument -Arguments $deployArguments -Name '-AdminGroupId' -Value $adminGroupId
Add-DeployArgument -Arguments $deployArguments -Name '-ReportViewerGroupIds' -Value $reportViewerGroupIds
Add-DeployArgument -Arguments $deployArguments -Name '-CreateMissingEntraAccessGroups' -Value $createMissingGroups
Add-DeployArgument -Arguments $deployArguments -Name '-SubscriptionId' -Value $subscriptionId
Add-DeployArgument -Arguments $deployArguments -Name '-UseAllAccessibleManagementGroups' -Value $useAllAccessibleManagementGroups -Switch
Add-DeployArgument -Arguments $deployArguments -Name '-RandomizeWorkloadSuffixOnNameConflict' -Value $randomizeNames
Add-DeployArgument -Arguments $deployArguments -Name '-DeployWebApp' -Value $deployWebApp
Add-DeployArgument -Arguments $deployArguments -Name '-SkipWebAppTests' -Value $skipWebAppTests
Add-DeployArgument -Arguments $deployArguments -Name '-DeployWorkerApp' -Value $deployWorkerApp
Add-DeployArgument -Arguments $deployArguments -Name '-ApplyDatabaseBootstrap' -Value $applyDatabaseBootstrap
Add-DeployArgument -Arguments $deployArguments -Name '-IngestApiKey' -Value $ingestApiKey
Add-DeployArgument -Arguments $deployArguments -Name '-SessionSecret' -Value $sessionSecret

$expectedFunctionAppName = "func-capdash-$environment-$workloadSuffix-appsvc"
$plan = [ordered]@{
    Provider = $provider
    Subscription = $subscriptionId
    ResourceGroup = $resourceGroupName
    Location = $location
    Environment = $environment
    WorkloadSuffix = $workloadSuffix
    ExpectedWebAppName = $expectedWebAppName
    ExpectedFunctionAppName = $expectedFunctionAppName
    RandomizeNameConflict = $randomizeNames
    AuthEnabled = $authEnabled
    AuthRedirectUri = if ($authEnabled) { $authRedirectUri } else { 'Auth disabled' }
    AccessGroupMode = if ($authEnabled) { Get-Answer -Name 'AccessGroupMode' -DefaultValue '(not set)' } else { 'Auth disabled' }
    ExistingSql = if ([string]::IsNullOrWhiteSpace($existingSqlServerName)) { 'No' } else { $existingSqlServerName }
    ExistingKeyVault = if ([string]::IsNullOrWhiteSpace($existingKeyVaultName)) { 'No' } else { $existingKeyVaultName }
    ExistingWorkerStorage = if ([string]::IsNullOrWhiteSpace($existingWorkerStorageAccountName)) { 'No' } else { $existingWorkerStorageAccountName }
    ExistingVirtualNetwork = if ([string]::IsNullOrWhiteSpace($existingVirtualNetworkName)) { 'No' } else { $existingVirtualNetworkName }
    RbacMode = $rbacMode
    DeployWebApp = $deployWebApp
    SkipWebAppTests = $skipWebAppTests
    DeployWorkerApp = $deployWorkerApp
    ApplyDatabaseBootstrap = $applyDatabaseBootstrap
}

Show-Plan -Plan $plan
Show-CommandPreview -Arguments $deployArguments
Save-AnswerFile -Path $SaveAnswers
$supportedDeployParameterNames = Get-ScriptParameterNames -Path $deployScript
$deployParameters = ConvertTo-DeployParameterMap -Arguments $deployArguments -SupportedParameterNames $supportedDeployParameterNames

if ($PlanOnly) {
    Write-Host 'PlanOnly was specified; deployment was not started.' -ForegroundColor Yellow
    return
}

Test-AzureDeploymentPreflight `
    -SubscriptionId $subscriptionId `
    -AuthEnabled $authEnabled `
    -AccessGroupMode (Get-Answer -Name 'AccessGroupMode' -DefaultValue '') `
    -AdminGroupId $adminGroupId `
    -ReportViewerGroupIds $reportViewerGroupIds `
    -AdminGroupDisplayName 'CapacityAdmin' `
    -ReportViewerGroupDisplayName 'CapacityReportViewers' `
    -ExpectedWebAppName $expectedWebAppName `
    -ExpectedFunctionAppName $expectedFunctionAppName

if ($PreflightOnly) {
    Write-Host 'PreflightOnly was specified; deployment was not started.' -ForegroundColor Yellow
    return
}

if (-not $NonInteractive) {
    $proceed = Prompt-YesNo -Name 'ProceedWithDeployment' -Question 'Proceed with deployment now?' -DefaultValue $false
    if (-not $proceed) {
        Write-Host 'Deployment cancelled by operator.' -ForegroundColor Yellow
        return
    }
}

Write-Host 'Starting deployment...' -ForegroundColor Cyan
& $deployScript @deployParameters