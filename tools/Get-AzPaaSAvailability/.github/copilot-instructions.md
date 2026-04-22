# GitHub Copilot Instructions

## Tech Stack & Architecture

- **Primary Language:** PowerShell 7+
- **Cloud Platform:** Microsoft Azure (requires Az.Accounts module)
- **Purpose:** Scans Azure regions for PaaS service availability, SKUs, capacity, quota, and pricing.
- **Architecture:** PowerShell module (`AzPaaSAvailability/`) with Public/Private function layout + backward-compatible wrapper script.

## Key Files & Directories

- `Get-AzPaaSAvailability.ps1`: Wrapper script (interactive prompts, JSON output, export delegation)
- `AzPaaSAvailability/`: Module directory
  - `AzPaaSAvailability.psd1`: Module manifest (v0.5.0)
  - `AzPaaSAvailability.psm1`: Auto-loader (Utility → Azure → Providers → Format → Public)
  - `Public/`: 13 exported functions (orchestrator, 9 service scanners, matrix, tiers, export)
  - `Private/Azure/`: Bearer token, retry, endpoints, pricing
  - `Private/Providers/`: 11 provider-specific API functions
  - `Private/Format/`: Display output formatting
  - `Private/Utility/`: SafeString, GeoGroup, StatusIcon, IconSet
- `tests/`: 51 Pester tests across 4 files
- `docs/`: Build guide and service inventory

## Build, Test, and Run

- **Run (wrapper):** `.\Get-AzPaaSAvailability.ps1`
- **Run (module):** `Import-Module ./AzPaaSAvailability; Get-AzPaaSAvailability -Region eastus`
- **Test:** `Invoke-Pester ./tests -Output Detailed`
- **Lint:** `Invoke-ScriptAnalyzer -Path . -Recurse -Settings PSScriptAnalyzerSettings.psd1`

## Code Conventions

- Use `#region`/`#endregion` for section organization
- Comments explain *why*, not *what*
- Named constants for magic numbers
- Every `catch` block must handle the error visibly (`Write-Host` guarded by `-not $Quiet`, or `Write-Verbose`)
- API calls use `Invoke-WithRetry` for resilience
- Public functions go in `Public/`, private in `Private/`

## Branch Protection

- Main branch is protected from deletion and requires PRs for changes.
- Copilot code review is enabled on push.

## Related Projects

- [Get-AzVMAvailability](https://github.com/zacharyluz/Get-AzVMAvailability) — VM SKU capacity scanning
- [Get-AzAIModelAvailability](https://github.com/zacharyluz/Get-AzAIModelAvailability) — AI model availability scanning
