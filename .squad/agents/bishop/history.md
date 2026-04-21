# Bishop History

## Day 1 Context

- Requested by: Max Bush
- Project: Azure capacity dashboard
- Current branch: ai-capacity
- Stack: Node.js + Express, React, Azure Functions PowerShell worker, Python utilities, SQL, Azure App Service
- Review mission: critically review the full proposal implementation after the first development pass

## Learnings

- The team is expected to follow CI/CD best practices while working entirely in the feature branch.
- Final delivery should include an internal solution-style document that explains what changed and why those decisions were made.
- CapacityLatest view must project every column that downstream services SELECT; when adding new columns to CapacitySnapshot (like sourceType), all dependent views and queries must be updated in the same migration pass.
- Cross-layer classification logic (getRowResourceType) should be tested with both sourceType-present and sourceType-null rows to ensure the family-based fallback is exercised.
- When reviewing frontend work that depends on backend schema, always trace the full query path: view definition → service SELECT → API response → frontend classifier.

## 2026-04-21: Critical Review Completion (16:36:04Z)

### Verdict Summary

**Dallas Frontend:** ✅ APPROVED
- All frontend artifacts (react/main.js, app.js, index.html, capacityService.js) thoroughly reviewed
- Resource-type classification logic consistent across all 3 layers (sourceType with family-name fallback)
- AI Model Availability report properly isolated to dedicated API endpoints bypassing broken view path
- Admin scheduler wiring correct; safe defaults (ingest.openai.enabled='false') in place
- Ready for merge; no blocking issues

**Backend Schema:** ❌ REQUIRES REMEDIATION
- Finding #1 (CRITICAL): CapacityLatest view missing sourceType projection — crashes AI resource-type filter in capacity grid
  - Locations: sql/schema.sql, src/store/sql.js, migration 20260421-add-ai-model-availability.sql
  - Fix: Add sourceType to SELECT and PARTITION BY in view definition
- Finding #2 (MEDIUM): Paginated capacity query omits sourceType SELECT — falls back to fragile family-name matching
  - Location: src/services/capacityService.js lines 293–307
  - Fix: Add sourceType to SELECT list (depends on Finding #1 view projection)

### Parker Reassignment

Both findings assigned to Parker (fresh eyes protocol: Ash locked out because Ash authored original schema). Parker to remediate view contract, validate cross-layer classification with sourceType-present and sourceType-null rows, then trigger Bishop re-run validation for merge gate clearance.

### Design Validation Observations

Dallas's three-layer classification approach is robust:
1. Service layer (capacityService.js) sets sourceType from ingest
2. Classic UI layer (app.js) uses sourceType for "AI" classification, falls back to family-based
3. React layer (react/main.js) uses identical getRowResourceType logic
4. All three layers tested with both present and absent sourceType values
5. AI report queries separate dedicated tables (AIModelAvailabilityLatest) bypassing view issues
6. Existing "Compute" scope protections prevent AI row cross-contamination

### Merge Gate Status

Blocked on Parker's backend schema remediation. All other implementation work complete and approved.
