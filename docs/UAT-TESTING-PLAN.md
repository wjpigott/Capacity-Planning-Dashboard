# UAT Testing Plan

## Purpose

This branch exists to establish repeatable testing for the most failure-prone parts of the Capacity Dashboard, with immediate emphasis on:

- Capacity Score
- Capacity Recommender
- React filter and rendering flows that are sensitive to SKU and family normalization
- Admin quota flows, especially Quota Workbench bootstrap and management-group fallback behavior

## Current State

The repository did not previously have an automated test runner or a committed testing plan.

Initial execution completed on this branch:

- Added a native Node test command: `npm test`
- Added regression tests for Capacity Score derivation
- Added regression tests for Capacity Recommender SKU normalization and dedupe behavior
- Added regression coverage for quota management-group fallback parsing
- Fixed a broken `livePlacementService` timeout helper discovered by the first test run

## Testing Strategy

Testing should happen in three layers.

### 1. Fast regression tests

Goal:

- Catch logic regressions quickly in CI or before deployment.

Current coverage added on this branch:

- `test/capacityService.test.js`
- `test/livePlacementService.test.js`
- `test/quotaDiscoveryService.test.js`

Current focus:

- Capacity score aggregation
- Score label assignment
- Recommendation contract normalization
- Extra SKU parsing and dedupe
- Quota management-group fallback parsing and bootstrap resilience

Next additions recommended:

- Capacity score pagination edge cases
- Capacity score live snapshot merge behavior
- Recommender warning/fallback behavior
- Family normalization and canonicalization rules that drive React filters

### 2. Manual UAT smoke pass

Goal:

- Confirm the deployed experience still behaves correctly in the UI.

Run this before every meaningful release affecting Capacity Score, Recommender, ingestion, or filter logic.

#### Capacity Score smoke cases

1. Open Capacity Score with one subscription and one family selected.
2. Verify rows load without blank-state regressions.
3. Verify sorting still groups `High`, `Medium`, and `Low` correctly.
4. Trigger `Refresh Live Placement` and verify results update without UI breakage.
5. Verify unavailable regions produce understandable user-visible behavior.
6. Verify desired count changes affect snapshot messaging and live refresh results.

#### Capacity Recommender smoke cases

1. Select a valid target SKU and region scope.
2. Run recommendations with pricing enabled.
3. Run recommendations with spot enabled.
4. Verify normalized SKUs display correctly in results.
5. Verify empty or degraded results fail clearly rather than silently appearing successful.
6. Verify warnings remain readable and do not expose raw internal exception text.

#### React filter smoke cases

1. Verify family dropdown values are normalized and sorted consistently.
2. Verify aggregate or placeholder SKUs do not appear as valid live-placement targets.
3. Verify changing region, family, and subscription filters does not leave stale results on screen.
4. Verify Capacity Score and Recommender still behave when switching between one subscription and multiple subscriptions.

#### Quota Workbench smoke cases

1. Sign in as an admin-capable user and open Quota Workbench from the Admin navigation.
2. Verify the page renders even if management-group enumeration is restricted for the app identity.
3. Verify a configured fallback management group appears when `QUOTA_MANAGEMENT_GROUP_ID` or `INGEST_MANAGEMENT_GROUP_NAMES` is set.
4. Verify a quota bootstrap warning does not block the rest of the admin shell from loading.
5. Verify `Discover Quota Groups` either returns data or shows a clear quota/RBAC error instead of a broken page.
6. Verify Shareable Quota Report and candidate generation fail with actionable messages when RBAC is incomplete.

### 3. Deployment/UAT validation on environment

Goal:

- Confirm behavior against a real deployed environment, not only local logic.

Per-environment validation:

1. Confirm auth/session behavior still works.
2. Confirm Capacity Score loads and refreshes.
3. Confirm Capacity Recommender returns expected output or explicit errors.
4. Confirm SQL-backed pages still behave when recent patch scripts were applied.
5. Confirm logs do not show repeated route failures masked as empty success payloads.
6. Confirm Quota Workbench opens from the Admin menu and does not hard-fail during initial management-group bootstrap.
7. Confirm the deployed web app has the expected `QUOTA_MANAGEMENT_GROUP_ID`, `INGEST_MANAGEMENT_GROUP_NAMES`, and admin auth settings for the target environment.

## Execution Cadence

### Required on every change touching score or recommender logic

- Run `npm test`
- Perform the manual Capacity Score smoke pass
- Perform the manual Capacity Recommender smoke pass

### Required on every change touching quota workbench or admin quota APIs

- Run `node --test .\test\quotaDiscoveryService.test.js`
- Perform the manual Quota Workbench smoke pass
- Validate at least one deployed environment with the intended management-group fallback settings

### Required on every release to shared environment

- Run `npm test`
- Perform the full manual UAT smoke pass
- Validate at least one deployed environment end to end

## Current Gaps

These are still missing and should be tackled next.

- No browser automation yet for the React experience
- No API integration tests around Express routes
- React logic still contains behavior that is hard to test because utility logic is embedded in `react/main.js`

## Recommended Next Steps

1. Extract React-only normalization and filter helpers from `react/main.js` into testable modules.
2. Add API-level tests for `/api/capacity/scores/live` and `/api/capacity/recommendations`.
3. Add Playwright for browser smoke coverage once the current helper logic is extracted enough to reduce brittleness.
4. Decide whether CI should expand beyond `npm test` to include route-level tests and a smoke-test lane.

## Automation Status

- GitHub Actions now runs `npm test` automatically on pushes to `main` and `uat-testing`, and on pull requests targeting `main`.
- `deploy-web-app.ps1` now runs `npm test` before packaging and publishing unless `-SkipTests` is provided.
- The current automated test suite is logic-only and does not depend on on-prem SQL connectivity or Azure API access.
- Manual UI smoke testing is still required for Capacity Score, Capacity Recommender, and quota workbench changes.
- Known regression to guard against: Quota Workbench previously broke when `/api/quota/management-groups` failed during admin bootstrap, even though the rest of the admin shell could still load. UAT must verify the page degrades to a warning/fallback state instead of failing closed.

## Branch Note

This work is being built on the `uat-testing` branch so test strategy and implementation can evolve without mixing into unrelated runtime or SQL patch changes.