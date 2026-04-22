function Get-StatusIcon {
    <#
    .SYNOPSIS
        Returns the appropriate icon for a status check.
    .PARAMETER Result
        Boolean or string indicating pass/fail/warning.
    .PARAMETER Icons
        Hashtable with Check, Warning, Error keys.
    #>
    param(
        [Parameter(Mandatory)]$Result,
        [Parameter(Mandatory)][hashtable]$Icons
    )
    if ($Result -is [bool]) {
        return $(if ($Result) { $Icons.Check } else { $Icons.Error })
    }
    switch ($Result) {
        'Available' { return $Icons.Check }
        'Default'   { return $Icons.Check }
        'Visible'   { return $Icons.Warning }
        'Disabled'  { return $Icons.Error }
        'Online'    { return $Icons.Check }
        'Blocked'   { return $Icons.Error }
        default     { return $Icons.Warning }
    }
}
