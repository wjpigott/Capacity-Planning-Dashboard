# Test Folder Guide

This folder is for safe regression coverage and test documentation.

## Current Automated Tests

Run all automated tests with:

```bash
npm test
```

Automation status:

- GitHub Actions runs `npm test` on pushes to `main` and `uat-testing`, and on pull requests targeting `main`.
- `deploy-web-app.ps1` runs `npm test` before deployment by default.
- Use `./deploy-web-app.ps1 -SkipTests` only when you intentionally need to bypass the local test gate.

Environment expectation:

- The current `npm test` suite does not require on-prem SQL connectivity.
- The current `npm test` suite does not call Azure APIs.
- The current `npm test` suite does not require a full local app startup.
- These tests are safe to run in CI even when local end-to-end testing is not practical.

Current files:

- `test/capacityService.test.js`
- `test/livePlacementService.test.js`

## What The Current Tests Actually Verify

### `test/capacityService.test.js`

These tests verify read-only capacity score logic.

Covered behavior:

- Aggregates multiple subscription rows into one capacity score summary row.
- Calculates total available quota correctly.
- Assigns a `High` score when all in-scope rows are healthy with positive headroom.
- Assigns a `Low` score when constrained rows have no remaining quota headroom.

Not covered:

- No on-prem SQL dependency.
- No SQL writes.
- No Azure API calls.
- No quota movement.
- No UI/browser automation.

### `test/livePlacementService.test.js`

These tests verify read-only recommendation normalization helpers.

Covered behavior:

- Normalizes target SKU names into the dashboard's canonical display format.
- Normalizes recommendation SKU names.
- Normalizes `belowMinSpec` SKU names.
- Deduplicates and normalizes manually supplied extra SKU values.

Not covered:

- No on-prem SQL dependency.
- No recommendation job execution against Azure.
- No quota group updates.
- No writeback to SQL.
- No admin route execution.

## Safe Smoke Test

The smoke test should prove the app starts and serves a basic read-only endpoint.

Recommended smoke scope:

1. Start the app locally.
2. Call `GET /healthz`.
3. Confirm the response is `{"status":"ok","service":"capacity-dashboard-api"}`.
4. Stop the app.

This smoke test is intentionally non-destructive.

It does not call:

- `/api/quota/apply/*`
- quota admin mutation paths
- ingestion triggers
- any route intended to move or rebalance quota groups

## Safe Areas For Additional Tests

These are good next candidates because they validate logic without performing quota mutations:

- Capacity score aggregation and labeling
- Capacity score pagination and filter shaping
- Recommendation result normalization
- Recommendation response contract validation
- Family and SKU normalization used by React filters
- Route-level tests for read-only capacity endpoints using mocked services

## Areas Requiring Extra Caution

Do not add automated tests that directly execute live quota mutation flows unless they are fully mocked.

Treat these as unsafe for default local or CI execution:

- quota apply jobs
- management-group or quota-group move execution
- ingestion jobs against shared subscriptions
- tests that assume access to production or shared test environments

## Documentation Rule For New Tests

Whenever a new automated test file is added under `test/`, update this document with:

- the file name
- what behavior it validates
- whether it is read-only or mocked
- what external systems, if any, are touched