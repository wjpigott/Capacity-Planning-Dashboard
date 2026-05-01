# Release Notes

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
