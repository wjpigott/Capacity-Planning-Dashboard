# Orchestration Log: Parker Reassignment

**Timestamp:** 2026-04-21T16:36:04Z  
**Agent:** Parker (Backend Revision Lead)  
**Focus:** sourceType propagation gap remediation  
**Mode:** Background  
**Outcome:** Launched

## Summary

Bishop's critical review identified two backend schema issues that must be resolved before merge approval. Parker reassigned per reviewer protocol to remediate CapacityLatest view and paginated query gaps. Ash locked out from this revision scope to ensure fresh eyes on view contract.

## Assignment Details

### Task 1: CapacityLatest View Projection (BLOCKING)
- **What:** Update dbo.CapacityLatest to include sourceType in SELECT and PARTITION BY
- **Locations:** 
  - `sql/schema.sql` (lines 104–143)
  - `src/store/sql.js` ensureSchema() view script
  - New migration file: `sql/migrations/20260421-add-ai-model-availability.sql`
- **Severity:** CRITICAL — breaks AI resource-type filter in capacity grid

### Task 2: Paginated Query sourceType SELECT (CONDITIONAL)
- **What:** Add sourceType to paginated capacity query SELECT list
- **Location:** `src/services/capacityService.js` lines 293–307
- **Severity:** MEDIUM — silently degrades to fragile family-name fallback
- **Blocker:** Depends on Task 1 (view must project sourceType first)

## Reviewer Protocol

- **Rationale for Fresh Eyes:** Ash authored original CapacitySnapshot schema; view contract review benefits from independent perspective
- **Scope Lock:** Ash remains locked out of this revision pass to ensure separation of concerns

## Validation Checklist

- [ ] View definition updated in both sql/schema.sql and src/store/sql.js
- [ ] Migration file created and tested for idempotency
- [ ] Paginated query SELECT updated to include sourceType
- [ ] Cross-layer classification logic validated with sourceType-present and sourceType-null rows
- [ ] Merge gate cleared after Bishop re-run validation

## Status

Awaiting Parker remediation and re-run validation before merge approval.
