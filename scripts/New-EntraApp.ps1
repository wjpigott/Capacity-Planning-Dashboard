<#
.SYNOPSIS
    Creates a multi-tenant Entra ID (Azure AD) app registration for the
    Capacity Planning Dashboard and outputs the values needed for .env.local.

.DESCRIPTION
    This script:
      1. Connects to Microsoft Graph using your current credentials.
      2. Creates a multi-tenant application registration (AzureADMultipleOrgs)
         with minimal delegated permissions: openid, profile, email.
      3. Enables the 'groups' claim in the ID token (SecurityGroup) so the
         server can check Entra group membership for admin gating.
      4. Registers a redirect URI for local development and optionally for
         your Azure App Service.
      5. Creates a client secret (valid 1 year).
      6. Outputs the five settings to copy into .env.local.

.PARAMETER AppName
    Display name for the app registration. Defaults to 'Capacity Planning Dashboard'.

.PARAMETER LocalRedirectUri
    OAuth2 redirect URI for local development.
    Defaults to 'http://localhost:3000/auth/callback'.

.PARAMETER ProductionRedirectUri
    OAuth2 redirect URI for the deployed Azure App Service.
    Example: 'https://<web-app-name>.azurewebsites.net/auth/callback'
    Leave empty to skip.

.EXAMPLE
    .\New-EntraApp.ps1

.EXAMPLE
    .\New-EntraApp.ps1 -ProductionRedirectUri 'https://<web-app-name>.azurewebsites.net/auth/callback'

.NOTES
    Requires the Microsoft.Graph PowerShell SDK.
    Install with: Install-Module Microsoft.Graph -Scope CurrentUser
    The script requests the 'Application.ReadWrite.All' Graph scope.
    No admin consent is needed for the app itself — openid/profile/email
    are user-consentable standard OIDC scopes.
#>

[CmdletBinding()]
param(
    [string]$AppName = 'Capacity Planning Dashboard',
    [string]$LocalRedirectUri = 'http://localhost:3000/auth/callback',
    [string]$ProductionRedirectUri = ''
)

$ErrorActionPreference = 'Stop'

# ── Ensure Microsoft.Graph.Applications is available ─────────────────────────
$requiredModules = @('Microsoft.Graph.Applications', 'Microsoft.Graph.Authentication')
foreach ($mod in $requiredModules) {
    if (-not (Get-Module -ListAvailable -Name $mod)) {
        Write-Host "Installing $mod module..." -ForegroundColor Cyan
        Install-Module $mod -Scope CurrentUser -Force -AllowClobber
    }
}

Import-Module Microsoft.Graph.Applications -ErrorAction Stop
Import-Module Microsoft.Graph.Authentication -ErrorAction Stop

# ── Connect ───────────────────────────────────────────────────────────────────
Write-Host "`nConnecting to Microsoft Graph (Application.ReadWrite.All scope)..." -ForegroundColor Cyan
Connect-MgGraph -Scopes 'Application.ReadWrite.All' -NoWelcome

$context  = Get-MgContext
$tenantId = $context.TenantId
Write-Host "Connected to tenant: $tenantId ($($context.Account))" -ForegroundColor Green

# ── Build redirect URI list ───────────────────────────────────────────────────
$redirectUris = [System.Collections.Generic.List[string]]::new()
$redirectUris.Add($LocalRedirectUri)
if ($ProductionRedirectUri) {
    $redirectUris.Add($ProductionRedirectUri)
    Write-Host "Will register production redirect URI: $ProductionRedirectUri"
}

# ── Microsoft Graph resource and minimal OIDC scope GUIDs ────────────────────
# openid  = 37f7f235-527c-4136-accd-4a02d197296e
# profile = 14dad69e-099b-42c9-810b-d002981feec1
# email   = 64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0
$graphAppId = '00000003-0000-0000-c000-000000000000'
$oidcScopes = @(
    [Microsoft.Graph.PowerShell.Models.MicrosoftGraphResourceAccess]@{
        Id   = '37f7f235-527c-4136-accd-4a02d197296e'
        Type = 'Scope'
    },
    [Microsoft.Graph.PowerShell.Models.MicrosoftGraphResourceAccess]@{
        Id   = '14dad69e-099b-42c9-810b-d002981feec1'
        Type = 'Scope'
    },
    [Microsoft.Graph.PowerShell.Models.MicrosoftGraphResourceAccess]@{
        Id   = '64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0'
        Type = 'Scope'
    }
)

