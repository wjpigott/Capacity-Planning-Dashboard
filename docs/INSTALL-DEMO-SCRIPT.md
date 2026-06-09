# Capacity Dashboard Install Demo Script

Use this guide to record a practical end-user install walkthrough for the Capacity Planning Dashboard. The goal is to show an operator what they need before the install, what the guided wizard asks, how to answer the prompts, and how to prove the deployed app is ready for users.

Target length: 8 to 12 minutes.

## Demo Audience

This walkthrough is for a customer or internal operator who will deploy the dashboard into an Azure subscription. They do not need to understand every implementation detail, but they do need to know which Azure and Microsoft Entra decisions they own.

## Recording Setup

Before recording, prepare these values so the video can move cleanly:

- Azure subscription ID or name for the deployment.
- Azure region, such as `centralus`.
- Resource group name for the dashboard deployment.
- Workload suffix for generated resource names, such as `demo2` for a clean demo.
- Microsoft Entra tenant ID.
- Existing app registration client ID and client secret.
- App registration redirect URI plan: `https://app-capdash-<environment>-<suffix>.azurewebsites.net/auth/callback`.
- When Web App Easy Auth browser sign-in is enabled, also add `https://app-capdash-<environment>-<suffix>.azurewebsites.net/.auth/login/aad/callback` as a web redirect URI and enable ID token issuance for the app registration.
- Confirm the app registration emits Security Group Object IDs in the ID token: **Token configuration** > **Add groups claim** > **Security groups** > **ID** > **Group ID**.
- Confirm `CapacityAdmin` and `CapacityReportViewers` exist, or have approved group Object IDs ready.
- SQL Entra admin login and Object ID, or confirm the current Azure CLI user can be used.
- Management group names or subscription IDs for dashboard read access and worker RBAC.
- Decide whether this is a Bicep deployment or a Terraform deployment.

Keep the terminal in the canonical repo folder:

```powershell
cd C:\repos\Capacity\Capacity-Planning-Dashboard
```

## Opening Narration

"In this walkthrough, I am going to deploy the Capacity Planning Dashboard using the guided installer. The installer collects the Azure, Entra, SQL, RBAC, and packaging choices, previews the deployment command, runs preflight checks, then calls the deployment engine. By the end, we will have the dashboard web app, worker function app, database, Key Vault, monitoring resources, and the access groups wired up for sign-in."

## Scene 1: Show Prerequisites

Show a terminal and verify Azure CLI context:

```powershell
az account show --output table
```

Narration:

"The installer expects Azure CLI to be signed in to the tenant and subscription where the dashboard will be deployed. The deployment identity needs enough Azure permissions to create resources and assign roles. If central teams own Entra groups or management-group RBAC, the installer can still proceed, but those handoff steps need to be completed by the right owner."

Show the repo folder:

```powershell
pwd
git status -sb
```

Narration:

"I am running from the dashboard repo root so the script can find the infrastructure templates, web package, worker package, and database bootstrap assets."

## Scene 2: Start With a Plan Preview

Run the wizard in plan-only mode first:

```powershell
.\scripts\Start-CapacityDeployment.ps1 -PlanOnly
```

Narration:

"For a first pass, I like to run `PlanOnly`. That lets us answer the questions and review the command without changing Azure. It is the safest way to confirm naming, auth, RBAC, and package deployment choices before the real run."

## Scene 3: Infrastructure Provider Choice

Expected prompt:

```text
Which infrastructure provider should be used?
```

Suggested demo answer:

- Choose `Bicep` for the standard guided path.
- Choose `Terraform` only when this environment is intended to be Terraform-managed from the start, or after existing resources have been imported into Terraform state.
- For a Terraform demo, leave the optional parameter/tfvars file path blank unless the customer has a prepared `.tfvars` file.

Narration:

