# Squad Decisions

## 2026-04-21

### Team Initialization

- Team hired for the `ai-capacity` feature branch.
- Cast names for this repo use the Alien assignment: Ripley, Dallas, Ash, Lambert, and Parker.
- Team state lives in this worktree-local `.squad/` directory.
- The current initiative is the Azure AI Capacity Tracking proposal in `docs/Proposal Azure AI Capacity Tracking.md`.
- Clarification questions for this effort should be asked one at a time.

### User Directives (2026-04-21T10:23:23-05:00)

**By:** Max Bush (via Copilot)  
**Directive:** Keep all work on the current feature branch, break tasks down and parallelize wherever possible, follow CI/CD best practices during delivery, and create customer-ready end-of-development documentation covering what was done and why decisions were made.  
**Rationale:** User request — captured for team memory.

### Architecture Decisions

#### D1: Dedicated AIModelAvailability Table (2026-04-21T10:24:30-05:00)

**What:** Store Azure OpenAI model catalog data in a dedicated `dbo.AIModelAvailability` table rather than reusing `dbo.CapacitySnapshot`.  
**Why:** Keeps quota snapshots and model catalog data separated because they have different semantics and query patterns. Catalog is a boolean availability matrix (no current/limit values); quota is utilization-based. Separate table lets each refresh on its own cadence.  
**Author:** Max Bush (via Copilot)

#### D2: Dual-Cadence Refresh Schedules (2026-04-21T10:25:00-05:00)

**What:** Refresh the Azure OpenAI model catalog on a separate slower cadence than quota ingestion.  
**Why:** Model availability changes less often than quota utilization, so decoupling refresh cadence keeps ingestion efficient and operationally cleaner. Prevents large ARM payloads from blocking catalog updates.  
**Author:** Max Bush (via Copilot)

#### D3: Sidebar Report for AI Model Availability (2026-04-21T10:25:30-05:00)

**What:** Add Azure OpenAI model availability as a new report section in the existing sidebar navigation.  
**Why:** Keeps the AI availability experience distinct from the main Capacity Explorer flow while fitting the current dashboard navigation model. Reuses existing DataTable and report component patterns.  
**Author:** Max Bush (via Copilot)

#### D4: Single Internal Handoff Document (2026-04-21T10:26:00-05:00)

**What:** Produce one internal end-of-development document that explains what was built and why the team made those decisions.  
**Why:** The document is meant to help the user learn the reasoning behind the solution choices, not to serve as an executive/customer deliverable split across multiple files.  
**Author:** Max Bush (via Copilot)

#### D5: AI Quota in Existing Views (2026-04-21T10:27:00-05:00)

**What:** Show Azure OpenAI quota data in the existing capacity/quota views and also add a separate AI model availability report.  
**Why:** Keeps quota utilization integrated with the current dashboard workflows while still introducing a dedicated report for catalog-style model availability data. Users can filter by "AI" resource type or see all data together.  
**Author:** Max Bush (via Copilot)

#### D6: Admin UI Cadence Setting (2026-04-21T10:32:00-05:00)

**What:** Expose the Azure OpenAI model catalog refresh cadence as an admin UI setting similar to the existing ingest interval controls.  
**Why:** The user wants model catalog cadence to be adjustable through the dashboard admin experience rather than staying backend-only. Follows existing admin scheduler pattern.  
**Author:** Max Bush (via Copilot)

### Implementation & Rollout Details

#### OpenAI-Only Phase 1
- Phase 1 scope limited to Azure OpenAI quota and model catalog.
- Broader Cognitive Services (Speech, Vision, etc.) and Azure ML can follow same architectural pattern in future phases.
- No impact to existing Compute quota ingestion; new code paths are dormant until feature is enabled.

#### Feature Gate & Safe Deployment
- `INGEST_OPENAI_ENABLED` defaults to `false` for safe deployment to existing environments.
- Code and schema can merge to main without activating feature; admin controls rollout timing.
- Rollback is simple: set `INGEST_OPENAI_ENABLED=false`; AIModelAvailability table becomes inert.

