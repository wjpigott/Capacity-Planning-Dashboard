# Release Notes

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
