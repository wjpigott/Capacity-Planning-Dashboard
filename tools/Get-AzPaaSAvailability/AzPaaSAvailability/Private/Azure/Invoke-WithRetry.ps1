function Invoke-WithRetry {
    <#
    .SYNOPSIS
        Executes a script block with retry logic for transient Azure API errors.
    .DESCRIPTION
        Retries on HTTP 429 (Too Many Requests), 503 (Service Unavailable),
        network timeouts, and WebExceptions. Uses exponential backoff with jitter.
    .PARAMETER ScriptBlock
        The code to execute.
    .PARAMETER MaxRetries
        Maximum retry attempts. Default: 3.
    .PARAMETER OperationName
        Descriptive name for verbose/warning messages.
    #>
    param(
        [Parameter(Mandatory)][scriptblock]$ScriptBlock,
        [int]$MaxRetries = 3,
        [string]$OperationName = 'API call'
    )

    $attempt = 0
    while ($true) {
        try {
            return & $ScriptBlock
        }
        catch {
            $attempt++
            $ex = $_.Exception
            $isRetryable = $false
            $waitSeconds = [math]::Pow(2, $attempt)

            $statusCode = if ($ex.Response) { $ex.Response.StatusCode.value__ } else { $null }
            if ($statusCode -eq 429 -or $ex.Message -match '429|Too Many Requests') {
                $isRetryable = $true
                if ($ex.Response -and $ex.Response.Headers) {
                    $retryAfter = $ex.Response.Headers['Retry-After']
                    if ($retryAfter -and [int]::TryParse($retryAfter, [ref]$null)) {
                        $waitSeconds = [int]$retryAfter
                    }
                }
            }
            elseif ($statusCode -eq 503 -or $ex.Message -match '503|Service Unavailable') {
                $isRetryable = $true
            }
            elseif ($ex -is [System.Net.WebException] -or
                $ex -is [System.Net.Http.HttpRequestException] -or
                $ex.InnerException -is [System.Net.WebException] -or
                $ex.InnerException -is [System.Net.Http.HttpRequestException] -or
                $ex.Message -match 'timed?\s*out|connection.*reset|connection.*refused') {
                $isRetryable = $true
            }

            if (-not $isRetryable -or $attempt -ge $MaxRetries) { throw }

            $jitter = Get-Random -Minimum 0 -Maximum ([math]::Max(1, [int]($waitSeconds * 0.25)))
            $waitSeconds += $jitter

            Write-Verbose "$OperationName failed (attempt $attempt/$MaxRetries): $($ex.Message). Retrying in ${waitSeconds}s..."
            Start-Sleep -Seconds $waitSeconds
        }
    }
}
