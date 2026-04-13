const { getSqlPool } = require('../store/sql');
const { mockRows } = require('../store/mockCapacity');
const { getRegionsForPreset } = require('../config/regionPresets');

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

function applyFilters(rows, { region, family, availability }) {
  return rows.filter((r) => {
    const byRegion = !region || region === 'all' || r.region === region;
    const byFamily = !family || family === 'all' || r.family === family;
    const byAvailability = !availability || availability === 'all' || r.availability === availability;
    return byRegion && byFamily && byAvailability;
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
  return applyRegionPreset(result.recordset.map((r) => ({
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
  })), filters.regionPreset);
}

async function getSubscriptions({ search, limit }) {
  const pool = await getSqlPool();
  if (!pool) {
    return [{ subscriptionId: 'legacy-data', subscriptionName: 'Legacy data' }];
  }

  const maxLimit = Math.max(10, Math.min(Number(limit || 100), 500));
  const request = pool.request();
  request.input('limitRows', maxLimit);

  let query = `
    SELECT TOP (@limitRows)
      ISNULL(subscriptionId, 'legacy-data') AS subscriptionId,
      ISNULL(subscriptionName, 'Legacy data') AS subscriptionName,
      COUNT(1) AS [rowCount]
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
    ORDER BY COUNT(1) DESC, ISNULL(subscriptionName, 'Legacy data') ASC
  `;

  const result = await request.query(query);
  return result.recordset.map((r) => ({
    subscriptionId: r.subscriptionId,
    subscriptionName: r.subscriptionName,
    rowCount: Number(r.rowCount || 0)
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
  const cleaned = String(familyName || '').replace(/family$/i, '');
  const reduced = cleaned.replace(/^standard/i, '');
  const simple = reduced.replace(/v\d+$/i, '');
  return (simple || 'Unknown').toUpperCase();
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
    const key = row.family;
    if (!byFamily.has(key)) {
      byFamily.set(key, {
        family: toFamilyLabel(row.family),
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
  return deriveCapacityScoreRows(rows);
}

module.exports = {
  getCapacityRows,
  getSubscriptions,
  getSubscriptionSummary,
  getCapacityTrends,
  getFamilySummary,
  deriveCapacityScoreRows,
  getCapacityScoreSummary
};
