#Requires -Modules Pester

BeforeAll {
    $moduleRoot = Join-Path $PSScriptRoot '..' 'AzPaaSAvailability'
    Get-ChildItem "$moduleRoot\Private" -Recurse -Filter '*.ps1' | ForEach-Object { . $_.FullName }
}

Describe 'Get-SqlCapabilities' {
    BeforeAll {
        # Mock Invoke-WithRetry to return fake SQL capabilities data
        function Invoke-WithRetry { param($ScriptBlock, $MaxRetries, $OperationName) & $ScriptBlock }
    }

    Context 'SqlDatabase parsing' {
        BeforeAll {
            Mock Invoke-RestMethod {
                return @{
                    supportedServerVersions = @(@{
                        supportedEditions = @(
                            @{
                                name = 'System'; zoneRedundant = $false
                                supportedStorageCapabilities = @()
                                supportedServiceLevelObjectives = @(@{ name = 'SYS1'; status = 'Available'; sku = @{family='Sys'}; performanceLevel = @{value=1;unit='VCores'}; zoneRedundant = $false; computeModel = $null; supportedLicenseTypes = @(); supportedMaintenanceConfigurations = @() })
                            },
                            @{
                                name = 'GeneralPurpose'; zoneRedundant = $true
                                supportedStorageCapabilities = @(@{storageAccountType='LRS'},@{storageAccountType='ZRS'})
                                supportedServiceLevelObjectives = @(
                                    @{ name = 'GP_Gen5_2'; status = 'Available'; sku = @{family='Gen5';tier='GeneralPurpose';capacity=2}; performanceLevel = @{value=2;unit='VCores'}; zoneRedundant = $true; computeModel = 'Provisioned'; supportedLicenseTypes = @(@{name='LicenseIncluded'},@{name='BasePrice'}); supportedMaintenanceConfigurations = @(@{name='SQL_Default'}) },
                                    @{ name = 'GP_Gen5_4'; status = 'Visible'; sku = @{family='Gen5';tier='GeneralPurpose';capacity=4}; performanceLevel = @{value=4;unit='VCores'}; zoneRedundant = $true; computeModel = 'Provisioned'; supportedLicenseTypes = @(@{name='LicenseIncluded'}); supportedMaintenanceConfigurations = @() },
                                    @{ name = 'GP_Gen5_8'; status = 'Disabled'; sku = @{family='Gen5';tier='GeneralPurpose';capacity=8}; performanceLevel = @{value=8;unit='VCores'}; zoneRedundant = $false; computeModel = 'Provisioned'; supportedLicenseTypes = @(); supportedMaintenanceConfigurations = @() }
                                )
                            }
                        )
                    })
                }
            }
        }

        It 'filters out System edition' {
            $results = Get-SqlCapabilities -Region eastus -SubscriptionId 'test' -AccessToken 'test' -IncludeDisabledSkus
            $results | Where-Object { $_.Edition -eq 'System' } | Should -HaveCount 0
        }

        It 'returns Available/Default SKUs by default' {
            $results = Get-SqlCapabilities -Region eastus -SubscriptionId 'test' -AccessToken 'test'
            $results | Should -HaveCount 1
            $results[0].SKU | Should -Be 'GP_Gen5_2'
        }

        It 'returns all SKUs with -IncludeDisabledSkus' {
            $results = Get-SqlCapabilities -Region eastus -SubscriptionId 'test' -AccessToken 'test' -IncludeDisabledSkus
            $results | Should -HaveCount 3
        }

        It 'detects AHUB support from BasePrice license type' {
            $results = Get-SqlCapabilities -Region eastus -SubscriptionId 'test' -AccessToken 'test'
            $results[0].AHUBSupported | Should -BeTrue
        }

        It 'parses zone redundancy correctly' {
            $results = Get-SqlCapabilities -Region eastus -SubscriptionId 'test' -AccessToken 'test' -IncludeDisabledSkus
            ($results | Where-Object { $_.SKU -eq 'GP_Gen5_2' }).ZoneRedundant | Should -BeTrue
            ($results | Where-Object { $_.SKU -eq 'GP_Gen5_8' }).ZoneRedundant | Should -BeFalse
        }

        It 'applies edition filter' {
            $results = Get-SqlCapabilities -Region eastus -SubscriptionId 'test' -AccessToken 'test' -EditionFilter @('Hyperscale') -IncludeDisabledSkus
            $results | Should -HaveCount 0
        }

        It 'joins storage redundancy types' {
            $results = Get-SqlCapabilities -Region eastus -SubscriptionId 'test' -AccessToken 'test'
            $results[0].StorageRedundancy | Should -Be 'LRS,ZRS'
        }
    }
}

Describe 'Get-SqlSubscriptionUsages' {
    BeforeAll {
        function Invoke-WithRetry { param($ScriptBlock, $MaxRetries, $OperationName) & $ScriptBlock }
        Mock Invoke-RestMethod {
            return @{
                value = @(
                    @{ name = 'ServerQuota'; properties = @{ displayName = 'Server Quota'; currentValue = 5; limit = 20; unit = 'Count' } },
                    @{ name = 'RegionalVCoreQuotaForSQLDBAndDW'; properties = @{ displayName = 'vCore Quota'; currentValue = 24; limit = 100; unit = 'Count' } }
                )
            }
        }
    }

    It 'parses ServerQuota correctly' {
        $usages = Get-SqlSubscriptionUsages -Region eastus -SubscriptionId 'test' -AccessToken 'test'
        $usages['ServerQuota'].CurrentValue | Should -Be 5
        $usages['ServerQuota'].Limit | Should -Be 20
    }

    It 'parses vCore quota correctly' {
        $usages = Get-SqlSubscriptionUsages -Region eastus -SubscriptionId 'test' -AccessToken 'test'
        $usages['RegionalVCoreQuotaForSQLDBAndDW'].CurrentValue | Should -Be 24
        $usages['RegionalVCoreQuotaForSQLDBAndDW'].Limit | Should -Be 100
    }
}
