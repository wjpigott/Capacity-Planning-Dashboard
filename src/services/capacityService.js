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

async function getCapacityRows(filters) {
  const pool = await getSqlPool();

  if (!pool) {
    return applyFilters(applyRegionPreset(mockRows, filters.regionPreset), filters);
  }

  const request = pool.request();
  let query = `
    SELECT region, skuName AS sku, skuFamily AS family, availabilityState AS availability,
           quotaCurrent, quotaLimit, monthlyCostEstimate AS monthlyCost
    FROM dbo.CapacityLatest
    WHERE 1 = 1
  `;

  if (filters.region && filters.region !== 'all') {
    query += ' AND region = @region';
    request.input('region', filters.region);
  }
  if (filters.family && filters.family !== 'all') {
    query += ' AND skuFamily = @family';
    request.input('family', filters.family);
  }
  if (filters.availability && filters.availability !== 'all') {
    query += ' AND availabilityState = @availability';
    request.input('availability', filters.availability);
  }

  const result = await request.query(query);
  return applyRegionPreset(result.recordset.map((r) => ({
    region: r.region,
    sku: r.sku,
    family: r.family,
    availability: r.availability,
    quotaCurrent: Number(r.quotaCurrent || 0),
    quotaLimit: Number(r.quotaLimit || 0),
    monthlyCost: Number(r.monthlyCost || 0)
  })), filters.regionPreset);
}

module.exports = { getCapacityRows };
