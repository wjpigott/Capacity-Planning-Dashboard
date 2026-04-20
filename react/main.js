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
    throw new Error(payload.error || payload.detail || `Request failed (${response.status})`);
  }

  return payload;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
  const family = String((row && row.family) || '').toLowerCase();
  const sku = String((row && row.sku) || '').toLowerCase();
  if (family.includes('disk') || sku.includes('disk') || sku.includes('snapshot')) return 'Disk';
  if (family.endsWith('family') || /^standard_/.test(String((row && row.sku) || ''))) return 'Compute';
  return 'Other';
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
        constrainedFamilyCounts: new Map()
      });
    }
    const entry = byRegion.get(region);
    const availability = String(row.availability || '').toUpperCase();
    const family = formatFamilyLabel(row.family) || String(row.family || row.sku || '').trim() || 'Unknown';
    const subscriptionId = String(row.subscriptionId || row.subscriptionKey || '').trim();
    entry.totalRows += 1;
    entry.totalQuotaHeadroom += Number(row.quotaLimit || 0) - Number(row.quotaCurrent || 0);
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

function Banner({ tone, message }) {
  if (!message) return null;
  return <div className={classNames('rx-banner', `rx-banner--${tone || 'info'}`)}>{message}</div>;
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

function normalizeSkuList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function DataTable({ title, subtitle, columns, rows, emptyMessage, tableClassName, sectionClassName }) {
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
            <tr>{columns.map((column) => <th key={column.key} className={column.headerClassName}>{column.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="rx-empty" colSpan={columns.length}>{emptyMessage}</td></tr>
            ) : rows.map((row, index) => (
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
            <span>
              <strong>{option.subscriptionName || option.subscriptionId}</strong>
              <small>{option.subscriptionId}</small>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function AdminIngestionView(props) {
  const {
    status,
    schedule,
    runtime,
    selectedRegionPreset,
    actions,
    onScheduleChange,
    busy,
    viewStatus
  } = props;

  const summary = status?.lastSummary || {};
  const regions = Array.isArray(summary.regions) && summary.regions.length ? summary.regions.join(', ') : 'n/a';
  const families = Array.isArray(summary.familyFilters) && summary.familyFilters.length ? summary.familyFilters.join(', ') : 'n/a';
  const stateLabel = status?.inProgress ? 'Running' : (status?.lastError ? 'Failed' : (status?.lastSuccessUtc ? 'Healthy' : 'Idle'));

  return (
    <div className="rx-view-stack">
      <Banner tone={viewStatus.tone} message={viewStatus.message} />
      <section className="rx-panel">
        <div className="rx-panel__header"><div><h2>Capacity Ingestion</h2><p>Trigger ingestion runs and manage the background scheduler used by the dashboard.</p></div></div>
        <div className="rx-inline-actions">
          <span className="rx-selected-count">Using region preset: {selectedRegionPreset || 'all'}</span>
          <button className="rx-button" type="button" onClick={actions.triggerIngest} disabled={busy.trigger || status?.inProgress}>{busy.trigger || status?.inProgress ? 'Ingest Running...' : 'Run Capacity Ingestion'}</button>
          <button className="rx-button rx-button--secondary" type="button" onClick={actions.refreshStatus} disabled={busy.refreshStatus}>{busy.refreshStatus ? 'Refreshing...' : 'Refresh Status'}</button>
          <button className="rx-button rx-button--secondary" type="button" onClick={actions.refreshSchedule} disabled={busy.refreshSchedule}>{busy.refreshSchedule ? 'Loading Settings...' : 'Reload Scheduler Settings'}</button>
        </div>
      </section>
      <section className="rx-panel rx-panel--compact rx-panel--muted">
        <div className="rx-panel__header"><div><h2>Current Status</h2><p>Latest ingestion health and the most recent run summary.</p></div></div>
        <div className="rx-summary-grid rx-summary-grid--status">
          <article className="rx-metric-card"><span>State</span><strong>{stateLabel}</strong></article>
          <article className="rx-metric-card rx-metric-card--detail"><span>Last Run</span><strong>{formatTimestamp(status?.lastRunUtc)}</strong></article>
          <article className="rx-metric-card rx-metric-card--detail"><span>Last Success</span><strong>{formatTimestamp(status?.lastSuccessUtc)}</strong></article>
          <article className="rx-metric-card"><span>Duration</span><strong>{formatDuration(status?.lastDurationMs)}</strong></article>
          <article className="rx-metric-card"><span>Inserted Rows</span><strong>{formatNumber(status?.lastInsertedRows || 0)}</strong></article>
          <article className="rx-metric-card"><span>Score Rows</span><strong>{formatNumber(summary.insertedScoreRows || 0)}</strong></article>
          <article className="rx-metric-card"><span>Subscriptions</span><strong>{formatNumber(summary.subscriptionCount || 0)}</strong></article>
          <article className="rx-metric-card rx-metric-card--detail"><span>Regions</span><strong>{regions}</strong></article>
          <article className="rx-metric-card rx-metric-card--detail"><span>Families</span><strong>{families}</strong></article>
          <article className="rx-metric-card rx-metric-card--detail"><span>Last Error</span><strong>{status?.lastError || 'None'}</strong></article>
        </div>
      </section>
      <section className="rx-panel">
        <div className="rx-panel__header"><div><h2>Scheduler Settings</h2><p>Persisted settings are stored in SQL and applied to the runtime scheduler when saved.</p></div></div>
        <div className="rx-field-grid rx-field-grid--filters">
          <label className="rx-field"><span>Ingest Interval (minutes)</span><input className="rx-input" type="number" min="0" step="1" value={schedule.ingest.intervalMinutes} onChange={(event) => onScheduleChange('ingest', 'intervalMinutes', Number(event.target.value || 0))} /></label>
          <label className="rx-field"><span>Live Placement Interval (minutes)</span><input className="rx-input" type="number" min="0" step="1" value={schedule.livePlacement.intervalMinutes} onChange={(event) => onScheduleChange('livePlacement', 'intervalMinutes', Number(event.target.value || 0))} /></label>
          <label className="rx-check"><input type="checkbox" checked={schedule.ingest.runOnStartup} onChange={(event) => onScheduleChange('ingest', 'runOnStartup', event.target.checked)} />Run ingest on startup</label>
          <label className="rx-check"><input type="checkbox" checked={schedule.livePlacement.runOnStartup} onChange={(event) => onScheduleChange('livePlacement', 'runOnStartup', event.target.checked)} />Run live placement on startup</label>
        </div>
        <div className="rx-inline-actions">
          <span className="rx-selected-count">Runtime ingest interval: {formatNumber(runtime.ingest.intervalMinutes)} min</span>
          <span className="rx-selected-count">Runtime live placement interval: {formatNumber(runtime.livePlacement.intervalMinutes)} min</span>
          <button className="rx-button" type="button" onClick={actions.saveSchedule} disabled={busy.saveSchedule}>{busy.saveSchedule ? 'Saving...' : 'Save Scheduler Settings'}</button>
        </div>
      </section>
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
  const [filters, setFilters] = useState({ regionPreset: 'USMajor', region: 'all', family: 'all', availability: 'all', resourceType: 'all' });
  const [capacityData, setCapacityData] = useState({ rows: [], summary: null, facets: { regions: [], families: [] }, pagination: { pageNumber: 1, pageSize: 50, total: 0, pageCount: 1, hasNext: false, hasPrev: false } });
  const [analyticsRows, setAnalyticsRows] = useState([]);
  const [trendRows, setTrendRows] = useState([]);
  const [familyRows, setFamilyRows] = useState([]);
  const [capacityScores, setCapacityScores] = useState({ rows: [], pagination: { pageNumber: 1, pageSize: 50, total: 0, pageCount: 1, hasNext: false, hasPrev: false }, subscriptionSummary: [] });
  const [exportBusyFormat, setExportBusyFormat] = useState('');
  const [recommendState, setRecommendState] = useState({ targetSku: '', autoTargetSku: '', regions: '', autoRegions: '', topN: 10, minScore: 50, showPricing: true, showSpot: false, result: null, status: { tone: 'info', message: 'Run the recommender to populate alternatives.' }, busy: false });
  const [adminState, setAdminState] = useState({ status: null, schedule: { ingest: { intervalMinutes: 0, runOnStartup: false }, livePlacement: { intervalMinutes: 0, runOnStartup: false } }, runtime: { ingest: { intervalMinutes: 0, runOnStartup: false }, livePlacement: { intervalMinutes: 0, runOnStartup: false } }, statusMessage: { tone: 'info', message: 'Data ingestion tools ready.' }, busy: { refreshStatus: false, trigger: false, refreshSchedule: false, saveSchedule: false } });
  const [quotaState, setQuotaState] = useState({ managementGroups: [], selectedManagementGroup: '', quotaGroups: [], selectedQuotaGroup: 'all', candidates: [], quotaRuns: [], selectedAnalysisRunId: '', selectedDonorSubscriptionId: '', selectedMoveCandidate: null, requestedTransferAmount: 0, planRows: [], impactRows: [], applyResults: [], planSummary: {}, candidateFilters: { subscriptionId: 'all', region: 'all', family: '', intent: 'all' }, status: { tone: 'info', message: 'Quota tools ready.' }, busy: { discover: false, generate: false, capture: false, refresh: false, refreshRuns: false, plan: false, simulate: false, apply: false } });
  const [showSqlPreview, setShowSqlPreview] = useState(false);
  const [sqlPreviewState, setSqlPreviewState] = useState({ loading: false, error: '', rows: [] });
  const [uiSettingsBusy, setUiSettingsBusy] = useState(false);

  const queryFilters = useMemo(() => ({
    regionPreset: filters.regionPreset,
    region: filters.region,
    family: filters.family,
    availability: filters.availability,
    resourceType: filters.resourceType,
    subscriptionIds: selectedSubscriptionIds.join(',')
  }), [filters, selectedSubscriptionIds]);

  const visibleViews = useMemo(() => REPORT_VIEWS.filter((view) => !view.adminOnly || auth?.canAccessAdmin), [auth]);

  const filteredAnalyticsRows = useMemo(() => (analyticsRows || []).filter((row) => rowMatchesResourceType(row, filters.resourceType)), [analyticsRows, filters.resourceType]);
  const recommendedTargetSku = useMemo(() => defaultRecommendTargetSkuFromRows(filteredAnalyticsRows), [filteredAnalyticsRows]);
  const recommendedRegions = useMemo(() => defaultRecommendRegionsFromFilters(filters, capacityData.facets.regions, filteredAnalyticsRows), [filters, capacityData.facets.regions, filteredAnalyticsRows]);
  const scopedRegionOptions = useMemo(() => {
    const presetRegions = regionPresets[filters.regionPreset] || [];
    if (presetRegions.length > 0) {
      return presetRegions;
    }
    return Array.isArray(capacityData.facets.regions) ? capacityData.facets.regions : [];
  }, [filters.regionPreset, capacityData.facets.regions]);
  const regionHealth = useMemo(() => deriveRegionHealth(filteredAnalyticsRows), [filteredAnalyticsRows]);
  const topSkus = useMemo(() => topSkuRows(filteredAnalyticsRows), [filteredAnalyticsRows]);
  const familySummaryRows = useMemo(() => (familyRows.length > 0 ? familyRows : familySummaryFromRows(filteredAnalyticsRows)), [familyRows, filteredAnalyticsRows]);
  const matrix = useMemo(() => regionMatrixRows(filteredAnalyticsRows, filters.region, scopedRegionOptions), [filteredAnalyticsRows, filters.region, scopedRegionOptions]);
  const isAdminView = Boolean(auth?.canAccessAdmin && activeView === 'admin');

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

  useEffect(() => {
    async function loadCapacityGrid() {
      try {
        const query = new URLSearchParams({ ...queryFilters, pageNumber: String(capacityData.pagination.pageNumber || 1), pageSize: String(capacityData.pagination.pageSize || 50) });
        const payload = await fetchJson(`/api/capacity/paged?${query.toString()}`);
        setCapacityData({
          rows: Array.isArray(payload.data) ? payload.data.map((row) => ({ ...row, sku: normalizeSkuName(row.sku) })) : [],
          summary: payload.summary || null,
          facets: { regions: Array.isArray(payload.facets && payload.facets.regions) ? payload.facets.regions : [], families: Array.isArray(payload.facets && payload.facets.families) ? payload.facets.families : [] },
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
    async function loadAnalytics() {
      try {
        const query = new URLSearchParams(queryFilters);
        const [capacityPayload, trendPayload, familyPayload, scorePayload, subSummaryPayload] = await Promise.all([
          fetchJson(`/api/capacity?${query.toString()}`),
          fetchJson(`/api/capacity/trends?${new URLSearchParams({ ...queryFilters, days: '7' }).toString()}`),
          fetchJson(`/api/capacity/families?${new URLSearchParams({ ...queryFilters, family: 'all' }).toString()}`),
          fetchJson(`/api/capacity/scores?${new URLSearchParams({ ...queryFilters, pageNumber: '1', pageSize: '50' }).toString()}`),
          fetchJson(`/api/capacity/subscriptions?${query.toString()}`)
        ]);
        setAnalyticsRows(Array.isArray(capacityPayload.rows) ? capacityPayload.rows.map((row) => ({ ...row, sku: normalizeSkuName(row.sku) })) : []);
        setTrendRows(Array.isArray(trendPayload.rows) ? trendPayload.rows : []);
        setFamilyRows(Array.isArray(familyPayload.rows) ? familyPayload.rows : []);
        setCapacityScores({ rows: Array.isArray(scorePayload.rows) ? scorePayload.rows : [], pagination: scorePayload.pagination || { pageNumber: 1, pageSize: 50, total: 0, pageCount: 1, hasNext: false, hasPrev: false }, subscriptionSummary: Array.isArray(subSummaryPayload.rows) ? subSummaryPayload.rows : [] });
      } catch (error) {
        setAppStatus({ tone: 'error', message: error.message || 'Failed to load analytics views.' });
      }
    }
    loadAnalytics();
  }, [queryFilters]);

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
    if (!isAdminView || !showSqlPreview) {
      setSqlPreviewState({ loading: false, error: '', rows: [] });
      return undefined;
    }

    const previewParams = new URLSearchParams({
      view: activeView,
      pageNumber: String(capacityData.pagination.pageNumber || 1),
      pageSize: String(capacityData.pagination.pageSize || 50),
      days: '7',
      desiredCount: '1',
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
  }, [isAdminView, showSqlPreview, activeView, capacityData.pagination.pageNumber, capacityData.pagination.pageSize, filters, selectedSubscriptionIds, quotaState.selectedManagementGroup, quotaState.selectedQuotaGroup, quotaState.selectedAnalysisRunId]);

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
          status: statusPayload.status || null,
          schedule: schedulePayload.settings || current.schedule,
          runtime: schedulePayload.runtime || current.runtime,
          busy: { ...current.busy, refreshStatus: false, refreshSchedule: false },
          statusMessage: { tone: 'success', message: 'Loaded ingestion status and scheduler settings.' }
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
    if (!auth?.canAccessAdmin || activeView !== 'admin' || !adminState.status?.inProgress) {
      return undefined;
    }

    const handle = window.setInterval(async () => {
      try {
        const payload = await fetchJson('/api/admin/ingest/status');
        setAdminState((current) => ({
          ...current,
          status: payload.status || null,
          statusMessage: payload.status?.inProgress
            ? { tone: 'info', message: 'Capacity ingestion is running.' }
            : (payload.status?.lastError
              ? { tone: 'error', message: `Last ingestion failed: ${payload.status.lastError}` }
              : { tone: 'success', message: 'Capacity ingestion completed.' })
        }));
      } catch (error) {
        setAdminState((current) => ({ ...current, statusMessage: { tone: 'error', message: error.message || 'Failed to refresh ingestion status.' } }));
      }
    }, 5000);

    return () => {
      window.clearInterval(handle);
    };
  }, [activeView, adminState.status, auth]);

  function updateFilter(name, value) {
    setFilters((current) => {
      if (name === 'regionPreset') {
        return { ...current, regionPreset: value, region: 'all' };
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
          errorMessage = payload.error || payload.detail || errorMessage;
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
    setRecommendState((current) => ({ ...current, busy: true, status: { tone: 'info', message: `Running recommendations for ${current.targetSku}...` } }));
    try {
      const payload = await fetchJson('/api/capacity/recommendations', { method: 'POST', body: JSON.stringify({ targetSku: recommendState.targetSku, regions: recommendState.regions, regionPreset: filters.regionPreset, topN: recommendState.topN, minScore: recommendState.minScore, showPricing: recommendState.showPricing, showSpot: recommendState.showSpot }) });
      const count = Array.isArray(payload.result && payload.result.recommendations) ? payload.result.recommendations.length : 0;
      setRecommendState((current) => ({ ...current, result: payload.result || null, busy: false, status: { tone: 'success', message: `Recommendation completed. ${count} alternative SKU(s) returned.` } }));
    } catch (error) {
      setRecommendState((current) => ({ ...current, result: null, busy: false, status: { tone: 'error', message: error.message || 'Failed to run recommendations.' } }));
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
          status: payload.status || null,
          busy: { ...current.busy, refreshStatus: false },
          statusMessage: { tone: 'success', message: payload.status?.inProgress ? 'Capacity ingestion is running.' : 'Ingestion status refreshed.' }
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
        setAdminState((current) => ({ ...current, status: payload.status || current.status, busy: { ...current.busy, trigger: false }, statusMessage: { tone: 'success', message: payload.status?.inProgress ? 'Capacity ingestion started.' : 'Capacity ingestion completed.' } }));
      } catch (error) {
        setAdminState((current) => ({ ...current, busy: { ...current.busy, trigger: false }, statusMessage: { tone: 'error', message: error.message || 'Failed to start capacity ingestion.' } }));
      }
    },
    refreshSchedule: async () => {
      if (!auth?.canAccessAdmin) return;
      setAdminState((current) => ({ ...current, busy: { ...current.busy, refreshSchedule: true } }));
      try {
        const payload = await fetchJson('/api/admin/ingest/schedule');
        setAdminState((current) => ({ ...current, schedule: payload.settings || current.schedule, runtime: payload.runtime || current.runtime, busy: { ...current.busy, refreshSchedule: false }, statusMessage: { tone: 'success', message: 'Scheduler settings reloaded.' } }));
      } catch (error) {
        setAdminState((current) => ({ ...current, busy: { ...current.busy, refreshSchedule: false }, statusMessage: { tone: 'error', message: error.message || 'Failed to load scheduler settings.' } }));
      }
    },
    saveSchedule: async () => {
      if (!auth?.canAccessAdmin) return;
      setAdminState((current) => ({ ...current, busy: { ...current.busy, saveSchedule: true }, statusMessage: { tone: 'info', message: 'Saving scheduler settings...' } }));
      try {
        const payload = await fetchJson('/api/admin/ingest/schedule', { method: 'PUT', body: JSON.stringify(adminState.schedule) });
        setAdminState((current) => ({ ...current, schedule: payload.settings || current.schedule, runtime: payload.runtime || current.runtime, busy: { ...current.busy, saveSchedule: false }, statusMessage: { tone: 'success', message: 'Scheduler settings saved and applied.' } }));
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
          <p>Verifying your session for the React dashboard.</p>
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
          <p>This React dashboard is only available to authenticated users.</p>
          <a className="rx-link-button" href="/auth/login">Sign In</a>
        </section>
      </div>
    );
  }

  const viewContent = (() => {
    if (activeView === 'capacity-grid') {
      return <DataTable key="capacity-grid" title="Capacity Grid" subtitle="Server-paged capacity observations using the shared API contract." columns={[{ key: 'subscriptionName', label: 'Subscription' }, { key: 'region', label: 'Region' }, { key: 'sku', label: 'SKU', render: (row) => normalizeSkuName(row.sku) || 'n/a' }, { key: 'family', label: 'Family', render: (row) => formatFamilyLabel(row.family) || 'n/a' }, { key: 'availability', label: 'Availability', render: (row) => <StatusPill value={row.availability} /> }, { key: 'quotaCurrent', label: 'Current', render: (row) => formatNumber(row.quotaCurrent) }, { key: 'quotaLimit', label: 'Limit', render: (row) => formatNumber(row.quotaLimit) }, { key: 'available', label: 'Available', render: (row) => formatNumber(Number(row.quotaLimit || 0) - Number(row.quotaCurrent || 0)) }]} rows={capacityData.rows} emptyMessage="No capacity rows returned for the current filters." />;
    }
    if (activeView === 'region-health') {
      return <DataTable key="region-health" title="Region Health" subtitle="Computed from the same capacity observations used by the classic dashboard." columns={[{ key: 'region', label: 'Region' }, { key: 'totalRows', label: 'Total Rows', render: (row) => formatNumber(row.totalRows) }, { key: 'deployableRows', label: 'Deployable', render: (row) => formatNumber(row.deployableRows) }, { key: 'constrainedRows', label: 'Constrained', render: (row) => formatNumber(row.constrainedRows) }, { key: 'totalQuotaHeadroom', label: 'Quota Headroom', render: (row) => formatNumber(Math.round(row.totalQuotaHeadroom)) }, { key: 'deployableFamilyCount', label: 'Deployable Families', render: (row) => formatNumber(row.deployableFamilyCount) }, { key: 'deployableSubscriptionCount', label: 'Subscriptions', render: (row) => formatNumber(row.deployableSubscriptionCount) }, { key: 'topConstrainedFamilies', label: 'Top Constrained Families', render: (row) => row.topConstrainedFamilies.join(', ') || 'n/a' }]} rows={regionHealth} emptyMessage="No region health data for this filter scope." />;
    }
    if (activeView === 'recommender') {
      const recommendations = Array.isArray(recommendState.result && recommendState.result.recommendations) ? recommendState.result.recommendations : [];
      return <div className="rx-view-stack"><Banner tone={recommendState.status.tone} message={recommendState.status.message} /><section className="rx-panel"><div className="rx-panel__header"><div><h2>Capacity Recommender</h2><p>Same backend recommendation API, but staged into a clearer React workflow.</p></div></div><div className="rx-field-grid rx-field-grid--filters"><label className="rx-field"><span>Target SKU</span><input className="rx-input" value={recommendState.targetSku} onChange={(event) => setRecommendState({ ...recommendState, targetSku: normalizeSkuName(event.target.value), autoTargetSku: recommendState.autoTargetSku })} placeholder="Standard_D4s_v5" /></label><label className="rx-field"><span>Regions</span><input className="rx-input" value={recommendState.regions} onChange={(event) => setRecommendState({ ...recommendState, regions: event.target.value, autoRegions: recommendState.autoRegions })} placeholder="eastus,westus2" /></label><label className="rx-field"><span>Top N</span><input className="rx-input" type="number" min="1" max="25" value={recommendState.topN} onChange={(event) => setRecommendState({ ...recommendState, topN: Number(event.target.value || 10) })} /></label><label className="rx-field"><span>Min Score</span><input className="rx-input" type="number" min="0" max="100" value={recommendState.minScore} onChange={(event) => setRecommendState({ ...recommendState, minScore: Number(event.target.value || 50) })} /></label></div><div className="rx-inline-actions"><span className="rx-selected-count">Scoped default SKU: {recommendedTargetSku || 'n/a'}</span><span className="rx-selected-count">Scoped default Regions: {recommendedRegions || 'n/a'}</span><label className="rx-check"><input type="checkbox" checked={recommendState.showPricing} onChange={(event) => setRecommendState({ ...recommendState, showPricing: event.target.checked })} />Show pricing</label><label className="rx-check"><input type="checkbox" checked={recommendState.showSpot} onChange={(event) => setRecommendState({ ...recommendState, showSpot: event.target.checked })} />Show spot</label><button className="rx-button" type="button" disabled={recommendState.busy} onClick={runRecommendation}>{recommendState.busy ? 'Running...' : 'Run Recommendation'}</button></div></section><DataTable title="Recommendation Results" columns={[{ key: 'rank', label: '#' }, { key: 'sku', label: 'SKU', render: (row) => normalizeSkuName(row.sku) || 'n/a' }, { key: 'region', label: 'Region' }, { key: 'vCPU', label: 'vCPU' }, { key: 'memGiB', label: 'Mem(GB)' }, { key: 'score', label: 'Score', render: (row) => `${row.score || 0}%` }, { key: 'cpu', label: 'CPU' }, { key: 'disk', label: 'Disk' }, { key: 'purpose', label: 'Type' }, { key: 'capacity', label: 'Capacity', render: (row) => <StatusPill value={row.capacity} /> }, { key: 'zonesOK', label: 'Zones' }, { key: 'priceHr', label: '$/Hr', render: (row) => formatMoney(row.priceHr, 2) }, { key: 'priceMo', label: '$/Mo', render: (row) => formatMoney(row.priceMo, 0) }]} rows={recommendations} emptyMessage="Run a recommendation to see results." /></div>;
    }
    if (activeView === 'sku-chart') {
      return <DataTable key="sku-chart" title="Top SKUs" subtitle="Ranked by total available quota across the current filter scope." columns={[{ key: 'sku', label: 'SKU' }, { key: 'available', label: 'Available Quota', render: (row) => formatNumber(row.available) }]} rows={topSkus} emptyMessage="No SKU rollup data available." />;
    }
    if (activeView === 'capacity-score') {
      return <div className="rx-view-stack"><DataTable title="Capacity Score" subtitle="Derived capacity score plus latest live placement details from SQL snapshots." tableClassName="rx-table--dense rx-capacity-score-table" sectionClassName="rx-panel--compact" columns={[{ key: 'region', label: 'Region' }, { key: 'sku', label: 'SKU', render: (row) => normalizeSkuName(row.sku) || 'n/a' }, { key: 'family', label: 'Family', render: (row) => formatFamilyLabel(row.family) || 'n/a' }, { key: 'score', label: 'Score', render: (row) => <StatusPill value={row.score} /> }, { key: 'livePlacementScore', label: 'Live Score', render: (row) => formatNumber(row.livePlacementScore) }, { key: 'subscriptionCount', label: 'Subscriptions', render: (row) => formatNumber(row.subscriptionCount) }, { key: 'okRows', label: 'OK Rows', render: (row) => formatNumber(row.okRows) }, { key: 'limitedRows', label: 'Limited Rows', render: (row) => formatNumber(row.limitedRows) }, { key: 'constrainedRows', label: 'Constrained Rows', render: (row) => formatNumber(row.constrainedRows) }, { key: 'totalQuotaAvailable', label: 'Quota', render: (row) => formatNumber(row.totalQuotaAvailable) }, { key: 'reason', label: 'Reason', headerClassName: 'rx-capacity-score-table__reason', cellClassName: 'rx-capacity-score-table__reason', render: (row) => <span title={row.reason || ''}>{row.reason || 'n/a'}</span> }]} rows={capacityScores.rows} emptyMessage="No capacity score rows available." /><DataTable title="Subscription Summary" tableClassName="rx-table--dense" sectionClassName="rx-panel--compact" columns={[{ key: 'subscriptionKey', label: 'Subscription Key' }, { key: 'skuObservations', label: 'SKU Observations', render: (row) => formatNumber(row.skuObservations || row.totalRows) }, { key: 'constrainedObservations', label: 'Constrained', render: (row) => formatNumber(row.constrainedObservations || row.constrainedRows) }, { key: 'totalQuotaAvailable', label: 'Quota Available', render: (row) => formatNumber(row.totalQuotaAvailable) }]} rows={capacityScores.subscriptionSummary} emptyMessage="No subscription summary rows available." /></div>;
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
      return <AdminIngestionView status={adminState.status} schedule={adminState.schedule} runtime={adminState.runtime} selectedRegionPreset={filters.regionPreset} actions={adminActions} onScheduleChange={(scope, field, value) => setAdminState((current) => ({ ...current, schedule: { ...current.schedule, [scope]: { ...current.schedule[scope], [field]: value } } }))} busy={adminState.busy} viewStatus={adminState.statusMessage} />;
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
        {isAdminView && showSqlPreview ? <SqlPreviewPanel activeViewLabel={REPORT_VIEWS.find((view) => view.key === activeView)?.label || activeView} loading={sqlPreviewState.loading} error={sqlPreviewState.error} rows={sqlPreviewState.rows} /> : null}
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
        <DrawerFilterSection title="Capacity filters">
          <label className="rx-field"><span>Resource type</span><select value={filters.resourceType} onChange={(event) => updateFilter('resourceType', event.target.value)}>{RESOURCE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="rx-field"><span>Family</span><select value={filters.family} onChange={(event) => updateFilter('family', event.target.value)}><option value="all">All Families</option>{capacityData.facets.families.map((family) => <option key={family} value={family}>{formatFamilyLabel(family) || family}</option>)}</select></label>
          <label className="rx-field"><span>Availability</span><select value={filters.availability} onChange={(event) => updateFilter('availability', event.target.value)}><option value="all">All states</option><option value="OK">OK</option><option value="LIMITED">LIMITED</option><option value="CONSTRAINED">CONSTRAINED</option></select></label>
        </DrawerFilterSection>
        <DrawerFilterSection title="Subscriptions">
          <SubscriptionPicker options={filteredSubscriptionOptions} selectedIds={selectedSubscriptionIds} search={subscriptionSearch} onSearch={setSubscriptionSearch} onToggle={toggleSubscription} onSelectAll={selectAllSubscriptions} onClear={clearSubscriptions} />
        </DrawerFilterSection>
      </aside>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
