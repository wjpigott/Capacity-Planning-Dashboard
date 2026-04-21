# Ash History

## Day 1 Context

- Requested by: Max Bush
- Project: Azure capacity planning dashboard
- Current branch: ai-capacity
- Stack: Node.js + Express, Azure ARM integration, SQL persistence
- Initial proposal: add Azure OpenAI usages and model availability ingestion

## Learnings

- The repo already has compute capacity ingestion patterns that can be extended.
- The proposal suggests `sourceType: live-azure-openai-ingest` and possibly a dedicated model catalog table.
- Treat `INGEST_OPENAI_ENABLED` as the master rollout gate and let SQL settings refine behavior only after that env flag is on.
- The AI model catalog cadence fits the existing admin scheduler settings surface even though catalog refresh still runs inside the main ingestion pass.

## Day 1 (2026-04-21): Azure OpenAI Capacity Integration Design

### Architecture Decisions

1. **Dual-table strategy for AI data:**
   - Reuse `dbo.CapacitySnapshot` for OpenAI quota (TPM/RPM usage) with `sourceType: 'live-azure-openai-ingest'`
   - Created dedicated `dbo.AIModelAvailability` table for model catalog (availability matrix)
   - Rationale: Quota has current/limit semantics; model catalog is pure availability metadata

2. **Settings-driven ingestion cadence:**
   - OpenAI quota ingested in parallel with Compute quota (same frequency)
   - Model catalog refreshed on separate slower cadence (default 24 hours, configurable)
   - Settings stored in `dbo.DashboardSetting` table: `ingest.openai.enabled`, `schedule.aiModelCatalog.intervalMinutes`

3. **Parallel ingestion architecture:**
   - AI quota fetched in parallel with Compute quota using existing `mapWithConcurrency` pattern
   - Zero impact on Compute ingestion performance
   - Model catalog refresh conditional on time elapsed since last refresh

### Key File Paths

- **Migration:** `sql/migrations/20260421-add-ai-model-availability.sql`
- **AI Service:** `src/services/aiIngestionService.js` (new)
- **Ingestion Integration:** `src/services/azureIngestionService.js` (modified)
- **API Endpoints:** `src/server.js` (added `/api/ai/models`, `/api/ai/quota`, `/api/ai/models/regions`)
- **Design Doc:** `.squad/decisions/inbox/ash-ai-openai-design.md`

### Patterns Established

1. **ARM API Integration Pattern:**
   - Create dedicated service module for provider-specific logic (`aiIngestionService.js`)
   - Export fetch, map, and insert functions
   - Reuse shared ARM utilities (`armGetAll`, `mapWithConcurrency`) from parent service

2. **Schema Extension Pattern:**
   - Use `sourceType` discriminator to share tables across resource types
   - Create dedicated tables when data shapes differ fundamentally
   - Always include timestamp and region columns for partitioning

3. **Settings-Driven Behavior:**
   - Store feature flags and cadence settings in `dbo.DashboardSetting`
   - Retrieve settings at ingestion start
   - Allow runtime configuration without code redeployment

4. **API Endpoint Design:**
   - Read-only GET endpoints for data retrieval
   - Query params for filtering (region, modelName, etc.)
   - Consistent JSON response shape: `{ rows: [...] }` or `{ error, detail }`

### Azure ARM API Notes

- **OpenAI quota:** `Microsoft.CognitiveServices/locations/{region}/usages` API version 2023-05-01
- **Model catalog:** `Microsoft.CognitiveServices/locations/{region}/models` API version 2023-05-01
- Both APIs require only Reader role (same as Compute)
- Quota response shape matches Compute (name.value, currentValue, limit)
- Model catalog response includes kind, name, version, skus, capabilities

### User Preferences

- Break work down and parallelize whenever possible
- End with internal documentation explaining changes and decisions
- Phase 1 scope: Azure OpenAI only (broader Cognitive Services can follow)
- Show Azure OpenAI quota in existing capacity views AND new AI-specific report

## 2026-04-21: Team Coordination Update

**Session:** Azure AI Capacity Tracking — Design Phase (completed 2026-04-21T10:55:47Z)

### Cross-Agent Dependencies

- **Ripley (Orchestration):** Staged plan delivered; unblocks parallel backend/frontend/platform work
- **Dallas (Frontend):** Resource type filter + sidebar report design ready; needs backend API contracts (provided)
- **Parker (Platform):** Deployment guidance complete; validates no new Azure resources required
- **Lambert (Test):** Feature flag validation strategy defined; testing can begin once code is deployable
- **Scribe (Session):** Team memory captured; decisions.md updated; orchestration logs recorded

### Implementation Ready

Ash's design is complete and implementation-ready:
- Database schema specified with indexes and views
- API contracts defined with query parameters and response shapes
- Integration points mapped (azureIngestionService calls, parallel execution model)
- Settings-driven approach documented (no code changes to disable/enable feature)
- Error handling patterns established (defensive ARM API parsing, fallback behavior)

Next: Implement aiIngestionService.js following established patterns; run SQL migration test; verify API endpoints

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

### Backend Readiness

Ash's implementation is ready for integration:
- Dual-table schema (AIModelAvailability + CapacitySnapshot extension) finalized
- API endpoints defined with consistent response format
- Ingestion service architecture allows parallel quota/catalog refresh
- All ARM API patterns reuse existing Compute integration logic
- Zero breaking changes to existing ingestion flows

### Next Steps

Bishop's critical review will validate ARM API security, retry/throttle patterns, and credential handling before merge approval.