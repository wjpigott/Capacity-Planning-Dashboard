# Azure ARM API Integration Pattern

## Overview

Reusable pattern for integrating new Azure ARM provider APIs (Compute, CognitiveServices, etc.) into the capacity dashboard ingestion pipeline.

## When to Use

- Adding a new Azure resource type to capacity tracking (e.g., Storage, Networking, AI)
- Need to fetch quota or availability data from Azure ARM APIs
- Want to maintain consistency with existing Compute ingestion

## Pattern Structure

### 1. Create Provider-Specific Service Module

**Location:** `src/services/{provider}IngestionService.js`

**Exports:**
- `fetch{Resource}Usages(armGetAll, token, subscriptionId, region)` - Fetch quota data
- `fetch{Resource}Catalog(armGetAll, token, subscriptionId, region)` - Fetch availability/catalog (optional)
- `map{Resource}UsageToSnapshot(usage, context)` - Map to CapacitySnapshot schema
- `map{Resource}ToAvailability(item, context)` - Map to custom table schema (if needed)
- `insert{Resource}Data(rows)` - Bulk insert custom table data
- `get{Resource}Settings()` - Retrieve provider-specific settings

**Example:** `src/services/aiIngestionService.js`

### 2. ARM API Integration

Reuse shared utilities from `azureIngestionService.js`:
- `armGetAll(url, token)` - Paginated ARM GET with retry logic
- `mapWithConcurrency(items, concurrency, worker)` - Parallel region processing
- `sleep(ms)` - Rate limit management

