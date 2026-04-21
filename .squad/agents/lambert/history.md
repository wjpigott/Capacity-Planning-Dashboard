# Lambert History

## Day 1 Context

- Requested by: Max Bush
- Project: Capacity dashboard for Azure capacity and quota visibility
- Current branch: ai-capacity
- Stack: Web dashboard, backend APIs, SQL, Azure worker components
- Initial proposal: Azure AI capacity tracking

## Learnings

- The proposal introduces new data sources, new filters, and likely a new report surface.
- Testing will need to cover proposal choices around scope, refresh cadence, and schema shape.

### 2026-04-21: Azure AI Capacity Tracking Test Strategy

**Architecture Decisions:**
- Phase 1 uses feature flag (`INGEST_OPENAI_ENABLED`) for safe rollout
- New `dbo.AIModelAvailability` table separates model catalog from quota snapshots
- OpenAI quota reuses existing `CapacitySnapshot` schema with `sourceType='live-azure-openai-ingest'`
- Model catalog refreshes on separate slower cadence than quota ingestion (admin-configurable)
- Parallel ingestion (Compute + OpenAI) controlled by existing `INGEST_REGION_CONCURRENCY`

**Key Test Patterns:**
- Feature flag isolation: Test with flag off → on transition validates no regression
- NULL safety: OpenAI rows have NULL `vCpu`/`memoryGB`, requiring defensive coding in score derivation and UI
- ARM API integration: Reuse existing retry/throttle logic from Compute ingestion
- Async catalog refresh: Separate DB connections prevent deadlock with quota ingestion
- Multi-phase rollout: Schema → Code → Canary → Full, with 24-hour soak between phases

**Critical Files:**
- `src/services/azureIngestionService.js`: Core ingestion logic, ARM API calls
- `sql/schema.sql`: CapacitySnapshot and CapacityLatest view (extended for OpenAI)
- `app.js` and `react/main.js`: Resource type filter implementation (getRowResourceType)
- `src/services/capacityService.js`: Score derivation (must handle NULL vCpu)

**Risk Front-Loading:**
- Database migration idempotency is critical (prod deployment risk)
- ARM API throttle monitoring needed (parallel Compute + OpenAI increases call volume)
- CapacityLatest view performance with doubled row count (needs index validation)
- Concurrent catalog + quota refresh (needs separate connection test)

**Deliverables Created:**
- `docs/lambert-acceptance-criteria.md`: 40 criteria across 10 categories
- `docs/lambert-test-strategy.md`: Comprehensive test plan for backend, frontend, SQL, admin UI
- `docs/lambert-rollout-risks.md`: Risk matrix, mitigation steps, 4-phase rollout plan
- `docs/bishop-review-checklist.md`: 10 sections, 100+ items for Bishop's critical review
- `.squad/decisions/inbox/lambert-ai-test-strategy.md`: Team decision on test approach

## 2026-04-21: Team Coordination Update

**Session:** Azure AI Capacity Tracking — Design Phase (completed 2026-04-21T10:55:47Z)

### Cross-Agent Dependencies

- **Ripley (Orchestration):** Implementation plan references Lambert's risk mitigation strategy (database migration order, two-stage deployment, monitoring thresholds)
- **Ash (Backend):** API integration patterns for feature flag validation documented; Lambert will test against real Azure subscriptions
- **Dallas (Frontend):** UI regression tests defined (AI filter must isolate from Compute rows); can build in parallel with backend
- **Parker (Platform):** Pre-deployment validation checklist aligned with Lambert's risk front-loading strategy
- **Scribe (Session):** Team coordination captured; all testing decisions documented in decisions.md and acceptance criteria

### Implementation Ready

Lambert's strategy is complete and implementation-ready:
- Feature flag isolation test cases defined (off → on transition, no regression)
- Schema compatibility validation specified (NULL column handling, view partitioning)
- API permissions validation mapped (existing Reader role, empty response handling)
- Refresh cadence risk documented (async process out-of-sync edge case)
- UI resource type filter regression test defined (AI filter isolation, Compute filter exclusion)
- Rollout risk mitigation 3-point plan (migration order, two-stage deployment, monitoring threshold)
- Bishop review trigger and checklist established

Next: Set up integration test harness for subscriptions with OpenAI deployments; create test cases for feature flag transitions; define monitoring thresholds for ingestion duration baseline

## 2026-04-21: Phase 1 Validation Readiness

### Executable validation surfaces confirmed

- The repo currently has no `npm test`, `npm run lint`, or `npm run build` script, so there is no existing automated validation lane to run during implementation.
- `npm install` restores missing runtime dependencies; after that, `npm start` succeeds locally even without SQL and serves the app in mock mode.
- Local smoke checks that executed cleanly in mock mode: `/` and `/api/capacity/paged`.
- SQL validation surfaces already in-repo: `scripts/apply-migration.ps1`, `scripts/run-migration.js`, and the new migration `sql/migrations/20260421-add-ai-model-availability.sql`.

### Readiness findings

- AI rollout safety needs explicit verification because the proposal/decisions expect default-off behavior, but the new migration seeds `ingest.openai.enabled` to `true`.
- AI quota API verification needs special attention because `/api/ai/quota` filters `dbo.CapacityLatest` by `sourceType`, while the current view definitions do not project `sourceType`.
- Frontend AI validation is not yet executable from the current UIs because both classic and React resource-type option lists still expose only Compute/Disk/Other/All.

### Assets prepared

- Added `docs/lambert-phase1-validation-readiness.md` with runnable checks, evidence capture steps, and a regression hotspot watchlist.
- Added a team decision inbox note establishing the minimum pre-Bishop validation gate for this phase.

## 2026-04-21: Implementation Wave Coordination (16:30:09Z)

**Session:** Azure AI Capacity Implementation — Wave 2 Delivery (in progress)

### Implementation Status Summary

- **Ash (Backend):** Completed AI ingestion service, dual-table schema, REST API wiring
- **Dallas (Frontend):** Completed resource-type filter, sidebar report, admin scheduler extension
- **Parker (Platform):** Completed deployment sequence, safe defaults, pre-deployment checklist
- **Lambert (Tester):** Validated executable surfaces, identified critical gaps, documented validation gate
- **Bishop:** Launched for critical review of cross-layer correctness

### Cross-Agent Alignment

- All decisions consolidated into `.squad/decisions.md` with no-go items clearly documented
- All orchestration logs recorded in `.squad/orchestration-log/` for complete delivery trace
- Session log captured in `.squad/log/` summarizing team outcomes and next steps
- Decision inbox merged and cleaned

### Validation Gate Before Bishop Approval

Lambert identified critical remediation items that must be addressed:
1. Migration seed value must be `false` (not `true`) for safe rollout
2. CapacityLatest view must project `sourceType` for `/api/ai/quota` filtering
3. Frontend RESOURCE_TYPE_OPTIONS must include "AI" for both UIs

### Next Steps

Bishop's critical review will validate these no-go items are addressed before merge approval. No architectural changes needed; all items are implementation fixes.
