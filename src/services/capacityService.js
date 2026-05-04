const sql = require('mssql');
const { getSqlPool, getSubscriptionsFromTable, getLatestLivePlacementSnapshots, ensureVmSkuCatalogSchema } = require('../store/sql');
const { mockRows } = require('../store/mockCapacity');
const { getRegionsForPreset } = require('../config/regionPresets');
const { CapacityDetailDTO, SubscriptionSummaryDTO, FamilySummaryDTO, TrendDTO, PaginationDTO } = require('../models/dtos');
const { getAIQuotaProviderFromSnapshot } = require('./aiIngestionService');
const { normalizeFamilyName } = require('../lib/familyNormalization');

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

function normalizeSkuName(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }

  const normalizeSuffix = (suffix) => String(suffix || '')
    .split('_')
    .map((segment) => {
      const normalized = String(segment || '').trim().toLowerCase();
      if (!normalized) {
        return '';
      }
      if (/^v\d+$/.test(normalized)) {
        return normalized;
      }
      return normalized.replace(/^([a-z]+)/, (match) => match.toUpperCase());
    })
    .filter(Boolean)
    .join('_');

  const prefixedSku = trimmed.match(/^(standard|basic|internal)(?:[_\s-]?)(.*)$/i);
  if (prefixedSku) {
    const prefixToken = String(prefixedSku[1] || '').toLowerCase();
    const prefix = prefixToken === 'standard'
      ? 'Standard'
      : (prefixToken === 'basic' ? 'Basic' : 'Internal');
    const rawSuffix = String(prefixedSku[2] || '').replace(/^[_\s-]+/, '');
    const suffix = normalizeSuffix(rawSuffix);
    return suffix ? `${prefix}_${suffix}` : prefix;
  }

  return trimmed;
}

function normalizeSkuFilter(value) {
  const rawValue = String(value || '').trim().toLowerCase();
  if (!rawValue || rawValue === 'all') {
    return '';
  }

  const normalized = normalizeSkuName(value);
  return normalized || '';
}

function normalizeCapacityRow(row) {
  const normalized = {
    ...row,
    sku: normalizeSkuName(row?.sku),
    family: normalizeFamilyName(row?.family)
  };
  const provider = resolveAIQuotaProvider(normalized);
  return {
    ...normalized,
    provider: provider || null
  };
}

function resolveAIQuotaProvider(row) {
  const explicitProvider = String(row?.provider || '').trim();
  if (explicitProvider) {
    return explicitProvider;
  }

  if (getRowResourceType(row) !== 'AI') {
    return null;
  }

  const provider = getAIQuotaProviderFromSnapshot({
    sourceType: row?.sourceType,
    skuFamily: row?.family,
    skuName: row?.sku
  });
  return provider && provider !== 'Unknown' ? provider : null;
}

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
  const sourceType = String(row?.sourceType || '').toLowerCase();
  const family = String(row?.family || '').toLowerCase();
  const sku = String(row?.sku || '').toLowerCase();
  if (sourceType.includes('azure-ai') || sourceType.includes('openai') || family.startsWith('openai') || family.startsWith('aiservices') || sku.startsWith('aiservices')) {
    return 'AI';
  }
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

function normalizeFamilyBaseFilter(value) {
  return String(value || '').trim().toUpperCase();
}

function getFamilyBaseSqlLikePatterns(familyBase) {
  const normalized = normalizeFamilyBaseFilter(familyBase);
  if (!normalized || normalized === 'ALL') {
    return [];
  }

  const isKnownComputeBase = CANONICAL_COMPUTE_FAMILY_PATTERNS.some(([label]) => label === normalized);
  if (!isKnownComputeBase || !/^[A-Z0-9]{1,8}$/.test(normalized)) {
    return [];
  }

  const token = normalized.toLowerCase();
  return [
    `${token}%`,
    `standard${token}%`,
    `standard_${token}%`,
    `standard ${token}%`,
    `basic${token}%`,
    `basic_${token}%`,
    `basic ${token}%`
  ];
}

function applyFilters(rows, { region, family, familyBase, sku, availability, resourceType, provider }) {
  const providerFilter = String(provider || '').trim();
  const normalizedFamilyBase = normalizeFamilyBaseFilter(familyBase);
  const normalizedSku = normalizeSkuFilter(sku);
  return rows.filter((r) => {
    const byRegion = !region || region === 'all' || r.region === region;
    const byFamily = !family || family === 'all' || r.family === family;
    const byFamilyBase = !normalizedFamilyBase || normalizedFamilyBase === 'ALL' || canonicalComputeFamilyLabel(r.family, r.sku) === normalizedFamilyBase;
    const bySku = !normalizedSku || r.sku === normalizedSku;
    const byAvailability = !availability || availability === 'all' || r.availability === availability;
    const byType = !resourceType || resourceType === 'all' || getRowResourceType(r) === resourceType;
    const byProvider = !providerFilter || providerFilter === 'all'
      || (getRowResourceType(r) === 'AI' && String(resolveAIQuotaProvider(r) || '').trim() === providerFilter);
    return byRegion && byFamily && byFamilyBase && bySku && byAvailability && byType && byProvider;
  });
}