"The wizard supports both Bicep and Terraform. Bicep is the straightforward path for this demo. Terraform is available when the customer wants Terraform to own the environment, but Terraform will only manage resources that exist in its state. If an existing app was created by another method, do not point Terraform at the same names and expect it to ignore them. Import the resources first or use a new suffix for a clean Terraform deployment."

Terraform recording note:

"When I choose Terraform, the wrapper still collects the same deployment decisions. Behind the scenes, it writes those answers to Terraform variables and then runs `terraform init` followed by `terraform apply`. For a clean recording, I use a fresh workload suffix and leave the optional tfvars path empty."

## Scene 4: Subscription, Resource Group, Region, and Names

Expected prompts:

```text
Azure subscription ID or name
Resource group name
Azure region for new resources
Environment label?
Workload suffix for generated resource names
Randomize the workload suffix if an App Service host name is already taken?
```

Suggested demo answers:

- Environment: `dev`.
- Workload suffix: use a clean suffix such as `demo2`.
- Randomize name conflict: `Y`.

Narration:

"The environment and workload suffix become part of the generated names. For example, `dev` plus `demo2` produces a web app named `app-capdash-dev-demo2`. I keep name randomization enabled so the installer can recover if a globally unique App Service name is already taken."

## Scene 5: Auth and App Registration

Expected prompts:

```text
Enable Entra sign-in for the dashboard?
Entra tenant ID for dashboard sign-in
Entra app registration client ID
Entra app registration client secret
Auth redirect URI for the Entra app registration
Allow Terraform wrapper to add the generated callback URI to the app registration?
Enable App Service Authentication / Easy Auth on the Web App?
Web Easy Auth behavior for unauthenticated browser requests?
Optional Web Easy Auth allowed client application IDs for bearer automation
Keep x-ingest-key enabled for internal bootstrap/ingestion fallback?
```

Suggested demo answer:

- Enable auth: `Y`.
- Web Easy Auth: keep `N` for the stable shared-secret demo path; choose `Y` for the full Easy Auth hardening path. Choose `RedirectToLoginPage` when users should reach Microsoft login from the browser; choose `Return401` only for API-style smoke probes.
- Keep `x-ingest-key` enabled until bootstrap automation has a validated bearer-token path.
- Redirect URI: accept the generated value unless the customer has a specific app hostname plan.
- Terraform app registration update: answer `Y` only if the deployment identity has permission to update the app registration redirect URI.

Narration:

"The dashboard uses Microsoft Entra sign-in. The app registration supplies the client ID and secret, and the redirect URI needs to match the deployed dashboard callback URL. The important access detail is the app registration token configuration: it must emit Security Group Object IDs in the ID token. Without that groups claim, users can sign in but the app cannot see their `CapacityAdmin` or `CapacityReportViewers` membership."

Optional visual: briefly show Microsoft Entra admin center with the app registration token configuration.

## Scene 6: Dashboard Access Groups

Expected prompt:

```text
How should dashboard access groups be configured?
```

Suggested demo answer:

- Choose `Reuse CapacityAdmin/CapacityReportViewers` when those groups already exist.
- Choose `Use explicit group object IDs` when the customer has approved groups with different names.
- Choose `Create missing default groups` only when the deployment identity is allowed to create Entra security groups.

Narration:

"Admin access and report viewer access are separate. `CapacityAdmin` controls administrator features. `CapacityReportViewers` controls report viewing for non-admin users. The wizard fails closed if the expected groups are missing, unless we explicitly confirm group creation. That avoids accidentally deploying an app with unclear access control."

## Scene 7: SQL Admin and Existing Resources

Expected prompts:

```text
Use current Azure signed-in user as SQL Entra admin?
Does the customer already have an Azure SQL server to reuse?
Does the customer already have a Key Vault to reuse?
Does the customer already have a worker storage account to reuse?
Create private endpoints for the worker storage account blob, queue, table, and file services?
Does the customer already have a Virtual Network to reuse?
```

Suggested demo answer:

