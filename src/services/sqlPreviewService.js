const { getRegionsForPreset } = require('../config/regionPresets');

function parseSubscriptionIds(filterValue) {
  if (!filterValue) {
    return [];
  }

  if (Array.isArray(filterValue)) {
    return filterValue.map((value) => String(value || '').trim()).filter(Boolean);
  }

  return String(filterValue)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildCommonFilterPreview(filters = {}) {
  const clauses = [];
  const params = {};
  const notes = [];

  if (filters.region && filters.region !== 'all') {
    clauses.push('AND region = @region');
    params.region = filters.region;
  }

  if (filters.family && filters.family !== 'all') {
    clauses.push('AND skuFamily = @family');
    params.family = filters.family;
  }

  if (filters.sku && filters.sku !== 'all') {
    clauses.push('AND skuName = @sku');
    params.sku = filters.sku;
  }

  if (filters.availability && filters.availability !== 'all') {
    clauses.push('AND availabilityState = @availability');
    params.availability = filters.availability;
  }

  const presetRegions = getRegionsForPreset(filters.regionPreset);
  if (presetRegions && presetRegions.length > 0) {
    const presetTokens = presetRegions.map((_, index) => `@presetRegion${index}`);
    clauses.push(`AND region IN (${presetTokens.join(', ')})`);
    presetRegions.forEach((regionName, index) => {
      params[`presetRegion${index}`] = regionName;
    });
  }

  const subscriptionIds = parseSubscriptionIds(filters.subscriptionIds);
  if (subscriptionIds.length > 0) {
    const subscriptionTokens = subscriptionIds.map((_, index) => `@subId${index}`);
    clauses.push(`AND CONVERT(nvarchar(64), subscriptionId) IN (${subscriptionTokens.join(', ')})`);
    subscriptionIds.forEach((subscriptionId, index) => {
      params[`subId${index}`] = subscriptionId;
    });
  }

  if (filters.resourceType && filters.resourceType !== 'all') {
    notes.push('resourceType is applied in memory after SQL retrieval to stay aligned with the dashboard classification logic.');
  }

  return {
    where: clauses.length ? `\n${clauses.join('\n')}` : '',
    params,
    notes
  };
}

function formatQuery(query) {
  return String(query || '').trim();
}

function buildCapacityPreview(filters = {}) {
  const common = buildCommonFilterPreview(filters);
  const pageSize = Math.max(10, Math.min(Number(filters.pageSize || 50), 500));
  const pageNumber = Math.max(1, Number(filters.pageNumber || 1));

  return [
    {
      title: 'Capacity Rows',
      endpoint: '/api/capacity',
      query: formatQuery(`
        SELECT
          capturedAtUtc,
          subscriptionKey,
          COALESCE(CONVERT(nvarchar(64), subscriptionId), 'legacy-data') AS subscriptionId,
          COALESCE(subscriptionName, 'Legacy data') AS subscriptionName,
          region,
          skuName AS sku,
          skuFamily AS family,
          availabilityState AS availability,
          quotaCurrent,
          quotaLimit,
          monthlyCostEstimate AS monthlyCost,
          vCpu,
          memoryGB,
          zonesCsv
        FROM dbo.CapacityLatest
        WHERE 1 = 1${common.where}
        ORDER BY region ASC, skuFamily ASC, skuName ASC
      `),
      params: common.params,
      notes: ['This is the base rowset used by Region Health, Top SKUs, Family Summary, and derived Capacity Score calculations.', ...common.notes]
    },
    {
      title: 'Paged Capacity Grid',
      endpoint: '/api/capacity/paged',
      query: formatQuery(`
        -- Same base query as Capacity Rows, then paged in memory after any resourceType filter.
        -- Requested pageNumber = ${pageNumber}, pageSize = ${pageSize}
      `),
      params: { pageNumber, pageSize },
      notes: ['The current implementation fetches the SQL-filtered CapacityLatest rowset, applies resourceType in memory, then slices the requested page.']
    }
  ];
}

function buildRegionMatrixPreview(filters = {}) {
  return buildCapacityPreview(filters).map((item, index) => {
    if (index !== 0) {
      return item;
    }

    return {
      ...item,
      title: 'Region Matrix Source Rows',
      endpoint: '/api/capacity -> in-memory matrix derivation',
      notes: [
        'Region Matrix reads the filtered CapacityLatest rowset from SQL through /api/capacity.',
        'The family-by-region matrix cells are then derived in memory in the React client from those SQL-backed rows; it does not call a separate live API.',
        ...item.notes
      ]
    };
  });
}

function buildTrendPreview(filters = {}) {
  const common = buildCommonFilterPreview(filters);
  const daysBack = Math.max(1, Math.min(Number(filters.days || 7), 30));
  return [{
    title: 'Capacity Trend Rollup',
    endpoint: '/api/capacity/trends',
    query: formatQuery(`
      SELECT
        CONVERT(varchar(10), CAST(capturedAtUtc AS date), 23) AS [day],
        capturedAtUtc,
        sourceType,
        skuFamily,
        skuName,
        availabilityState,
        quotaCurrent,
        quotaLimit,
        region,
        subscriptionId
      FROM dbo.CapacitySnapshot
      WHERE capturedAtUtc >= DATEADD(day, -@daysBack, SYSUTCDATETIME())${common.where}
      ORDER BY capturedAtUtc ASC, skuName ASC
    `),
    params: { daysBack, ...common.params },
    notes: ['The API now loads filtered snapshot rows and derives daily totals plus peak-utilization rollups in memory.', ...common.notes]
  }];
}

function buildSubscriptionSummaryPreview(filters = {}) {
  const common = buildCommonFilterPreview(filters);
  return [{
    title: 'Subscription Summary',
    endpoint: '/api/capacity/subscriptions',
    query: formatQuery(`
      SELECT
        ISNULL(subscriptionKey, 'legacy-data') AS subscriptionKey,
        COUNT(1) AS rowCount,
        SUM(CASE WHEN availabilityState = 'CONSTRAINED' THEN 1 ELSE 0 END) AS constrainedRows,
        SUM(quotaLimit - quotaCurrent) AS totalQuotaAvailable
      FROM dbo.CapacityLatest
      WHERE 1 = 1${common.where}
      GROUP BY ISNULL(subscriptionKey, 'legacy-data')
      ORDER BY COUNT(1) DESC, ISNULL(subscriptionKey, 'legacy-data') ASC
    `),
    params: common.params,
    notes: common.notes
  }];
}

function buildCapacityScorePreview(filters = {}) {
  return [
    ...buildCapacityPreview(filters),
    ...buildSubscriptionSummaryPreview(filters),
    {
      title: 'Latest Live Placement Snapshots',
      endpoint: 'internal merge for /api/capacity/scores',
      query: formatQuery(`
        WITH RankedSnapshots AS (
          SELECT
            capturedAtUtc,
            desiredCount,
            region,
            skuName,
            livePlacementScore,
            livePlacementAvailable,
            livePlacementRestricted,
            warningMessage,
            ROW_NUMBER() OVER (
              PARTITION BY region, skuName
              ORDER BY capturedAtUtc DESC, livePlacementSnapshotId DESC
            ) AS rn
          FROM dbo.LivePlacementSnapshot
          WHERE desiredCount = @desiredCount
            AND capturedAtUtc >= DATEADD(hour, -@maxAgeHours, SYSUTCDATETIME())
        )
        SELECT capturedAtUtc, region, skuName, livePlacementScore, livePlacementAvailable, livePlacementRestricted, warningMessage
        FROM RankedSnapshots
        WHERE rn = 1
      `),
      params: {
        desiredCount: Math.max(1, Math.min(Number(filters.desiredCount || 1), 1000)),
        maxAgeHours: 168
      },
      notes: ['Capacity Score rows are derived in memory from CapacityLatest, then the latest persisted live placement snapshots are merged in by region and SKU.']
    }
  ];
}

function buildQuotaWorkbenchPreview(filters = {}) {
  const managementGroupId = filters.managementGroupId || 'all';
  const groupQuotaName = filters.groupQuotaName || 'all';
  const region = filters.region || 'all';
  const quotaName = filters.family || filters.quotaName || 'all';
  const analysisRunId = filters.analysisRunId || null;

  return [
    {
      title: 'Quota Candidate Runs',
      endpoint: '/api/quota/candidate-runs',
      query: formatQuery(`
        SELECT
          analysisRunId,
          capturedAtUtc,
          MAX(sourceCapturedAtUtc) AS latestSourceCapturedAtUtc,
          COUNT(*) AS rowCount,
          COUNT(DISTINCT subscriptionId) AS subscriptionCount,
          SUM(CASE WHEN suggestedMovable > 0 THEN 1 ELSE 0 END) AS movableCandidateCount
        FROM dbo.QuotaCandidateSnapshot
        WHERE managementGroupId = @managementGroupId
          AND groupQuotaName = @groupQuotaName
          AND (@region = 'all' OR region = @region)
          AND (@quotaName = 'all' OR quotaName = @quotaName)
        GROUP BY analysisRunId, capturedAtUtc
        ORDER BY capturedAtUtc DESC, analysisRunId DESC
      `),
      params: { managementGroupId, groupQuotaName, region, quotaName },
      notes: []
    },
    {
      title: 'Selected Quota Candidate Snapshot',
      endpoint: '/api/quota/candidates',
      query: formatQuery(`
        WITH SelectedRun AS (
          SELECT TOP (1)
            analysisRunId,
            capturedAtUtc
          FROM dbo.QuotaCandidateSnapshot
          WHERE managementGroupId = @managementGroupId
            AND groupQuotaName = @groupQuotaName
            AND (@analysisRunId IS NULL OR analysisRunId = @analysisRunId)
            AND (@region = 'all' OR region = @region)
            AND (@quotaName = 'all' OR quotaName = @quotaName)
          GROUP BY analysisRunId, capturedAtUtc
          ORDER BY capturedAtUtc DESC, analysisRunId DESC
        )
        SELECT
          qcs.analysisRunId,
          qcs.capturedAtUtc,
          qcs.sourceCapturedAtUtc,
          qcs.managementGroupId,
          qcs.groupQuotaName,
          qcs.subscriptionId,
          qcs.subscriptionName,
          qcs.region,
          qcs.quotaName,
          qcs.skuList,
          qcs.skuCount,
          qcs.availabilityState,
          qcs.quotaCurrent,
          qcs.quotaLimit,
          qcs.quotaAvailable,
          qcs.suggestedMovable,
          qcs.safetyBuffer,
          qcs.subscriptionHash,
          qcs.candidateStatus
        FROM dbo.QuotaCandidateSnapshot qcs
        INNER JOIN SelectedRun selectedRun
          ON selectedRun.analysisRunId = qcs.analysisRunId
        WHERE (@region = 'all' OR qcs.region = @region)
          AND (@quotaName = 'all' OR qcs.quotaName = @quotaName)
        ORDER BY qcs.region, qcs.quotaName, qcs.suggestedMovable DESC, qcs.subscriptionName
      `),
      params: { managementGroupId, groupQuotaName, region, quotaName, analysisRunId },
      notes: ['Plan, simulate, and apply actions build on the selected captured candidate run rather than querying ARM directly.']
    }
  ];
}

function buildAdminPreview() {
  return [{
    title: 'Recent Dashboard Operations',
    endpoint: 'admin status history',
    query: formatQuery(`
      SELECT TOP (@limitRows)
        operationLogId,
        operationType,
        operationName,
        status,
        triggerSource,
        startedAtUtc,
        completedAtUtc,
        durationMs,
        rowsAffected,
        subscriptionCount,
        requestedDesiredCount,
        effectiveDesiredCount,
        regionPreset,
        note,
        errorMessage
      FROM dbo.DashboardOperationLog
      ORDER BY startedAtUtc DESC, operationLogId DESC
    `),
    params: { limitRows: 25 },
    notes: ['The admin status panel also reads persisted scheduler settings from the dashboard settings store.']
  }];
}

function buildSqlPreviewForView(view, filters = {}) {
  switch (view) {
    case 'capacity-grid':
      return buildCapacityPreview(filters);
    case 'region-health':
    case 'region-matrix':
    case 'sku-chart':
    case 'family-summary':
      return view === 'region-matrix' ? buildRegionMatrixPreview(filters) : buildCapacityPreview(filters);
    case 'trend':
      return buildTrendPreview({ ...filters, days: filters.days || 7 });
    case 'capacity-score':
      return buildCapacityScorePreview(filters);
    case 'quota-workbench':
      return buildQuotaWorkbenchPreview(filters);
    case 'admin':
      return buildAdminPreview();
    case 'recommender':
      return [{
        title: 'Capacity Recommender Inputs',
        endpoint: '/api/capacity + PowerShell recommender',
        query: '-- The recommender is not driven by a direct SQL query. It uses the filtered capacity API rowset and PowerShell-based recommendation logic.',
        params: {},
        notes: ['Use the Capacity Rows query preview for the underlying SQL-backed source data.']
      }];
    default:
      return [{
        title: 'No SQL preview available',
        endpoint: view || 'unknown',
        query: '-- No SQL preview is defined for this view yet.',
        params: {},
        notes: []
      }];
  }
}

module.exports = {
  buildSqlPreviewForView
};