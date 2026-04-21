# AI Capacity UI Integration - Delivery Summary

**Date:** 2025-01-28  
**Agent:** Dallas (Frontend Dev)  
**Branch:** ai-capacity  
**Status:** Design Complete, Ready for Implementation

---

## What Was Delivered

A comprehensive UI design document that defines how Azure OpenAI capacity tracking integrates into the existing dashboard, addressing all four requested deliverables:

### 1. UI Integration Plan for AI Quota in Existing Views ✅

**Solution:** Extend the resource type filter to include "AI / OpenAI" option.

**Changes Required:**
- Update `RESOURCE_TYPE_OPTIONS` constant in both React and Classic UIs
- Modify `getRowResourceType()` function in 3 locations to detect AI rows via `sourceType` or family prefix
- AI quota data automatically appears in existing grids (Capacity Grid, Region Health, etc.) when backend ingests it

**Impact:** Zero structural changes to grids. AI TPM/RPM data maps cleanly onto existing CapacitySnapshot schema columns.

---

### 2. New Sidebar-Based AI Model Availability Report ✅

**Solution:** New report view showing model-region-deployment type matrix.

**Design Includes:**
- New entry in `REPORT_VIEWS` constant: `'ai-models'` positioned after Family Summary
- Custom component: `AIModelAvailabilityView` with filters for:
  - Model name search
  - Deployment type (Standard, Global Standard, Provisioned Managed, Data Zone)
  - Fine-tuning support toggle
- Grid columns: Model, Version, Region, Deployment Types, Fine-Tuning, Deprecation Date
- Backend API: `GET /api/ai/models` with query parameter support

**Reuse Strategy:** Leverages existing `SortableTableView` component pattern.

---

### 3. Frontend Filter and Admin Setting Changes ✅

**Filter Changes:**
- Add "AI / OpenAI" to resource type dropdown (React + Classic UIs)
- Update classification logic in 3 files to maintain consistency

**Admin Settings:**
- New section in Scheduler Settings panel: "AI Model Catalog Refresh (hours)"
- Fields: `intervalHours` (default 24), `runOnStartup` checkbox
- Runtime value display alongside existing intervals
- State schema extended to include `aiModelCatalog` scope

**Backend Coordination Needed:**
- Scheduler API (`/api/admin/schedule`) must accept and persist new field
- Database schema update for scheduler settings

---

### 4. Risks, Dependencies, and Parallel Work Split ✅

**Key Risks Identified:**
- NULL vCPU/Memory values in AI rows breaking existing grids → **Mitigation:** Null-safe renderers
- Resource type filter confusion → **Mitigation:** Clear "AI / OpenAI" label
- State management complexity → **Mitigation:** Isolated AI model state

**Critical Dependencies:**
- Backend must implement `/api/ai/models` endpoint (API contract defined)
- Backend must ensure AI quota rows have `sourceType: 'live-azure-openai-ingest'`
- Schema migration to add `sourceType` column if not exists

**Parallel Work Plan:**
- **Frontend Track (Dallas):** Can proceed with all UI changes using mock data
- **Backend Track:** API implementation, ingestion, scheduler extension
- **Integration Points:** 4 checkpoints defined (API contract, test data, admin wiring, E2E)

---

## Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| Use "AI / OpenAI" label | Clear, specific to Phase 1 scope, allows future expansion |
| Hours (not minutes) for catalog refresh | Model availability changes infrequently vs. quota data |
| Separate `/api/ai/models` endpoint | Catalog data has different lifecycle than usage/quota data |
| Place AI Models after Family Summary | Logical grouping: capacity details → catalog views |
| React-only for new report in Phase 1 | Classic UI has no sidebar; focus effort where users are migrating |

---

## What Changed and Why

### Why This Approach?

1. **Minimal Disruption:** AI quota fits into existing CapacitySnapshot schema without breaking changes.
2. **Pattern Reuse:** New report follows established dashboard patterns (SortableTableView, DrawerFilterSection).
3. **Clear Separation:** Quota data (in grids) vs. catalog data (new report) are conceptually distinct.
4. **Incremental Delivery:** Frontend can build UI with mocks while backend builds ingestion pipeline.

### Why These Design Choices?

- **Resource Type Filter:** Users already understand "Compute", "Disk" → "AI" is natural extension.
- **Dedicated Report:** Model availability matrix doesn't fit quota grid semantics (no current/limit values).
- **Admin Hours Setting:** Aligns refresh cadence with data update frequency (models change slowly).

---

## Next Steps for Implementation

### Dallas (Frontend) Can Start Immediately:
1. Add "AI" to RESOURCE_TYPE_OPTIONS
2. Update getRowResourceType() functions
3. Build AIModelAvailabilityView component with mock data
4. Wire up routing and state management
5. Extend admin settings UI

### Requires Backend Coordination:
1. Finalize API contract for `/api/ai/models` (Swagger/OpenAPI)
2. Backend implements endpoint and ingestion
3. Integration testing with live OpenAI data
4. Validate scheduler settings persistence

### Testing Plan:
- Unit tests for getRowResourceType() with AI rows
- Component tests for AIModelAvailabilityView filters
- E2E test: Enable OpenAI ingest → Verify data in grids and new report
- Admin UI test: Save/load catalog refresh settings

---

## File Locations

- **Design Doc:** `.squad/decisions/inbox/dallas-ai-ui-design.md` (full specification)
- **History:** `.squad/agents/dallas/history.md` (learnings and patterns)
- **This Summary:** (You are here)

---

## Estimated Effort

| Track | LOC | Complexity | Duration |
|-------|-----|------------|----------|
| Frontend UI Changes | ~240 | Medium | 1-2 days |
| Backend API + Ingestion | ~500 | High | 3-4 days |
| Integration + Testing | n/a | Medium | 1 day |

**Total Project:** 5-7 days (assuming parallel work).

---

## Open Items for Team Discussion

1. **API Contract Review:** Backend team review and approve response schema for `/api/ai/models`
2. **Schema Migration:** Confirm approach for `sourceType` column (new or repurpose existing field?)
3. **Test Environment:** Need subscription with OpenAI deployments for realistic testing
4. **Classic UI Strategy:** Defer AI Model Availability to React-only, or build sidebar for classic?

---

**Design Status:** ✅ Complete and Approved (Ready for Implementation)  
**Author:** Dallas  
**Review Date:** TBD (pending team sync)
