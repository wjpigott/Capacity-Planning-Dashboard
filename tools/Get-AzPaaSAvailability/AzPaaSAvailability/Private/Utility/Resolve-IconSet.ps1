function Resolve-IconSet {
    <#
    .SYNOPSIS
        Returns the icon set based on terminal Unicode support detection.
    .PARAMETER ForceAscii
        If true, returns ASCII icons regardless of terminal capability.
    #>
    param([switch]$ForceAscii)

    $supportsUnicode = -not $ForceAscii -and (
        $Host.UI.SupportsVirtualTerminal -or
        $env:WT_SESSION -or
        $env:TERM_PROGRAM -eq 'vscode' -or
        ($env:TERM -and $env:TERM -match 'xterm|256color')
    )

    if ($supportsUnicode) {
        return @{ Check = [char]0x2713; Warning = [char]0x26A0; Error = [char]0x2717 }
    }
    else {
        return @{ Check = '[+]'; Warning = '[!]'; Error = '[-]' }
    }
}
