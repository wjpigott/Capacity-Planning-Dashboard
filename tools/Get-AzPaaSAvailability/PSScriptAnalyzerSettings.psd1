@{
    Severity = @('Error', 'Warning')
    ExcludeRules = @(
        'PSAvoidUsingWriteHost'
        'PSUseSingularNouns'
        'PSUseBOMForUnicodeEncodedFile'
    )
    Rules = @{
        PSUseCompatibleSyntax = @{
            Enable = $true
            TargetVersions = @('7.0')
        }
    }
}
