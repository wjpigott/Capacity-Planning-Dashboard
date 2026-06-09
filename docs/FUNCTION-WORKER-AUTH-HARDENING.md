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
   - Allowed token audience configured to the dashboard app registration app ID URI by default; a separate worker app registration remains an advanced option.
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

Clean new-tenant Easy Auth deployment path:

1. Create one dashboard app registration by default.
2. Add web redirect URIs for `https://<web-app>.azurewebsites.net/auth/callback` and `https://<web-app>.azurewebsites.net/.auth/login/aad/callback`.
3. Expose `api://<client-id>` and enable ID token issuance.
4. Emit Security Group Object IDs in the ID token.
5. Enable Web App Easy Auth with `RedirectToLoginPage` for browser sign-in.
6. Enable Function App Easy Auth and set `workerAuthMode=entra`; leave worker auth client/audience blank to reuse the dashboard app registration unless the tenant requires a separate worker app.
7. Let the deployment wrapper resolve the Web App managed identity application/client ID and add it to Function Easy Auth allowed applications after infrastructure deployment.
8. Allow the deployment wrapper to temporarily enable Function public network access only while publishing the worker zip, then restore the locked-down value.
9. Keep `INGEST_API_KEY_ENABLED=true` until the production automation caller is finalized.
10. For private SQL, bootstrap through the deployed Web App or run `initialize-database.ps1` from a private-network-connected admin host.

## IaC and documentation tracker

Track these changes together before promoting Easy Auth to test or production:

| Area | Current branch status | Follow-up before production default |
|---|---|---|
| Web App Easy Auth | Validated manually on isolated Web App. App code can consume Easy Auth principal headers. | Add Bicep and Terraform App Service Authentication resources/settings for Web App, including allowed audiences and intended internal automation clients. |
| Function App Easy Auth | Validated manually on isolated Function App. Web App can call worker with managed-identity bearer token. Bicep/Terraform now default the Function audience to the dashboard app registration when no worker-specific app is supplied. | Deploy and validate the one-app-registration path in dev/test; keep the separate worker app parameters only for stricter customer tenants. |
| Worker shared secret | Shared-secret mode remains default and backward compatible; deployment scripts skip worker shared-secret prompts/resolution when `WorkerAuthMode=entra`. | Make `CAPACITY_WORKER_AUTH_MODE=entra` the environment default only after dev/test validation. |
| Internal ingest key | `INGEST_API_KEY_ENABLED=false` was validated on isolated Web App with bearer-authenticated internal diagnostics. | Update deployment/bootstrap automation to use bearer tokens before removing or making `INGEST_API_KEY` optional in Easy Auth environments. |
| Entra client secret | Still required by the current custom Express auth-code flow. | If Web App Easy Auth becomes the only browser sign-in path, remove the custom Express secret requirement and update prompts/docs accordingly. |
| Session secret | Still required while Express sessions are used. | Re-evaluate after browser auth is fully delegated to Easy Auth and any remaining session-backed features are removed or redesigned. |
| Key Vault secrets | Still used for `ENTRA_CLIENT_SECRET`, `INGEST_API_KEY`, `SESSION_SECRET`, and shared-secret fallback. | Remove only the secrets no longer referenced by app settings in the target auth mode; keep Key Vault for any remaining runtime secrets. |
| Function worker storage private endpoints | Bicep and Terraform now include default-on worker storage private endpoint support for blob, queue, table, and file services. | Deploy and validate DNS/connectivity in dev/test before disabling or restricting public storage access in existing environments. |
| Deployment docs | This tracker, top-level README, infra READMEs, installer notes, and locked-down prereqs identify the auth/storage changes. | Update release notes and customer examples again after dev/test Easy Auth deployment validation. |

## Checklist for tomorrow

Completed before stopping:

- [x] Updated the top-level README to explain the branch Easy Auth validation, current secret implications, and worker storage private endpoint security posture.
- [x] Updated the worker README, install-demo script notes, locked-down customer prereqs, and root Terraform variable shim for worker storage private endpoint awareness.
- [x] Updated Mermaid architecture source and regenerated `docs/current-architecture.png` with Function Easy Auth and worker storage private endpoints.

