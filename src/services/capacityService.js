const { getSqlPool, getSubscriptionsFromTable, getLatestLivePlacementSnapshots } = require('../store/sql');
const { mockRows } = require('../store/mockCapacity');
const { getRegionsForPreset } = require('../config/regionPresets');
const { CapacityDetailDTO, SubscriptionSummaryDTO, FamilySummaryDTO, TrendDTO, PaginationDTO } = require('../models/dtos');

const CANONICAL_COMPUTE_FAMILY_PATTERNS = [
  ['NCC', /^(NCC)/],
  ['NC', /^(NC)/],
  ['ND', /^(ND)/],
  ['NG', /^(NG)/],
  ['NV', /^(NV)/],
  ['N', /^(N)/],
  ['HB', /^(HB)/],
  ['HC', /^(HC)/],
  ['HX', /^(HX)/],
  ['H', /^(H)/],
  ['FX', /^(FX)/],
  ['F', /^(F)/],
  ['GS', /^(GS)/],
  ['G', /^(G)/],
  ['DC', /^(DC)/],
  ['DS', /^(DS)/],
  ['D', /^(D)/],
  ['E', /^(E)/],
  ['L', /^(L)/],
  ['M', /^(M)/],
  ['B', /^(B|BS|BAS|BPS)/],
  ['A', /^(A|BASICA)/]
];

function applyRegionPreset(rows, regionPreset) {
  if (!regionPreset || regionPreset === 'all' || regionPreset === 'custom') {
    return rows;
  }

  const presetRegions = getRegionsForPreset(regionPreset);
  if (!presetRegions) {
    return rows;
  }

  return rows.filter((row) => presetRegions.includes(row.region));
}

function getRowResourceType(row) {
  const family = String(row?.family || '').toLowerCase();
  const sku = String(row?.sku || '').toLowerCase();
  if (family.includes('disk') || sku.includes('disk') || sku.includes('snapshot')) {
    return 'Disk';
  }
  if (family.endsWith('family') || /^standard_/.test(String(row?.sku || ''))) {
    return 'Compute';
  }
  return 'Other';
}

function canonicalizeFamilyToken(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return '';
  }

  return value
    .replace(/^standard_/i, '')
    .replace(/^standard/i, '')
    .replace(/^basic_/i, 'Basic')
    .replace(/family$/i, '')
    .replace(/v\d+.*$/i, '')
    .replace(/[\s_-]/g, '')
    .toUpperCase();
}

function canonicalComputeFamilyLabel(rawFamily, skuName) {
  const tokens = [canonicalizeFamilyToken(rawFamily), canonicalizeFamilyToken(skuName)];
  for (const token of tokens) {
    if (!token) {
      continue;
    }

    for (const [label, pattern] of CANONICAL_COMPUTE_FAMILY_PATTERNS) {
      if (pattern.test(token)) {
        return label;
      }
    }
  }

  return '';
}

function applyFilters(rows, { region, family, availability, resourceType }) {
  return rows.filter((r) => {
    const byRegion = !region || region === 'all' || r.region === region;
    const byFamily = !family || family === 'all' || r.family === family;
    const byAvailability = !availability || availability === 'all' || r.availability === availability;
    const byType = !resourceType || resourceType === 'all' || getRowResourceType(r) === resourceType;
    return byRegion && byFamily && byAvailability && byType;
  });
}

