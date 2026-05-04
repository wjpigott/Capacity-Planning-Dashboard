const { useEffect, useMemo, useRef, useState } = React;

const REGION_PRESET_OPTIONS = [
  { value: 'USEastWest', label: 'US East/West' },
  { value: 'USCentral', label: 'US Central' },
  { value: 'USMajor', label: 'US Major (Top 5)' },
  { value: 'Europe', label: 'Europe' },
  { value: 'AsiaPacific', label: 'Asia Pacific' },
  { value: 'Global', label: 'Global' },
  { value: 'USGov', label: 'US Government' },
  { value: 'China', label: 'China' },
  { value: 'ASR-EastWest', label: 'ASR East/West' },
  { value: 'ASR-CentralUS', label: 'ASR Central US' },
  { value: 'CommercialAmericas', label: 'Commercial - Americas' },
  { value: 'CommercialEurope', label: 'Commercial - Europe' },
  { value: 'CommercialIndiaME', label: 'Commercial - India / Middle East' },
  { value: 'CommercialAPAC', label: 'Commercial - APAC' },
  { value: 'CommercialAustralia', label: 'Commercial - Australia' },
  { value: 'AzureGovernment', label: 'Azure Government' },
  { value: 'AzureChina', label: 'Azure China' }
];

const RESOURCE_TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: 'Compute', label: 'Compute' },
  { value: 'AI', label: 'AI Models' },
  { value: 'Disk', label: 'Disk' },
  { value: 'Other', label: 'Other' }
];

const PAAS_SERVICE_OPTIONS = [
  { value: 'All', label: 'All services' },
  { value: 'SqlDatabase', label: 'SQL Database' },
  { value: 'CosmosDB', label: 'Cosmos DB' },
  { value: 'PostgreSQL', label: 'PostgreSQL' },
  { value: 'MySQL', label: 'MySQL' },
  { value: 'AppService', label: 'App Service' },
  { value: 'ContainerApps', label: 'Container Apps' },
  { value: 'AKS', label: 'AKS' },
  { value: 'Functions', label: 'Functions' },
  { value: 'Storage', label: 'Storage' }
];

const REPORT_VIEWS = [
  { key: 'capacity-grid', label: 'Capacity Grid', adminOnly: false },
  { key: 'region-health', label: 'Region Health', adminOnly: false },
  { key: 'recommender', label: 'Capacity Recommender', adminOnly: false },
  { key: 'paas-availability', label: 'PaaS Availability', adminOnly: false },
  { key: 'shareable-quota-report', label: 'Shareable Quota Report', adminOnly: false },
  { key: 'sku-chart', label: 'Top SKUs', adminOnly: false },
  { key: 'capacity-score', label: 'Capacity Score', adminOnly: false },
  { key: 'family-summary', label: 'Family Summary', adminOnly: false },
  { key: 'region-matrix', label: 'Region Matrix', adminOnly: false },
  { key: 'trend', label: 'Trend History', adminOnly: false },
  { key: 'ai-summary-report', label: 'AI Summary Report', adminOnly: false },
  { key: 'ai-model-availability', label: 'AI Model Availability', adminOnly: false },
  { key: 'admin', label: 'Data Ingestion', adminOnly: true, navGroup: 'admin' },
  { key: 'quota-workbench', label: 'Quota Workbench', adminOnly: true, navGroup: 'admin' }
];

const baseRegionPresets = {
  USEastWest: ['eastus', 'eastus2', 'westus', 'westus2'],
  USCentral: ['centralus', 'northcentralus', 'southcentralus', 'westcentralus'],
  USMajor: ['eastus', 'eastus2', 'centralus', 'westus', 'westus2'],
  Europe: ['westeurope', 'northeurope', 'uksouth', 'francecentral', 'germanywestcentral'],
  AsiaPacific: ['eastasia', 'southeastasia', 'japaneast', 'australiaeast', 'koreacentral'],
  USGov: ['usgovvirginia', 'usgovtexas', 'usgovarizona'],
  China: ['chinaeast', 'chinanorth', 'chinaeast2', 'chinanorth2'],
  'ASR-EastWest': ['eastus', 'westus2'],
  'ASR-CentralUS': ['centralus', 'eastus2'],
  CommercialAmericas: ['eastus', 'eastus2', 'centralus', 'northcentralus', 'southcentralus', 'westcentralus', 'westus', 'westus2', 'westus3', 'canadacentral', 'canadaeast', 'brazilsouth'],
  CommercialEurope: ['northeurope', 'westeurope', 'uksouth', 'ukwest', 'francecentral', 'germanywestcentral', 'swedencentral', 'switzerlandnorth'],
  CommercialIndiaME: ['centralindia', 'southindia', 'westindia', 'uaenorth', 'uaecentral', 'qatarcentral', 'israelcentral'],
  CommercialAPAC: ['eastasia', 'southeastasia', 'japaneast', 'japanwest', 'koreacentral', 'koreasouth'],
  CommercialAustralia: ['australiaeast', 'australiasoutheast', 'australiacentral', 'australiacentral2'],
  AzureGovernment: ['usgovvirginia', 'usgovtexas', 'usgovarizona'],
  AzureChina: ['chinaeast', 'chinaeast2', 'chinanorth', 'chinanorth2']
};

const globalRegions = [...new Set(Object.values(baseRegionPresets)
  .flat()
  .map((region) => String(region || '').trim().toLowerCase())
  .filter(Boolean))].sort();

const regionPresets = {
  ...baseRegionPresets,
  Global: globalRegions
};

const skuCatalog = window.CAPACITY_SKU_CATALOG || null;

const FAMILY_EXTRA_SKU_MAP = {
  standardHBv3Family: skuCatalog?.getSkusForFamily('standardHBv3Family') || ['Standard_HB120rs_v3'],
  standardHBv4Family: skuCatalog?.getSkusForFamily('standardHBv4Family') || ['Standard_HB176rs_v4'],
  standardNDH100v5Family: skuCatalog?.getSkusForFamily('standardNDH100v5Family') || ['Standard_ND96isr_H100_v5'],
  standardNCasT4v3Family: skuCatalog?.getSkusForFamily('standardNCasT4v3Family') || [
    'Standard_NC4as_T4_v3',
    'Standard_NC8as_T4_v3',
    'Standard_NC16as_T4_v3',
    'Standard_NC64as_T4_v3'
  ],
  standardNCA100v4Family: skuCatalog?.getSkusForFamily('standardNCA100v4Family') || [
    'Standard_NC24ads_A100_v4',
    'Standard_NC48ads_A100_v4',
    'Standard_NC96ads_A100_v4'
  ],
  standardNCadsH100v5Family: skuCatalog?.getSkusForFamily('standardNCadsH100v5Family') || [
    'Standard_NC40ads_H100_v5',
    'Standard_NC80adis_H100_v5'
  ],
  standardNCCadsH100v5Family: skuCatalog?.getSkusForFamily('standardNCCadsH100v5Family') || ['Standard_NCC40ads_H100_v5'],
  standardDSv5Family: skuCatalog?.getSkusForFamily('standardDSv5Family') || [
    'Standard_D2s_v5',
    'Standard_D4s_v5',
    'Standard_D8s_v5',
    'Standard_D16s_v5',
    'Standard_D32s_v5',
    'Standard_D48s_v5',
    'Standard_D64s_v5',
    'Standard_D96s_v5'
  ]
};

const RECOMMENDER_FAMILY_SKU_OPTIONS = {
  standardDSv5Family: FAMILY_EXTRA_SKU_MAP.standardDSv5Family,
  standardNCasT4v3Family: FAMILY_EXTRA_SKU_MAP.standardNCasT4v3Family,
  standardNCA100v4Family: FAMILY_EXTRA_SKU_MAP.standardNCA100v4Family,
  standardNCadsH100v5Family: FAMILY_EXTRA_SKU_MAP.standardNCadsH100v5Family,
  standardNCCadsH100v5Family: FAMILY_EXTRA_SKU_MAP.standardNCCadsH100v5Family
};

function classNames() {
  return Array.from(arguments).filter(Boolean).join(' ');
}

function detectDeploymentEnvironment(hostname = window.location.hostname) {
  const value = String(hostname || '').toLowerCase();

  if (value.includes('-test-') || value.includes('test') || value.includes('demo')) {
    return { key: 'test', label: 'Test' };
  }

  if (value.includes('-dev-') || value.includes('dev')) {
    return { key: 'dev', label: 'Dev' };
  }

  if (value.includes('-prod-') || value.includes('prod')) {
    return { key: 'prod', label: 'Prod' };
  }

  return { key: 'default', label: 'React V2' };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options && options.headers ? options.headers : {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const baseReason = payload.error || `Request failed (${response.status})`;
    const detail = payload.detail && payload.detail !== payload.error ? String(payload.detail) : '';
    const detailedReason = detail ? `${baseReason} ${detail}` : baseReason;
    const reason = payload.requestId ? `${detailedReason} [Ref ${payload.requestId}]` : detailedReason;
    throw new Error(`${String(url)}: ${reason}`);
  }

  return payload;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url, options, retryCount = 1, retryDelayMs = 500) {
  let lastError;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await fetchJson(url, options);
    } catch (error) {
      lastError = error;
      if (attempt >= retryCount) {
        break;
      }
      await delay(retryDelayMs);
    }
  }

  throw lastError;
}

async function waitForQuotaApplyJob(jobId, options) {
  const timeoutMs = Number(options && options.timeoutMs) > 0 ? Number(options.timeoutMs) : 10 * 60 * 1000;
  const pollIntervalMs = Number(options && options.pollIntervalMs) > 0 ? Number(options.pollIntervalMs) : 3000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const payload = await fetchJson(`/api/quota/apply/jobs/${encodeURIComponent(jobId)}`);
    if (payload.status === 'completed') {
      return payload;
    }
    if (payload.status === 'failed') {
      throw new Error(payload.error || 'Quota apply job failed.');
    }

    await delay(pollIntervalMs);
  }

  throw new Error('Quota apply did not finish before the client polling timeout elapsed. Check operation history and retry if needed.');
}

function getFilenameFromDisposition(headerValue, fallbackName) {
  const value = String(headerValue || '');
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const plainMatch = value.match(/filename="?([^";]+)"?/i);
  if (plainMatch && plainMatch[1]) {
    return plainMatch[1];
  }

  return fallbackName;
}

function formatNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString() : 'n/a';
}

function formatPercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric}%` : 'n/a';
}

function formatMoney(value, digits = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `$${numeric.toFixed(digits)}` : 'n/a';
}

function formatTimestamp(value) {
  if (!value) return 'Never';
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? 'Never' : timestamp.toLocaleString();
}

function formatDuration(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 'n/a';
  if (numeric < 1000) return `${numeric} ms`;
  return `${(numeric / 1000).toFixed(1)} s`;
}

function formatDateValue(value) {
  if (!value) return 'n/a';
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? 'n/a' : timestamp.toLocaleDateString();
}

function minutesToHours(value, fallback = 0) {
  const numeric = Number(value);
  const minutes = Number.isFinite(numeric) ? numeric : fallback;
  return Math.round((minutes / 60) * 10) / 10;
}

function hoursToMinutes(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, Math.trunc(fallback));
  }
  return Math.max(0, Math.round(numeric * 60));
}

function collapseLivePlacementWarning(warning) {
  if (!warning || typeof warning !== 'string') return warning || null;
  const pattern = /Live placement was unavailable for SKU\(s\) ([^ ]+(?:, [^ ]+)*) in region ([^.]+)\.\s*Those rows were left as N\/A\.?/g;
  const grouped = new Map();
  const extras = [];
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(warning)) !== null) {
    if (match.index > lastIndex) {
      const chunk = warning.slice(lastIndex, match.index).trim();
      if (chunk) extras.push(chunk);
    }
    const skus = match[1];
    const region = match[2].trim();
    if (!grouped.has(skus)) grouped.set(skus, new Set());
    grouped.get(skus).add(region);
    lastIndex = pattern.lastIndex;
  }
  const tail = warning.slice(lastIndex).trim();
  if (tail) extras.push(tail);

  if (grouped.size === 0) return warning;

  const parts = [];
  for (const [skus, regions] of grouped) {
    const regionList = Array.from(regions).sort().join(', ');
    const regionLabel = regions.size === 1 ? `region ${regionList}` : `regions ${regionList}`;
    parts.push(`Live placement was unavailable for SKU(s) ${skus} in ${regionLabel}. Those rows were left as N/A.`);
  }
  if (extras.length > 0) parts.push(extras.join(' '));
  return parts.join(' ');
}

function compareSkuValues(left, right) {
  return String(left || '').localeCompare(String(right || ''), undefined, {
    sensitivity: 'base',
    numeric: true
  });
}

function normalizeSkuName(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  const normalizeSuffix = (suffix) => String(suffix || '')
    .split('_')
    .map((segment) => {
      const normalized = String(segment || '').trim().toLowerCase();
      if (!normalized) return '';
      if (/^v\d+$/.test(normalized)) return normalized;
      return normalized.replace(/^([a-z]+)/, (match) => match.toUpperCase());
    })
    .filter(Boolean)
    .join('_');

  const prefixedSku = trimmed.match(/^(standard|basic|internal)(?:[_\s-]?)(.*)$/i);
  if (prefixedSku) {
    const prefixToken = String(prefixedSku[1] || '').toLowerCase();
    const prefix = prefixToken === 'standard' ? 'Standard' : (prefixToken === 'basic' ? 'Basic' : 'Internal');
    const rawSuffix = String(prefixedSku[2] || '').replace(/^[_\s-]+/, '');
    const suffix = normalizeSuffix(rawSuffix);
    return suffix ? `${prefix}_${suffix}` : prefix;
  }

  return trimmed;
}

function formatFamilyLabel(family) {
  return String(family || '')
    .replace(/Family$/i, '')
    .replace(/^(Standard|Basic|Premium)([A-Z])/i, '$1_$2');
}

function normalizeFamilyOptionLabel(family) {
  const raw = String(family || '').trim();
  if (!raw) return '';
  return formatFamilyLabel(normalizeSkuName(raw));
}

function canonicalFamilyOptionKey(family) {
  return String(normalizeFamilyOptionLabel(family) || family || '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
}

const FAMILY_BASE_PATTERNS = [
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
  ['DV', /^(DV)/],
  ['D', /^(D)/],
  ['E', /^(E)/],
  ['L', /^(L)/],
  ['M', /^(M)/],
  ['B', /^(B|BS|BAS|BPS)/],
  ['A', /^(A|BASICA)/]
];

function extractFamilyBase(family) {
  const normalized = String(normalizeFamilyOptionLabel(family) || family || '')
    .replace(/^(Standard|Basic|Premium)_?/i, '')
    .replace(/Family$/i, '')
    .replace(/[\s_-]/g, '')
    .toUpperCase();
  if (!normalized) return '';
  for (const [label, pattern] of FAMILY_BASE_PATTERNS) {
    if (pattern.test(normalized)) return label;
  }
  const fallback = normalized.match(/^[A-Z]{1,3}/);
  return fallback ? fallback[0] : '';
}

function buildFamilyOptions(values) {
  const byCanonicalValue = new Map();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const rawValue = String(value || '').trim();
    if (!rawValue) return;

    const key = canonicalFamilyOptionKey(rawValue);
    if (!key || byCanonicalValue.has(key)) return;

    byCanonicalValue.set(key, {
      value: rawValue,
      label: normalizeFamilyOptionLabel(rawValue)
    });
  });

  return [...byCanonicalValue.values()].sort((left, right) => compareSkuValues(left.label, right.label));
}

function buildFamilyBaseOptions(values) {
  const options = new Map();
  buildFamilyOptions(values).forEach(({ value }) => {
    const base = extractFamilyBase(value);
    if (!base || options.has(base)) return;
    options.set(base, { value: base, label: base });
  });
  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function isDisplayableRegion(region) {
  const value = String(region || '').trim().toLowerCase();
  if (!value) return false;
  // Exclude non-geographic placeholder regions that aren't valid for live placement or capacity scoring.
  const EXCLUDED = new Set(['global', 'all', 'unknown', 'n/a', 'none', 'worldwide']);
  return !EXCLUDED.has(value);
}

function isDisplayableFamily(family) {
  const value = String(family || '').trim();
  if (!value) return false;
  const lower = value.toLowerCase();
  if (['global', 'all', 'unknown', 'n/a', 'none'].includes(lower)) return false;
  if (/-aggregate$|family-aggregate/i.test(value)) return false;
  return true;
}

function normalizeFamilyLabel(rawFamily, skuName) {
  const value = String(rawFamily || skuName || '').trim();
  if (!value) return '';
  const match = String(skuName || '').match(/^Standard_([A-Za-z]+)/i);
  if (/^(STANDARD|BASIC)[A-Z0-9]+FAMILY$/i.test(value)) {
    return value.replace(/family$/i, '').replace(/^standard/i, 'Standard_').replace(/^basic/i, 'Basic_').replace(/_+/, '_');
  }
  if (match && match[1]) {
    return match[1].toUpperCase();
  }
  return formatFamilyLabel(value);
}

function getRowResourceType(row) {
  const sourceType = String((row && row.sourceType) || '').toLowerCase();
  const family = String((row && row.family) || '').toLowerCase();
  const sku = String((row && row.sku) || '').toLowerCase();
  if (sourceType.includes('azure-ai') || sourceType.includes('openai') || family.startsWith('openai') || family.startsWith('aiservices') || sku.startsWith('aiservices')) return 'AI';
  if (family.includes('disk') || sku.includes('disk') || sku.includes('snapshot')) return 'Disk';
  if (family.endsWith('family') || /^standard_/.test(String((row && row.sku) || ''))) return 'Compute';
  return 'Other';
}

function getAIModelProviderLabel(row) {
  const provider = String((row && (row.provider || row.modelFormat)) || '').trim();
  return provider || 'Unknown';
}

function titleCaseProviderSlug(value) {
  return String(value || '')
    .split('-')
    .map((segment) => String(segment || '').trim())
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function getAIQuotaProviderLabel(row) {
  const provider = String((row && row.provider) || '').trim();
  if (provider) return provider;
  const sourceType = String((row && row.sourceType) || '').trim();
  const family = String((row && row.family) || '').trim();
  if (/^live-azure-openai-ingest$/i.test(sourceType) || /^openai/i.test(family)) {
    return 'OpenAI';
  }
  const match = sourceType.match(/^live-azure-ai-(.+)-ingest$/i);
  return match ? (titleCaseProviderSlug(match[1]) || 'Unknown') : 'Unknown';
}

function getAIQuotaProviderDisplay(row) {
  if (getRowResourceType(row) !== 'AI') return '—';
  const provider = getAIQuotaProviderLabel(row);
  return provider === 'Unknown' ? 'Not tagged' : provider;
}

function rowMatchesAIQuotaProvider(row, provider) {
  return !provider || provider === 'all' || (getRowResourceType(row) === 'AI' && getAIQuotaProviderLabel(row) === provider);
}

function isBlockedAvailability(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'CONSTRAINED' || normalized === 'RESTRICTED';
}

function rowMatchesResourceType(row, resourceType) {
  return !resourceType || resourceType === 'all' || getRowResourceType(row) === resourceType;
}

function recommendationAvailabilityWeight(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'CONSTRAINED') return 4;
  if (normalized === 'LIMITED') return 3;
  if (normalized === 'OK') return 2;
  return 1;
}

function isAggregateSkuName(value) {
  return /(?:^|[_-])aggregate$/i.test(String(value || '').trim()) || /family-aggregate$/i.test(String(value || '').trim());
}

function getRecommenderFamilySkuOptions(familyValue) {
  const familyKey = String(familyValue || '').trim();
  const catalogSkus = skuCatalog?.getSkusForFamily(familyKey);
  if (Array.isArray(catalogSkus) && catalogSkus.length > 0) {
    return [...new Set(catalogSkus
      .map((sku) => normalizeSkuName(sku))
      .filter((sku) => sku && !isAggregateSkuName(sku)))].sort((left, right) => compareSkuValues(left, right));
  }
  const preferred = RECOMMENDER_FAMILY_SKU_OPTIONS[familyKey];
  if (Array.isArray(preferred) && preferred.length > 0) {
    return [...new Set(preferred
      .map((sku) => normalizeSkuName(sku))
      .filter((sku) => sku && !isAggregateSkuName(sku)))].sort((left, right) => compareSkuValues(left, right));
  }
  const mapped = FAMILY_EXTRA_SKU_MAP[familyKey];
  if (!Array.isArray(mapped)) {
    return [];
  }

  return [...new Set(mapped
    .map((sku) => normalizeSkuName(sku))
    .filter((sku) => sku && !isAggregateSkuName(sku)))].sort((left, right) => compareSkuValues(left, right));
}

function defaultRecommendTargetSkuFromRows(rows, preferredSkus = []) {
  const preferred = (Array.isArray(preferredSkus) ? preferredSkus : [])
    .map((sku) => normalizeSkuName(sku))
    .filter((sku) => sku && !isAggregateSkuName(sku));
  if (preferred.length > 0) {
    return preferred[0];
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return '';
  }

  const bySku = new Map();
  rows.forEach((row) => {
    const sku = normalizeSkuName(row && row.sku);
    if (!sku || isAggregateSkuName(sku)) {
      return;
    }

    const current = bySku.get(sku) || { weight: 0, count: 0 };
    current.weight += recommendationAvailabilityWeight(row && row.availability);
    current.count += 1;
    bySku.set(sku, current);
  });

  const ordered = [...bySku.entries()].sort((left, right) => {
    if (right[1].weight !== left[1].weight) {
      return right[1].weight - left[1].weight;
    }
    if (right[1].count !== left[1].count) {
      return right[1].count - left[1].count;
    }
    return compareSkuValues(left[0], right[0]);
  });

  return ordered[0] ? ordered[0][0] : '';
}

function defaultRecommendRegionsFromFilters(filters, capacityFacetRegions, rows) {
  const currentRegion = String((filters && filters.region) || '').trim().toLowerCase();
  if (currentRegion && currentRegion !== 'all') {
    return currentRegion;
  }

  const presetRegions = regionPresets[(filters && filters.regionPreset) || ''];
  if (Array.isArray(presetRegions) && presetRegions.length > 0) {
    return presetRegions.join(',');
  }

  if (Array.isArray(capacityFacetRegions) && capacityFacetRegions.length > 0) {
    return capacityFacetRegions.join(',');
  }

  const scopedRegions = [...new Set((rows || [])
    .map((row) => String((row && row.region) || '').trim().toLowerCase())
    .filter(Boolean))];
  if (scopedRegions.length > 0) {
    return scopedRegions.join(',');
  }

  return '';
}

function matrixStatusMeta(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'OK') {
    return { short: '✓ OK', description: 'Ready to deploy. No restrictions.' };
  }
  if (value === 'CONSTRAINED') {
    return { short: '⚠ CONSTRAINED', description: 'Azure is low on hardware. Try a different zone or wait.' };
  }
  if (value === 'LIMITED') {
    return { short: '⚠ LIMITED', description: "Your subscription can't use this. Request access via support ticket." };
  }
  if (value === 'PARTIAL') {
    return { short: '⚡ PARTIAL', description: 'Some zones work, others are blocked. No zone redundancy.' };
  }
  return { short: '✗ BLOCKED', description: 'Cannot deploy. Pick a different region or SKU.' };
}

function formatCapacityScoreLabel(value) {
  return String(value || '').toUpperCase() === 'HIGH' ? 'Snapshot OK' : (value || 'n/a');
}

function getCapacityScoreDisplayMeta(row) {
  const liveScore = String(row?.livePlacementScore || '').trim();
  const normalizedLiveScore = liveScore.toUpperCase();

  if (row?.livePlacementRestricted || normalizedLiveScore.includes('RESTRICTED')) {
    return {
      value: 'Restricted',
      label: 'Live Restricted'
    };
  }

  if (normalizedLiveScore.includes('NOTAVAILABLE') || normalizedLiveScore.includes('UNAVAILABLE')) {
    return {
      value: 'Unavailable',
      label: 'Live Unavailable'
    };
  }

  return {
    value: row?.score,
    label: formatCapacityScoreLabel(row?.score)
  };
}

function capacityScoreLegendItems() {
  return [
    {
      value: 'High',
      title: 'Snapshot OK',
      description: 'Strong derived snapshot posture from the saved OK, Limited, Constrained, and quota observations. If the latest live Azure result is restricted or unavailable, that live state takes precedence in the table.'
    },
    {
      value: 'Medium',
      title: 'Medium',
      description: 'Mixed signal. Some headroom exists, but the saved capacity observations show caution.'
    },
    {
      value: 'Low',
      title: 'Low',
      description: 'Weak derived capacity posture. Expect constraints, low quota headroom, or both.'
    }
  ];
}

function livePlacementLegendItems() {
  return [
    {
      value: 'High',
      title: 'High',
      description: 'Azure returned a strong live placement score for this SKU and region.'
    },
    {
      value: 'Medium',
      title: 'Medium',
      description: 'Azure returned a usable but not ideal live placement score.'
    },
    {
      value: 'Low',
      title: 'Low',
      description: 'Azure returned a weak live placement score. Placement may still fail.'
    },
    {
      value: 'Restricted',
      title: 'Restricted',
      description: 'Azure explicitly returned a restricted result for this SKU and region.'
    },
    {
      value: 'Unavailable',
      title: 'Unavailable',
      description: 'Azure explicitly said the SKU is not available for placement in that region.'
    },
    {
      value: 'Unknown',
      title: 'Unknown',
      description: 'The live lookup did not return a usable answer. This is not the same as unavailable.'
    }
  ];
}

function regionMatrixRows(rows, selectedRegion, presetRegions) {
  const scopedRows = (rows || []).filter((row) => rowMatchesResourceType(row, 'Compute'));
  const regions = selectedRegion && selectedRegion !== 'all'
    ? [selectedRegion]
    : (() => {
      const normalizedPresetRegions = (Array.isArray(presetRegions) ? presetRegions : [])
        .map((region) => String(region || '').trim().toLowerCase())
        .filter(Boolean);

      if (normalizedPresetRegions.length > 0) {
        return [...new Set(normalizedPresetRegions)].sort();
      }

      return [...new Set(scopedRows.map((row) => String(row.region || '').trim().toLowerCase()).filter(Boolean))].sort();
    })();
  const familyMap = new Map();

  scopedRows.forEach((row) => {
    const family = normalizeFamilyLabel(row.family, row.sku) || '?';
    const region = String(row.region || '').trim().toLowerCase();
    if (!family || !region) return;
    if (!familyMap.has(family)) familyMap.set(family, {});
    if (!familyMap.get(family)[region]) {
      familyMap.get(family)[region] = { statuses: new Set(), skus: new Set() };
    }
    const cell = familyMap.get(family)[region];
    const incoming = String(row.availability || '').trim().toUpperCase();
    if (incoming) {
      cell.statuses.add(incoming);
    }
    const sku = normalizeSkuName(row.sku);
    if (sku) {
      cell.skus.add(sku);
    }
  });

  function normalizeMatrixStatus(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (!normalized) return 'BLOCKED';
    if (normalized === 'OK') return 'OK';
    if (normalized === 'LIMITED') return 'LIMITED';
    if (normalized === 'CONSTRAINED' || normalized === 'RESTRICTED') return 'CONSTRAINED';
    if (normalized === 'BLOCKED' || normalized === 'UNAVAILABLE') return 'BLOCKED';
    return 'BLOCKED';
  }

  function resolveCellStatus(cell) {
    if (!cell) {
      return 'BLOCKED';
    }

    const statuses = [...cell.statuses].map(normalizeMatrixStatus);
    const hasOk = statuses.includes('OK');
    const hasLimited = statuses.includes('LIMITED');
    const hasConstrained = statuses.includes('CONSTRAINED');
    const hasBlocked = statuses.includes('BLOCKED');

    if (hasOk && (hasLimited || hasConstrained || hasBlocked)) return 'PARTIAL';
    if (hasOk) return 'OK';
    if (hasLimited) return 'LIMITED';
    if (hasConstrained) return 'CONSTRAINED';
    return 'BLOCKED';
  }

  function resolveRowStatus(regionMap) {
    const statuses = Object.values(regionMap || {}).map((cell) => resolveCellStatus(cell));
    if (statuses.includes('OK')) return 'OK';
    if (statuses.includes('PARTIAL') || statuses.includes('LIMITED') || statuses.includes('CONSTRAINED')) return 'CAUTION';
    return 'BLOCKED';
  }

  return {
    regions,
    rows: [...familyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([family, regionMap]) => ({
      family,
      regionMap,
      rowStatus: resolveRowStatus(regionMap),
      readyRegionCount: Object.values(regionMap || {}).filter((cell) => {
        const status = resolveCellStatus(cell);
        return status === 'OK' || status === 'PARTIAL';
      }).length
    })),
    resolveCellStatus
  };
}

function filterPaaSRowsByScope(rows, regionPreset, selectedRegion) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const normalizedSelectedRegion = String(selectedRegion || '').trim().toLowerCase();
  if (normalizedSelectedRegion && normalizedSelectedRegion !== 'all') {
    return normalizedRows.filter((row) => String((row && row.region) || '').trim().toLowerCase() === normalizedSelectedRegion);
  }

  const presetRegions = Array.isArray(regionPresets[regionPreset])
    ? regionPresets[regionPreset].map((region) => String(region || '').trim().toLowerCase()).filter(Boolean)
    : [];
  if (presetRegions.length === 0) {
    return normalizedRows;
  }

  const allowedRegions = new Set(presetRegions);
  return normalizedRows.filter((row) => allowedRegions.has(String((row && row.region) || '').trim().toLowerCase()));
}

function summarizePaaSRows(rows) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const serviceSummaryMap = new Map();

  normalizedRows.forEach((row) => {
    const service = row && row.service ? row.service : 'Unknown';
    if (!serviceSummaryMap.has(service)) {
      serviceSummaryMap.set(service, { service, rowCount: 0, availableCount: 0 });
    }

    const summary = serviceSummaryMap.get(service);
    summary.rowCount += 1;
    if (row && row.available) {
      summary.availableCount += 1;
    }
  });

  return {
    rowCount: normalizedRows.length,
    serviceSummary: Array.from(serviceSummaryMap.values()).sort((left, right) => left.service.localeCompare(right.service)),
    facets: {
      services: [...new Set(normalizedRows.map((row) => String((row && row.service) || '').trim()).filter(Boolean))].sort(),
      regions: [...new Set(normalizedRows.map((row) => String((row && row.region) || '').trim().toLowerCase()).filter(Boolean))].sort(),
      categories: [...new Set(normalizedRows.map((row) => String((row && row.category) || '').trim()).filter(Boolean))].sort()
    }
  };
}

const PAAS_SERVICE_MATRIX_LABELS = {
  SqlDatabase: 'SQL',
  CosmosDB: 'Cosmos',
  PostgreSQL: 'PgSQL',
  MySQL: 'MySQL',
  AppService: 'AppSvc',
  ContainerApps: 'ContApp',
  AKS: 'AKS',
  Functions: 'Funcs',
  Storage: 'Storage',
  ServiceBus: 'SvcBus',
  EventHubs: 'EvtHub',
  NotificationHubs: 'NotifHub',
  StaticWebApps: 'StaticWeb',
  LogAnalytics: 'LogAn',
  KeyVault: 'KeyVault',
  Redis: 'Redis',
  ACR: 'ACR',
  AISearch: 'AISearch',
  APIM: 'APIM',
  AppConfig: 'AppConfig',
  FrontDoor: 'FrontDoor',
  Grafana: 'Grafana',
  IoTHub: 'IoTHub',
  SignalR: 'SignalR'
};

function formatPaaSMatrixServiceLabel(service) {
  const value = String(service || '').trim();
  return PAAS_SERVICE_MATRIX_LABELS[value] || value || 'Unknown';
}

function normalizePaaSMatrixStatus(row) {
  const rawStatus = String((row && row.status) || '').trim().toUpperCase();
  if (row && row.available === true) {
    return 'OK';
  }
  if (rawStatus === 'LIMITED') {
    return 'LIMITED';
  }
  if (rawStatus === 'CONSTRAINED' || rawStatus === 'RESTRICTED') {
    return 'CONSTRAINED';
  }
  if (rawStatus === 'AVAILABLE' || rawStatus === 'DEFAULT') {
    return 'OK';
  }
  return 'BLOCKED';
}

function buildPaaSRegionMatrix(rows) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const regionMap = new Map();
  const serviceSet = new Set();

  normalizedRows.forEach((row) => {
    const region = String((row && row.region) || '').trim().toLowerCase();
    const service = String((row && row.service) || '').trim();
    if (!region || !service) {
      return;
    }

    serviceSet.add(service);
    if (!regionMap.has(region)) {
      regionMap.set(region, {});
    }

    const currentRegion = regionMap.get(region);
    if (!currentRegion[service]) {
      currentRegion[service] = {
        totalRows: 0,
        availableCount: 0,
        statuses: new Set()
      };
    }

    const cell = currentRegion[service];
    cell.totalRows += 1;
    if (row && row.available) {
      cell.availableCount += 1;
    }
    cell.statuses.add(normalizePaaSMatrixStatus(row));
  });

  const services = [...serviceSet].sort((left, right) => formatPaaSMatrixServiceLabel(left).localeCompare(formatPaaSMatrixServiceLabel(right)));

  function resolveCellStatus(cell) {
    if (!cell) {
      return 'EMPTY';
    }

    const statuses = [...cell.statuses];
    const hasOk = statuses.includes('OK');
    const hasLimited = statuses.includes('LIMITED');
    const hasConstrained = statuses.includes('CONSTRAINED');
    const hasBlocked = statuses.includes('BLOCKED');

    if (hasOk && (hasLimited || hasConstrained || hasBlocked)) return 'PARTIAL';
    if (hasOk) return 'OK';
    if (hasLimited) return 'LIMITED';
    if (hasConstrained) return 'CONSTRAINED';
    return 'BLOCKED';
  }

  function resolveRowStatus(serviceMap) {
    const statuses = services.map((service) => resolveCellStatus(serviceMap[service])).filter((status) => status !== 'EMPTY');
    if (statuses.includes('OK')) return 'OK';
    if (statuses.includes('PARTIAL') || statuses.includes('LIMITED') || statuses.includes('CONSTRAINED')) return 'CAUTION';
    return 'BLOCKED';
  }

  return {
    services,
    rows: [...regionMap.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([region, serviceMap]) => ({
      region,
      serviceMap,
      rowStatus: resolveRowStatus(serviceMap),
      readyServiceCount: services.filter((service) => {
        const status = resolveCellStatus(serviceMap[service]);
        return status === 'OK' || status === 'PARTIAL';
      }).length
    })),
    resolveCellStatus
  };
}

function transposePaaSRegionMatrix(matrix) {
  const source = matrix || { services: [], rows: [], resolveCellStatus: () => 'EMPTY' };
  const regions = Array.isArray(source.rows)
    ? source.rows.map((row) => row.region).filter(Boolean)
    : [];
  const services = Array.isArray(source.services) ? source.services : [];
  const resolveCellStatus = typeof source.resolveCellStatus === 'function'
    ? source.resolveCellStatus
    : (() => 'EMPTY');

  return {
    regions,
    rows: services.map((service) => {
      const regionMap = {};
      let readyRegionCount = 0;
      let rowStatus = 'BLOCKED';

      (source.rows || []).forEach((row) => {
        const cell = row && row.serviceMap ? row.serviceMap[service] : null;
        regionMap[row.region] = cell;
        const status = resolveCellStatus(cell);
        if (status === 'OK' || status === 'PARTIAL') {
          readyRegionCount += 1;
          rowStatus = 'OK';
        } else if (rowStatus !== 'OK' && (status === 'LIMITED' || status === 'CONSTRAINED')) {
          rowStatus = 'CAUTION';
        }
      });

      return {
        service,
        regionMap,
        rowStatus,
        readyRegionCount
      };
    }),
    resolveCellStatus
  };
}

function deriveRegionHealth(rows) {
  const byRegion = new Map();
  (rows || []).forEach((row) => {
    const region = String(row.region || '').trim();
    if (!region) return;
    if (!byRegion.has(region)) {
      byRegion.set(region, {
        totalRows: 0,
        deployableRows: 0,
        constrainedRows: 0,
        totalQuotaHeadroom: 0,
        deployableFamilies: new Set(),
        deployableSubscriptions: new Set(),
        constrainedFamilyCounts: new Map(),
        providers: new Set()
      });
    }
    const entry = byRegion.get(region);
    const availability = String(row.availability || '').toUpperCase();
    const family = formatFamilyLabel(row.family) || String(row.family || row.sku || '').trim() || 'Unknown';
    const subscriptionId = String(row.subscriptionId || row.subscriptionKey || '').trim();
    const provider = getAIQuotaProviderLabel(row);
    entry.totalRows += 1;
    entry.totalQuotaHeadroom += Number(row.quotaLimit || 0) - Number(row.quotaCurrent || 0);
    if (provider && provider !== 'Unknown') {
      entry.providers.add(provider);
    }
    if (availability === 'OK' || availability === 'LIMITED') {
      entry.deployableRows += 1;
      entry.deployableFamilies.add(family);
      if (subscriptionId) entry.deployableSubscriptions.add(subscriptionId);
    }
    if (availability === 'CONSTRAINED' || availability === 'RESTRICTED') {
      entry.constrainedRows += 1;
      entry.constrainedFamilyCounts.set(family, (entry.constrainedFamilyCounts.get(family) || 0) + 1);
    }
  });
  return [...byRegion.entries()].map(([region, entry]) => ({
    region,
    totalRows: entry.totalRows,
    deployableRows: entry.deployableRows,
    constrainedRows: entry.constrainedRows,
    totalQuotaHeadroom: entry.totalQuotaHeadroom,
    deployableFamilyCount: entry.deployableFamilies.size,
    deployableSubscriptionCount: entry.deployableSubscriptions.size,
    providers: [...entry.providers].sort((left, right) => left.localeCompare(right)),
    topConstrainedFamilies: [...entry.constrainedFamilyCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([family, count]) => `${family} (${count})`)
  })).sort((a, b) => b.totalQuotaHeadroom - a.totalQuotaHeadroom || a.region.localeCompare(b.region));
}

function topSkuRows(rows) {
  const bySku = new Map();
  (rows || []).forEach((row) => {
    const sku = normalizeSkuName(row.sku);
    if (!sku) return;
    const available = Number(row.quotaLimit || 0) - Number(row.quotaCurrent || 0);
    bySku.set(sku, (bySku.get(sku) || 0) + available);
  });
  return [...bySku.entries()].map(([sku, available]) => ({ sku, available }))
    .sort((a, b) => b.available - a.available)
    .slice(0, 20);
}

function familySummaryFromRows(rows) {
  const byFamily = new Map();
  (rows || []).forEach((row) => {
    const family = normalizeFamilyLabel(row.family, row.sku);
    if (!family) return;
    if (!byFamily.has(family)) {
      byFamily.set(family, { family, skus: new Set(), ok: 0, quota: 0, maxVcpu: 0, maxMemoryGB: 0, hasLimited: false, hasConstrained: false, zones: new Set() });
    }
    const entry = byFamily.get(family);
    entry.skus.add(normalizeSkuName(row.sku));
    if (row.availability === 'OK') entry.ok += 1;
    entry.quota = Math.max(entry.quota, Number(row.quotaLimit || 0));
    entry.maxVcpu = Math.max(entry.maxVcpu, Number(row.vCpu || 0));
    entry.maxMemoryGB = Math.max(entry.maxMemoryGB, Number(row.memoryGB || 0));
    entry.hasLimited = entry.hasLimited || row.availability === 'LIMITED';
    entry.hasConstrained = entry.hasConstrained || isBlockedAvailability(row.availability);
    String(row.zonesCsv || '').split(',').map((v) => v.trim()).filter(Boolean).forEach((zone) => entry.zones.add(zone));
  });
  return [...byFamily.values()].map((entry) => ({
    family: entry.family,
    skus: entry.skus.size,
    ok: entry.ok,
    largest: entry.maxVcpu > 0 || entry.maxMemoryGB > 0 ? `${entry.maxVcpu}vCPU/${entry.maxMemoryGB}GB` : 'n/a',
    zones: entry.zones.size > 0 ? [...entry.zones].sort().join(', ') : 'No zone data',
    status: entry.hasConstrained ? 'CONSTRAINED' : (entry.hasLimited ? 'LIMITED' : 'OK'),
    quota: entry.quota
  })).sort((a, b) => String(a.family).localeCompare(String(b.family)));
}

function StatusPill({ value, label }) {
  return <span className={classNames('rx-pill', `rx-pill--${String(value || 'default').toLowerCase()}`)}>{label || value || 'n/a'}</span>;
}

function Banner({ tone, message, detail, className }) {
  if (!message) return null;
  return (
    <div className={classNames('rx-banner', `rx-banner--${tone || 'info'}`, className)}>
      <div className="rx-banner__message">{message}</div>
      {detail ? <div className="rx-banner__detail">{detail}</div> : null}
    </div>
  );
}

async function logErrorToDatabase(errorEntry = {}) {
  try {
    const payload = {
      source: errorEntry.source || 'unknown',
      type: errorEntry.type || 'UnknownError',
      message: errorEntry.message || 'No error message',
      stack: errorEntry.stack || null,
      severity: errorEntry.severity || 'error',
      context: errorEntry.context || null,
      region: errorEntry.region || null,
      sku: errorEntry.sku || null,
      desiredCount: errorEntry.desiredCount || null
    };

    const response = await fetch('/api/admin/errors/log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.warn('Failed to log error to database:', response.status);
    }
  } catch (logErr) {
    console.warn('Error logging exception:', logErr.message);
  }
}

function getQuotaRecipientNeed(row) {
  const quotaAvailable = Number(row?.quotaAvailable || 0);
  const safetyBuffer = Number(row?.safetyBuffer || 0);
  const shortfall = Math.max(0, safetyBuffer - quotaAvailable);

  if (shortfall > 0) {
    return shortfall;
  }

  if ((isBlockedAvailability(row?.availability) || isBlockedAvailability(row?.availabilityState) || row?.availability === 'LIMITED' || row?.availabilityState === 'LIMITED') && quotaAvailable <= 0) {
    return Math.max(1, Math.min(5, safetyBuffer || 1));
  }

  return 0;
}

function isDisplayableSku(sku) {
  const value = String(sku || '').trim();
  if (!value) return false;
  if (/-aggregate$|family-aggregate/i.test(value)) return false;
  if (!/^(Standard|Basic|Premium)_/i.test(value)) return false;
  return true;
}

function normalizeSkuList(value) {
  const raw = Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  return raw.filter(isDisplayableSku);
}

function normalizeDesiredPlacementCount(value) {
  const numeric = Number(value || 1);
  return Math.max(1, Math.min(Number.isFinite(numeric) ? numeric : 1, 1000));
}

function getFamilyExtraSkus(familyValue) {
  return getRecommenderFamilySkuOptions(familyValue);
}

function buildCapacityScoreSnapshotMessage(scoreRows, desiredCount) {
  const latestSnapshot = (Array.isArray(scoreRows) ? scoreRows : [])
    .map((row) => row?.liveCheckedAtUtc)
    .filter(Boolean)
    .sort((left, right) => new Date(right) - new Date(left))[0];

  if (!latestSnapshot) {
    return `No saved live placement snapshot found in SQL for desired count ${desiredCount}. Press Refresh Live Placement to calculate it.`;
  }

  return `Showing saved live placement snapshot for desired count ${desiredCount}, last checked ${formatTimestamp(latestSnapshot)}. Press Refresh Live Placement to update it.`;
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function formatNullableNumber(value) {
  return value == null || value === '' ? 'n/a' : formatNumber(value);
}

function formatPaaSMetric(row) {
  const primary = row.metricPrimary == null || row.metricPrimary === '' ? '' : String(row.metricPrimary);
  const secondary = row.metricSecondary == null || row.metricSecondary === '' ? '' : String(row.metricSecondary);
  if (primary && secondary) return `${primary} / ${secondary}`;
  return primary || secondary || 'n/a';
}

function getPaaSSubscriptionScope(metadata) {
  const diagnostics = metadata && typeof metadata === 'object' ? metadata.executionDiagnostics : null;
  const subscriptionId = String((diagnostics && diagnostics.currentSubscriptionId) || (metadata && metadata.currentSubscriptionId) || '').trim();
  const subscriptionName = String((diagnostics && diagnostics.currentSubscriptionName) || (metadata && metadata.currentSubscriptionName) || '').trim();

  if (subscriptionName && subscriptionId) return `${subscriptionName} (${subscriptionId})`;
  if (subscriptionId) return subscriptionId;
  if (subscriptionName) return subscriptionName;
  return 'not recorded';
}

function compareSortValues(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1;
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return 0;
    if (Number.isNaN(a)) return 1;
    if (Number.isNaN(b)) return -1;
    return a - b;
  }
  const aNum = typeof a === 'number' ? a : Number(a);
  const bNum = typeof b === 'number' ? b : Number(b);
  if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && a !== '' && b !== '' && typeof a !== 'boolean' && typeof b !== 'boolean') {
    return aNum - bNum;
  }
  const aDate = Date.parse(a);
  const bDate = Date.parse(b);
  if (!Number.isNaN(aDate) && !Number.isNaN(bDate)
      && typeof a === 'string' && typeof b === 'string'
      && /\d{4}-\d{2}-\d{2}/.test(a) && /\d{4}-\d{2}-\d{2}/.test(b)) {
    return aDate - bDate;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function resolveSortValue(row, column) {
  if (!column) return null;
  if (typeof column.sortValue === 'function') {
    return column.sortValue(row);
  }
  const value = row[column.key];
  return value == null ? null : value;
}

function getStatusSortValue(value, count = 0) {
  const normalized = String(value || '').trim().toUpperCase();
  const rank = {
    OK: 5,
    PARTIAL: 4,
    LIMITED: 3,
    CAUTION: 3,
    CONSTRAINED: 2,
    BLOCKED: 1,
    EMPTY: 0
  }[normalized] ?? 0;
  return (rank * 1000) + Math.max(0, Number(count) || 0);
}

function DataTable({ title, subtitle, columns, rows, emptyMessage, tableClassName, sectionClassName, pageSize = 0 }) {
  const [sort, setSort] = useState({ key: null, direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);

  const sortableColumns = columns || [];
  const normalizedPageSize = Number(pageSize) > 0 ? Number(pageSize) : 0;

  const handleSort = (column) => {
    if (column.sortable === false) return;
    setSort((current) => {
      if (current.key === column.key) {
        return { key: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key: column.key, direction: 'asc' };
    });
  };

  const sortedRows = useMemo(() => {
    if (!sort.key) return rows;
    const column = sortableColumns.find((c) => c.key === sort.key);
    if (!column) return rows;
    const copy = Array.isArray(rows) ? [...rows] : [];
    copy.sort((rowA, rowB) => {
      const result = compareSortValues(resolveSortValue(rowA, column), resolveSortValue(rowB, column));
      return sort.direction === 'desc' ? -result : result;
    });
    return copy;
  }, [rows, sort.key, sort.direction, sortableColumns]);

  const pageCount = useMemo(() => {
    if (!normalizedPageSize) return 1;
    return Math.max(1, Math.ceil((Array.isArray(sortedRows) ? sortedRows.length : 0) / normalizedPageSize));
  }, [sortedRows, normalizedPageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [rows, normalizedPageSize]);

  useEffect(() => {
    if (currentPage > pageCount) {
      setCurrentPage(pageCount);
    }
  }, [currentPage, pageCount]);

  const pagedRows = useMemo(() => {
    if (!normalizedPageSize) {
      return Array.isArray(sortedRows) ? sortedRows : [];
    }

    const startIndex = (currentPage - 1) * normalizedPageSize;
    return (Array.isArray(sortedRows) ? sortedRows : []).slice(startIndex, startIndex + normalizedPageSize);
  }, [sortedRows, currentPage, normalizedPageSize]);

  const pageStart = normalizedPageSize && sortedRows.length > 0 ? ((currentPage - 1) * normalizedPageSize) + 1 : (sortedRows.length > 0 ? 1 : 0);
  const pageEnd = normalizedPageSize ? Math.min(currentPage * normalizedPageSize, sortedRows.length) : sortedRows.length;

  return (
    <section className={classNames('rx-panel', 'rx-panel--table', sectionClassName)}>
      <div className="rx-panel__header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      <div className="rx-table-wrap">
        <table className={classNames('rx-table', tableClassName)}>
          <thead>
            <tr>{columns.map((column) => {
              const isSortable = column.sortable !== false;
              const isActive = sort.key === column.key;
              const indicator = isActive ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : '';
              return (
                <th
                  key={column.key}
                  className={classNames(column.headerClassName, isSortable ? 'rx-th--sortable' : null, isActive ? 'rx-th--sorted' : null)}
                  onClick={isSortable ? () => handleSort(column) : undefined}
                  role={isSortable ? 'button' : undefined}
                  aria-sort={isActive ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                  title={isSortable ? 'Click to sort' : undefined}
                >{column.label}{indicator}</th>
              );
            })}</tr>
          </thead>
          <tbody>
            {pagedRows.length === 0 ? (
              <tr><td className="rx-empty" colSpan={columns.length}>{emptyMessage}</td></tr>
            ) : pagedRows.map((row, index) => (
              <tr key={[
                row.id,
                row.analysisRunId,
                row.groupQuotaName,
                row.subscriptionId,
                row.region,
                row.family,
                row.quotaName,
                row.sku,
                row.subscriptionName,
                currentPage,
                index
              ].filter((value) => value !== undefined && value !== null && value !== '').join('|')}>
                {columns.map((column) => <td key={column.key} className={column.cellClassName}>{column.render ? column.render(row) : (row[column.key] == null ? 'n/a' : row[column.key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {normalizedPageSize && sortedRows.length > 0 ? <div className="rx-table-footer"><span className="rx-selected-count">Showing {formatNumber(pageStart)}-{formatNumber(pageEnd)} of {formatNumber(sortedRows.length)}</span><div className="rx-pagination"><button className="rx-button rx-button--secondary" type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>Previous</button><span className="rx-selected-count">Page {formatNumber(currentPage)} of {formatNumber(pageCount)}</span><button className="rx-button rx-button--secondary" type="button" disabled={currentPage >= pageCount} onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}>Next</button></div></div> : null}
    </section>
  );
}

function SortableMatrixTable({
  title,
  subtitle,
  primaryColumn,
  statusColumn,
  readyColumn,
  dynamicColumns,
  rows,
  emptyMessage,
  rowKey,
  getRowClassName,
  renderDynamicCell,
  getDynamicSortValue,
  tableClassName
}) {
  const [sort, setSort] = useState({ key: primaryColumn.key, direction: 'asc' });

  const columns = [
    primaryColumn,
    statusColumn,
    readyColumn,
    ...(Array.isArray(dynamicColumns) ? dynamicColumns.map((column) => ({ ...column, sortKey: `dynamic:${column.key}` })) : [])
  ];

  const handleSort = (column) => {
    setSort((current) => {
      const targetKey = column.sortKey || column.key;
      if (current.key === targetKey) {
        return { key: targetKey, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key: targetKey, direction: 'asc' };
    });
  };

  const sortedRows = useMemo(() => {
    const copy = Array.isArray(rows) ? [...rows] : [];
    const activeColumn = columns.find((column) => (column.sortKey || column.key) === sort.key);
    if (!activeColumn) {
      return copy;
    }

    copy.sort((left, right) => {
      let result;
      if (String(sort.key).startsWith('dynamic:')) {
        const dynamicKey = String(sort.key).slice('dynamic:'.length);
        result = compareSortValues(getDynamicSortValue(left, dynamicKey), getDynamicSortValue(right, dynamicKey));
      } else {
        result = compareSortValues(resolveSortValue(left, activeColumn), resolveSortValue(right, activeColumn));
      }
      return sort.direction === 'desc' ? -result : result;
    });

    return copy;
  }, [columns, getDynamicSortValue, rows, sort.direction, sort.key]);

  return (
    <section className="rx-panel rx-panel--table rx-panel--compact">
      <div className="rx-panel__header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      <div className="rx-table-wrap">
        <table className={classNames('rx-table', 'rx-table--dense', tableClassName)}>
          <thead>
            <tr>
              {columns.map((column) => {
                const key = column.sortKey || column.key;
                const isActive = sort.key === key;
                const indicator = isActive ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : '';
                return (
                  <th
                    key={key}
                    className={classNames('rx-th--sortable', isActive ? 'rx-th--sorted' : null)}
                    onClick={() => handleSort(column)}
                    role="button"
                    aria-sort={isActive ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                    title="Click to sort"
                  >{column.label}{indicator}</th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr><td className="rx-empty" colSpan={columns.length}>{emptyMessage}</td></tr>
            ) : sortedRows.map((row) => (
              <tr key={rowKey(row)} className={getRowClassName(row)}>
                <td className="rx-matrix-family">{primaryColumn.render ? primaryColumn.render(row) : row[primaryColumn.key]}</td>
                <td>{statusColumn.render ? statusColumn.render(row) : row[statusColumn.key]}</td>
                <td>{readyColumn.render ? readyColumn.render(row) : row[readyColumn.key]}</td>
                {(Array.isArray(dynamicColumns) ? dynamicColumns : []).map((column) => (
                  <td key={column.key}>{renderDynamicCell(row, column.key)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ServerPagination({ pagination, onPageChange, onPageSizeChange }) {
  const pageNumber = Math.max(1, Number(pagination && pagination.pageNumber) || 1);
  const pageSize = Math.max(1, Number(pagination && pagination.pageSize) || 50);
  const total = Math.max(0, Number(pagination && pagination.total) || 0);
  const pageCount = Math.max(1, Number(pagination && pagination.pageCount) || 1);
  const hasPrev = pageNumber > 1;
  const hasNext = pageNumber < pageCount;
  const pageStart = total > 0 ? ((pageNumber - 1) * pageSize) + 1 : 0;
  const pageEnd = total > 0 ? Math.min(pageNumber * pageSize, total) : 0;

  return (
    <section className="rx-panel rx-panel--compact rx-panel--table">
      <div className="rx-table-footer rx-table-footer--server">
        <span className="rx-selected-count">Showing {formatNumber(pageStart)}-{formatNumber(pageEnd)} of {formatNumber(total)}</span>
        <label className="rx-pagination__page-size">
          <span className="rx-selected-count">Rows per page</span>
          <select value={String(pageSize)} onChange={(event) => onPageSizeChange(Number(event.target.value || 50))}>
            {[25, 50, 100, 250].map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <div className="rx-pagination">
          <button className="rx-button rx-button--secondary" type="button" disabled={!hasPrev} onClick={() => onPageChange(pageNumber - 1)}>Previous</button>
          <span className="rx-selected-count">Page {formatNumber(pageNumber)} of {formatNumber(pageCount)}</span>
          <button className="rx-button rx-button--secondary" type="button" disabled={!hasNext} onClick={() => onPageChange(pageNumber + 1)}>Next</button>
        </div>
      </div>
    </section>
  );
}

function SqlPreviewPanel({ activeViewLabel, loading, error, rows }) {
  const items = Array.isArray(rows) ? rows : [];

  return (
    <section className="rx-panel rx-panel--compact rx-panel--sql-preview">
      <div className="rx-panel__header">
        <div>
          <h2>SQL Preview</h2>
          <p>Queries behind the current {activeViewLabel || 'view'} for Power BI validation and report design.</p>
        </div>
      </div>
      {loading ? <div className="rx-empty">Loading SQL preview...</div> : null}
      {!loading && error ? <div className="rx-empty">{error}</div> : null}
      {!loading && !error && items.length === 0 ? <div className="rx-empty">No SQL preview rows available.</div> : null}
      {!loading && !error && items.length > 0 ? (
        <div className="rx-sql-preview-stack">
          {items.map((item, index) => (
            <article key={`${item.title}-${index}`} className="rx-sql-card">
              <div className="rx-sql-card__meta">
                <strong>{item.title}</strong>
                <span>{item.endpoint}</span>
              </div>
              <pre className="rx-sql-card__query">{item.query}</pre>
              <div className="rx-sql-card__params">
                <strong>Parameters</strong>
                <code>{JSON.stringify(item.params || {}, null, 2)}</code>
              </div>
              {Array.isArray(item.notes) && item.notes.length > 0 ? (
                <div className="rx-sql-card__notes">
                  {item.notes.map((note, noteIndex) => <p key={noteIndex}>{note}</p>)}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function formatCompactNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 'n/a';
  }

  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: numeric >= 100 ? 0 : 1
  }).format(numeric);
}

function formatTrendBucket(value, granularity = 'daily') {
  if (!value) {
    return 'n/a';
  }

  const normalizedGranularity = granularity === 'hourly' ? 'hourly' : 'daily';
  const date = normalizedGranularity === 'hourly'
    ? new Date(value)
    : new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return normalizedGranularity === 'hourly'
    ? date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric'
    })
    : date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    });
}

function TrendLineChart({ title, subtitle, rows, series, emptyMessage, granularity = 'daily' }) {
  const scopedRows = Array.isArray(rows) ? rows : [];
  const chartSeries = Array.isArray(series) ? series : [];

  if (scopedRows.length === 0 || chartSeries.length === 0) {
    return (
      <section className="rx-panel rx-panel--compact">
        <div className="rx-panel__header">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </div>
        <div className="rx-empty">{emptyMessage || 'No trend history rows available.'}</div>
      </section>
    );
  }

  const width = 920;
  const height = 276;
  const margin = { top: 16, right: 20, bottom: 34, left: 58 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(1, ...scopedRows.flatMap((row) => chartSeries.map((item) => Number(item.getValue(row) || 0))));
  const tickCount = 4;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, index) => {
    const value = (maxValue / tickCount) * index;
    const y = margin.top + innerHeight - (value / maxValue) * innerHeight;
    return { value, y };
  });
  const xStep = scopedRows.length > 1 ? innerWidth / (scopedRows.length - 1) : 0;
  const xLabelInterval = Math.max(1, Math.ceil(scopedRows.length / 8));

  return (
    <section className="rx-panel rx-panel--compact">
      <div className="rx-panel__header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      <div className="rx-trend-legend">
        {chartSeries.map((item) => (
          <div key={item.key} className="rx-trend-legend__item">
            <span className="rx-trend-legend__swatch" style={{ backgroundColor: item.color }}></span>
            <strong>{item.label}</strong>
            <span>{item.formatValue ? item.formatValue(item.getValue(scopedRows[scopedRows.length - 1])) : formatCompactNumber(item.getValue(scopedRows[scopedRows.length - 1]))}</span>
          </div>
        ))}
      </div>
      <div className="rx-trend-chart">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          {yTicks.map((tick) => (
            <g key={tick.value}>
              <line className="rx-trend-chart__grid" x1={margin.left} x2={width - margin.right} y1={tick.y} y2={tick.y}></line>
              <text className="rx-trend-chart__tick" x={margin.left - 10} y={tick.y + 4} textAnchor="end">{formatCompactNumber(tick.value)}</text>
            </g>
          ))}
          {chartSeries.map((item) => {
            const points = scopedRows.map((row, index) => {
              const value = Number(item.getValue(row) || 0);
              const x = margin.left + (scopedRows.length === 1 ? innerWidth / 2 : xStep * index);
              const y = margin.top + innerHeight - (value / maxValue) * innerHeight;
              return { x, y, value, day: row.day };
            });

            return (
              <g key={item.key}>
                <polyline
                  className="rx-trend-chart__line"
                  fill="none"
                  stroke={item.color}
                  strokeWidth="3"
                  points={points.map((point) => `${point.x},${point.y}`).join(' ')}
                ></polyline>
                {points.map((point) => (
                  <g key={`${item.key}-${point.day}`}>
                    <circle cx={point.x} cy={point.y} r="4" fill={item.color}></circle>
                    <title>{`${item.label}: ${item.formatValue ? item.formatValue(point.value) : formatNumber(point.value)} on ${formatTrendBucket(point.day, granularity)}`}</title>
                  </g>
                ))}
              </g>
            );
          })}
          {scopedRows.map((row, index) => {
            if (index % xLabelInterval !== 0 && index !== scopedRows.length - 1) {
              return null;
            }
            const x = margin.left + (scopedRows.length === 1 ? innerWidth / 2 : xStep * index);
            return (
              <text key={row.day} className="rx-trend-chart__tick rx-trend-chart__tick--x" x={x} y={height - 10} textAnchor="middle">{formatTrendBucket(row.day, granularity)}</text>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

function TrendReport({ rows, filters, selectedSubscriptionCount, totalSubscriptionCount, granularity, onGranularityChange }) {
  const scopedRows = Array.isArray(rows) ? rows : [];
  const latestRow = scopedRows[scopedRows.length - 1] || null;
  const firstRow = scopedRows[0] || null;
  const quotaDelta = latestRow && firstRow ? Number(latestRow.totalQuotaAvailable || 0) - Number(firstRow.totalQuotaAvailable || 0) : 0;
  const observationDelta = latestRow && firstRow ? Number(latestRow.totalRows || 0) - Number(firstRow.totalRows || 0) : 0;
  const normalizedGranularity = granularity === 'hourly' ? 'hourly' : 'daily';
  const trendWindowLabel = normalizedGranularity === 'hourly' ? 'trailing 48 hours' : 'trailing 7 days';
  const bucketLabel = normalizedGranularity === 'hourly' ? 'hour' : 'day';
  const peakLabel = normalizedGranularity === 'hourly' ? 'Observed Hourly Peak' : 'Observed Daily Peak';
  const rolling7Label = normalizedGranularity === 'hourly' ? 'Trailing 7-Hour Peak' : 'Rolling 7-Day Peak';
  const rolling14Label = normalizedGranularity === 'hourly' ? 'Trailing 14-Hour Peak' : 'Rolling 14-Day Peak';
  const subscriptionLabel = selectedSubscriptionCount === totalSubscriptionCount
    ? `All ${formatNumber(totalSubscriptionCount)} subscriptions`
    : `${formatNumber(selectedSubscriptionCount)} selected subscriptions`;
  const regionLabel = filters.region && filters.region !== 'all'
    ? filters.region
    : `${filters.regionPreset || 'all'} preset`;
  const familyLabel = filters.family && filters.family !== 'all'
    ? (formatFamilyLabel(filters.family) || filters.family)
    : 'All families';
  const skuLabel = filters.sku && filters.sku !== 'all'
    ? filters.sku
    : 'All SKUs';

  return (
    <div className="rx-view-stack">
      <section className="rx-panel rx-panel--compact rx-panel--muted">
        <div className="rx-panel__header">
          <div>
            <h2>Trend Calculation</h2>
            <p>The server groups `dbo.CapacitySnapshot` by capture {bucketLabel} after applying the active region preset, specific region, selected subscriptions, family, SKU, and availability filters.</p>
          </div>
          <label className="rx-field">
            <span>Granularity</span>
            <select value={normalizedGranularity} onChange={(event) => onGranularityChange(event.target.value)}>
              <option value="daily">Daily</option>
              <option value="hourly">Hourly</option>
            </select>
          </label>
        </div>
        <div className="rx-trend-summary">
          <div className="rx-trend-summary__item">
            <span>Filter Scope</span>
            <strong>{regionLabel}</strong>
            <small>{subscriptionLabel} · {familyLabel} · {skuLabel}</small>
          </div>
          <div className="rx-trend-summary__item">
            <span>Latest Quota Available</span>
            <strong>{latestRow ? formatNumber(latestRow.totalQuotaAvailable) : 'n/a'}</strong>
            <small>{firstRow ? `${quotaDelta >= 0 ? '+' : ''}${formatNumber(quotaDelta)} vs first ${bucketLabel}` : 'Waiting for history'}</small>
          </div>
          <div className="rx-trend-summary__item">
            <span>Latest SKU Observations</span>
            <strong>{latestRow ? formatNumber(latestRow.totalRows) : 'n/a'}</strong>
            <small>{firstRow ? `${observationDelta >= 0 ? '+' : ''}${formatNumber(observationDelta)} vs first ${bucketLabel}` : 'Waiting for history'}</small>
          </div>
          <div className="rx-trend-summary__item">
            <span>{peakLabel}</span>
            <strong>{latestRow ? formatPercent(latestRow.peakUtilizationPct) : 'n/a'}</strong>
            <small>{`Highest sampled quota utilization in the latest ${bucketLabel}`}</small>
          </div>
          <div className="rx-trend-summary__item">
            <span>{rolling7Label}</span>
            <strong>{latestRow ? formatPercent(latestRow.rolling7DayPeakUtilizationPct) : 'n/a'}</strong>
            <small>{`Highest sampled peak across the trailing 7 ${normalizedGranularity === 'hourly' ? 'hours' : 'days'}`}</small>
          </div>
          <div className="rx-trend-summary__item">
            <span>{rolling14Label}</span>
            <strong>{latestRow ? formatPercent(latestRow.rolling14DayPeakUtilizationPct) : 'n/a'}</strong>
            <small>{`Highest sampled peak across the trailing 14 ${normalizedGranularity === 'hourly' ? 'hours' : 'days'}`}</small>
          </div>
        </div>
        <p className="rx-trend-note">Peak utilization is based on the highest sampled quota usage saved in each {bucketLabel}. It reflects your captured runs, not any unseen spike between scheduler executions.</p>
      </section>
      <TrendLineChart
        title="Peak Utilization Over Time"
        subtitle={normalizedGranularity === 'hourly'
          ? 'Hourly sampled peak utilization plus trailing 7-hour and 14-hour peak overlays for the current scope.'
          : 'Daily sampled peak utilization plus trailing 7-day and 14-day peak overlays for the current scope.'}
        rows={scopedRows}
        granularity={normalizedGranularity}
        series={[
          {
            key: 'peakUtilizationPct',
            label: normalizedGranularity === 'hourly' ? 'Hourly Peak Utilization' : 'Daily Peak Utilization',
            color: '#7c3aed',
            getValue: (row) => row.peakUtilizationPct,
            formatValue: formatPercent
          },
          {
            key: 'rolling7DayPeakUtilizationPct',
            label: normalizedGranularity === 'hourly' ? '7-Hour Rolling Peak' : '7-Day Rolling Peak',
            color: '#d97706',
            getValue: (row) => row.rolling7DayPeakUtilizationPct,
            formatValue: formatPercent
          },
          {
            key: 'rolling14DayPeakUtilizationPct',
            label: normalizedGranularity === 'hourly' ? '14-Hour Rolling Peak' : '14-Day Rolling Peak',
            color: '#0f766e',
            getValue: (row) => row.rolling14DayPeakUtilizationPct,
            formatValue: formatPercent
          }
        ]}
        emptyMessage="No peak utilization history rows available."
      />
      <section className="rx-panel rx-panel--compact rx-panel--muted">
        <div className="rx-panel__header">
          <div>
            <h2>Headroom Context</h2>
            <p>{normalizedGranularity === 'hourly' ? 'These hourly totals are useful for spotting same-day spikes.' : 'These daily totals are still useful, but they answer a different question than peak utilization.'}</p>
          </div>
        </div>
        <p className="rx-trend-note">Large swings usually mean more or fewer snapshot rows were captured in that {bucketLabel}. React is only rendering the result; the region, subscription, family, and SKU filters are applied by the API before the aggregates are calculated.</p>
      </section>
      <TrendLineChart
        title="Quota Available Over Time"
        subtitle={normalizedGranularity === 'hourly'
          ? 'Hourly summed headroom across the current filter scope. Use subscription filters when you want one subscription trend instead of the whole cohort.'
          : 'Daily summed headroom across the current filter scope. Use subscription filters when you want one subscription trend instead of the whole cohort.'}
        rows={scopedRows}
        granularity={normalizedGranularity}
        series={[
          {
            key: 'quota',
            label: 'Total Quota Available',
            color: '#005a9c',
            getValue: (row) => row.totalQuotaAvailable
          }
        ]}
        emptyMessage="No quota trend history rows available."
      />
      <TrendLineChart
        title="Snapshot Volume Context"
        subtitle={normalizedGranularity === 'hourly'
          ? 'These counts explain why quota totals can jump: fewer captured rows usually means a smaller hourly aggregate even with the same filters.'
          : 'These counts explain why quota totals can jump: fewer captured rows usually means a smaller daily aggregate even with the same filters.'}
        rows={scopedRows}
        granularity={normalizedGranularity}
        series={[
          {
            key: 'totalRows',
            label: 'Total SKU Observations',
            color: '#2f855a',
            getValue: (row) => row.totalRows
          },
          {
            key: 'constrainedRows',
            label: 'Constrained Observations',
            color: '#c05621',
            getValue: (row) => row.constrainedRows
          }
        ]}
        emptyMessage="No observation trend history rows available."
      />
      <DataTable
        key="trend"
        title={normalizedGranularity === 'hourly' ? 'Hourly Trend Rows' : 'Daily Trend Rows'}
        subtitle={normalizedGranularity === 'hourly' ? `Raw hourly aggregates for the ${trendWindowLabel}.` : 'Raw daily aggregates behind the charts.'}
        columns={[
          { key: 'day', label: normalizedGranularity === 'hourly' ? 'Hour' : 'Day', render: (row) => formatTrendBucket(row.day, normalizedGranularity) },
          { key: 'totalRows', label: 'Total Rows', render: (row) => formatNumber(row.totalRows) },
          { key: 'constrainedRows', label: 'Constrained Rows', render: (row) => formatNumber(row.constrainedRows) },
          { key: 'totalQuotaAvailable', label: 'Total Quota Available', render: (row) => formatNumber(row.totalQuotaAvailable) },
          { key: 'peakUtilizationPct', label: normalizedGranularity === 'hourly' ? 'Hourly Peak Utilization' : 'Daily Peak Utilization', render: (row) => formatPercent(row.peakUtilizationPct) },
          { key: 'rolling7DayPeakUtilizationPct', label: normalizedGranularity === 'hourly' ? '7-Hour Peak' : '7-Day Peak', render: (row) => formatPercent(row.rolling7DayPeakUtilizationPct) },
          { key: 'rolling14DayPeakUtilizationPct', label: normalizedGranularity === 'hourly' ? '14-Hour Peak' : '14-Day Peak', render: (row) => formatPercent(row.rolling14DayPeakUtilizationPct) }
        ]}
        rows={scopedRows}
        emptyMessage="No trend history rows available."
      />
    </div>
  );
}

function DrawerFilterSection({ title, children }) {
  return (
    <section className="rx-drawer-section">
      <div className="rx-drawer-section__title">{title}</div>
      {children}
    </section>
  );
}

function SubscriptionPicker({ options, selectedIds, search, onSearch, onToggle, onSelectAll, onClear }) {
  const filtered = useMemo(() => {
    const term = String(search || '').trim().toLowerCase();
    return options.filter((option) => !term || option.subscriptionName.toLowerCase().includes(term) || option.subscriptionId.toLowerCase().includes(term));
  }, [options, search]);

  return (
    <div className="rx-subscription-picker">
      <div className="rx-inline-actions">
        <button type="button" className="rx-chip-button" onClick={onSelectAll}>Select all</button>
        <button type="button" className="rx-chip-button" onClick={onClear}>Clear</button>
        <span className="rx-selected-count">{selectedIds.length} selected</span>
      </div>
      <input className="rx-input" type="search" value={search} placeholder="Subscription search" onChange={(event) => onSearch(event.target.value)} />
      <div className="rx-subscription-list">
        {filtered.map((option) => (
          <label key={option.subscriptionId} className="rx-subscription-item">
            <input type="checkbox" checked={selectedIds.includes(option.subscriptionId)} onChange={() => onToggle(option.subscriptionId)} />
            <span className="rx-subscription-item__text">
              <strong className="rx-subscription-item__name">{option.subscriptionName || option.subscriptionId}</strong>
              <small className="rx-subscription-item__id">{option.subscriptionId}</small>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function AdminIngestionView(props) {
  const {
    job,
    status,
    schedule,
    runtime,
    persistence,
    selectedRegionPreset,
    actions,
    onScheduleChange,
    busy,
    viewStatus
  } = props;

  const summary = status?.lastSummary || {};
  const regions = Array.isArray(summary.regions) && summary.regions.length ? summary.regions.join(', ') : 'n/a';
  const families = Array.isArray(summary.familyFilters) && summary.familyFilters.length ? summary.familyFilters.join(', ') : 'n/a';
  const jobState = job?.status === 'queued' || job?.status === 'running' ? job.status : null;
  const stateLabel = jobState === 'queued'
    ? 'Queued'
    : (jobState === 'running'
      ? 'Running'
      : (status?.inProgress ? 'Running' : (status?.lastError ? 'Failed' : (status?.lastSuccessUtc ? 'Healthy' : 'Idle'))));
  const schedulerPersistenceAvailable = persistence?.available !== false;
  const schedulerMessage = persistence?.message || 'Scheduler settings are persisted in SQL and applied to the runtime scheduler when saved.';
  const jobRunning = jobState === 'queued' || jobState === 'running' || status?.inProgress;

  return (
    <div className="rx-view-stack">
      <Banner tone={viewStatus.tone} message={viewStatus.message} />
      <section className="rx-panel">
        <div className="rx-panel__header"><div><h2>Capacity Ingestion</h2><p>Trigger ingestion runs and manage the background scheduler used by the dashboard.</p></div></div>
        <div className="rx-inline-actions">
          <span className="rx-selected-count">Using region preset: {selectedRegionPreset || 'all'}</span>
          <button className="rx-button" type="button" onClick={actions.triggerIngest} disabled={busy.trigger || jobRunning}>{busy.trigger || jobRunning ? 'Ingest Running...' : 'Run Capacity Ingestion'}</button>
          <button className="rx-button rx-button--secondary" type="button" onClick={actions.refreshModelCatalog} disabled={busy.refreshModelCatalog}>{busy.refreshModelCatalog ? 'Refreshing Models...' : 'Refresh Model Library'}</button>
          <button className="rx-button rx-button--secondary" type="button" onClick={actions.refreshStatus} disabled={busy.refreshStatus}>{busy.refreshStatus ? 'Refreshing...' : 'Refresh Status'}</button>
          <button className="rx-button rx-button--secondary" type="button" onClick={actions.refreshSchedule} disabled={busy.refreshSchedule}>{busy.refreshSchedule ? 'Loading Settings...' : 'Reload Scheduler Settings'}</button>
        </div>
      </section>
      <section className="rx-panel rx-panel--compact rx-panel--muted">
        <div className="rx-panel__header"><div><h2>Current Status</h2><p>Latest ingestion health and the most recent run summary.</p></div></div>
        <div className="rx-summary-grid rx-summary-grid--status">
          <article className="rx-metric-card"><span>State</span><strong>{stateLabel}</strong></article>
          <article className="rx-metric-card rx-metric-card--detail"><span>Job</span><strong>{job?.jobId ? `${job.status} (${job.jobId.slice(0, 8)})` : 'n/a'}</strong></article>
          <article className="rx-metric-card rx-metric-card--detail"><span>Last Run</span><strong>{formatTimestamp(status?.lastRunUtc)}</strong></article>
          <article className="rx-metric-card rx-metric-card--detail"><span>Last Success</span><strong>{formatTimestamp(status?.lastSuccessUtc)}</strong></article>
          <article className="rx-metric-card"><span>Duration</span><strong>{formatDuration(status?.lastDurationMs)}</strong></article>
          <article className="rx-metric-card"><span>Inserted Rows</span><strong>{formatNumber(status?.lastInsertedRows || 0)}</strong></article>
          <article className="rx-metric-card"><span>Score Rows</span><strong>{formatNumber(summary.insertedScoreRows || 0)}</strong></article>
          <article className="rx-metric-card"><span>AI Model Rows</span><strong>{formatNumber(summary.insertedAIModelRows || 0)}</strong></article>
          <article className="rx-metric-card"><span>Subscriptions</span><strong>{formatNumber(summary.subscriptionCount || 0)}</strong></article>
          <article className="rx-metric-card rx-metric-card--detail"><span>Regions</span><strong>{regions}</strong></article>
          <article className="rx-metric-card rx-metric-card--detail"><span>Families</span><strong>{families}</strong></article>
          <article className="rx-metric-card rx-metric-card--detail"><span>Last Error</span><strong>{status?.lastError || 'None'}</strong></article>
        </div>
      </section>
      <section className="rx-panel">
        <div className="rx-panel__header"><div><h2>Scheduler Settings</h2><p>{schedulerMessage}</p></div></div>
        <div className="rx-field-grid rx-field-grid--filters">
          <label className="rx-field"><span>Ingest Interval (minutes)</span><input className="rx-input" type="number" min="0" step="1" value={schedule.ingest.intervalMinutes} onChange={(event) => onScheduleChange('ingest', 'intervalMinutes', Number(event.target.value || 0))} disabled={!schedulerPersistenceAvailable} /></label>
          <label className="rx-field"><span>Live Placement Interval (minutes)</span><input className="rx-input" type="number" min="0" step="1" value={schedule.livePlacement.intervalMinutes} onChange={(event) => onScheduleChange('livePlacement', 'intervalMinutes', Number(event.target.value || 0))} disabled={!schedulerPersistenceAvailable} /></label>
          <label className="rx-field"><span>AI Model Catalog Interval (hours)</span><input className="rx-input" type="number" min="0" step="1" value={minutesToHours(schedule.aiModelCatalog.intervalMinutes, 1440)} onChange={(event) => onScheduleChange('aiModelCatalog', 'intervalMinutes', hoursToMinutes(event.target.value, 1440))} disabled={!schedulerPersistenceAvailable} /></label>
          <label className="rx-check"><input type="checkbox" checked={schedule.ingest.runOnStartup} onChange={(event) => onScheduleChange('ingest', 'runOnStartup', event.target.checked)} disabled={!schedulerPersistenceAvailable} />Run ingest on startup</label>
          <label className="rx-check"><input type="checkbox" checked={schedule.livePlacement.runOnStartup} onChange={(event) => onScheduleChange('livePlacement', 'runOnStartup', event.target.checked)} disabled={!schedulerPersistenceAvailable} />Run live placement on startup</label>
        </div>
        <div className="rx-inline-actions">
          <span className="rx-selected-count">Runtime ingest interval: {formatNumber(runtime.ingest.intervalMinutes)} min</span>
          <span className="rx-selected-count">Runtime live placement interval: {formatNumber(runtime.livePlacement.intervalMinutes)} min</span>
          <span className="rx-selected-count">Runtime AI model catalog interval: {minutesToHours(runtime.aiModelCatalog.intervalMinutes, 1440)} hr</span>
          <button className="rx-button" type="button" onClick={actions.saveSchedule} disabled={!schedulerPersistenceAvailable || busy.saveSchedule}>{busy.saveSchedule ? 'Saving...' : 'Save Scheduler Settings'}</button>
        </div>
      </section>
    </div>
  );
}

function AIModelAvailabilityView({ rows, loading, status }) {
  const uniqueModels = useMemo(() => new Set((rows || []).map((row) => String(row.modelName || '').trim()).filter(Boolean)).size, [rows]);
  const uniqueRegions = useMemo(() => new Set((rows || []).map((row) => String(row.region || '').trim()).filter(Boolean)).size, [rows]);
  const uniqueProviders = useMemo(() => new Set((rows || []).map((row) => getAIModelProviderLabel(row))).size, [rows]);
  const defaultRows = useMemo(() => (rows || []).filter((row) => Boolean(row.isDefault)).length, [rows]);
  const fineTuneRows = useMemo(() => (rows || []).filter((row) => Boolean(row.finetuneCapable)).length, [rows]);

  return (
    <div className="rx-view-stack">
      <Banner tone={status.tone} message={status.message} detail={status.detail} />
      <section className="rx-panel">
        <div className="rx-panel__header"><div><h2>AI Model Availability</h2><p>Catalog-style view of provider-aware Azure AI regional model coverage, versions, and deployment types.</p></div></div>
        <div className="rx-inline-actions">
          <span className="rx-selected-count">Rows in scope: {formatNumber((rows || []).length)}</span>
          <span className="rx-selected-count">Models: {formatNumber(uniqueModels)}</span>
          <span className="rx-selected-count">Regions: {formatNumber(uniqueRegions)}</span>
          <span className="rx-selected-count">Providers: {formatNumber(uniqueProviders)}</span>
        </div>
      </section>
      <section className="rx-panel rx-panel--compact rx-panel--muted">
        <div className="rx-summary-grid">
          <article className="rx-metric-card"><span>Catalog Rows</span><strong>{formatNumber((rows || []).length)}</strong></article>
          <article className="rx-metric-card"><span>Models</span><strong>{formatNumber(uniqueModels)}</strong></article>
          <article className="rx-metric-card"><span>Regions</span><strong>{formatNumber(uniqueRegions)}</strong></article>
          <article className="rx-metric-card"><span>Providers</span><strong>{formatNumber(uniqueProviders)}</strong></article>
          <article className="rx-metric-card"><span>Default Versions</span><strong>{formatNumber(defaultRows)}</strong></article>
          <article className="rx-metric-card"><span>Fine-Tuning Ready</span><strong>{formatNumber(fineTuneRows)}</strong></article>
        </div>
      </section>
      <DataTable
        title="Model Availability Grid"
        subtitle="Each row represents the latest model/version availability snapshot for a region."
        columns={[
          { key: 'provider', label: 'Provider', render: (row) => getAIModelProviderLabel(row) },
          { key: 'modelName', label: 'Model' },
          { key: 'modelVersion', label: 'Version' },
          { key: 'region', label: 'Region' },
          { key: 'deploymentTypes', label: 'Deployment Types', render: (row) => row.deploymentTypes || 'n/a' },
          { key: 'finetuneCapable', label: 'Fine-Tuning', render: (row) => <StatusPill value={row.finetuneCapable ? 'OK' : 'N/A'} /> },
          { key: 'isDefault', label: 'Default', render: (row) => <StatusPill value={row.isDefault ? 'DEFAULT' : 'N/A'} /> },
          { key: 'modelFormat', label: 'Format' },
          { key: 'skuName', label: 'SKU' },
          { key: 'deprecationDate', label: 'Deprecation', render: (row) => formatDateValue(row.deprecationDate) },
          { key: 'capturedAtUtc', label: 'Updated', render: (row) => formatTimestamp(row.capturedAtUtc) }
        ]}
        rows={rows}
        emptyMessage={loading ? 'Loading AI model availability...' : 'No AI model availability rows returned for the current provider and filter scope.'}
      />
    </div>
  );
}

function AIModelSummaryReportView({ rows, loading, status, availableRegions }) {
  const regionOrder = useMemo(() => {
    const scopedRegions = Array.isArray(availableRegions)
      ? availableRegions.map((region) => String(region || '').trim()).filter(Boolean)
      : [];
    const discoveredRegions = [...new Set((rows || [])
      .map((row) => String(row.region || '').trim())
      .filter(Boolean))].sort((left, right) => left.localeCompare(right));
    const ordered = [];
    scopedRegions.forEach((region) => {
      if (!ordered.includes(region)) ordered.push(region);
    });
    discoveredRegions.forEach((region) => {
      if (!ordered.includes(region)) ordered.push(region);
    });
    return ordered;
  }, [availableRegions, rows]);

  const summaryModel = useMemo(() => {
    const providerRegionMap = new Map();
    const providers = new Set();
    const allRows = Array.isArray(rows) ? rows : [];

    allRows.forEach((row) => {
      const region = String(row.region || '').trim();
      const provider = getAIModelProviderLabel(row);
      if (!region || !provider) return;

      providers.add(provider);
      const key = `${region}::${provider}`;
      if (!providerRegionMap.has(key)) {
        providerRegionMap.set(key, {
          region,
          provider,
          totalModels: 0,
          uniqueNames: new Set(),
          gaCount: 0,
          stableCount: 0,
          previewCount: 0,
          deploymentTypes: new Set(),
          modelStats: new Map()
        });
      }

      const entry = providerRegionMap.get(key);
      entry.totalModels += 1;

      const modelName = String(row.modelName || '').trim();
      if (modelName) {
        entry.uniqueNames.add(modelName);
      }

      const lifecycle = String(row.lifecycle || row.lifecycleStatus || '').trim().toLowerCase();
      if (lifecycle === 'generallyavailable') {
        entry.gaCount += 1;
      } else if (lifecycle === 'stable') {
        entry.stableCount += 1;
      } else if (lifecycle === 'preview') {
        entry.previewCount += 1;
      }

      String(row.deploymentTypes || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .forEach((deploymentType) => entry.deploymentTypes.add(deploymentType));

      if (modelName) {
        if (!entry.modelStats.has(modelName)) {
          entry.modelStats.set(modelName, { count: 0, deploymentTypeCount: 0 });
        }
        const modelStat = entry.modelStats.get(modelName);
        modelStat.count += 1;
        modelStat.deploymentTypeCount = Math.max(
          modelStat.deploymentTypeCount,
          String(row.deploymentTypes || '').split(',').map((value) => value.trim()).filter(Boolean).length
        );
      }
    });

    const summariesByRegion = new Map();
    regionOrder.forEach((region) => summariesByRegion.set(region, []));

    providerRegionMap.forEach((entry) => {
      const topModel = [...entry.modelStats.entries()]
        .sort((left, right) => {
          const countDelta = right[1].count - left[1].count;
          if (countDelta !== 0) return countDelta;
          const deployDelta = right[1].deploymentTypeCount - left[1].deploymentTypeCount;
          if (deployDelta !== 0) return deployDelta;
          return left[0].localeCompare(right[0]);
        })[0]?.[0] || 'n/a';

      const summaryRow = {
        id: `${entry.region}-${entry.provider}`,
        region: entry.region,
        provider: entry.provider,
        totalModels: entry.totalModels,
        uniqueNames: entry.uniqueNames.size,
        gaCount: entry.gaCount,
        stableCount: entry.stableCount,
        previewCount: entry.previewCount,
        deploymentTypes: [...entry.deploymentTypes].sort((left, right) => left.localeCompare(right)).join(','),
        topModel
      };

      if (!summariesByRegion.has(entry.region)) {
        summariesByRegion.set(entry.region, []);
      }
      summariesByRegion.get(entry.region).push(summaryRow);
    });

    summariesByRegion.forEach((summaryRows) => {
      summaryRows.sort((left, right) => left.provider.localeCompare(right.provider));
    });

    const providerOrder = [...providers].sort((left, right) => left.localeCompare(right));
    const matrixRows = providerOrder.map((provider) => {
      const row = { provider, coveredRegions: 0 };
      regionOrder.forEach((region) => {
        const summary = (summariesByRegion.get(region) || []).find((candidate) => candidate.provider === provider);
        row[region] = summary ? `${formatNumber(summary.totalModels)} model${summary.totalModels === 1 ? '' : 's'}` : '-';
        if (summary) row.coveredRegions += 1;
      });
      return row;
    });

    return {
      summariesByRegion,
      providerOrder,
      matrixRows,
      totalRows: allRows.length,
      totalRegions: regionOrder.length
    };
  }, [regionOrder, rows]);

  const [summaryRegion, setSummaryRegion] = useState('');
  const [drillRegion, setDrillRegion] = useState('');
  const drillRegionOptions = useMemo(() => regionOrder.filter((region) => (summaryModel.summariesByRegion.get(region) || []).length > 0), [regionOrder, summaryModel.summariesByRegion]);

  useEffect(() => {
    if (drillRegionOptions.length === 0) {
      if (summaryRegion) setSummaryRegion('');
      return;
    }
    if (!drillRegionOptions.includes(summaryRegion)) {
      setSummaryRegion(drillRegionOptions[0]);
    }
  }, [drillRegionOptions, summaryRegion]);

  useEffect(() => {
    if (drillRegionOptions.length === 0) {
      if (drillRegion) setDrillRegion('');
      return;
    }
    if (!drillRegionOptions.includes(drillRegion)) {
      setDrillRegion(drillRegionOptions[0]);
    }
  }, [drillRegion, drillRegionOptions]);

  const drillProviderOptions = useMemo(
    () => (summaryModel.summariesByRegion.get(drillRegion) || []).map((row) => row.provider),
    [drillRegion, summaryModel.summariesByRegion]
  );
  const [drillProvider, setDrillProvider] = useState('');

  useEffect(() => {
    if (drillProviderOptions.length === 0) {
      if (drillProvider) setDrillProvider('');
      return;
    }
    if (!drillProviderOptions.includes(drillProvider)) {
      setDrillProvider(drillProviderOptions[0]);
    }
  }, [drillProvider, drillProviderOptions]);

  const drillDownRows = useMemo(() => {
    if (!drillRegion || !drillProvider) return [];
    return (rows || [])
      .filter((row) => String(row.region || '').trim() === drillRegion && getAIModelProviderLabel(row) === drillProvider)
      .sort((left, right) => {
        const nameDelta = String(left.modelName || '').localeCompare(String(right.modelName || ''));
        if (nameDelta !== 0) return nameDelta;
        return String(left.modelVersion || '').localeCompare(String(right.modelVersion || ''));
      });
  }, [drillProvider, drillRegion, rows]);

  const uniqueProviders = useMemo(() => summaryModel.providerOrder.length, [summaryModel.providerOrder]);

  return (
    <div className="rx-view-stack">
      <Banner tone={status.tone} message={status.message} detail={status.detail} />
      <section className="rx-panel">
        <div className="rx-panel__header"><div><h2>AI Summary Report</h2><p>Summary-first operational report for provider counts, region matrix coverage, and provider drill-down detail.</p></div></div>
        <div className="rx-inline-actions">
          <span className="rx-selected-count">Rows in scope: {formatNumber(summaryModel.totalRows)}</span>
          <span className="rx-selected-count">Regions: {formatNumber(summaryModel.totalRegions)}</span>
          <span className="rx-selected-count">Providers: {formatNumber(uniqueProviders)}</span>
        </div>
      </section>

      <section className="rx-panel rx-panel--compact rx-panel--muted">
        <div className="rx-panel__header"><div><h2>Summary Layout</h2><p>This report keeps the three recommended sections: per-region provider summary, multi-region matrix, and provider drill-down.</p></div></div>
        <div className="rx-summary-grid">
          <article className="rx-metric-card"><span>Per-Region Summaries</span><strong>{formatNumber(drillRegionOptions.length)}</strong></article>
          <article className="rx-metric-card"><span>Matrix Columns</span><strong>{formatNumber(regionOrder.length)}</strong></article>
          <article className="rx-metric-card"><span>Drill-Down Providers</span><strong>{formatNumber(drillProviderOptions.length)}</strong></article>
        </div>
      </section>

      <DataTable
        title="Multi-Region Matrix"
        subtitle="Provider coverage across the current region scope using the existing dashboard AI catalog snapshot."
        tableClassName="rx-table--dense"
        sectionClassName="rx-panel--compact"
        columns={[
          { key: 'provider', label: 'Provider' },
          ...regionOrder.map((region) => ({ key: region, label: region })),
          { key: 'coveredRegions', label: 'Covered', render: (row) => formatNumber(row.coveredRegions) }
        ]}
        rows={summaryModel.matrixRows}
        emptyMessage="No AI provider matrix rows are available for the current scope."
      />

      <section className="rx-panel rx-panel--compact">
        <div className="rx-panel__header"><div><h2>Per-Region Provider Summary</h2><p>Choose a region to review the provider rollup underneath the matrix.</p></div></div>
        <div className="rx-field-grid rx-field-grid--filters">
          <label className="rx-field"><span>Region</span><select value={summaryRegion} onChange={(event) => setSummaryRegion(event.target.value)}><option value="">Select region</option>{drillRegionOptions.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
        </div>
      </section>

      <DataTable
        key={summaryRegion || 'ai-summary-region-empty'}
        title={summaryRegion ? `Per-Region Provider Summary: ${summaryRegion}` : 'Per-Region Provider Summary'}
        subtitle="Provider rollup for the selected region and AI catalog filter scope."
        tableClassName="rx-table--dense"
        sectionClassName="rx-panel--compact"
        columns={[
          { key: 'provider', label: 'Provider' },
          { key: 'totalModels', label: 'Models', render: (row) => formatNumber(row.totalModels) },
          { key: 'uniqueNames', label: 'Unique', render: (row) => formatNumber(row.uniqueNames) },
          { key: 'gaCount', label: 'GA', render: (row) => formatNumber(row.gaCount) },
          { key: 'stableCount', label: 'Stable', render: (row) => formatNumber(row.stableCount) },
          { key: 'previewCount', label: 'Prevw', render: (row) => formatNumber(row.previewCount) },
          { key: 'deploymentTypes', label: 'Deploy Types', render: (row) => row.deploymentTypes || 'n/a' },
          { key: 'topModel', label: 'Top Model' }
        ]}
        rows={summaryRegion ? (summaryModel.summariesByRegion.get(summaryRegion) || []) : []}
        emptyMessage="Select a region to review provider summary rows."
      />

      <section className="rx-panel rx-panel--compact">
        <div className="rx-panel__header"><div><h2>Drill-Down Detail</h2><p>Max capacity is not currently persisted in the dashboard AI catalog snapshot, so that column is shown as `n/a` for now.</p></div></div>
        <div className="rx-field-grid rx-field-grid--filters">
          <label className="rx-field"><span>Region</span><select value={drillRegion} onChange={(event) => setDrillRegion(event.target.value)}><option value="">Select region</option>{drillRegionOptions.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
          <label className="rx-field"><span>Provider</span><select value={drillProvider} onChange={(event) => setDrillProvider(event.target.value)}><option value="">Select provider</option>{drillProviderOptions.map((provider) => <option key={provider} value={provider}>{provider}</option>)}</select></label>
        </div>
      </section>

      <DataTable
        title={drillRegion && drillProvider ? `Drill-Down Detail: ${drillProvider} in ${drillRegion}` : 'Drill-Down Detail'}
        subtitle="Detailed model rows for the selected provider and region."
        tableClassName="rx-table--dense"
        sectionClassName="rx-panel--compact"
        columns={[
          { key: 'modelName', label: 'Model' },
          { key: 'modelVersion', label: 'Version' },
          { key: 'lifecycleStatus', label: 'Lifecycle', render: (row) => row.lifecycleStatus || row.lifecycle || 'n/a' },
          { key: 'maxCapacity', label: 'Max Capacity', render: (row) => (row.maxCapacity == null ? 'n/a' : formatNumber(row.maxCapacity)) },
          { key: 'deploymentTypes', label: 'Deploy Types', render: (row) => row.deploymentTypes || 'n/a' },
          { key: 'isDefault', label: 'Default', render: (row) => <StatusPill value={row.isDefault ? 'DEFAULT' : 'N/A'} /> },
          { key: 'finetuneCapable', label: 'Fine-Tuning', render: (row) => <StatusPill value={row.finetuneCapable ? 'OK' : 'N/A'} /> }
        ]}
        rows={drillDownRows}
        emptyMessage="Select a region and provider to inspect detailed AI model rows."
      />
    </div>
  );
}

function formatExportCell(value) {
  if (value == null) {
    return '';
  }

  if (Array.isArray(value)) {
    return value.map((item) => formatExportCell(item)).filter(Boolean).join(', ');
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function escapeCsvCell(value) {
  const normalized = formatExportCell(value).replace(/\r?\n/g, ' ').trim();
  if (!/[",\n]/.test(normalized)) {
    return normalized;
  }
  return `"${normalized.replace(/"/g, '""')}"`;
}