Still needed:

- [x] Decide whether to encode Web App and Function App Easy Auth in this branch now or keep the current branch as an isolated proof and open a follow-up branch for IaC auth resources. Decision: this branch owns the full Easy Auth and infra deployment changes.
- [x] Add Bicep `authsettingsV2` resources for the Web App and Function App.
- [x] Add matching Terraform `auth_settings_v2` blocks/resources for the Web App and Function App, including allowed audiences and allowed client applications.
- [x] Make one app registration the preferred Easy Auth path by defaulting the worker Function App audience/client ID to the dashboard app registration when worker-specific values are omitted.
- [x] Validated a Bicep deployment in tenant `28ad7eb2-0ea4-40b8-99c2-cc6c124035d2`, resource group `CapacityAuthTest`, workload suffix `auth137`, with Web App Easy Auth, Function App Easy Auth, `workerAuthMode=entra`, no worker shared secrets, and worker storage private endpoints enabled.
- [x] Verified the deployed Web App and Function App raw `authsettingsV2` resources use `Return401`, shared client ID `863b537e-b53f-4538-9c26-fbdcd40c20f3`, and the shared audience `api://863b537e-b53f-4538-9c26-fbdcd40c20f3` for the Function App.
- [x] Fixed Bicep wrapper empty-array parameter serialization so optional array parameters are emitted as `[]` instead of an empty value.
- [x] Fixed Bicep wrapper single-item array serialization for Easy Auth and report-viewer parameters so Azure CLI receives valid JSON string arrays such as `["04b07795-8ddb-461a-bbee-02f9e1bf7b46"]` instead of `[04b07795-...]`.
- [x] Confirmed anonymous Web App `/api/auth/me` returns `401`; anonymous Function `/api/ping` returns `403` because the Function App public ingress is blocked by the private endpoint posture.
- [ ] Define the production-safe internal automation caller for bearer-authenticated internal endpoints; do not leave the isolated Azure CLI public client ID as the production allow-list.
- [x] Update `scripts/deploy-infra.ps1` and `scripts/Start-CapacityDeployment.ps1` with an explicit auth mode selection before changing any secret prompts.
- [x] Once an Easy Auth deployment mode exists, make `workerSharedSecret` / `worker_shared_secret` prompts conditional: required for `shared-secret`, skipped for `entra`.
- [ ] Once bootstrap automation can call internal endpoints with bearer tokens, make `INGEST_API_KEY` optional for Easy Auth deployments and keep it required for shared-secret/internal-key deployments.
- [ ] Decide whether Web App Easy Auth fully replaces the custom Express auth-code flow. If yes, remove the `ENTRA_CLIENT_SECRET` prompt/secret requirement for that mode and verify browser sign-in plus group claims through Easy Auth principal headers.
- [ ] Decide whether Express sessions are still required after Easy Auth becomes the browser sign-in path. If no, plan removal of `SESSION_SECRET`; if yes, keep it in Key Vault.
- [ ] Deploy the worker storage private endpoint IaC to dev and verify Function startup, DNS resolution, PaaS refresh, live placement, recommendations, and no storage public access dependency.
- [x] Add a practical deployment path for the Function worker package: when the target Function posture is private (`functionPublicNetworkAccess=Disabled`), the deployment wrapper can temporarily set Function public network access to `Enabled`, publish the worker zip, and lock it back down to `Disabled` in a `finally` block. This applies after both Bicep and Terraform infrastructure deployments.
- [x] Validate the temporary Function public access publish-and-lockdown flow against `func-capdash-dev-auth137-appsvc`; worker zip deployment succeeded, public access returned to `Disabled`, and Function endpoints were visible afterward.
- [x] Completed admin-assisted database bootstrap through Web App Easy Auth bearer authentication. Schema was applied, migrations through `20260608-add-paas-db-quota-report.sql` ran, phase-3 schema was ensured, and `app-capdash-dev-auth137` received `db_datareader` / `db_datawriter`.
- [x] Authenticated API probes succeeded for `/api/auth/me`, `/api/capacity`, and `/api/paas-availability/probe`.
- [x] Worker-backed PaaS refresh succeeded through Function App Easy Auth/private networking with `executionMode: function-app`, `rowCount: 149`, and `persistedRowCount: 149`.
- [x] Enabled Web App Easy Auth browser login on `app-capdash-dev-auth137` by adding the App Service callback URI `/.auth/login/aad/callback`, switching Web Easy Auth unauthenticated browser handling to `RedirectToLoginPage`, and enabling ID token issuance on the app registration.
- [x] Validated the Terraform Easy Auth path in resource group `Capacity-Terraform`, workload suffix `tfauth137`: Terraform infrastructure applied, web package deployed, worker package deployed with temporary public-access publish window and restored to `Disabled`, database bootstrap succeeded through Web App Easy Auth, browser login redirects, authenticated API probes passed, and worker-backed PaaS refresh persisted 149 rows with `executionMode: function-app`.
- [x] Updated the deployment wrapper to patch Function Easy Auth allowed applications with the Web App managed identity application/client ID after both Bicep and Terraform infrastructure deployments.
- [x] Destroyed and clean-redeployed the Terraform test environment after the wrapper patch. The clean run automatically patched Function Easy Auth with the Web App managed identity client ID, deployed the web package, deployed the worker package with temporary Function public access and restored `Disabled`, and completed schema bootstrap.
- [x] Fixed the deployment wrapper to grant Web App managed identity database roles through the admin-assisted bootstrap endpoint even when the normal schema bootstrap endpoint succeeds. The clean Terraform test then returned `/api/capacity` successfully and worker-backed PaaS refresh persisted 149 rows with `executionMode: function-app`.
- [x] Re-ran Terraform one final time after the bootstrap and array fixes. Final state: Function Easy Auth allow-list contained Web App managed identity client ID `a3678569-edde-49f1-b6cc-92e81c3beb63`, Function public access was `Disabled`, five worker functions were deployed, `/api/capacity` succeeded, and PaaS refresh persisted 149 rows with `executionMode: function-app` and no persistence warning.
- [x] Re-ran Bicep from a deleted `CapacityAuthTest` resource group. Required purging the soft-deleted Key Vault name after resource-group deletion and retrying once after Azure SQL server provisioning timed out. Final state: Web and worker packages deployed, Function public access was `Disabled`, five worker functions were deployed, Function Easy Auth allow-list contained Web App managed identity client ID `ea92a8a2-de72-4a21-839e-7c41efa8274e`, full admin bootstrap returned `ok:true`, `/api/capacity` succeeded, and PaaS refresh persisted 149 rows with `executionMode: function-app` and no persistence warning.
- [x] Fixed the database bootstrap wrapper to call Web Easy Auth-protected bootstrap endpoints with a dashboard bearer token and to validate JSON `ok:true` responses instead of treating login/HTML redirects as success.
- [x] Hardened Bicep wrapper ergonomics for repeat clean deployments: detect soft-deleted generated Key Vault names before ARM deployment, require explicit `-PurgeDeletedKeyVaultOnNameConflict $true` before purging, and retry the specific transient Azure SQL server provisioning timeout via `-BicepSqlProvisioningRetryCount`.
- [ ] Update `docs/current-architecture.drawio` to match the Mermaid/PNG architecture update, or treat Mermaid as the branch source of truth and regenerate Draw.io later.
- [ ] Update release notes and deployment examples again after Easy Auth IaC is complete.
- [ ] Run full validation: `npm test`, Bicep build, Terraform validate, wizard plan-only, isolated Web/Function smoke tests, and Defender-style anonymous/key-only/bearer probes.

## Branch guardrail

Do not remove `WORKER_SHARED_SECRET`, `CAPACITY_WORKER_SHARED_SECRET`, or the Key Vault worker secret until the Entra worker mode is verified in dev and test. Remove them only in a follow-up cleanup after the auth mode is changed by default.