# Parker History

## Day 1 Context

- Requested by: Max Bush
- Project: Azure-hosted capacity dashboard
- Current branch: ai-capacity
- Stack: App Service, Azure SQL, managed identity, PowerShell Azure Functions worker
- Initial proposal: extend the dashboard with Azure OpenAI capacity tracking

## Learnings

- The architecture currently splits the static UI + Express API from a PowerShell worker host.
- New work may add env vars and operational cadence choices even if no new Azure resources are required.

### 2026-04-21: Azure AI Capacity Tracking Platform Design

**Context:** Designed platform integration for Azure OpenAI quota and model availability tracking.

**Key platform patterns:**
- **Feature flag pattern:** Use `INGEST_OPENAI_ENABLED=false` as default to ensure zero impact on existing deployments until explicitly enabled
- **Dual-cadence schedulers:** Fast quota ingestion (6h) + slow model catalog refresh (24h) via separate scheduler loops
- **Database-persisted admin settings:** Store scheduler intervals in `dbo.DashboardSetting` table, expose via admin UI
- **Schema migration approach:** Idempotent migrations with `IF OBJECT_ID...` checks, auto-apply on first SQL connection
- **RBAC validation:** Existing `Reader` role on subscriptions is sufficient for CognitiveServices APIs (`/locations/usages`, `/locations/models`)
- **Deployment safety:** Feature flags allow code merge without runtime changes; enable via env vars or admin UI post-deployment

**Key file paths:**
- Environment variable definitions: `.env.sample`
- Database migrations: `sql/migrations/20260421-add-ai-model-availability.sql`
- Scheduler logic pattern: `src/services/azureIngestionService.js` (lines 16-29 for status tracking, 559+ for scheduler setup)
- Admin settings API: `src/server.js` (lines 593-646 for scheduler settings management)
- Bicep infrastructure: `infra/main.bicep` (no changes needed for AI feature)

**Architectural decisions:**
- **Separate `AIModelAvailability` table vs. overloading `CapacitySnapshot`:** Chose separate table to avoid NULL vCpu/memoryGB columns and cleaner query patterns
- **sourceType discrimination in CapacitySnapshot:** Use `sourceType='live-azure-openai-ingest'` for AI quota rows alongside existing Compute rows
- **Admin UI exposure:** Model catalog refresh interval is admin-tunable via UI (follows existing pattern for ingest/livePlacement intervals)

**Operational recommendations:**
- **Production cadence:** AI quota 360 min (6h), model catalog 1440 min (24h)
- **Deployment sequence:** Code merge → deploy → migration auto-applies → enable via admin UI (phased rollout)
- **Monitoring:** Track ingestion duration, API errors, row counts per sourceType, model catalog staleness
- **Rollback:** Disable via env var or admin UI setting (no code revert needed); data rollback not recommended

**Risks mitigated:**
- ARM API throttling: Respect retry-after headers (existing code), slower default catalog cadence
- SQL storage growth: Model catalog is small (~1000 rows per refresh), AI quota follows existing snapshot patterns
- Feature flag misconfiguration: Default disabled prevents accidental enablement
- RBAC permission issues: Verified Reader role sufficient (no escalation needed)

**User preferences observed:**
- Max Bush prefers detailed documentation with operational runbooks
- Emphasis on CI/CD best practices and phased rollout strategies
- Safety-first approach: feature flags, idempotent migrations, zero-impact defaults

### 2026-04-21: Phase 1 Platform Slice Implementation

- Safe rollout now uses both DB defaults and explicit App Service flags: `INGEST_OPENAI_ENABLED` / `INGEST_OPENAI_MODEL_CATALOG` can hold AI ingestion off during deployment, while `dbo.DashboardSetting` keeps the long-lived defaults and catalog cadence.
- The AI migration now seeds `ingest.openai.enabled=false`, which keeps fresh environments feature-disabled until rollout validation is complete.
- Phase 1 Azure AI ingestion remains inside the web app process; the Function worker README should explicitly say no new worker endpoint or host setting is required for this slice.

