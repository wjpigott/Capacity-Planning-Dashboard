# Release Notes

## Unreleased

No unreleased changes.

## v1.0.3 - 2026-06-09

This patch release hardens the deployment path for App Service Authentication / Easy Auth across Bicep and Terraform.

Highlights:

- Added Web App and Function App Easy Auth deployment settings for both Bicep and Terraform.
- Made one dashboard app registration the default Easy Auth model for both browser sign-in and dashboard-to-worker bearer calls.
- Added wrapper logic to patch Function Easy Auth allowed applications with the Web App managed identity application/client ID after infrastructure deployment.
- Added a temporary Function public-access publish window for worker zip deployment, with automatic restore to the configured locked-down value.
- Updated database bootstrap automation to call Easy Auth-protected bootstrap endpoints with bearer tokens and validate real JSON `ok:true` responses.
- Added Bicep wrapper handling for soft-deleted generated Key Vault names and transient Azure SQL logical-server provisioning timeouts.
- Added Terraform and Bicep validation for worker-backed PaaS refresh through Function App Easy Auth with persisted SQL results.

Operational notes:

- For repeat Bicep test deployments using the same suffix, pass `-PurgeDeletedKeyVaultOnNameConflict $true` only when you intentionally want to purge a soft-deleted generated Key Vault name.
- Bicep SQL provisioning timeout retry defaults to one retry through `-BicepSqlProvisioningRetryCount 1`.
- Keep `INGEST_API_KEY`, `ENTRA_CLIENT_SECRET`, and `SESSION_SECRET` until the production automation-caller decision is finalized.
- Use a Git tag named `v1.0.3` on this release commit.

## v1.0.2 - 2026-06-08

This patch release adds a database-focused PaaS quota report alongside the existing PaaS availability matrix.

Highlights:

- Added the PaaS DB Quota report for quota/usage and region/AZ access review across selected sidebar subscriptions.
- Added collection coverage for SQL Database, SQL Managed Instance, Cosmos DB, PostgreSQL Flexible Server, and MySQL Flexible Server.
- Added optional capability detail capture for services that expose regional capability data.
- Persisted PaaS DB Quota runs in SQL for cached reloads and client CSV export.
- Added scheduler controls for cached PaaS DB Quota refreshes on a separate cadence from Capacity Ingest.
- Reused the shared Capacity Ingest subscription/management group scope for scheduled PaaS DB Quota refreshes instead of maintaining a separate PaaS DB subscription list.
- Added Function App private endpoint and private DNS deployment defaults so worker ingress can be locked down instead of exposed publicly.
- Hid the older PaaS Availability report from navigation while keeping its backend and SQL table available for rollback.
- Added deployment package verification for the PaaS DB Quota wrapper script.

Operational notes:

- PaaS DB Quota is the database-specific report for quota utilization, quota warning, and allowlisting/access-block evidence.
- The legacy PaaS Availability route, worker/tooling, and `dbo.PaaSAvailabilitySnapshot` table are retained in this release for rollback and historical data.
- Cleanup checklist for a later release: remove the hidden PaaS Availability React state/render/export branch; remove `/api/paas-availability*` routes; remove the PaaS Function worker route if unused; remove `tools/Get-PaaSAvailabilityReport.ps1` and vendored `tools/Get-AzPaaSAvailability` after confirming no runtime dependency remains; then decide whether to archive or drop `dbo.PaaSAvailabilitySnapshot` with an explicit migration.
- Use a Git tag named `v1.0.2` on this release commit.

## v1.0.1 - 2026-05-15

This patch release stabilizes the initial POC baseline with report correctness, PaaS availability, deployment, runtime, and licensing updates.

Highlights:

- Removed the legacy classic dashboard UI from the web deployment package so the React experience is the only supported dashboard UI.
- Removed the React sidebar link back to the retired classic UI.
- Made the site root the canonical dashboard URL while keeping `/react/` as a compatibility alias and asset path.
- Removed the Snapshot Score column from the Capacity Score report so the view focuses on on-demand Azure live placement results.
- Clarified the Capacity Score live placement panel so it shows the current reporting region/filter scope used by a refresh.
- Documented that Capacity Ingest still updates backend snapshot data while Refresh Live Placement updates Azure Live Score.
- Made Capacity Score live placement on-demand only while retaining the last checked live score in SQL.
- Added Admin controls for saving Capacity Ingest scope in SQL, including region preset, subscription IDs, management groups, and family filters.
- Added Admin scope cards showing configured Capacity Ingest scope and the on-demand Capacity Score Live behavior.
- Added an Admin `Validate Ingest Scope` smoke test that resolves saved SQL scheduler settings through the app identity without writing capacity snapshot rows.
- Added optional Entra report viewer group gating so report access can be limited to configured reader groups while preserving the existing admin group for Admin features.
- Kept the Node/Express backend in place for API, auth, session, ingestion, and worker-coordination routes.
- Fixed PaaS Availability refresh through the Function worker and persisted refreshed PaaS rows to SQL.
- Removed static-tier pricing-proxy services from the normal PaaS Availability report so services such as Redis, Front Door, Grafana, SignalR, Static Web Apps, and AI Search are not shown as authoritative `Blocked` results.
- Corrected stale Retail Prices service names used by the optional static-tier PaaS helper.
- Ensured the PaaS Function worker returns structured JSON for dashboard persistence.
- Documented PowerShell runtime expectations for reports and added MIT license metadata and project license text.

