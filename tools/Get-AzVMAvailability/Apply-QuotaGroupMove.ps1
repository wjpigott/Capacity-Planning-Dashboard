[CmdletBinding()]
<#
.SYNOPSIS
    Applies quota-group move plan rows from a previously generated CSV plan.

.DESCRIPTION
    Reads an AzVMAvailability quota-group move plan CSV, filters to rows marked
    ReadyToApply, and submits Microsoft.Quota allocation PATCH requests for the
    selected management group and group quota.

    This script is the dedicated state-changing entry point for quota moves.
    Get-AzVMAvailability.ps1 can still be used with -QuotaGroupApply for
    backward compatibility, and now delegates apply execution here.

.EXAMPLE
    .\Apply-QuotaGroupMove.ps1 -PlanFile .\AzVMAvailability-QuotaGroupMove-20260417-101500.csv -QuotaGroupManagementGroupName Demo-MG -QuotaGroupName standardBStesting

.EXAMPLE
    .\Apply-QuotaGroupMove.ps1 -PlanFile .\AzVMAvailability-QuotaGroupMove-20260417-101500.csv -QuotaGroupManagementGroupName Demo-MG -QuotaGroupName standardBStesting -QuotaGroupForceConfirm -QuotaGroupApplyMaxChanges 25
#>
param(
    [Parameter(Mandatory = $true, HelpMessage = "Path to a quota-group move plan CSV")]
    [string]$PlanFile,

    [Parameter(Mandatory = $true, HelpMessage = "Target management group name for quota-group apply")]
    [Alias("QuotaGroupManagementGroupId")]
    [string]$QuotaGroupManagementGroupName,

    [Parameter(Mandatory = $true, HelpMessage = "Target quota group name for quota-group apply")]
    [string]$QuotaGroupName,

    [Parameter(Mandatory = $false, HelpMessage = "Directory path for quota-group apply CSV report output")]
    [string]$QuotaGroupReportPath,

    [Parameter(Mandatory = $false, HelpMessage = "Skip interactive confirmation for quota-group apply")]
    [switch]$QuotaGroupForceConfirm,

    [Parameter(Mandatory = $false, HelpMessage = "Safety cap: max quota-family plan entries to apply in one run")]
    [Alias("QuotaGroupApplyMaxRows")]
    [ValidateRange(1, 10000)]
    [int]$QuotaGroupApplyMaxChanges = 100,

    [Parameter(Mandatory = $false, HelpMessage = "Azure Resource Manager endpoint for the current cloud")]
    [string]$ArmUrl = 'https://management.azure.com',

    [Parameter(Mandatory = $false, HelpMessage = "Quota API version to use for group quota operations")]
    [string]$QuotaApiVersion = '2025-09-01',

    [Parameter(Mandatory = $false, HelpMessage = "Maximum retry attempts for transient apply errors")]
    [ValidateRange(0, 10)]
    [int]$MaxRetries = 3,

    [Parameter(Mandatory = $false, HelpMessage = "Emit apply results as JSON in addition to writing the CSV report")]
    [switch]$JsonOutput
)

$ProgressPreference = 'SilentlyContinue'
$script:SuppressConsole = $JsonOutput.IsPresent

$privateRoot = Join-Path (Join-Path $PSScriptRoot 'AzVMAvailability') 'Private'
. (Join-Path (Join-Path $privateRoot 'Azure') 'Invoke-WithRetry.ps1')
. (Join-Path (Join-Path $privateRoot 'Azure') 'QuotaGroupApply.ps1')

try {
    $resolvedPlanFile = (Resolve-Path -LiteralPath $PlanFile -ErrorAction Stop).Path
    $resolvedReportPath = if ($QuotaGroupReportPath) {
        $QuotaGroupReportPath
    }
    else {
        Split-Path -Parent $resolvedPlanFile
    }
    $resolvedArmUrl = $ArmUrl.TrimEnd('/')
    $planRows = @(Import-QuotaGroupMovePlan -ResolvedPlanFile $resolvedPlanFile)
    $quotaBearerToken = if (-not [string]::IsNullOrWhiteSpace($env:CAPACITY_QUOTA_BEARER_TOKEN)) {
        $env:CAPACITY_QUOTA_BEARER_TOKEN
    }
    else {
        Get-QuotaApiBearerToken -ArmUrl $resolvedArmUrl
    }
    $result = Invoke-QuotaGroupMoveApply -PlanRows $planRows -ResolvedPlanFile $resolvedPlanFile -ResolvedReportPath $resolvedReportPath -ResolvedArmUrl $resolvedArmUrl -ResolvedQuotaApiVersion $QuotaApiVersion -ResolvedManagementGroup $QuotaGroupManagementGroupName -ResolvedQuotaGroupName $QuotaGroupName -BearerToken $quotaBearerToken -ResolvedMaxChanges $QuotaGroupApplyMaxChanges -ResolvedMaxRetries $MaxRetries -SkipConfirmation $QuotaGroupForceConfirm.IsPresent -SuppressConsole $script:SuppressConsole
    if ($JsonOutput) {
        $result | ConvertTo-Json -Depth 6
    }
}
catch {
    throw "Quota-group apply failed: $($_.Exception.Message)"
}