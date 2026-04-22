#Requires -Version 7.0

# AzPaaSAvailability module loader
# Dot-sources all Private then Public function files.

$ModuleRoot = $PSScriptRoot

# Import private functions first (order: Utility → Azure → Providers → Format)
$privatePaths = @(
    (Join-Path $ModuleRoot 'Private' 'Utility' '*.ps1'),
    (Join-Path $ModuleRoot 'Private' 'Azure' '*.ps1'),
    (Join-Path $ModuleRoot 'Private' 'Providers' '*.ps1'),
    (Join-Path $ModuleRoot 'Private' 'Format' '*.ps1')
)

foreach ($path in $privatePaths) {
    $files = Get-ChildItem -Path $path -ErrorAction SilentlyContinue
    foreach ($file in $files) {
        try {
            . $file.FullName
        }
        catch {
            Write-Warning "Failed to import private function $($file.Name): $($_.Exception.Message)"
        }
    }
}

# Import public functions
$publicPath = Join-Path $ModuleRoot 'Public' '*.ps1'
$publicFiles = Get-ChildItem -Path $publicPath -ErrorAction SilentlyContinue

foreach ($file in $publicFiles) {
    try {
        . $file.FullName
    }
    catch {
        Write-Warning "Failed to import public function $($file.Name): $($_.Exception.Message)"
    }
}

# Export public functions (also declared in psd1 for safety)
if ($publicFiles) {
    Export-ModuleMember -Function ($publicFiles.BaseName)
}