- Use current signed-in user for SQL admin when appropriate.
- For a clean demo, answer `N` to existing SQL, Key Vault, worker storage, and VNet.
- Keep worker storage private endpoints enabled for security-reviewed demos unless the storage account is pre-wired through a customer-managed private path.
- If you answer `Y` to an existing resource prompt, be ready to provide its exact existing resource name and resource group when asked.

Narration:

"For a clean demo environment, I let the deployment create the default platform resources. In a customer environment, these prompts are where we plug into existing SQL, Key Vault, storage, or networking standards."

Clean Terraform demo answers:

```text
Does the customer already have an Azure SQL server to reuse? (y/N): n
Does the customer already have a Key Vault to reuse? (y/N): n
Optional Key Vault name override for Terraform soft-delete/name conflicts:
Allow Terraform runner public network access to Key Vault for secret provisioning? (Y/n): y
Does the customer already have a worker storage account to reuse? (y/N): n
Create private endpoints for the worker storage account blob, queue, table, and file services? (Y/n): y
Does the customer already have a Virtual Network to reuse? (y/N): n
```

Terraform note:

"Terraform creates the initial Key Vault secrets through the machine running Terraform. For a local installer run, the Key Vault must allow public network access during provisioning. If the customer requires private-only Key Vault access, run Terraform from a host that has approved private-link connectivity and answer `N` to this prompt."

## Scene 8: RBAC Scope

Expected prompt:

```text
How should Azure RBAC scope be configured?
```

Suggested demo answer:

- Choose `Specify management group names` for larger estates.
- Enter the management group names the dashboard should read from.
- Use the same management group names for worker RBAC when appropriate.
- Enable quota write RBAC only if quota apply workflows are in scope for this deployment.

For a clean Terraform management-group demo, use values like:

```text
Management group names for Web App Reader access (comma-separated): TopDemoMg
Management group names for worker RBAC (comma-separated) [TopDemoMg]:
Default quota management group ID/name [TopDemoMg]:
Grant quota write RBAC for quota apply workflows now? (y/N): y
Management group names for GroupQuota Request Operator (comma-separated) [TopDemoMg]:
```

Narration:

"RBAC determines what the dashboard and worker can read or execute after deployment. Management-group scope is the preferred model for larger estates because it avoids hand-maintaining long subscription lists. If a central RBAC team owns these assignments, the deployment can produce the identity values and the handoff script can be run by that team."

## Scene 9: Secrets, Packages, and Bootstrap

Expected prompts:

```text
Provide an existing INGEST_API_KEY instead of letting deployment resolve/generate one?
Provide an existing SESSION_SECRET instead of letting deployment resolve/generate one?
Dashboard-to-worker authentication mode?
Worker shared secret handling?
Deploy the dashboard web package after infrastructure succeeds?
Deploy the worker package after infrastructure succeeds?
Temporarily enable Function public network access only while publishing the worker package, then lock it back down?
Run database bootstrap through the deployed web app?
```

Suggested demo answers:

- Let deployment resolve or generate `INGEST_API_KEY` and `SESSION_SECRET` unless the customer has a secret-management standard.
- Worker auth mode: use `shared-secret` for the stable demo path, or `entra` when Function App Easy Auth and bearer smoke tests are part of the demo. The preferred Easy Auth path reuses the dashboard app registration for the worker audience (`api://<dashboard-client-id>`); provide a separate worker app registration only for stricter customer isolation requirements.
- Worker shared secret: `Generate` for `shared-secret`; skipped automatically for `entra`.
- Deploy web app: `Y`.
- Deploy worker app: `Y`.
- Temporary Function public access: `Y` for a public deployment workstation when Function public access is otherwise disabled; the wrapper locks it back down after zip publish. Use `N` only when the worker package will be published from a private-network-connected host.
- Database bootstrap: `Y` for a clean environment.

Narration:

"After infrastructure, the wrapper can publish the dashboard package, publish the worker package, and bootstrap the database. For a normal clean install, I keep those enabled so the environment is usable at the end of the run."

