# Function Worker Auth Hardening Plan

## Current state

The dashboard Web App calls the worker Function App through `CAPACITY_WORKER_BASE_URL`.
The current verified contract is:

- Web App sends `x-capacity-worker-key` from `CAPACITY_WORKER_SHARED_SECRET`.
- Function App PowerShell code validates that header against `WORKER_SHARED_SECRET`.
- Worker HTTP triggers use `authLevel: anonymous` so the request reaches the PowerShell validator.
- Function App public ingress is now intended to be disabled through a private endpoint and `privatelink.azurewebsites.net` DNS.

This means network access is private, but application authentication is still a shared-secret contract.

The Defender for Cloud API authentication recommendation also evaluates successful HTTP traffic for common authentication evidence such as `Authorization` headers. Custom headers such as `x-ingest-key` may protect a route in app code but can still appear non-compliant to that recommendation if successful calls do not include a bearer token.

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

## Isolated validation results

The isolated auth-hardening deployment uses separate app instances so the stable dev baseline is not affected:

- Web App: `app-capdash-auth-dev-cap001`
- Function App: `func-capdash-auth-dev-cap001-appsvc`
- Worker audience: `api://95a70edd-af8d-4343-9929-414050e778c0`
- Web App API audience: `api://003c43d4-57fa-4781-9c64-d58f34ccdd82`

Validated Web App settings:

- App Service Authentication enabled on the isolated Web App.
- Unauthenticated action is `Return401`.
- Microsoft Entra provider uses dashboard app registration `003c43d4-57fa-4781-9c64-d58f34ccdd82`.
- `INGEST_EASY_AUTH_BEARER_ENABLED=true` allows internal routes to trust Easy Auth bearer-authenticated requests.
- `INGEST_API_KEY_ENABLED=false` disables `x-ingest-key` fallback on the isolated Web App so successful internal calls require `Authorization: Bearer`.

Validated Function App settings:

- App Service Authentication enabled on the isolated Function App.
- Unauthenticated action is `Return401`.
- Microsoft Entra provider uses worker app registration `95a70edd-af8d-4343-9929-414050e778c0`.
- Public network access is blocked by the Function private endpoint posture; direct public function calls returned `403`.

Validated traffic behavior:

- Anonymous Web App requests to `/`, `/api/auth/me`, `/api/capacity`, and `/internal/diagnostics/capacity-read?target=subscriptions` returned `401`.
- `x-ingest-key` alone returned `401` against isolated internal diagnostics.
- `Authorization: Bearer` requests returned `200` for `/api/auth/me` and `/internal/diagnostics/capacity-read?target=subscriptions`.
- Bearer-authenticated PaaS refresh succeeded with `source: function-worker`, `executionMode: function-app`, `rowCount: 149`, and `persistedRowCount: 149`.
- Bearer-authenticated live placement succeeded with `executionMode: function-app`, `transport: arm-rest`, and 5 rows.
- Bearer-authenticated recommendations succeeded with `executionMode: function-app` and 3 rows.

The dashboard app registration was exposed as an API for isolated bearer-token validation by adding `api://003c43d4-57fa-4781-9c64-d58f34ccdd82` and a `user_impersonation` delegated scope. The isolated Web App Easy Auth policy temporarily allows the Azure CLI public client application ID `04b07795-8ddb-461a-bbee-02f9e1bf7b46` for command-line smoke tests; replace that with the intended calling clients before production rollout.

## Rollout notes

Keep `INGEST_API_KEY_ENABLED` defaulting to `true` so existing dev/test/prod deployments are not broken by this branch. Set it to `false` only after the target environment has Web App Easy Auth enabled and bearer-token automation paths are verified.

For production hardening, prefer a dedicated internal automation client or managed identity caller rather than allowing broad public clients for internal diagnostics. The isolated validation used Azure CLI only to prove Defender-style `Authorization: Bearer` traffic can reach the app without relying on `x-ingest-key`.

## IaC and documentation tracker

Track these changes together before promoting Easy Auth to test or production:

| Area | Current branch status | Follow-up before production default |
|---|---|---|
| Web App Easy Auth | Validated manually on isolated Web App. App code can consume Easy Auth principal headers. | Add Bicep and Terraform App Service Authentication resources/settings for Web App, including allowed audiences and intended internal automation clients. |
| Function App Easy Auth | Validated manually on isolated Function App. Web App can call worker with managed-identity bearer token. | Add Bicep and Terraform App Service Authentication resources/settings for Function App and document the worker audience app registration. |
| Worker shared secret | Shared-secret mode remains default and backward compatible. | Make `CAPACITY_WORKER_AUTH_MODE=entra` the environment default only after dev/test validation, then stop prompting for `workerSharedSecret` / `worker_shared_secret` in Easy Auth mode. |
| Internal ingest key | `INGEST_API_KEY_ENABLED=false` was validated on isolated Web App with bearer-authenticated internal diagnostics. | Update deployment/bootstrap automation to use bearer tokens before removing or making `INGEST_API_KEY` optional in Easy Auth environments. |
| Entra client secret | Still required by the current custom Express auth-code flow. | If Web App Easy Auth becomes the only browser sign-in path, remove the custom Express secret requirement and update prompts/docs accordingly. |
| Session secret | Still required while Express sessions are used. | Re-evaluate after browser auth is fully delegated to Easy Auth and any remaining session-backed features are removed or redesigned. |
| Key Vault secrets | Still used for `ENTRA_CLIENT_SECRET`, `INGEST_API_KEY`, `SESSION_SECRET`, and shared-secret fallback. | Remove only the secrets no longer referenced by app settings in the target auth mode; keep Key Vault for any remaining runtime secrets. |
| Function worker storage private endpoints | Bicep and Terraform now include default-on worker storage private endpoint support for blob, queue, table, and file services. | Deploy and validate DNS/connectivity in dev/test before disabling or restricting public storage access in existing environments. |
| Deployment docs | This tracker and infra READMEs identify the auth/storage changes. | Update top-level README, installer prompts, customer prereqs, and deployment examples when the IaC Easy Auth resources are added. |

## Branch guardrail

Do not remove `WORKER_SHARED_SECRET`, `CAPACITY_WORKER_SHARED_SECRET`, or the Key Vault worker secret until the Entra worker mode is verified in dev and test. Remove them only in a follow-up cleanup after the auth mode is changed by default.