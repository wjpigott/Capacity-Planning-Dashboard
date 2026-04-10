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

  return where;
}

async function getCapacityRows(filters) {
  const pool = await getSqlPool();

  if (!pool) {
    return applyFilters(applyRegionPreset(mockRows, filters.regionPreset), filters);
  }

  const request = pool.request();
  let query = `
    SELECT subscriptionKey, region, skuName AS sku, skuFamily AS family, availabilityState AS availability,
           quotaCurrent, quotaLimit, monthlyCostEstimate AS monthlyCost
    FROM dbo.CapacityLatest
    WHERE 1 = 1
  `;

  query += appendCommonSqlFilters(filters, request);

  const result = await request.query(query);
  return applyRegionPreset(result.recordset.map((r) => ({
    subscriptionKey: r.subscriptionKey || 'legacy-data',
    region: r.region,
    sku: r.sku,
    family: r.family,
    availability: r.availability,
    quotaCurrent: Number(r.quotaCurrent || 0),
    quotaLimit: Number(r.quotaLimit || 0),
    monthlyCost: Number(r.monthlyCost || 0)
  })), filters.regionPreset);
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

module.exports = { getCapacityRows, getSubscriptionSummary, getCapacityTrends };
