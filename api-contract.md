# Capacity Dashboard API Contract (MVP)

This dashboard should call backend APIs only. Do not expose ARM credentials, subscription ids, tenant ids, or secrets in browser code.

## Read APIs

- `GET /api/capacity?region={region}&family={family}&availability={status}`
  - Returns rows with: region, sku, family, availability, quotaCurrent, quotaLimit, monthlyCost

- `GET /api/capacity/scores?region={region}&family={family}&availability={status}`
  - Returns a derived regional SKU capacity score view with: region, sku, family, score (`High`/`Medium`/`Low`), subscriptionCount, okRows, limitedRows, constrainedRows, totalQuotaAvailable, utilizationPct, and reason

- `GET /api/capacity/scores/history?days={n}&region={region}&family={family}&sku={skuName}&score={High|Medium|Low}`
  - Returns persisted score snapshots from `CapacityScoreSnapshot` with: capturedAtUtc, region, sku, family, subscriptionCount, okRows, limitedRows, constrainedRows, totalQuotaAvailable, utilizationPct, score, reason, and latestCapturedAtUtc
  - Dashboard default: 30-day history window for planning review

- `POST /api/capacity/scores/live`
  - Body: regionPreset, subscriptionIds, region, family, availability, desiredCount
  - Returns the current derived score rows enriched with live `Get-AzVMAvailability` placement data: `livePlacementScore`, `livePlacementAvailable`, `livePlacementRestricted`, `liveCheckedAtUtc`
  - Intended for on-demand refresh in the UI; live placement results are not persisted back into `CapacityScoreSnapshot`

- `GET /api/quota/candidates?managementGroupId={mgId}&groupQuotaName={quotaGroup}&region={region}`
  - Returns read-only candidate rows with subscription, region, family, quotaAvailable, safetyBuffer, suggestedMovable, and candidateStatus for the selected quota group scope

- `POST /api/quota/candidates/capture`
  - Body: managementGroupId, groupQuotaName, regionPreset, region, family
  - Persists the current candidate run into `QuotaCandidateSnapshot` with analysisRunId, capturedAtUtc, sourceCapturedAtUtc, and scope metadata

- `GET /api/quota/candidate-runs?managementGroupId={mgId}&groupQuotaName={quotaGroup}&region={region}&family={family}`
  - Returns captured `analysisRunId` history for the selected scope, including capturedAtUtc, rowCount, subscriptionCount, and movableCandidateCount

- `GET /api/quota/plan?managementGroupId={mgId}&groupQuotaName={quotaGroup}&analysisRunId={runId}&region={region}&family={family}`
  - Returns a read-only move plan generated from the selected captured `QuotaCandidateSnapshot` analysis run for the selected scope
  - Each row includes donor subscription, recipient subscription, region, quotaName, transferAmount, recipientNeededQuota, recipientAvailabilityState, and sourceAnalysisRunId

- `GET /api/quota/groups`
  - Returns accessible group quotas for the configured management group, including: managementGroupId, groupQuotaName, displayName, groupType, provisioningState, subscriptionCount, subscriptionIds

- `GET /api/quota/shareable-report?managementGroupId={mgId}&groupQuotaName={quotaGroup}`
  - Returns a read-only quota allocation report for the selected quota group using Azure GroupQuota allocation data
  - Includes only rows where the raw Azure `shareableQuota < 0`; the returned `shareableQuota` value is the absolute magnitude of that quota deficit
  - Each row includes: subscriptionId, region, resourceName, displayName, quotaLimit, shareableQuota, rawShareableQuota, and provisioningState
  - Also returns summary counts for rows, subscriptions, regions, SKUs, total allocated quota, and total reported quota deficit

## Planning APIs

- `POST /api/quota/simulate`
  - Body: managementGroupId, groupQuotaName, analysisRunId, region, family
  - Returns a read-only impact projection with donor/recipient availability before and after the proposed plan, plus summary counts for resolved recipients and donors below buffer

## Controlled Write APIs

- `POST /api/quota/apply`
  - Body: managementGroupId, groupQuotaName, analysisRunId, donorSubscriptionId, recipientSubscriptionId, selectedSku, transferAmount, region, family
  - Rebuilds the selected move plan on the server, generates an apply-ready quota-group CSV, and invokes the dedicated `Apply-QuotaGroupMove.ps1` entry point
  - Returns the updated plan summary plus: applyPlanFile, applyReportFile, submittedChangeCount, submittedRequestedCores, failureCount, and applyResults

- `GET /api/quota/requests/{requestId}`
  - Returns async request state from Microsoft.Quota request endpoints

## Identity Pattern

- Read APIs: managed identity with Reader + required Resource Graph / quota read rights
- Write APIs: separate managed identity (or separate app registration) with least-privilege write scope
- Never persist secrets in source control

## Persistence Notes

- `POST /api/admin/ingest/capacity` and `POST /internal/ingest/capacity` now persist both raw capacity rows into `CapacitySnapshot` and aggregated score history into `CapacityScoreSnapshot`.
- Score history uses the same ingestion `capturedAtUtc` as the source capacity rows so historical planning can align score changes with the underlying snapshot window.
- Automated cleanup for score history is not implemented yet; current planning assumes retaining at least 30 days of score snapshots.
