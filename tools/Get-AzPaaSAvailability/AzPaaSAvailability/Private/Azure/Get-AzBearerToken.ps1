function Get-AzBearerToken {
    <#
    .SYNOPSIS
        Gets a bearer token for the specified Azure resource URL.
    .DESCRIPTION
        Wraps Get-AzAccessToken with secure string handling. Returns the plain-text
        token for use in Authorization headers.
    .PARAMETER ResourceUrl
        The Azure resource URL to get a token for (e.g., https://management.azure.com).
    #>
    param(
        [Parameter(Mandatory)][string]$ResourceUrl
    )

    $tokenObj = Get-AzAccessToken -ResourceUrl $ResourceUrl -AsSecureString -ErrorAction Stop
    return [System.Net.NetworkCredential]::new('', $tokenObj.Token).Password
}
