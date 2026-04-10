# Capacity Planning Dashboard

This repository contains the initial platform scaffold for a native Azure capacity planning solution.

## What is included now

- Web UI with tabs, filters, action buttons, and a data grid
- Backend API foundation with capacity endpoints
- SQL schema for snapshots and latest-capacity view
- Azure infrastructure Bicep templates
- Deployment and sample data scripts
- Current-state architecture diagram source and rendered image in `docs/`

## Architecture

- Primary editable source (Draw.io): `docs/current-architecture.drawio`
- Current-state Mermaid source: `docs/current-architecture.mmd`
- Rendered PNG: `docs/current-architecture.png`

The current-state diagram reflects what is deployed now: App Service hosting the static UI + Express API, Azure SQL with Entra-only auth, managed identity database access, Key Vault RBAC integration, and App Insights/Log Analytics.

Use Draw.io for edits when readability/layout precision matters; keep the Mermaid file for quick text-based diffs and automation-friendly rendering.

## Local run

1. Copy `.env.example` to `.env` and provide SQL values (or leave blank for mock mode).
2. Install dependencies:

```powershell
npm install
```

3. Start API + UI server:

```powershell
npm start
```

4. Open:

- http://localhost:3000

## Infrastructure deployment

Use script-based deployment with Central US default:

```powershell
./scripts/deploy-infra.ps1 \
	-ResourceGroupName "<rg-name>" \
	-Environment dev \
	-WorkloadSuffix "cap001" \
	-SqlEntraAdminLogin "<entra-upn>" \
	-SqlEntraAdminObjectId "<entra-object-id>" \
	-SubscriptionId "<subscription-id>"
```

Notes:

- SQL is configured with Microsoft Entra admin and AAD-only authentication.
- `SqlAdminPassword` is optional; when omitted, the script generates a strong random value for server bootstrap.

## Initialize database

Apply schema:

```powershell
./scripts/apply-schema.ps1 \
	-SqlServer "<server>.database.windows.net" \
	-SqlDatabase "<database>" \
	-UseEntra \
	-EntraUser "<entra-upn>"
```

Load sample rows:

```powershell
./scripts/load-sample-data.ps1 \
	-SqlServer "<server>.database.windows.net" \
	-SqlDatabase "<database>" \
	-UseEntra \
	-EntraUser "<entra-upn>"
```

## Approval checkpoints

Approvals are required before:

1. Assigning any write permissions for quota movements.
2. Enabling production data ingestion across subscriptions.
3. Executing quota apply operations from UI/API.
4. Enabling public network access for production SQL/Key Vault (recommended to lock down with private networking).

## Security guardrails

- Do not commit subscription IDs, tenant IDs, resource group names, or credentials.
- Use managed identity for Azure resource access in hosted environments.
- Keep write identity separate from read identity.

## Live ingestion (Phase 1)

The dashboard now supports a secure internal ingestion path that reads Azure Compute quota usage and writes snapshots to `dbo.CapacitySnapshot`.

Defaults:

- Region preset: `USMajor`
- Family filters: `standard_BS`, `standard_DS`
- Source type written to SQL: `live-azure-ingest`

Required app settings:

- `INGEST_API_KEY` (required to call internal ingestion routes)
- `INGEST_REGION_PRESET` (default `USMajor`)
- `INGEST_QUOTA_FAMILY_FILTERS` (default `standard_BS,standard_DS`)
- `INGEST_SUBSCRIPTION_IDS` (optional comma-separated list; if omitted, enabled subscriptions are auto-discovered)
- `INGEST_ON_STARTUP` (`true`/`false`)
- `INGEST_INTERVAL_MINUTES` (`0` disables scheduling)

Required database permissions for the app identity:

- `db_datareader` (read dashboard rows)
- `db_datawriter` (insert ingestion snapshots)

Internal endpoints:

- `POST /internal/ingest/capacity` (requires `x-ingest-key` header)
- `GET /internal/ingest/status` (requires `x-ingest-key` header)

Example trigger:

```powershell
Invoke-RestMethod -Method Post -Uri "https://<your-app>.azurewebsites.net/internal/ingest/capacity" -Headers @{ "x-ingest-key" = "<ingest-key>" } -Body (@{ regionPreset = "USMajor"; familyFilters = @("standard_BS","standard_DS") } | ConvertTo-Json) -ContentType "application/json"
```
