# Dallas History

## Day 1 Context

- Requested by: Max Bush
- Project: Azure capacity dashboard
- Current branch: ai-capacity
- Stack: React + existing classic UI alongside Node.js backend
- Initial proposal: Add AI/OpenAI capacity filters and a model availability experience

## Learnings

- Both classic and React UI layers exist in this repo.
- Resource-type filtering and report-grid reuse are central to the proposal.

### AI Capacity UI Design (2025-01-28)

**Architecture Patterns:**
- Resource type filtering uses `getRowResourceType()` function in 3 locations: react/main.js (line 321), app.js (line 49), src/services/capacityService.js (line 86). All must stay synchronized.
- RESOURCE_TYPE_OPTIONS constant (react/main.js line 23) drives filter dropdown. Adding new types requires updating this array AND the classification function.
- Sidebar reports are defined in REPORT_VIEWS constant (react/main.js line 30). New views need: 1) Entry in array, 2) Component implementation, 3) Routing in viewContent switch, 4) State management, 5) Data fetching effect.

**Key File Paths:**
- Main React UI: `react/main.js` (~2630 lines, large file)
- Classic UI: `app.js` (also large, similar structure)
- Capacity service: `src/services/capacityService.js` (backend filtering logic)
- Admin settings UI: AdminIngestionView component in react/main.js (line 1155)

**UI Patterns:**
- Use `SortableTableView` component for grid-based reports (reusable pattern)
- Filter sections use `DrawerFilterSection` wrapper (right-side flyout)
- Admin settings organized in `rx-field-grid rx-field-grid--filters` grid layout
- State management: Each major view has isolated state object to avoid coupling
- Data fetching: useEffect hooks trigger on activeView changes, lazy-load pattern

**Scheduler Settings Pattern:**
- Stored in state as nested object: `schedule.{scope}.{field}`
- Fields include `intervalMinutes` (or `intervalHours`), `runOnStartup`
- Persistence handled by backend API: GET/POST to `/api/admin/schedule`
- Runtime values displayed separately from editable settings

**Design Decisions Made:**
- AI quota rows share CapacitySnapshot table with Compute/Disk (backend decision, frontend adapts)
- AI Model Availability is new dedicated report (separate from quota grids)
- Model catalog refresh uses hours (not minutes) to distinguish from frequent quota ingestion
- "AI / OpenAI" label chosen to be specific yet allow future expansion
- Phase 1: React UI only for new AI report (classic UI gets filter support only)

**User Preferences:**
- Maintain consistency between React and classic UIs where possible
- Reuse existing grid components and styling patterns (rx-* CSS classes)
- Keep admin settings grouped logically (ingestion, placement, catalog refresh)
- Provide clear filter labels and intuitive column names

## 2026-04-21: Team Coordination Update

**Session:** Azure AI Capacity Tracking — Design Phase (completed 2026-04-21T10:55:47Z)

### Cross-Agent Dependencies

- **Ripley (Orchestration):** Implementation plan complete; UI updates sequenced after backend database schema ready
- **Ash (Backend):** API contracts finalized (`/api/ai/models`, `/api/ai/quota`, `/api/ai/models/regions`); Dallas can implement UI using these endpoints
- **Parker (Platform):** Deployment guidance confirms no new RBAC needed; environment variables designed for safe rollout
- **Lambert (Test):** Resource type filter isolation test cases defined; Dallas can implement test suite in parallel with components
- **Scribe (Session):** Team coordination captured; all UI decisions documented in decisions.md

### Implementation Ready

Dallas's design is complete and implementation-ready:
- Resource type filter update specified with code locations (react/main.js, app.js, capacityService.js)
- Sidebar report component structure defined with state management pattern
- Admin scheduler settings extension designed (mirrors existing pattern)
- Existing view integration mapped (no breaking changes; AI quota appears when feature enabled and filter selected)
- Regression test cases defined (AI filter isolation from Compute filter)

Next: Implement resource type filter in both UIs; create sidebar AI Models component; extend admin scheduler panel; test filter isolation and new report rendering

## 2026-04-21: Phase 1 Frontend Implementation

- Added `sourceType` to capacity DTOs and backend row shaping so both UIs can classify AI/OpenAI rows without guessing from display labels.
- Updated `getRowResourceType()` in `react/main.js`, `app.js`, and `src/services/capacityService.js` so `sourceType` values containing `openai` and families starting with `openai` map to `AI`.
- Added the dedicated AI Model Availability report to both sidebar experiences, but kept AI quota rows inside the existing capacity/quota views per the earlier design decision.
- Extended scheduler APIs and both admin screens to surface `schedule.aiModelCatalog.intervalMinutes`, showing/editing it as hours in the UI to make its slower cadence obvious.
- Validation completed against repo-native surfaces available today: `npm run start`, `Invoke-WebRequest` checks for `/`, `/react/`, `/react/main.js`, and `/api/admin/ingest/schedule`, plus `node --check` on changed non-React JavaScript files.

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

### Frontend Readiness

Dallas's implementation is ready for integration:
- Resource-type classification consistent across react/main.js, app.js, capacityService.js
- Sidebar AI Models report component implemented with state management
- Admin scheduler extension mirrors existing pattern (no new UI patterns)
- Filter isolation validated (AI filter separate from Compute)
- Validation passed on npm start, API endpoints, and component rendering

### Next Steps

Bishop's critical review will validate cross-layer UI/backend alignment and filter isolation before merge approval.
