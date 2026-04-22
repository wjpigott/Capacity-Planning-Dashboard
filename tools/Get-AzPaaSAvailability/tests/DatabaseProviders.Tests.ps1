#Requires -Modules Pester

BeforeAll {
    $moduleRoot = Join-Path $PSScriptRoot '..' 'AzPaaSAvailability'
    Get-ChildItem "$moduleRoot\Private" -Recurse -Filter '*.ps1' | ForEach-Object { . $_.FullName }
}

Describe 'Get-PostgreSqlCapabilities' {
    BeforeAll {
        function Invoke-WithRetry { param($ScriptBlock, $MaxRetries, $OperationName) & $ScriptBlock }
        Mock Invoke-RestMethod {
            return @{
                value = @(@{
                    name = 'FlexibleServerCapabilities'
                    supportedServerEditions = @(
                        @{
                            name = 'Burstable'
                            supportedStorageEditions = @(@{ name = 'ManagedDisk' }, @{ name = 'ManagedDiskV2' })
                            supportedServerSkus = @(
                                @{ name = 'Standard_B1ms'; vCores = 1; supportedIops = 640; supportedMemoryPerVcoreMb = 2048; supportedZones = '1 2 3'; supportedHaMode = 'SameZone' },
                                @{ name = 'Standard_B2s'; vCores = 2; supportedIops = 1280; supportedMemoryPerVcoreMb = 2048; supportedZones = '1 2'; supportedHaMode = 'SameZone' }
                            )
                        },
                        @{
                            name = 'MemoryOptimized'
                            supportedStorageEditions = @(@{ name = 'ManagedDisk' })
                            supportedServerSkus = @(
                                @{ name = 'Standard_E2ds_v5'; vCores = 2; supportedIops = 3200; supportedMemoryPerVcoreMb = 8192; supportedZones = '1 2 3'; supportedHaMode = 'ZoneRedundant' }
                            )
                        }
                    )
                })
            }
        }
    }

    It 'parses all editions' {
        $results = Get-PostgreSqlCapabilities -Region westus2 -SubscriptionId 'test' -AccessToken 'test'
        $results | Should -HaveCount 3
    }

    It 'parses vCores correctly' {
        $results = Get-PostgreSqlCapabilities -Region westus2 -SubscriptionId 'test' -AccessToken 'test'
        ($results | Where-Object { $_.SKU -eq 'Standard_B1ms' }).vCores | Should -Be 1
    }

    It 'calculates memory from vCores * memPerVcore' {
        $results = Get-PostgreSqlCapabilities -Region westus2 -SubscriptionId 'test' -AccessToken 'test'
        ($results | Where-Object { $_.SKU -eq 'Standard_E2ds_v5' }).MemoryGB | Should -Be 16
    }

    It 'parses zone support from space-separated string' {
        $results = Get-PostgreSqlCapabilities -Region westus2 -SubscriptionId 'test' -AccessToken 'test'
        ($results | Where-Object { $_.SKU -eq 'Standard_B1ms' }).Zones | Should -Be '1,2,3'
        ($results | Where-Object { $_.SKU -eq 'Standard_B1ms' }).ZoneRedundant | Should -BeTrue
    }

    It 'detects non-zone-redundant (< 3 zones)' {
        $results = Get-PostgreSqlCapabilities -Region westus2 -SubscriptionId 'test' -AccessToken 'test'
        ($results | Where-Object { $_.SKU -eq 'Standard_B2s' }).ZoneRedundant | Should -BeFalse
    }

    It 'filters by edition' {
        $results = Get-PostgreSqlCapabilities -Region westus2 -SubscriptionId 'test' -AccessToken 'test' -EditionFilter @('MemoryOptimized')
        $results | Should -HaveCount 1
        $results[0].Edition | Should -Be 'MemoryOptimized'
    }

    It 'joins storage editions' {
        $results = Get-PostgreSqlCapabilities -Region westus2 -SubscriptionId 'test' -AccessToken 'test' -EditionFilter @('Burstable')
        $results[0].StorageEditions | Should -Be 'ManagedDisk,ManagedDiskV2'
    }
}

Describe 'Get-MySqlCapabilities' {
    BeforeAll {
        function Invoke-WithRetry { param($ScriptBlock, $MaxRetries, $OperationName) & $ScriptBlock }
        Mock Invoke-RestMethod {
            return @{
                value = @(@{
                    zone = 'none'
                    supportedHAMode = @('SameZone')
                    supportedGeoBackupRegions = @('westcentralus')
                    supportedFlexibleServerEditions = @(
                        @{
                            name = 'Burstable'
                            supportedStorageEditions = @(@{ name = 'Premium'; minStorageSize = 20480; maxStorageSize = 16777216 })
                            supportedServerVersions = @(
                                @{ name = '8.0.21'; supportedSkus = @(
                                    @{ name = 'Standard_B1ms'; vCores = 1; supportedIops = 640; supportedMemoryPerVCoreMB = 2048 },
                                    @{ name = 'Standard_B2ms'; vCores = 2; supportedIops = 1700; supportedMemoryPerVCoreMB = 4096 }
                                )},
                                @{ name = '8.4'; supportedSkus = @(
                                    @{ name = 'Standard_B1ms'; vCores = 1; supportedIops = 640; supportedMemoryPerVCoreMB = 2048 }
                                )}
                            )
                        }
                    )
                })
            }
        }
    }

    It 'parses all SKU/version combos' {
        $results = Get-MySqlCapabilities -Region westus2 -SubscriptionId 'test' -AccessToken 'test'
        $results | Should -HaveCount 3
    }

    It 'includes server version per row' {
        $results = Get-MySqlCapabilities -Region westus2 -SubscriptionId 'test' -AccessToken 'test'
        ($results | Where-Object { $_.ServerVersion -eq '8.4' }) | Should -HaveCount 1
    }

    It 'calculates memory correctly' {
        $results = Get-MySqlCapabilities -Region westus2 -SubscriptionId 'test' -AccessToken 'test'
        ($results | Where-Object { $_.SKU -eq 'Standard_B2ms' -and $_.ServerVersion -eq '8.0.21' }).MemoryGB | Should -Be 8
    }

    It 'parses geo backup regions' {
        $results = Get-MySqlCapabilities -Region westus2 -SubscriptionId 'test' -AccessToken 'test'
        $results[0].GeoBackup | Should -Be 'westcentralus'
    }

    It 'filters by version' {
        $results = Get-MySqlCapabilities -Region westus2 -SubscriptionId 'test' -AccessToken 'test' -VersionFilter @('8.4')
        $results | Should -HaveCount 1
    }

    It 'calculates max storage in GB' {
        $results = Get-MySqlCapabilities -Region westus2 -SubscriptionId 'test' -AccessToken 'test'
        $results[0].MaxStorageGB | Should -Be 16384
    }
}