## 2026-04-21: Team Coordination Update

**Session:** Azure AI Capacity Tracking — Design Phase (completed 2026-04-21T10:55:47Z)

### Cross-Agent Dependencies

- **Ripley (Orchestration):** Implementation plan defines deployment sequence (schema-first, code-second, feature gate last)
- **Ash (Backend):** Database schema and API contracts finalized; platform can validate deployment artifacts
- **Dallas (Frontend):** No platform changes needed; environment variables designed for safe configuration
- **Lambert (Test):** Pre-deployment validation checklist provided (database migration test, build, health checks, feature flag smoke test)
- **Scribe (Session):** Team coordination captured; all platform decisions documented in decisions.md

### Implementation Ready

Parker's design is complete and implementation-ready:
- Environment variables defined with safe defaults (no new Azure resources)
- Deployment sequence specified (code → migration → enable)
- Pre-deployment validation checklist provided (PowerShell scripts for migration, build, health, smoke test)
- Dual-cadence scheduler described (quota at 360min, catalog at 1440min default)
- Operational guidance documented (production recommendations, monitoring, rollback)
- Bicep validation complete (no changes needed; existing Reader RBAC sufficient)

Next: Validate database migration idempotency on scratch database; test feature flag deployment sequence; document in .env.sample and operational runbooks

## 2026-04-21: Critical Review Findings & Reassignment (16:36:04Z)

**Session:** Bishop Critical Review — Dallas Frontend APPROVED; Backend Schema Remediation Required

### Reassignment Rationale

Bishop's critical review of Dallas's frontend identified two backend schema gaps that block the AI resource-type filter in capacity grid. Per reviewer protocol, Parker (not Ash) assigned to remediate schema because:
1. Ash authored the original CapacitySnapshot schema
2. Fresh eyes needed on view contract to prevent confirmation bias in schema update
3. Platform role well-positioned to validate view/migration contract alignment

### Assignment: Fix CapacityLatest View Projection (BLOCKING)

**What:** Update dbo.CapacityLatest to include sourceType in SELECT and PARTITION BY  
**Why:** capacityService.getCapacityRows() issues `SELECT sourceType FROM dbo.CapacityLatest` → throws "Invalid column name 'sourceType'" → crashes non-paginated capacity grid → breaks AI resource-type filter  
**Locations:**
- `sql/schema.sql` lines 104–143 (view definition)
- `src/store/sql.js` ensureSchema() (embedded view script)
- `sql/migrations/20260421-add-ai-model-availability.sql` (migration)

**Validation:** sourceType must be in PARTITION BY to avoid dedup collisions between Compute and AI rows on same subscription/region/skuName

### Assignment: Fix Paginated Query sourceType SELECT (CONDITIONAL)

**What:** Add sourceType to paginated capacity query SELECT list  
**Why:** Paginated query omits sourceType → r.sourceType resolves to undefined → classification falls back to fragile family-name matching; works for 'openai' families today but breaks for any AI family not starting with 'openai'  
**Location:** `src/services/capacityService.js` lines 293–307  
**Blocker:** Depends on CapacityLatest view projection (Task 1)

### Merge Gate

Blocked on Parker's remediation. All other implementation work (Ash backend, Dallas frontend, Lambert testing) complete and approved. Once Parker's fixes validated and re-run Bishop approval triggered, merge gate clears.

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

### Platform Readiness

Parker's implementation is ready for deployment:
- `INGEST_OPENAI_ENABLED` defaults to `false` preventing unintended activation
- Dual-cadence scheduler defaults (quota 360min, catalog 1440min) can be customized via admin UI
- Pre-deployment validation checklist executable before rollout
- No RBAC or Bicep changes required; existing infrastructure sufficient

### Next Steps

Bishop's critical review will validate cross-layer correctness before merge approval.