function isBlockedAvailability(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'CONSTRAINED' || normalized === 'RESTRICTED';
}

function parseSubscriptionIds(filterValue) {
  if (!filterValue) {
    return [];
  }

  if (Array.isArray(filterValue)) {
    return filterValue
      .flatMap((value) => String(value)
        .split(',')
        .map((part) => part.trim()))
      .filter(Boolean);
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
  const parsedPageSize = Number(filters.pageSize);
  const parsedPageNumber = Number(filters.pageNumber);
  const pageSize = Number.isFinite(parsedPageSize)
    ? Math.max(10, Math.min(parsedPageSize, 500))
    : 100;
  const pageNumber = Number.isFinite(parsedPageNumber)
    ? Math.max(1, parsedPageNumber)
    : 1;
  const offset = (pageNumber - 1) * pageSize;
  return { pageSize, pageNumber, offset };
}

function slugifyProviderFilter(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildResourceTypeSqlExpression({ sourceTypeExpr = 'sourceType', familyExpr = 'skuFamily', skuExpr = 'skuName' } = {}) {
  const normalizedSourceType = `LOWER(COALESCE(${sourceTypeExpr}, ''))`;
  const normalizedFamily = `LOWER(COALESCE(${familyExpr}, ''))`;
  const normalizedSku = `LOWER(COALESCE(${skuExpr}, ''))`;

  return `
    CASE
      WHEN ${normalizedSourceType} LIKE '%azure-ai%'
        OR ${normalizedSourceType} LIKE '%openai%'
        OR ${normalizedFamily} LIKE 'openai%'
        OR ${normalizedFamily} LIKE 'aiservices%'
        OR ${normalizedSku} LIKE 'aiservices%'
        THEN 'AI'
      WHEN ${normalizedFamily} LIKE '%disk%'
        OR ${normalizedSku} LIKE '%disk%'
        OR ${normalizedSku} LIKE '%snapshot%'
        THEN 'Disk'
      WHEN ${normalizedFamily} LIKE '%family'
        OR COALESCE(${skuExpr}, '') LIKE 'Standard[_]%'
        THEN 'Compute'
      ELSE 'Other'
    END
  `;
}

function buildCapacityAnalyticsSqlFilters(filters, request) {
  let where = appendCommonSqlFilters(filters, request);
  const resourceType = String(filters.resourceType || '').trim();
  const provider = String(filters.provider || '').trim();
  const resourceTypeExpr = buildResourceTypeSqlExpression();

  if (resourceType && resourceType !== 'all') {
    where += ` AND ${resourceTypeExpr} = @resourceType`;
    request.input('resourceType', sql.NVarChar(32), resourceType);
  }

  if (provider && provider !== 'all') {
    if (provider === 'OpenAI') {
      where += ` AND (
        LOWER(COALESCE(sourceType, '')) = 'live-azure-openai-ingest'
        OR LOWER(COALESCE(skuFamily, '')) LIKE 'openai%'
      )`;
    } else {
      const providerSlug = slugifyProviderFilter(provider);
      if (providerSlug) {
        where += ` AND LOWER(COALESCE(sourceType, '')) = @providerSourceType`;
        request.input('providerSourceType', sql.NVarChar(128), `live-azure-ai-${providerSlug}-ingest`);
      }
    }
  }

  return where;
}

function sortCapacityAnalyticsSkuRows(rows = []) {
  return [...rows].sort((left, right) => {
    if (Number(right.available || 0) !== Number(left.available || 0)) {
      return Number(right.available || 0) - Number(left.available || 0);
    }

    if (Number(right.recommendationWeight || 0) !== Number(left.recommendationWeight || 0)) {
      return Number(right.recommendationWeight || 0) - Number(left.recommendationWeight || 0);
    }

    if (Number(right.observationCount || 0) !== Number(left.observationCount || 0)) {
      return Number(right.observationCount || 0) - Number(left.observationCount || 0);
    }

    return String(left.sku || '').localeCompare(String(right.sku || ''));
  });
}

function buildCapacityAnalyticsMatrix(matrixRows = []) {
  const familyMap = new Map();
  const regionSet = new Set();

  matrixRows.forEach((row) => {
    const family = normalizeFamilyName(row.family) || row.family || '?';
    const region = String(row.region || '').trim().toLowerCase();
    if (!family || !region) {
      return;
    }

    regionSet.add(region);
    if (!familyMap.has(family)) {
      familyMap.set(family, {});
    }

    familyMap.get(family)[region] = {
      okCount: Number(row.okCount || 0),
      limitedCount: Number(row.limitedCount || 0),
      constrainedCount: Number(row.constrainedCount || 0),
      skuCount: Number(row.skuCount || 0),
      zones: Array.isArray(row.zones) ? row.zones : String(row.zonesCsv || '').split(',').map((zone) => zone.trim()).filter(Boolean)
    };
  });

  function resolveCellStatus(cell) {
    if (!cell) {
      return 'BLOCKED';
    }

    const hasOk = Number(cell.okCount || 0) > 0;
    const hasLimited = Number(cell.limitedCount || 0) > 0;
    const hasConstrained = Number(cell.constrainedCount || 0) > 0;

    if (hasOk && (hasLimited || hasConstrained)) {
      return 'PARTIAL';
    }
    if (hasOk) {
      return 'OK';
    }
    if (hasLimited) {
      return 'LIMITED';
    }
    if (hasConstrained) {
      return 'CONSTRAINED';
    }
    return 'BLOCKED';
  }

  function resolveRowStatus(regionMap) {
    const statuses = Object.values(regionMap || {}).map((cell) => resolveCellStatus(cell));
    if (statuses.includes('OK')) {
      return 'OK';
    }
    if (statuses.includes('PARTIAL') || statuses.includes('LIMITED') || statuses.includes('CONSTRAINED')) {
      return 'CAUTION';
    }
    return 'BLOCKED';
  }

  return {
    regions: [...regionSet].sort(),
    rows: [...familyMap.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([family, regionMap]) => ({
        family,
        regionMap,
        rowStatus: resolveRowStatus(regionMap),
        readyRegionCount: Object.values(regionMap).filter((cell) => {
          const status = resolveCellStatus(cell);
          return status === 'OK' || status === 'PARTIAL';
        }).length
      }))
  };
}

async function getCapacityLatestColumnSet(pool) {
  return getObjectColumnSet(pool, 'dbo.CapacityLatest');
}

async function getCapacitySnapshotColumnSet(pool) {
  return getObjectColumnSet(pool, 'dbo.CapacitySnapshot');
}

async function getObjectColumnSet(pool, objectName) {
  const result = await pool.request()
    .input('objectName', sql.NVarChar(256), objectName)
    .query(`
      SELECT name
      FROM sys.columns
      WHERE object_id = OBJECT_ID(@objectName)
    `);

  return new Set((result.recordset || []).map((row) => String(row.name || '').trim()).filter(Boolean));
}

function buildCapacityLatestSelect(columns, tableAlias = '') {
  const hasColumn = (name) => columns.has(name);
  const qualify = (name) => (tableAlias ? `${tableAlias}.${name}` : name);
  const selectExpr = (name, expression) => hasColumn(name) ? expression : null;

  return [
    selectExpr('capturedAtUtc', qualify('capturedAtUtc')),
    selectExpr('sourceType', qualify('sourceType')),
    hasColumn('subscriptionKey') ? qualify('subscriptionKey') : "CAST('legacy-data' AS NVARCHAR(128)) AS subscriptionKey",
    hasColumn('subscriptionId') ? qualify('subscriptionId') : "CAST('legacy-data' AS NVARCHAR(64)) AS subscriptionId",
    hasColumn('subscriptionName') ? qualify('subscriptionName') : "CAST('Legacy data' AS NVARCHAR(256)) AS subscriptionName",
    qualify('region'),
    `${qualify('skuName')} AS sku`,
    `${qualify('skuFamily')} AS family`,
    `${qualify('availabilityState')} AS availability`,
    qualify('quotaCurrent'),
    qualify('quotaLimit'),
    `${qualify('monthlyCostEstimate')} AS monthlyCost`,
    hasColumn('vCpu') ? qualify('vCpu') : 'CAST(NULL AS INT) AS vCpu',
    hasColumn('memoryGB') ? qualify('memoryGB') : 'CAST(NULL AS DECIMAL(10,2)) AS memoryGB',
    hasColumn('zonesCsv') ? qualify('zonesCsv') : 'CAST(NULL AS NVARCHAR(256)) AS zonesCsv'
  ].filter(Boolean).join(',\n      ');
}

function buildLatestSnapshotBatchCte() {
  return `
    WITH LatestBatch AS (
      SELECT MAX(capturedAtUtc) AS capturedAtUtc
      FROM dbo.CapacitySnapshot
    )
  `;
}

function buildCapacitySnapshotHistorySelect(columns) {
  const hasColumn = (name) => columns.has(name);

  return [
    'CONVERT(varchar(10), CAST(capturedAtUtc AS date), 23) AS [day]',
    'capturedAtUtc',
    hasColumn('sourceType') ? 'sourceType' : 'CAST(NULL AS NVARCHAR(50)) AS sourceType',
    'skuFamily',
    'skuName',
    'availabilityState',
    'quotaLimit',
    'quotaCurrent',
    'region',
    hasColumn('subscriptionId') ? 'subscriptionId' : "CAST('legacy-data' AS NVARCHAR(64)) AS subscriptionId"
  ].join(',\n          ');
}

function appendCommonSqlFilters(filters, request, options = {}) {
  let where = '';
  const hasSubscriptionId = options.hasSubscriptionId !== false;

  if (filters.region && filters.region !== 'all') {
    where += ' AND region = @region';
    request.input('region', filters.region);
  }
  if (filters.family && filters.family !== 'all') {
    where += ' AND skuFamily = @family';
    request.input('family', normalizeFamilyName(filters.family));
  }
  if ((!filters.family || filters.family === 'all') && filters.familyBase && filters.familyBase !== 'all') {
    const familyBasePatterns = getFamilyBaseSqlLikePatterns(filters.familyBase);
    if (familyBasePatterns.length > 0) {
      const clauses = [];
      familyBasePatterns.forEach((pattern, index) => {
        const paramName = `familyBasePattern${index}`;
        request.input(paramName, sql.NVarChar(64), pattern);
        clauses.push(`LOWER(COALESCE(skuFamily, '')) LIKE @${paramName}`);
        clauses.push(`LOWER(COALESCE(skuName, '')) LIKE @${paramName}`);
      });
      where += ` AND (${clauses.join(' OR ')})`;
    }
  }
  if (filters.sku && filters.sku !== 'all') {
    where += ' AND skuName = @sku';
    request.input('sku', normalizeSkuFilter(filters.sku));
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
  if (hasSubscriptionId && subscriptionIds.length > 0) {
    const subParams = [];
    subscriptionIds.forEach((subId, index) => {
      const paramName = `subId${index}`;
      request.input(paramName, subId);
      subParams.push(`@${paramName}`);
    });
    where += ` AND CONVERT(nvarchar(64), subscriptionId) IN (${subParams.join(',')})`;
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
    return applyFilters(applyRegionPreset(mockRows.map(normalizeCapacityRow), filters.regionPreset), filters);
  }

  const capacitySnapshotColumns = await getCapacitySnapshotColumnSet(pool);
  const request = pool.request();
  let query = `${buildLatestSnapshotBatchCte()}
    SELECT ${buildCapacityLatestSelect(capacitySnapshotColumns, 'snapshot')}
    FROM dbo.CapacitySnapshot snapshot
    CROSS JOIN LatestBatch latestBatch
    WHERE snapshot.capturedAtUtc = latestBatch.capturedAtUtc
  `;

  query += appendCommonSqlFilters(filters, request);

  const result = await request.query(query);
  const rows = result.recordset.map((r) => normalizeCapacityRow({
    capturedAtUtc: r.capturedAtUtc,
    sourceType: r.sourceType || null,
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
    const allRows = applyFilters(applyRegionPreset(mockRows.map(normalizeCapacityRow), filters.regionPreset), filters);
    const total = allRows.length;
    const pagedRows = allRows.slice(offset, offset + pageSize);
    const facets = {
      regions: [...new Set(allRows.map((row) => row.region).filter(Boolean))].sort(),
      families: [...new Set(allRows.map((row) => row.family).filter(Boolean))].sort(),
      skus: [...new Set(allRows.map((row) => row.sku).filter(Boolean))].sort()
    };
    const summary = {
      constrainedRows: allRows.filter((row) => isBlockedAvailability(row.availability)).length,
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

  const capacitySnapshotColumns = await getCapacitySnapshotColumnSet(pool);
  const request = pool.request();

  let query = `${buildLatestSnapshotBatchCte()}
    SELECT
      ${buildCapacityLatestSelect(capacitySnapshotColumns, 'snapshot')}
    FROM dbo.CapacitySnapshot snapshot
    CROSS JOIN LatestBatch latestBatch
    WHERE snapshot.capturedAtUtc = latestBatch.capturedAtUtc
  `;
  
  query += appendCommonSqlFilters(filters, request);
  query += `
    ORDER BY snapshot.region ASC, snapshot.skuFamily ASC, snapshot.skuName ASC
  `;

  const result = await request.query(query);
  
  // Apply in-memory filters (including resourceType) for accuracy
  const allRows = applyFilters(
    result.recordset.map((r) => normalizeCapacityRow({
      capturedAtUtc: r.capturedAtUtc,
      sourceType: r.sourceType || null,
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
    families: [...new Set(filteredRows.map((row) => row.family).filter(Boolean))].sort(),
    skus: [...new Set(filteredRows.map((row) => row.sku).filter(Boolean))].sort()
  };
  const summary = {
    constrainedRows: filteredRows.filter((row) => isBlockedAvailability(row.availability)).length,
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

  const maxLimit = Math.max(10, Math.min(Number(limit || 500), 1000));
  const capacitySnapshotColumns = await getCapacitySnapshotColumnSet(pool);
  const hasSubscriptionId = capacitySnapshotColumns.has('subscriptionId');
  const hasSubscriptionName = capacitySnapshotColumns.has('subscriptionName');
  const subscriptionIdExpr = hasSubscriptionId
    ? "COALESCE(CONVERT(nvarchar(64), subscriptionId), 'legacy-data')"
    : "'legacy-data'";
  const subscriptionNameExpr = hasSubscriptionName
    ? "COALESCE(subscriptionName, 'Legacy data')"
    : "'Legacy data'";
  const request = pool.request();
  request.input('limitRows', maxLimit);

  let query = `${buildLatestSnapshotBatchCte()}
    SELECT TOP (@limitRows)
      ${subscriptionIdExpr} AS subscriptionId,
      ${subscriptionNameExpr} AS subscriptionName
    FROM dbo.CapacitySnapshot snapshot
    CROSS JOIN LatestBatch latestBatch
    WHERE snapshot.capturedAtUtc = latestBatch.capturedAtUtc
  `;

  if (search && search.trim()) {
    request.input('search', `%${search.trim()}%`);
    query += ` AND (
      ${subscriptionIdExpr} LIKE @search
      OR ${subscriptionNameExpr} LIKE @search
    )`;
  }

  query += `
    GROUP BY ${subscriptionIdExpr}, ${subscriptionNameExpr}
    ORDER BY ${subscriptionNameExpr} ASC
  `;

  const result = await request.query(query);
  return result.recordset.map((r) => ({
    subscriptionId: r.subscriptionId,
    subscriptionName: r.subscriptionName
  }));
}

async function getSubscriptionSummary(filters) {
  const rows = await getCapacityRows(filters);
  const bySubscription = new Map();

  for (const row of rows) {
    const key = row.subscriptionKey || 'legacy-data';
    if (!bySubscription.has(key)) {
      bySubscription.set(key, {
        subscriptionKey: key,
        rowCount: 0,
        constrainedRows: 0,
        totalQuotaAvailable: 0
      });
    }

    const entry = bySubscription.get(key);
    entry.rowCount += 1;
    if (isBlockedAvailability(row.availability)) {
      entry.constrainedRows += 1;
    }
    entry.totalQuotaAvailable += Number(row.quotaLimit || 0) - Number(row.quotaCurrent || 0);
  }

  return [...bySubscription.values()]
    .sort((left, right) => right.rowCount - left.rowCount || left.subscriptionKey.localeCompare(right.subscriptionKey));
}

async function getCapacityTrends(filters) {
  const days = Math.max(1, Math.min(30, Number(filters.days || 7)));
  const granularity = String(filters.granularity || 'daily').trim().toLowerCase() === 'hourly'
    ? 'hourly'
    : 'daily';
  const pool = await getSqlPool();

  if (!pool) {
    const scoped = applyFilters(applyRegionPreset(mockRows.map(normalizeCapacityRow), filters.regionPreset), filters).map((row) => ({
      ...row,
      capturedAtUtc: row.capturedAtUtc || new Date().toISOString()
    }));
    return deriveCapacityTrendRows(scoped, { granularity });
  }

  const hasScopedFamilyBase = Boolean(filters.familyBase && String(filters.familyBase).trim().toLowerCase() !== 'all');
  if (!hasScopedFamilyBase) {
    const request = pool.request();
    request.input('daysBack', days);

    let query = `
      WITH Bucketed AS (
        SELECT
          ${granularity === 'hourly'
            ? "CONVERT(varchar(13), capturedAtUtc, 120) + ':00:00Z' AS [bucket]"
            : "CONVERT(varchar(10), CAST(capturedAtUtc AS date), 23) AS [bucket]"},
          COUNT(1) AS totalRows,
          SUM(CASE WHEN availabilityState IN ('CONSTRAINED', 'RESTRICTED') THEN 1 ELSE 0 END) AS constrainedRows,
          SUM(quotaLimit - quotaCurrent) AS totalQuotaAvailable,
          MAX(CASE
            WHEN quotaLimit > 0 THEN CAST(ROUND((CAST(quotaCurrent AS float) / NULLIF(CAST(quotaLimit AS float), 0)) * 100.0, 0) AS int)
            ELSE 0
          END) AS peakUtilizationPct
        FROM dbo.CapacitySnapshot
        WHERE capturedAtUtc >= DATEADD(day, -@daysBack, SYSUTCDATETIME())
    `;

    query += buildCapacityAnalyticsSqlFilters(filters, request);
    query += `
        GROUP BY ${granularity === 'hourly'
          ? "CONVERT(varchar(13), capturedAtUtc, 120)"
          : 'CAST(capturedAtUtc AS date)'}
      )
      SELECT
        [bucket],
        totalRows,
        constrainedRows,
        totalQuotaAvailable,
        peakUtilizationPct,
        MAX(peakUtilizationPct) OVER (ORDER BY [bucket] ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS rolling7DayPeakUtilizationPct,
        MAX(peakUtilizationPct) OVER (ORDER BY [bucket] ROWS BETWEEN 13 PRECEDING AND CURRENT ROW) AS rolling14DayPeakUtilizationPct
      FROM Bucketed
      ORDER BY [bucket] ASC
    `;

    const result = await request.query(query);
    return result.recordset.map((row) => ({
      day: row.bucket,
      totalRows: Number(row.totalRows || 0),
      constrainedRows: Number(row.constrainedRows || 0),
      totalQuotaAvailable: Number(row.totalQuotaAvailable || 0),
      peakUtilizationPct: Number(row.peakUtilizationPct || 0),
      rolling7DayPeakUtilizationPct: Number(row.rolling7DayPeakUtilizationPct || 0),
      rolling14DayPeakUtilizationPct: Number(row.rolling14DayPeakUtilizationPct || 0)
    }));
  }

  const request = pool.request();
  request.input('daysBack', days);
  const capacitySnapshotColumns = await getCapacitySnapshotColumnSet(pool);
  let query = `
    SELECT
      ${buildCapacitySnapshotHistorySelect(capacitySnapshotColumns)}
    FROM dbo.CapacitySnapshot
    WHERE capturedAtUtc >= DATEADD(day, -@daysBack, SYSUTCDATETIME())
  `;

  query += appendCommonSqlFilters(filters, request, { hasSubscriptionId: capacitySnapshotColumns.has('subscriptionId') });
  query += `
    ORDER BY capturedAtUtc ASC, skuName ASC
  `;

  const result = await request.query(query);
  const rows = result.recordset.map((record) => normalizeCapacityRow({
    day: record.day,
    capturedAtUtc: record.capturedAtUtc,
    sourceType: record.sourceType,
    family: record.skuFamily,
    sku: record.skuName,
    availability: record.availabilityState,
    quotaLimit: Number(record.quotaLimit || 0),
    quotaCurrent: Number(record.quotaCurrent || 0),
    region: record.region,
    subscriptionId: record.subscriptionId
  }));
  return deriveCapacityTrendRows(rows, { granularity });
}

function deriveCapacityTrendRows(rows, options = {}) {
  const scopedRows = Array.isArray(rows) ? rows : [];
  const granularity = String(options.granularity || 'daily').trim().toLowerCase() === 'hourly'
    ? 'hourly'
    : 'daily';
  const grouped = new Map();
  const now = new Date().toISOString();

  scopedRows.forEach((row) => {
    const bucket = normalizeTrendBucket(row?.day || row?.capturedAtUtc || now, granularity);
    const current = grouped.get(bucket) || {
      day: bucket,
      totalRows: 0,
      constrainedRows: 0,
      totalQuotaAvailable: 0,
      peakUtilizationPct: 0
    };
    const quotaLimit = Number(row?.quotaLimit || 0);
    const quotaCurrent = Number(row?.quotaCurrent || 0);

    current.totalRows += 1;
    if (isBlockedAvailability(row?.availability)) {
      current.constrainedRows += 1;
    }
    current.totalQuotaAvailable += quotaLimit - quotaCurrent;

    if (quotaLimit > 0) {
      const utilizationPct = Math.round((quotaCurrent / quotaLimit) * 100);
      current.peakUtilizationPct = Math.max(current.peakUtilizationPct, utilizationPct);
    }

    grouped.set(bucket, current);
  });

  const ordered = [...grouped.values()]
    .sort((left, right) => String(left.day).localeCompare(String(right.day)));

  return ordered.map((row, index) => {
    const trailing7 = ordered.slice(Math.max(0, index - 6), index + 1);
    const trailing14 = ordered.slice(Math.max(0, index - 13), index + 1);
    return {
      day: row.day,
      totalRows: Number(row.totalRows || 0),
      constrainedRows: Number(row.constrainedRows || 0),
      totalQuotaAvailable: Number(row.totalQuotaAvailable || 0),
      peakUtilizationPct: Number(row.peakUtilizationPct || 0),
      rolling7DayPeakUtilizationPct: Math.max(0, ...trailing7.map((entry) => Number(entry.peakUtilizationPct || 0))),
      rolling14DayPeakUtilizationPct: Math.max(0, ...trailing14.map((entry) => Number(entry.peakUtilizationPct || 0)))
    };
  });
}

function normalizeTrendBucket(value, granularity) {
  const normalizedGranularity = String(granularity || 'daily').trim().toLowerCase() === 'hourly'
    ? 'hourly'
    : 'daily';
  const raw = String(value || '').trim();
  if (!raw) {
    return normalizedGranularity === 'hourly'
      ? new Date().toISOString().slice(0, 13) + ':00:00Z'
      : new Date().toISOString().slice(0, 10);
  }

  if (normalizedGranularity === 'hourly') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/.test(raw)) {
      return raw;
    }

    if (/^\d{4}-\d{2}-\d{2} \d{2}$/.test(raw)) {
      return raw.replace(' ', 'T') + ':00:00Z';
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 13) + ':00:00Z';
    }

    return raw.slice(0, 13).replace(' ', 'T') + ':00:00Z';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return raw.slice(0, 10);
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
    return 'All in-scope snapshot rows are OK with positive available quota.';
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
    entry.hasConstrained = entry.hasConstrained || isBlockedAvailability(row.availability);
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

async function getCapacityAnalyticsSummary(filters = {}) {
  const rows = await getCapacityRows(filters);
  const constrainedByRegion = new Map();

  rows.forEach((row) => {
    if (!['CONSTRAINED', 'RESTRICTED'].includes(String(row.availability || '').toUpperCase())) {
      return;
    }

    const region = String(row.region || '').trim();
    const family = normalizeFamilyName(row.family) || String(row.family || row.sku || '').trim() || 'Unknown';
    if (!region || !family) {
      return;
    }

    if (!constrainedByRegion.has(region)) {
      constrainedByRegion.set(region, new Map());
    }
    const familyCounts = constrainedByRegion.get(region);
    familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
  });

  const regionHealth = deriveCapacityAnalyticsRegionHealth(rows, constrainedByRegion);
  const topSkuRows = topCapacityAnalyticsSkuRows(rows);
  return {
    regionHealth,
    topSkus: topSkuRows.slice(0, 20).map(({ sku, available }) => ({ sku, available })),
    matrix: buildCapacityAnalyticsMatrix(Array.from(rows
      .filter((row) => getRowResourceType(row) === 'Compute')
      .reduce((acc, row) => {
        const family = normalizeFamilyName(row.family) || row.family || '?';
        const region = row.region;
        const key = `${family}|${region}`;
        const current = acc.get(key) || { family, region, okCount: 0, limitedCount: 0, constrainedCount: 0, skuCount: new Set(), zones: new Set() };
        const availability = String(row.availability || '').toUpperCase();
        if (availability === 'OK') current.okCount += 1;
        else if (availability === 'LIMITED') current.limitedCount += 1;
        else if (availability === 'CONSTRAINED' || availability === 'RESTRICTED') current.constrainedCount += 1;
        current.skuCount.add(normalizeSkuName(row.sku));
        String(row.zonesCsv || '')
          .split(',')
          .map((zone) => zone.trim())
          .filter(Boolean)
          .forEach((zone) => current.zones.add(zone));
        acc.set(key, current);
        return acc;
      }, new Map()).values()).map((entry) => ({
        ...entry,
        skuCount: entry.skuCount.size,
        zones: [...entry.zones].sort((left, right) => String(left).localeCompare(String(right), undefined, { numeric: true }))
      }))),
    recommendedTargetSku: topSkuRows[0] ? topSkuRows[0].sku : '',
    aiQuotaProviderOptions: [...new Set(rows
      .filter((row) => getRowResourceType(row) === 'AI')
      .map((row) => resolveAIQuotaProvider(row))
      .filter((provider) => provider && provider !== 'Unknown'))].sort((left, right) => left.localeCompare(right))
  };
}

function deriveCapacityAnalyticsRegionHealth(rows, constrainedByRegion = new Map()) {
  const byRegion = new Map();

  (rows || []).forEach((row) => {
    const region = String(row.region || '').trim();
    if (!region) {
      return;
    }

    if (!byRegion.has(region)) {
      byRegion.set(region, {
        region,
        totalRows: 0,
        deployableRows: 0,
        constrainedRows: 0,
        totalQuotaHeadroom: 0,
        deployableFamilies: new Set(),
        deployableSubscriptions: new Set()
      });
    }

    const entry = byRegion.get(region);
    const availability = String(row.availability || '').toUpperCase();
    entry.totalRows += 1;
    entry.totalQuotaHeadroom += Number(row.quotaLimit || 0) - Number(row.quotaCurrent || 0);

    if (availability === 'OK' || availability === 'LIMITED') {
      entry.deployableRows += 1;
      entry.deployableFamilies.add(normalizeFamilyName(row.family) || String(row.family || row.sku || '').trim() || 'Unknown');
      entry.deployableSubscriptions.add(String(row.subscriptionId || row.subscriptionKey || 'legacy-data'));
    }

    if (availability === 'CONSTRAINED' || availability === 'RESTRICTED') {
      entry.constrainedRows += 1;
    }
  });

  return [...byRegion.values()]
    .map((entry) => ({
      region: entry.region,
      totalRows: entry.totalRows,
      deployableRows: entry.deployableRows,
      constrainedRows: entry.constrainedRows,
      totalQuotaHeadroom: entry.totalQuotaHeadroom,
      deployableFamilyCount: entry.deployableFamilies.size,
      deployableSubscriptionCount: entry.deployableSubscriptions.size,
      providers: [],
      topConstrainedFamilies: [...(constrainedByRegion.get(entry.region) || new Map()).entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 3)
        .map(([family, count]) => `${family} (${count})`)
    }))
    .sort((left, right) => right.totalQuotaHeadroom - left.totalQuotaHeadroom || left.region.localeCompare(right.region));
}

function topCapacityAnalyticsSkuRows(rows = []) {
  const bySku = new Map();

  rows.forEach((row) => {
    const sku = normalizeSkuName(row.sku);
    if (!sku) {
      return;
    }

    const current = bySku.get(sku) || { sku, available: 0, recommendationWeight: 0, observationCount: 0 };
    current.available += Number(row.quotaLimit || 0) - Number(row.quotaCurrent || 0);
    current.recommendationWeight += (String(row.availability || '').toUpperCase() === 'CONSTRAINED')
      ? 4
      : (String(row.availability || '').toUpperCase() === 'LIMITED')
        ? 3
        : (String(row.availability || '').toUpperCase() === 'OK')
          ? 2
          : 1;
    current.observationCount += 1;
    bySku.set(sku, current);
  });

  return sortCapacityAnalyticsSkuRows([...bySku.values()]);
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

let skuFamilyCatalogCache = { fetchedAt: 0, payload: null };
const SKU_FAMILY_CATALOG_TTL_MS = Number(process.env.SKU_FAMILY_CATALOG_TTL_MS || 5 * 60 * 1000);

async function getSkuFamilyCatalog({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && skuFamilyCatalogCache.payload && (now - skuFamilyCatalogCache.fetchedAt) < SKU_FAMILY_CATALOG_TTL_MS) {
    return skuFamilyCatalogCache.payload;
  }

  const pool = await getSqlPool();
  if (!pool) {
    const families = {};
    mockRows.forEach((row) => {
      const family = String(row?.family || '').trim();
      const sku = String(row?.sku || '').trim();
      if (!family || !sku) return;
      if (!families[family]) families[family] = new Set();
      families[family].add(sku);
    });
    const payload = {
      source: 'mock',
      fetchedAt: new Date().toISOString(),
      families: Object.fromEntries(Object.entries(families).map(([key, set]) => [key, [...set].sort()]))
    };
    skuFamilyCatalogCache = { fetchedAt: now, payload };
    return payload;
  }

  // Make sure the catalog table exists even if startup warmup hasn't completed yet.
  try {
    await ensureVmSkuCatalogSchema(pool);
  } catch (err) {
    console.warn('[getSkuFamilyCatalog] ensureVmSkuCatalogSchema failed, falling back to CapacitySnapshot only:', err?.message || err);
  }

  // Trigger a non-blocking ARM seed if the catalog is currently empty. The first
  // request returns whatever is in CapacitySnapshot (typically just the
  // representative SKU per family); later requests pick up the seeded rows.
  try {
    const empty = await pool.request().query(`SELECT TOP 1 1 AS hit FROM dbo.VmSkuCatalog`);
    if (!empty.recordset || empty.recordset.length === 0) {
      const livePlacementService = require('./livePlacementService');
      if (typeof livePlacementService.seedVmSkuCatalogIfEmpty === 'function') {
        livePlacementService.seedVmSkuCatalogIfEmpty().then((result) => {
          if (result?.seeded) {
            console.log(`[VmSkuCatalog] Seeded ${result.count} rows from ARM (region=${result.region}).`);
          }
        }).catch((err) => {
          console.warn('[VmSkuCatalog] background seed failed:', err?.message || err);
        });
      }
    }
  } catch (err) {
    // Table may not exist yet — already handled above; ignore here.
  }

  const result = await pool.request().query(`
    SELECT skuFamily, skuName
    FROM dbo.VmSkuCatalog
    WHERE skuFamily IS NOT NULL AND LEN(skuFamily) > 0
      AND skuName IS NOT NULL AND LEN(skuName) > 0
    UNION
    SELECT DISTINCT skuFamily, skuName
    FROM dbo.CapacitySnapshot
    WHERE skuFamily IS NOT NULL AND LEN(skuFamily) > 0
      AND skuName IS NOT NULL AND LEN(skuName) > 0
  `);

  const families = {};
  for (const row of result.recordset) {
    const family = String(row.skuFamily || '').trim();
    const sku = String(row.skuName || '').trim();
    if (!family || !sku) continue;
    if (!families[family]) families[family] = new Set();
    families[family].add(sku);
  }
  const familyMap = {};
  Object.keys(families).sort().forEach((key) => {
    familyMap[key] = [...families[key]].sort();
  });

  const payload = {
    source: 'VmSkuCatalog+CapacitySnapshot',
    fetchedAt: new Date().toISOString(),
    families: familyMap
  };
  skuFamilyCatalogCache = { fetchedAt: now, payload };
  return payload;
}

module.exports = {
  getCapacityRows,
  getCapacityRowsPaginated,
  getCapacityAnalyticsSummary,
  getSubscriptions,
  getSubscriptionSummary,
  getCapacityTrends,
  getFamilySummary,
  deriveCapacityTrendRows,
  deriveCapacityScoreRows,
  getCapacityScoreSummary,
  getCapacityScoreSummaryPaginated,
  getSkuFamilyCatalog
};