Operational notes:

- Normal PaaS Availability refreshes now include the API-backed services only: SQL Database, Cosmos DB, PostgreSQL Flex, MySQL Flex, App Service, Container Apps, AKS, Functions, and Storage.
- Static-tier pricing-proxy checks remain available only as explicit opt-in evidence and should not be treated as deployment capability blockers.
- Use a Git tag named `v1.0.1` on this release commit.

## v1.0.0-poc - 2026-05-14

This release marks the current deployed `main` branch as the initial proof-of-concept baseline for the Capacity Planning Dashboard.

Highlights:

- Established `v1.0.0-poc` as the reference version for the initial POC deployment.
- Documented the release baseline so future changes can be compared against a known starting point.
- Preserved the existing implementation status as the POC scope: deployed App Service UI/API, Azure SQL-backed analytics, ingestion, quota insights, live placement/recommendation flows, and infrastructure deployment scripts.

Operational notes:

- Future compatible feature updates should use the next minor version, for example `v1.1.0`.
- Patch-only fixes to this POC baseline should use `v1.0.1`, `v1.0.2`, and so on.
- Use a Git tag named `v1.0.0-poc` on the release commit so others can retrieve this exact baseline later.

## 2026-04-29

This update captures the report regression that followed the recent shared filter and trend work, along with the fixes that restored the reporting views in dev.

Highlights:

- Fixed shared SKU filter normalization so the default sentinel `sku=all` is treated as no filter instead of excluding every row.
- Restored Capacity Grid and the shared analytics reads after the filter regression by correcting `normalizeSkuFilter()` in the capacity service.
- Verified live backend data for Region Matrix, Family Summary, and Region Health through internal diagnostics rather than relying only on the auth-gated public routes.
- Decoupled the React analytics loader so Region Matrix, Family Summary, and Region Health no longer wait on the slower trend request before rendering.
- Added a faster SQL aggregation path for common trend reads to reduce the amount of in-memory trend derivation work.

Operational notes:

- The first regression symptom was caused by the literal `all` SKU sentinel flowing into equality-based filtering.
- A second blank-report symptom remained even after the filter fix because the shared analytics loader was blocked by the trend request timing out or running slowly.
- After the loader decoupling change was deployed to the dashboard App Service, Capacity Grid, Region Matrix, Family Summary, and Region Health were all confirmed working again.

## 2026-04-23

This update brings the validated Terraform deployment path into the mainline branch and aligns the deployment workflow across Bicep and Terraform.

Highlights:

- Added the Terraform infrastructure implementation under `infra/terraform/` with modular subscription-scope RBAC support for the web app and worker identities.
- Reorganized the Bicep implementation under `infra/bicep/` and updated infrastructure documentation for both deployment paths.
- Updated `scripts/deploy-infra.ps1` so the shared deployment wrapper now publishes both the dashboard web app package and the worker Function App package.
- Clarified and documented the database initialization model so customer deployments can use a separate post-deploy SQL initialization step when bootstrap should not run from the deployed app.
- Hardened `scripts/initialize-database.ps1` and the `20260422-add-ai-model-provider.sql` migration so database initialization is more reliable and rerunnable.
- Improved runtime behavior in the app and React UI, including reporting reads, classic UI routing, recommendation retry handling, and AI summary/reporting surfaces.

Operational notes:

- Subscription lists in the UI are populated from ingested SQL data, not only from deployed RBAC. A fresh deployment still requires a successful data ingest before subscriptions appear in the dashboard.
- Worker subscription RBAC and web reader RBAC are currently supported through explicit subscription lists. This is workable for small environments, but a management-group or inventory-driven RBAC onboarding flow is the recommended future direction for large customer estates.
