# Capacity Dashboard API Contract (MVP)

This dashboard should call backend APIs only. Do not expose ARM credentials, subscription ids, tenant ids, or secrets in browser code.

## Read APIs

- `GET /api/capacity?region={region}&family={family}&availability={status}`
  - Returns rows with: region, sku, family, availability, quotaCurrent, quotaLimit, monthlyCost

- `GET /api/quota/candidates?region={region}`
  - Returns candidate rows with suggested movable quota and safety-buffer rationale

- `GET /api/quota/groups`
  - Returns accessible group quotas (managementGroupName, groupQuotaName, provisioningState)

## Planning APIs

- `POST /api/quota/plan`
  - Body: region scope, filters, safetyBuffer, minMovable
  - Returns plan rows with `ReadyToApply`

- `POST /api/quota/simulate`
  - Body: proposed changes
  - Returns impact summary and risk checks

## Controlled Write APIs

- `POST /api/quota/apply`
  - Requires approval policy and write identity
  - Body: approved plan rows
  - Returns operation id

- `GET /api/quota/requests/{requestId}`
  - Returns async request state from Microsoft.Quota request endpoints

## Identity Pattern

- Read APIs: managed identity with Reader + required Resource Graph / quota read rights
- Write APIs: separate managed identity (or separate app registration) with least-privilege write scope
- Never persist secrets in source control
