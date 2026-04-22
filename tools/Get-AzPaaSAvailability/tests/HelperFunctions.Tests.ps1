#Requires -Modules Pester

BeforeAll {
    $moduleRoot = Join-Path $PSScriptRoot '..' 'AzPaaSAvailability'
    # Dot-source private functions for direct testing
    Get-ChildItem "$moduleRoot\Private" -Recurse -Filter '*.ps1' | ForEach-Object { . $_.FullName }
    Get-ChildItem "$moduleRoot\Public" -Recurse -Filter '*.ps1' | ForEach-Object { . $_.FullName }
}

Describe 'Get-SafeString' {
    It 'returns empty string for null' {
        Get-SafeString -Value $null | Should -Be ''
    }
    It 'unwraps single-element array' {
        Get-SafeString -Value @('hello') | Should -Be 'hello'
    }
    It 'unwraps nested arrays' {
        Get-SafeString -Value @(@('deep')) | Should -Be 'deep'
    }
    It 'converts int to string' {
        Get-SafeString -Value 42 | Should -Be '42'
    }
}

Describe 'Get-GeoGroup' {
    It 'maps eastus to Americas-US' {
        Get-GeoGroup -LocationCode 'eastus' | Should -Be 'Americas-US'
    }
    It 'maps westeurope to Europe' {
        Get-GeoGroup -LocationCode 'westeurope' | Should -Be 'Europe'
    }
    It 'maps usgovvirginia to Americas-USGov' {
        Get-GeoGroup -LocationCode 'usgovvirginia' | Should -Be 'Americas-USGov'
    }
    It 'maps japaneast to Asia-Pacific' {
        Get-GeoGroup -LocationCode 'japaneast' | Should -Be 'Asia-Pacific'
    }
    It 'maps unknown to Other' {
        Get-GeoGroup -LocationCode 'marscolony1' | Should -Be 'Other'
    }
}

Describe 'Resolve-IconSet' {
    It 'returns hashtable with Check, Warning, Error keys' {
        $icons = Resolve-IconSet
        $icons.Keys | Should -Contain 'Check'
        $icons.Keys | Should -Contain 'Warning'
        $icons.Keys | Should -Contain 'Error'
    }
    It 'returns ASCII when forced' {
        $icons = Resolve-IconSet -ForceAscii
        $icons.Check | Should -Be '[+]'
        $icons.Warning | Should -Be '[!]'
        $icons.Error | Should -Be '[-]'
    }
}

Describe 'Get-StatusIcon' {
    BeforeAll {
        $icons = @{ Check = '✓'; Warning = '⚠'; Error = '✗' }
    }
    It 'returns Check for boolean true' {
        Get-StatusIcon -Result $true -Icons $icons | Should -Be '✓'
    }
    It 'returns Error for boolean false' {
        Get-StatusIcon -Result $false -Icons $icons | Should -Be '✗'
    }
    It 'returns Check for Available status' {
        Get-StatusIcon -Result 'Available' -Icons $icons | Should -Be '✓'
    }
    It 'returns Warning for Visible status' {
        Get-StatusIcon -Result 'Visible' -Icons $icons | Should -Be '⚠'
    }
    It 'returns Error for Disabled status' {
        Get-StatusIcon -Result 'Disabled' -Icons $icons | Should -Be '✗'
    }
}

Describe 'Get-StatusColor' {
    It 'returns Green for Available' {
        Get-StatusColor -Status 'Available' | Should -Be 'Green'
    }
    It 'returns Green for Default' {
        Get-StatusColor -Status 'Default' | Should -Be 'Green'
    }
    It 'returns Yellow for Visible' {
        Get-StatusColor -Status 'Visible' | Should -Be 'Yellow'
    }
    It 'returns Red for Disabled' {
        Get-StatusColor -Status 'Disabled' | Should -Be 'Red'
    }
    It 'returns Gray for unknown' {
        Get-StatusColor -Status 'SomethingElse' | Should -Be 'Gray'
    }
}
