function Get-SafeString {
    <#
    .SYNOPSIS
        Safely converts a value to string, unwrapping arrays from parallel execution.
    #>
    param([object]$Value)
    if ($null -eq $Value) { return '' }
    while ($Value -is [array] -and $Value.Count -gt 0) { $Value = $Value[0] }
    if ($null -eq $Value) { return '' }
    return "$Value"
}
