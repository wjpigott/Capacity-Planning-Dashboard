<#
.SYNOPSIS
    Tear down Capacity Dashboard infrastructure.

.DESCRIPTION
    Destroys all Azure resources provisioned by the deploy-infra.ps1 script.
    Supports both Bicep (deletes the resource group) and Terraform (terraform destroy).

.EXAMPLE
    # Terraform destroy
    .\scripts\destroy-infra.ps1 -Provider Terraform

.EXAMPLE
    # Bicep / resource-group destroy
    .\scripts\destroy-infra.ps1 -Provider Bicep -ResourceGroupName "<resource-group-name>"
#>
param(
    [Parameter(Mandatory = $false)][ValidateSet('Bicep','Terraform')][string]$Provider = 'Bicep',
    [Parameter(Mandatory = $false)][string]$ResourceGroupName,
    [Parameter(Mandatory = $false)][string]$SubscriptionId,
    [Parameter(Mandatory = $false)][switch]$Force
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if ($SubscriptionId) {
    az account set --subscription $SubscriptionId | Out-Null
}

if ($Provider -eq 'Terraform') {
    $tfDir = Join-Path $repoRoot 'infra' 'terraform'
    if (-not (Test-Path (Join-Path $tfDir 'main.tf'))) {
        throw "Terraform files not found at $tfDir"
    }

    $terraform = Get-Command terraform -ErrorAction SilentlyContinue
    if (-not $terraform) {
        throw 'Terraform CLI is required for -Provider Terraform. Install from https://developer.hashicorp.com/terraform/downloads'
    }

    Push-Location $tfDir
    try {
        terraform init -input=false
        if ($LASTEXITCODE -ne 0) { throw 'terraform init failed' }

        # Supply placeholder values for required variables that have no defaults.
        # Terraform needs all variables set even for destroy, but actual values are
        # irrelevant since the destroy plan reads everything from state.
        $destroyVars = @(
            '-var=sql_entra_admin_login=destroy-placeholder',
            '-var=sql_entra_admin_object_id=00000000-0000-0000-0000-000000000000'
        )

        if (-not $Force) {
            Write-Host "Running Terraform plan -destroy to preview what will be removed..." -ForegroundColor Yellow
            terraform plan -destroy -input=false @destroyVars
            if ($LASTEXITCODE -ne 0) { throw 'terraform plan -destroy failed' }

            $confirm = Read-Host "`nProceed with destroy? (yes/no)"
            if ($confirm -ne 'yes') {
                Write-Host "Destroy cancelled." -ForegroundColor Cyan
                return
            }
        }

        Write-Host "Running Terraform destroy..." -ForegroundColor Yellow
        terraform destroy -auto-approve -input=false @destroyVars
        if ($LASTEXITCODE -ne 0) { throw 'terraform destroy failed' }

        Write-Host "Terraform destroy completed successfully." -ForegroundColor Green
    }
    finally {
        Pop-Location
    }

    # Clean up the resource group if it still exists in Azure (e.g. created
    # outside of Terraform state by a prior Bicep deploy or manual action).
    $rgName = if ($ResourceGroupName) { $ResourceGroupName } else { $env:AZURE_RESOURCE_GROUP }
    if ([string]::IsNullOrWhiteSpace($rgName)) {
        throw "Provide -ResourceGroupName or set AZURE_RESOURCE_GROUP."
    }
    $rgExists = az group exists --name $rgName -o tsv 2>$null
    if ($rgExists -eq 'true') {
        Write-Host "Resource group '$rgName' still exists outside Terraform state. Deleting..." -ForegroundColor Yellow
        az group delete --name $rgName --yes --no-wait
        if ($LASTEXITCODE -ne 0) { throw "Failed to delete resource group '$rgName'" }
        Write-Host "Resource group deletion initiated (--no-wait)." -ForegroundColor Green
    }
}
else {
    if ([string]::IsNullOrWhiteSpace($ResourceGroupName)) {
        throw '-ResourceGroupName is required when using -Provider Bicep (resource group deletion).'
    }

    if (-not $Force) {
        Write-Host "This will delete the entire resource group '$ResourceGroupName' and all resources within it." -ForegroundColor Yellow
        $confirm = Read-Host "Proceed? (yes/no)"
        if ($confirm -ne 'yes') {
            Write-Host "Destroy cancelled." -ForegroundColor Cyan
            return
        }
    }

    Write-Host "Deleting resource group '$ResourceGroupName'..." -ForegroundColor Yellow
    az group delete --name $ResourceGroupName --yes --no-wait
    if ($LASTEXITCODE -ne 0) { throw "Failed to delete resource group '$ResourceGroupName'" }

    Write-Host "Resource group deletion initiated (--no-wait). Monitor in the Azure portal or run:" -ForegroundColor Green
    Write-Host "  az group show --name $ResourceGroupName --query properties.provisioningState -o tsv"
}