function buildClientCsv(columns, rows) {
  const exportColumns = Array.isArray(columns) ? columns : [];
  const exportRows = Array.isArray(rows) ? rows : [];
  const header = exportColumns.map((column) => escapeCsvCell(column.label || column.key || '')).join(',');
  const body = exportRows.map((row) => exportColumns.map((column) => {
    const value = typeof column.value === 'function'
      ? column.value(row)
      : row?.[column.key];
    return escapeCsvCell(value);
  }).join(',')).join('\r\n');
  return [header, body].filter(Boolean).join('\r\n');
}

function sanitizeExportFilenamePart(value) {
  return String(value || 'report')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'report';
}

function buildExportTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function triggerFileDownload(blob, filename) {
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
}

function buildAIProviderMatrixExport(rows = [], availableRegions = []) {
  const scopedRows = Array.isArray(rows) ? rows : [];
  const preferredRegions = Array.isArray(availableRegions)
    ? availableRegions.map((region) => String(region || '').trim()).filter(Boolean)
    : [];
  const discoveredRegions = [...new Set(scopedRows.map((row) => String(row.region || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const regionOrder = [];

  preferredRegions.forEach((region) => {
    if (!regionOrder.includes(region)) {
      regionOrder.push(region);
    }
  });
  discoveredRegions.forEach((region) => {
    if (!regionOrder.includes(region)) {
      regionOrder.push(region);
    }
  });

  const providerRegionCounts = new Map();
  const providers = new Set();

  scopedRows.forEach((row) => {
    const region = String(row.region || '').trim();
    const provider = getAIModelProviderLabel(row);
    if (!region || !provider) {
      return;
    }
    providers.add(provider);
    const key = `${provider}::${region}`;
    providerRegionCounts.set(key, Number(providerRegionCounts.get(key) || 0) + 1);
  });

  const matrixRows = [...providers]
    .sort((left, right) => left.localeCompare(right))
    .map((provider) => {
      const row = { provider, coveredRegions: 0 };
      regionOrder.forEach((region) => {
        const count = Number(providerRegionCounts.get(`${provider}::${region}`) || 0);
        row[region] = count > 0 ? `${formatNumber(count)} model${count === 1 ? '' : 's'}` : '-';
        if (count > 0) {
          row.coveredRegions += 1;
        }
      });
      return row;
    });

  return {
    regionOrder,
    rows: matrixRows
  };
}

function QuotaDiscoveryView(props) {
  const {
    managementGroups,
    selectedManagementGroup,
    onManagementGroupChange,
    quotaGroups,
    selectedQuotaGroup,
    onQuotaGroupChange,
    candidates,
    candidateFilters,
    setCandidateFilters,
    selectedMoveCandidate,
    onSelectMoveCandidate,
    onOpenMovePlanner,
    quotaRuns,
    actions,
    busy,
    status
  } = props;

  const filteredCandidates = useMemo(() => {
    const familyTerm = normalizeSearchText(candidateFilters.family || '');
    return candidates.filter((row) => {
      const recipientNeed = getQuotaRecipientNeed(row);
      const movableQuota = Number(row.movableQuota || row.suggestedMovable || 0);
      const bySub = candidateFilters.subscriptionId === 'all' || row.subscriptionId === candidateFilters.subscriptionId;
      const byRegion = candidateFilters.region === 'all' || row.region === candidateFilters.region;
      const byIntent = candidateFilters.intent === 'all'
        || (candidateFilters.intent === 'need' && recipientNeed > 0)
        || (candidateFilters.intent === 'donor' && movableQuota > 0);
      const searchableText = normalizeSearchText(`${row.family || ''} ${row.quotaName || ''} ${normalizeSkuList(row.skuList).join(' ')}`);
      const byFamily = !familyTerm || searchableText.includes(familyTerm);
      return bySub && byRegion && byIntent && byFamily;
    });
  }, [candidates, candidateFilters]);

  const subscriptionOptions = useMemo(() => {
    const map = new Map();
    candidates.forEach((candidate) => {
      if (candidate.subscriptionId && !map.has(candidate.subscriptionId)) {
        map.set(candidate.subscriptionId, candidate.subscriptionName || candidate.subscriptionId);
      }
    });
    return [...map.entries()].map(([subscriptionId, subscriptionName]) => ({ subscriptionId, subscriptionName }));
  }, [candidates]);
  const regionOptions = useMemo(() => [...new Set(candidates.map((candidate) => candidate.region).filter(Boolean))].sort(), [candidates]);

  const formatSkuList = (row) => {
    const raw = normalizeSkuList(row?.skuList).join(', ');
    return raw || 'n/a';
  };

  const selectedCandidateLabel = selectedMoveCandidate
    ? `${selectedMoveCandidate.subscriptionName} | ${selectedMoveCandidate.region} | ${selectedMoveCandidate.quotaName} | ${selectedMoveCandidate.mode === 'donor' ? 'Donor' : 'Recipient'}`
    : 'No move target selected';

  return (
    <div className="rx-view-stack">
      <Banner tone={status.tone} message={status.message} />
      <section className="rx-panel">
        <div className="rx-panel__header"><div><h2>Quota Discovery Scope</h2><p>Choose the management group and quota group that drive the downstream quota workflows.</p></div></div>
        <div className="rx-field-grid">
          <label className="rx-field"><span>Management Group</span><select value={selectedManagementGroup} onChange={(event) => onManagementGroupChange(event.target.value)}>{managementGroups.map((group) => <option key={group.id} value={group.id}>{group.displayName} ({group.id})</option>)}</select></label>
          <label className="rx-field"><span>Quota Group</span><select value={selectedQuotaGroup} onChange={(event) => onQuotaGroupChange(event.target.value)}><option value="all">Select quota group</option>{quotaGroups.map((group) => <option key={group.groupQuotaName} value={group.groupQuotaName}>{group.groupQuotaName}</option>)}</select></label>
        </div>
      </section>
      <section className="rx-action-grid">
        <button className="rx-card rx-card--clickable" type="button" onClick={actions.discover} disabled={busy.discover}><div className="rx-card__body"><h3>Discover Quota Groups</h3><p>Refresh the available GroupQuota resources in the selected management group.</p></div><span>{busy.discover ? 'Working...' : 'Discover'}</span></button>
        <button className="rx-card rx-card--clickable rx-card--accent" type="button" onClick={actions.generate} disabled={busy.generate || selectedQuotaGroup === 'all'}><div className="rx-card__body"><h3>Generate Candidates</h3><p>Analyze current allocation and identify movable quota rows.</p></div><span>{busy.generate ? 'Working...' : 'Generate'}</span></button>
        <button className="rx-card rx-card--clickable" type="button" onClick={actions.capture} disabled={busy.capture || selectedQuotaGroup === 'all'}><div className="rx-card__body"><h3>Capture Quota History</h3><p>Persist current candidate state for run history and trend analysis.</p></div><span>{busy.capture ? 'Working...' : 'Capture'}</span></button>
        <button className="rx-card rx-card--clickable" type="button" onClick={actions.refresh} disabled={busy.refresh}><div className="rx-card__body"><h3>Refresh Analytics</h3><p>Reload discovered groups, captured runs, and filtered candidate data.</p></div><span>{busy.refresh ? 'Working...' : 'Refresh'}</span></button>
      </section>
      <section className="rx-panel">
        <div className="rx-panel__header"><div><h2>Candidate Filters</h2><p>Apply secondary refinements after generating candidate rows.</p></div></div>
        <div className="rx-field-grid rx-field-grid--filters">
          <label className="rx-field"><span>Subscription</span><select value={candidateFilters.subscriptionId} onChange={(event) => setCandidateFilters({ ...candidateFilters, subscriptionId: event.target.value })}><option value="all">All Subscriptions</option>{subscriptionOptions.map((option) => <option key={option.subscriptionId} value={option.subscriptionId}>{option.subscriptionName} ({option.subscriptionId})</option>)}</select></label>
          <label className="rx-field"><span>Region</span><select value={candidateFilters.region} onChange={(event) => setCandidateFilters({ ...candidateFilters, region: event.target.value })}><option value="all">All Regions</option>{regionOptions.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
          <label className="rx-field"><span>Intent</span><select value={candidateFilters.intent} onChange={(event) => setCandidateFilters({ ...candidateFilters, intent: event.target.value })}><option value="all">All rows</option><option value="donor">Can donate</option><option value="need">Needs quota</option></select></label>
          <label className="rx-field rx-field--wide"><span>SKU / Family</span><input className="rx-input" value={candidateFilters.family} onChange={(event) => setCandidateFilters({ ...candidateFilters, family: event.target.value })} placeholder="Search family or quota name" /></label>
          <button className="rx-button rx-button--secondary" type="button" onClick={() => setCandidateFilters({ subscriptionId: 'all', region: 'all', family: '', intent: 'all' })}>Clear</button>
        </div>
        <div className="rx-inline-actions">
          <span className="rx-selected-count">Filtered candidates: {formatNumber(filteredCandidates.length)}</span>
          <span className="rx-selected-count">Move target: {selectedCandidateLabel}</span>
          <button className="rx-button rx-button--secondary" type="button" onClick={onOpenMovePlanner} disabled={!selectedMoveCandidate}>Open Move Planner</button>
        </div>
      </section>
      <DataTable title="Discovered Quota Groups" columns={[{ key: 'managementGroupId', label: 'Management Group' }, { key: 'groupQuotaName', label: 'Quota Group' }, { key: 'displayName', label: 'Display Name' }, { key: 'groupType', label: 'Group Type' }, { key: 'provisioningState', label: 'Provisioning State' }, { key: 'subscriptionCount', label: 'Subscriptions', render: (row) => formatNumber(row.subscriptionCount) }]} rows={quotaGroups} emptyMessage="No quota groups discovered yet." />
      <DataTable title="Quota Candidates" subtitle="Use the first column to pick a donor or recipient row for quota movement." columns={[{ key: 'moveAction', label: 'Select', render: (row) => { const recipientNeed = getQuotaRecipientNeed(row); const movableQuota = Number(row.movableQuota || row.suggestedMovable || 0); const disabled = recipientNeed <= 0 && movableQuota <= 0; const isSelected = selectedMoveCandidate && selectedMoveCandidate.subscriptionId === row.subscriptionId && selectedMoveCandidate.region === row.region && selectedMoveCandidate.quotaName === (row.family || row.quotaName); const buttonLabel = disabled ? 'No Action' : (isSelected ? 'Selected' : (movableQuota > 0 ? 'Pick Donor' : 'Pick Need')); return <button className="rx-button rx-button--secondary" type="button" disabled={disabled} onClick={() => onSelectMoveCandidate(row)}>{buttonLabel}</button>; } }, { key: 'subscriptionName', label: 'Subscription', render: (row) => row.subscriptionName || row.subscriptionId || 'n/a' }, { key: 'region', label: 'Region' }, { key: 'family', label: 'Family' }, { key: 'skuList', label: 'SKUs', render: (row) => formatSkuList(row) }, { key: 'skuCount', label: 'SKU Count', render: (row) => formatNumber(row.skuCount || 0) }, { key: 'availability', label: 'Availability', render: (row) => <StatusPill value={row.availability} /> }, { key: 'quotaCurrent', label: 'Current', render: (row) => formatNumber(row.quotaCurrent) }, { key: 'quotaLimit', label: 'Limit', render: (row) => formatNumber(row.quotaLimit) }, { key: 'quotaAvailable', label: 'Available', render: (row) => formatNumber(row.quotaAvailable) }, { key: 'recipientNeed', label: 'Need', render: (row) => formatNumber(getQuotaRecipientNeed(row)) }, { key: 'movableQuota', label: 'Movable', render: (row) => formatNumber(row.movableQuota || row.suggestedMovable) }, { key: 'status', label: 'Status', render: (row) => <StatusPill value={row.status || row.candidateStatus} /> }]} rows={filteredCandidates} emptyMessage="Generate candidates to populate this table." />
      <DataTable title="Captured Runs" columns={[{ key: 'analysisRunId', label: 'Run ID' }, { key: 'capturedAtUtc', label: 'Captured At' }, { key: 'rowCount', label: 'Rows', render: (row) => formatNumber(row.rowCount || row.candidateCount || 0) }, { key: 'subscriptionCount', label: 'Subscriptions', render: (row) => formatNumber(row.subscriptionCount || 0) }, { key: 'movableCandidateCount', label: 'Movable Rows', render: (row) => formatNumber(row.movableCandidateCount || 0) }]} rows={quotaRuns} emptyMessage="No captured runs yet." />
    </div>
  );
}

function QuotaMovementView(props) {
  const {
    selectedManagementGroup,
    selectedQuotaGroup,
    quotaRuns,
    selectedAnalysisRunId,
    donorOptions,
    selectedDonorSubscriptionId,
    selectedMoveCandidate,
    onSelectedSkuChange,
    requestedTransferAmount,
    onRequestedTransferAmountChange,
    onAnalysisRunChange,
    onDonorSubscriptionChange,
    planRows,
    impactRows,
    applyResults,
    summary,
    actions,
    busy,
    status
  } = props;

  const selectedRun = useMemo(() => quotaRuns.find((run) => run.analysisRunId === selectedAnalysisRunId) || null, [quotaRuns, selectedAnalysisRunId]);
  const formatSkuList = (row) => String(row?.skuList || '').trim() || 'n/a';
  const selectedSkuOptions = useMemo(() => normalizeSkuList(selectedMoveCandidate?.skuList || []), [selectedMoveCandidate]);
  const moveTargetNeed = getQuotaRecipientNeed(selectedMoveCandidate);
  const moveBasisValue = selectedMoveCandidate?.mode === 'donor'
    ? Number(selectedMoveCandidate?.movableQuota || 0)
    : moveTargetNeed;
  const effectiveDonorSubscriptionId = selectedMoveCandidate?.mode === 'donor'
    ? selectedMoveCandidate?.donorSubscriptionId
    : selectedDonorSubscriptionId;
  const movePlannerReady = Boolean(selectedMoveCandidate && selectedAnalysisRunId && effectiveDonorSubscriptionId && selectedQuotaGroup !== 'all' && Number(requestedTransferAmount || 0) > 0);
  const needsRunSelection = !selectedAnalysisRunId;
  const needsPlanBuild = Boolean(selectedAnalysisRunId && movePlannerReady && !planRows.length);
  const canSimulate = Boolean(movePlannerReady && planRows.length);
  const canApply = Boolean(movePlannerReady && planRows.length && impactRows.length);
  const step3Active = Boolean((busy.simulate || canSimulate) && !canApply && !busy.apply);
  const step4Active = Boolean(busy.apply || canApply || applyResults.length);
  const donorHelpText = !selectedMoveCandidate
    ? 'Pick a recipient in Quota Discovery first.'
    : selectedMoveCandidate.mode === 'donor'
      ? 'This move is scoped from the selected donor row into the group quota pool.'
    : (donorOptions.length > 0
      ? `${formatNumber(donorOptions.length)} donor subscription(s) available for this region and quota family.`
      : 'No donor subscriptions found for the selected region and quota family in the current candidate set.');

  return (
    <div className="rx-view-stack">
      <Banner tone={status.tone} message={status.message} />
      <section className="rx-panel">
        <div className="rx-panel__header"><div><h2>Quota Move Planner</h2><p>Build and simulate candidate moves from previously captured quota snapshots.</p></div></div>
        <div className="rx-field-grid">
          <label className="rx-field"><span>Management Group</span><input className="rx-input" value={selectedManagementGroup || 'No management group selected'} readOnly /></label>
          <label className="rx-field"><span>Quota Group</span><input className="rx-input" value={selectedQuotaGroup === 'all' ? 'Select a quota group in Quota Discovery' : selectedQuotaGroup} readOnly /></label>
          <label className="rx-field rx-field--wide"><span>Captured Run</span><select value={selectedAnalysisRunId} onChange={(event) => onAnalysisRunChange(event.target.value)} disabled={!quotaRuns.length}><option value="">Select captured run</option>{quotaRuns.map((run) => <option key={run.analysisRunId} value={run.analysisRunId}>{run.capturedAtUtc || run.analysisRunId} ({formatNumber(run.rowCount || run.candidateCount || 0)} rows)</option>)}</select></label>
          <label className="rx-field rx-field--wide"><span>Selected Scope</span><input className="rx-input" value={selectedMoveCandidate ? `${selectedMoveCandidate.subscriptionName} | ${selectedMoveCandidate.region} | ${selectedMoveCandidate.quotaName} | ${selectedMoveCandidate.mode === 'donor' ? 'Donor' : 'Recipient'}` : 'Pick a quota row in Quota Discovery'} readOnly /></label>
          <label className="rx-field"><span>{selectedMoveCandidate?.mode === 'donor' ? 'Movable Quota' : 'Recipient Need'}</span><input className="rx-input" value={selectedMoveCandidate ? formatNumber(moveBasisValue) : '0'} readOnly /></label>
          <label className="rx-field"><span>SKU In Scope</span><select value={selectedMoveCandidate?.selectedSku || ''} onChange={(event) => onSelectedSkuChange(event.target.value)} disabled={!selectedMoveCandidate || !selectedSkuOptions.length}><option value="">Any SKU in family</option>{selectedSkuOptions.map((sku) => <option key={sku} value={sku}>{sku}</option>)}</select></label>
          <label className="rx-field"><span>Cores To Move</span><input className="rx-input" type="number" min="1" step="1" value={requestedTransferAmount} onChange={(event) => onRequestedTransferAmountChange(event.target.value)} disabled={!selectedMoveCandidate} /></label>
          <label className="rx-field rx-field--wide"><span>Donor Subscription</span><select value={effectiveDonorSubscriptionId || ''} onChange={(event) => onDonorSubscriptionChange(event.target.value)} disabled={selectedMoveCandidate?.mode === 'donor' || !donorOptions.length}><option value="">Select donor subscription</option>{donorOptions.map((option) => <option key={option.subscriptionId} value={option.subscriptionId}>{option.subscriptionName} ({formatNumber(option.suggestedMovable)} movable)</option>)}</select></label>
        </div>
        <div className="rx-inline-actions">
          <button className={classNames('rx-button', needsRunSelection ? '' : 'rx-button--secondary')} type="button" onClick={actions.refreshRuns} disabled={busy.refreshRuns || selectedQuotaGroup === 'all'}>{busy.refreshRuns ? 'Loading Runs...' : 'Step 1: Load Captured Runs'}</button>
          <button className={classNames('rx-button', needsPlanBuild ? '' : 'rx-button--secondary')} type="button" onClick={actions.buildPlan} disabled={busy.plan || !movePlannerReady}>{busy.plan ? 'Building Plan...' : 'Step 2: Build Move Plan'}</button>
          <button className={classNames('rx-button', step3Active ? '' : 'rx-button--secondary')} type="button" onClick={actions.simulatePlan} disabled={busy.simulate || !movePlannerReady || !planRows.length}>{busy.simulate ? 'Simulating...' : 'Step 3: Simulate Impact'}</button>
          <button className={classNames('rx-button', step4Active ? '' : 'rx-button--secondary')} type="button" onClick={actions.applyPlan} disabled={busy.apply || !canApply}>{busy.apply ? 'Applying...' : 'Step 4: Apply Move'}</button>
          {selectedRun ? <span className="rx-selected-count">Selected run captured {selectedRun.capturedAtUtc || 'n/a'}</span> : null}
          {selectedMoveCandidate?.selectedSku ? <span className="rx-selected-count">Scoped SKU: {selectedMoveCandidate.selectedSku}</span> : <span className="rx-selected-count">Scoped SKU: Any in quota family</span>}
          <span className="rx-selected-count">{donorHelpText}</span>
        </div>
      </section>
      <DataTable title="Planned Quota Moves" columns={[{ key: 'region', label: 'Region' }, { key: 'quotaName', label: 'Quota Family' }, { key: 'selectedSku', label: 'Selected SKU', render: (row) => row.selectedSku || 'n/a' }, { key: 'skuList', label: 'SKUs In Scope', render: (row) => formatSkuList(row) }, { key: 'donorSubscriptionName', label: 'Donor' }, { key: 'recipientSubscriptionName', label: 'Recipient' }, { key: 'transferAmount', label: 'Transfer', render: (row) => formatNumber(row.transferAmount) }, { key: 'donorAvailableBefore', label: 'Donor Before', render: (row) => formatNumber(row.donorAvailableBefore) }, { key: 'donorRemainingMovable', label: 'Donor Left', render: (row) => formatNumber(row.donorRemainingMovable) }, { key: 'recipientNeededQuota', label: 'Recipient Need', render: (row) => formatNumber(row.recipientNeededQuota) }, { key: 'recipientRemainingNeed', label: 'Need Left', render: (row) => formatNumber(row.recipientRemainingNeed) }, { key: 'recipientAvailabilityState', label: 'Recipient State', render: (row) => <StatusPill value={row.recipientAvailabilityState} /> }]} rows={planRows} emptyMessage="Pick a recipient in Quota Discovery, then build a scoped move plan here." />
      <DataTable title="Simulation Impact" columns={[{ key: 'role', label: 'Role' }, { key: 'subscriptionName', label: 'Subscription' }, { key: 'region', label: 'Region' }, { key: 'quotaName', label: 'Quota Family' }, { key: 'skuList', label: 'SKUs In Scope', render: (row) => formatSkuList(row) }, { key: 'delta', label: 'Delta', render: (row) => formatNumber(row.delta) }, { key: 'quotaAvailableBefore', label: 'Before', render: (row) => formatNumber(row.quotaAvailableBefore) }, { key: 'quotaAvailableAfter', label: 'After', render: (row) => formatNumber(row.quotaAvailableAfter) }, { key: 'gapBefore', label: 'Gap Before', render: (row) => formatNumber(row.gapBefore) }, { key: 'gapAfter', label: 'Gap After', render: (row) => formatNumber(row.gapAfter) }, { key: 'projectedState', label: 'Projected', render: (row) => <StatusPill value={row.projectedState} /> }]} rows={impactRows} emptyMessage="Run simulation after building a plan to see recipient and donor impacts." />
      <DataTable title="Apply Results" columns={[{ key: 'subscriptionId', label: 'Subscription Id' }, { key: 'region', label: 'Region' }, { key: 'quotaName', label: 'Quota Family' }, { key: 'rowsSubmitted', label: 'Rows', render: (row) => formatNumber(row.rowsSubmitted) }, { key: 'requestedCores', label: 'Requested Cores', render: (row) => formatNumber(row.requestedCores) }, { key: 'status', label: 'Status', render: (row) => <StatusPill value={row.status} /> }, { key: 'error', label: 'Error' }]} rows={applyResults} emptyMessage="Apply results will appear here after Step 4 completes." />
      <section className="rx-panel rx-panel--compact rx-panel--muted">
        <div className="rx-panel__header"><div><h2>Plan Summary</h2><p>High-level movement totals from the selected captured run.</p></div></div>
        <div className="rx-summary-grid">
          <article className="rx-metric-card"><span>Planned Moves</span><strong>{formatNumber(summary.planRowCount || 0)}</strong></article>
          <article className="rx-metric-card"><span>Total Planned Quota</span><strong>{formatNumber(summary.totalPlannedQuota || 0)}</strong></article>
          <article className="rx-metric-card"><span>Unresolved Recipients</span><strong>{formatNumber(summary.unresolvedRecipientCount || 0)}</strong></article>
          <article className="rx-metric-card"><span>Resolved Recipients</span><strong>{formatNumber(summary.recipientResolvedCount || 0)}</strong></article>
          <article className="rx-metric-card"><span>At-Risk Donors</span><strong>{formatNumber(summary.atRiskDonorCount || 0)}</strong></article>
          <article className="rx-metric-card"><span>Impacted Rows</span><strong>{formatNumber(summary.impactedRowCount || 0)}</strong></article>
          <article className="rx-metric-card"><span>Submitted Changes</span><strong>{formatNumber(summary.submittedChangeCount || 0)}</strong></article>
          <article className="rx-metric-card"><span>Apply Failures</span><strong>{formatNumber(summary.failureCount || 0)}</strong></article>
        </div>
      </section>
    </div>
  );
}

function QuotaWorkbenchView(props) {
  const {
    managementGroups,
    selectedManagementGroup,
    onManagementGroupChange,
    quotaGroups,
    selectedQuotaGroup,
    onQuotaGroupChange,
    shareableReport,
    candidates,
    candidateFilters,
    setCandidateFilters,
    selectedMoveCandidate,
    onSelectMoveCandidate,
    quotaRuns,
    selectedAnalysisRunId,
    donorOptions,
    selectedDonorSubscriptionId,
    onSelectedSkuChange,
    requestedTransferAmount,
    onRequestedTransferAmountChange,
    onAnalysisRunChange,
    onDonorSubscriptionChange,
    planRows,
    impactRows,
    applyResults,
    summary,
    actions,
    busy,
    status
  } = props;

  const steps = [
    { key: 'scope', number: 1, label: 'Scope', description: 'Pick management and quota scope.' },
    { key: 'discover', number: 2, label: 'Discover', description: 'Generate and filter candidate rows.' },
    { key: 'plan', number: 3, label: 'Plan', description: 'Choose the move details.' },
    { key: 'simulate', number: 4, label: 'Simulate', description: 'Build and validate the move.' },
    { key: 'apply', number: 5, label: 'Apply', description: 'Execute and review results.' }
  ];
  const [activeStep, setActiveStep] = useState('scope');

  const filteredCandidates = useMemo(() => {
    const familyTerm = normalizeSearchText(candidateFilters.family || '');
    return candidates.filter((row) => {
      const recipientNeed = getQuotaRecipientNeed(row);
      const movableQuota = Number(row.movableQuota || row.suggestedMovable || 0);
      const bySub = candidateFilters.subscriptionId === 'all' || row.subscriptionId === candidateFilters.subscriptionId;
      const byRegion = candidateFilters.region === 'all' || row.region === candidateFilters.region;
      const byIntent = candidateFilters.intent === 'all'
        || (candidateFilters.intent === 'need' && recipientNeed > 0)
        || (candidateFilters.intent === 'donor' && movableQuota > 0);
      const searchableText = normalizeSearchText(`${row.family || ''} ${row.quotaName || ''} ${normalizeSkuList(row.skuList).join(' ')}`);
      const byFamily = !familyTerm || searchableText.includes(familyTerm);
      return bySub && byRegion && byIntent && byFamily;
    });
  }, [candidates, candidateFilters]);

  const subscriptionOptions = useMemo(() => {
    const map = new Map();
    candidates.forEach((candidate) => {
      if (candidate.subscriptionId && !map.has(candidate.subscriptionId)) {
        map.set(candidate.subscriptionId, candidate.subscriptionName || candidate.subscriptionId);
      }
    });
    return [...map.entries()].map(([subscriptionId, subscriptionName]) => ({ subscriptionId, subscriptionName }));
  }, [candidates]);

  const regionOptions = useMemo(() => [...new Set(candidates.map((candidate) => candidate.region).filter(Boolean))].sort(), [candidates]);
  const selectedRun = useMemo(() => quotaRuns.find((run) => run.analysisRunId === selectedAnalysisRunId) || null, [quotaRuns, selectedAnalysisRunId]);
  const selectedSkuOptions = useMemo(() => normalizeSkuList(selectedMoveCandidate?.skuList || []), [selectedMoveCandidate]);
  const moveTargetNeed = getQuotaRecipientNeed(selectedMoveCandidate);
  const moveBasisValue = selectedMoveCandidate?.mode === 'donor'
    ? Number(selectedMoveCandidate?.movableQuota || 0)
    : moveTargetNeed;
  const effectiveDonorSubscriptionId = selectedMoveCandidate?.mode === 'donor'
    ? selectedMoveCandidate?.donorSubscriptionId
    : selectedDonorSubscriptionId;
  const movePlannerReady = Boolean(selectedMoveCandidate && selectedAnalysisRunId && effectiveDonorSubscriptionId && selectedQuotaGroup !== 'all' && Number(requestedTransferAmount || 0) > 0);
  const formatSkuList = (row) => {
    const raw = normalizeSkuList(row?.skuList).join(', ');
    return raw || 'n/a';
  };
  const selectedCandidateLabel = selectedMoveCandidate
    ? `${selectedMoveCandidate.subscriptionName} | ${selectedMoveCandidate.region} | ${selectedMoveCandidate.quotaName} | ${selectedMoveCandidate.mode === 'donor' ? 'Donor' : 'Recipient'}`
    : 'No quota row selected yet';
  const donorHelpText = !selectedMoveCandidate
    ? 'Select a donor or recipient row in Step 2.'
    : selectedMoveCandidate.mode === 'donor'
      ? 'This move starts from the selected donor row into the group quota pool.'
      : (donorOptions.length > 0
        ? `${formatNumber(donorOptions.length)} donor subscription(s) available for this region and quota family.`
        : 'No donor subscriptions found for the selected region and quota family in the current candidate set.');
  const stepStatus = {
    scope: Boolean(selectedManagementGroup && selectedQuotaGroup !== 'all'),
    discover: candidates.length > 0,
    plan: Boolean(selectedMoveCandidate && selectedAnalysisRunId && effectiveDonorSubscriptionId && Number(requestedTransferAmount || 0) > 0),
    simulate: Boolean(planRows.length > 0 && impactRows.length > 0),
    apply: Boolean(applyResults.length > 0)
  };
  const managementGroupOptions = useMemo(() => {
    if (Array.isArray(managementGroups) && managementGroups.length > 0) {
      return managementGroups;
    }

    if (selectedManagementGroup) {
      return [{
        id: selectedManagementGroup,
        displayName: selectedManagementGroup,
        tenantId: null
      }];
    }

    return [];
  }, [managementGroups, selectedManagementGroup]);
  const shareableRows = Array.isArray(shareableReport?.rows) ? shareableReport.rows : [];
  const shareableSummary = shareableReport?.summary || { rowCount: 0, subscriptionCount: 0, regionCount: 0, skuCount: 0, totalShareableQuota: 0, totalAllocatedQuota: 0 };
  const shareableSubtitle = shareableReport?.generatedAtUtc
    ? `Only rows with a quota deficit are shown. Values are absolute deficit magnitudes. Generated ${formatTimestamp(shareableReport.generatedAtUtc)}.`
    : 'Only rows with a quota deficit are shown. Values are absolute deficit magnitudes. This report is read-only.';

  useEffect(() => {
    if (selectedMoveCandidate && activeStep === 'discover') {
      setActiveStep('plan');
    }
  }, [selectedMoveCandidate, activeStep]);

  return (
    <div className="rx-view-stack">
      <Banner tone={status.tone} message={status.message} />
      <section className="rx-panel rx-panel--compact rx-panel--muted">
        <div className="rx-panel__header"><div><h2>Quota Workbench</h2><p>Discovery, planning, simulation, and execution now run in one admin workspace instead of separate pages.</p></div></div>
        <div className="rx-stepper" role="tablist" aria-label="Quota workflow steps">
          {steps.map((step) => (
            <button
              key={step.key}
              className={classNames('rx-step-chip', activeStep === step.key && 'is-active', stepStatus[step.key] && 'is-complete')}
              type="button"
              onClick={() => setActiveStep(step.key)}
            >
              <span className="rx-step-chip__number">Step {step.number}</span>
              <strong>{step.label}</strong>
              <small>{step.description}</small>
            </button>
          ))}
        </div>
      </section>

      <section className={classNames('rx-panel', 'rx-step-panel', activeStep === 'scope' && 'rx-step-panel--active')}>
        <div className="rx-panel__header"><div><h2>Step 1: Scope</h2><p>Set the management group and quota group that all later steps will use.</p></div></div>
        <div className="rx-field-grid">
          <label className="rx-field"><span>Management Group</span><select value={selectedManagementGroup} onChange={(event) => onManagementGroupChange(event.target.value)}><option value="" disabled>{managementGroupOptions.length ? 'Select management group' : 'No management groups available'}</option>{managementGroupOptions.map((group) => <option key={group.id} value={group.id}>{group.displayName} ({group.id})</option>)}</select></label>
          <label className="rx-field"><span>Quota Group</span><select value={selectedQuotaGroup} onChange={(event) => onQuotaGroupChange(event.target.value)}><option value="all">Select quota group</option>{quotaGroups.map((group) => <option key={group.groupQuotaName} value={group.groupQuotaName}>{group.groupQuotaName}</option>)}</select></label>
        </div>
        <div className="rx-inline-actions">
          <button className="rx-button" type="button" onClick={actions.discover} disabled={busy.discover}>{busy.discover ? 'Discovering...' : 'Discover Quota Groups'}</button>
          <button className="rx-button rx-button--secondary" type="button" onClick={actions.loadShareableReport} disabled={busy.shareableReport || selectedQuotaGroup === 'all'}>{busy.shareableReport ? 'Loading Report...' : 'Load Quota Report'}</button>
          <button className="rx-button rx-button--secondary" type="button" onClick={actions.refresh} disabled={busy.refresh}>{busy.refresh ? 'Refreshing...' : 'Refresh Workspace'}</button>
          <span className="rx-selected-count">Selected quota group: {selectedQuotaGroup === 'all' ? 'None' : selectedQuotaGroup}</span>
          <button className="rx-chip-button" type="button" onClick={() => setActiveStep('discover')} disabled={selectedQuotaGroup === 'all'}>Continue to Step 2</button>
        </div>
      </section>

      <section className={classNames('rx-panel', 'rx-step-panel', activeStep === 'discover' && 'rx-step-panel--active')}>
        <div className="rx-panel__header"><div><h2>Step 2: Discover Candidates</h2><p>Generate candidate rows, capture history, and select the donor or recipient row that drives the move.</p></div></div>
        <div className="rx-inline-actions">
          <button className="rx-button" type="button" onClick={actions.generate} disabled={busy.generate || selectedQuotaGroup === 'all'}>{busy.generate ? 'Generating...' : 'Generate Candidates'}</button>
          <button className="rx-button rx-button--secondary" type="button" onClick={actions.capture} disabled={busy.capture || selectedQuotaGroup === 'all'}>{busy.capture ? 'Capturing...' : 'Capture Quota History'}</button>
          <span className="rx-selected-count">Candidate rows: {formatNumber(filteredCandidates.length)}</span>
          <span className="rx-selected-count">Selected row: {selectedCandidateLabel}</span>
        </div>
        <div className="rx-field-grid rx-field-grid--filters">
          <label className="rx-field"><span>Subscription</span><select value={candidateFilters.subscriptionId} onChange={(event) => setCandidateFilters({ ...candidateFilters, subscriptionId: event.target.value })}><option value="all">All Subscriptions</option>{subscriptionOptions.map((option) => <option key={option.subscriptionId} value={option.subscriptionId}>{option.subscriptionName} ({option.subscriptionId})</option>)}</select></label>
          <label className="rx-field"><span>Region</span><select value={candidateFilters.region} onChange={(event) => setCandidateFilters({ ...candidateFilters, region: event.target.value })}><option value="all">All Regions</option>{regionOptions.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
          <label className="rx-field"><span>Intent</span><select value={candidateFilters.intent} onChange={(event) => setCandidateFilters({ ...candidateFilters, intent: event.target.value })}><option value="all">All rows</option><option value="donor">Can donate</option><option value="need">Needs quota</option></select></label>
          <label className="rx-field rx-field--wide"><span>SKU / Family</span><input className="rx-input" value={candidateFilters.family} onChange={(event) => setCandidateFilters({ ...candidateFilters, family: event.target.value })} placeholder="Search family or quota name" /></label>
          <button className="rx-button rx-button--secondary" type="button" onClick={() => setCandidateFilters({ subscriptionId: 'all', region: 'all', family: '', intent: 'all' })}>Clear</button>
        </div>
        <DataTable title="Discovered Quota Groups" columns={[{ key: 'managementGroupId', label: 'Management Group' }, { key: 'groupQuotaName', label: 'Quota Group' }, { key: 'displayName', label: 'Display Name' }, { key: 'groupType', label: 'Group Type' }, { key: 'provisioningState', label: 'Provisioning State' }, { key: 'subscriptionCount', label: 'Subscriptions', render: (row) => formatNumber(row.subscriptionCount) }]} rows={quotaGroups} emptyMessage="No quota groups discovered yet." />
        <section className="rx-panel rx-panel--compact rx-panel--muted">
          <div className="rx-panel__header"><div><h2>Quota Allocation Report</h2><p>Read-only visibility into quota allocation deficits for the selected quota group.</p></div></div>
          <div className="rx-summary-grid">
            <article className="rx-metric-card"><span>Deficit Rows</span><strong>{formatNumber(shareableSummary.rowCount || 0)}</strong></article>
            <article className="rx-metric-card"><span>Subscriptions</span><strong>{formatNumber(shareableSummary.subscriptionCount || 0)}</strong></article>
            <article className="rx-metric-card"><span>Regions</span><strong>{formatNumber(shareableSummary.regionCount || 0)}</strong></article>
            <article className="rx-metric-card"><span>SKUs</span><strong>{formatNumber(shareableSummary.skuCount || 0)}</strong></article>
            <article className="rx-metric-card"><span>Total Allocated</span><strong>{formatNumber(shareableSummary.totalAllocatedQuota || 0)}</strong></article>
            <article className="rx-metric-card"><span>Total Required</span><strong>{formatNumber(shareableSummary.totalShareableQuota || 0)}</strong></article>
          </div>
        </section>
        <DataTable title="Quota Allocation Report" subtitle={shareableSubtitle} columns={[{ key: 'subscriptionId', label: 'Subscription Id' }, { key: 'region', label: 'Region' }, { key: 'displayName', label: 'Quota SKU / Family', render: (row) => row.displayName || row.resourceName || 'n/a' }, { key: 'resourceName', label: 'Resource Name', render: (row) => row.resourceName || 'n/a' }, { key: 'shareableQuota', label: 'Quota Group', render: (row) => formatNumber(row.shareableQuota) }, { key: 'quotaLimit', label: 'Assigned Quota', render: (row) => formatNullableNumber(row.quotaLimit) }]} rows={shareableRows} pageSize={50} emptyMessage={selectedQuotaGroup === 'all' ? 'Select a quota group and load the quota report.' : 'No quota deficit rows were returned for the selected quota group.'} />
        <DataTable title="Quota Candidates" subtitle="Pick a donor or recipient row to move into the planning steps." columns={[{ key: 'moveAction', label: 'Select', render: (row) => { const recipientNeed = getQuotaRecipientNeed(row); const movableQuota = Number(row.movableQuota || row.suggestedMovable || 0); const disabled = recipientNeed <= 0 && movableQuota <= 0; const isSelected = selectedMoveCandidate && selectedMoveCandidate.subscriptionId === row.subscriptionId && selectedMoveCandidate.region === row.region && selectedMoveCandidate.quotaName === (row.family || row.quotaName); const buttonLabel = disabled ? 'No Action' : (isSelected ? 'Selected' : (movableQuota > 0 ? 'Pick Donor' : 'Pick Need')); return <button className="rx-button rx-button--secondary" type="button" disabled={disabled} onClick={() => onSelectMoveCandidate(row)}>{buttonLabel}</button>; } }, { key: 'subscriptionName', label: 'Subscription', render: (row) => row.subscriptionName || row.subscriptionId || 'n/a' }, { key: 'region', label: 'Region' }, { key: 'family', label: 'Family' }, { key: 'skuList', label: 'SKUs', render: (row) => formatSkuList(row) }, { key: 'skuCount', label: 'SKU Count', render: (row) => formatNumber(row.skuCount || 0) }, { key: 'availability', label: 'Availability', render: (row) => <StatusPill value={row.availability} /> }, { key: 'quotaCurrent', label: 'Current', render: (row) => formatNumber(row.quotaCurrent) }, { key: 'quotaLimit', label: 'Limit', render: (row) => formatNumber(row.quotaLimit) }, { key: 'quotaAvailable', label: 'Available', render: (row) => formatNumber(row.quotaAvailable) }, { key: 'recipientNeed', label: 'Need', render: (row) => formatNumber(getQuotaRecipientNeed(row)) }, { key: 'movableQuota', label: 'Movable', render: (row) => formatNumber(row.movableQuota || row.suggestedMovable) }, { key: 'status', label: 'Status', render: (row) => <StatusPill value={row.status || row.candidateStatus} /> }]} rows={filteredCandidates} emptyMessage="Generate candidates to populate this table." />
      </section>

      <section className={classNames('rx-panel', 'rx-step-panel', activeStep === 'plan' && 'rx-step-panel--active')}>
        <div className="rx-panel__header"><div><h2>Step 3: Plan</h2><p>Load a captured run, choose the donor details, and define how much quota to move.</p></div></div>
        <div className="rx-field-grid">
          <label className="rx-field rx-field--wide"><span>Captured Run</span><select value={selectedAnalysisRunId} onChange={(event) => onAnalysisRunChange(event.target.value)} disabled={!quotaRuns.length}><option value="">Select captured run</option>{quotaRuns.map((run) => <option key={run.analysisRunId} value={run.analysisRunId}>{run.capturedAtUtc || run.analysisRunId} ({formatNumber(run.rowCount || run.candidateCount || 0)} rows)</option>)}</select></label>
          <label className="rx-field rx-field--wide"><span>Selected Scope</span><input className="rx-input" value={selectedCandidateLabel} readOnly /></label>
          <label className="rx-field"><span>{selectedMoveCandidate?.mode === 'donor' ? 'Movable Quota' : 'Recipient Need'}</span><input className="rx-input" value={selectedMoveCandidate ? formatNumber(moveBasisValue) : '0'} readOnly /></label>
          <label className="rx-field"><span>SKU In Scope</span><select value={selectedMoveCandidate?.selectedSku || ''} onChange={(event) => onSelectedSkuChange(event.target.value)} disabled={!selectedMoveCandidate || !selectedSkuOptions.length}><option value="">Any SKU in family</option>{selectedSkuOptions.map((sku) => <option key={sku} value={sku}>{sku}</option>)}</select></label>
          <label className="rx-field"><span>Cores To Move</span><input className="rx-input" type="number" min="1" step="1" value={requestedTransferAmount} onChange={(event) => onRequestedTransferAmountChange(event.target.value)} disabled={!selectedMoveCandidate} /></label>
          <label className="rx-field rx-field--wide"><span>Donor Subscription</span><select value={effectiveDonorSubscriptionId || ''} onChange={(event) => onDonorSubscriptionChange(event.target.value)} disabled={selectedMoveCandidate?.mode === 'donor' || !donorOptions.length}><option value="">Select donor subscription</option>{donorOptions.map((option) => <option key={option.subscriptionId} value={option.subscriptionId}>{option.subscriptionName} ({formatNumber(option.suggestedMovable)} movable)</option>)}</select></label>
        </div>
        <div className="rx-inline-actions">
          <button className="rx-button" type="button" onClick={actions.refreshRuns} disabled={busy.refreshRuns || selectedQuotaGroup === 'all'}>{busy.refreshRuns ? 'Loading Runs...' : 'Load Captured Runs'}</button>
          {selectedRun ? <span className="rx-selected-count">Selected run captured {selectedRun.capturedAtUtc || 'n/a'}</span> : null}
          <span className="rx-selected-count">{donorHelpText}</span>
          <button className="rx-chip-button" type="button" onClick={() => setActiveStep('simulate')} disabled={!movePlannerReady}>Continue to Step 4</button>
        </div>
        <DataTable title="Captured Runs" columns={[{ key: 'analysisRunId', label: 'Run ID' }, { key: 'capturedAtUtc', label: 'Captured At' }, { key: 'rowCount', label: 'Rows', render: (row) => formatNumber(row.rowCount || row.candidateCount || 0) }, { key: 'subscriptionCount', label: 'Subscriptions', render: (row) => formatNumber(row.subscriptionCount || 0) }, { key: 'movableCandidateCount', label: 'Movable Rows', render: (row) => formatNumber(row.movableCandidateCount || 0) }]} rows={quotaRuns} emptyMessage="No captured runs yet." />
      </section>

      <section className={classNames('rx-panel', 'rx-step-panel', activeStep === 'simulate' && 'rx-step-panel--active')}>
        <div className="rx-panel__header"><div><h2>Step 4: Simulate</h2><p>Build the move plan first, then simulate impact on donors and recipients before applying anything.</p></div></div>
        <div className="rx-inline-actions">
          <button className="rx-button" type="button" onClick={actions.buildPlan} disabled={busy.plan || !movePlannerReady}>{busy.plan ? 'Building Plan...' : 'Build Move Plan'}</button>
          <button className="rx-button rx-button--secondary" type="button" onClick={actions.simulatePlan} disabled={busy.simulate || !movePlannerReady || !planRows.length}>{busy.simulate ? 'Simulating...' : 'Simulate Impact'}</button>
          <span className="rx-selected-count">Plan rows: {formatNumber(planRows.length)}</span>
          <span className="rx-selected-count">Impacted rows: {formatNumber(impactRows.length)}</span>
          <button className="rx-chip-button" type="button" onClick={() => setActiveStep('apply')} disabled={!impactRows.length}>Continue to Step 5</button>
        </div>
        <DataTable title="Planned Quota Moves" columns={[{ key: 'region', label: 'Region' }, { key: 'quotaName', label: 'Quota Family' }, { key: 'selectedSku', label: 'Selected SKU', render: (row) => row.selectedSku || 'n/a' }, { key: 'skuList', label: 'SKUs In Scope', render: (row) => formatSkuList(row) }, { key: 'donorSubscriptionName', label: 'Donor' }, { key: 'recipientSubscriptionName', label: 'Recipient' }, { key: 'transferAmount', label: 'Transfer', render: (row) => formatNumber(row.transferAmount) }, { key: 'donorAvailableBefore', label: 'Donor Before', render: (row) => formatNumber(row.donorAvailableBefore) }, { key: 'donorRemainingMovable', label: 'Donor Left', render: (row) => formatNumber(row.donorRemainingMovable) }, { key: 'recipientNeededQuota', label: 'Recipient Need', render: (row) => formatNumber(row.recipientNeededQuota) }, { key: 'recipientRemainingNeed', label: 'Need Left', render: (row) => formatNumber(row.recipientRemainingNeed) }, { key: 'recipientAvailabilityState', label: 'Recipient State', render: (row) => <StatusPill value={row.recipientAvailabilityState} /> }]} rows={planRows} emptyMessage="Define the move details in Step 3, then build the move plan here." />
        <DataTable title="Simulation Impact" columns={[{ key: 'role', label: 'Role' }, { key: 'subscriptionName', label: 'Subscription' }, { key: 'region', label: 'Region' }, { key: 'quotaName', label: 'Quota Family' }, { key: 'skuList', label: 'SKUs In Scope', render: (row) => formatSkuList(row) }, { key: 'delta', label: 'Delta', render: (row) => formatNumber(row.delta) }, { key: 'quotaAvailableBefore', label: 'Before', render: (row) => formatNumber(row.quotaAvailableBefore) }, { key: 'quotaAvailableAfter', label: 'After', render: (row) => formatNumber(row.quotaAvailableAfter) }, { key: 'gapBefore', label: 'Gap Before', render: (row) => formatNumber(row.gapBefore) }, { key: 'gapAfter', label: 'Gap After', render: (row) => formatNumber(row.gapAfter) }, { key: 'projectedState', label: 'Projected', render: (row) => <StatusPill value={row.projectedState} /> }]} rows={impactRows} emptyMessage="Run simulation after building a plan to see recipient and donor impacts." />
      </section>

      <section className={classNames('rx-panel', 'rx-step-panel', activeStep === 'apply' && 'rx-step-panel--active')}>
        <div className="rx-panel__header"><div><h2>Step 5: Apply</h2><p>Execute the approved move and review the final result set in one place.</p></div></div>
        <div className="rx-inline-actions">
          <button className="rx-button" type="button" onClick={actions.applyPlan} disabled={busy.apply || !planRows.length || !impactRows.length}>{busy.apply ? 'Applying...' : 'Apply Move'}</button>
          <span className="rx-selected-count">Submitted changes: {formatNumber(summary.submittedChangeCount || 0)}</span>
          <span className="rx-selected-count">Apply failures: {formatNumber(summary.failureCount || 0)}</span>
        </div>
        <DataTable title="Apply Results" columns={[{ key: 'subscriptionId', label: 'Subscription Id' }, { key: 'region', label: 'Region' }, { key: 'quotaName', label: 'Quota Family' }, { key: 'rowsSubmitted', label: 'Rows', render: (row) => formatNumber(row.rowsSubmitted) }, { key: 'requestedCores', label: 'Requested Cores', render: (row) => formatNumber(row.requestedCores) }, { key: 'status', label: 'Status', render: (row) => <StatusPill value={row.status} /> }, { key: 'error', label: 'Error' }]} rows={applyResults} emptyMessage="Apply results will appear here after the move is submitted." />
        <section className="rx-panel rx-panel--compact rx-panel--muted">
          <div className="rx-panel__header"><div><h2>Plan Summary</h2><p>High-level movement totals from the selected captured run.</p></div></div>
          <div className="rx-summary-grid">
            <article className="rx-metric-card"><span>Planned Moves</span><strong>{formatNumber(summary.planRowCount || 0)}</strong></article>
            <article className="rx-metric-card"><span>Total Planned Quota</span><strong>{formatNumber(summary.totalPlannedQuota || 0)}</strong></article>
            <article className="rx-metric-card"><span>Unresolved Recipients</span><strong>{formatNumber(summary.unresolvedRecipientCount || 0)}</strong></article>
            <article className="rx-metric-card"><span>Resolved Recipients</span><strong>{formatNumber(summary.recipientResolvedCount || 0)}</strong></article>
            <article className="rx-metric-card"><span>At-Risk Donors</span><strong>{formatNumber(summary.atRiskDonorCount || 0)}</strong></article>
            <article className="rx-metric-card"><span>Impacted Rows</span><strong>{formatNumber(summary.impactedRowCount || 0)}</strong></article>
            <article className="rx-metric-card"><span>Submitted Changes</span><strong>{formatNumber(summary.submittedChangeCount || 0)}</strong></article>
            <article className="rx-metric-card"><span>Apply Failures</span><strong>{formatNumber(summary.failureCount || 0)}</strong></article>
          </div>
        </section>
      </section>
    </div>
  );
}

function ShareableQuotaReportView(props) {
  const {
    managementGroups,
    selectedManagementGroup,
    onManagementGroupChange,
    quotaGroups,
    selectedQuotaGroup,
    onQuotaGroupChange,
    shareableReport,
    actions,
    busy,
    status
  } = props;

  const managementGroupOptions = useMemo(() => {
    if (Array.isArray(managementGroups) && managementGroups.length > 0) {
      return managementGroups;
    }

    if (selectedManagementGroup) {
      return [{
        id: selectedManagementGroup,
        displayName: selectedManagementGroup,
        tenantId: null
      }];
    }

    return [];
  }, [managementGroups, selectedManagementGroup]);
  const shareableRows = Array.isArray(shareableReport?.rows) ? shareableReport.rows : [];
  const shareableSummary = shareableReport?.summary || { rowCount: 0, subscriptionCount: 0, regionCount: 0, skuCount: 0, totalShareableQuota: 0, totalAllocatedQuota: 0 };
  const shareableSubtitle = shareableReport?.generatedAtUtc
    ? `Only rows with a quota deficit are shown. Values are absolute deficit magnitudes. Generated ${formatTimestamp(shareableReport.generatedAtUtc)}.`
    : 'Only rows with a quota deficit are shown. Values are absolute deficit magnitudes. This report is read-only.';

  return (
    <div className="rx-view-stack">
      <Banner tone={status.tone} message={status.message} />
      <section className="rx-panel">
        <div className="rx-panel__header"><div><h2>Quota Allocation Report</h2><p>Read-only visibility into quota allocation deficits for a selected quota group.</p></div></div>
        <div className="rx-field-grid">
          <label className="rx-field"><span>Management Group</span><select value={selectedManagementGroup} onChange={(event) => onManagementGroupChange(event.target.value)}><option value="" disabled>{managementGroupOptions.length ? 'Select management group' : 'No management groups available'}</option>{managementGroupOptions.map((group) => <option key={group.id} value={group.id}>{group.displayName} ({group.id})</option>)}</select></label>
          <label className="rx-field"><span>Quota Group</span><select value={selectedQuotaGroup} onChange={(event) => onQuotaGroupChange(event.target.value)}><option value="all">Select quota group</option>{quotaGroups.map((group) => <option key={group.groupQuotaName} value={group.groupQuotaName}>{group.groupQuotaName}</option>)}</select></label>
        </div>
        <div className="rx-inline-actions">
          <button className="rx-button" type="button" onClick={actions.discover} disabled={busy.discover}>{busy.discover ? 'Discovering...' : 'Discover Quota Groups'}</button>
          <button className="rx-button rx-button--secondary" type="button" onClick={actions.loadShareableReport} disabled={busy.shareableReport || selectedQuotaGroup === 'all'}>{busy.shareableReport ? 'Loading Report...' : 'Load Quota Report'}</button>
          <button className="rx-button rx-button--secondary" type="button" onClick={actions.refresh} disabled={busy.refresh || selectedQuotaGroup === 'all'}>{busy.refresh ? 'Refreshing...' : 'Refresh Report'}</button>
          <span className="rx-selected-count">Selected quota group: {selectedQuotaGroup === 'all' ? 'None' : selectedQuotaGroup}</span>
        </div>
      </section>
      <DataTable title="Quota Allocation Report" subtitle={shareableSubtitle} columns={[{ key: 'subscriptionId', label: 'Subscription Id' }, { key: 'region', label: 'Region' }, { key: 'displayName', label: 'Quota SKU / Family', render: (row) => row.displayName || row.resourceName || 'n/a' }, { key: 'resourceName', label: 'Resource Name', render: (row) => row.resourceName || 'n/a' }, { key: 'shareableQuota', label: 'Quota Group', render: (row) => formatNumber(row.shareableQuota) }, { key: 'quotaLimit', label: 'Assigned Quota', render: (row) => formatNullableNumber(row.quotaLimit) }]} rows={shareableRows} pageSize={50} emptyMessage={selectedQuotaGroup === 'all' ? 'Select a quota group and load the quota report.' : 'No quota deficit rows were returned for the selected quota group.'} />
    </div>
  );
}

function App() {
  const deploymentEnvironment = useMemo(() => detectDeploymentEnvironment(), []);
  const capacityGridRequestRef = useRef(0);
  const analyticsRequestRef = useRef(0);
  const capacityScoreRequestRef = useRef(0);
  const [auth, setAuth] = useState(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [appStatus, setAppStatus] = useState({ tone: 'info', message: 'Loading React experience...' });
  const [activeView, setActiveView] = useState('capacity-grid');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [subscriptionSearch, setSubscriptionSearch] = useState('');
  const [subscriptionOptions, setSubscriptionOptions] = useState([]);
  const [selectedSubscriptionIds, setSelectedSubscriptionIds] = useState([]);
  const [livePlacementSubscriptionId, setLivePlacementSubscriptionId] = useState('');
  const [livePlacementFamily, setLivePlacementFamily] = useState('');
  const [filters, setFilters] = useState({ regionPreset: 'USMajor', region: 'all', familyBase: 'all', family: 'all', sku: 'all', availability: 'all', resourceType: 'all', provider: 'all' });
  const [capacityData, setCapacityData] = useState({ rows: [], summary: null, facets: { regions: [], families: [], skus: [] }, pagination: { pageNumber: 1, pageSize: 50, total: 0, pageCount: 1, hasNext: false, hasPrev: false } });
  const [allFamilyFacetOptions, setAllFamilyFacetOptions] = useState([]);
  const [computeFamilyCatalogOptions, setComputeFamilyCatalogOptions] = useState([]);
  const [capacityAnalytics, setCapacityAnalytics] = useState({ regionHealth: [], topSkus: [], matrix: { regions: [], rows: [] }, recommendedTargetSku: '', aiQuotaProviderOptions: [] });
  const [trendRows, setTrendRows] = useState([]);
  const [trendGranularity, setTrendGranularity] = useState('daily');
  const [familyRows, setFamilyRows] = useState([]);
  const [capacityScores, setCapacityScores] = useState({ rows: [], pagination: { pageNumber: 1, pageSize: 50, total: 0, pageCount: 1, hasNext: false, hasPrev: false }, subscriptionSummary: [], desiredCount: '1', status: { tone: 'info', message: 'Load or refresh live placement to populate saved capacity score snapshots.', detail: '' }, busy: false });
  const [aiModelState, setAiModelState] = useState({ rows: [], regions: [], loading: false, status: { tone: 'info', message: 'AI model availability report ready.', detail: 'Open the sidebar report to review Azure AI model and provider coverage.' } });
  const [paasState, setPaaSState] = useState({ rows: [], summary: { rowCount: 0, serviceSummary: [], requestedService: 'All', requestedRegionPreset: 'USMajor', requestedRegions: [] }, facets: { services: [], regions: [], categories: [] }, filters: { service: 'All', regionPreset: 'USMajor' }, status: { tone: 'info', message: 'Load cached PaaS availability or refresh to run a live scan.' }, busy: { load: false, refresh: false }, capturedAtUtc: null, metadata: null });
  const [exportBusyFormat, setExportBusyFormat] = useState('');
  const [recommendState, setRecommendState] = useState({ targetSku: '', autoTargetSku: '', regions: '', autoRegions: '', topN: 10, minScore: 50, showPricing: true, showSpot: false, result: null, status: { tone: 'info', message: 'Run the recommender to populate alternatives.' }, busy: false });
  const [aiModelFilters, setAiModelFilters] = useState({ modelName: '', provider: 'all', deploymentType: 'all', fineTuning: 'all', defaultOnly: false });
  const [adminState, setAdminState] = useState({ job: null, status: null, schedule: { ingest: { intervalMinutes: 0, runOnStartup: false }, livePlacement: { intervalMinutes: 0, runOnStartup: false }, aiModelCatalog: { intervalMinutes: 1440 } }, runtime: { ingest: { intervalMinutes: 0, runOnStartup: false }, livePlacement: { intervalMinutes: 0, runOnStartup: false }, aiModelCatalog: { intervalMinutes: 1440 } }, persistence: { available: true, source: 'sql', message: 'SQL scheduler settings are available.' }, statusMessage: { tone: 'info', message: 'Data ingestion tools ready.' }, busy: { refreshStatus: false, trigger: false, refreshModelCatalog: false, refreshSchedule: false, saveSchedule: false } });
  const [quotaState, setQuotaState] = useState({ managementGroups: [], selectedManagementGroup: '', quotaGroups: [], selectedQuotaGroup: 'all', shareableReport: { rows: [], summary: { rowCount: 0, subscriptionCount: 0, regionCount: 0, skuCount: 0, totalShareableQuota: 0 }, generatedAtUtc: null }, candidates: [], quotaRuns: [], selectedAnalysisRunId: '', selectedDonorSubscriptionId: '', selectedMoveCandidate: null, requestedTransferAmount: 0, planRows: [], impactRows: [], applyResults: [], planSummary: {}, candidateFilters: { subscriptionId: 'all', region: 'all', family: '', intent: 'all' }, status: { tone: 'info', message: 'Quota tools ready.' }, busy: { discover: false, shareableReport: false, generate: false, capture: false, refresh: false, refreshRuns: false, plan: false, simulate: false, apply: false } });
  const [showSqlPreview, setShowSqlPreview] = useState(false);
  const [sqlPreviewState, setSqlPreviewState] = useState({ loading: false, error: '', rows: [] });
  const [uiSettingsBusy, setUiSettingsBusy] = useState(false);
  const [selectedExportOption, setSelectedExportOption] = useState('server:xlsx:report');
  const [skuCatalogVersion, setSkuCatalogVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/sku-catalog/families', { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (cancelled || !payload || !payload.families || typeof payload.families !== 'object') {
          return;
        }
        const catalog = window.CAPACITY_SKU_CATALOG;
        if (!catalog || !catalog.familySkus) {
          return;
        }
        const normalize = catalog.normalizeFamilyKey || ((value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ''));
        Object.entries(payload.families).forEach(([family, skus]) => {
          if (!Array.isArray(skus) || skus.length === 0) return;
          const key = normalize(family);
          if (!key) return;
          const merged = new Set(catalog.familySkus[key] || []);
          skus.forEach((sku) => {
            const trimmed = String(sku || '').trim();
            if (trimmed) merged.add(trimmed);
          });
          catalog.familySkus[key] = [...merged].sort();
        });
        setSkuCatalogVersion((value) => value + 1);
      })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, []);

  const queryFilters = useMemo(() => {
    const next = {
      regionPreset: filters.regionPreset,
      region: filters.region,
      familyBase: filters.familyBase,
      family: filters.family,
      sku: filters.sku,
      availability: filters.availability,
      resourceType: filters.resourceType,
      subscriptionIds: selectedSubscriptionIds.join(',')
    };
    if (filters.resourceType === 'AI' && filters.provider && filters.provider !== 'all') {
      next.provider = filters.provider;
    }
    return next;
  }, [filters, selectedSubscriptionIds]);
  const familyCatalogQueryFilters = useMemo(() => {
    const next = {
      regionPreset: filters.regionPreset,
      region: 'all',
      familyBase: 'all',
      family: 'all',
      availability: filters.availability,
      resourceType: filters.resourceType,
      subscriptionIds: selectedSubscriptionIds.join(',')
    };
    if (filters.resourceType === 'AI' && filters.provider && filters.provider !== 'all') {
      next.provider = filters.provider;
    }
    return next;
  }, [filters.availability, filters.provider, filters.regionPreset, filters.resourceType, selectedSubscriptionIds]);
  const computeFamilyCatalogQueryFilters = useMemo(() => ({
    regionPreset: 'all',
    region: 'all',
    family: 'all',
    familyBase: 'all',
    availability: filters.availability,
    subscriptionIds: selectedSubscriptionIds.join(',')
  }), [filters.availability, selectedSubscriptionIds]);
  const fullFamilyOptions = useMemo(() => {
    if (filters.resourceType === 'Compute') {
      if (Array.isArray(computeFamilyCatalogOptions) && computeFamilyCatalogOptions.length > 0) {
        return buildFamilyOptions(computeFamilyCatalogOptions).map((option) => option.value);
      }
    }
    const source = Array.isArray(allFamilyFacetOptions) && allFamilyFacetOptions.length > 0
      ? allFamilyFacetOptions
      : capacityData.facets.families;
    return buildFamilyOptions(source).map((option) => option.value);
  }, [allFamilyFacetOptions, capacityData.facets.families, computeFamilyCatalogOptions, filters.resourceType]);
  const familyBaseOptions = useMemo(() => buildFamilyBaseOptions(fullFamilyOptions), [fullFamilyOptions]);
  const filteredFamilyOptions = useMemo(() => {
    if (!filters.familyBase || filters.familyBase === 'all') {
      return fullFamilyOptions;
    }
    return fullFamilyOptions.filter((family) => extractFamilyBase(family) === filters.familyBase);
  }, [filters.familyBase, fullFamilyOptions]);
  const livePlacementFamilyOptions = useMemo(() => filteredFamilyOptions.length > 0 ? filteredFamilyOptions : fullFamilyOptions, [filteredFamilyOptions, fullFamilyOptions]);
  const scopedSkuOptions = useMemo(() => {
    return (Array.isArray(capacityData.facets.skus) ? capacityData.facets.skus : [])
      .map((sku) => normalizeSkuName(sku))
      .filter((sku) => sku && !isAggregateSkuName(sku))
      .sort((left, right) => compareSkuValues(left, right));
  }, [capacityData.facets.skus]);
  const livePlacementSelectedSubscription = useMemo(() => (
    subscriptionOptions.find((option) => option.subscriptionId === livePlacementSubscriptionId) || null
  ), [livePlacementSubscriptionId, subscriptionOptions]);
  const livePlacementSelectedFamilyLabel = useMemo(() => formatFamilyLabel(livePlacementFamily) || livePlacementFamily || 'n/a', [livePlacementFamily]);
  const canRefreshLivePlacement = Boolean(livePlacementSubscriptionId && livePlacementFamily && livePlacementFamily !== 'all');
  const livePlacementScopeMessage = canRefreshLivePlacement
    ? `Live placement refresh will run only for ${livePlacementSelectedSubscription?.subscriptionName || livePlacementSelectedSubscription?.subscriptionId || selectedSubscriptionIds[0]} in ${livePlacementSelectedFamilyLabel}.`
    : (!livePlacementSubscriptionId
      ? 'Select the target subscription for live placement refresh.'
      : 'Select the target family for live placement refresh.');

  const visibleViews = useMemo(() => REPORT_VIEWS.filter((view) => !view.adminOnly || auth?.canAccessAdmin), [auth]);
  const reportingViews = useMemo(() => visibleViews.filter((view) => view.navGroup !== 'admin').sort((left, right) => left.label.localeCompare(right.label)), [visibleViews]);
  const adminViews = useMemo(() => visibleViews.filter((view) => view.navGroup === 'admin').sort((left, right) => left.label.localeCompare(right.label)), [visibleViews]);

  const recommenderFamilySkuOptions = useMemo(() => getRecommenderFamilySkuOptions(filters.family), [filters.family, skuCatalogVersion]);
  const recommendationTargetSkuOptions = useMemo(() => {
    const options = new Set();
    (Array.isArray(capacityData.rows) ? capacityData.rows : []).forEach((row) => {
      const sku = normalizeSkuName(row && row.sku);
      if (sku && !isAggregateSkuName(sku)) {
        options.add(sku);
      }
    });
    recommenderFamilySkuOptions.forEach((sku) => {
      const normalized = normalizeSkuName(sku);
      if (normalized && !isAggregateSkuName(normalized)) {
        options.add(normalized);
      }
    });
    return [...options].sort((left, right) => compareSkuValues(left, right));
  }, [capacityData.rows, recommenderFamilySkuOptions]);
  const recommendationSkuPickerOptions = useMemo(() => {
    if (recommenderFamilySkuOptions.length > 0) {
      return recommenderFamilySkuOptions;
    }

    return recommendationTargetSkuOptions;
  }, [recommendationTargetSkuOptions, recommenderFamilySkuOptions]);
  const selectedScopedSku = useMemo(() => {
    if (!filters.sku || filters.sku === 'all') {
      return '';
    }

    const normalized = normalizeSkuName(filters.sku);
    return recommendationTargetSkuOptions.includes(normalized) ? normalized : '';
  }, [filters.sku, recommendationTargetSkuOptions]);
  const fastRecommendedTargetSku = useMemo(() => defaultRecommendTargetSkuFromRows(capacityData.rows, recommenderFamilySkuOptions), [capacityData.rows, recommenderFamilySkuOptions]);
  const recommendedTargetSku = useMemo(() => {
    if (selectedScopedSku) {
      return selectedScopedSku;
    }
    if (filters.family && filters.family !== 'all') {
      return String(fastRecommendedTargetSku || capacityAnalytics.recommendedTargetSku || '').trim();
    }
    return String(capacityAnalytics.recommendedTargetSku || fastRecommendedTargetSku || '').trim();
  }, [capacityAnalytics.recommendedTargetSku, fastRecommendedTargetSku, filters.family, selectedScopedSku]);
  const recommendedRegions = useMemo(() => defaultRecommendRegionsFromFilters(filters, capacityData.facets.regions, []), [filters, capacityData.facets.regions]);
  const scopedRegionOptions = useMemo(() => {
    const baseOptions = activeView === 'ai-model-availability' || activeView === 'ai-summary-report'
      ? (Array.isArray(aiModelState.regions) ? aiModelState.regions : [])
      : (Array.isArray(capacityData.facets.regions) ? capacityData.facets.regions : []);
    const presetRegions = regionPresets[filters.regionPreset] || [];
    if (presetRegions.length > 0) {
      return [...new Set(presetRegions.map((region) => String(region || '').trim().toLowerCase()).filter(Boolean))];
    }
    return [...new Set(baseOptions.map((region) => String(region || '').trim().toLowerCase()).filter(Boolean))];
  }, [activeView, aiModelState.regions, filters.regionPreset, capacityData.facets.regions]);
  const regionHealth = useMemo(() => (Array.isArray(capacityAnalytics.regionHealth) ? capacityAnalytics.regionHealth : []), [capacityAnalytics.regionHealth]);
  const topSkus = useMemo(() => (Array.isArray(capacityAnalytics.topSkus) ? capacityAnalytics.topSkus : []), [capacityAnalytics.topSkus]);
  const familySummaryRows = useMemo(() => (familyRows.length > 0 ? familyRows : []), [familyRows]);
  const recommendationRows = useMemo(() => (Array.isArray(recommendState.result?.recommendations) ? recommendState.result.recommendations : []), [recommendState.result]);
  const matrix = useMemo(() => {
    const source = capacityAnalytics.matrix || { regions: [], rows: [] };
    const availableRegions = new Set((Array.isArray(source.regions) ? source.regions : []).map((region) => String(region || '').trim().toLowerCase()).filter(Boolean));
    const resolveCellStatus = (cell) => {
      if (!cell) return 'BLOCKED';
      const hasOk = Number(cell.okCount || 0) > 0;
      const hasLimited = Number(cell.limitedCount || 0) > 0;
      const hasConstrained = Number(cell.constrainedCount || 0) > 0;
      if (hasOk && (hasLimited || hasConstrained)) return 'PARTIAL';
      if (hasOk) return 'OK';
      if (hasLimited) return 'LIMITED';
      if (hasConstrained) return 'CONSTRAINED';
      return 'BLOCKED';
    };
    const selectedRegions = filters.region && filters.region !== 'all'
      ? [String(filters.region || '').trim().toLowerCase()].filter(Boolean)
      : (Array.isArray(scopedRegionOptions) && scopedRegionOptions.length > 0
        ? scopedRegionOptions.map((region) => String(region || '').trim().toLowerCase()).filter((region) => availableRegions.has(region))
        : [...availableRegions]);
    return {
      regions: selectedRegions,
      rows: (Array.isArray(source.rows) ? source.rows : []).map((row) => {
        const regionMap = {};
        selectedRegions.forEach((region) => {
          if (row && row.regionMap) {
            regionMap[region] = row.regionMap[region];
          }
        });
        const statuses = Object.values(regionMap).map((cell) => resolveCellStatus(cell));
        const rowStatus = statuses.includes('OK')
          ? 'OK'
          : (statuses.includes('PARTIAL') || statuses.includes('LIMITED') || statuses.includes('CONSTRAINED'))
            ? 'CAUTION'
            : 'BLOCKED';
        return {
          ...row,
          regionMap,
          rowStatus,
          readyRegionCount: statuses.filter((status) => status === 'OK' || status === 'PARTIAL').length
        };
      }),
      resolveCellStatus
    };
  }, [capacityAnalytics.matrix, filters.region, scopedRegionOptions]);
  const aiDeploymentTypeOptions = useMemo(() => [...new Set((aiModelState.rows || [])
    .flatMap((row) => String(row.deploymentTypes || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)))].sort((left, right) => left.localeCompare(right)), [aiModelState.rows]);
  const aiProviderOptions = useMemo(() => [...new Set((aiModelState.rows || [])
    .map((row) => getAIModelProviderLabel(row))
    .filter(Boolean))].sort((left, right) => left.localeCompare(right)), [aiModelState.rows]);
  const aiQuotaProviderOptions = useMemo(() => (Array.isArray(capacityAnalytics.aiQuotaProviderOptions) ? capacityAnalytics.aiQuotaProviderOptions : []), [capacityAnalytics.aiQuotaProviderOptions]);
  const aiModelRows = useMemo(() => {
    const scopedPresetRegions = regionPresets[filters.regionPreset] || [];
    const scopedPresetRegionSet = new Set(scopedPresetRegions.map((region) => String(region || '').trim().toLowerCase()));
    const searchTerm = String(aiModelFilters.modelName || '').trim().toLowerCase();
    return (aiModelState.rows || []).filter((row) => {
      const rowRegion = String(row.region || '').trim().toLowerCase();
      const byPreset = scopedPresetRegions.length === 0 || scopedPresetRegionSet.has(rowRegion);
      const byRegion = filters.region === 'all' || rowRegion === String(filters.region || '').trim().toLowerCase();
      const provider = getAIModelProviderLabel(row);
      const searchableText = `${provider} ${row.modelName || ''} ${row.modelVersion || ''} ${row.skuName || ''}`.toLowerCase();
      const bySearch = !searchTerm || searchableText.includes(searchTerm);
      const byProvider = aiModelFilters.provider === 'all' || provider === aiModelFilters.provider;
      const deploymentTypes = String(row.deploymentTypes || '').split(',').map((value) => value.trim()).filter(Boolean);
      const byDeployment = aiModelFilters.deploymentType === 'all' || deploymentTypes.includes(aiModelFilters.deploymentType);
      const byFineTuning = aiModelFilters.fineTuning === 'all'
        || (aiModelFilters.fineTuning === 'yes' && Boolean(row.finetuneCapable))
        || (aiModelFilters.fineTuning === 'no' && !row.finetuneCapable);
      const byDefault = !aiModelFilters.defaultOnly || Boolean(row.isDefault);
      return byPreset && byRegion && bySearch && byProvider && byDeployment && byFineTuning && byDefault;
    });
  }, [aiModelFilters.defaultOnly, aiModelFilters.deploymentType, aiModelFilters.fineTuning, aiModelFilters.modelName, aiModelFilters.provider, aiModelState.rows, filters.region, filters.regionPreset]);
  const filteredPaaSRows = useMemo(() => filterPaaSRowsByScope(paasState.rows, filters.regionPreset, filters.region), [paasState.rows, filters.regionPreset, filters.region]);
  const filteredPaaSData = useMemo(() => summarizePaaSRows(filteredPaaSRows), [filteredPaaSRows]);
  const paasMatrix = useMemo(() => buildPaaSRegionMatrix(filteredPaaSRows), [filteredPaaSRows]);
  const transposedPaaSMatrix = useMemo(() => transposePaaSRegionMatrix(paasMatrix), [paasMatrix]);
  const paasSubscriptionScope = useMemo(() => getPaaSSubscriptionScope(paasState.metadata), [paasState.metadata]);
  const paasSubscriptionNote = selectedSubscriptionIds.length > 0
    ? `Sidebar subscription selections (${formatNumber(selectedSubscriptionIds.length)}) do not filter PaaS yet. This snapshot reflects the worker subscription scope shown here.`
    : 'PaaS rows are not filtered by the sidebar subscription picker yet. This snapshot reflects the worker subscription scope shown here.';
  const isAdminView = Boolean(auth?.canAccessAdmin && activeView === 'admin');
  const filteredQuotaCandidateRows = useMemo(() => {
    const familyTerm = normalizeSearchText(quotaState.candidateFilters.family || '');
    return (Array.isArray(quotaState.candidates) ? quotaState.candidates : []).filter((row) => {
      const recipientNeed = getQuotaRecipientNeed(row);
      const movableQuota = Number(row.movableQuota || row.suggestedMovable || 0);
      const bySub = quotaState.candidateFilters.subscriptionId === 'all' || row.subscriptionId === quotaState.candidateFilters.subscriptionId;
      const byRegion = quotaState.candidateFilters.region === 'all' || row.region === quotaState.candidateFilters.region;
      const byIntent = quotaState.candidateFilters.intent === 'all'
        || (quotaState.candidateFilters.intent === 'donor' && movableQuota > 0)
        || (quotaState.candidateFilters.intent === 'need' && recipientNeed > 0);
      const searchText = normalizeSearchText([row.family, row.quotaName, row.subscriptionName, row.subscriptionId, row.region].filter(Boolean).join(' '));
      const byFamily = !familyTerm || searchText.includes(familyTerm);
      return bySub && byRegion && byIntent && byFamily;
    });
  }, [quotaState.candidateFilters.family, quotaState.candidateFilters.intent, quotaState.candidateFilters.region, quotaState.candidateFilters.subscriptionId, quotaState.candidates]);
  const aiSummaryMatrixExport = useMemo(() => buildAIProviderMatrixExport(aiModelRows, scopedRegionOptions), [aiModelRows, scopedRegionOptions]);
  const adminExportRows = useMemo(() => {
    const status = adminState.status || null;
    const summary = status?.lastSummary || {};
    const job = adminState.job || null;
    const jobState = job?.status === 'queued' || job?.status === 'running' ? job.status : null;
    const stateLabel = jobState === 'queued'
      ? 'Queued'
      : (jobState === 'running'
        ? 'Running'
        : (status?.inProgress ? 'Running' : (status?.lastError ? 'Failed' : (status?.lastSuccessUtc ? 'Healthy' : 'Idle'))));

    return [
      { section: 'Status', metric: 'State', value: stateLabel },
      { section: 'Status', metric: 'Job Id', value: job?.jobId || '' },
      { section: 'Status', metric: 'Last Run', value: formatTimestamp(status?.lastRunUtc) },
      { section: 'Status', metric: 'Last Success', value: formatTimestamp(status?.lastSuccessUtc) },
      { section: 'Status', metric: 'Last Error', value: status?.lastError || '' },
      { section: 'Status', metric: 'Inserted Rows', value: status?.lastInsertedRows || 0 },
      { section: 'Status', metric: 'Score Rows', value: summary.insertedScoreRows || 0 },
      { section: 'Status', metric: 'AI Model Rows', value: summary.insertedAIModelRows || 0 },
      { section: 'Status', metric: 'Subscriptions', value: summary.subscriptionCount || 0 },
      { section: 'Scheduler', metric: 'Ingest Interval Minutes', value: adminState.schedule.ingest.intervalMinutes },
      { section: 'Scheduler', metric: 'Ingest Run On Startup', value: adminState.schedule.ingest.runOnStartup },
      { section: 'Scheduler', metric: 'Live Placement Interval Minutes', value: adminState.schedule.livePlacement.intervalMinutes },
      { section: 'Scheduler', metric: 'Live Placement Run On Startup', value: adminState.schedule.livePlacement.runOnStartup },
      { section: 'Scheduler', metric: 'AI Model Catalog Interval Minutes', value: adminState.schedule.aiModelCatalog.intervalMinutes },
      { section: 'Runtime', metric: 'Ingest Interval Minutes', value: adminState.runtime.ingest.intervalMinutes },
      { section: 'Runtime', metric: 'Live Placement Interval Minutes', value: adminState.runtime.livePlacement.intervalMinutes },
      { section: 'Runtime', metric: 'AI Model Catalog Interval Minutes', value: adminState.runtime.aiModelCatalog.intervalMinutes }
    ];
  }, [adminState.job, adminState.runtime.aiModelCatalog.intervalMinutes, adminState.runtime.ingest.intervalMinutes, adminState.runtime.livePlacement.intervalMinutes, adminState.schedule.aiModelCatalog.intervalMinutes, adminState.schedule.ingest.intervalMinutes, adminState.schedule.ingest.runOnStartup, adminState.schedule.livePlacement.intervalMinutes, adminState.schedule.livePlacement.runOnStartup, adminState.status]);
  const activeReportExportOptions = useMemo(() => {
    if (activeView === 'capacity-grid') {
      return [
        { value: 'server:csv:grid', label: 'CSV Export', type: 'server', format: 'csv', variant: 'grid' },
        { value: 'server:xlsx:grid', label: 'Grid XLSX', type: 'server', format: 'xlsx', variant: 'grid' },
        { value: 'server:xlsx:report', label: 'Report XLSX', type: 'server', format: 'xlsx', variant: 'report' }
      ];
    }

    if (activeView === 'region-health') {
      return [{ value: 'client:region-health', label: 'CSV Export', type: 'client', filenameBase: 'region-health', rows: regionHealth, columns: [
        { label: 'Region', value: (row) => row.region },
        { label: 'Observed Capacity', value: (row) => row.totalRows },
        { label: 'Deployable Capacity', value: (row) => row.deployableRows },
        { label: 'Constrained Capacity', value: (row) => row.constrainedRows },
        { label: 'Quota Headroom', value: (row) => Math.round(Number(row.totalQuotaHeadroom || 0)) },
        { label: 'Deployable Families', value: (row) => row.deployableFamilyCount },
        { label: 'Subscriptions With Capacity', value: (row) => row.deployableSubscriptionCount },
        { label: 'Providers', value: (row) => Array.isArray(row.providers) ? row.providers.join(', ') : '' },
        { label: 'Most Constrained Families', value: (row) => Array.isArray(row.topConstrainedFamilies) ? row.topConstrainedFamilies.join(', ') : '' }
      ] }];
    }

    if (activeView === 'recommender') {
      return [{ value: 'client:recommender', label: 'CSV Export', type: 'client', filenameBase: 'capacity-recommender', rows: recommendationRows, columns: [
        { label: 'Rank', value: (row) => row.rank },
        { label: 'SKU', value: (row) => normalizeSkuName(row.sku) || '' },
        { label: 'Region', value: (row) => row.region },
        { label: 'vCPU', value: (row) => row.vCPU },
        { label: 'MemGB', value: (row) => row.memGiB },
        { label: 'Score', value: (row) => row.score },
        { label: 'CPU', value: (row) => row.cpu },
        { label: 'Disk', value: (row) => row.disk },
        { label: 'Type', value: (row) => row.purpose },
        { label: 'Capacity', value: (row) => row.capacity },
        { label: 'Zones', value: (row) => row.zonesOK },
        { label: 'PriceHr', value: (row) => row.priceHr },
        { label: 'PriceMo', value: (row) => row.priceMo }
      ] }];
    }

    if (activeView === 'paas-availability') {
      return [{ value: 'client:paas-rows', label: 'CSV Export', type: 'client', filenameBase: 'paas-availability', rows: filteredPaaSRows, columns: [
        { label: 'Service', value: (row) => row.service },
        { label: 'Region', value: (row) => row.region },
        { label: 'Category', value: (row) => row.category },
        { label: 'Name', value: (row) => row.displayName || row.name || '' },
        { label: 'Edition', value: (row) => row.edition || '' },
        { label: 'Tier', value: (row) => row.tier || '' },
        { label: 'Status', value: (row) => row.status || (row.available ? 'Available' : 'Unknown') },
        { label: 'Quota Used', value: (row) => row.quotaCurrent },
        { label: 'Quota Limit', value: (row) => row.quotaLimit },
        { label: 'Metric', value: (row) => formatPaaSMetric(row) }
      ] }];
    }

    if (activeView === 'shareable-quota-report') {
      return [{ value: 'client:shareable-quota', label: 'CSV Export', type: 'client', filenameBase: 'shareable-quota-report', rows: quotaState.shareableReport.rows, columns: [
        { label: 'Subscription Id', value: (row) => row.subscriptionId },
        { label: 'Region', value: (row) => row.region },
        { label: 'Quota SKU / Family', value: (row) => row.displayName || row.resourceName || '' },
        { label: 'Resource Name', value: (row) => row.resourceName || '' },
        { label: 'Quota Group', value: (row) => row.shareableQuota },
        { label: 'Assigned Quota', value: (row) => row.quotaLimit }
      ] }];
    }

    if (activeView === 'sku-chart') {
      return [{ value: 'client:top-skus', label: 'CSV Export', type: 'client', filenameBase: 'top-skus', rows: topSkus, columns: [
        { label: 'SKU', value: (row) => row.sku },
        { label: 'Available Quota', value: (row) => row.available }
      ] }];
    }

    if (activeView === 'capacity-score') {
      return [
        { value: 'client:capacity-score', label: 'CSV Export: Score Rows', type: 'client', filenameBase: 'capacity-score', rows: capacityScores.rows, columns: [
          { label: 'Region', value: (row) => row.region },
          { label: 'SKU', value: (row) => normalizeSkuName(row.sku) || '' },
          { label: 'Family', value: (row) => formatFamilyLabel(row.family) || row.family || '' },
          { label: 'Capacity Score', value: (row) => row.score },
          { label: 'Azure Live Score', value: (row) => row.livePlacementScore || '' },
          { label: 'Checked', value: (row) => formatTimestamp(row.liveCheckedAtUtc) },
          { label: 'Subscriptions', value: (row) => row.subscriptionCount },
          { label: 'OK', value: (row) => row.okRows },
          { label: 'Limited', value: (row) => row.limitedRows },
          { label: 'Constrained', value: (row) => row.constrainedRows },
          { label: 'Quota', value: (row) => row.totalQuotaAvailable },
          { label: 'Reason', value: (row) => row.reason || '' }
        ] },
        { value: 'client:capacity-score-subscriptions', label: 'CSV Export: Subscription Summary', type: 'client', filenameBase: 'capacity-score-subscriptions', rows: capacityScores.subscriptionSummary, columns: [
          { label: 'Subscription Key', value: (row) => row.subscriptionKey },
          { label: 'SKU Observations', value: (row) => row.skuObservations || row.totalRows },
          { label: 'Constrained Observations', value: (row) => row.constrainedObservations || row.constrainedRows },
          { label: 'Quota Available', value: (row) => row.totalQuotaAvailable }
        ] }
      ];
    }

    if (activeView === 'family-summary') {
      return [{ value: 'client:family-summary', label: 'CSV Export', type: 'client', filenameBase: 'family-summary', rows: familySummaryRows, columns: [
        { label: 'Family', value: (row) => row.family },
        { label: 'SKUs', value: (row) => row.skus },
        { label: 'OK SKUs', value: (row) => row.ok },
        { label: 'Largest', value: (row) => row.largest },
        { label: 'Zones', value: (row) => row.zones },
        { label: 'Status', value: (row) => row.status },
        { label: 'Quota', value: (row) => row.quota }
      ] }];
    }

    if (activeView === 'region-matrix') {
      return [{ value: 'client:region-matrix', label: 'CSV Export', type: 'client', filenameBase: 'region-matrix', rows: matrix.rows, columns: [
        { label: 'Family', value: (row) => row.family },
        { label: 'Key', value: (row) => row.rowStatus },
        { label: 'Ready', value: (row) => row.readyRegionCount },
        ...matrix.regions.map((region) => ({ label: region, value: (row) => matrix.resolveCellStatus(row.regionMap[region]) }))
      ] }];
    }

    if (activeView === 'trend') {
      return [{ value: 'client:trend', label: 'CSV Export', type: 'client', filenameBase: 'trend-history', rows: trendRows, columns: [
        { label: 'Day', value: (row) => row.day },
        { label: 'Total Rows', value: (row) => row.totalRows },
        { label: 'Constrained Rows', value: (row) => row.constrainedRows },
        { label: 'Total Quota Available', value: (row) => row.totalQuotaAvailable },
        { label: 'Daily Peak Utilization Pct', value: (row) => row.peakUtilizationPct },
        { label: 'Rolling 7 Day Peak Utilization Pct', value: (row) => row.rolling7DayPeakUtilizationPct },
        { label: 'Rolling 14 Day Peak Utilization Pct', value: (row) => row.rolling14DayPeakUtilizationPct }
      ] }];
    }

    if (activeView === 'ai-summary-report') {
      return [{ value: 'client:ai-summary', label: 'CSV Export', type: 'client', filenameBase: 'ai-summary-report', rows: aiSummaryMatrixExport.rows, columns: [
        { label: 'Provider', value: (row) => row.provider },
        ...aiSummaryMatrixExport.regionOrder.map((region) => ({ label: region, value: (row) => row[region] })),
        { label: 'Covered Regions', value: (row) => row.coveredRegions }
      ] }];
    }

    if (activeView === 'ai-model-availability') {
      return [{ value: 'client:ai-model-availability', label: 'CSV Export', type: 'client', filenameBase: 'ai-model-availability', rows: aiModelRows, columns: [
        { label: 'Provider', value: (row) => getAIModelProviderLabel(row) },
        { label: 'Model', value: (row) => row.modelName },
        { label: 'Version', value: (row) => row.modelVersion },
        { label: 'Region', value: (row) => row.region },
        { label: 'Deployment Types', value: (row) => row.deploymentTypes || '' },
        { label: 'Fine-Tuning', value: (row) => row.finetuneCapable },
        { label: 'Default', value: (row) => row.isDefault },
        { label: 'Format', value: (row) => row.modelFormat },
        { label: 'SKU', value: (row) => row.skuName },
        { label: 'Deprecation', value: (row) => formatDateValue(row.deprecationDate) },
        { label: 'Updated', value: (row) => formatTimestamp(row.capturedAtUtc) }
      ] }];
    }

    if (activeView === 'quota-workbench') {
      return [
        { value: 'client:quota-workbench-shareable', label: 'CSV Export: Allocation Report', type: 'client', filenameBase: 'quota-workbench-allocation-report', rows: quotaState.shareableReport.rows, columns: [
          { label: 'Subscription Id', value: (row) => row.subscriptionId },
          { label: 'Region', value: (row) => row.region },
          { label: 'Quota SKU / Family', value: (row) => row.displayName || row.resourceName || '' },
          { label: 'Resource Name', value: (row) => row.resourceName || '' },
          { label: 'Quota Group', value: (row) => row.shareableQuota },
          { label: 'Assigned Quota', value: (row) => row.quotaLimit }
        ] },
        { value: 'client:quota-workbench-candidates', label: 'CSV Export: Candidates', type: 'client', filenameBase: 'quota-workbench-candidates', rows: filteredQuotaCandidateRows, columns: [
          { label: 'Subscription Name', value: (row) => row.subscriptionName || row.subscriptionId },
          { label: 'Subscription Id', value: (row) => row.subscriptionId },
          { label: 'Region', value: (row) => row.region },
          { label: 'Family', value: (row) => row.family },
          { label: 'SKUs', value: (row) => formatSkuList(row) },
          { label: 'Availability', value: (row) => row.availability },
          { label: 'Current', value: (row) => row.quotaCurrent },
          { label: 'Limit', value: (row) => row.quotaLimit },
          { label: 'Available', value: (row) => row.quotaAvailable },
          { label: 'Need', value: (row) => getQuotaRecipientNeed(row) },
          { label: 'Movable', value: (row) => row.movableQuota || row.suggestedMovable },
          { label: 'Status', value: (row) => row.status || row.candidateStatus }
        ] },
        { value: 'client:quota-workbench-runs', label: 'CSV Export: Captured Runs', type: 'client', filenameBase: 'quota-workbench-runs', rows: quotaState.quotaRuns, columns: [
          { label: 'Run ID', value: (row) => row.analysisRunId },
          { label: 'Captured At', value: (row) => row.capturedAtUtc },
          { label: 'Rows', value: (row) => row.rowCount || row.candidateCount || 0 },
          { label: 'Subscriptions', value: (row) => row.subscriptionCount || 0 },
          { label: 'Movable Rows', value: (row) => row.movableCandidateCount || 0 }
        ] },
        { value: 'client:quota-workbench-plan', label: 'CSV Export: Planned Moves', type: 'client', filenameBase: 'quota-workbench-plan', rows: quotaState.planRows, columns: [
          { label: 'Region', value: (row) => row.region },
          { label: 'Quota Family', value: (row) => row.quotaName },
          { label: 'Selected SKU', value: (row) => row.selectedSku || '' },
          { label: 'SKUs In Scope', value: (row) => formatSkuList(row) },
          { label: 'Donor', value: (row) => row.donorSubscriptionName },
          { label: 'Recipient', value: (row) => row.recipientSubscriptionName },
          { label: 'Transfer', value: (row) => row.transferAmount },
          { label: 'Donor Before', value: (row) => row.donorAvailableBefore },
          { label: 'Donor Left', value: (row) => row.donorRemainingMovable },
          { label: 'Recipient Need', value: (row) => row.recipientNeededQuota },
          { label: 'Need Left', value: (row) => row.recipientRemainingNeed },
          { label: 'Recipient State', value: (row) => row.recipientAvailabilityState }
        ] },
        { value: 'client:quota-workbench-simulation', label: 'CSV Export: Simulation Impact', type: 'client', filenameBase: 'quota-workbench-simulation', rows: quotaState.impactRows, columns: [
          { label: 'Role', value: (row) => row.role },
          { label: 'Subscription', value: (row) => row.subscriptionName },
          { label: 'Region', value: (row) => row.region },
          { label: 'Quota Family', value: (row) => row.quotaName },
          { label: 'SKUs In Scope', value: (row) => formatSkuList(row) },
          { label: 'Delta', value: (row) => row.delta },
          { label: 'Before', value: (row) => row.quotaAvailableBefore },
          { label: 'After', value: (row) => row.quotaAvailableAfter },
          { label: 'Gap Before', value: (row) => row.gapBefore },
          { label: 'Gap After', value: (row) => row.gapAfter },
          { label: 'Projected', value: (row) => row.projectedState }
        ] },
        { value: 'client:quota-workbench-apply', label: 'CSV Export: Apply Results', type: 'client', filenameBase: 'quota-workbench-apply-results', rows: quotaState.applyResults, columns: [
          { label: 'Subscription Id', value: (row) => row.subscriptionId },
          { label: 'Region', value: (row) => row.region },
          { label: 'Quota Family', value: (row) => row.quotaName },
          { label: 'Rows', value: (row) => row.rowsSubmitted },
          { label: 'Requested Cores', value: (row) => row.requestedCores },
          { label: 'Status', value: (row) => row.status },
          { label: 'Error', value: (row) => row.error || '' }
        ] }
      ];
    }

    if (activeView === 'admin') {
      return [{ value: 'client:admin-status', label: 'CSV Export', type: 'client', filenameBase: 'admin-ingestion-status', rows: adminExportRows, columns: [
        { label: 'Section', value: (row) => row.section },
        { label: 'Metric', value: (row) => row.metric },
        { label: 'Value', value: (row) => row.value }
      ] }];
    }

    return [];
  }, [activeView, adminExportRows, aiModelRows, aiSummaryMatrixExport.regionOrder, aiSummaryMatrixExport.rows, capacityScores.rows, capacityScores.subscriptionSummary, filteredPaaSRows, filteredQuotaCandidateRows, familySummaryRows, matrix.regions, matrix.resolveCellStatus, matrix.rows, quotaState.applyResults, quotaState.impactRows, quotaState.planRows, quotaState.quotaRuns, quotaState.shareableReport.rows, recommendationRows, regionHealth, scopedRegionOptions, topSkus, trendRows]);

  useEffect(() => {
    if (!Array.isArray(subscriptionOptions) || subscriptionOptions.length === 0) {
      if (livePlacementSubscriptionId) {
        setLivePlacementSubscriptionId('');
      }
      return;
    }

    const hasCurrentSelection = subscriptionOptions.some((option) => option.subscriptionId === livePlacementSubscriptionId);
    if (hasCurrentSelection) {
      return;
    }

    if (selectedSubscriptionIds.length === 1 && subscriptionOptions.some((option) => option.subscriptionId === selectedSubscriptionIds[0])) {
      setLivePlacementSubscriptionId(selectedSubscriptionIds[0]);
      return;
    }

    setLivePlacementSubscriptionId('');
  }, [livePlacementSubscriptionId, selectedSubscriptionIds, subscriptionOptions]);

  useEffect(() => {
    const familyOptions = Array.isArray(livePlacementFamilyOptions) ? livePlacementFamilyOptions : [];
    if (familyOptions.length === 0) {
      if (livePlacementFamily) {
        setLivePlacementFamily('');
      }
      return;
    }

    if (filters.family && filters.family !== 'all' && familyOptions.includes(filters.family)) {
      if (livePlacementFamily !== filters.family) {
        setLivePlacementFamily(filters.family);
      }
      return;
    }

    if (livePlacementFamily && !familyOptions.includes(livePlacementFamily)) {
      setLivePlacementFamily('');
    }
  }, [filters.family, livePlacementFamily, livePlacementFamilyOptions]);

  useEffect(() => {
    if (activeReportExportOptions.length === 0) {
      if (selectedExportOption) {
        setSelectedExportOption('');
      }
      return;
    }

    if (!activeReportExportOptions.some((option) => option.value === selectedExportOption)) {
      setSelectedExportOption(activeReportExportOptions[0].value);
    }
  }, [activeReportExportOptions, selectedExportOption]);

  useEffect(() => {
    if (!filters.family || filters.family === 'all') {
      return;
    }
    if (filteredFamilyOptions.includes(filters.family)) {
      return;
    }
    setFilters((current) => ({ ...current, family: 'all', sku: 'all' }));
  }, [filteredFamilyOptions, filters.family]);

  useEffect(() => {
    if (!filters.familyBase || filters.familyBase === 'all') {
      return;
    }
    if (familyBaseOptions.some((option) => option.value === filters.familyBase)) {
      return;
    }
    setFilters((current) => ({ ...current, familyBase: 'all', family: 'all', sku: 'all' }));
  }, [familyBaseOptions, filters.familyBase]);

  useEffect(() => {
    if (!filters.sku || filters.sku === 'all') {
      return;
    }
    if (scopedSkuOptions.includes(filters.sku)) {
      return;
    }
    setFilters((current) => ({ ...current, sku: 'all' }));
  }, [filters.sku, scopedSkuOptions]);

  useEffect(() => {
    if (!recommendedTargetSku) {
      return;
    }

    setRecommendState((current) => {
      const shouldApplyAutoTarget = !current.targetSku || current.targetSku === current.autoTargetSku;
      if (!shouldApplyAutoTarget) {
        return current;
      }
      if (current.targetSku === recommendedTargetSku && current.autoTargetSku === recommendedTargetSku) {
        return current;
      }
      return {
        ...current,
        targetSku: recommendedTargetSku,
        autoTargetSku: recommendedTargetSku
      };
    });
  }, [recommendedTargetSku]);

  useEffect(() => {
    if (!recommendedRegions) {
      return;
    }

    setRecommendState((current) => {
      const shouldApplyAutoRegions = !current.regions || current.regions === current.autoRegions;
      if (!shouldApplyAutoRegions) {
        return current;
      }
      if (current.regions === recommendedRegions && current.autoRegions === recommendedRegions) {
        return current;
      }
      return {
        ...current,
        regions: recommendedRegions,
        autoRegions: recommendedRegions
      };
    });
  }, [recommendedRegions]);

  useEffect(() => {
    document.documentElement.dataset.environment = deploymentEnvironment.key;
    document.body.dataset.environment = deploymentEnvironment.key;
  }, [deploymentEnvironment]);

  useEffect(() => {
    async function initialize() {
      try {
        const authPayload = await fetchJson('/api/auth/me');
        const authContext = authPayload.auth;
        setAuth(authContext);

        const subscriptionPayload = await fetchJson('/api/subscriptions?limit=500');
        let managementGroupPayload = { groups: [], defaultManagementGroupId: '' };
        let uiSettingsPayload = { settings: { showSqlPreview: false } };
        let bootstrapWarning = '';

        if (authContext && authContext.isAuthenticated) {
          const managementGroupResponse = await Promise.allSettled([
            fetchJson('/api/quota/management-groups'),
          ]);

          if (managementGroupResponse[0]?.status === 'fulfilled') {
            managementGroupPayload = managementGroupResponse[0].value || managementGroupPayload;
          } else {
            bootstrapWarning = managementGroupResponse[0]?.reason?.message || 'Quota report management-group scope could not be loaded automatically.';
          }
        }

        if (authContext && authContext.canAccessAdmin) {
          const adminResponses = await Promise.allSettled([
            fetchJson('/api/admin/ui-settings')
          ]);

          if (adminResponses[0]?.status === 'fulfilled') {
            uiSettingsPayload = adminResponses[0].value || uiSettingsPayload;
          }
        }

        const subscriptions = Array.isArray(subscriptionPayload.rows) ? subscriptionPayload.rows : [];
        setSubscriptionOptions(subscriptions);
        setSelectedSubscriptionIds(subscriptions.map((row) => row.subscriptionId).filter(Boolean));
        const managementGroups = Array.isArray(managementGroupPayload.groups) ? managementGroupPayload.groups : [];
        const selectedManagementGroup = managementGroupPayload.defaultManagementGroupId && managementGroups.some((group) => group.id === managementGroupPayload.defaultManagementGroupId)
          ? managementGroupPayload.defaultManagementGroupId
          : (managementGroups[0] ? managementGroups[0].id : '');
        setQuotaState((current) => ({ ...current, managementGroups, selectedManagementGroup }));
        setShowSqlPreview(Boolean(uiSettingsPayload.settings && uiSettingsPayload.settings.showSqlPreview));
        setAppStatus(bootstrapWarning
          ? { tone: 'warning', message: bootstrapWarning }
          : { tone: 'info', message: '' });
      } catch (error) {
        setAppStatus({ tone: 'error', message: error.message || 'Failed to initialize React experience.' });
      } finally {
        setAuthResolved(true);
      }
    }
    initialize();
  }, []);

  useEffect(() => {
    if (!authResolved) {
      return;
    }

    async function loadPaaSSnapshot() {
      setPaaSState((current) => ({
        ...current,
        busy: { ...current.busy, load: true },
        status: current.rows.length > 0
          ? current.status
          : { tone: 'info', message: 'Loading cached PaaS availability snapshot...' }
      }));

      try {
        const query = new URLSearchParams();
        if (paasState.filters.service && paasState.filters.service !== 'All') {
          query.set('service', paasState.filters.service);
        }

        const payload = await fetchJson(`/api/paas-availability${query.toString() ? `?${query.toString()}` : ''}`);
        const rows = Array.isArray(payload.rows) ? payload.rows : [];
        setPaaSState((current) => ({
          ...current,
          rows,
          summary: payload.summary || { rowCount: rows.length, serviceSummary: [] },
          facets: payload.facets || { services: [], regions: [], categories: [] },
          capturedAtUtc: payload.capturedAtUtc || null,
          metadata: payload.metadata || null,
          busy: { ...current.busy, load: false },
          status: rows.length > 0
            ? { tone: 'success', message: `Showing cached PaaS availability snapshot from ${formatTimestamp(payload.capturedAtUtc)}.` }
            : { tone: 'warn', message: 'No cached PaaS availability snapshot found yet. Run Refresh to capture one.' }
        }));
      } catch (error) {
        setPaaSState((current) => ({
          ...current,
          rows: [],
          summary: { rowCount: 0, serviceSummary: [], requestedService: current.filters.service, requestedRegionPreset: current.filters.regionPreset, requestedRegions: [] },
          facets: { services: [], regions: [], categories: [] },
          capturedAtUtc: null,
          metadata: null,
          busy: { ...current.busy, load: false },
          status: { tone: 'error', message: error.message || 'Failed to load cached PaaS availability.' }
        }));
      }
    }

    loadPaaSSnapshot();
  }, [authResolved, paasState.filters.service]);

  useEffect(() => {
    if (filters.region === 'all') {
      return;
    }
    if (scopedRegionOptions.includes(filters.region)) {
      return;
    }
    setFilters((current) => ({ ...current, region: 'all' }));
  }, [filters.region, scopedRegionOptions]);

  async function refreshAIModelAvailability() {
    setAiModelState((current) => ({
      ...current,
      loading: true,
      status: {
        tone: 'info',
        message: current.rows.length > 0 ? 'Refreshing AI model availability...' : 'Loading AI model availability...',
        detail: current.status.detail || ''
      }
    }));
    try {
      const [modelsPayload, regionsPayload] = await Promise.all([
        fetchJson('/api/ai/models'),
        fetchJson('/api/ai/models/regions')
      ]);
      setAiModelState({
        rows: Array.isArray(modelsPayload.rows) ? modelsPayload.rows : [],
        regions: Array.isArray(regionsPayload.regions) ? regionsPayload.regions : [],
        loading: false,
        status: {
          tone: 'success',
          message: `Loaded ${formatNumber(Array.isArray(modelsPayload.rows) ? modelsPayload.rows.length : 0)} AI model availability row(s).`,
          detail: 'Use the sidebar filters to narrow provider, region, model, and deployment-type scope.'
        }
      });
    } catch (error) {
      setAiModelState((current) => ({
        ...current,
        rows: [],
        regions: [],
        loading: false,
        status: {
          tone: 'error',
          message: error.message || 'Failed to load AI model availability.',
          detail: 'Verify the AI model catalog table/view is available, then refresh the report.'
        }
      }));
    }
  }

  useEffect(() => {
    if (activeView !== 'capacity-grid' && activeView !== 'recommender') {
      return;
    }

    const requestId = capacityGridRequestRef.current + 1;
    capacityGridRequestRef.current = requestId;

    async function loadCapacityGrid() {
      try {
        const query = new URLSearchParams({ ...queryFilters, pageNumber: String(capacityData.pagination.pageNumber || 1), pageSize: String(capacityData.pagination.pageSize || 50) });
        const payload = await fetchJson(`/api/capacity/paged?${query.toString()}`);
        if (capacityGridRequestRef.current !== requestId) {
          return;
        }
        const sanitizedRegions = (Array.isArray(payload.facets && payload.facets.regions) ? payload.facets.regions : []).filter(isDisplayableRegion);
        const sanitizedFamilies = (Array.isArray(payload.facets && payload.facets.families) ? payload.facets.families : []).filter(isDisplayableFamily);
        const canonicalFamilies = buildFamilyOptions(sanitizedFamilies).map((option) => option.value);
        const sanitizedSkus = (Array.isArray(payload.facets && payload.facets.skus) ? payload.facets.skus : [])
          .map((sku) => normalizeSkuName(sku))
          .filter((sku) => sku && !isAggregateSkuName(sku));
        setCapacityData({
          rows: Array.isArray(payload.data) ? payload.data.map((row) => ({ ...row, sku: normalizeSkuName(row.sku) })) : [],
          summary: payload.summary || null,
          facets: { regions: sanitizedRegions, families: canonicalFamilies, skus: [...new Set(sanitizedSkus)].sort((left, right) => compareSkuValues(left, right)) },
          pagination: payload.pagination || { pageNumber: 1, pageSize: 50, total: 0, pageCount: 1, hasNext: false, hasPrev: false }
        });
      } catch (error) {
        if (capacityGridRequestRef.current !== requestId) {
          return;
        }
        setCapacityData({ rows: [], summary: null, facets: { regions: [], families: [], skus: [] }, pagination: { pageNumber: 1, pageSize: 50, total: 0, pageCount: 1, hasNext: false, hasPrev: false } });
        setAppStatus({ tone: 'error', message: error.message || 'Failed to load capacity grid.' });
      }
    }
    loadCapacityGrid();
  }, [activeView, queryFilters, capacityData.pagination.pageNumber, capacityData.pagination.pageSize]);

  useEffect(() => {
    let cancelled = false;

    async function loadFamilyCatalog() {
      try {
        const query = new URLSearchParams({ ...familyCatalogQueryFilters, pageNumber: '1', pageSize: '500' });
        const payload = await fetchJson(`/api/capacity/paged?${query.toString()}`);
        if (cancelled) {
          return;
        }
        const sanitizedFamilies = (Array.isArray(payload.facets && payload.facets.families) ? payload.facets.families : []).filter(isDisplayableFamily);
        const canonicalFamilies = buildFamilyOptions(sanitizedFamilies).map((option) => option.value);
        setAllFamilyFacetOptions(canonicalFamilies);
      } catch {
        if (cancelled) {
          return;
        }
        setAllFamilyFacetOptions([]);
      }
    }

    loadFamilyCatalog();

    return () => {
      cancelled = true;
    };
  }, [familyCatalogQueryFilters]);

  useEffect(() => {
    let cancelled = false;

    async function loadComputeFamilyCatalog() {
      if (filters.resourceType !== 'Compute') {
        setComputeFamilyCatalogOptions([]);
        return;
      }

      try {
        const query = new URLSearchParams({ ...computeFamilyCatalogQueryFilters, resourceType: 'Compute', pageNumber: '1', pageSize: '500' });
        const payload = await fetchJson(`/api/capacity/paged?${query.toString()}`);
        if (cancelled) {
          return;
        }
        const rawFamilies = (Array.isArray(payload.facets && payload.facets.families) ? payload.facets.families : [])
          .map((family) => String(family || '').trim())
          .filter(isDisplayableFamily);
        const canonicalFamilies = buildFamilyOptions(rawFamilies).map((option) => option.value);
        setComputeFamilyCatalogOptions(canonicalFamilies);
      } catch {
        if (cancelled) {
          return;
        }
        setComputeFamilyCatalogOptions([]);
      }
    }

    loadComputeFamilyCatalog();

    return () => {
      cancelled = true;
    };
  }, [computeFamilyCatalogQueryFilters, filters.resourceType]);

  useEffect(() => {
    // Server paging must restart at page 1 when the sidebar query scope changes,
    // otherwise the grid can request a stale page under the new filter set.
    setCapacityData((current) => {
      if ((current.pagination.pageNumber || 1) === 1) {
        return current;
      }
      return {
        ...current,
        pagination: {
          ...current.pagination,
          pageNumber: 1
        }
      };
    });
  }, [queryFilters]);

  useEffect(() => {
    if (activeView !== 'ai-model-availability' && activeView !== 'ai-summary-report') {
      return;
    }
    refreshAIModelAvailability();
  }, [activeView]);

  useEffect(() => {
    if (filters.resourceType !== 'AI' && filters.provider !== 'all') {
      setFilters((current) => ({ ...current, provider: 'all' }));
      return;
    }
    if (filters.resourceType === 'AI' && filters.provider !== 'all' && !aiQuotaProviderOptions.includes(filters.provider)) {
      setFilters((current) => ({ ...current, provider: 'all' }));
    }
  }, [filters.resourceType, filters.provider, aiQuotaProviderOptions]);

  useEffect(() => {
    const requestId = analyticsRequestRef.current + 1;
    analyticsRequestRef.current = requestId;

    async function loadAnalytics() {
      const query = new URLSearchParams(queryFilters);
      const trendLookbackDays = trendGranularity === 'hourly' ? '2' : '7';
      const trendQuery = new URLSearchParams({ ...queryFilters, days: trendLookbackDays, granularity: trendGranularity }).toString();

      fetchJsonWithRetry(`/api/capacity/trends?${trendQuery}`)
        .then((payload) => {
          if (analyticsRequestRef.current !== requestId) {
            return;
          }
          setTrendRows(Array.isArray(payload.rows) ? payload.rows : []);
        })
        .catch(() => {
          if (analyticsRequestRef.current !== requestId) {
            return;
          }
          setTrendRows([]);
        });

      const results = await Promise.allSettled([
        fetchJson(`/api/capacity/analytics?${query.toString()}`),
        fetchJson(`/api/capacity/families?${new URLSearchParams({ ...queryFilters, family: 'all' }).toString()}`),
        fetchJson(`/api/capacity/subscriptions?${query.toString()}`)
      ]);

      if (analyticsRequestRef.current !== requestId) {
        return;
      }

      const [capacityResult, familyResult, subSummaryResult] = results;
      const failures = results.filter((result) => result.status === 'rejected');

      if (capacityResult.status === 'fulfilled') {
        setCapacityAnalytics({
          regionHealth: Array.isArray(capacityResult.value.regionHealth) ? capacityResult.value.regionHealth : [],
          topSkus: Array.isArray(capacityResult.value.topSkus) ? capacityResult.value.topSkus.map((row) => ({ ...row, sku: normalizeSkuName(row.sku) })) : [],
          matrix: capacityResult.value.matrix || { regions: [], rows: [] },
          recommendedTargetSku: normalizeSkuName(capacityResult.value.recommendedTargetSku),
          aiQuotaProviderOptions: Array.isArray(capacityResult.value.aiQuotaProviderOptions) ? capacityResult.value.aiQuotaProviderOptions : []
        });
      } else {
        setCapacityAnalytics({ regionHealth: [], topSkus: [], matrix: { regions: [], rows: [] }, recommendedTargetSku: '', aiQuotaProviderOptions: [] });
      }

      if (familyResult.status === 'fulfilled') {
        setFamilyRows(Array.isArray(familyResult.value.rows) ? familyResult.value.rows : []);
      } else {
        setFamilyRows([]);
      }

      if (subSummaryResult.status === 'fulfilled') {
        setCapacityScores((current) => {
          const desiredCount = String(normalizeDesiredPlacementCount(current.desiredCount));
          return {
            ...current,
            subscriptionSummary: Array.isArray(subSummaryResult.value.rows)
              ? subSummaryResult.value.rows
              : current.subscriptionSummary,
            desiredCount
          };
        });
      } else {
        setCapacityScores((current) => ({
          ...current,
          subscriptionSummary: []
        }));
      }

      if (failures.length > 0) {
        const firstError = failures[0].reason;
        setAppStatus({ tone: 'warn', message: firstError?.message || 'One or more analytics views failed to load. Other data is still available.' });
      }
    }
    loadAnalytics();
  }, [queryFilters, trendGranularity]);

  useEffect(() => {
    const requestId = capacityScoreRequestRef.current + 1;
    capacityScoreRequestRef.current = requestId;
    setCapacityScores((current) => ({ ...current, busy: true }));

    async function loadCapacityScores() {
      const scoreQuery = new URLSearchParams({
        ...queryFilters,
        desiredCount: String(normalizeDesiredPlacementCount(capacityScores.desiredCount)),
        pageNumber: String(capacityScores.pagination.pageNumber || 1),
        pageSize: String(capacityScores.pagination.pageSize || 50)
      }).toString();

      try {
        const payload = await fetchJson(`/api/capacity/scores?${scoreQuery}`);
        if (capacityScoreRequestRef.current !== requestId) {
          return;
        }

        setCapacityScores((current) => {
          const rows = Array.isArray(payload.rows) ? payload.rows : [];
          const desiredCount = String(normalizeDesiredPlacementCount(current.desiredCount));
          return {
            ...current,
            rows,
            pagination: payload.pagination || { pageNumber: 1, pageSize: 50, total: 0, pageCount: 1, hasNext: false, hasPrev: false },
            desiredCount,
            busy: false,
            status: {
              tone: 'info',
              message: buildCapacityScoreSnapshotMessage(rows, desiredCount),
              detail: ''
            }
          };
        });
      } catch (error) {
        if (capacityScoreRequestRef.current !== requestId) {
          return;
        }

        setCapacityScores((current) => ({
          ...current,
          rows: [],
          busy: false,
          status: {
            tone: 'error',
            message: error.message || 'Failed to load capacity score data.',
            detail: 'The requested Capacity Score page could not be loaded.'
          }
        }));
      }
    }

    loadCapacityScores();
  }, [queryFilters, capacityScores.desiredCount, capacityScores.pagination.pageNumber, capacityScores.pagination.pageSize]);

  useEffect(() => {
    async function loadQuotaGroups() {
      if (!auth?.canAccessAdmin || !quotaState.selectedManagementGroup) return;
      try {
        const payload = await fetchJson(`/api/quota/groups?managementGroupId=${encodeURIComponent(quotaState.selectedManagementGroup)}`);
        setQuotaState((current) => ({ ...current, quotaGroups: Array.isArray(payload.groups) ? payload.groups : [], selectedQuotaGroup: 'all', selectedAnalysisRunId: '', selectedDonorSubscriptionId: '', planRows: [], impactRows: [], applyResults: [], planSummary: {} }));
      } catch (error) {
        setQuotaState((current) => ({ ...current, quotaGroups: [], selectedQuotaGroup: 'all', status: { tone: 'error', message: error.message || 'Failed to load quota groups.' } }));
      }
    }
    loadQuotaGroups();
  }, [auth, quotaState.selectedManagementGroup]);

  useEffect(() => {
    if (!auth?.canAccessAdmin || !showSqlPreview) {
      setSqlPreviewState({ loading: false, error: '', rows: [] });
      return undefined;
    }

    const previewParams = new URLSearchParams({
      view: activeView,
      pageNumber: String(capacityData.pagination.pageNumber || 1),
      pageSize: String(capacityData.pagination.pageSize || 50),
      days: '7',
      desiredCount: activeView === 'capacity-score' ? String(normalizeDesiredPlacementCount(capacityScores.desiredCount)) : '1',
      regionPreset: filters.regionPreset,
      region: filters.region,
      family: filters.family,
      sku: filters.sku,
      availability: filters.availability,
      resourceType: filters.resourceType,
      subscriptionIds: selectedSubscriptionIds.join(','),
      managementGroupId: quotaState.selectedManagementGroup || '',
      groupQuotaName: quotaState.selectedQuotaGroup || '',
      analysisRunId: quotaState.selectedAnalysisRunId || ''
    });

    let cancelled = false;
    setSqlPreviewState((current) => ({ ...current, loading: true, error: '' }));

    fetchJson(`/api/admin/sql-preview?${previewParams.toString()}`)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setSqlPreviewState({ loading: false, error: '', rows: Array.isArray(payload.rows) ? payload.rows : [] });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setSqlPreviewState({ loading: false, error: error.message || 'Failed to load SQL preview.', rows: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [auth, showSqlPreview, activeView, capacityData.pagination.pageNumber, capacityData.pagination.pageSize, filters, selectedSubscriptionIds, quotaState.selectedManagementGroup, quotaState.selectedQuotaGroup, quotaState.selectedAnalysisRunId, capacityScores.desiredCount]);

  useEffect(() => {
    if (!auth?.canAccessAdmin || activeView !== 'admin') {
      return undefined;
    }

    let cancelled = false;

    async function loadAdminIngestion() {
      setAdminState((current) => ({ ...current, busy: { ...current.busy, refreshStatus: true, refreshSchedule: true } }));
      try {
        const [statusPayload, schedulePayload] = await Promise.all([
          fetchJson('/api/admin/ingest/status'),
          fetchJson('/api/admin/ingest/schedule')
        ]);
        if (cancelled) {
          return;
        }
        setAdminState((current) => ({
          ...current,
          job: statusPayload.activeJob || null,
          status: statusPayload.status || null,
          schedule: schedulePayload.settings || current.schedule,
          runtime: schedulePayload.runtime || current.runtime,
          persistence: schedulePayload.persistence || current.persistence,
          busy: { ...current.busy, refreshStatus: false, refreshSchedule: false },
          statusMessage: schedulePayload.persistence && schedulePayload.persistence.available === false
            ? { tone: 'warn', message: schedulePayload.persistence.message || 'Scheduler settings are running in read-only runtime mode.' }
            : { tone: 'success', message: 'Loaded ingestion status and scheduler settings.' }
        }));
      } catch (error) {
        if (cancelled) {
          return;
        }
        setAdminState((current) => ({ ...current, busy: { ...current.busy, refreshStatus: false, refreshSchedule: false }, statusMessage: { tone: 'error', message: error.message || 'Failed to load ingestion tools.' } }));
      }
    }

    loadAdminIngestion();
    return () => {
      cancelled = true;
    };
  }, [activeView, auth]);

  useEffect(() => {
    const jobRunning = adminState.job && (adminState.job.status === 'queued' || adminState.job.status === 'running');
    if (!auth?.canAccessAdmin || activeView !== 'admin' || (!jobRunning && !adminState.status?.inProgress)) {
      return undefined;
    }

    const handle = window.setInterval(async () => {
      try {
        const [statusPayload, jobPayload] = await Promise.all([
          fetchJson('/api/admin/ingest/status'),
          jobRunning ? fetchJson(`/api/admin/ingest/jobs/${encodeURIComponent(adminState.job.jobId)}`) : Promise.resolve(null)
        ]);
        const nextJob = jobPayload || statusPayload.activeJob || null;
        setAdminState((current) => ({
          ...current,
          job: nextJob,
          status: statusPayload.status || null,
          statusMessage: statusPayload.status?.inProgress
            ? { tone: 'info', message: 'Capacity ingestion is running.' }
            : (nextJob?.status === 'failed'
              ? { tone: 'error', message: nextJob.error || 'Capacity ingestion failed.' }
              : (statusPayload.status?.lastError
                ? { tone: 'error', message: `Last ingestion failed: ${statusPayload.status.lastError}` }
                : { tone: 'success', message: 'Capacity ingestion completed. Refresh reports to load the newest results.' }))
        }));
      } catch (error) {
        setAdminState((current) => ({ ...current, statusMessage: { tone: 'error', message: error.message || 'Failed to refresh ingestion status.' } }));
      }
    }, 5000);

    return () => {
      window.clearInterval(handle);
    };
  }, [activeView, adminState.job, adminState.status, auth]);

  function updateFilter(name, value) {
    setFilters((current) => {
      if (name === 'regionPreset') {
        return { ...current, regionPreset: value, region: 'all', familyBase: 'all', family: 'all', sku: 'all' };
      }
      if (name === 'region') {
        return { ...current, region: value, familyBase: 'all', family: 'all', sku: 'all' };
      }
      if (name === 'resourceType') {
        return { ...current, resourceType: value, provider: value === 'AI' ? current.provider : 'all', familyBase: 'all', family: 'all', sku: 'all' };
      }
      if (name === 'familyBase') {
        return { ...current, familyBase: value, family: 'all', sku: 'all' };
      }
      if (name === 'family') {
        return { ...current, family: value, sku: 'all' };
      }
      return { ...current, [name]: value };
    });
  }

  function toggleSubscription(subscriptionId) {
    setSelectedSubscriptionIds((current) => current.includes(subscriptionId) ? current.filter((id) => id !== subscriptionId) : [...current, subscriptionId]);
  }

  function selectAllSubscriptions() {
    setSelectedSubscriptionIds(subscriptionOptions.map((row) => row.subscriptionId).filter(Boolean));
  }

  function clearSubscriptions() {
    setSelectedSubscriptionIds([]);
  }

  async function downloadCapacityExport(format, variant = 'grid', busyKeyOverride = '') {
    const normalizedFormat = String(format || 'csv').toLowerCase() === 'xlsx' ? 'xlsx' : 'csv';
    const normalizedVariant = String(variant || 'grid').toLowerCase() === 'report' ? 'report' : 'grid';
    const busyKey = busyKeyOverride || `server:${normalizedFormat}:${normalizedVariant}`;
    setExportBusyFormat(busyKey);
    try {
      const query = new URLSearchParams({ ...queryFilters, format: normalizedFormat, variant: normalizedVariant });
      const response = await fetch(`/api/capacity/export?${query.toString()}`, {
        credentials: 'same-origin'
      });

      if (!response.ok) {
        let errorMessage = `Export failed (${response.status})`;
        try {
          const payload = await response.json();
          errorMessage = payload.error || errorMessage;
        } catch {
          const text = await response.text();
          if (text) {
            errorMessage = text;
          }
        }
        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      const filename = getFilenameFromDisposition(response.headers.get('content-disposition'), `capacity-dashboard-export.${normalizedFormat}`);
      triggerFileDownload(blob, filename);
      setAppStatus({ tone: 'success', message: `Downloaded ${filename}.` });
    } catch (error) {
      setAppStatus({ tone: 'error', message: error.message || 'Failed to export capacity data.' });
    } finally {
      setExportBusyFormat('');
    }
  }

  async function downloadClientCsvExport(option) {
    if (!option) {
      setAppStatus({ tone: 'warn', message: 'No export is configured for this report.' });
      return;
    }

    setExportBusyFormat(option.value);
    try {
      const rows = Array.isArray(option.rows) ? option.rows : [];
      if (rows.length === 0) {
        setAppStatus({ tone: 'warn', message: option.emptyMessage || 'No rows are available to export for this report.' });
        return;
      }

      const csv = buildClientCsv(option.columns, rows);
      const filename = `${sanitizeExportFilenamePart(option.filenameBase || REPORT_VIEWS.find((view) => view.key === activeView)?.label || activeView)}-${buildExportTimestamp()}.csv`;
      triggerFileDownload(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }), filename);
      setAppStatus({ tone: 'success', message: `Downloaded ${filename}.` });
    } catch (error) {
      setAppStatus({ tone: 'error', message: error.message || 'Failed to export report data.' });
    } finally {
      setExportBusyFormat('');
    }
  }

  function runSelectedExport() {
    const option = activeReportExportOptions.find((candidate) => candidate.value === selectedExportOption) || activeReportExportOptions[0];
    if (!option) {
      setAppStatus({ tone: 'warn', message: 'No export is configured for this report.' });
      return;
    }

    if (option.type === 'server') {
      downloadCapacityExport(option.format || 'csv', option.variant || 'grid', option.value);
      return;
    }

    downloadClientCsvExport(option);
  }

  async function runRecommendation() {
    if (!recommendState.targetSku) {
      setRecommendState((current) => ({ ...current, status: { tone: 'warn', message: 'Enter a target SKU to run recommendations.' } }));
      return;
    }
    const requestTargetSku = recommendState.targetSku;
    const requestRegions = recommendState.regions;
    const requestTopN = recommendState.topN;
    const requestMinScore = recommendState.minScore;
    const requestShowPricing = recommendState.showPricing;
    const requestShowSpot = recommendState.showSpot;

    setRecommendState((current) => ({ ...current, busy: true, status: { tone: 'info', message: `Running recommendations for ${requestTargetSku}...` } }));
    try {
      const payload = await fetchJson('/api/capacity/recommendations', { method: 'POST', body: JSON.stringify({ targetSku: requestTargetSku, regions: requestRegions, regionPreset: filters.regionPreset, topN: requestTopN, minScore: requestMinScore, showPricing: requestShowPricing, showSpot: requestShowSpot }) });
      const result = payload.result || null;
      const count = Array.isArray(result && result.recommendations) ? result.recommendations.length : 0;
      const belowMinSpecCount = Array.isArray(result && result.belowMinSpec) ? result.belowMinSpec.length : 0;
      const warnings = Array.isArray(result && result.warnings) ? result.warnings.filter(Boolean) : [];
      const zeroResultMessage = count === 0
        ? `Recommendation completed. No alternative SKUs met the current filters for ${requestTargetSku}.`
        : `Recommendation completed. ${count} alternative SKU(s) returned.`;
      const zeroResultDetailParts = [];
      if (count === 0) {
        zeroResultDetailParts.push(`Checked region scope: ${requestRegions || 'preset-derived regions'}.`);
        zeroResultDetailParts.push(`Minimum score: ${requestMinScore}.`);
        if (belowMinSpecCount > 0) {
          zeroResultDetailParts.push(`${belowMinSpecCount} smaller SKU(s) were found but excluded for being below the requested target spec.`);
        }
      }
      if (warnings.length > 0) {
        zeroResultDetailParts.push(warnings.join(' '));
      }
      setRecommendState((current) => ({ ...current, result, busy: false, status: { tone: count === 0 ? 'warn' : 'success', message: zeroResultMessage, detail: zeroResultDetailParts.join(' ') || null } }));
    } catch (error) {
      setRecommendState((current) => ({ ...current, result: null, busy: false, status: { tone: 'error', message: error.message || 'Failed to run recommendations.' } }));
    }
  }

  async function refreshPaaSAvailability() {
    const requestService = paasState.filters.service || 'All';
    const requestRegion = filters.region && filters.region !== 'all' ? filters.region : null;
    const requestRegionPreset = requestRegion ? null : (filters.regionPreset || 'USMajor');

    setPaaSState((current) => ({
      ...current,
      busy: { ...current.busy, refresh: true },
      status: { tone: 'info', message: `Refreshing PaaS availability for ${requestService}${requestRegion ? ` in ${requestRegion}` : ''}...` }
    }));

    try {
      const payload = await fetchJson('/api/paas-availability/refresh', {
        method: 'POST',
        body: JSON.stringify({
          service: requestService,
          regionPreset: requestRegionPreset || undefined,
          regions: requestRegion ? [requestRegion] : undefined,
          sqlResourceType: 'SqlDatabase'
        })
      });

      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      setPaaSState((current) => ({
        ...current,
        rows,
        summary: payload.summary || { rowCount: rows.length, serviceSummary: [] },
        facets: payload.facets || { services: [], regions: [], categories: [] },
        capturedAtUtc: payload.capturedAtUtc || null,
        metadata: payload.metadata || null,
        busy: { ...current.busy, refresh: false },
        status: { tone: 'success', message: `PaaS availability refreshed and saved at ${formatTimestamp(payload.capturedAtUtc)}.` }
      }));
    } catch (error) {
      setPaaSState((current) => ({
        ...current,
        busy: { ...current.busy, refresh: false },
        status: { tone: 'error', message: error.message || 'Failed to refresh PaaS availability.' }
      }));
    }
  }

  async function refreshLivePlacement() {
    if (!canRefreshLivePlacement) {
      setCapacityScores((current) => ({
        ...current,
        busy: false,
        status: {
          tone: 'warn',
          message: 'Select exactly one subscription to refresh live placement.',
          detail: livePlacementScopeMessage
        }
      }));
      return;
    }

    const desiredCount = normalizeDesiredPlacementCount(capacityScores.desiredCount);
    const filtersPayload = {
      ...queryFilters,
      subscriptionIds: livePlacementSubscriptionId,
      family: livePlacementFamily,
      desiredCount,
      extraSkus: getFamilyExtraSkus(livePlacementFamily)
    };

    setCapacityScores((current) => ({
      ...current,
      desiredCount: String(desiredCount),
      busy: true,
      status: { tone: 'info', message: 'Refreshing live placement scores...', detail: null }
    }));

    try {
      const payload = await fetchJson('/api/capacity/scores/live', {
        method: 'POST',
        body: JSON.stringify(filtersPayload)
      });
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      const requestedCount = payload.requestedDesiredCount ?? desiredCount;
      const effectiveCount = payload.effectiveDesiredCount ?? desiredCount;
      const collapsedWarning = collapseLivePlacementWarning(payload.warning);
      const summary = `Live placement refreshed at ${formatTimestamp(payload.liveCheckedAtUtc)}. Requested ${requestedCount}; evaluated ${effectiveCount}.`;

      if (payload.warning) {
        await logErrorToDatabase({
          source: 'live-placement-refresh',
          type: 'LivePlacementWarning',
          message: payload.warning,
          severity: 'warn',
          context: {
            filters: filtersPayload,
            diagnostics: payload.diagnostics || null,
            liveCheckedAtUtc: payload.liveCheckedAtUtc || null,
            source: payload.source || null
          },
          region: filters.region && filters.region !== 'all' ? filters.region : null,
          desiredCount
        });
      }

      setCapacityScores((current) => ({
        ...current,
        rows,
        pagination: {
          total: rows.length,
          pageNumber: 1,
          pageSize: current.pagination.pageSize || 50,
          pageCount: 1,
          hasNext: false,
          hasPrev: false
        },
        desiredCount: String(desiredCount),
        busy: false,
        status: {
          tone: payload.warning ? 'warn' : 'success',
          message: summary,
          detail: collapsedWarning || null
        }
      }));
    } catch (error) {
      await logErrorToDatabase({
        source: 'live-placement-refresh',
        type: error.name || 'LivePlacementError',
        message: error.message || 'Failed to refresh live placement scores.',
        stack: error.stack || null,
        severity: 'error',
        context: { filters: filtersPayload },
        region: filters.region && filters.region !== 'all' ? filters.region : null,
        desiredCount
      });

      setCapacityScores((current) => ({
        ...current,
        busy: false,
        status: {
          tone: 'error',
          message: error.message || 'Failed to refresh live placement scores.',
          detail: error.message || 'Failed to refresh live placement scores.'
        }
      }));
    }
  }

  async function handleShowSqlPreviewChange(nextValue) {
    if (!auth?.canAccessAdmin || activeView !== 'admin') {
      return;
    }

    const fallbackValue = Boolean(nextValue);
    setShowSqlPreview(fallbackValue);
    setUiSettingsBusy(true);
    try {
      const payload = await fetchJson('/api/admin/ui-settings', {
        method: 'PUT',
        body: JSON.stringify({ showSqlPreview: nextValue })
      });
      setShowSqlPreview(Boolean(payload.settings && payload.settings.showSqlPreview));
    } catch (error) {
      setShowSqlPreview(fallbackValue);
      setAppStatus({ tone: 'warn', message: 'SQL preview was updated for this session only. Saving the preference requires DashboardSetting table access.' });
    } finally {
      setUiSettingsBusy(false);
    }
  }

  const adminActions = {
    refreshStatus: async () => {
      if (!auth?.canAccessAdmin) return;
      setAdminState((current) => ({ ...current, busy: { ...current.busy, refreshStatus: true } }));
      try {
        const payload = await fetchJson('/api/admin/ingest/status');
        setAdminState((current) => ({
          ...current,
          job: payload.activeJob || null,
          status: payload.status || null,
          busy: { ...current.busy, refreshStatus: false },
          statusMessage: { tone: 'success', message: payload.activeJob?.status === 'queued' ? 'Capacity ingestion is queued.' : (payload.status?.inProgress ? 'Capacity ingestion is running.' : 'Ingestion status refreshed.') }
        }));
      } catch (error) {
        setAdminState((current) => ({ ...current, busy: { ...current.busy, refreshStatus: false }, statusMessage: { tone: 'error', message: error.message || 'Failed to refresh ingestion status.' } }));
      }
    },
    triggerIngest: async () => {
      if (!auth?.canAccessAdmin) return;
      setAdminState((current) => ({ ...current, busy: { ...current.busy, trigger: true }, statusMessage: { tone: 'info', message: 'Starting capacity ingestion...' } }));
      try {
        const payload = await fetchJson('/api/admin/ingest/capacity', { method: 'POST', body: JSON.stringify({ regionPreset: filters.regionPreset === 'all' || filters.regionPreset === 'custom' ? undefined : filters.regionPreset }) });
        setAdminState((current) => ({ ...current, job: payload.jobId ? { jobId: payload.jobId, status: payload.status, createdAtUtc: payload.createdAtUtc, startedAtUtc: payload.startedAtUtc, completedAtUtc: payload.completedAtUtc, error: payload.error || null, result: payload.result || null } : current.job, status: payload.statusSnapshot || current.status, busy: { ...current.busy, trigger: false }, statusMessage: { tone: 'success', message: payload.status === 'queued' ? 'Capacity ingestion queued. Monitoring progress...' : 'Capacity ingestion started. Monitoring progress...' } }));
      } catch (error) {
        setAdminState((current) => ({ ...current, busy: { ...current.busy, trigger: false }, statusMessage: { tone: 'error', message: error.message || 'Failed to start capacity ingestion.' } }));
      }
    },
    refreshModelCatalog: async () => {
      if (!auth?.canAccessAdmin) return;
      setAdminState((current) => ({ ...current, busy: { ...current.busy, refreshModelCatalog: true }, statusMessage: { tone: 'info', message: 'Refreshing AI model library...' } }));
      try {
        const payload = await fetchJson('/api/admin/ingest/model-catalog', { method: 'POST', body: JSON.stringify({ regionPreset: filters.regionPreset === 'all' || filters.regionPreset === 'custom' ? undefined : filters.regionPreset }) });
        setAdminState((current) => ({ ...current, busy: { ...current.busy, refreshModelCatalog: false }, statusMessage: { tone: 'success', message: `AI model library refreshed — ${payload.insertedAIModelRows || 0} model rows ingested.` } }));
      } catch (error) {
        setAdminState((current) => ({ ...current, busy: { ...current.busy, refreshModelCatalog: false }, statusMessage: { tone: 'error', message: error.message || 'Failed to refresh AI model library.' } }));
      }
    },
    refreshSchedule: async () => {
      if (!auth?.canAccessAdmin) return;
      setAdminState((current) => ({ ...current, busy: { ...current.busy, refreshSchedule: true } }));
      try {
        const payload = await fetchJson('/api/admin/ingest/schedule');
        setAdminState((current) => ({ ...current, schedule: payload.settings || current.schedule, runtime: payload.runtime || current.runtime, persistence: payload.persistence || current.persistence, busy: { ...current.busy, refreshSchedule: false }, statusMessage: payload.persistence && payload.persistence.available === false ? { tone: 'warn', message: payload.persistence.message || 'Scheduler settings are running in read-only runtime mode.' } : { tone: 'success', message: 'Scheduler settings reloaded.' } }));
      } catch (error) {
        setAdminState((current) => ({ ...current, busy: { ...current.busy, refreshSchedule: false }, statusMessage: { tone: 'error', message: error.message || 'Failed to load scheduler settings.' } }));
      }
    },
    saveSchedule: async () => {
      if (!auth?.canAccessAdmin) return;
      if (adminState.persistence && adminState.persistence.available === false) {
        setAdminState((current) => ({ ...current, statusMessage: { tone: 'warn', message: current.persistence?.message || 'Scheduler settings are read-only in this environment.' } }));
        return;
      }
      setAdminState((current) => ({ ...current, busy: { ...current.busy, saveSchedule: true }, statusMessage: { tone: 'info', message: 'Saving scheduler settings...' } }));
      try {
        const payload = await fetchJson('/api/admin/ingest/schedule', { method: 'PUT', body: JSON.stringify(adminState.schedule) });
        setAdminState((current) => ({ ...current, schedule: payload.settings || current.schedule, runtime: payload.runtime || current.runtime, persistence: payload.persistence || current.persistence, busy: { ...current.busy, saveSchedule: false }, statusMessage: { tone: 'success', message: 'Scheduler settings saved and applied.' } }));
      } catch (error) {
        setAdminState((current) => ({ ...current, busy: { ...current.busy, saveSchedule: false }, statusMessage: { tone: 'error', message: error.message || 'Failed to save scheduler settings.' } }));
      }
    }
  };

  const quotaActions = {
    discover: async () => {
      if (!auth?.isAuthenticated) return;
      setQuotaState((current) => ({ ...current, busy: { ...current.busy, discover: true } }));
      try {
        const payload = await fetchJson(`/api/quota/groups?managementGroupId=${encodeURIComponent(quotaState.selectedManagementGroup)}`);
        setQuotaState((current) => ({ ...current, quotaGroups: Array.isArray(payload.groups) ? payload.groups : [], busy: { ...current.busy, discover: false }, status: { tone: 'success', message: `Discovered ${Array.isArray(payload.groups) ? payload.groups.length : 0} quota group(s).` } }));
      } catch (error) {
        setQuotaState((current) => ({ ...current, busy: { ...current.busy, discover: false }, status: { tone: 'error', message: error.message || 'Failed to discover quota groups.' } }));
      }
    },
    loadShareableReport: async () => {
      if (!auth?.isAuthenticated || quotaState.selectedQuotaGroup === 'all') return;
      setQuotaState((current) => ({ ...current, busy: { ...current.busy, shareableReport: true } }));
      try {
        const payload = await fetchJson(`/api/quota/shareable-report?${new URLSearchParams({ managementGroupId: quotaState.selectedManagementGroup, groupQuotaName: quotaState.selectedQuotaGroup }).toString()}`);
        setQuotaState((current) => ({ ...current, shareableReport: { rows: Array.isArray(payload.rows) ? payload.rows : [], summary: payload.summary || current.shareableReport.summary, generatedAtUtc: payload.generatedAtUtc || null }, busy: { ...current.busy, shareableReport: false }, status: { tone: 'success', message: `Loaded ${payload.summary?.rowCount || 0} quota deficit row(s) for ${payload.groupQuotaName || quotaState.selectedQuotaGroup}.` } }));
      } catch (error) {
        setQuotaState((current) => ({ ...current, shareableReport: { rows: [], summary: { rowCount: 0, subscriptionCount: 0, regionCount: 0, skuCount: 0, totalShareableQuota: 0 }, generatedAtUtc: null }, busy: { ...current.busy, shareableReport: false }, status: { tone: 'error', message: error.message || 'Failed to load quota allocation report.' } }));
      }
    },
    generate: async () => {
      if (!auth?.canAccessAdmin) return;
      setQuotaState((current) => ({ ...current, busy: { ...current.busy, generate: true } }));
      try {
        const query = new URLSearchParams({ managementGroupId: quotaState.selectedManagementGroup, groupQuotaName: quotaState.selectedQuotaGroup, region: 'all', family: 'all', subscriptionIds: '' });
        const payload = await fetchJson(`/api/quota/candidates?${query.toString()}`);
        setQuotaState((current) => ({ ...current, candidates: Array.isArray(payload.candidates) ? payload.candidates : [], selectedDonorSubscriptionId: '', selectedMoveCandidate: null, requestedTransferAmount: 0, applyResults: [], busy: { ...current.busy, generate: false }, status: { tone: 'success', message: `Generated ${payload.candidateCount || 0} candidate row(s). Filter to a movable or needed row and send it to the move planner.` } }));
      } catch (error) {
        setQuotaState((current) => ({ ...current, busy: { ...current.busy, generate: false }, status: { tone: 'error', message: error.message || 'Failed to generate quota candidates.' } }));
      }
    },
    capture: async () => {
      if (!auth?.canAccessAdmin) return;
      setQuotaState((current) => ({ ...current, busy: { ...current.busy, capture: true } }));
      try {
        const payload = await fetchJson('/api/quota/candidates/capture', { method: 'POST', body: JSON.stringify({ managementGroupId: quotaState.selectedManagementGroup, groupQuotaName: quotaState.selectedQuotaGroup, region: 'all', family: 'all' }) });
        const runsPayload = await fetchJson(`/api/quota/candidate-runs?${new URLSearchParams({ managementGroupId: quotaState.selectedManagementGroup, groupQuotaName: quotaState.selectedQuotaGroup, region: 'all', family: 'all', subscriptionIds: '' }).toString()}`);
        setQuotaState((current) => ({ ...current, quotaRuns: Array.isArray(runsPayload.runs) ? runsPayload.runs : [], busy: { ...current.busy, capture: false }, status: { tone: 'success', message: `Captured history for run ${payload.analysisRunId || 'n/a'}.` } }));
      } catch (error) {
        setQuotaState((current) => ({ ...current, busy: { ...current.busy, capture: false }, status: { tone: 'error', message: error.message || 'Failed to capture quota history.' } }));
      }
    },
    refresh: async () => {
      if (!auth?.isAuthenticated) return;
      setQuotaState((current) => ({ ...current, busy: { ...current.busy, refresh: true } }));
      try {
        const [groupsPayload, runsPayload, shareablePayload] = await Promise.all([
          fetchJson(`/api/quota/groups?managementGroupId=${encodeURIComponent(quotaState.selectedManagementGroup)}`),
          quotaState.selectedQuotaGroup !== 'all'
            ? fetchJson(`/api/quota/candidate-runs?${new URLSearchParams({ managementGroupId: quotaState.selectedManagementGroup, groupQuotaName: quotaState.selectedQuotaGroup, region: 'all', family: 'all', subscriptionIds: '' }).toString()}`)
            : Promise.resolve({ runs: [] }),
          quotaState.selectedQuotaGroup !== 'all'
            ? fetchJson(`/api/quota/shareable-report?${new URLSearchParams({ managementGroupId: quotaState.selectedManagementGroup, groupQuotaName: quotaState.selectedQuotaGroup }).toString()}`)
            : Promise.resolve({ rows: [], summary: { rowCount: 0, subscriptionCount: 0, regionCount: 0, skuCount: 0, totalShareableQuota: 0 }, generatedAtUtc: null })
        ]);
        setQuotaState((current) => ({ ...current, quotaGroups: Array.isArray(groupsPayload.groups) ? groupsPayload.groups : [], quotaRuns: Array.isArray(runsPayload.runs) ? runsPayload.runs : [], shareableReport: { rows: Array.isArray(shareablePayload.rows) ? shareablePayload.rows : [], summary: shareablePayload.summary || current.shareableReport.summary, generatedAtUtc: shareablePayload.generatedAtUtc || null }, busy: { ...current.busy, refresh: false }, status: { tone: 'success', message: 'Quota analytics refreshed.' } }));
      } catch (error) {
        setQuotaState((current) => ({ ...current, busy: { ...current.busy, refresh: false }, status: { tone: 'error', message: error.message || 'Failed to refresh quota analytics.' } }));
      }
    },
    refreshRuns: async () => {
      if (!auth?.canAccessAdmin || quotaState.selectedQuotaGroup === 'all') return;
      setQuotaState((current) => ({ ...current, busy: { ...current.busy, refreshRuns: true } }));
      try {
        const runsPayload = await fetchJson(`/api/quota/candidate-runs?${new URLSearchParams({ managementGroupId: quotaState.selectedManagementGroup, groupQuotaName: quotaState.selectedQuotaGroup, region: 'all', family: 'all', subscriptionIds: '' }).toString()}`);
        const runs = Array.isArray(runsPayload.runs) ? runsPayload.runs : [];
        setQuotaState((current) => ({ ...current, quotaRuns: runs, selectedAnalysisRunId: current.selectedAnalysisRunId || (runs[0] ? runs[0].analysisRunId : ''), selectedDonorSubscriptionId: '', busy: { ...current.busy, refreshRuns: false }, status: { tone: 'success', message: `Loaded ${runs.length} captured run(s).` } }));
      } catch (error) {
        setQuotaState((current) => ({ ...current, busy: { ...current.busy, refreshRuns: false }, status: { tone: 'error', message: error.message || 'Failed to load captured runs.' } }));
      }
    },
    buildPlan: async () => {
      if (!auth?.canAccessAdmin || !quotaState.selectedAnalysisRunId || quotaState.selectedQuotaGroup === 'all' || !quotaState.selectedMoveCandidate) return;
      setQuotaState((current) => ({ ...current, busy: { ...current.busy, plan: true }, impactRows: [], applyResults: [] }));
      try {
        const payload = await fetchJson(`/api/quota/plan?${new URLSearchParams({ managementGroupId: quotaState.selectedManagementGroup, groupQuotaName: quotaState.selectedQuotaGroup, analysisRunId: quotaState.selectedAnalysisRunId, donorSubscriptionId: quotaState.selectedMoveCandidate.mode === 'donor' ? quotaState.selectedMoveCandidate.donorSubscriptionId : quotaState.selectedDonorSubscriptionId, recipientSubscriptionId: quotaState.selectedMoveCandidate.mode === 'recipient' ? quotaState.selectedMoveCandidate.recipientSubscriptionId : '', selectedSku: quotaState.selectedMoveCandidate.selectedSku || '', transferAmount: String(quotaState.requestedTransferAmount || 0), region: quotaState.selectedMoveCandidate.region, family: quotaState.selectedMoveCandidate.quotaName }).toString()}`);
        setQuotaState((current) => ({ ...current, planRows: Array.isArray(payload.planRows) ? payload.planRows : [], applyResults: [], planSummary: payload || {}, busy: { ...current.busy, plan: false }, status: { tone: 'success', message: `Built ${payload.planRowCount || 0} move-plan row(s).` } }));
      } catch (error) {
        setQuotaState((current) => ({ ...current, busy: { ...current.busy, plan: false }, status: { tone: 'error', message: error.message || 'Failed to build quota move plan.' } }));
      }
    },
    simulatePlan: async () => {
      if (!auth?.canAccessAdmin || !quotaState.selectedAnalysisRunId || quotaState.selectedQuotaGroup === 'all' || !quotaState.selectedMoveCandidate) return;
      setQuotaState((current) => ({ ...current, busy: { ...current.busy, simulate: true } }));
      try {
        const payload = await fetchJson('/api/quota/simulate', { method: 'POST', body: JSON.stringify({ managementGroupId: quotaState.selectedManagementGroup, groupQuotaName: quotaState.selectedQuotaGroup, analysisRunId: quotaState.selectedAnalysisRunId, donorSubscriptionId: quotaState.selectedMoveCandidate.mode === 'donor' ? quotaState.selectedMoveCandidate.donorSubscriptionId : quotaState.selectedDonorSubscriptionId, recipientSubscriptionId: quotaState.selectedMoveCandidate.mode === 'recipient' ? quotaState.selectedMoveCandidate.recipientSubscriptionId : '', selectedSku: quotaState.selectedMoveCandidate.selectedSku || '', transferAmount: quotaState.requestedTransferAmount || 0, region: quotaState.selectedMoveCandidate.region, family: quotaState.selectedMoveCandidate.quotaName }) });
        setQuotaState((current) => ({ ...current, planRows: Array.isArray(payload.planRows) ? payload.planRows : current.planRows, impactRows: Array.isArray(payload.impactRows) ? payload.impactRows : [], applyResults: [], planSummary: payload || {}, busy: { ...current.busy, simulate: false }, status: { tone: 'success', message: `Simulation completed for ${payload.impactedRowCount || 0} impacted row(s).` } }));
      } catch (error) {
        setQuotaState((current) => ({ ...current, busy: { ...current.busy, simulate: false }, status: { tone: 'error', message: error.message || 'Failed to simulate quota move plan.' } }));
      }
    },
    applyPlan: async () => {
      if (!auth?.canAccessAdmin || !quotaState.selectedAnalysisRunId || quotaState.selectedQuotaGroup === 'all' || !quotaState.selectedMoveCandidate || !quotaState.planRows.length) return;
      setQuotaState((current) => ({ ...current, busy: { ...current.busy, apply: true }, status: { tone: 'info', message: 'Quota apply queued. Waiting for backend execution...' } }));
      try {
        const queuedPayload = await fetchJson('/api/quota/apply', { method: 'POST', body: JSON.stringify({ managementGroupId: quotaState.selectedManagementGroup, groupQuotaName: quotaState.selectedQuotaGroup, analysisRunId: quotaState.selectedAnalysisRunId, donorSubscriptionId: quotaState.selectedMoveCandidate.mode === 'donor' ? quotaState.selectedMoveCandidate.donorSubscriptionId : quotaState.selectedDonorSubscriptionId, recipientSubscriptionId: quotaState.selectedMoveCandidate.mode === 'recipient' ? quotaState.selectedMoveCandidate.recipientSubscriptionId : '', selectedSku: quotaState.selectedMoveCandidate.selectedSku || '', transferAmount: quotaState.requestedTransferAmount || 0, region: quotaState.selectedMoveCandidate.region, family: quotaState.selectedMoveCandidate.quotaName, maxChanges: quotaState.planRows.length, async: true }) });
        const payload = queuedPayload.jobId ? await waitForQuotaApplyJob(queuedPayload.jobId) : queuedPayload;
        setQuotaState((current) => ({ ...current, planRows: Array.isArray(payload.planRows) ? payload.planRows : current.planRows, applyResults: Array.isArray(payload.applyResults) ? payload.applyResults : [], planSummary: payload || {}, busy: { ...current.busy, apply: false }, status: { tone: payload.failureCount > 0 ? 'warning' : 'success', message: payload.failureCount > 0 ? `Apply completed with ${payload.failureCount} failed submission(s). Review Apply Results.` : `Applied ${payload.submittedChangeCount || 0} quota change(s).` } }));
      } catch (error) {
        setQuotaState((current) => ({ ...current, busy: { ...current.busy, apply: false }, status: { tone: 'error', message: error.message || 'Failed to apply quota move plan.' } }));
      }
    }
  };

  const filteredSubscriptionOptions = useMemo(() => {
    const term = String(subscriptionSearch || '').trim().toLowerCase();
    return subscriptionOptions.filter((option) => !term || String(option.subscriptionName || '').toLowerCase().includes(term) || String(option.subscriptionId || '').toLowerCase().includes(term));
  }, [subscriptionOptions, subscriptionSearch]);

  const donorOptions = useMemo(() => {
    const donorMap = new Map();

    quotaState.candidates
      .filter((candidate) => {
        if (Number(candidate.suggestedMovable || candidate.movableQuota || 0) <= 0) {
          return false;
        }

        if (!quotaState.selectedMoveCandidate) {
          return true;
        }

        if (candidate.subscriptionId === quotaState.selectedMoveCandidate.recipientSubscriptionId) {
          return false;
        }

        if (candidate.region !== quotaState.selectedMoveCandidate.region || candidate.family !== quotaState.selectedMoveCandidate.quotaName) {
          return false;
        }

        return true;
      })
      .forEach((candidate) => {
        const movable = Number(candidate.suggestedMovable || candidate.movableQuota || 0);
        const existing = donorMap.get(candidate.subscriptionId);
        if (existing) {
          existing.suggestedMovable += movable;
          return;
        }

        donorMap.set(candidate.subscriptionId, {
          subscriptionId: candidate.subscriptionId,
          subscriptionName: candidate.subscriptionName || candidate.subscriptionId,
          suggestedMovable: movable
        });
      });

    return [...donorMap.values()].sort((left, right) => right.suggestedMovable - left.suggestedMovable || left.subscriptionName.localeCompare(right.subscriptionName));
  }, [quotaState.candidates, quotaState.selectedMoveCandidate]);

  useEffect(() => {
    if (quotaState.selectedMoveCandidate?.mode === 'donor') {
      if (quotaState.selectedDonorSubscriptionId !== quotaState.selectedMoveCandidate.donorSubscriptionId) {
        setQuotaState((current) => ({ ...current, selectedDonorSubscriptionId: current.selectedMoveCandidate?.donorSubscriptionId || '' }));
      }
      return;
    }

    if (!donorOptions.length) {
      if (quotaState.selectedDonorSubscriptionId) {
        setQuotaState((current) => ({ ...current, selectedDonorSubscriptionId: '' }));
      }
      return;
    }

    const selectedStillValid = donorOptions.some((option) => option.subscriptionId === quotaState.selectedDonorSubscriptionId);
    if (!selectedStillValid) {
      setQuotaState((current) => ({ ...current, selectedDonorSubscriptionId: donorOptions[0].subscriptionId }));
    }
  }, [donorOptions, quotaState.selectedDonorSubscriptionId]);

  if (!authResolved) {
    return (
      <div className="rx-access-gate">
        <section className="rx-panel rx-access-gate__panel">
          <div className="rx-kicker">Checking Access</div>
          <h1>Loading</h1>
          <p>Verifying your session for the Capacity Dashboard.</p>
        </section>
      </div>
    );
  }

  if (auth?.authEnabled && auth.isAuthenticated === false) {
    return (
      <div className="rx-access-gate">
        <section className="rx-panel rx-access-gate__panel">
          <div className="rx-kicker">Access Restricted</div>
          <h1>You do not have access</h1>
          <p>This Capacity Dashboard is only available to authenticated users.</p>
          <a className="rx-link-button" href="/auth/login">Sign In</a>
        </section>
      </div>
    );
  }

  const viewContent = (() => {
    if (activeView === 'capacity-grid') {
      return <div className="rx-view-stack"><DataTable key="capacity-grid" title="Capacity Grid" subtitle="Server-paged capacity observations using the shared API contract." columns={[{ key: 'subscriptionName', label: 'Subscription', headerClassName: 'rx-capacity-grid__subscription', cellClassName: 'rx-capacity-grid__subscription' }, { key: 'region', label: 'Region' }, { key: 'sku', label: 'SKU', render: (row) => normalizeSkuName(row.sku) || 'n/a' }, { key: 'family', label: 'Family', render: (row) => formatFamilyLabel(row.family) || 'n/a' }, ...(filters.resourceType === 'AI' ? [{ key: 'provider', label: 'AI Provider', render: (row) => getAIQuotaProviderDisplay(row), sortValue: (row) => getAIQuotaProviderLabel(row) }] : []), { key: 'availability', label: 'Availability', render: (row) => <StatusPill value={row.availability} /> }, { key: 'quotaCurrent', label: 'Current', render: (row) => formatNumber(row.quotaCurrent) }, { key: 'quotaLimit', label: 'Limit', render: (row) => formatNumber(row.quotaLimit) }, { key: 'available', label: 'Available', render: (row) => formatNumber(Number(row.quotaLimit || 0) - Number(row.quotaCurrent || 0)) }]} rows={capacityData.rows} emptyMessage="No capacity rows returned for the current filters." /><ServerPagination pagination={capacityData.pagination} onPageChange={(pageNumber) => setCapacityData((current) => ({ ...current, pagination: { ...current.pagination, pageNumber: Math.max(1, pageNumber) } }))} onPageSizeChange={(pageSize) => setCapacityData((current) => ({ ...current, pagination: { ...current.pagination, pageNumber: 1, pageSize: Math.max(1, pageSize) } }))} /></div>;
    }
    if (activeView === 'region-health') {
      return <div className="rx-view-stack"><section className="rx-panel rx-panel--compact rx-panel--muted"><div className="rx-panel__header"><div><h2>How to read this report</h2><p>Use Region Health to compare how much deployable breadth each region still has under the current filter scope. In this rollup, an observation is counted as deployable when availability is <strong>OK</strong> or <strong>LIMITED</strong>; constrained observations are the entries marked <strong>CONSTRAINED</strong> or <strong>RESTRICTED</strong>.</p></div></div><div className="rx-matrix-key rx-matrix-key--compact"><div className="rx-matrix-key__group"><h3>Capacity Scope</h3><div className="rx-matrix-key__item"><div><strong>Observed Capacity</strong><p>Returned SKU or quota observations in the region.</p></div></div><div className="rx-matrix-key__item"><div><strong>Deployable Capacity</strong><p>Observations still usable for placement, even if some limits remain.</p></div></div></div><div className="rx-matrix-key__group"><h3>Breadth Signals</h3><div className="rx-matrix-key__item"><div><strong>Deployable Families</strong><p>Distinct families with at least one deployable observation.</p></div></div><div className="rx-matrix-key__item"><div><strong>Quota Headroom</strong><p>Summed <code>quotaLimit - quotaCurrent</code>; compare within the same scope, not across mixed quota dimensions.</p></div></div></div></div><p className="rx-selected-count">A stronger region usually shows more deployable observations across more families and subscriptions, with a shorter constrained-family list. If every region collapses to a few deployable families, the report is signaling concentration risk rather than broad capacity health.</p></section><DataTable key="region-health" title="Region Health" subtitle="Operational rollup of deployable inventory, constrained inventory, and family breadth by region." columns={[{ key: 'region', label: 'Region' }, { key: 'totalRows', label: 'Observed Capacity', render: (row) => formatNumber(row.totalRows) }, { key: 'deployableRows', label: 'Deployable Capacity', render: (row) => formatNumber(row.deployableRows) }, { key: 'constrainedRows', label: 'Constrained Capacity', render: (row) => formatNumber(row.constrainedRows) }, { key: 'totalQuotaHeadroom', label: 'Quota Headroom', render: (row) => formatNumber(Math.round(row.totalQuotaHeadroom)) }, { key: 'deployableFamilyCount', label: 'Deployable Families', render: (row) => formatNumber(row.deployableFamilyCount) }, { key: 'deployableSubscriptionCount', label: 'Subscriptions With Capacity', render: (row) => formatNumber(row.deployableSubscriptionCount) }, ...(filters.resourceType === 'AI' ? [{ key: 'providers', label: 'Providers', render: (row) => row.providers.join(', ') || 'n/a', sortValue: (row) => row.providers.join(',') }] : []), { key: 'topConstrainedFamilies', label: 'Most Constrained Families', render: (row) => row.topConstrainedFamilies.join(', ') || 'n/a' }]} rows={regionHealth} emptyMessage="No region health data for this filter scope." /></div>;
    }
    if (activeView === 'recommender') {
      const recommendations = Array.isArray(recommendState.result && recommendState.result.recommendations) ? recommendState.result.recommendations : [];
      return <div className="rx-view-stack"><Banner tone={recommendState.status.tone} message={recommendState.status.message} detail={recommendState.status.detail} /><section className="rx-panel"><div className="rx-panel__header"><div><h2>Capacity Recommender</h2><p>Same backend recommendation API, but staged into a clearer React workflow.</p></div></div><div className="rx-field-grid rx-field-grid--filters"><label className="rx-field"><span>Target SKU</span><select className="rx-input" value={recommendationSkuPickerOptions.includes(recommendState.targetSku) ? recommendState.targetSku : ''} onChange={(event) => setRecommendState({ ...recommendState, targetSku: normalizeSkuName(event.target.value), autoTargetSku: recommendState.autoTargetSku })} disabled={recommendationSkuPickerOptions.length === 0}><option value="">{recommendationSkuPickerOptions.length > 0 ? 'Pick scoped size' : 'No scoped SKUs available'}</option>{recommendationSkuPickerOptions.map((sku) => <option key={sku} value={sku}>{sku}</option>)}</select></label><label className="rx-field"><span>Regions</span><input className="rx-input" value={recommendState.regions} onChange={(event) => setRecommendState({ ...recommendState, regions: event.target.value, autoRegions: recommendState.autoRegions })} placeholder="eastus,westus2" /></label><label className="rx-field"><span>Top N</span><input className="rx-input" type="number" min="1" max="25" value={recommendState.topN} onChange={(event) => setRecommendState({ ...recommendState, topN: Number(event.target.value || 10) })} /></label><label className="rx-field"><span>Min Score</span><input className="rx-input" type="number" min="0" max="100" value={recommendState.minScore} onChange={(event) => setRecommendState({ ...recommendState, minScore: Number(event.target.value || 50) })} /></label></div><div className="rx-inline-actions"><span className="rx-selected-count">Scoped default SKU: {recommendedTargetSku || 'n/a'}</span><span className="rx-selected-count">Scoped default Regions: {recommendedRegions || 'n/a'}</span>{selectedScopedSku ? <span className="rx-selected-count">Sidebar SKU pinned: {selectedScopedSku}</span> : null}{recommenderFamilySkuOptions.length > 0 ? <span className="rx-selected-count">Known SKUs in family: {recommenderFamilySkuOptions.length}</span> : null}<label className="rx-check"><input type="checkbox" checked={recommendState.showPricing} onChange={(event) => setRecommendState({ ...recommendState, showPricing: event.target.checked })} />Show pricing</label><label className="rx-check"><input type="checkbox" checked={recommendState.showSpot} onChange={(event) => setRecommendState({ ...recommendState, showSpot: event.target.checked })} />Show spot</label><button className="rx-button" type="button" disabled={recommendState.busy} onClick={runRecommendation}>{recommendState.busy ? 'Running...' : 'Run Recommendation'}</button></div></section><DataTable title="Recommendation Results" columns={[{ key: 'rank', label: '#' }, { key: 'sku', label: 'SKU', render: (row) => normalizeSkuName(row.sku) || 'n/a' }, { key: 'region', label: 'Region' }, { key: 'vCPU', label: 'vCPU' }, { key: 'memGiB', label: 'Mem(GB)' }, { key: 'score', label: 'Score', render: (row) => `${row.score || 0}%` }, { key: 'cpu', label: 'CPU' }, { key: 'disk', label: 'Disk' }, { key: 'purpose', label: 'Type' }, { key: 'capacity', label: 'Capacity', render: (row) => <StatusPill value={row.capacity} /> }, { key: 'zonesOK', label: 'Zones' }, { key: 'priceHr', label: '$/Hr', render: (row) => formatMoney(row.priceHr, 2) }, { key: 'priceMo', label: '$/Mo', render: (row) => formatMoney(row.priceMo, 0) }]} rows={recommendations} emptyMessage="Run a recommendation to see results." /></div>;
    }
    if (activeView === 'paas-availability') {
      return <div className="rx-view-stack"><section className="rx-panel rx-panel--compact"><div className="rx-panel__header"><div><h2>PaaS Availability</h2><p>Runs the vendored Get-AzPaaSAvailability scanner, then serves the latest saved snapshot from SQL for fast reloads.</p></div></div><div className="rx-field-grid rx-field-grid--filters"><label className="rx-field"><span>Service Scope</span><select value={paasState.filters.service} onChange={(event) => setPaaSState((current) => ({ ...current, filters: { ...current.filters, service: event.target.value } }))}>{PAAS_SERVICE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div><div className="rx-inline-actions"><span className="rx-selected-count">Regional scope: {filters.region && filters.region !== 'all' ? filters.region : (filters.regionPreset || 'all preset')}</span><span className="rx-selected-count">Subscription scope: {paasSubscriptionScope}</span><span className="rx-selected-count">Latest run: {paasState.capturedAtUtc ? formatTimestamp(paasState.capturedAtUtc) : 'none yet'}</span><button className="rx-button" type="button" disabled={paasState.busy.refresh} onClick={refreshPaaSAvailability}>{paasState.busy.refresh ? 'Refreshing...' : 'Refresh PaaS Availability'}</button></div><Banner tone={paasState.status.tone} message={paasState.status.message} detail={paasSubscriptionNote} /></section><section className="rx-panel rx-panel--compact rx-panel--muted"><div className="rx-panel__header"><div><h2>Snapshot Summary</h2><p>Displayed counts honor the sidebar regional scope. Refresh uses the same scope, but subscription selection does not apply to PaaS yet.</p></div></div><div className="rx-summary-grid"><article className="rx-metric-card"><span>Entries</span><strong>{formatNumber(filteredPaaSData.rowCount)}</strong></article><article className="rx-metric-card"><span>Services</span><strong>{formatNumber(filteredPaaSData.facets.services.length)}</strong></article><article className="rx-metric-card"><span>Regions</span><strong>{formatNumber(filteredPaaSData.facets.regions.length)}</strong></article><article className="rx-metric-card"><span>Categories</span><strong>{formatNumber(filteredPaaSData.facets.categories.length)}</strong></article></div><p className="rx-selected-count">Snapshot subscription scope: {paasSubscriptionScope}. {paasSubscriptionNote}</p></section><SortableMatrixTable title="PaaS Region Matrix" subtitle="Service-by-region readiness across the current sidebar scope using the latest saved PaaS scan rows." tableClassName="rx-matrix-table rx-matrix-table--paas" primaryColumn={{ key: 'service', label: 'Service', render: (row) => formatPaaSMatrixServiceLabel(row.service) }} statusColumn={{ key: 'rowStatus', label: 'Key', render: (row) => <StatusPill value={row.rowStatus === 'CAUTION' ? 'PARTIAL' : row.rowStatus} />, sortValue: (row) => getStatusSortValue(row.rowStatus) }} readyColumn={{ key: 'readyRegionCount', label: 'Ready', render: (row) => formatNumber(row.readyRegionCount) }} dynamicColumns={transposedPaaSMatrix.regions.map((region) => ({ key: region, label: region }))} rows={transposedPaaSMatrix.rows} emptyMessage="No PaaS matrix rows available for the current scope." rowKey={(row) => row.service} getRowClassName={(row) => `rx-matrix-row rx-matrix-row--${String(row.rowStatus || 'blocked').toLowerCase()}`} getDynamicSortValue={(row, region) => { const cell = row.regionMap[region]; return getStatusSortValue(transposedPaaSMatrix.resolveCellStatus(cell), cell && cell.availableCount); }} renderDynamicCell={(row, region) => { const cell = row.regionMap[region]; const status = transposedPaaSMatrix.resolveCellStatus(cell); return <div className="rx-matrix-cell">{status === 'EMPTY' ? <span className="rx-matrix-cell__empty">-</span> : <><StatusPill value={status} />{cell && cell.availableCount > 1 ? <span className="rx-matrix-cell__count">{formatNumber(cell.availableCount)}</span> : null}</>}</div>; }} /><DataTable title="PaaS Snapshot Rows" subtitle="Latest persisted scan rows served from SQL, filtered by the sidebar regional scope. Subscription scope is shown above." tableClassName="rx-table--dense" sectionClassName="rx-panel--compact" columns={[{ key: 'service', label: 'Service' }, { key: 'region', label: 'Region' }, { key: 'category', label: 'Category' }, { key: 'name', label: 'Name', render: (row) => row.displayName || row.name || 'n/a' }, { key: 'edition', label: 'Edition', render: (row) => row.edition || 'n/a' }, { key: 'tier', label: 'Tier', render: (row) => row.tier || 'n/a' }, { key: 'status', label: 'Status', render: (row) => <StatusPill value={row.status || (row.available ? 'Available' : 'Unknown')} /> }, { key: 'quotaCurrent', label: 'Quota Used', render: (row) => formatNullableNumber(row.quotaCurrent) }, { key: 'quotaLimit', label: 'Quota Limit', render: (row) => formatNullableNumber(row.quotaLimit) }, { key: 'metric', label: 'Metric', render: (row) => formatPaaSMetric(row), sortValue: (row) => `${row.metricPrimary || ''}|${row.metricSecondary || ''}` }]} rows={filteredPaaSRows} pageSize={25} emptyMessage="No PaaS snapshot rows available for the current sidebar scope." /></div>;
    }
    if (activeView === 'sku-chart') {
      return <DataTable key="sku-chart" title="Top SKUs" subtitle="Ranked by total available quota across the current filter scope." columns={[{ key: 'sku', label: 'SKU' }, { key: 'available', label: 'Available Quota', render: (row) => formatNumber(row.available) }]} rows={topSkus} emptyMessage="No SKU rollup data available." />;
    }
    if (activeView === 'ai-summary-report') {
      return <AIModelSummaryReportView rows={aiModelRows} status={aiModelState.status} loading={aiModelState.loading} availableRegions={scopedRegionOptions} />;
    }
    if (activeView === 'ai-model-availability') {
      return <AIModelAvailabilityView rows={aiModelRows} status={aiModelState.status} loading={aiModelState.loading} filters={aiModelFilters} />;
    }
    if (activeView === 'capacity-score') {
      return <div className="rx-view-stack"><section className="rx-panel rx-panel--compact"><div className="rx-panel__header"><div><h2>Regional SKU Capacity Score</h2><p>Derived capacity score plus the latest saved or refreshed live placement details.</p></div></div><div className="rx-field-grid rx-field-grid--filters"><label className="rx-field"><span>Desired Placement Count</span><input className="rx-input" type="number" min="1" max="1000" value={capacityScores.desiredCount} onChange={(event) => setCapacityScores((current) => ({ ...current, desiredCount: String(normalizeDesiredPlacementCount(event.target.value)), pagination: { ...current.pagination, pageNumber: 1 } }))} /></label><label className="rx-field rx-field--wide"><span>Live Placement Subscription</span><select value={livePlacementSubscriptionId} onChange={(event) => setLivePlacementSubscriptionId(event.target.value)}><option value="">Select subscription</option>{subscriptionOptions.map((option) => <option key={option.subscriptionId} value={option.subscriptionId}>{option.subscriptionName || option.subscriptionId} ({option.subscriptionId})</option>)}</select></label><label className="rx-field"><span>Live Placement Family</span><select value={livePlacementFamily} onChange={(event) => setLivePlacementFamily(event.target.value)}><option value="">Select family</option>{livePlacementFamilyOptions.map((family) => <option key={family} value={family}>{formatFamilyLabel(family) || family}</option>)}</select></label></div><div className="rx-inline-actions"><span className="rx-selected-count">{livePlacementScopeMessage}</span><button className="rx-button" type="button" disabled={capacityScores.busy || !canRefreshLivePlacement} onClick={refreshLivePlacement}>{capacityScores.busy ? 'Refreshing...' : 'Refresh Live Placement'}</button></div><Banner tone={capacityScores.status.tone} message={capacityScores.status.message} detail={capacityScores.status.detail} /></section><section className="rx-panel rx-panel--compact rx-panel--muted"><div className="rx-panel__header"><div><h2>Capacity Score Key</h2><p>Use this legend to distinguish saved capacity signals from live Azure placement responses.</p></div></div><div className="rx-matrix-key rx-matrix-key--compact"><div className="rx-matrix-key__group"><h3>Capacity Score</h3>{capacityScoreLegendItems().map((item) => <div key={item.value} className="rx-matrix-key__item"><StatusPill value={item.value} label={item.title} /><div><p>{item.description}</p></div></div>)}</div><div className="rx-matrix-key__group"><h3>Azure Live Score</h3>{livePlacementLegendItems().map((item) => <div key={item.value} className="rx-matrix-key__item"><StatusPill value={item.value} /><div><p>{item.description}</p></div></div>)}<div className="rx-matrix-key__item"><div><strong>Last Checked</strong><p>The timestamp shows when the latest live result or latest explicit unavailable result was saved.</p></div></div></div></div></section><DataTable title="Capacity Score" subtitle="Derived capacity score plus latest live placement details from SQL snapshots." tableClassName="rx-table--dense rx-capacity-score-table" sectionClassName="rx-panel--compact" columns={[{ key: 'region', label: 'Region' }, { key: 'sku', label: 'SKU', render: (row) => normalizeSkuName(row.sku) || 'n/a' }, { key: 'family', label: 'Family', render: (row) => formatFamilyLabel(row.family) || 'n/a' }, { key: 'score', label: 'Capacity Score', render: (row) => { const display = getCapacityScoreDisplayMeta(row); return <StatusPill value={display.value} label={display.label} />; } }, { key: 'livePlacementScore', label: 'Azure Live Score', render: (row) => row.livePlacementScore || 'n/a' }, { key: 'liveCheckedAtUtc', label: 'Checked', render: (row) => formatTimestamp(row.liveCheckedAtUtc) }, { key: 'subscriptionCount', label: 'Subscriptions', render: (row) => formatNumber(row.subscriptionCount) }, { key: 'okRows', label: 'OK', render: (row) => formatNumber(row.okRows) }, { key: 'limitedRows', label: 'Limited', render: (row) => formatNumber(row.limitedRows) }, { key: 'constrainedRows', label: 'Constrained', render: (row) => formatNumber(row.constrainedRows) }, { key: 'totalQuotaAvailable', label: 'Quota', render: (row) => formatNumber(row.totalQuotaAvailable) }, { key: 'reason', label: 'Reason', headerClassName: 'rx-capacity-score-table__reason', cellClassName: 'rx-capacity-score-table__reason', render: (row) => <span title={row.reason || ''}>{row.reason || 'n/a'}</span> }]} rows={capacityScores.rows} emptyMessage="No capacity score entries available." /><ServerPagination pagination={capacityScores.pagination} onPageChange={(pageNumber) => setCapacityScores((current) => ({ ...current, pagination: { ...current.pagination, pageNumber: Math.max(1, pageNumber) } }))} onPageSizeChange={(pageSize) => setCapacityScores((current) => ({ ...current, pagination: { ...current.pagination, pageNumber: 1, pageSize: Math.max(1, pageSize) } }))} /><DataTable title="Subscription Summary" tableClassName="rx-table--dense" sectionClassName="rx-panel--compact" columns={[{ key: 'subscriptionKey', label: 'Subscription Key' }, { key: 'skuObservations', label: 'SKU Observations', render: (row) => formatNumber(row.skuObservations || row.totalRows) }, { key: 'constrainedObservations', label: 'Constrained', render: (row) => formatNumber(row.constrainedObservations || row.constrainedRows) }, { key: 'totalQuotaAvailable', label: 'Quota Available', render: (row) => formatNumber(row.totalQuotaAvailable) }]} rows={capacityScores.subscriptionSummary} emptyMessage="No subscription summary rows available." /></div>;
    }
    if (activeView === 'family-summary') {
      return <DataTable key="family-summary" title="Family Summary" subtitle="Compute-family rollup optimized for quota planning conversations." columns={[{ key: 'family', label: 'Family' }, { key: 'skus', label: 'SKUs', render: (row) => formatNumber(row.skus) }, { key: 'ok', label: 'OK SKUs', render: (row) => formatNumber(row.ok) }, { key: 'largest', label: 'Largest' }, { key: 'zones', label: 'Zones' }, { key: 'status', label: 'Status', render: (row) => <StatusPill value={row.status} /> }, { key: 'quota', label: 'Quota', render: (row) => formatNumber(row.quota) }]} rows={familySummaryRows} emptyMessage="No family summary rows available." />;
    }
    if (activeView === 'region-matrix') {
      return <div className="rx-view-stack"><section className="rx-panel rx-panel--compact rx-panel--muted"><div className="rx-panel__header"><div><h2>Region Matrix</h2><p>Family-by-region readiness with row rollups and a deployment-status key.</p></div></div><div className="rx-matrix-key"><div className="rx-matrix-key__group"><h3>Row Color</h3><div className="rx-matrix-key__item"><span className="rx-row-swatch rx-row-swatch--ok"></span><div><strong>Green</strong><p>At least one SKU in this family is fully available.</p></div></div><div className="rx-matrix-key__item"><span className="rx-row-swatch rx-row-swatch--caution"></span><div><strong>Yellow</strong><p>Some SKUs may work, but there are constraints.</p></div></div><div className="rx-matrix-key__item"><span className="rx-row-swatch rx-row-swatch--blocked"></span><div><strong>Gray</strong><p>No SKUs from this family available in scanned regions.</p></div></div></div><div className="rx-matrix-key__group"><h3>Cell Status</h3>{['OK', 'CONSTRAINED', 'LIMITED', 'PARTIAL', 'BLOCKED'].map((status) => { const meta = matrixStatusMeta(status); return <div key={status} className="rx-matrix-key__item"><StatusPill value={status} /><div><strong>{meta.short}</strong><p>{meta.description}</p></div></div>; })}</div></div></section><SortableMatrixTable title="Region Matrix Report" subtitle="Rows are highlighted by family-level readiness across the selected region scope." tableClassName="rx-matrix-table" primaryColumn={{ key: 'family', label: 'Family' }} statusColumn={{ key: 'rowStatus', label: 'Key', render: (row) => <StatusPill value={row.rowStatus === 'CAUTION' ? 'PARTIAL' : row.rowStatus} />, sortValue: (row) => getStatusSortValue(row.rowStatus) }} readyColumn={{ key: 'readyRegionCount', label: 'Ready', render: (row) => formatNumber(row.readyRegionCount) }} dynamicColumns={matrix.regions.map((region) => ({ key: region, label: region }))} rows={matrix.rows} emptyMessage="No matrix rows available." rowKey={(row) => row.family} getRowClassName={(row) => `rx-matrix-row rx-matrix-row--${String(row.rowStatus || 'blocked').toLowerCase()}`} getDynamicSortValue={(row, region) => getStatusSortValue(matrix.resolveCellStatus(row.regionMap[region]))} renderDynamicCell={(row, region) => { const status = matrix.resolveCellStatus(row.regionMap[region]); const meta = matrixStatusMeta(status); return <div className="rx-matrix-cell" title={meta.description}><StatusPill value={status} /></div>; }} /></div>;
    }
    if (activeView === 'trend') {
      return <TrendReport rows={trendRows} filters={filters} selectedSubscriptionCount={selectedSubscriptionIds.length} totalSubscriptionCount={subscriptionOptions.length} granularity={trendGranularity} onGranularityChange={setTrendGranularity} />;
    }
    if (activeView === 'quota-workbench') {
      return <QuotaWorkbenchView managementGroups={quotaState.managementGroups} selectedManagementGroup={quotaState.selectedManagementGroup} onManagementGroupChange={(value) => setQuotaState({ ...quotaState, selectedManagementGroup: value, selectedQuotaGroup: 'all', shareableReport: { rows: [], summary: { rowCount: 0, subscriptionCount: 0, regionCount: 0, skuCount: 0, totalShareableQuota: 0 }, generatedAtUtc: null }, selectedAnalysisRunId: '', selectedDonorSubscriptionId: '', selectedMoveCandidate: null, requestedTransferAmount: 0, planRows: [], impactRows: [], applyResults: [], planSummary: {} })} quotaGroups={quotaState.quotaGroups} selectedQuotaGroup={quotaState.selectedQuotaGroup} onQuotaGroupChange={(value) => setQuotaState({ ...quotaState, selectedQuotaGroup: value, shareableReport: { rows: [], summary: { rowCount: 0, subscriptionCount: 0, regionCount: 0, skuCount: 0, totalShareableQuota: 0 }, generatedAtUtc: null }, selectedAnalysisRunId: '', selectedDonorSubscriptionId: '', selectedMoveCandidate: null, requestedTransferAmount: 0, planRows: [], impactRows: [], applyResults: [], planSummary: {} })} shareableReport={quotaState.shareableReport} candidates={quotaState.candidates} candidateFilters={quotaState.candidateFilters} setCandidateFilters={(value) => setQuotaState({ ...quotaState, candidateFilters: value })} selectedMoveCandidate={quotaState.selectedMoveCandidate} onSelectMoveCandidate={(row) => { const skuOptions = normalizeSkuList(row.skuList); const recipientNeed = getQuotaRecipientNeed(row); const movableQuota = Number(row.movableQuota || row.suggestedMovable || 0); const mode = movableQuota > 0 ? 'donor' : 'recipient'; const requestedTransferAmount = mode === 'donor' ? movableQuota : recipientNeed; setQuotaState((current) => ({ ...current, selectedMoveCandidate: { subscriptionId: row.subscriptionId, subscriptionName: row.subscriptionName || row.subscriptionId, donorSubscriptionId: mode === 'donor' ? row.subscriptionId : '', recipientSubscriptionId: mode === 'recipient' ? row.subscriptionId : '', recipientSubscriptionName: row.subscriptionName || row.subscriptionId, region: row.region, quotaName: row.family || row.quotaName, skuList: skuOptions, selectedSku: '', quotaAvailable: row.quotaAvailable, safetyBuffer: row.safetyBuffer, availability: row.availability, movableQuota, mode }, selectedDonorSubscriptionId: mode === 'donor' ? row.subscriptionId : '', requestedTransferAmount, planRows: [], impactRows: [], applyResults: [], planSummary: {}, status: { tone: 'success', message: `Selected ${row.subscriptionName || row.subscriptionId} as a ${mode} quota row. Continue to Step 3 to build the move.` } })); }} quotaRuns={quotaState.quotaRuns} selectedAnalysisRunId={quotaState.selectedAnalysisRunId} donorOptions={donorOptions} selectedDonorSubscriptionId={quotaState.selectedDonorSubscriptionId} onSelectedSkuChange={(value) => setQuotaState({ ...quotaState, selectedMoveCandidate: quotaState.selectedMoveCandidate ? { ...quotaState.selectedMoveCandidate, selectedSku: value } : null, selectedDonorSubscriptionId: '', planRows: [], impactRows: [], applyResults: [], planSummary: {} })} requestedTransferAmount={quotaState.requestedTransferAmount} onRequestedTransferAmountChange={(value) => setQuotaState({ ...quotaState, requestedTransferAmount: Math.max(0, Number(value || 0)), planRows: [], impactRows: [], applyResults: [], planSummary: {} })} onAnalysisRunChange={(value) => setQuotaState({ ...quotaState, selectedAnalysisRunId: value, selectedDonorSubscriptionId: '', planRows: [], impactRows: [], applyResults: [], planSummary: {} })} onDonorSubscriptionChange={(value) => setQuotaState({ ...quotaState, selectedDonorSubscriptionId: value, planRows: [], impactRows: [], applyResults: [], planSummary: {} })} planRows={quotaState.planRows} impactRows={quotaState.impactRows} applyResults={quotaState.applyResults} summary={quotaState.planSummary} actions={quotaActions} busy={quotaState.busy} status={quotaState.status} />;
    }
    if (activeView === 'shareable-quota-report') {
      return <ShareableQuotaReportView managementGroups={quotaState.managementGroups} selectedManagementGroup={quotaState.selectedManagementGroup} onManagementGroupChange={(value) => setQuotaState({ ...quotaState, selectedManagementGroup: value, selectedQuotaGroup: 'all', shareableReport: { rows: [], summary: { rowCount: 0, subscriptionCount: 0, regionCount: 0, skuCount: 0, totalShareableQuota: 0 }, generatedAtUtc: null }, selectedAnalysisRunId: '', selectedDonorSubscriptionId: '', selectedMoveCandidate: null, requestedTransferAmount: 0, planRows: [], impactRows: [], applyResults: [], planSummary: {} })} quotaGroups={quotaState.quotaGroups} selectedQuotaGroup={quotaState.selectedQuotaGroup} onQuotaGroupChange={(value) => setQuotaState({ ...quotaState, selectedQuotaGroup: value, shareableReport: { rows: [], summary: { rowCount: 0, subscriptionCount: 0, regionCount: 0, skuCount: 0, totalShareableQuota: 0 }, generatedAtUtc: null }, selectedAnalysisRunId: '', selectedDonorSubscriptionId: '', selectedMoveCandidate: null, requestedTransferAmount: 0, planRows: [], impactRows: [], applyResults: [], planSummary: {} })} shareableReport={quotaState.shareableReport} actions={quotaActions} busy={quotaState.busy} status={quotaState.status} />;
    }
    if (activeView === 'shareable-quota-report') {
      return <ShareableQuotaReportView managementGroups={quotaState.managementGroups} selectedManagementGroup={quotaState.selectedManagementGroup} onManagementGroupChange={(value) => setQuotaState({ ...quotaState, selectedManagementGroup: value, selectedQuotaGroup: 'all', shareableReport: { rows: [], summary: { rowCount: 0, subscriptionCount: 0, regionCount: 0, skuCount: 0, totalShareableQuota: 0 }, generatedAtUtc: null }, selectedAnalysisRunId: '', selectedDonorSubscriptionId: '', selectedMoveCandidate: null, requestedTransferAmount: 0, planRows: [], impactRows: [], applyResults: [], planSummary: {} })} quotaGroups={quotaState.quotaGroups} selectedQuotaGroup={quotaState.selectedQuotaGroup} onQuotaGroupChange={(value) => setQuotaState({ ...quotaState, selectedQuotaGroup: value, shareableReport: { rows: [], summary: { rowCount: 0, subscriptionCount: 0, regionCount: 0, skuCount: 0, totalShareableQuota: 0 }, generatedAtUtc: null }, selectedAnalysisRunId: '', selectedDonorSubscriptionId: '', selectedMoveCandidate: null, requestedTransferAmount: 0, planRows: [], impactRows: [], applyResults: [], planSummary: {} })} shareableReport={quotaState.shareableReport} actions={quotaActions} busy={quotaState.busy} status={quotaState.status} />;
    }
    if (activeView === 'admin') {
      return <AdminIngestionView job={adminState.job} status={adminState.status} schedule={adminState.schedule} runtime={adminState.runtime} persistence={adminState.persistence} selectedRegionPreset={filters.regionPreset} actions={adminActions} onScheduleChange={(scope, field, value) => setAdminState((current) => ({ ...current, schedule: { ...current.schedule, [scope]: { ...current.schedule[scope], [field]: value } } }))} busy={adminState.busy} viewStatus={adminState.statusMessage} />;
    }
    return <section className="rx-panel"><div className="rx-placeholder">View not implemented yet.</div></section>;
  })();

  return (
    <div className={classNames('rx-shell', !sidebarOpen && 'is-sidebar-collapsed', !drawerOpen && 'is-drawer-collapsed')}>
      <aside className="rx-sidebar">
        <div className="rx-sidebar__header">
          <div>
            <div className="rx-kicker">React V2</div>
            <h1>Capacity Dashboard</h1>
          </div>
          <a className="rx-link-button" href="/classic/">Classic UI</a>
        </div>
        <div className="rx-nav-group">Reporting</div>
        <nav className="rx-nav-list">
          {reportingViews.map((view) => (
            <button key={view.key} className={classNames('rx-nav-item', activeView === view.key && 'is-active')} type="button" onClick={() => setActiveView(view.key)}>{view.label}</button>
          ))}
        </nav>
        <div className="rx-nav-group">Exports</div>
        <div className="rx-export-box">
          <label className="rx-field rx-field--compact">
            <span>Export option</span>
            <select value={selectedExportOption} onChange={(event) => setSelectedExportOption(event.target.value)} disabled={Boolean(exportBusyFormat) || activeReportExportOptions.length === 0}>
              {activeReportExportOptions.length === 0 ? <option value="">No exports available</option> : activeReportExportOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div className="rx-export-box__actions">
            <span className="rx-selected-count">{activeView === 'capacity-grid' ? 'Uses the current sidebar filter scope.' : `Exports the current ${REPORT_VIEWS.find((view) => view.key === activeView)?.label || activeView} dataset.`}</span>
            <button className="rx-button rx-button--secondary rx-button--compact" type="button" disabled={Boolean(exportBusyFormat) || activeReportExportOptions.length === 0} onClick={runSelectedExport}>{exportBusyFormat ? 'Running...' : 'Run'}</button>
          </div>
        </div>
        {auth && auth.canAccessAdmin ? <><div className="rx-nav-group">Admin</div><nav className="rx-nav-list">{adminViews.map((view) => <button key={view.key} className={classNames('rx-nav-item', activeView === view.key && 'is-active')} type="button" onClick={() => setActiveView(view.key)}>{view.label}</button>)}</nav></> : null}
      </aside>

      <main className="rx-main">
        <header className={classNames('rx-topbar', drawerOpen && 'is-drawer-open')}>
          <div className="rx-topbar__intro">
            <div className="rx-kicker">{deploymentEnvironment.label}</div>
          </div>
          <div className="rx-topbar__actions">
            {isAdminView ? <label className="rx-check rx-check--sql-toggle"><input type="checkbox" checked={showSqlPreview} disabled={uiSettingsBusy} onChange={(event) => handleShowSqlPreviewChange(event.target.checked)} />Show SQL</label> : null}
            <div className="rx-user-chip">
              <strong>{auth?.name || 'Loading user...'}</strong>
              <small>{auth?.username || 'No Entra context yet'}</small>
            </div>
            {auth?.authEnabled && auth?.isAuthenticated ? <a className="rx-link-button rx-link-button--muted" href="/auth/logout">Logout</a> : null}
            <button className="rx-button rx-button--secondary" type="button" onClick={() => setSidebarOpen((current) => !current)}>{sidebarOpen ? 'Hide Reports' : 'Show Reports'}</button>
            <button className="rx-button rx-button--secondary" type="button" onClick={() => setDrawerOpen((current) => !current)}>{drawerOpen ? 'Hide Filters' : 'Show Filters'}</button>
          </div>
          <Banner tone={appStatus.tone} message={appStatus.message} className="rx-topbar__status" />
        </header>

        {viewContent}
        {auth?.canAccessAdmin && showSqlPreview ? <SqlPreviewPanel activeViewLabel={REPORT_VIEWS.find((view) => view.key === activeView)?.label || activeView} loading={sqlPreviewState.loading} error={sqlPreviewState.error} rows={sqlPreviewState.rows} /> : null}
      </main>

      <aside className={classNames('rx-drawer', drawerOpen && 'is-open')}>
        <div className="rx-drawer__header">
          <div>
            <div className="rx-kicker">Filter Flyout</div>
            <h3>Reporting Scope</h3>
          </div>
        </div>
        <DrawerFilterSection title="Regional scope">
          <label className="rx-field"><span>Region preset</span><select value={filters.regionPreset} onChange={(event) => updateFilter('regionPreset', event.target.value)}>{REGION_PRESET_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="rx-field"><span>Region</span><select value={filters.region} onChange={(event) => updateFilter('region', event.target.value)}><option value="all">All Regions</option>{scopedRegionOptions.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
        </DrawerFilterSection>
        {activeView === 'ai-model-availability' || activeView === 'ai-summary-report' ? <DrawerFilterSection title="AI catalog filters">
          <label className="rx-field"><span>Model search</span><input className="rx-input" value={aiModelFilters.modelName} onChange={(event) => setAiModelFilters((current) => ({ ...current, modelName: event.target.value }))} placeholder="gpt-4o, llama, text-embedding" /></label>
          <label className="rx-field"><span>Provider</span><select value={aiModelFilters.provider} onChange={(event) => setAiModelFilters((current) => ({ ...current, provider: event.target.value }))}><option value="all">All providers</option>{aiProviderOptions.map((provider) => <option key={provider} value={provider}>{provider}</option>)}</select></label>
          <label className="rx-field"><span>Deployment type</span><select value={aiModelFilters.deploymentType} onChange={(event) => setAiModelFilters((current) => ({ ...current, deploymentType: event.target.value }))}><option value="all">All deployment types</option>{aiDeploymentTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
          <label className="rx-field"><span>Fine-tuning</span><select value={aiModelFilters.fineTuning} onChange={(event) => setAiModelFilters((current) => ({ ...current, fineTuning: event.target.value }))}><option value="all">All models</option><option value="yes">Fine-tuning capable</option><option value="no">No fine-tuning</option></select></label>
          <label className="rx-check"><input type="checkbox" checked={aiModelFilters.defaultOnly} onChange={(event) => setAiModelFilters((current) => ({ ...current, defaultOnly: event.target.checked }))} />Only default models</label>
        </DrawerFilterSection> : <>
          <DrawerFilterSection title="Capacity filters">
            <label className="rx-field"><span>Resource type</span><select value={filters.resourceType} onChange={(event) => updateFilter('resourceType', event.target.value)}>{RESOURCE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            {filters.resourceType === 'AI' && aiQuotaProviderOptions.length > 0 ? <label className="rx-field"><span>AI provider</span><select value={filters.provider} onChange={(event) => updateFilter('provider', event.target.value)}><option value="all">All verified providers</option>{aiQuotaProviderOptions.map((provider) => <option key={provider} value={provider}>{provider}</option>)}</select></label> : null}
            <label className="rx-field"><span>Family base</span><select value={filters.familyBase} onChange={(event) => updateFilter('familyBase', event.target.value)}><option value="all">All bases</option>{familyBaseOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="rx-field"><span>SKU family</span><select value={filters.family} onChange={(event) => updateFilter('family', event.target.value)}><option value="all">All families</option>{filteredFamilyOptions.map((family) => <option key={family} value={family}>{formatFamilyLabel(family) || family}</option>)}</select></label>
            <label className="rx-field"><span>Availability</span><select value={filters.availability} onChange={(event) => updateFilter('availability', event.target.value)}><option value="all">All states</option><option value="OK">OK</option><option value="LIMITED">LIMITED</option><option value="CONSTRAINED">CONSTRAINED</option><option value="RESTRICTED">RESTRICTED</option></select></label>
          </DrawerFilterSection>
          <DrawerFilterSection title="Subscriptions">
            <SubscriptionPicker options={filteredSubscriptionOptions} selectedIds={selectedSubscriptionIds} search={subscriptionSearch} onSearch={setSubscriptionSearch} onToggle={toggleSubscription} onSelectAll={selectAllSubscriptions} onClear={clearSubscriptions} />
          </DrawerFilterSection>
        </>}
      </aside>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