#### CI/CD Best Practices
- All work stays on `ai-capacity` feature branch until ready for merge.
- Bishop performs critical final review of ARM API integration, retry/throttle logic, and credential handling before merge approval.
- Database migrations run before app deploy (schema-first pattern).
- Pre-deployment validation checklist documented (migration test, build validation, feature flag smoke test).

#### Parallelization Strategy
- Backend (Ash): SQL schema + ingestion service can build in parallel with frontend
- Frontend (Dallas): Resource type filter + sidebar report component can start immediately (API stubs before backend ready)
- Platform (Parker): Configuration + deployment validation can run independently
- Test (Lambert): Integration test planning can proceed in parallel; execution waits on code

#### No New Azure Resources Required
- Existing Reader RBAC on target subscriptions grants access to CognitiveServices APIs.
- No new Bicep changes needed; configuration via environment variables and admin UI.
- Database migrations auto-apply on first SQL connection (existing pattern).

### Implementation Wave Consolidation (2026-04-21T16:30:09Z)

#### Backend Implementation (Ash)
- **AI Ingestion Service:** Dual-table architecture (AIModelAvailability + CapacitySnapshot extension)
- **Layered Gate:** `INGEST_OPENAI_ENABLED` is authoritative rollout switch; `dbo.DashboardSetting` can further disable quota or model-catalog after env gate is on
- **Model Catalog Cadence:** Persisted as `schedule.aiModelCatalog.intervalMinutes` through existing admin scheduler API
- **Parallel Ingestion:** Uses existing `mapWithConcurrency` pattern; no new async complexity
- **API Endpoints:** `/api/ai/quota`, `/api/ai/models`, `/api/ai/models/regions` with consistent response format

#### Frontend Implementation (Dallas)
- **Resource-Type Classification:** Updated `getRowResourceType()` across react/main.js, app.js, src/services/capacityService.js to map sourceType values containing "openai" to "AI"
- **Sidebar Report:** New dedicated AI Models report separate from capacity/quota grids
- **AI Quota Visibility:** Quota rows appear in existing views when feature enabled and filter selected
- **Admin Settings:** Extended scheduler panel to surface `schedule.aiModelCatalog.intervalMinutes` (displayed as hours in UI)
- **Filter Isolation:** Ensures AI filter isolates from Compute filter without regression

#### Platform Implementation (Parker)
- **Safe Defaults:** `INGEST_OPENAI_ENABLED=false` on all environments initially
- **Zero New Resources:** Existing Reader RBAC sufficient; no Bicep changes needed
- **Dual-Cadence Defaults:** Quota 360 min (6h), catalog 1440 min (24h), both configurable
- **Migration Strategy:** Idempotent schema migrations with auto-apply on first connection
- **Deployment Sequence:** Schema → Code → Feature gate (phased rollout per admin UI)

#### Testing & Validation (Lambert)
- **Executable Surfaces:** npm start, /api/capacity/paged, SQL migration scripts validated
- **Critical Gaps Identified:** Migration seed default-off, CapacityLatest sourceType projection, frontend resource-type options
- **Regression Hotspots:** CapacityLatest performance, concurrent refresh deadlock, NULL column handling, filter isolation
- **Validation Gate:** Pre-Bishop readiness checklist with runnable checks
- **Bishop Review Gate:** Required before code merge (ARM API security, cross-layer correctness)

#### No-Go Items for Remediation
1. **Migration Default:** Change seed value from `true` to `false` before merge
2. **CapacityLatest View:** Add `sourceType` projection to support `/api/ai/quota` filtering
3. **Frontend Options:** Add "AI" to RESOURCE_TYPE_OPTIONS in both classic and React UIs

### Captured Inbox Decisions (Consolidated)

The following design decisions were captured by agents during implementation and consolidated:

- **Ash (Backend):** Database schema, API endpoints, ingestion service design, performance considerations
- **Dallas (Frontend):** Resource type filter implementation, sidebar report design, admin UI for scheduler
- **Parker (Platform):** Environment variables, deployment sequence, pre-deployment validation, operational guidance
- **Lambert (Tester):** Feature flag testing strategy, acceptance criteria framework, rollout risk mitigations
- **Ripley (Lead):** Architecture decisions D1–D7, staged implementation plan, CI/CD guidance, handoff notes

See `.squad/orchestration-log/` for complete agent deliverables and `.squad/log/` for session logs.