## Scene 10: Review the Plan and Command Preview

The wizard prints:

```text
Deployment plan:
Command preview:
```

Narration:

"Before anything runs, the wizard shows the deployment plan and the exact `deploy-infra.ps1` command it will call. This is the checkpoint: confirm the subscription, resource group, environment, suffix, auth redirect URI, RBAC mode, package deploy choices, and database bootstrap choice."

Terraform narration add-on:

"For Terraform, the preview still shows the PowerShell command because the wizard hands off to the deployment wrapper. The wrapper then runs Terraform with a generated variable file, so list values like management group names are passed safely without requiring the operator to hand-write Terraform syntax."

For the first recording pass, stop after `PlanOnly` completes.

## Scene 11: Run Preflight or Deploy

For a preflight-only run:

```powershell
.\scripts\Start-CapacityDeployment.ps1 -PreflightOnly
```

For the real deployment:

```powershell
.\scripts\Start-CapacityDeployment.ps1
```

Narration:

"Preflight checks Azure CLI login, subscription access, Entra group lookup, and the expected callback URL. Once preflight is clean, the real deployment uses the same guided flow and asks for final confirmation before making changes."

For Terraform, expected terminal milestones include:

```text
Running Terraform init...
Terraform has been successfully initialized!
Running Terraform apply...
```

## Scene 12: Post-Deploy Validation

After deployment succeeds, open the dashboard URL:

```text
https://app-capdash-<environment>-<suffix>.azurewebsites.net
```

Validate auth interpretation:

```text
https://app-capdash-<environment>-<suffix>.azurewebsites.net/api/auth/me
```

Expected successful indicators:

- `isAuthenticated: true` after sign-in.
- `canAccessAdmin: true` for members of the admin group.
- `canAccessReports: true` for members of either the admin group or report viewer group.
- `isReportViewer: true` for non-admin report viewers.
- `adminGroupConfigured: true` when `ADMIN_GROUP_ID` is configured.
- `reportViewerGroupConfigured: true` when `REPORT_VIEWER_GROUP_IDS` is configured.
- Diagnostics show the token contains group claims.

Narration:

"The `/api/auth/me` endpoint is the quickest way to confirm the deployed app sees the signed-in user's access correctly. If the user is in the right groups but access is false, check the app registration groups claim first. Group membership alone is not enough; the ID token has to include the group Object IDs."

## Scene 13: Common Installation Pitfalls

Use these as closing callouts:

- Wrong folder: run from `C:\repos\Capacity\Capacity-Planning-Dashboard` or the equivalent repo root.
- Wrong Azure context: confirm `az account show` before deploying.
- Existing App Service name: keep workload suffix randomization enabled or choose a new suffix.
- Terraform ownership: use Terraform only for environments already in Terraform state, or import resources first.
- Missing group claim: configure the Entra app registration to emit Security Group Object IDs in the ID token.
- Missing Entra groups: create `CapacityAdmin` and `CapacityReportViewers`, or pass explicit group Object IDs.
- Central RBAC ownership: use the generated managed identity IDs with `scripts/grant-management-group-rbac.ps1` as a handoff artifact.

## Closing Narration

"That is the guided install experience end to end. The operator starts with Azure CLI login and a prepared app registration, uses the wizard to choose Bicep or Terraform, names the environment, configures Entra access, chooses the RBAC scope, and lets the wrapper deploy the app, worker, and database bootstrap. The final validation is simple: sign in, check `/api/auth/me`, and confirm Admin and report access line up with the Entra groups."

## Optional Follow-Up Recording

For a second short video, record a Terraform-specific path:

- Explain that Terraform manages resources through state.
- Use a fresh suffix for a clean Terraform-owned environment.
- Show `infra/terraform/terraform.tfvars` setup.
- Run the guided installer and choose `Terraform`.
- Explain when `manage_entra_web_redirect_uri` should be enabled.
- Close by showing that the wrapper publishes the web and worker packages after `terraform apply` succeeds.