**ARM API URL Pattern:**
```javascript
const usageUrl = `${ARM_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.{Provider}/locations/${region}/usages?api-version={version}`;
```

### 3. Data Mapping

#### For Quota Data (fits CapacitySnapshot):

```javascript
function mapToSnapshot(usage, context) {
  return {
    capturedAtUtc: context.capturedAtUtc,
    sourceType: 'live-azure-{provider}-ingest',  // Discriminator
    subscriptionKey: context.subscriptionKey,
    subscriptionId: context.subscriptionId,
    subscriptionName: context.subscriptionName,
    region: context.region,
    skuName: extractSkuName(usage),
    skuFamily: usage?.name?.value,
    vCpu: null,  // Provider-specific or null
    memoryGB: null,
    zonesCsv: null,
    availabilityState: computeAvailabilityState(usage),
    quotaCurrent: Number(usage?.currentValue || 0),
    quotaLimit: Number(usage?.limit || 0),
    monthlyCostEstimate: null
  };
}
```

#### For Catalog Data (custom table):

Create dedicated table with:
- `capturedAtUtc` (timestamp)
- `subscriptionId` (correlation)
- `region` (partition key)
- Provider-specific columns
- Indexes on (region, key columns, capturedAtUtc DESC)

### 4. Integration into Main Ingestion

In `azureIngestionService.js` within `runCapacityIngestion()`:

```javascript
// Retrieve provider settings
const {provider}Settings = await get{Provider}Settings();

// Parallel ingestion loop (inside subscription/region iteration)
if ({provider}Settings.enabled) {
  const {provider}RegionRows = await mapWithConcurrency(regions, regionConcurrency, async (region) => {
    const usages = await fetch{Provider}Usages(armGetAll, token, subscriptionId, region);
    return usages.map((usage) => 
      map{Provider}UsageToSnapshot(usage, {
        capturedAtUtc,
        subscriptionKey,
        subscriptionId,
        subscriptionName,
        region
      })
    );
  });
  
  {provider}Rows.push(...{provider}RegionRows.flat());
}

// After main quota insert
if ({provider}Settings.catalogEnabled && shouldRefreshCatalog()) {
  const catalogRows = await fetch{Provider}Catalog(...);
  await insert{Provider}Catalog(catalogRows);
}
```

### 5. Database Schema

#### Migration File Pattern

**Filename:** `sql/migrations/{YYYYMMDD}-add-{provider}-{feature}.sql`

**Content:**
```sql
-- Create custom table (if needed)
IF OBJECT_ID('dbo.{Provider}{Feature}', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.{Provider}{Feature} (
        id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        capturedAtUtc DATETIME2 NOT NULL,
        subscriptionId NVARCHAR(64) NOT NULL,
        region NVARCHAR(64) NOT NULL,
        -- Provider-specific columns
    );
    
    CREATE NONCLUSTERED INDEX IX_{Provider}_{Feature}_Region_Key 
        ON dbo.{Provider}{Feature}(region, {keyColumn}, capturedAtUtc DESC);
END;
GO

-- Add settings
IF NOT EXISTS (SELECT 1 FROM dbo.DashboardSetting WHERE settingKey = 'ingest.{provider}.enabled')
BEGIN
    INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
    VALUES ('ingest.{provider}.enabled', 'true', SYSUTCDATETIME());
END;
GO

-- Create latest view
CREATE OR ALTER VIEW dbo.{Provider}{Feature}Latest AS
WITH Ranked AS (
    SELECT *, ROW_NUMBER() OVER (
        PARTITION BY region, {keyColumn}
        ORDER BY capturedAtUtc DESC
    ) AS rn
    FROM dbo.{Provider}{Feature}
)
SELECT * FROM Ranked WHERE rn = 1;
GO
```

### 6. API Endpoints

**Pattern:** `/api/{provider}/{resource}` (GET)

```javascript
app.get('/api/{provider}/{resource}', async (req, res) => {
  try {
    const pool = await getSqlPool();
    if (!pool) {
      res.status(503).json({ error: 'Database not configured' });
      return;
    }
    
    const region = req.query.region;
    const {filterParam} = req.query.{filterParam};
    
    let query = 'SELECT * FROM dbo.{Provider}{Resource}Latest WHERE 1=1';
    const request = pool.request();
    
    if (region) {
      query += ' AND region = @region';
      request.input('region', sql.NVarChar, region);
    }
    
    if ({filterParam}) {
      query += ' AND {column} LIKE @{filterParam}';
      request.input('{filterParam}', sql.NVarChar, `%${filterParam}%`);
    }
    
    query += ' ORDER BY region, {keyColumn}';
    
    const result = await request.query(query);
    res.json({ rows: result.recordset });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve data', detail: err.message });
  }
});
```

## Example Implementation

See Azure OpenAI integration:
- Service: `src/services/aiIngestionService.js`
- Migration: `sql/migrations/20260421-add-ai-model-availability.sql`
- Integration: `src/services/azureIngestionService.js` (AI sections)
- Endpoints: `src/server.js` (`/api/ai/*`)

## Checklist

- [ ] Create `{provider}IngestionService.js` with fetch/map/insert functions
- [ ] Add migration file with table, indexes, settings, view
- [ ] Import provider service into `azureIngestionService.js`
- [ ] Add provider ingestion logic to `runCapacityIngestion()`
- [ ] Add API endpoints to `server.js`
- [ ] Update ingestion summary to include provider row counts
- [ ] Test with real Azure subscription
- [ ] Document in design doc

## Best Practices

1. **Defensive parsing:** ARM APIs may return unexpected shapes; use fallbacks and null checks
2. **Parallel fetch:** Use `mapWithConcurrency` for region-level parallelism
3. **Separate cadences:** Use settings to control refresh frequency independently
4. **Bulk insert:** Use `sql.Table` for efficient batch inserts; do not rely on `pool.request().table(...)`
5. **Indexing:** Always index by region and key columns for fast lookups
6. **Settings-driven:** Make features toggle-able via `dbo.DashboardSetting`
7. **Safe rollout:** Treat environment flags as the master kill switch and let SQL settings refine behavior only after the env gate is enabled

## ARM API Common Patterns

### Usage/Quota API
- Path: `/subscriptions/{sub}/providers/{Provider}/locations/{region}/usages`
- Response: `{ value: [{ name: { value, localizedValue }, currentValue, limit, unit }] }`

### SKU/Catalog API
- Path: `/subscriptions/{sub}/providers/{Provider}/locations/{region}/models` or `.../skus`
- Response: Provider-specific; often `{ value: [{ kind, name, capabilities, ... }] }`

### Permissions
- Standard: Reader role on subscription
- Special: Some APIs may require Contributor (check docs)

## Related Patterns

- **Capacity Score Derivation:** `src/services/capacityService.js` - `deriveCapacityScoreRows()`
- **Subscription Discovery:** `azureIngestionService.js` - `listSubscriptions()`
- **Region Presets:** `src/config/regionPresets.js` - `getRegionsForPreset()`
