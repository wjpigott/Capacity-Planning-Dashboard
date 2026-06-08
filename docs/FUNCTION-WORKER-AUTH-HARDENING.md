# Function Worker Auth Hardening Plan

## Current state

The dashboard Web App calls the worker Function App through `CAPACITY_WORKER_BASE_URL`.
The current verified contract is:

- Web App sends `x-capacity-worker-key` from `CAPACITY_WORKER_SHARED_SECRET`.
- Function App PowerShell code validates that header against `WORKER_SHARED_SECRET`.
- Worker HTTP triggers use `authLevel: anonymous` so the request reaches the PowerShell validator.
- Function App public ingress is now intended to be disabled through a private endpoint and `privatelink.azurewebsites.net` DNS.

This means network access is private, but application authentication is still a shared-secret contract.

## Security finding options

### Option 1: Function keys

Set each HTTP trigger `authLevel` to `function` or `admin` and have the Web App send a Function key using `x-functions-key` or `?code=`.

Pros:

- Satisfies policies that only check HTTP trigger `authLevel`.
- Smaller code change than full Microsoft Entra authentication.

Cons:

- Does not remove secrets; it replaces `WORKER_SHARED_SECRET` with Function host/function keys.
- Those keys still need secure storage, rotation, and deployment handling.
- Key Vault is still needed unless another secret storage pattern is adopted.
- `admin` auth level is broader than needed and should be avoided for normal worker calls.

Verdict: acceptable as a policy compatibility step, but not a real secretless design.

### Option 2: App Service Authentication / Microsoft Entra auth

Enable Function App Authentication and require Microsoft Entra tokens before requests reach the PowerShell functions. The Web App should call the worker with a managed-identity bearer token instead of a shared secret.

Pros:

- Removes the worker shared secret from the dashboard-to-worker contract.
- Lets the Function App accept only tokens from the dashboard Web App managed identity.
- Aligns with private endpoint ingress for a stronger defense-in-depth model.

Cons:

- Requires careful identity-provider configuration, token audience selection, and app setting rollout.
- The previous managed-identity worker-auth attempt broke the dev baseline, so this must be implemented behind explicit feature flags and tested with fallback controls.
- Does not remove all Key Vault usage by itself.

Verdict: preferred long-term approach, but implement incrementally.

## Does this remove Key Vault?

No, not by itself.

Moving dashboard-to-worker authentication to Microsoft Entra can remove these worker-specific secrets:

- `CAPACITY_WORKER_SHARED_SECRET`
- `WORKER_SHARED_SECRET`
- `capdash-worker-shared-secret`

Key Vault is still useful or required for the current app because other secrets remain:

- `ENTRA_CLIENT_SECRET` for the dashboard's custom Express sign-in flow.
- `SESSION_SECRET` for Express session protection.
- `INGEST_API_KEY` for internal diagnostics/bootstrap/ingestion routes.

Key Vault could only be removed after separate redesigns for dashboard user auth, session signing, and internal route authorization.

## Recommended branch implementation

Implement Microsoft Entra worker auth as an opt-in path first.

1. Add new app settings:
   - `CAPACITY_WORKER_AUTH_MODE=shared-secret|entra`
   - `CAPACITY_WORKER_TOKEN_AUDIENCE=<Function App app ID URI or application/client ID audience>`
   - `CAPACITY_WORKER_ALLOWED_CLIENT_ID=<dashboard Web App managed identity client ID or object ID>` if app-code validation remains useful for diagnostics.
2. Update Web App worker clients:
   - `src/services/livePlacementService.js`
   - `src/services/paasAvailabilityService.js`
   - any future worker callers
3. When `CAPACITY_WORKER_AUTH_MODE=entra`, acquire a token with `DefaultAzureCredential` for `CAPACITY_WORKER_TOKEN_AUDIENCE` and send `Authorization: Bearer <token>`.
4. Keep shared-secret mode as the default until dev/test prove the Entra path is stable.
5. Add Function App Authentication to infra only when Entra worker mode is enabled:
   - Microsoft identity provider.
   - Require authentication for unauthenticated requests.
   - Allowed token audience configured to the worker app registration / app ID URI.
   - Restrict accepted callers to the dashboard Web App managed identity where the platform supports it; otherwise validate claims in function code.
6. Keep Function trigger `authLevel: anonymous` for Easy Auth mode because App Service Authentication gates requests before PowerShell runs.
7. Optionally support `authLevel: function` as a separate `function-key` mode for customers whose policy explicitly requires Functions keys.
8. Run smoke tests with `CAPACITY_WORKER_DISABLE_LOCAL_FALLBACK=true` so failures cannot hide behind local fallback.

## Required test gates

Before merging this branch, validate all of the following:

- Public Function App calls are blocked by private endpoint/public access settings.
- Web App-to-Function calls succeed with `source: function-worker` and `executionMode: function-app`.
- Same tests pass with `CAPACITY_WORKER_DISABLE_LOCAL_FALLBACK=true`.
- Live placement worker path returns rows or clear Azure API errors.
- Recommendations worker path succeeds when direct API mode is disabled for the test.
- PaaS availability worker path returns and persists rows.
- A request without a bearer token is rejected before function code executes in Entra mode.
- A request with the wrong audience or caller is rejected.
- Existing shared-secret deployments continue to work when `CAPACITY_WORKER_AUTH_MODE=shared-secret`.

## Branch guardrail

Do not remove `WORKER_SHARED_SECRET`, `CAPACITY_WORKER_SHARED_SECRET`, or the Key Vault worker secret until the Entra worker mode is verified in dev and test. Remove them only in a follow-up cleanup after the auth mode is changed by default.