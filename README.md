# Capacity Planning Dashboard

This repository contains the initial platform scaffold for a native Azure capacity planning solution.

## What is included now

- Web UI with tabs, filters, action buttons, and a data grid
- Backend API foundation with capacity endpoints
- SQL schema for snapshots and latest-capacity view
- Azure infrastructure Bicep templates
- Deployment and sample data scripts

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
