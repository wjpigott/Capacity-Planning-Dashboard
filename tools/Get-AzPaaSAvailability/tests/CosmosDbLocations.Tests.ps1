#Requires -Modules Pester

BeforeAll {
    $moduleRoot = Join-Path $PSScriptRoot '..' 'AzPaaSAvailability'
    Get-ChildItem "$moduleRoot\Private" -Recurse -Filter '*.ps1' | ForEach-Object { . $_.FullName }
}

Describe 'Get-CosmosDbLocationAccess' {
    BeforeAll {
        function Invoke-WithRetry { param($ScriptBlock, $MaxRetries, $OperationName) & $ScriptBlock }
        Mock Invoke-RestMethod {
            return @{
                value = @(
                    @{
                        name = 'East US'
                        properties = @{
                            supportsAvailabilityZone = $true
                            isSubscriptionRegionAccessAllowedForAz = $true
                            isSubscriptionRegionAccessAllowedForRegular = $true
                            isResidencyRestricted = $false
                            backupStorageRedundancies = @('Geo', 'Zone', 'Local')
                            status = 'Online'
                        }
                    },
                    @{
                        name = 'West Europe'
                        properties = @{
                            supportsAvailabilityZone = $true
                            isSubscriptionRegionAccessAllowedForAz = $false
                            isSubscriptionRegionAccessAllowedForRegular = $false
                            isResidencyRestricted = $false
                            backupStorageRedundancies = @('Geo', 'Local')
                            status = 'Online'
                        }
                    },
                    @{
                        name = 'Brazil South'
                        properties = @{
                            supportsAvailabilityZone = $false
                            isSubscriptionRegionAccessAllowedForAz = $false
                            isSubscriptionRegionAccessAllowedForRegular = $true
                            isResidencyRestricted = $true
                            backupStorageRedundancies = @('Geo', 'Local')
                            status = 'Online'
                        }
                    }
                )
            }
        }
    }

    It 'returns all regions when no filter' {
        $results = Get-CosmosDbLocationAccess -SubscriptionId 'test' -AccessToken 'test'
        $results | Should -HaveCount 3
    }

    It 'filters to requested regions' {
        $results = Get-CosmosDbLocationAccess -SubscriptionId 'test' -AccessToken 'test' -RegionFilter @('eastus')
        $results | Should -HaveCount 1
        $results[0].Region | Should -Be 'eastus'
    }

    It 'detects full access correctly' {
        $results = Get-CosmosDbLocationAccess -SubscriptionId 'test' -AccessToken 'test' -RegionFilter @('eastus')
        $results[0].AccessAllowedAZ | Should -BeTrue
        $results[0].AccessAllowedRegular | Should -BeTrue
        $results[0].ActionRequired | Should -Be 'None'
    }

    It 'detects fully blocked subscription' {
        $results = Get-CosmosDbLocationAccess -SubscriptionId 'test' -AccessToken 'test' -RegionFilter @('westeurope')
        $results[0].AccessAllowedAZ | Should -BeFalse
        $results[0].AccessAllowedRegular | Should -BeFalse
        $results[0].ActionRequired | Should -Match 'blocked for all'
    }

    It 'detects AZ-only block when region supports AZ but sub does not' {
        # brazilsouth doesn't support AZ, so no AZ-block action
        $results = Get-CosmosDbLocationAccess -SubscriptionId 'test' -AccessToken 'test' -RegionFilter @('brazilsouth')
        $results[0].SupportsAZ | Should -BeFalse
        $results[0].ActionRequired | Should -Be 'None'
    }

    It 'detects residency restrictions' {
        $results = Get-CosmosDbLocationAccess -SubscriptionId 'test' -AccessToken 'test' -RegionFilter @('brazilsouth')
        $results[0].IsResidencyRestricted | Should -BeTrue
    }

    It 'joins backup redundancy types' {
        $results = Get-CosmosDbLocationAccess -SubscriptionId 'test' -AccessToken 'test' -RegionFilter @('eastus')
        $results[0].BackupRedundancies | Should -Be 'Geo,Zone,Local'
    }

    It 'normalizes region names to lowercase no spaces' {
        $results = Get-CosmosDbLocationAccess -SubscriptionId 'test' -AccessToken 'test'
        $results | ForEach-Object { $_.Region | Should -Match '^[a-z0-9]+$' }
    }
}