function parseSubscriptionIds(filterValue) {
  if (!filterValue) {
    return [];
  }

  if (Array.isArray(filterValue)) {
    return filterValue.map((v) => String(v).trim()).filter(Boolean);
  }

  return String(filterValue)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Parse pagination parameters from filters
 * Supports page-based pagination (pageNumber starting at 1)
 */
function parsePaginationParams(filters) {
  const pageSize = Math.max(10, Math.min(Number(filters.pageSize || 100), 500));
  const pageNumber = Math.max(1, Number(filters.pageNumber || 1));
  const offset = (pageNumber - 1) * pageSize;
  return { pageSize, pageNumber, offset };
}

function appendCommonSqlFilters(filters, request) {
  let where = '';

  if (filters.region && filters.region !== 'all') {
    where += ' AND region = @region';
    request.input('region', filters.region);
  }
  if (filters.family && filters.family !== 'all') {
    where += ' AND skuFamily = @family';
    request.input('family', filters.family);
  }
  if (filters.availability && filters.availability !== 'all') {
    where += ' AND availabilityState = @availability';
    request.input('availability', filters.availability);
  }

  const regions = getRegionsForPreset(filters.regionPreset);
  if (regions && regions.length > 0) {
    const regionParams = [];
    regions.forEach((regionName, index) => {
      const paramName = `presetRegion${index}`;
      request.input(paramName, regionName);
      regionParams.push(`@${paramName}`);
    });
    where += ` AND region IN (${regionParams.join(',')})`;
  }

  const subscriptionIds = parseSubscriptionIds(filters.subscriptionIds);
  if (subscriptionIds.length > 0) {
    const subParams = [];
    subscriptionIds.forEach((subId, index) => {
      const paramName = `subId${index}`;
      request.input(paramName, subId);
      subParams.push(`@${paramName}`);
    });
    where += ` AND ISNULL(subscriptionId, 'legacy-data') IN (${subParams.join(',')})`;
  }

  // NOTE: resourceType filtering is applied in-memory after SQL retrieval
  // to ensure consistency with getRowResourceType() classification logic.
  // SQL LIKE patterns were insufficient to match the full classification logic
  // (which checks both family and sku properties with prefix/suffix matching).

  return where;
}

async function getCapacityRows(filters) {
  const pool = await getSqlPool();

  if (!pool) {
    return applyFilters(applyRegionPreset(mockRows, filters.regionPreset), filters);
  }

  const request = pool.request();
  let query = `
      SELECT capturedAtUtc, subscriptionKey, subscriptionId, subscriptionName, region, skuName AS sku, skuFamily AS family, availabilityState AS availability,
        quotaCurrent, quotaLimit, monthlyCostEstimate AS monthlyCost, vCpu, memoryGB, zonesCsv
    FROM dbo.CapacityLatest
    WHERE 1 = 1
  `;

  query += appendCommonSqlFilters(filters, request);

  const result = await request.query(query);
  const rows = result.recordset.map((r) => ({
    capturedAtUtc: r.capturedAtUtc,
    subscriptionKey: r.subscriptionKey || 'legacy-data',
    subscriptionId: r.subscriptionId || 'legacy-data',
    subscriptionName: r.subscriptionName || 'Legacy data',
    region: r.region,
    sku: r.sku,
    family: r.family,
    availability: r.availability,
    quotaCurrent: Number(r.quotaCurrent || 0),
    quotaLimit: Number(r.quotaLimit || 0),
    monthlyCost: Number(r.monthlyCost || 0),
    vCpu: Number(r.vCpu || 0),
    memoryGB: Number(r.memoryGB || 0),
    zonesCsv: r.zonesCsv || ''
  }));
  
  // Apply in-memory filters (including resourceType) for consistency with client classification
  return applyFilters(applyRegionPreset(rows, filters.regionPreset), filters);
}

/**
 * Get paginated capacity data for the primary grid
 * Uses server-side paging to keep first load fast with large datasets.
 */
async function getCapacityRowsPaginated(filters) {
  const { pageSize, pageNumber, offset } = parsePaginationParams(filters);
  const pool = await getSqlPool();

  if (!pool) {
    const allRows = applyFilters(applyRegionPreset(mockRows, filters.regionPreset), filters);
    const total = allRows.length;
    const pagedRows = allRows.slice(offset, offset + pageSize);
    const facets = {
      regions: [...new Set(allRows.map((row) => row.region).filter(Boolean))].sort(),
      families: [...new Set(allRows.map((row) => row.family).filter(Boolean))].sort()
    };
    const summary = {
      constrainedRows: allRows.filter((row) => row.availability === 'CONSTRAINED').length,
      availableQuota: allRows.reduce((acc, row) => acc + (Number(row.quotaLimit || 0) - Number(row.quotaCurrent || 0)), 0),
      monthlyCost: allRows.reduce((acc, row) => acc + Number(row.monthlyCost || 0), 0)
    };

    return {
      data: pagedRows.map((r) => new CapacityDetailDTO(r)),
      pagination: new PaginationDTO(total, pageSize, pageNumber),
      facets,
      summary
    };
  }

  const request = pool.request();

  // Fetch all rows matching SQL filters (regionPreset, region, family, availability, subscriptions).
  // NOTE: resourceType filtering is NOT applied at SQL level; it's applied in-memory via applyFilters()
  // to ensure consistency with getRowResourceType() classification logic.
  let query = `
    SELECT 
      capturedAtUtc,
      subscriptionKey,
      ISNULL(subscriptionId, 'legacy-data') AS subscriptionId,
      ISNULL(subscriptionName, 'Legacy data') AS subscriptionName,
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
    WHERE 1 = 1
  `;
  
  query += appendCommonSqlFilters(filters, request);
  query += `
    ORDER BY region ASC, skuFamily ASC, skuName ASC
  `;

  const result = await request.query(query);
  
  // Apply in-memory filters (including resourceType) for accuracy
  const allRows = applyFilters(
    result.recordset.map((r) => ({
      capturedAtUtc: r.capturedAtUtc,
      subscriptionKey: r.subscriptionKey || 'legacy-data',
      subscriptionId: r.subscriptionId || 'legacy-data',
      subscriptionName: r.subscriptionName || 'Legacy data',
      region: r.region,
      sku: r.sku,
      family: r.family,
      availability: r.availability,
      quotaCurrent: Number(r.quotaCurrent || 0),
      quotaLimit: Number(r.quotaLimit || 0),
      monthlyCost: Number(r.monthlyCost || 0),
      vCpu: Number(r.vCpu || 0),
      memoryGB: Number(r.memoryGB || 0),
      zonesCsv: r.zonesCsv || ''
    })),
    filters
  );
  
  const filteredRows = applyRegionPreset(allRows, filters.regionPreset);
  const total = filteredRows.length;
  const pagedRows = filteredRows.slice(offset, offset + pageSize);
  
  const facets = {
    regions: [...new Set(filteredRows.map((row) => row.region).filter(Boolean))].sort(),
    families: [...new Set(filteredRows.map((row) => row.family).filter(Boolean))].sort()
  };
  const summary = {
    constrainedRows: filteredRows.filter((row) => row.availability === 'CONSTRAINED').length,
    availableQuota: filteredRows.reduce((acc, row) => acc + (Number(row.quotaLimit || 0) - Number(row.quotaCurrent || 0)), 0),
    monthlyCost: filteredRows.reduce((acc, row) => acc + Number(row.monthlyCost || 0), 0)
  };

  return {
    data: pagedRows.map((r) => new CapacityDetailDTO(r)),
    pagination: new PaginationDTO(total, pageSize, pageNumber),
    facets,
    summary
  };
}

async function getSubscriptions({ search, limit } = {}) {
  const pool = await getSqlPool();
  if (!pool) {
    return [{ subscriptionId: 'legacy-data', subscriptionName: 'Legacy data' }];
  }

  // Fast path: query dedicated Subscriptions table (populated on ingest)
  const fromTable = await getSubscriptionsFromTable({ search, limit });
  if (fromTable !== null) {
    return fromTable;
  }

  // Fallback (pre-migration): derive subscription list from CapacityLatest
  const maxLimit = Math.max(10, Math.min(Number(limit || 500), 1000));
  const request = pool.request();
  request.input('limitRows', maxLimit);

  let query = `
    SELECT TOP (@limitRows)
      ISNULL(subscriptionId, 'legacy-data') AS subscriptionId,
      ISNULL(subscriptionName, 'Legacy data') AS subscriptionName
    FROM dbo.CapacityLatest
    WHERE 1 = 1
  `;

  if (search && search.trim()) {
    request.input('search', `%${search.trim()}%`);
    query += ` AND (
      ISNULL(subscriptionId, 'legacy-data') LIKE @search
      OR ISNULL(subscriptionName, 'Legacy data') LIKE @search
    )`;
  }

  query += `
    GROUP BY ISNULL(subscriptionId, 'legacy-data'), ISNULL(subscriptionName, 'Legacy data')
    ORDER BY ISNULL(subscriptionName, 'Legacy data') ASC
  `;

  const result = await request.query(query);
  return result.recordset.map((r) => ({
    subscriptionId: r.subscriptionId,
    subscriptionName: r.subscriptionName
  }));
}

async function getSubscriptionSummary(filters) {
  const pool = await getSqlPool();

  const sourceRows = applyFilters(applyRegionPreset(mockRows, filters.regionPreset), filters);
  if (!pool) {
    return [
      {
        subscriptionKey: 'legacy-data',
        rowCount: sourceRows.length,
        constrainedRows: sourceRows.filter((r) => r.availability === 'CONSTRAINED').length,
        totalQuotaAvailable: sourceRows.reduce((acc, r) => acc + (r.quotaLimit - r.quotaCurrent), 0)
      }
    ];
  }

  const request = pool.request();
  let query = `
    SELECT
      ISNULL(subscriptionKey, 'legacy-data') AS subscriptionKey,
      COUNT(1) AS [rowCount],
      SUM(CASE WHEN availabilityState = 'CONSTRAINED' THEN 1 ELSE 0 END) AS [constrainedRows],
      SUM(quotaLimit - quotaCurrent) AS [totalQuotaAvailable]
    FROM dbo.CapacityLatest
    WHERE 1 = 1
  `;

  query += appendCommonSqlFilters(filters, request);
  query += `
    GROUP BY ISNULL(subscriptionKey, 'legacy-data')
    ORDER BY COUNT(1) DESC, ISNULL(subscriptionKey, 'legacy-data') ASC
  `;

  const result = await request.query(query);
  return result.recordset.map((r) => ({
    subscriptionKey: r.subscriptionKey,
    rowCount: Number(r.rowCount || 0),
    constrainedRows: Number(r.constrainedRows || 0),
    totalQuotaAvailable: Number(r.totalQuotaAvailable || 0)
  }));
}

async function getCapacityTrends(filters) {
  const days = Math.max(1, Math.min(30, Number(filters.days || 7)));
  const pool = await getSqlPool();

  if (!pool) {
    const today = new Date().toISOString().slice(0, 10);
    const scoped = applyFilters(applyRegionPreset(mockRows, filters.regionPreset), filters);
    return [
      {
        day: today,
        totalRows: scoped.length,
        constrainedRows: scoped.filter((r) => r.availability === 'CONSTRAINED').length,
        totalQuotaAvailable: scoped.reduce((acc, r) => acc + (r.quotaLimit - r.quotaCurrent), 0)
      }
    ];
  }

  const request = pool.request();
  request.input('daysBack', days);

  let query = `
    SELECT
      CONVERT(varchar(10), CAST(capturedAtUtc AS date), 23) AS [day],
      COUNT(1) AS totalRows,
      SUM(CASE WHEN availabilityState = 'CONSTRAINED' THEN 1 ELSE 0 END) AS constrainedRows,
      SUM(quotaLimit - quotaCurrent) AS totalQuotaAvailable
    FROM dbo.CapacitySnapshot
    WHERE capturedAtUtc >= DATEADD(day, -@daysBack, SYSUTCDATETIME())
  `;

  query += appendCommonSqlFilters(filters, request);
  query += `
    GROUP BY CAST(capturedAtUtc AS date)
    ORDER BY [day] ASC
  `;

  const result = await request.query(query);
  return result.recordset.map((r) => ({
    day: r.day,
    totalRows: Number(r.totalRows || 0),
    constrainedRows: Number(r.constrainedRows || 0),
    totalQuotaAvailable: Number(r.totalQuotaAvailable || 0)
  }));
}

function toFamilyLabel(familyName) {
  return canonicalComputeFamilyLabel(familyName, '') || 'Unknown';
}

function isVmComputeFamilyName(familyName) {
  return /^standard[a-z0-9]+family$/i.test(String(familyName || '').trim())
    || /^basic[a-z0-9]+family$/i.test(String(familyName || '').trim());
}

function getCapacityScoreLabel(summary) {
  if (summary.constrainedRows > 0 && summary.okRows === 0 && summary.totalQuotaAvailable <= 0) {
    return 'Low';
  }

  if (summary.constrainedRows === 0 && summary.limitedRows === 0 && summary.totalQuotaAvailable > 0) {
    return 'High';
  }

  if (summary.okRows > 0 || summary.totalQuotaAvailable > 0 || summary.limitedRows > 0) {
    return 'Medium';
  }

  return 'Low';
}

function getCapacityScoreReason(summary) {
  if (summary.score === 'High') {
    return 'All in-scope rows are OK with positive available quota.';
  }

  if (summary.score === 'Medium') {
    if (summary.constrainedRows > 0) {
      return 'Mixed signal: at least one constrained row exists, but some capacity or quota remains.';
    }

    return 'Usable capacity remains, but at least one row is limited or quota headroom is narrow.';
  }

  return 'No positive quota headroom remains and constrained rows dominate the in-scope snapshot.';
}

function deriveCapacityScoreRows(rows) {
  const bySkuRegion = new Map();

  for (const row of rows) {
    const sku = row.sku || row.skuName;
    const family = row.family || row.skuFamily;
    const availability = row.availability || row.availabilityState;

    if (!row.region || !sku || !family) {
      continue;
    }

    const key = [row.region, sku].join('|');
    if (!bySkuRegion.has(key)) {
      bySkuRegion.set(key, {
        region: row.region,
        sku,
        family,
        subscriptions: new Set(),
        okRows: 0,
        limitedRows: 0,
        constrainedRows: 0,
        totalQuotaAvailable: 0,
        quotaLimitTotal: 0,
        quotaCurrentTotal: 0,
        latestCapturedAtUtc: row.capturedAtUtc || null
      });
    }

    const entry = bySkuRegion.get(key);
    entry.subscriptions.add(row.subscriptionId || row.subscriptionKey || 'legacy-data');
    entry.totalQuotaAvailable += Math.max(0, Number(row.quotaLimit || 0) - Number(row.quotaCurrent || 0));
    entry.quotaLimitTotal += Number(row.quotaLimit || 0);
    entry.quotaCurrentTotal += Number(row.quotaCurrent || 0);

    if (availability === 'OK') {
      entry.okRows += 1;
    } else if (availability === 'LIMITED') {
      entry.limitedRows += 1;
    } else {
      entry.constrainedRows += 1;
    }

    if (row.capturedAtUtc && (!entry.latestCapturedAtUtc || new Date(row.capturedAtUtc) > new Date(entry.latestCapturedAtUtc))) {
      entry.latestCapturedAtUtc = row.capturedAtUtc;
    }
  }

  return [...bySkuRegion.values()]
    .map((entry) => {
      const score = getCapacityScoreLabel(entry);

      return {
        region: entry.region,
        sku: entry.sku,
        family: entry.family,
        subscriptionCount: entry.subscriptions.size,
        okRows: entry.okRows,
        limitedRows: entry.limitedRows,
        constrainedRows: entry.constrainedRows,
        totalQuotaAvailable: entry.totalQuotaAvailable,
        utilizationPct: entry.quotaLimitTotal > 0 ? Math.round((entry.quotaCurrentTotal / entry.quotaLimitTotal) * 100) : 0,
        score,
        reason: getCapacityScoreReason({ ...entry, score }),
        latestCapturedAtUtc: entry.latestCapturedAtUtc
      };
    })
    .sort((left, right) => {
      const rank = { High: 0, Medium: 1, Low: 2 };
      if (rank[left.score] !== rank[right.score]) {
        return rank[left.score] - rank[right.score];
      }

      if (right.totalQuotaAvailable !== left.totalQuotaAvailable) {
        return right.totalQuotaAvailable - left.totalQuotaAvailable;
      }

      if (left.region !== right.region) {
        return left.region.localeCompare(right.region);
      }

      return left.sku.localeCompare(right.sku);
    });
}

async function getFamilySummary(filters) {
  const rows = await getCapacityRows(filters);
  const byFamily = new Map();

  for (const row of rows) {
    if (!isVmComputeFamilyName(row.family)) {
      continue;
    }

    const key = toFamilyLabel(row.family);
    if (!byFamily.has(key)) {
      byFamily.set(key, {
        family: key,
        familyRaw: row.family,
        skus: new Set(),
        okSkus: new Set(),
        maxVcpu: 0,
        maxMemoryGB: 0,
        zones: new Set(),
        hasLimited: false,
        hasConstrained: false,
        quotaMax: 0
      });
    }

    const entry = byFamily.get(key);
    entry.skus.add(row.sku);
    if (row.availability === 'OK') {
      entry.okSkus.add(row.sku);
    }
    entry.maxVcpu = Math.max(entry.maxVcpu, Number(row.vCpu || 0));
    entry.maxMemoryGB = Math.max(entry.maxMemoryGB, Number(row.memoryGB || 0));
    String(row.zonesCsv || '')
      .split(',')
      .map((z) => z.trim())
      .filter(Boolean)
      .forEach((z) => entry.zones.add(z));
    entry.hasLimited = entry.hasLimited || row.availability === 'LIMITED';
    entry.hasConstrained = entry.hasConstrained || row.availability === 'CONSTRAINED';
    entry.quotaMax = Math.max(entry.quotaMax, Number(row.quotaLimit || 0));
  }

  return [...byFamily.values()]
    .map((entry) => {
      const zoneText = entry.zones.size > 0
        ? `Zones ${[...entry.zones].sort().join(',')}`
        : 'No zone data';
      const zoneStatus = entry.zones.size >= 3 ? '✓' : (entry.zones.size > 0 ? '⚠' : '-');
      const status = entry.hasConstrained ? 'CONSTRAINED' : (entry.hasLimited ? 'LIMITED' : 'OK');
      const largest = entry.maxVcpu > 0 || entry.maxMemoryGB > 0
        ? `${entry.maxVcpu}vCPU/${entry.maxMemoryGB}GB`
        : 'n/a';

      return {
        family: entry.family,
        familyRaw: entry.familyRaw,
        skus: entry.skus.size,
        ok: entry.okSkus.size,
        largest,
        zones: `${zoneStatus} ${zoneText}`,
        status,
        quota: entry.quotaMax
      };
    })
    .sort((a, b) => a.family.localeCompare(b.family));
}

async function getCapacityScoreSummary(filters) {
  const rows = await getCapacityRows(filters);
  const scoreRows = deriveCapacityScoreRows(rows);
  const desiredCount = Math.max(1, Math.min(Number(filters?.desiredCount || 1), 1000));

  // Merge in saved live placement snapshots for the currently selected desired
  // count so users see persisted live score/state across sessions.
  try {
    const livePlacementSnapshots = await getLatestLivePlacementSnapshots(desiredCount, 168);
    if (Array.isArray(livePlacementSnapshots) && livePlacementSnapshots.length > 0) {
      const snapshotMap = new Map();
      livePlacementSnapshots.forEach((snap) => {
        snapshotMap.set(`${String(snap.sku || '').toLowerCase()}|${String(snap.region || '').toLowerCase()}`, snap);
      });

      scoreRows.forEach((scoreRow) => {
        const key = `${String(scoreRow.sku || '').toLowerCase()}|${String(scoreRow.region || '').toLowerCase()}`;
        const snapshot = snapshotMap.get(key);
        if (snapshot) {
          scoreRow.livePlacementScore = snapshot.livePlacementScore || scoreRow.livePlacementScore || 'N/A';
          scoreRow.livePlacementAvailable = typeof snapshot.livePlacementAvailable === 'boolean' ? snapshot.livePlacementAvailable : scoreRow.livePlacementAvailable;
          scoreRow.livePlacementRestricted = typeof snapshot.livePlacementRestricted === 'boolean' ? snapshot.livePlacementRestricted : scoreRow.livePlacementRestricted;
          scoreRow.liveCheckedAtUtc = snapshot.capturedAtUtc || scoreRow.liveCheckedAtUtc;
        }
      });
    }
  } catch (err) {
    console.warn('Failed to merge live placement snapshots into Capacity Score summary:', err.message);
    // Silently fail — continue with just derived scores
  }

  return scoreRows;
}

async function getCapacityScoreSummaryPaginated(filters = {}, pageNumber = 1, pageSize = 50) {
  const scoreRows = await getCapacityScoreSummary(filters);
  
  const total = scoreRows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const normalizedPageNumber = Math.max(1, Math.min(Number(pageNumber || 1), pageCount));
  const startIndex = (normalizedPageNumber - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  
  const pagedRows = scoreRows.slice(startIndex, endIndex);
  
  return {
    rows: pagedRows,
    pagination: {
      total,
      pageNumber: normalizedPageNumber,
      pageSize,
      pageCount,
      hasNext: normalizedPageNumber < pageCount,
      hasPrev: normalizedPageNumber > 1
    }
  };
}

module.exports = {
  getCapacityRows,
  getCapacityRowsPaginated,
  getSubscriptions,
  getSubscriptionSummary,
  getCapacityTrends,
  getFamilySummary,
  deriveCapacityScoreRows,
  getCapacityScoreSummary,
  getCapacityScoreSummaryPaginated
};
