# Contributing to Get-AzPaaSAvailability

> **This is a personal open-source project, not an official Microsoft product.** Contributing here does not create any relationship with, or obligation for, Microsoft.
> Please do not include confidential or internal information in issues, PRs, or discussions.

Thank you for your interest in contributing! This document provides guidelines for contributing to this project.

## How to Contribute

### Reporting Issues

- Check existing issues before creating a new one
- Use a clear, descriptive title
- Include PowerShell version, Az module versions, and OS
- Provide steps to reproduce the issue
- Include relevant error messages or screenshots

### Suggesting Enhancements

- Open an issue with the "enhancement" label
- Describe the use case and expected behavior
- Explain why this would be useful to other users

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly with different scenarios
5. Commit with clear messages (`git commit -m 'Add amazing feature'`)
6. Push to your branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### PR Description Formatting (Required)

- PR descriptions must render as valid Markdown in GitHub.
- Do not submit PR bodies with literal escaped newline sequences like `\n`.
- Use one of these safe patterns when creating/editing PRs from CLI:

```powershell
# Preferred: body file
gh pr create --title "..." --body-file pr-body.md

# Or: here-string variable (real newlines)
$body = @'
## Summary
...
'@
gh pr edit <pr-number> --body $body
```

- Verify formatting before merge:

```powershell
gh pr view <pr-number> --json body --jq .body
```

## Development Setup

```powershell
# Clone your fork
git clone https://github.com/zacharyluz/Get-AzPaaSAvailability.git
cd Get-AzPaaSAvailability

# Install dependencies
Install-Module -Name Az.Accounts -Scope CurrentUser
Install-Module -Name ImportExcel -Scope CurrentUser  # Optional, for XLSX export

# Import the module
Import-Module ./AzPaaSAvailability
```

## Code Style

- Use consistent indentation (4 spaces)
- Follow PowerShell best practices
- Add comments for complex logic — explain *why*, not *what*
- Use meaningful variable names
- Use `#region`/`#endregion` for section organization
- Public functions go in `Public/`, private in `Private/`

## Testing

Before submitting a PR, test with:

```powershell
# Run Pester tests
Invoke-Pester ./tests -Output Detailed

# Run PSScriptAnalyzer
Invoke-ScriptAnalyzer -Path . -Recurse -Settings PSScriptAnalyzerSettings.psd1

# Run validation script
.\tools\Validate-Script.ps1
```

Test scenarios should cover:
- Multiple regions
- Individual service scanners and the orchestrator
- Pipeline mode (`-Quiet`) and interactive mode
- Export to CSV and XLSX

## Keeping Tools Current

| Tool | What goes stale | How to prevent |
|------|-----------------|----------------|
| `tests/` | New functions without Pester coverage | Add tests for every new public function |
| `PSScriptAnalyzerSettings.psd1` | New rules not evaluated | Review periodically |
| `tools/Validate-Script.ps1` | New `.ps1` files not included in lint targets | Update targets when new scripts are added |

## Release Process Standard (Required)

For any change that updates `ModuleVersion` in `AzPaaSAvailability.psd1`:

1. Merge PR into `main`
2. Sync local `main` to `origin/main`
3. Create tag `vX.Y.Z` on the merge commit
4. Create GitHub Release from `CHANGELOG.md` section `## [X.Y.Z]`
5. Verify release metadata with `gh release list`

## Questions?

Feel free to [open an issue](https://github.com/ZacharyLuz/Get-AzPaaSAvailability/issues) on GitHub.
