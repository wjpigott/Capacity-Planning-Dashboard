const { useEffect, useMemo, useState } = React;

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

const REPORT_VIEWS = [
  { key: 'capacity-grid', label: 'Capacity Grid', adminOnly: false },
  { key: 'region-health', label: 'Region Health', adminOnly: false },
  { key: 'recommender', label: 'Capacity Recommender', adminOnly: false },
  { key: 'sku-chart', label: 'Top SKUs', adminOnly: false },
  { key: 'capacity-score', label: 'Capacity Score', adminOnly: false },
  { key: 'family-summary', label: 'Family Summary', adminOnly: false },
  { key: 'region-matrix', label: 'Region Matrix', adminOnly: false },
  { key: 'trend', label: 'Trend History', adminOnly: false },
  { key: 'ai-model-availability', label: 'AI Model Availability', adminOnly: false },
  { key: 'admin', label: 'Data Ingestion', adminOnly: true },
  { key: 'quota-workbench', label: 'Quota Workbench', adminOnly: true }
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

const FAMILY_EXTRA_SKU_MAP = {
  standardHBv3Family: ['Standard_HB120rs_v3'],
  standardHBv4Family: ['Standard_HB176rs_v4'],
  standardNDH100v5Family: ['Standard_ND96isr_H100_v5'],
  standardNCA100v4Family: ['Standard_NC96ads_A100_v4'],
  standardDSv5Family: [
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
    const reason = payload.requestId ? `${baseReason} [Ref ${payload.requestId}]` : baseReason;
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

function defaultRecommendTargetSkuFromRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '';
  }

  const bySku = new Map();
  rows.forEach((row) => {
    const sku = normalizeSkuName(row && row.sku);
    if (!sku) {
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

function capacityScoreLegendItems() {
  return [
    {
      value: 'High',
      title: 'High',
      description: 'Strong derived capacity posture from the saved OK, Limited, Constrained, and quota observations.'
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
    entry.hasConstrained = entry.hasConstrained || row.availability === 'CONSTRAINED';
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

function StatusPill({ value }) {
  return <span className={classNames('rx-pill', `rx-pill--${String(value || 'default').toLowerCase()}`)}>{value || 'n/a'}</span>;
}

function Banner({ tone, message, detail }) {
  if (!message) return null;
  return (
    <div className={classNames('rx-banner', `rx-banner--${tone || 'info'}`)}>
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

  if ((row?.availability === 'CONSTRAINED' || row?.availabilityState === 'CONSTRAINED' || row?.availability === 'LIMITED' || row?.availabilityState === 'LIMITED') && quotaAvailable <= 0) {
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
  const mapped = FAMILY_EXTRA_SKU_MAP[String(familyValue || '').trim()];
  return Array.isArray(mapped) ? mapped : [];
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

function DataTable({ title, subtitle, columns, rows, emptyMessage, tableClassName, sectionClassName }) {
  const [sort, setSort] = useState({ key: null, direction: 'asc' });

  const sortableColumns = columns || [];

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
            {sortedRows.length === 0 ? (
              <tr><td className="rx-empty" colSpan={columns.length}>{emptyMessage}</td></tr>
            ) : sortedRows.map((row, index) => (
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
                index
              ].filter((value) => value !== undefined && value !== null && value !== '').join('|')}>
                {columns.map((column) => <td key={column.key} className={column.cellClassName}>{column.render ? column.render(row) : (row[column.key] == null ? 'n/a' : row[column.key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
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

function formatShortDay(value) {
  if (!value) {
    return 'n/a';
  }

  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  });
}

function TrendLineChart({ title, subtitle, rows, series, emptyMessage }) {
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
            <span>{formatCompactNumber(item.getValue(scopedRows[scopedRows.length - 1]))}</span>
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
                    <title>{`${item.label}: ${formatNumber(point.value)} on ${point.day}`}</title>
                  </g>
                ))}
              </g>
            );
          })}
          {scopedRows.map((row, index) => {
            const x = margin.left + (scopedRows.length === 1 ? innerWidth / 2 : xStep * index);
            return (
              <text key={row.day} className="rx-trend-chart__tick rx-trend-chart__tick--x" x={x} y={height - 10} textAnchor="middle">{formatShortDay(row.day)}</text>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

function TrendReport({ rows, filters, selectedSubscriptionCount, totalSubscriptionCount }) {
  const scopedRows = Array.isArray(rows) ? rows : [];
  const latestRow = scopedRows[scopedRows.length - 1] || null;
  const firstRow = scopedRows[0] || null;
  const quotaDelta = latestRow && firstRow ? Number(latestRow.totalQuotaAvailable || 0) - Number(firstRow.totalQuotaAvailable || 0) : 0;
  const observationDelta = latestRow && firstRow ? Number(latestRow.totalRows || 0) - Number(firstRow.totalRows || 0) : 0;
  const subscriptionLabel = selectedSubscriptionCount === totalSubscriptionCount
    ? `All ${formatNumber(totalSubscriptionCount)} subscriptions`
    : `${formatNumber(selectedSubscriptionCount)} selected subscriptions`;
  const regionLabel = filters.region && filters.region !== 'all'
    ? filters.region
    : `${filters.regionPreset || 'all'} preset`;

  return (
    <div className="rx-view-stack">
      <section className="rx-panel rx-panel--compact rx-panel--muted">
        <div className="rx-panel__header">
          <div>
            <h2>Trend Calculation</h2>
            <p>The server groups `dbo.CapacitySnapshot` by capture date after applying the active region preset, specific region, selected subscriptions, family, and availability filters.</p>
          </div>
        </div>
        <div className="rx-trend-summary">
          <div className="rx-trend-summary__item">
            <span>Filter Scope</span>
            <strong>{regionLabel}</strong>
            <small>{subscriptionLabel}</small>
          </div>
          <div className="rx-trend-summary__item">
            <span>Latest Quota Available</span>
            <strong>{latestRow ? formatNumber(latestRow.totalQuotaAvailable) : 'n/a'}</strong>
            <small>{firstRow ? `${quotaDelta >= 0 ? '+' : ''}${formatNumber(quotaDelta)} vs first day` : 'Waiting for history'}</small>
          </div>
          <div className="rx-trend-summary__item">
            <span>Latest SKU Observations</span>
            <strong>{latestRow ? formatNumber(latestRow.totalRows) : 'n/a'}</strong>
            <small>{firstRow ? `${observationDelta >= 0 ? '+' : ''}${formatNumber(observationDelta)} vs first day` : 'Waiting for history'}</small>
          </div>
        </div>
        <p className="rx-trend-note">Large swings usually mean more or fewer snapshot rows were captured on that day. React is only rendering the result; the region and subscription filters are applied by the API before the daily totals are calculated.</p>
      </section>
      <TrendLineChart
        title="Quota Available Over Time"
        subtitle="Daily summed headroom across the current filter scope. Use subscription filters when you want one subscription trend instead of the whole cohort."
        rows={scopedRows}
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
        subtitle="These counts explain why quota totals can jump: fewer captured rows usually means a smaller daily aggregate even with the same filters."
        rows={scopedRows}
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
        title="Daily Trend Rows"
        subtitle="Raw daily aggregates behind the charts."
        columns={[
          { key: 'day', label: 'Day' },
          { key: 'totalRows', label: 'Total Rows', render: (row) => formatNumber(row.totalRows) },
          { key: 'constrainedRows', label: 'Constrained Rows', render: (row) => formatNumber(row.constrainedRows) },
          { key: 'totalQuotaAvailable', label: 'Total Quota Available', render: (row) => formatNumber(row.totalQuotaAvailable) }
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
      <input className="rx-input" type="search" value={search} placeholder="Search 1000+ subscriptions" onChange={(event) => onSearch(event.target.value)} />
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

function AIModelAvailabilityView({ rows, loading, status, onRefresh }) {
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
          <button className="rx-button rx-button--secondary" type="button" disabled={loading} onClick={onRefresh}>{loading ? 'Refreshing...' : 'Refresh AI Catalog'}</button>
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

function App() {
  const deploymentEnvironment = useMemo(() => detectDeploymentEnvironment(), []);
  const [auth, setAuth] = useState(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [appStatus, setAppStatus] = useState({ tone: 'info', message: 'Loading React experience...' });
  const [activeView, setActiveView] = useState('capacity-grid');
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [subscriptionSearch, setSubscriptionSearch] = useState('');
  const [subscriptionOptions, setSubscriptionOptions] = useState([]);
  const [selectedSubscriptionIds, setSelectedSubscriptionIds] = useState([]);
  const [livePlacementSubscriptionId, setLivePlacementSubscriptionId] = useState('');
  const [livePlacementFamily, setLivePlacementFamily] = useState('');
  const [filters, setFilters] = useState({ regionPreset: 'USMajor', region: 'all', family: 'all', availability: 'all', resourceType: 'all', provider: 'all' });
  const [capacityData, setCapacityData] = useState({ rows: [], summary: null, facets: { regions: [], families: [] }, pagination: { pageNumber: 1, pageSize: 50, total: 0, pageCount: 1, hasNext: false, hasPrev: false } });
  const [analyticsRows, setAnalyticsRows] = useState([]);
  const [trendRows, setTrendRows] = useState([]);
  const [familyRows, setFamilyRows] = useState([]);
  const [capacityScores, setCapacityScores] = useState({ rows: [], pagination: { pageNumber: 1, pageSize: 50, total: 0, pageCount: 1, hasNext: false, hasPrev: false }, subscriptionSummary: [], desiredCount: '1', status: { tone: 'info', message: 'Load or refresh live placement to populate saved capacity score snapshots.', detail: '' }, busy: false });
  const [aiModelState, setAiModelState] = useState({ rows: [], regions: [], loading: false, status: { tone: 'info', message: 'AI model availability report ready.', detail: 'Open the sidebar report to review Azure AI model and provider coverage.' } });
  const [exportBusyFormat, setExportBusyFormat] = useState('');
  const [recommendState, setRecommendState] = useState({ targetSku: '', autoTargetSku: '', regions: '', autoRegions: '', topN: 10, minScore: 50, showPricing: true, showSpot: false, result: null, status: { tone: 'info', message: 'Run the recommender to populate alternatives.' }, busy: false });
  const [aiModelFilters, setAiModelFilters] = useState({ modelName: '', provider: 'all', deploymentType: 'all', fineTuning: 'all', defaultOnly: false });
  const [adminState, setAdminState] = useState({ job: null, status: null, schedule: { ingest: { intervalMinutes: 0, runOnStartup: false }, livePlacement: { intervalMinutes: 0, runOnStartup: false }, aiModelCatalog: { intervalMinutes: 1440 } }, runtime: { ingest: { intervalMinutes: 0, runOnStartup: false }, livePlacement: { intervalMinutes: 0, runOnStartup: false }, aiModelCatalog: { intervalMinutes: 1440 } }, persistence: { available: true, source: 'sql', message: 'SQL scheduler settings are available.' }, statusMessage: { tone: 'info', message: 'Data ingestion tools ready.' }, busy: { refreshStatus: false, trigger: false, refreshModelCatalog: false, refreshSchedule: false, saveSchedule: false } });
  const [quotaState, setQuotaState] = useState({ managementGroups: [], selectedManagementGroup: '', quotaGroups: [], selectedQuotaGroup: 'all', candidates: [], quotaRuns: [], selectedAnalysisRunId: '', selectedDonorSubscriptionId: '', selectedMoveCandidate: null, requestedTransferAmount: 0, planRows: [], impactRows: [], applyResults: [], planSummary: {}, candidateFilters: { subscriptionId: 'all', region: 'all', family: '', intent: 'all' }, status: { tone: 'info', message: 'Quota tools ready.' }, busy: { discover: false, generate: false, capture: false, refresh: false, refreshRuns: false, plan: false, simulate: false, apply: false } });
  const [showSqlPreview, setShowSqlPreview] = useState(false);
  const [sqlPreviewState, setSqlPreviewState] = useState({ loading: false, error: '', rows: [] });
  const [uiSettingsBusy, setUiSettingsBusy] = useState(false);

  const queryFilters = useMemo(() => {
    const next = {
      regionPreset: filters.regionPreset,
      region: filters.region,
      family: filters.family,
      availability: filters.availability,
      resourceType: filters.resourceType,
      subscriptionIds: selectedSubscriptionIds.join(',')
    };
    if (filters.resourceType === 'AI' && filters.provider && filters.provider !== 'all') {
      next.provider = filters.provider;
    }
    return next;
  }, [filters, selectedSubscriptionIds]);
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

  const filteredAnalyticsRows = useMemo(() => (analyticsRows || [])
    .filter((row) => rowMatchesResourceType(row, filters.resourceType))
    .filter((row) => rowMatchesAIQuotaProvider(row, filters.provider)), [analyticsRows, filters.resourceType, filters.provider]);
  const recommendedTargetSku = useMemo(() => defaultRecommendTargetSkuFromRows(filteredAnalyticsRows), [filteredAnalyticsRows]);
  const recommendedRegions = useMemo(() => defaultRecommendRegionsFromFilters(filters, capacityData.facets.regions, filteredAnalyticsRows), [filters, capacityData.facets.regions, filteredAnalyticsRows]);
  const scopedRegionOptions = useMemo(() => {
    const baseOptions = activeView === 'ai-model-availability'
      ? (Array.isArray(aiModelState.regions) ? aiModelState.regions : [])
      : (Array.isArray(capacityData.facets.regions) ? capacityData.facets.regions : []);
    const presetRegions = regionPresets[filters.regionPreset] || [];
    if (presetRegions.length > 0) {
      const presetSet = new Set(presetRegions.map((region) => String(region || '').trim().toLowerCase()));
      const intersected = baseOptions.filter((region) => presetSet.has(String(region || '').trim().toLowerCase()));
      return intersected.length > 0 ? intersected : presetRegions;
    }
    return baseOptions;
  }, [activeView, aiModelState.regions, filters.regionPreset, capacityData.facets.regions]);
  const regionHealth = useMemo(() => deriveRegionHealth(filteredAnalyticsRows), [filteredAnalyticsRows]);
  const topSkus = useMemo(() => topSkuRows(filteredAnalyticsRows), [filteredAnalyticsRows]);
  const familySummaryRows = useMemo(() => (familyRows.length > 0 ? familyRows : familySummaryFromRows(filteredAnalyticsRows)), [familyRows, filteredAnalyticsRows]);
  const matrix = useMemo(() => regionMatrixRows(filteredAnalyticsRows, filters.region, scopedRegionOptions), [filteredAnalyticsRows, filters.region, scopedRegionOptions]);
  const aiDeploymentTypeOptions = useMemo(() => [...new Set((aiModelState.rows || [])
    .flatMap((row) => String(row.deploymentTypes || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)))].sort((left, right) => left.localeCompare(right)), [aiModelState.rows]);
  const aiProviderOptions = useMemo(() => [...new Set((aiModelState.rows || [])
    .map((row) => getAIModelProviderLabel(row))
    .filter(Boolean))].sort((left, right) => left.localeCompare(right)), [aiModelState.rows]);
  const aiQuotaProviderOptions = useMemo(() => [...new Set((analyticsRows || [])
    .filter((row) => getRowResourceType(row) === 'AI')
    .map((row) => getAIQuotaProviderLabel(row))
    .filter((provider) => provider && provider !== 'Unknown'))].sort((left, right) => left.localeCompare(right)), [analyticsRows]);
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
  const isAdminView = Boolean(auth?.canAccessAdmin && activeView === 'admin');

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
    const familyOptions = Array.isArray(capacityData.facets.families) ? capacityData.facets.families : [];
    if (familyOptions.length === 0) {
      if (livePlacementFamily) {
        setLivePlacementFamily('');
      }
      return;
    }

    if (livePlacementFamily && familyOptions.includes(livePlacementFamily)) {
      return;
    }

    if (filters.family && filters.family !== 'all' && familyOptions.includes(filters.family)) {
      setLivePlacementFamily(filters.family);
      return;
    }

    setLivePlacementFamily('');
  }, [capacityData.facets.families, filters.family, livePlacementFamily]);

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

        const requests = [fetchJson('/api/subscriptions?limit=500')];
        if (authContext && authContext.canAccessAdmin) {
          requests.push(fetchJson('/api/quota/management-groups'));
          requests.push(fetchJson('/api/admin/ui-settings'));
        }

        const responses = await Promise.all(requests);
        const subscriptionPayload = responses[0] || { rows: [] };
        const managementGroupPayload = responses[1] || { groups: [], defaultManagementGroupId: '' };
        const uiSettingsPayload = responses[2] || { settings: { showSqlPreview: false } };
        const subscriptions = Array.isArray(subscriptionPayload.rows) ? subscriptionPayload.rows : [];
        setSubscriptionOptions(subscriptions);
        setSelectedSubscriptionIds(subscriptions.map((row) => row.subscriptionId).filter(Boolean));
        const managementGroups = Array.isArray(managementGroupPayload.groups) ? managementGroupPayload.groups : [];
        const selectedManagementGroup = managementGroupPayload.defaultManagementGroupId && managementGroups.some((group) => group.id === managementGroupPayload.defaultManagementGroupId)
          ? managementGroupPayload.defaultManagementGroupId
          : (managementGroups[0] ? managementGroups[0].id : '');
        setQuotaState((current) => ({ ...current, managementGroups, selectedManagementGroup }));
        setShowSqlPreview(Boolean(uiSettingsPayload.settings && uiSettingsPayload.settings.showSqlPreview));
        setAppStatus({ tone: 'success', message: 'React v2 loaded. Use the right-side flyout to manage large filter sets.' });
      } catch (error) {
        setAppStatus({ tone: 'error', message: error.message || 'Failed to initialize React experience.' });
      } finally {
        setAuthResolved(true);
      }
    }
    initialize();
  }, []);

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
    async function loadCapacityGrid() {
      try {
        const query = new URLSearchParams({ ...queryFilters, pageNumber: String(capacityData.pagination.pageNumber || 1), pageSize: String(capacityData.pagination.pageSize || 50) });
        const payload = await fetchJson(`/api/capacity/paged?${query.toString()}`);
        const sanitizedRegions = (Array.isArray(payload.facets && payload.facets.regions) ? payload.facets.regions : []).filter(isDisplayableRegion);
        const sanitizedFamilies = (Array.isArray(payload.facets && payload.facets.families) ? payload.facets.families : []).filter(isDisplayableFamily);
        const canonicalFamilies = buildFamilyOptions(sanitizedFamilies).map((option) => option.value);
        setCapacityData({
          rows: Array.isArray(payload.data) ? payload.data.map((row) => ({ ...row, sku: normalizeSkuName(row.sku) })) : [],
          summary: payload.summary || null,
          facets: { regions: sanitizedRegions, families: canonicalFamilies },
          pagination: payload.pagination || { pageNumber: 1, pageSize: 50, total: 0, pageCount: 1, hasNext: false, hasPrev: false }
        });
      } catch (error) {
        setCapacityData({ rows: [], summary: null, facets: { regions: [], families: [] }, pagination: { pageNumber: 1, pageSize: 50, total: 0, pageCount: 1, hasNext: false, hasPrev: false } });
        setAppStatus({ tone: 'error', message: error.message || 'Failed to load capacity grid.' });
      }
    }
    loadCapacityGrid();
  }, [queryFilters, capacityData.pagination.pageNumber, capacityData.pagination.pageSize]);

  useEffect(() => {
    if (activeView !== 'ai-model-availability') {
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
    async function loadAnalytics() {
      const query = new URLSearchParams(queryFilters);
      const trendQuery = new URLSearchParams({ ...queryFilters, days: '7' }).toString();
      const scoreQuery = new URLSearchParams({ ...queryFilters, desiredCount: String(normalizeDesiredPlacementCount(capacityScores.desiredCount)), pageNumber: '1', pageSize: '50' }).toString();

      const results = await Promise.allSettled([
        fetchJson(`/api/capacity?${query.toString()}`),
        fetchJsonWithRetry(`/api/capacity/trends?${trendQuery}`),
        fetchJson(`/api/capacity/families?${new URLSearchParams({ ...queryFilters, family: 'all' }).toString()}`),
        fetchJson(`/api/capacity/scores?${scoreQuery}`),
        fetchJson(`/api/capacity/subscriptions?${query.toString()}`)
      ]);

      const [capacityResult, trendResult, familyResult, scoreResult, subSummaryResult] = results;
      const failures = results.filter((result) => result.status === 'rejected');

      if (capacityResult.status === 'fulfilled') {
        setAnalyticsRows(Array.isArray(capacityResult.value.rows) ? capacityResult.value.rows.map((row) => ({ ...row, sku: normalizeSkuName(row.sku) })) : []);
      }

      if (trendResult.status === 'fulfilled') {
        setTrendRows(Array.isArray(trendResult.value.rows) ? trendResult.value.rows : []);
      } else {
        setTrendRows([]);
      }

      if (familyResult.status === 'fulfilled') {
        setFamilyRows(Array.isArray(familyResult.value.rows) ? familyResult.value.rows : []);
      }

      if (scoreResult.status === 'fulfilled' || subSummaryResult.status === 'fulfilled') {
        setCapacityScores((current) => {
          const rows = scoreResult.status === 'fulfilled' && Array.isArray(scoreResult.value.rows) ? scoreResult.value.rows : current.rows;
          const desiredCount = String(normalizeDesiredPlacementCount(current.desiredCount));
          return {
            ...current,
            rows,
            pagination: scoreResult.status === 'fulfilled'
              ? (scoreResult.value.pagination || { pageNumber: 1, pageSize: 50, total: 0, pageCount: 1, hasNext: false, hasPrev: false })
              : current.pagination,
            subscriptionSummary: subSummaryResult.status === 'fulfilled' && Array.isArray(subSummaryResult.value.rows)
              ? subSummaryResult.value.rows
              : current.subscriptionSummary,
            desiredCount,
            status: scoreResult.status === 'fulfilled'
              ? {
                  tone: 'info',
                  message: buildCapacityScoreSnapshotMessage(rows, desiredCount),
                  detail: ''
                }
              : current.status
          };
        });
      }

      if (failures.length > 0) {
        const firstError = failures[0].reason;
        setAppStatus({ tone: 'warn', message: firstError?.message || 'One or more analytics views failed to load. Other data is still available.' });
      }
    }
    loadAnalytics();
  }, [queryFilters, capacityScores.desiredCount]);

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
        return { ...current, regionPreset: value, region: 'all' };
      }
      if (name === 'resourceType') {
        return { ...current, resourceType: value, provider: value === 'AI' ? current.provider : 'all' };
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

  async function downloadCapacityExport(format) {
    const normalizedFormat = String(format || 'csv').toLowerCase() === 'xlsx' ? 'xlsx' : 'csv';
    setExportBusyFormat(normalizedFormat);
    try {
      const query = new URLSearchParams({ ...queryFilters, format: normalizedFormat });
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
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
      setAppStatus({ tone: 'success', message: `Downloaded ${filename}.` });
    } catch (error) {
      setAppStatus({ tone: 'error', message: error.message || 'Failed to export capacity data.' });
    } finally {
      setExportBusyFormat('');
    }
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
      if (!auth?.canAccessAdmin) return;
      setQuotaState((current) => ({ ...current, busy: { ...current.busy, discover: true } }));
      try {
        const payload = await fetchJson(`/api/quota/groups?managementGroupId=${encodeURIComponent(quotaState.selectedManagementGroup)}`);
        setQuotaState((current) => ({ ...current, quotaGroups: Array.isArray(payload.groups) ? payload.groups : [], busy: { ...current.busy, discover: false }, status: { tone: 'success', message: `Discovered ${Array.isArray(payload.groups) ? payload.groups.length : 0} quota group(s).` } }));
      } catch (error) {
        setQuotaState((current) => ({ ...current, busy: { ...current.busy, discover: false }, status: { tone: 'error', message: error.message || 'Failed to discover quota groups.' } }));
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
      if (!auth?.canAccessAdmin) return;
      setQuotaState((current) => ({ ...current, busy: { ...current.busy, refresh: true } }));
      try {
        const [groupsPayload, runsPayload] = await Promise.all([
          fetchJson(`/api/quota/groups?managementGroupId=${encodeURIComponent(quotaState.selectedManagementGroup)}`),
          quotaState.selectedQuotaGroup !== 'all'
            ? fetchJson(`/api/quota/candidate-runs?${new URLSearchParams({ managementGroupId: quotaState.selectedManagementGroup, groupQuotaName: quotaState.selectedQuotaGroup, region: 'all', family: 'all', subscriptionIds: '' }).toString()}`)
            : Promise.resolve({ runs: [] })
        ]);
        setQuotaState((current) => ({ ...current, quotaGroups: Array.isArray(groupsPayload.groups) ? groupsPayload.groups : [], quotaRuns: Array.isArray(runsPayload.runs) ? runsPayload.runs : [], busy: { ...current.busy, refresh: false }, status: { tone: 'success', message: 'Quota analytics refreshed.' } }));
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
      return <DataTable key="capacity-grid" title="Capacity Grid" subtitle="Server-paged capacity observations using the shared API contract." columns={[{ key: 'subscriptionName', label: 'Subscription', headerClassName: 'rx-capacity-grid__subscription', cellClassName: 'rx-capacity-grid__subscription' }, { key: 'region', label: 'Region' }, { key: 'sku', label: 'SKU', render: (row) => normalizeSkuName(row.sku) || 'n/a' }, { key: 'family', label: 'Family', render: (row) => formatFamilyLabel(row.family) || 'n/a' }, ...(filters.resourceType === 'AI' ? [{ key: 'provider', label: 'AI Provider', render: (row) => getAIQuotaProviderDisplay(row), sortValue: (row) => getAIQuotaProviderLabel(row) }] : []), { key: 'availability', label: 'Availability', render: (row) => <StatusPill value={row.availability} /> }, { key: 'quotaCurrent', label: 'Current', render: (row) => formatNumber(row.quotaCurrent) }, { key: 'quotaLimit', label: 'Limit', render: (row) => formatNumber(row.quotaLimit) }, { key: 'available', label: 'Available', render: (row) => formatNumber(Number(row.quotaLimit || 0) - Number(row.quotaCurrent || 0)) }]} rows={capacityData.rows} emptyMessage="No capacity rows returned for the current filters." />;
    }
    if (activeView === 'region-health') {
      return <DataTable key="region-health" title="Region Health" subtitle="Computed from the same capacity observations used by the classic dashboard." columns={[{ key: 'region', label: 'Region' }, { key: 'totalRows', label: 'Total Rows', render: (row) => formatNumber(row.totalRows) }, { key: 'deployableRows', label: 'Deployable', render: (row) => formatNumber(row.deployableRows) }, { key: 'constrainedRows', label: 'Constrained', render: (row) => formatNumber(row.constrainedRows) }, { key: 'totalQuotaHeadroom', label: 'Quota Headroom', render: (row) => formatNumber(Math.round(row.totalQuotaHeadroom)) }, { key: 'deployableFamilyCount', label: 'Deployable Families', render: (row) => formatNumber(row.deployableFamilyCount) }, { key: 'deployableSubscriptionCount', label: 'Subscriptions', render: (row) => formatNumber(row.deployableSubscriptionCount) }, ...(filters.resourceType === 'AI' ? [{ key: 'providers', label: 'Providers', render: (row) => row.providers.join(', ') || 'n/a', sortValue: (row) => row.providers.join(',') }] : []), { key: 'topConstrainedFamilies', label: 'Top Constrained Families', render: (row) => row.topConstrainedFamilies.join(', ') || 'n/a' }]} rows={regionHealth} emptyMessage="No region health data for this filter scope." />;
    }
    if (activeView === 'recommender') {
      const recommendations = Array.isArray(recommendState.result && recommendState.result.recommendations) ? recommendState.result.recommendations : [];
      return <div className="rx-view-stack"><Banner tone={recommendState.status.tone} message={recommendState.status.message} detail={recommendState.status.detail} /><section className="rx-panel"><div className="rx-panel__header"><div><h2>Capacity Recommender</h2><p>Same backend recommendation API, but staged into a clearer React workflow.</p></div></div><div className="rx-field-grid rx-field-grid--filters"><label className="rx-field"><span>Target SKU</span><input className="rx-input" value={recommendState.targetSku} onChange={(event) => setRecommendState({ ...recommendState, targetSku: normalizeSkuName(event.target.value), autoTargetSku: recommendState.autoTargetSku })} placeholder="Standard_D4s_v5" /></label><label className="rx-field"><span>Regions</span><input className="rx-input" value={recommendState.regions} onChange={(event) => setRecommendState({ ...recommendState, regions: event.target.value, autoRegions: recommendState.autoRegions })} placeholder="eastus,westus2" /></label><label className="rx-field"><span>Top N</span><input className="rx-input" type="number" min="1" max="25" value={recommendState.topN} onChange={(event) => setRecommendState({ ...recommendState, topN: Number(event.target.value || 10) })} /></label><label className="rx-field"><span>Min Score</span><input className="rx-input" type="number" min="0" max="100" value={recommendState.minScore} onChange={(event) => setRecommendState({ ...recommendState, minScore: Number(event.target.value || 50) })} /></label></div><div className="rx-inline-actions"><span className="rx-selected-count">Scoped default SKU: {recommendedTargetSku || 'n/a'}</span><span className="rx-selected-count">Scoped default Regions: {recommendedRegions || 'n/a'}</span><label className="rx-check"><input type="checkbox" checked={recommendState.showPricing} onChange={(event) => setRecommendState({ ...recommendState, showPricing: event.target.checked })} />Show pricing</label><label className="rx-check"><input type="checkbox" checked={recommendState.showSpot} onChange={(event) => setRecommendState({ ...recommendState, showSpot: event.target.checked })} />Show spot</label><button className="rx-button" type="button" disabled={recommendState.busy} onClick={runRecommendation}>{recommendState.busy ? 'Running...' : 'Run Recommendation'}</button></div></section><DataTable title="Recommendation Results" columns={[{ key: 'rank', label: '#' }, { key: 'sku', label: 'SKU', render: (row) => normalizeSkuName(row.sku) || 'n/a' }, { key: 'region', label: 'Region' }, { key: 'vCPU', label: 'vCPU' }, { key: 'memGiB', label: 'Mem(GB)' }, { key: 'score', label: 'Score', render: (row) => `${row.score || 0}%` }, { key: 'cpu', label: 'CPU' }, { key: 'disk', label: 'Disk' }, { key: 'purpose', label: 'Type' }, { key: 'capacity', label: 'Capacity', render: (row) => <StatusPill value={row.capacity} /> }, { key: 'zonesOK', label: 'Zones' }, { key: 'priceHr', label: '$/Hr', render: (row) => formatMoney(row.priceHr, 2) }, { key: 'priceMo', label: '$/Mo', render: (row) => formatMoney(row.priceMo, 0) }]} rows={recommendations} emptyMessage="Run a recommendation to see results." /></div>;
    }
    if (activeView === 'sku-chart') {
      return <DataTable key="sku-chart" title="Top SKUs" subtitle="Ranked by total available quota across the current filter scope." columns={[{ key: 'sku', label: 'SKU' }, { key: 'available', label: 'Available Quota', render: (row) => formatNumber(row.available) }]} rows={topSkus} emptyMessage="No SKU rollup data available." />;
    }
    if (activeView === 'ai-model-availability') {
      return <AIModelAvailabilityView rows={aiModelRows} status={aiModelState.status} loading={aiModelState.loading} filters={aiModelFilters} onRefresh={refreshAIModelAvailability} />;
    }
    if (activeView === 'capacity-score') {
      return <div className="rx-view-stack"><section className="rx-panel rx-panel--compact"><div className="rx-panel__header"><div><h2>Regional SKU Capacity Score</h2><p>Derived capacity score plus the latest saved or refreshed live placement details.</p></div></div><div className="rx-field-grid rx-field-grid--filters"><label className="rx-field"><span>Desired Placement Count</span><input className="rx-input" type="number" min="1" max="1000" value={capacityScores.desiredCount} onChange={(event) => setCapacityScores((current) => ({ ...current, desiredCount: String(normalizeDesiredPlacementCount(event.target.value)) }))} /></label><label className="rx-field rx-field--wide"><span>Live Placement Subscription</span><select value={livePlacementSubscriptionId} onChange={(event) => setLivePlacementSubscriptionId(event.target.value)}><option value="">Select subscription</option>{subscriptionOptions.map((option) => <option key={option.subscriptionId} value={option.subscriptionId}>{option.subscriptionName || option.subscriptionId} ({option.subscriptionId})</option>)}</select></label><label className="rx-field"><span>Live Placement Family</span><select value={livePlacementFamily} onChange={(event) => setLivePlacementFamily(event.target.value)}><option value="">Select family</option>{capacityData.facets.families.map((family) => <option key={family} value={family}>{formatFamilyLabel(family) || family}</option>)}</select></label></div><div className="rx-inline-actions"><span className="rx-selected-count">{livePlacementScopeMessage}</span><button className="rx-button" type="button" disabled={capacityScores.busy || !canRefreshLivePlacement} onClick={refreshLivePlacement}>{capacityScores.busy ? 'Refreshing...' : 'Refresh Live Placement'}</button></div><Banner tone={capacityScores.status.tone} message={capacityScores.status.message} detail={capacityScores.status.detail} /></section><section className="rx-panel rx-panel--compact rx-panel--muted"><div className="rx-panel__header"><div><h2>Capacity Score Key</h2><p>Use this legend to distinguish saved capacity signals from live Azure placement responses.</p></div></div><div className="rx-matrix-key rx-matrix-key--compact"><div className="rx-matrix-key__group"><h3>Capacity Score</h3>{capacityScoreLegendItems().map((item) => <div key={item.value} className="rx-matrix-key__item"><StatusPill value={item.value} /><div><p>{item.description}</p></div></div>)}</div><div className="rx-matrix-key__group"><h3>Azure Live Score</h3>{livePlacementLegendItems().map((item) => <div key={item.value} className="rx-matrix-key__item"><StatusPill value={item.value} /><div><p>{item.description}</p></div></div>)}<div className="rx-matrix-key__item"><div><strong>Last Checked</strong><p>The timestamp shows when the latest live result or latest explicit unavailable result was saved.</p></div></div></div></div></section><DataTable title="Capacity Score" subtitle="Derived capacity score plus latest live placement details from SQL snapshots." tableClassName="rx-table--dense rx-capacity-score-table" sectionClassName="rx-panel--compact" columns={[{ key: 'region', label: 'Region' }, { key: 'sku', label: 'SKU', render: (row) => normalizeSkuName(row.sku) || 'n/a' }, { key: 'family', label: 'Family', render: (row) => formatFamilyLabel(row.family) || 'n/a' }, { key: 'score', label: 'Capacity Score', render: (row) => <StatusPill value={row.score} /> }, { key: 'livePlacementScore', label: 'Azure Live Score', render: (row) => row.livePlacementScore || 'n/a' }, { key: 'liveCheckedAtUtc', label: 'Checked', render: (row) => formatTimestamp(row.liveCheckedAtUtc) }, { key: 'subscriptionCount', label: 'Subscriptions', render: (row) => formatNumber(row.subscriptionCount) }, { key: 'okRows', label: 'OK', render: (row) => formatNumber(row.okRows) }, { key: 'limitedRows', label: 'Limited', render: (row) => formatNumber(row.limitedRows) }, { key: 'constrainedRows', label: 'Constrained', render: (row) => formatNumber(row.constrainedRows) }, { key: 'totalQuotaAvailable', label: 'Quota', render: (row) => formatNumber(row.totalQuotaAvailable) }, { key: 'reason', label: 'Reason', headerClassName: 'rx-capacity-score-table__reason', cellClassName: 'rx-capacity-score-table__reason', render: (row) => <span title={row.reason || ''}>{row.reason || 'n/a'}</span> }]} rows={capacityScores.rows} emptyMessage="No capacity score entries available." /><DataTable title="Subscription Summary" tableClassName="rx-table--dense" sectionClassName="rx-panel--compact" columns={[{ key: 'subscriptionKey', label: 'Subscription Key' }, { key: 'skuObservations', label: 'SKU Observations', render: (row) => formatNumber(row.skuObservations || row.totalRows) }, { key: 'constrainedObservations', label: 'Constrained', render: (row) => formatNumber(row.constrainedObservations || row.constrainedRows) }, { key: 'totalQuotaAvailable', label: 'Quota Available', render: (row) => formatNumber(row.totalQuotaAvailable) }]} rows={capacityScores.subscriptionSummary} emptyMessage="No subscription summary rows available." /></div>;
    }
    if (activeView === 'family-summary') {
      return <DataTable key="family-summary" title="Family Summary" subtitle="Compute-family rollup optimized for quota planning conversations." columns={[{ key: 'family', label: 'Family' }, { key: 'skus', label: 'SKUs', render: (row) => formatNumber(row.skus) }, { key: 'ok', label: 'OK SKUs', render: (row) => formatNumber(row.ok) }, { key: 'largest', label: 'Largest' }, { key: 'zones', label: 'Zones' }, { key: 'status', label: 'Status', render: (row) => <StatusPill value={row.status} /> }, { key: 'quota', label: 'Quota', render: (row) => formatNumber(row.quota) }]} rows={familySummaryRows} emptyMessage="No family summary rows available." />;
    }
    if (activeView === 'region-matrix') {
      return <div className="rx-view-stack"><section className="rx-panel rx-panel--compact rx-panel--muted"><div className="rx-panel__header"><div><h2>Region Matrix</h2><p>Family-by-region readiness with row rollups and a deployment-status key.</p></div></div><div className="rx-matrix-key"><div className="rx-matrix-key__group"><h3>Row Color</h3><div className="rx-matrix-key__item"><span className="rx-row-swatch rx-row-swatch--ok"></span><div><strong>Green</strong><p>At least one SKU in this family is fully available.</p></div></div><div className="rx-matrix-key__item"><span className="rx-row-swatch rx-row-swatch--caution"></span><div><strong>Yellow</strong><p>Some SKUs may work, but there are constraints.</p></div></div><div className="rx-matrix-key__item"><span className="rx-row-swatch rx-row-swatch--blocked"></span><div><strong>Gray</strong><p>No SKUs from this family available in scanned regions.</p></div></div></div><div className="rx-matrix-key__group"><h3>Cell Status</h3>{['OK', 'CONSTRAINED', 'LIMITED', 'PARTIAL', 'BLOCKED'].map((status) => { const meta = matrixStatusMeta(status); return <div key={status} className="rx-matrix-key__item"><StatusPill value={status} /><div><strong>{meta.short}</strong><p>{meta.description}</p></div></div>; })}</div></div></section><section className="rx-panel rx-panel--table rx-panel--compact"><div className="rx-panel__header"><div><h2>Region Matrix Report</h2><p>Rows are highlighted by family-level readiness across the selected region scope.</p></div></div><div className="rx-table-wrap"><table className="rx-table rx-table--dense rx-matrix-table"><thead><tr><th>Family</th><th>Key</th><th>Ready</th>{matrix.regions.map((region) => <th key={region}>{region}</th>)}</tr></thead><tbody>{matrix.rows.length === 0 ? <tr><td className="rx-empty" colSpan={Math.max(3, matrix.regions.length + 3)}>No matrix rows available.</td></tr> : matrix.rows.map((row) => <tr key={row.family} className={`rx-matrix-row rx-matrix-row--${String(row.rowStatus || 'blocked').toLowerCase()}`}><td className="rx-matrix-family">{row.family}</td><td><StatusPill value={row.rowStatus === 'CAUTION' ? 'PARTIAL' : row.rowStatus} /></td><td>{formatNumber(row.readyRegionCount)}</td>{matrix.regions.map((region) => { const status = matrix.resolveCellStatus(row.regionMap[region]); const meta = matrixStatusMeta(status); return <td key={region} title={meta.description}><div className="rx-matrix-cell"><StatusPill value={status} /></div></td>; })}</tr>)}</tbody></table></div></section></div>;
    }
    if (activeView === 'trend') {
      return <TrendReport rows={trendRows} filters={filters} selectedSubscriptionCount={selectedSubscriptionIds.length} totalSubscriptionCount={subscriptionOptions.length} />;
    }
    if (activeView === 'quota-workbench') {
      return <QuotaWorkbenchView managementGroups={quotaState.managementGroups} selectedManagementGroup={quotaState.selectedManagementGroup} onManagementGroupChange={(value) => setQuotaState({ ...quotaState, selectedManagementGroup: value })} quotaGroups={quotaState.quotaGroups} selectedQuotaGroup={quotaState.selectedQuotaGroup} onQuotaGroupChange={(value) => setQuotaState({ ...quotaState, selectedQuotaGroup: value, selectedAnalysisRunId: '', selectedDonorSubscriptionId: '', selectedMoveCandidate: null, requestedTransferAmount: 0, planRows: [], impactRows: [], applyResults: [], planSummary: {} })} candidates={quotaState.candidates} candidateFilters={quotaState.candidateFilters} setCandidateFilters={(value) => setQuotaState({ ...quotaState, candidateFilters: value })} selectedMoveCandidate={quotaState.selectedMoveCandidate} onSelectMoveCandidate={(row) => { const skuOptions = normalizeSkuList(row.skuList); const recipientNeed = getQuotaRecipientNeed(row); const movableQuota = Number(row.movableQuota || row.suggestedMovable || 0); const mode = movableQuota > 0 ? 'donor' : 'recipient'; const requestedTransferAmount = mode === 'donor' ? movableQuota : recipientNeed; setQuotaState((current) => ({ ...current, selectedMoveCandidate: { subscriptionId: row.subscriptionId, subscriptionName: row.subscriptionName || row.subscriptionId, donorSubscriptionId: mode === 'donor' ? row.subscriptionId : '', recipientSubscriptionId: mode === 'recipient' ? row.subscriptionId : '', recipientSubscriptionName: row.subscriptionName || row.subscriptionId, region: row.region, quotaName: row.family || row.quotaName, skuList: skuOptions, selectedSku: '', quotaAvailable: row.quotaAvailable, safetyBuffer: row.safetyBuffer, availability: row.availability, movableQuota, mode }, selectedDonorSubscriptionId: mode === 'donor' ? row.subscriptionId : '', requestedTransferAmount, planRows: [], impactRows: [], applyResults: [], planSummary: {}, status: { tone: 'success', message: `Selected ${row.subscriptionName || row.subscriptionId} as a ${mode} quota row. Continue to Step 3 to build the move.` } })); }} quotaRuns={quotaState.quotaRuns} selectedAnalysisRunId={quotaState.selectedAnalysisRunId} donorOptions={donorOptions} selectedDonorSubscriptionId={quotaState.selectedDonorSubscriptionId} onSelectedSkuChange={(value) => setQuotaState({ ...quotaState, selectedMoveCandidate: quotaState.selectedMoveCandidate ? { ...quotaState.selectedMoveCandidate, selectedSku: value } : null, selectedDonorSubscriptionId: '', planRows: [], impactRows: [], applyResults: [], planSummary: {} })} requestedTransferAmount={quotaState.requestedTransferAmount} onRequestedTransferAmountChange={(value) => setQuotaState({ ...quotaState, requestedTransferAmount: Math.max(0, Number(value || 0)), planRows: [], impactRows: [], applyResults: [], planSummary: {} })} onAnalysisRunChange={(value) => setQuotaState({ ...quotaState, selectedAnalysisRunId: value, selectedDonorSubscriptionId: '', planRows: [], impactRows: [], applyResults: [], planSummary: {} })} onDonorSubscriptionChange={(value) => setQuotaState({ ...quotaState, selectedDonorSubscriptionId: value, planRows: [], impactRows: [], applyResults: [], planSummary: {} })} planRows={quotaState.planRows} impactRows={quotaState.impactRows} applyResults={quotaState.applyResults} summary={quotaState.planSummary} actions={quotaActions} busy={quotaState.busy} status={quotaState.status} />;
    }
    if (activeView === 'admin') {
      return <AdminIngestionView job={adminState.job} status={adminState.status} schedule={adminState.schedule} runtime={adminState.runtime} persistence={adminState.persistence} selectedRegionPreset={filters.regionPreset} actions={adminActions} onScheduleChange={(scope, field, value) => setAdminState((current) => ({ ...current, schedule: { ...current.schedule, [scope]: { ...current.schedule[scope], [field]: value } } }))} busy={adminState.busy} viewStatus={adminState.statusMessage} />;
    }
    return <section className="rx-panel"><div className="rx-placeholder">View not implemented yet.</div></section>;
  })();

  return (
    <div className={classNames('rx-shell', !drawerOpen && 'is-drawer-collapsed')}>
      <aside className="rx-sidebar">
        <div className="rx-sidebar__header">
          <div>
            <div className="rx-kicker">React V2</div>
            <h1>Capacity Dashboard</h1>
          </div>
          <a className="rx-link-button" href="/">Classic UI</a>
        </div>
        <div className="rx-nav-group">Reporting</div>
        <nav className="rx-nav-list">
          {visibleViews.filter((view) => !view.adminOnly).map((view) => (
            <button key={view.key} className={classNames('rx-nav-item', activeView === view.key && 'is-active')} type="button" onClick={() => setActiveView(view.key)}>{view.label}</button>
          ))}
        </nav>
        {auth && auth.canAccessAdmin ? <><div className="rx-nav-group">Admin</div><nav className="rx-nav-list">{visibleViews.filter((view) => view.adminOnly).map((view) => <button key={view.key} className={classNames('rx-nav-item', activeView === view.key && 'is-active')} type="button" onClick={() => setActiveView(view.key)}>{view.label}</button>)}</nav></> : null}
      </aside>

      <main className="rx-main">
        <header className="rx-topbar">
          <div>
            <div className="rx-kicker">{deploymentEnvironment.label}</div>
            <h2>{REPORT_VIEWS.find((view) => view.key === activeView)?.label || 'React V2'}</h2>
            <p>Right-side flyout keeps high-cardinality filters like subscriptions out of the main content flow.</p>
          </div>
          <div className="rx-topbar__actions">
            {activeView === 'capacity-grid' ? <>
              <button className="rx-button rx-button--secondary" type="button" disabled={Boolean(exportBusyFormat)} onClick={() => downloadCapacityExport('csv')}>{exportBusyFormat === 'csv' ? 'Exporting CSV...' : 'Export CSV'}</button>
              <button className="rx-button rx-button--secondary" type="button" disabled={Boolean(exportBusyFormat)} onClick={() => downloadCapacityExport('xlsx')}>{exportBusyFormat === 'xlsx' ? 'Exporting Excel...' : 'Export Excel'}</button>
            </> : null}
            {activeView === 'ai-model-availability' ? <button className="rx-button rx-button--secondary" type="button" disabled={aiModelState.loading} onClick={refreshAIModelAvailability}>{aiModelState.loading ? 'Refreshing...' : 'Refresh AI Catalog'}</button> : null}
            {isAdminView ? <label className="rx-check rx-check--sql-toggle"><input type="checkbox" checked={showSqlPreview} disabled={uiSettingsBusy} onChange={(event) => handleShowSqlPreviewChange(event.target.checked)} />Show SQL</label> : null}
            <div className="rx-user-chip">
              <strong>{auth?.name || 'Loading user...'}</strong>
              <small>{auth?.username || 'No Entra context yet'}</small>
            </div>
            {auth?.authEnabled && auth?.isAuthenticated ? <a className="rx-link-button rx-link-button--muted" href="/auth/logout">Logout</a> : null}
            <button className="rx-button rx-button--secondary" type="button" onClick={() => setDrawerOpen((current) => !current)}>{drawerOpen ? 'Hide Filters' : 'Show Filters'}</button>
          </div>
        </header>

        <Banner tone={appStatus.tone} message={appStatus.message} />
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
        {activeView === 'ai-model-availability' ? <DrawerFilterSection title="AI catalog filters">
          <label className="rx-field"><span>Model search</span><input className="rx-input" value={aiModelFilters.modelName} onChange={(event) => setAiModelFilters((current) => ({ ...current, modelName: event.target.value }))} placeholder="gpt-4o, llama, text-embedding" /></label>
          <label className="rx-field"><span>Provider</span><select value={aiModelFilters.provider} onChange={(event) => setAiModelFilters((current) => ({ ...current, provider: event.target.value }))}><option value="all">All providers</option>{aiProviderOptions.map((provider) => <option key={provider} value={provider}>{provider}</option>)}</select></label>
          <label className="rx-field"><span>Deployment type</span><select value={aiModelFilters.deploymentType} onChange={(event) => setAiModelFilters((current) => ({ ...current, deploymentType: event.target.value }))}><option value="all">All deployment types</option>{aiDeploymentTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
          <label className="rx-field"><span>Fine-tuning</span><select value={aiModelFilters.fineTuning} onChange={(event) => setAiModelFilters((current) => ({ ...current, fineTuning: event.target.value }))}><option value="all">All models</option><option value="yes">Fine-tuning capable</option><option value="no">No fine-tuning</option></select></label>
          <label className="rx-check"><input type="checkbox" checked={aiModelFilters.defaultOnly} onChange={(event) => setAiModelFilters((current) => ({ ...current, defaultOnly: event.target.checked }))} />Only default models</label>
        </DrawerFilterSection> : <>
          <DrawerFilterSection title="Capacity filters">
            <label className="rx-field"><span>Resource type</span><select value={filters.resourceType} onChange={(event) => updateFilter('resourceType', event.target.value)}>{RESOURCE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            {filters.resourceType === 'AI' && aiQuotaProviderOptions.length > 0 ? <label className="rx-field"><span>AI provider</span><select value={filters.provider} onChange={(event) => updateFilter('provider', event.target.value)}><option value="all">All verified providers</option>{aiQuotaProviderOptions.map((provider) => <option key={provider} value={provider}>{provider}</option>)}</select></label> : null}
            <label className="rx-field"><span>Family</span><select value={filters.family} onChange={(event) => updateFilter('family', event.target.value)}><option value="all">All Families</option>{capacityData.facets.families.map((family) => <option key={family} value={family}>{formatFamilyLabel(family) || family}</option>)}</select></label>
            <label className="rx-field"><span>Availability</span><select value={filters.availability} onChange={(event) => updateFilter('availability', event.target.value)}><option value="all">All states</option><option value="OK">OK</option><option value="LIMITED">LIMITED</option><option value="CONSTRAINED">CONSTRAINED</option></select></label>
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