$requiredAccess = [Microsoft.Graph.PowerShell.Models.MicrosoftGraphRequiredResourceAccess]@{
    ResourceAppId  = $graphAppId
    ResourceAccess = $oidcScopes
}

# ── Create the app registration ───────────────────────────────────────────────
Write-Host "`nCreating app registration '$AppName'..." -ForegroundColor Cyan

$app = New-MgApplication `
    -DisplayName $AppName `
    -SignInAudience 'AzureADMultipleOrgs' `
    -Web @{
        RedirectUris = $redirectUris.ToArray()
    } `
    -RequiredResourceAccess @($requiredAccess) `
    -GroupMembershipClaims 'SecurityGroup'

Write-Host "App created: $($app.DisplayName)  |  AppId (client_id): $($app.AppId)" -ForegroundColor Green

# ── Create a service principal so the app appears in Enterprise Applications ──
Write-Host "Creating service principal..." -ForegroundColor Cyan
$sp = New-MgServicePrincipal -AppId $app.AppId
Write-Host "Service principal created: $($sp.Id)" -ForegroundColor Green

# ── Create a client secret (1 year) ──────────────────────────────────────────
Write-Host "Creating client secret (1-year expiry)..." -ForegroundColor Cyan
$secretParams = @{
    passwordCredential = @{
        displayName = "dashboard-local-$(Get-Date -Format 'yyyyMMdd')"
        endDateTime = (Get-Date).AddYears(1).ToUniversalTime().ToString('o')
    }
}
$secret = Add-MgApplicationPassword -ApplicationId $app.Id -BodyParameter $secretParams

# ── Output ───────────────────────────────────────────────────────────────────
Write-Host "`n============================================================" -ForegroundColor Green
Write-Host " App registration complete!  Copy these values into .env.local:" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "AUTH_ENABLED=true"
Write-Host "ENTRA_CLIENT_ID=$($app.AppId)"
Write-Host "ENTRA_TENANT_ID=$tenantId"
Write-Host "ENTRA_CLIENT_SECRET=$($secret.SecretText)"
Write-Host "ADMIN_GROUP_ID=<paste the Object ID of your admin Entra group here>"
Write-Host "AUTH_REDIRECT_URI=$LocalRedirectUri"
Write-Host "SESSION_SECRET=$(([System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))))"
Write-Host ""
Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "App Object ID (for portal/manifest edits): $($app.Id)" -ForegroundColor DarkGray
Write-Host "Service Principal Object ID:               $($sp.Id)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Paste the values above into your .env.local file."
Write-Host "  2. Find your admin Entra group Object ID in the Azure portal"
Write-Host "     (Entra ID > Groups > <your group> > Overview > Object ID)"
Write-Host "     and set ADMIN_GROUP_ID."
Write-Host "  3. Set AUTH_ENABLED=true in .env.local when ready to test locally."
if ($ProductionRedirectUri) {
    Write-Host "  4. Add the following App Service settings for production:"
    Write-Host "       AUTH_ENABLED=true"
    Write-Host "       ENTRA_CLIENT_ID=$($app.AppId)"
    Write-Host "       ENTRA_TENANT_ID=$tenantId"
    Write-Host "       ENTRA_CLIENT_SECRET=<same secret>"
    Write-Host "       ADMIN_GROUP_ID=<group Object ID>"
    Write-Host "       AUTH_REDIRECT_URI=$ProductionRedirectUri"
    Write-Host "       SESSION_SECRET=<generate a new one for production>"
}
Write-Host ""
Write-Host "IMPORTANT: The client secret is shown only once. Store it securely." -ForegroundColor Red
