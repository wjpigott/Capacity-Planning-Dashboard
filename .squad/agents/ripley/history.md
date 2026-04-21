# Ripley History

## Day 1 Context

- Requested by: Max Bush
- Project: Capacity planning dashboard for Azure customer capacity visibility
- Current branch: ai-capacity
- Stack: Node.js + Express, React, Azure Functions PowerShell worker, Python utilities, SQL, Azure App Service
- Initial proposal: `docs/Proposal Azure AI Capacity Tracking.md`

## Learnings

- The dashboard already tracks compute capacity and quota-oriented data.
- The new proposal extends the same patterns to Azure OpenAI capacity and model availability.
- `CapacitySnapshot` partition key is `(subscriptionKey, region, skuName)` — AI quota rows fit this shape naturally.
- `CapacityLatest` view needs `sourceType` added to its SELECT list for frontend resource-type classification.
- Scheduler pattern in the codebase is a `start/update/getConfig` triplet (see `azureIngestionService.js` lines 607-617). Model catalog scheduler should follow the same pattern.
- `DashboardSetting` table is the persistence layer for admin-configurable scheduler cadences (keys like `schedule.ingest.intervalMinutes`).
- Resource type classification lives in `getRowResourceType()` in both `react/main.js` (line 321) and `app.js` (line 49). Both must be updated for AI.
- `REPORT_VIEWS` array in `react/main.js` (line 30) drives sidebar nav — new reports are added here.
- `armGetAll` and `armGetPageWithRetry` in `azureIngestionService.js` are reusable for any ARM API calls.
- Feature gating via env vars (e.g. `INGEST_OPENAI_ENABLED`) is the established pattern for new ingestion sources.
- API route pattern: express routes registered directly in `src/server.js` with `requireAdmin` middleware for admin endpoints.
- SQL store functions live in `src/store/sql.js` — new table operations go here.
- The team decided Bishop must do a critical final review before merge.
- No Bicep/RBAC changes needed — existing MSI Reader role covers CognitiveServices APIs.

## 2026-04-21: Team Orchestration Complete

**Session:** Azure AI Capacity Tracking — Design Phase (completed 2026-04-21T10:55:47Z)

### Orchestration Outcomes

- **Ripley (Lead):** Staged architecture plan delivered. 7 architecture decisions (D1–D7) locked. 5-phase implementation roadmap with parallelizable workstreams. CI/CD guidance complete. Implementation ready.
- **Ash (Backend):** Database schema (AIModelAvailability table + migrations), REST API contracts, ingestion service design. Zero breaking changes to existing Compute flows. Ready for implementation.
- **Dallas (Frontend):** UI integration strategy complete (resource type filter, sidebar AI Models report, admin scheduler settings). Minimal code changes; reuses existing patterns. Ready for implementation.
- **Parker (Platform):** Platform impact analysis complete. Zero new Azure resources required. Environment variables and deployment sequence designed. Pre-deployment validation checklist provided. Rollback plan documented.
- **Lambert (Tester):** Testing strategy and acceptance criteria framework delivered. Feature flag validation approach defined. Bishop critical review gate established before broader rollout.

### Team Decisions Summary

- **OpenAI-Only Phase 1:** Broader Cognitive Services deferred to future phases
- **Dual Tables:** AIModelAvailability for catalog (slower cadence), CapacitySnapshot for quota (with sourceType discriminator)
- **Feature-Gated Rollout:** INGEST_OPENAI_ENABLED defaults to false for safe deployment; admin UI controls activation timing
- **Parallel Execution:** 5 workstreams optimized for concurrent development; no resource conflicts
- **Bishop Gate:** Required final review before merge to main; specifically validates ARM API patterns, retry logic, credential handling

### Immediate Next Steps

1. Backend begins SQL migrations + aiIngestionService.js
2. Frontend starts resource type filter + sidebar component (can use API stubs)
3. Platform validates deployment artifacts and pre-deployment checklist
4. Test stands up integration test harness
5. All work stays on ai-capacity branch; Bishop performs critical review before merge
