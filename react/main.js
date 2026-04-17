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
  { key: 'quota-discovery', label: 'Quota Discovery', adminOnly: true },
  { key: 'quota-movement', label: 'Quota Movements', adminOnly: true }
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

function regionMatrixRows(rows, selectedRegion) {
  const scopedRows = (rows || []).filter((row) => rowMatchesResourceType(row, 'Compute'));
  const regions = selectedRegion && selectedRegion !== 'all'
    ? [selectedRegion]
    : [...new Set(scopedRows.map((row) => String(row.region || '').trim().toLowerCase()).filter(Boolean))].sort();
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
              <tr key={row.id || row.analysisRunId || row.groupQuotaName || row.subscriptionId || row.sku || index}>
                {columns.map((column) => <td key={column.key} className={column.cellClassName}>{column.render ? column.render(row) : (row[column.key] == null ? 'n/a' : row[column.key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
    quotaRuns,
    actions,
    busy,
    status
  } = props;

  const filteredCandidates = useMemo(() => {
    const familyTerm = String(candidateFilters.family || '').trim().toLowerCase();
    return candidates.filter((row) => {
      const bySub = candidateFilters.subscriptionId === 'all' || row.subscriptionId === candidateFilters.subscriptionId;
      const byRegion = candidateFilters.region === 'all' || row.region === candidateFilters.region;
      const byFamily = !familyTerm || `${row.family || ''} ${row.quotaName || ''}`.toLowerCase().includes(familyTerm);
      return bySub && byRegion && byFamily;
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
          <label className="rx-field rx-field--wide"><span>SKU / Family</span><input className="rx-input" value={candidateFilters.family} onChange={(event) => setCandidateFilters({ ...candidateFilters, family: event.target.value })} placeholder="Search family or quota name" /></label>
          <button className="rx-button rx-button--secondary" type="button" onClick={() => setCandidateFilters({ subscriptionId: 'all', region: 'all', family: '' })}>Clear</button>
        </div>
      </section>
      <DataTable title="Discovered Quota Groups" columns={[{ key: 'managementGroupId', label: 'Management Group' }, { key: 'groupQuotaName', label: 'Quota Group' }, { key: 'displayName', label: 'Display Name' }, { key: 'groupType', label: 'Group Type' }, { key: 'provisioningState', label: 'Provisioning State' }, { key: 'subscriptionCount', label: 'Subscriptions', render: (row) => formatNumber(row.subscriptionCount) }]} rows={quotaGroups} emptyMessage="No quota groups discovered yet." />
      <DataTable title="Quota Candidates" columns={[{ key: 'subscriptionName', label: 'Subscription', render: (row) => row.subscriptionName || row.subscriptionId || 'n/a' }, { key: 'region', label: 'Region' }, { key: 'family', label: 'Family' }, { key: 'availability', label: 'Availability', render: (row) => <StatusPill value={row.availability} /> }, { key: 'quotaCurrent', label: 'Current', render: (row) => formatNumber(row.quotaCurrent) }, { key: 'quotaLimit', label: 'Limit', render: (row) => formatNumber(row.quotaLimit) }, { key: 'quotaAvailable', label: 'Available', render: (row) => formatNumber(row.quotaAvailable) }, { key: 'movableQuota', label: 'Movable', render: (row) => formatNumber(row.movableQuota || row.suggestedMovable) }, { key: 'status', label: 'Status', render: (row) => <StatusPill value={row.status} /> }]} rows={filteredCandidates} emptyMessage="Generate candidates to populate this table." />
      <DataTable title="Captured Runs" columns={[{ key: 'analysisRunId', label: 'Run ID' }, { key: 'capturedAtUtc', label: 'Captured At' }, { key: 'candidateCount', label: 'Rows', render: (row) => formatNumber(row.candidateCount) }]} rows={quotaRuns} emptyMessage="No captured runs yet." />
    </div>
  );
}

function App() {
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
  const [quotaState, setQuotaState] = useState({ managementGroups: [], selectedManagementGroup: '', quotaGroups: [], selectedQuotaGroup: 'all', candidates: [], quotaRuns: [], candidateFilters: { subscriptionId: 'all', region: 'all', family: '' }, status: { tone: 'info', message: 'Quota tools ready.' }, busy: { discover: false, generate: false, capture: false, refresh: false } });

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
  const matrix = useMemo(() => regionMatrixRows(filteredAnalyticsRows, filters.region), [filteredAnalyticsRows, filters.region]);

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
    async function initialize() {
      try {
        const authPayload = await fetchJson('/api/auth/me');
        const authContext = authPayload.auth;
        setAuth(authContext);

        const requests = [fetchJson('/api/subscriptions?limit=500')];
        if (authContext && authContext.canAccessAdmin) {
          requests.push(fetchJson('/api/quota/management-groups'));
        }

        const responses = await Promise.all(requests);
        const subscriptionPayload = responses[0] || { rows: [] };
        const managementGroupPayload = responses[1] || { groups: [], defaultManagementGroupId: '' };
        const subscriptions = Array.isArray(subscriptionPayload.rows) ? subscriptionPayload.rows : [];
        setSubscriptionOptions(subscriptions);
        setSelectedSubscriptionIds(subscriptions.map((row) => row.subscriptionId).filter(Boolean));
        const managementGroups = Array.isArray(managementGroupPayload.groups) ? managementGroupPayload.groups : [];
        const selectedManagementGroup = managementGroupPayload.defaultManagementGroupId && managementGroups.some((group) => group.id === managementGroupPayload.defaultManagementGroupId)
          ? managementGroupPayload.defaultManagementGroupId
          : (managementGroups[0] ? managementGroups[0].id : '');
        setQuotaState((current) => ({ ...current, managementGroups, selectedManagementGroup }));
        setAppStatus({ tone: 'success', message: 'React v2 playground loaded. Use the right-side flyout to manage large filter sets.' });
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
        setQuotaState((current) => ({ ...current, quotaGroups: Array.isArray(payload.groups) ? payload.groups : [] }));
      } catch (error) {
        setQuotaState((current) => ({ ...current, quotaGroups: [], selectedQuotaGroup: 'all', status: { tone: 'error', message: error.message || 'Failed to load quota groups.' } }));
      }
    }
    loadQuotaGroups();
  }, [auth, quotaState.selectedManagementGroup]);

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
        const query = new URLSearchParams({ managementGroupId: quotaState.selectedManagementGroup, groupQuotaName: quotaState.selectedQuotaGroup, regionPreset: filters.regionPreset, region: 'all', family: 'all', subscriptionIds: '' });
        const payload = await fetchJson(`/api/quota/candidates?${query.toString()}`);
        setQuotaState((current) => ({ ...current, candidates: Array.isArray(payload.candidates) ? payload.candidates : [], busy: { ...current.busy, generate: false }, status: { tone: 'success', message: `Generated ${payload.candidateCount || 0} candidate row(s).` } }));
      } catch (error) {
        setQuotaState((current) => ({ ...current, busy: { ...current.busy, generate: false }, status: { tone: 'error', message: error.message || 'Failed to generate quota candidates.' } }));
      }
    },
    capture: async () => {
      if (!auth?.canAccessAdmin) return;
      setQuotaState((current) => ({ ...current, busy: { ...current.busy, capture: true } }));
      try {
        const payload = await fetchJson('/api/quota/candidates/capture', { method: 'POST', body: JSON.stringify({ managementGroupId: quotaState.selectedManagementGroup, groupQuotaName: quotaState.selectedQuotaGroup, regionPreset: filters.regionPreset, region: 'all', family: 'all' }) });
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
    }
  };

  const filteredSubscriptionOptions = useMemo(() => {
    const term = String(subscriptionSearch || '').trim().toLowerCase();
    return subscriptionOptions.filter((option) => !term || String(option.subscriptionName || '').toLowerCase().includes(term) || String(option.subscriptionId || '').toLowerCase().includes(term));
  }, [subscriptionOptions, subscriptionSearch]);

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
      return <DataTable key="trend" title="Trend History" subtitle="Recent trend rows based on the current reporting filter scope." columns={[{ key: 'day', label: 'Day' }, { key: 'totalRows', label: 'Total Rows', render: (row) => formatNumber(row.totalRows) }, { key: 'constrainedRows', label: 'Constrained Rows', render: (row) => formatNumber(row.constrainedRows) }, { key: 'totalQuotaAvailable', label: 'Total Quota Available', render: (row) => formatNumber(row.totalQuotaAvailable) }]} rows={trendRows} emptyMessage="No trend history rows available." />;
    }
    if (activeView === 'quota-discovery') {
      return <QuotaDiscoveryView managementGroups={quotaState.managementGroups} selectedManagementGroup={quotaState.selectedManagementGroup} onManagementGroupChange={(value) => setQuotaState({ ...quotaState, selectedManagementGroup: value })} quotaGroups={quotaState.quotaGroups} selectedQuotaGroup={quotaState.selectedQuotaGroup} onQuotaGroupChange={(value) => setQuotaState({ ...quotaState, selectedQuotaGroup: value })} candidates={quotaState.candidates} candidateFilters={quotaState.candidateFilters} setCandidateFilters={(value) => setQuotaState({ ...quotaState, candidateFilters: value })} quotaRuns={quotaState.quotaRuns} actions={quotaActions} busy={quotaState.busy} status={quotaState.status} />;
    }
    if (activeView === 'admin') {
      return <section className="rx-panel"><div className="rx-panel__header"><div><h2>Data Ingestion</h2><p>This React v2 surface preserves admin gating. The ingestion workflow can be moved here next once the quota/reporting UX stabilizes.</p></div></div><div className="rx-placeholder">Current React focus is on reporting and quota workflows. The classic admin page remains available in the legacy UI.</div></section>;
    }
    if (activeView === 'quota-movement') {
      return <section className="rx-panel"><div className="rx-panel__header"><div><h2>Quota Movements</h2><p>This page is reserved for the move-plan and simulation workflow in React.</p></div></div><div className="rx-placeholder">Next step: port plan build, run selection, and simulation into React with staged confirmations.</div></section>;
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
            <div className="rx-kicker">Dev Playground</div>
            <h2>{REPORT_VIEWS.find((view) => view.key === activeView)?.label || 'React V2'}</h2>
            <p>Right-side flyout keeps high-cardinality filters like subscriptions out of the main content flow.</p>
          </div>
          <div className="rx-topbar__actions">
            {activeView === 'capacity-grid' ? <>
              <button className="rx-button rx-button--secondary" type="button" disabled={Boolean(exportBusyFormat)} onClick={() => downloadCapacityExport('csv')}>{exportBusyFormat === 'csv' ? 'Exporting CSV...' : 'Export CSV'}</button>
              <button className="rx-button rx-button--secondary" type="button" disabled={Boolean(exportBusyFormat)} onClick={() => downloadCapacityExport('xlsx')}>{exportBusyFormat === 'xlsx' ? 'Exporting Excel...' : 'Export Excel'}</button>
            </> : null}
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
