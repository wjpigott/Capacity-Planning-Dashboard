let rows = [];
let subscriptionOptions = [];
let managementGroupOptions = [];
let quotaGroupOptions = [];
let quotaRunOptions = [];
const selectedSubscriptionIds = new Set();

const MATRIX_DEFAULT_FAMILIES = [
  'A', 'B', 'D', 'DC', 'DS', 'E', 'F', 'FX', 'G', 'GS', 'H', 'HB', 'HC', 'HX',
  'L', 'M', 'N', 'NC', 'NCC', 'ND', 'NG', 'NV'
];

function getFamilyResourceType(family) {
  const f = (family || '').toLowerCase();
  if (f.endsWith('family')) return 'Compute';
  if (f.includes('disk')) return 'Disk';
  return 'Other';
}

const FAMILY_EXTRA_SKU_MAP = {
  standardHBv3Family: ['Standard_HB120rs_v3'],
  standardHBv4Family: ['Standard_HB176rs_v4'],
  standardNDH100v5Family: ['Standard_ND96isr_H100_v5'],
  standardNCA100v4Family: ['Standard_NC96ads_A100_v4']
};

const regionPresets = {
  USMajor: ['eastus', 'eastus2', 'centralus', 'southcentralus', 'northcentralus', 'westus', 'westus2']
};

const gridBody = document.querySelector('#capacityGrid tbody');
const regionPresetFilter = document.querySelector('#regionPresetFilter');
const regionFilter = document.querySelector('#regionFilter');
const familyFilter = document.querySelector('#familyFilter');
const familySearch = document.querySelector('#familySearch');
const resourceTypeFilter = document.querySelector('#resourceTypeFilter');
const availabilityFilter = document.querySelector('#availabilityFilter');
const summaryCards = document.querySelector('#summaryCards');
const subscriptionGridBody = document.querySelector('#subscriptionGrid tbody');
const quotaDiscoveryGridBody = document.querySelector('#quotaDiscoveryGrid tbody');
const quotaCandidatesGridBody = document.querySelector('#quotaCandidatesGrid tbody');
const quotaPlanGridBody = document.querySelector('#quotaPlanGrid tbody');
const quotaSimulationGridBody = document.querySelector('#quotaSimulationGrid tbody');
const trendGridBody = document.querySelector('#trendGrid tbody');
const familySummaryGridBody = document.querySelector('#familySummaryGrid tbody');
const familySummaryEmpty = document.querySelector('#familySummaryEmpty');
const capacityScoreGridBody = document.querySelector('#capacityScoreGrid tbody');
const capacityScoreEmpty = document.querySelector('#capacityScoreEmpty');
const capacityScoreDesiredCount = document.querySelector('#capacityScoreDesiredCount');
const refreshLivePlacementBtn = document.querySelector('#refreshLivePlacementBtn');
const capacityScoreLiveStatus = document.querySelector('#capacityScoreLiveStatus');
const regionChart = document.querySelector('#regionChart');
const skuChart = document.querySelector('#skuChart');
const subscriptionSelectionInfo = document.querySelector('#subscriptionSelectionInfo');
const adminStatus = document.querySelector('#adminStatus');
const quotaDiscoveryStatus = document.querySelector('#quotaDiscoveryStatus');
const quotaMovementStatus = document.querySelector('#quotaMovementStatus');
const quotaManagementGroupFilter = document.querySelector('#quotaManagementGroupFilter');
const quotaGroupFilter = document.querySelector('#quotaGroupFilter');
const quotaRunFilter = document.querySelector('#quotaRunFilter');
const triggerIngestBtn = document.querySelector('#triggerIngestBtn');
const subscriptionRefreshBtn = document.querySelector('#subscriptionRefreshBtn');
const adminNavItems = document.querySelectorAll('[data-admin-only="true"]');
const ingestStateValue = document.querySelector('#ingestStateValue');
const ingestLastRunValue = document.querySelector('#ingestLastRunValue');
const ingestLastSuccessValue = document.querySelector('#ingestLastSuccessValue');
const ingestDurationValue = document.querySelector('#ingestDurationValue');
const ingestRowsValue = document.querySelector('#ingestRowsValue');
const ingestScoreRowsValue = document.querySelector('#ingestScoreRowsValue');
const ingestSubscriptionsValue = document.querySelector('#ingestSubscriptionsValue');
const ingestRegionsValue = document.querySelector('#ingestRegionsValue');
const ingestFamiliesValue = document.querySelector('#ingestFamiliesValue');
const ingestErrorValue = document.querySelector('#ingestErrorValue');
const topbarReportTitle = document.querySelector('#topbarReportTitle');
const capacityPageInfo = document.querySelector('#capacityPageInfo');
const capacityPageSize = document.querySelector('#capacityPageSize');
const capacityPrevPage = document.querySelector('#capacityPrevPage');
const capacityNextPage = document.querySelector('#capacityNextPage');
const capacityPageLabel = document.querySelector('#capacityPageLabel');

const reportViewLabels = {
  'capacity-grid': 'Capacity Grid',
  'region-chart': 'By Region',
  'sku-chart': 'Top SKUs',
  'capacity-score': 'Capacity Score',
  'family-summary': 'Family Summary',
  'region-matrix': 'Region Matrix',
  trend: 'Trend History'
};

const capacityPaging = {
  pageNumber: 1,
  pageSize: 50,
  total: 0,
  pageCount: 1,
  hasNext: false,
  hasPrev: false
};

let ingestStatusPollHandle = null;

function setAdminStatus(message, tone = 'info') {
  if (!adminStatus) return;
  adminStatus.className = `admin-status ${tone}`;
  adminStatus.textContent = message;
}

function setQuotaDiscoveryStatus(message, tone = 'info') {
  if (!quotaDiscoveryStatus) return;
  quotaDiscoveryStatus.className = `admin-status ${tone}`;
  quotaDiscoveryStatus.textContent = message;
}

function setQuotaMovementStatus(message, tone = 'info') {
  if (!quotaMovementStatus) return;
  quotaMovementStatus.className = `admin-status ${tone}`;
  quotaMovementStatus.textContent = message;
}

function formatTimestamp(value) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

function formatRunLabel(run) {
  const captured = formatTimestamp(run.capturedAtUtc);
  return `${captured} | ${run.analysisRunId} | rows ${run.rowCount ?? 0}`;
}

function formatDuration(ms) {
  if (!ms) {
    return 'n/a';
  }

  if (ms < 1000) {
    return `${ms} ms`;
  }

  return `${(ms / 1000).toFixed(1)} s`;
}

function renderIngestionStatusCard(status) {
  if (!ingestStateValue) {
    return;
  }

  const summary = status?.lastSummary || {};
  const regions = Array.isArray(summary.regions) && summary.regions.length > 0 ? summary.regions.join(', ') : 'n/a';
  const families = Array.isArray(summary.familyFilters) && summary.familyFilters.length > 0 ? summary.familyFilters.join(', ') : 'n/a';

  ingestStateValue.textContent = status?.inProgress ? 'Running' : (status?.lastError ? 'Failed' : (status?.lastSuccessUtc ? 'Healthy' : 'Idle'));
  ingestLastRunValue.textContent = formatTimestamp(status?.lastRunUtc);
  ingestLastSuccessValue.textContent = formatTimestamp(status?.lastSuccessUtc);
  ingestDurationValue.textContent = formatDuration(status?.lastDurationMs);
  ingestRowsValue.textContent = Number(status?.lastInsertedRows || 0).toLocaleString();
  if (ingestScoreRowsValue) {
    ingestScoreRowsValue.textContent = Number(summary.insertedScoreRows || 0).toLocaleString();
  }
  ingestSubscriptionsValue.textContent = Number(summary.subscriptionCount || 0).toLocaleString();
  ingestRegionsValue.textContent = regions;
  ingestFamiliesValue.textContent = families;
  ingestErrorValue.textContent = status?.lastError || 'None';
}

function applyAdminAccess(auth) {
  const canAccessAdmin = auth?.canAccessAdmin !== false;

  adminNavItems.forEach((item) => {
    item.classList.toggle('hidden', !canAccessAdmin);
  });

  if (!canAccessAdmin) {
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
    document.querySelectorAll('.page').forEach((page) => page.classList.remove('active'));
    document.querySelector('[data-nav="reporting"]')?.classList.add('active');
    document.getElementById('reporting-page')?.classList.add('active');
  }
}

function updateTopbarUser(auth) {
  const el = document.getElementById('topbarUserInfo');
  if (!el) return;
  if (auth?.authEnabled && auth?.isAuthenticated && auth?.name) {
    el.innerHTML = `
      <span class="topbar-username">${auth.name}</span>
      <a href="/auth/logout" class="topbar-logout">Sign out</a>
    `;
  }
}

async function loadViewerAuth() {
  try {
    const response = await fetch('/api/auth/me');
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Failed to load auth context.');
    }
    const auth = payload.auth;
    if (auth.authEnabled && !auth.isAuthenticated) {
      window.location.href = '/auth/login';
      return false; // navigating away — callers should not proceed
    }
    updateTopbarUser(auth);
    applyAdminAccess(auth);
    return true;
  } catch {
    applyAdminAccess({ canAccessAdmin: true });
    return true; // network error — proceed and let individual calls fail gracefully
  }
}

function setButtonBusy(button, isBusy, busyLabel) {
  if (!button) return;
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent;
  }

  button.disabled = isBusy;
  button.textContent = isBusy ? busyLabel : button.dataset.defaultLabel;
}

function summarizeIngestionStatus(status) {
  if (!status) {
    return 'Ingestion status unavailable.';
  }

  if (status.inProgress) {
    const started = status.lastRunUtc ? ` Started ${new Date(status.lastRunUtc).toLocaleTimeString()}.` : '';
    return `Capacity ingestion is running.${started}`;
  }

  if (status.lastError) {
    return `Last ingestion failed: ${status.lastError}`;
  }

  if (status.lastSuccessUtc) {
    const rowCount = Number(status.lastInsertedRows || 0).toLocaleString();
    return `Last ingestion succeeded at ${new Date(status.lastSuccessUtc).toLocaleTimeString()} with ${rowCount} row(s) inserted.`;
  }

  return 'No ingestion has run yet.';
}

function stopIngestStatusPolling() {
  if (ingestStatusPollHandle) {
    clearInterval(ingestStatusPollHandle);
    ingestStatusPollHandle = null;
  }
}

async function fetchAdminIngestStatus() {
  const response = await fetch('/api/admin/ingest/status');
  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Failed to retrieve ingestion status.');
  }

  return payload.status;
}

async function syncIngestStatus() {
  const status = await fetchAdminIngestStatus();
  renderIngestionStatusCard(status);

  if (status.inProgress) {
    setButtonBusy(triggerIngestBtn, true, 'Ingest Running...');
    setAdminStatus(summarizeIngestionStatus(status), 'info');
    return status;
  }

  stopIngestStatusPolling();
  setButtonBusy(triggerIngestBtn, false);

  if (status.lastError) {
    setAdminStatus(summarizeIngestionStatus(status), 'error');
    return status;
  }

  setAdminStatus(summarizeIngestionStatus(status), 'success');
  return status;
}

function startIngestStatusPolling() {
  stopIngestStatusPolling();
  ingestStatusPollHandle = setInterval(() => {
    syncIngestStatus().catch((error) => {
      stopIngestStatusPolling();
      setButtonBusy(triggerIngestBtn, false);
      setAdminStatus(error.message || 'Failed to refresh ingestion status.', 'error');
    });
  }, 5000);
}

async function triggerCapacityIngest() {
  setButtonBusy(triggerIngestBtn, true, 'Starting Ingest...');
  setAdminStatus('Starting capacity ingestion...', 'info');

  const body = {
    regionPreset: regionPresetFilter.value === 'all' || regionPresetFilter.value === 'custom'
      ? undefined
      : regionPresetFilter.value
  };

  try {
    const response = await fetch('/api/admin/ingest/capacity', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      const error = new Error(payload.error || 'Failed to start capacity ingestion.');
      error.status = response.status;
      throw error;
    }

    setButtonBusy(triggerIngestBtn, false);
    setAdminStatus(summarizeIngestionStatus(payload.status), 'success');
    await Promise.all([loadSubscriptions(), loadCapacityRows()]);
  } catch (error) {
    if (error.status === 409) {
      setAdminStatus('Capacity ingestion is already running. Polling current status.', 'warn');
      setButtonBusy(triggerIngestBtn, true, 'Ingest Running...');
      startIngestStatusPolling();
      await syncIngestStatus().catch(() => {});
      return;
    }

    setButtonBusy(triggerIngestBtn, false);
    setAdminStatus(error.message || 'Failed to start capacity ingestion.', 'error');
  }
}

function activePresetRegions() {
  const preset = regionPresetFilter.value;
  if (!preset || preset === 'all' || preset === 'custom') {
    return null;
  }
  return regionPresets[preset] || null;
}

function selectedSubscriptionCsv() {
  return [...selectedSubscriptionIds].join(',');
}

function presetScopedRows(data) {
  const presetRegions = activePresetRegions();
  if (!presetRegions) {
    return data;
  }
  return data.filter((row) => presetRegions.includes(row.region));
}

const unique = (key) => [...new Set(presetScopedRows(rows).map((r) => r[key]))].sort();

function fillSelect(select, values, allLabel = 'All') {
  select.innerHTML = '';
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = allLabel;
  select.appendChild(all);
  values.forEach((v) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    select.appendChild(o);
  });
}

function formatFamilyLabel(family) {
  // "StandardDasv7Family" -> "Standard_Dasv7", "PremiumV2DiskCount" stays as-is
  return (family || '')
    .replace(/Family$/i, '')
    .replace(/^(Standard|Basic|Premium)([A-Z])/i, '$1_$2');
}

function applyFamilySearch() {
  const term = (familySearch?.value || '').toLowerCase().trim();
  let firstVisible = null;
  [...familyFilter.options].forEach((opt) => {
    const match = !term || opt.textContent.toLowerCase().includes(term) || opt.value.toLowerCase().includes(term) || opt.value === 'all';
    opt.hidden = !match;
    if (match && firstVisible === null && opt.value !== 'all') firstVisible = opt.value;
  });
  // If current selection is now hidden, fall back to 'all'
  const selected = familyFilter.options[familyFilter.selectedIndex];
  if (selected?.hidden) {
    familyFilter.value = 'all';
    resetCapacityPaging();
    loadCapacityRows();
  }
}

function syncFamilyOptions() {
  const currentValue = familyFilter.value || 'all';
  const dataFamilies = unique('family');

  const selectedType = resourceTypeFilter?.value || 'all';
  const filteredFamilies = selectedType === 'all'
    ? dataFamilies
    : dataFamilies.filter((f) => getFamilyResourceType(f) === selectedType);

  familyFilter.innerHTML = '';
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = 'All';
  familyFilter.appendChild(all);

  filteredFamilies.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = formatFamilyLabel(value);
    familyFilter.appendChild(option);
  });

  // Re-apply any existing search text after rebuilding options
  applyFamilySearch();

  const availableValues = [...familyFilter.options].map((option) => option.value);
  familyFilter.value = availableValues.includes(currentValue) ? currentValue : 'all';
}

function utilization(row) {
  if (!row.quotaLimit) return 0;
  return Math.round((row.quotaCurrent / row.quotaLimit) * 100);
}

function filteredRows() {
  const selectedType = resourceTypeFilter?.value || 'all';
  return presetScopedRows(rows).filter((r) => {
    const byRegion = regionFilter.value === 'all' || r.region === regionFilter.value;
    const byFamily = familyFilter.value === 'all' || r.family === familyFilter.value;
    const byAvailability = availabilityFilter.value === 'all' || r.availability === availabilityFilter.value;
    const byType = selectedType === 'all' || getFamilyResourceType(r.family) === selectedType;
    return byRegion && byFamily && byAvailability && byType;
  });
}

function reportScopedRows() {
  return presetScopedRows(rows).filter((r) => {
    const byRegion = regionFilter.value === 'all' || r.region === regionFilter.value;
    const byAvailability = availabilityFilter.value === 'all' || r.availability === availabilityFilter.value;
    return byRegion && byAvailability;
  });
}

function setActiveReportTitle(viewKey) {
  const label = reportViewLabels[viewKey] || 'Capacity Grid';
  const fullTitle = `Capacity Planning Dashboard - ${label}`;
  if (topbarReportTitle) {
    topbarReportTitle.textContent = fullTitle;
  }
  document.title = fullTitle;
}

function syncRegionOptions() {
  const availableRegions = unique('region');
  const nextValue = availableRegions.includes(regionFilter.value) ? regionFilter.value : 'all';
  fillSelect(regionFilter, availableRegions);
  regionFilter.value = nextValue;
  regionFilter.disabled = regionPresetFilter.value !== 'custom';
}

function resetCapacityPaging() {
  capacityPaging.pageNumber = 1;
}

function renderCapacityPaging() {
  const total = Number(capacityPaging.total || 0);
  const pageSize = Number(capacityPaging.pageSize || 50);
  const pageNumber = Number(capacityPaging.pageNumber || 1);
  const pageCount = Math.max(1, Number(capacityPaging.pageCount || 1));
  const start = total === 0 ? 0 : ((pageNumber - 1) * pageSize) + 1;
  const end = total === 0 ? 0 : Math.min(pageNumber * pageSize, total);

  if (capacityPageInfo) {
    capacityPageInfo.textContent = `Showing ${start}-${end} of ${total}`;
  }
  if (capacityPageLabel) {
    capacityPageLabel.textContent = `Page ${pageNumber} of ${pageCount}`;
  }
  if (capacityPrevPage) {
    capacityPrevPage.disabled = !capacityPaging.hasPrev;
  }
  if (capacityNextPage) {
    capacityNextPage.disabled = !capacityPaging.hasNext;
  }
  if (capacityPageSize) {
    capacityPageSize.value = String(pageSize);
  }
}

function renderSummary(data) {
  const total = Number(capacityPaging.total || data.length || 0);
  const rowsShown = Number(data.length || 0);
  const rowsLabel = total > rowsShown ? `${rowsShown} of ${total}` : `${total}`;
  const constrained = data.filter((r) => r.availability === 'CONSTRAINED').length;
  const totalAvailQuota = data.reduce((acc, r) => acc + (r.quotaLimit - r.quotaCurrent), 0);
  const monthly = data.reduce((acc, r) => acc + (r.monthlyCost || 0), 0);

  summaryCards.innerHTML = `
    <div class="card"><h3>Rows</h3><p>${rowsLabel}</p></div>
    <div class="card"><h3>Constrained Rows</h3><p>${constrained}</p></div>
    <div class="card"><h3>Available Quota</h3><p>${totalAvailQuota}</p></div>
    <div class="card"><h3>Monthly Cost</h3><p>$${monthly.toLocaleString()}</p></div>
  `;
}

function getActiveReportViewKey() {
  const active = document.querySelector('.nav-sub-item.active[data-report-view]');
  return active?.dataset?.reportView || 'capacity-grid';
}

function renderRegionMatrixSummary(data) {
  const scopedData = Array.isArray(data) ? data : [];
  const regions = resolveMatrixRegions(scopedData);
  const familyMap = {};
  const priority = { OK: 3, LIMITED: 2, CONSTRAINED: 1 };

  scopedData.forEach((row) => {
    const fam = normalizeFamilyLabel(row.family) || deriveFamilyFromSkuName(row.sku) || '?';
    const region = String(row.region || '').trim().toLowerCase();
    if (!region) {
      return;
    }

    if (!familyMap[fam]) {
      familyMap[fam] = {};
    }

    const incoming = String(row.availability || '').toUpperCase();
    const current = familyMap[fam][region];
    if (!current || (priority[incoming] || 0) > (priority[current] || 0)) {
      familyMap[fam][region] = incoming || 'CONSTRAINED';
    }
  });

  const families = [...new Set([...MATRIX_DEFAULT_FAMILIES, ...Object.keys(familyMap)])].sort();
  let familiesWithAnyOk = 0;
  let familiesFullyBlocked = 0;

  families.forEach((family) => {
    const statuses = Object.values(familyMap[family] || {});
    if (statuses.includes('OK')) {
      familiesWithAnyOk += 1;
      return;
    }

    if (!statuses.includes('LIMITED') && !statuses.includes('CONSTRAINED')) {
      familiesFullyBlocked += 1;
    }
  });

  summaryCards.innerHTML = `
    <div class="card"><h3>Families Shown</h3><p>${families.length}</p></div>
    <div class="card"><h3>Families with Any OK</h3><p>${familiesWithAnyOk}</p></div>
    <div class="card"><h3>Fully Blocked Families</h3><p>${familiesFullyBlocked}</p></div>
    <div class="card"><h3>Regions in Scope</h3><p>${regions.length}</p></div>
  `;
}

function renderSummaryForActiveView(gridData, matrixData) {
  const view = getActiveReportViewKey();
  if (view === 'region-matrix') {
    renderRegionMatrixSummary(matrixData);
    return;
  }

  renderSummary(gridData);
}

function renderGrid() {
  const data = filteredRows();
  const matrixData = reportScopedRows();
  gridBody.innerHTML = '';
  if (data.length === 0) {
    gridBody.innerHTML = '<tr><td colspan="12" style="text-align: center; padding: 20px; color: #5d7085;">No data available. Ensure ingestion is running and subscriptions are in scope.</td></tr>';
    renderCapacityPaging();
    renderSummaryForActiveView([], matrixData);
    renderCharts([]);
    renderRegionMatrix(matrixData);
    return;
  }
  data.forEach((r) => {
    const available = r.quotaLimit - r.quotaCurrent;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.subscriptionName}</td>
      <td>${r.subscriptionId}</td>
      <td>${r.region}</td>
      <td>${r.sku}</td>
      <td>${r.family}</td>
      <td><span class="badge ${r.availability}">${r.availability}</span></td>
      <td>${r.zonesCsv || 'n/a'}</td>
      <td>${r.quotaCurrent}</td>
      <td>${r.quotaLimit}</td>
      <td>${available}</td>
      <td>${utilization(r)}%</td>
      <td>$${(r.monthlyCost || 0).toLocaleString()}</td>
    `;
    gridBody.appendChild(tr);
  });
  renderCapacityPaging();
  renderSummaryForActiveView(data, matrixData);
  renderCharts(data);
  renderRegionMatrix(matrixData);
}

function renderSubscriptionSummary(summaryRows) {
  if (!subscriptionGridBody) {
    return;
  }

  subscriptionGridBody.innerHTML = '';
  summaryRows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.subscriptionKey}</td>
      <td>${row.rowCount}</td>
      <td>${row.constrainedRows}</td>
      <td>${row.totalQuotaAvailable}</td>
    `;
    subscriptionGridBody.appendChild(tr);
  });
}

function renderQuotaGroups(groups) {
  if (!quotaDiscoveryGridBody) {
    return;
  }

  const selectedQuotaGroup = quotaGroupFilter?.value || 'all';
  const scopedGroups = selectedQuotaGroup === 'all'
    ? groups
    : groups.filter((group) => group.groupQuotaName === selectedQuotaGroup);

  quotaDiscoveryGridBody.innerHTML = '';
  if (!scopedGroups || scopedGroups.length === 0) {
    quotaDiscoveryGridBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px; color: #5d7085;">No quota groups found for the configured management group.</td></tr>';
    return;
  }

  scopedGroups.forEach((group) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${group.managementGroupId || 'n/a'}</td>
      <td>${group.groupQuotaName || 'n/a'}</td>
      <td>${group.displayName || 'n/a'}</td>
      <td>${group.groupType || 'n/a'}</td>
      <td>${group.provisioningState || 'n/a'}</td>
      <td>${group.subscriptionCount ?? 0}</td>
      <td>${(group.subscriptionIds || []).join(', ') || 'n/a'}</td>
    `;
    quotaDiscoveryGridBody.appendChild(tr);
  });
}

function renderQuotaCandidates(candidates) {
  if (!quotaCandidatesGridBody) {
    return;
  }

  quotaCandidatesGridBody.innerHTML = '';
  if (!candidates || candidates.length === 0) {
    quotaCandidatesGridBody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px; color: #5d7085;">No quota candidates generated for the selected scope.</td></tr>';
    return;
  }

  candidates.forEach((candidate) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${candidate.subscriptionName || 'n/a'}</td>
      <td>${candidate.subscriptionId || 'n/a'}</td>
      <td>${candidate.region || 'n/a'}</td>
      <td>${candidate.family || 'n/a'}</td>
      <td>${candidate.availability || 'n/a'}</td>
      <td>${candidate.quotaCurrent ?? 0}</td>
      <td>${candidate.quotaLimit ?? 0}</td>
      <td>${candidate.quotaAvailable ?? 0}</td>
      <td>${candidate.safetyBuffer ?? 0}</td>
      <td>${candidate.suggestedMovable ?? 0}</td>
      <td>${candidate.candidateStatus || 'n/a'}</td>
    `;
    quotaCandidatesGridBody.appendChild(tr);
  });
}

function renderQuotaPlan(planRows) {
  if (!quotaPlanGridBody) {
    return;
  }

  quotaPlanGridBody.innerHTML = '';
  if (!planRows || planRows.length === 0) {
    quotaPlanGridBody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #5d7085;">No move plan rows available for the latest captured candidate run.</td></tr>';
    return;
  }

  planRows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.region || 'n/a'}</td>
      <td>${row.quotaName || 'n/a'}</td>
      <td>${row.donorSubscriptionName || row.donorSubscriptionId || 'n/a'}</td>
      <td>${row.recipientSubscriptionName || row.recipientSubscriptionId || 'n/a'}</td>
      <td>${row.transferAmount ?? 0}</td>
      <td>${row.recipientNeededQuota ?? 0}</td>
      <td>${row.recipientAvailabilityState || 'n/a'}</td>
      <td>${row.sourceAnalysisRunId || 'n/a'}</td>
    `;
    quotaPlanGridBody.appendChild(tr);
  });
}

function renderQuotaSimulation(impactRows) {
  if (!quotaSimulationGridBody) {
    return;
  }

  quotaSimulationGridBody.innerHTML = '';
  if (!impactRows || impactRows.length === 0) {
    quotaSimulationGridBody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 20px; color: #5d7085;">No simulation rows available. Build a move plan and run simulation for a captured analysis run.</td></tr>';
    return;
  }

  impactRows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.role || 'n/a'}</td>
      <td>${row.subscriptionName || row.subscriptionId || 'n/a'}</td>
      <td>${row.region || 'n/a'}</td>
      <td>${row.quotaName || 'n/a'}</td>
      <td>${row.quotaAvailableBefore ?? 0}</td>
      <td>${row.quotaAvailableAfter ?? 0}</td>
      <td>${row.delta ?? 0}</td>
      <td>${row.safetyBuffer ?? 0}</td>
      <td>${row.projectedState || 'n/a'}</td>
    `;
    quotaSimulationGridBody.appendChild(tr);
  });
}

function renderQuotaRunOptions(runs) {
  if (!quotaRunFilter) {
    return;
  }

  quotaRunFilter.innerHTML = '';

  if (!runs || runs.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No captured runs available';
    quotaRunFilter.appendChild(option);
    return;
  }

  runs.forEach((run) => {
    const option = document.createElement('option');
    option.value = run.analysisRunId;
    option.textContent = formatRunLabel(run);
    quotaRunFilter.appendChild(option);
  });

  quotaRunFilter.value = runs[0].analysisRunId;
}

function renderManagementGroupOptions(groups, preferredId) {
  if (!quotaManagementGroupFilter) {
    return;
  }

  quotaManagementGroupFilter.innerHTML = '';
  groups.forEach((group) => {
    const option = document.createElement('option');
    option.value = group.id;
    option.textContent = `${group.displayName} (${group.id})`;
    quotaManagementGroupFilter.appendChild(option);
  });

  if (groups.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No management groups available';
    quotaManagementGroupFilter.appendChild(option);
    return;
  }

  const selectedId = groups.some((group) => group.id === preferredId)
    ? preferredId
    : groups[0].id;
  quotaManagementGroupFilter.value = selectedId;
}

function renderQuotaGroupOptions(groups) {
  if (!quotaGroupFilter) {
    return;
  }

  const previousValue = quotaGroupFilter.value;
  fillSelect(quotaGroupFilter, groups.map((group) => group.groupQuotaName), 'All Quota Groups');
  quotaGroupFilter.value = groups.some((group) => group.groupQuotaName === previousValue) ? previousValue : 'all';
}

async function loadManagementGroups() {
  if (!quotaManagementGroupFilter) {
    return;
  }

  try {
    const response = await fetch('/api/quota/management-groups');
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Failed to load management groups.');
    }

    managementGroupOptions = Array.isArray(payload.groups) ? payload.groups : [];
    renderManagementGroupOptions(managementGroupOptions, payload.defaultManagementGroupId);
  } catch (error) {
    managementGroupOptions = [];
    renderManagementGroupOptions([], null);
    setQuotaDiscoveryStatus(error.message || 'Failed to load management groups.', 'error');
  }
}

async function loadQuotaGroups() {
  const managementGroupId = quotaManagementGroupFilter?.value || '';
  if (!managementGroupId) {
    setQuotaDiscoveryStatus('Select a management group before discovering quota groups.', 'warn');
    renderQuotaGroups([]);
    return;
  }

  setQuotaDiscoveryStatus(`Discovering quota groups for management group ${managementGroupId}...`, 'info');

  try {
    const query = new URLSearchParams({ managementGroupId });
    const response = await fetch(`/api/quota/groups?${query.toString()}`);
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Failed to discover quota groups.');
    }

    quotaGroupOptions = Array.isArray(payload.groups) ? payload.groups : [];
    renderQuotaGroupOptions(quotaGroupOptions);
    const groups = quotaGroupOptions;
    renderQuotaGroups(groups);
    renderQuotaCandidates([]);
    setQuotaDiscoveryStatus(`Quota discovery completed. ${groups.length} group quota(s) found for management group ${payload.managementGroupId}.`, 'success');
  } catch (error) {
    quotaGroupOptions = [];
    renderQuotaGroupOptions([]);
    renderQuotaGroups([]);
    renderQuotaCandidates([]);
    setQuotaDiscoveryStatus(error.message || 'Failed to discover quota groups.', 'error');
  }
}

async function loadQuotaCandidates() {
  const managementGroupId = quotaManagementGroupFilter?.value || '';
  const groupQuotaName = quotaGroupFilter?.value || 'all';

  if (!managementGroupId) {
    setQuotaDiscoveryStatus('Select a management group before generating candidates.', 'warn');
    renderQuotaCandidates([]);
    return;
  }

  if (groupQuotaName === 'all') {
    setQuotaDiscoveryStatus('Select a quota group before generating candidates. Candidate generation runs within a specific quota group scope.', 'warn');
    renderQuotaCandidates([]);
    return;
  }

  setQuotaDiscoveryStatus(`Generating candidates for quota group ${groupQuotaName}...`, 'info');

  try {
    const query = new URLSearchParams({
      managementGroupId,
      groupQuotaName,
      regionPreset: regionPresetFilter.value || 'all',
      region: regionFilter.value || 'all',
      family: familyFilter.value || 'all'
    });
    const response = await fetch(`/api/quota/candidates?${query.toString()}`);
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Failed to generate quota candidates.');
    }

    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    renderQuotaCandidates(candidates);
    setQuotaDiscoveryStatus(`Candidate generation completed. ${payload.candidateCount} movable candidate row(s) found across ${payload.subscriptionCount} subscription(s).`, 'success');
  } catch (error) {
    renderQuotaCandidates([]);
    setQuotaDiscoveryStatus(error.message || 'Failed to generate quota candidates.', 'error');
  }
}

async function loadQuotaCandidateRuns(showStatus = false) {
  const managementGroupId = quotaManagementGroupFilter?.value || '';
  const groupQuotaName = quotaGroupFilter?.value || 'all';

  if (!quotaRunFilter) {
    return;
  }

  if (!managementGroupId || groupQuotaName === 'all') {
    quotaRunOptions = [];
    renderQuotaRunOptions([]);
    return;
  }

  try {
    const query = new URLSearchParams({
      managementGroupId,
      groupQuotaName,
      region: regionFilter.value || 'all',
      family: familyFilter.value || 'all'
    });
    const response = await fetch(`/api/quota/candidate-runs?${query.toString()}`);
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Failed to load captured candidate runs.');
    }

    quotaRunOptions = Array.isArray(payload.runs) ? payload.runs : [];
    renderQuotaRunOptions(quotaRunOptions);
    if (showStatus && quotaRunOptions.length > 0) {
      setQuotaMovementStatus(`Loaded ${payload.runCount} captured analysis run(s) for ${groupQuotaName}.`, 'success');
    }
  } catch (error) {
    quotaRunOptions = [];
    renderQuotaRunOptions([]);
    if (showStatus) {
      setQuotaMovementStatus(error.message || 'Failed to load captured candidate runs.', 'error');
    }
  }
}

async function captureQuotaCandidateHistory() {
  const managementGroupId = quotaManagementGroupFilter?.value || '';
  const groupQuotaName = quotaGroupFilter?.value || 'all';

  if (!managementGroupId) {
    setQuotaDiscoveryStatus('Select a management group before capturing candidate history.', 'warn');
    return;
  }

  if (groupQuotaName === 'all') {
    setQuotaDiscoveryStatus('Select a quota group before capturing candidate history.', 'warn');
    return;
  }

  setQuotaDiscoveryStatus(`Capturing candidate history for quota group ${groupQuotaName}...`, 'info');

  try {
    const response = await fetch('/api/quota/candidates/capture', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        managementGroupId,
        groupQuotaName,
        regionPreset: regionPresetFilter.value || 'all',
        region: regionFilter.value || 'all',
        family: familyFilter.value || 'all'
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Failed to capture quota candidate history.');
    }

    renderQuotaCandidates(Array.isArray(payload.candidates) ? payload.candidates : []);
    setQuotaDiscoveryStatus(`Captured ${payload.insertedRows} candidate snapshot row(s) in analysis run ${payload.analysisRunId}.`, 'success');
    await loadQuotaCandidateRuns(true);
  } catch (error) {
    setQuotaDiscoveryStatus(error.message || 'Failed to capture quota candidate history.', 'error');
  }
}

async function loadQuotaMovePlan() {
  const managementGroupId = quotaManagementGroupFilter?.value || '';
  const groupQuotaName = quotaGroupFilter?.value || 'all';
  const analysisRunId = quotaRunFilter?.value || '';

  if (!managementGroupId) {
    setQuotaMovementStatus('Select a management group before building a move plan.', 'warn');
    renderQuotaPlan([]);
    return;
  }

  if (groupQuotaName === 'all') {
    setQuotaMovementStatus('Select a quota group before building a move plan.', 'warn');
    renderQuotaPlan([]);
    return;
  }

  if (!analysisRunId) {
    setQuotaMovementStatus('Capture quota history first, then select an analysis run before building a move plan.', 'warn');
    renderQuotaPlan([]);
    return;
  }

  setQuotaMovementStatus(`Building move plan from captured analysis run ${analysisRunId}...`, 'info');

  try {
    const query = new URLSearchParams({
      managementGroupId,
      groupQuotaName,
      analysisRunId,
      region: regionFilter.value || 'all',
      family: familyFilter.value || 'all'
    });
    const response = await fetch(`/api/quota/plan?${query.toString()}`);
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Failed to build quota move plan.');
    }

    const planRows = Array.isArray(payload.planRows) ? payload.planRows : [];
    renderQuotaPlan(planRows);
    if (planRows.length === 0) {
      setQuotaMovementStatus(`No move plan rows were produced from source run ${payload.sourceAnalysisRunId}. Captured candidates exist, but there is no matching donor/recipient pair under the current filters.`, 'warn');
      return;
    }

    setQuotaMovementStatus(`Built ${payload.planRowCount} move row(s) from source run ${payload.sourceAnalysisRunId}. Planned transfer total: ${payload.totalPlannedQuota}. Unresolved recipients: ${payload.unresolvedRecipientCount}.`, 'success');
  } catch (error) {
    renderQuotaPlan([]);
    setQuotaMovementStatus(error.message || 'Failed to build quota move plan.', 'error');
  }
}

async function simulateQuotaImpact() {
  const managementGroupId = quotaManagementGroupFilter?.value || '';
  const groupQuotaName = quotaGroupFilter?.value || 'all';
  const analysisRunId = quotaRunFilter?.value || '';

  if (!managementGroupId) {
    setQuotaMovementStatus('Select a management group before simulating impact.', 'warn');
    renderQuotaSimulation([]);
    return;
  }

  if (groupQuotaName === 'all') {
    setQuotaMovementStatus('Select a quota group before simulating impact.', 'warn');
    renderQuotaSimulation([]);
    return;
  }

  if (!analysisRunId) {
    setQuotaMovementStatus('Select a captured analysis run before simulating impact.', 'warn');
    renderQuotaSimulation([]);
    return;
  }

  setQuotaMovementStatus(`Simulating impact for analysis run ${analysisRunId}...`, 'info');

  try {
    const response = await fetch('/api/quota/simulate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        managementGroupId,
        groupQuotaName,
        analysisRunId,
        region: regionFilter.value || 'all',
        family: familyFilter.value || 'all'
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Failed to simulate quota plan impact.');
    }

    renderQuotaSimulation(Array.isArray(payload.impactRows) ? payload.impactRows : []);
    setQuotaMovementStatus(`Simulation completed for run ${payload.sourceAnalysisRunId}. Impacted rows: ${payload.impactedRowCount}. Recipients fully covered: ${payload.recipientResolvedCount}. Donors below buffer: ${payload.atRiskDonorCount}.`, 'success');
  } catch (error) {
    renderQuotaSimulation([]);
    setQuotaMovementStatus(error.message || 'Failed to simulate quota plan impact.', 'error');
  }
}

function renderTrends(trendRows) {
  if (!trendGridBody) {
    return;
  }

  trendGridBody.innerHTML = '';
  trendRows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.day}</td>
      <td>${row.totalRows}</td>
      <td>${row.constrainedRows}</td>
      <td>${row.totalQuotaAvailable}</td>
    `;
    trendGridBody.appendChild(tr);
  });
}

function renderFamilySummary(familyRows) {
  if (!familySummaryGridBody) {
    return;
  }

  familySummaryGridBody.innerHTML = '';
  if (!familyRows || familyRows.length === 0) {
    if (familySummaryEmpty) {
      familySummaryEmpty.style.display = 'block';
    }
    return;
  }

  if (familySummaryEmpty) {
    familySummaryEmpty.style.display = 'none';
  }

  familyRows.forEach((row) => {
    const tr = document.createElement('tr');
    const skuCount = Number(row.skus || 0);
    const okSkuCount = Number(row.ok || 0);
    tr.innerHTML = `
      <td>${formatFamilyLabel(row.family)}</td>
      <td>${skuCount} SKU${skuCount === 1 ? '' : 's'}</td>
      <td>${okSkuCount} SKU${okSkuCount === 1 ? '' : 's'}</td>
      <td>${row.largest}</td>
      <td>${row.zones}</td>
      <td>${row.status}</td>
      <td>${row.quota}</td>
    `;
    familySummaryGridBody.appendChild(tr);
  });
}

function deriveFamilySummaryFromRows(dataRows) {
  const byFamily = new Map();

  (dataRows || []).forEach((row) => {
    const familyRaw = String(row.family || '').trim();
    if (!familyRaw) {
      return;
    }

    if (!byFamily.has(familyRaw)) {
      byFamily.set(familyRaw, {
        family: familyRaw,
        skus: new Set(),
        okSkus: new Set(),
        zones: new Set(),
        maxVcpu: 0,
        maxMemoryGB: 0,
        hasLimited: false,
        hasConstrained: false,
        quotaMax: 0
      });
    }

    const entry = byFamily.get(familyRaw);
    entry.skus.add(row.sku);
    if (row.availability === 'OK') {
      entry.okSkus.add(row.sku);
    }

    entry.maxVcpu = Math.max(entry.maxVcpu, Number(row.vCpu || 0));
    entry.maxMemoryGB = Math.max(entry.maxMemoryGB, Number(row.memoryGB || 0));
    entry.quotaMax = Math.max(entry.quotaMax, Number(row.quotaLimit || 0));
    entry.hasLimited = entry.hasLimited || row.availability === 'LIMITED';
    entry.hasConstrained = entry.hasConstrained || row.availability === 'CONSTRAINED';

    String(row.zonesCsv || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((zone) => entry.zones.add(zone));
  });

  return [...byFamily.values()]
    .map((entry) => {
      const zoneText = entry.zones.size > 0 ? `Zones ${[...entry.zones].sort().join(',')}` : 'No zone data';
      const zoneStatus = entry.zones.size >= 3 ? '✓' : (entry.zones.size > 0 ? '⚠' : '-');
      const status = entry.hasConstrained ? 'CONSTRAINED' : (entry.hasLimited ? 'LIMITED' : 'OK');
      const largest = entry.maxVcpu > 0 || entry.maxMemoryGB > 0
        ? `${entry.maxVcpu}vCPU/${entry.maxMemoryGB}GB`
        : 'n/a';

      return {
        family: entry.family,
        skus: entry.skus.size,
        ok: entry.okSkus.size,
        largest,
        zones: `${zoneStatus} ${zoneText}`,
        status,
        quota: entry.quotaMax
      };
    })
    .sort((left, right) => String(left.family).localeCompare(String(right.family)));
}

function normalizeFamilyLabel(rawFamily) {
  const value = String(rawFamily || '').trim();
  if (!value) {
    return '';
  }

  let normalized = value
    .replace(/^standard/i, '')
    .replace(/family$/i, '')
    .replace(/[\s_-]/g, '')
    .toUpperCase();

  normalized = normalized.replace(/V\d+.*$/, '');
  normalized = normalized.replace(/\d+.*$/, '');
  return normalized;
}

function deriveFamilyFromSkuName(skuName) {
  const match = String(skuName || '').match(/^Standard_([A-Za-z]+)/i);
  if (!match || !match[1]) {
    return '';
  }

  return normalizeFamilyLabel(match[1]);
}

function resolveMatrixRegions(scopedData) {
  const selectedRegions = activePresetRegions();
  if (Array.isArray(selectedRegions) && selectedRegions.length > 0) {
    return [...new Set(selectedRegions.map((region) => String(region || '').trim().toLowerCase()).filter(Boolean))].sort();
  }

  if (regionPresetFilter.value === 'custom' && regionFilter.value && regionFilter.value !== 'all') {
    return [String(regionFilter.value).trim().toLowerCase()];
  }

  return [...new Set((scopedData || []).map((row) => String(row.region || '').trim().toLowerCase()).filter(Boolean))].sort();
}

function renderRegionMatrix(data) {
  const container = document.querySelector('#regionMatrixContainer');
  const empty = document.querySelector('#regionMatrixEmpty');
  if (!container) return;

  container.innerHTML = '';

  const scopedData = data && data.length > 0 ? data : filteredRows();
  const regions = resolveMatrixRegions(scopedData);

  if ((!scopedData || scopedData.length === 0) && regions.length === 0) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  // Status priority: OK > LIMITED > CONSTRAINED > (absent)
  const priority = { OK: 3, LIMITED: 2, CONSTRAINED: 1 };

  // Build map: family -> region -> best status
  const familyMap = {};

  scopedData.forEach((r) => {
    const fam = normalizeFamilyLabel(r.family) || deriveFamilyFromSkuName(r.sku) || '?';
    if (!familyMap[fam]) familyMap[fam] = {};
    const region = String(r.region || '').trim().toLowerCase();
    if (!region) {
      return;
    }

    const cur = familyMap[fam][region];
    const incoming = (r.availability || '').toUpperCase();
    if (!cur || (priority[incoming] || 0) > (priority[cur] || 0)) {
      familyMap[fam][region] = incoming || 'CONSTRAINED';
    }
  });

  const families = [...new Set([...MATRIX_DEFAULT_FAMILIES, ...Object.keys(familyMap)])].sort();

  // Row-level rollup: best status across all regions for row highlight
  function rowRollup(regionMap) {
    const statuses = Object.values(regionMap || {});
    if (statuses.includes('OK')) return 'OK';
    if (statuses.includes('LIMITED')) return 'LIMITED';
    if (statuses.includes('CONSTRAINED')) return 'CONSTRAINED';
    return 'NONE';
  }

  function cellLabel(status) {
    if (status === 'OK') return '✓ OK';
    if (status === 'LIMITED') return '⚠ LTD';
    if (status === 'CONSTRAINED') return '⚠ CON';
    return '✗';
  }

  function rowBg(rollup) {
    if (rollup === 'OK') return 'background:#f0fbf4;';
    if (rollup === 'LIMITED') return 'background:#fffbf0;';
    if (rollup === 'CONSTRAINED') return 'background:#fff5f6;';
    return 'background:#f9fafb;';
  }

  const table = document.createElement('table');
  table.className = 'matrix-table';

  // Header row
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = `<th class="family-col">Family</th>` +
    regions.map((r) => `<th>${r}</th>`).join('');
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body rows
  const tbody = document.createElement('tbody');
  families.forEach((fam) => {
    const regionMap = familyMap[fam] || {};
    const rollup = rowRollup(regionMap);
    const tr = document.createElement('tr');
    tr.setAttribute('style', rowBg(rollup));
    let html = `<td class="family-col">${fam}</td>`;
    regions.forEach((region) => {
      const status = regionMap[region] || 'NONE';
      html += `<td class="matrix-cell ${status}" title="${status}">${cellLabel(status)}</td>`;
    });
    tr.innerHTML = html;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

function renderCapacityScores(scoreRows) {
  if (!capacityScoreGridBody) {
    return;
  }

  capacityScoreGridBody.innerHTML = '';
  if (!scoreRows || scoreRows.length === 0) {
    if (capacityScoreEmpty) {
      capacityScoreEmpty.style.display = 'block';
    }
    capacityScoreGridBody.innerHTML = '<tr><td colspan="14" style="text-align: center; padding: 20px; color: #5d7085;">No derived capacity scores available for the current filter scope.</td></tr>';
    return;
  }

  if (capacityScoreEmpty) {
    capacityScoreEmpty.style.display = 'none';
  }

  scoreRows.forEach((row) => {
    const scoreClass = String(row.score || '').toUpperCase();
    const liveScoreClass = String(row.livePlacementScore || '').toUpperCase();
    const liveStatus = row.livePlacementAvailable == null
      ? (row.livePlacementScore === 'N/A' ? 'No live score returned' : 'Not checked')
      : (row.livePlacementAvailable ? 'Available' : (row.livePlacementRestricted ? 'Restricted' : 'Unavailable'));
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="white-space:nowrap">${row.region || 'n/a'}</td>
      <td style="white-space:nowrap">${row.sku || 'n/a'}</td>
      <td style="white-space:nowrap">${formatFamilyLabel(row.family) || 'n/a'}</td>
      <td><span class="badge ${scoreClass}">${row.score || 'n/a'}</span></td>
      <td><span class="badge ${liveScoreClass}">${row.livePlacementScore || 'N/A'}</span></td>
      <td style="white-space:nowrap">${liveStatus}</td>
      <td style="white-space:nowrap">${row.liveCheckedAtUtc ? formatTimestamp(row.liveCheckedAtUtc) : 'Not checked'}</td>
      <td>${row.subscriptionCount ?? 0}</td>
      <td>${row.okRows ?? 0}</td>
      <td>${row.limitedRows ?? 0}</td>
      <td>${row.constrainedRows ?? 0}</td>
      <td>${row.totalQuotaAvailable ?? 0}</td>
      <td>${row.utilizationPct ?? 0}%</td>
      <td>${row.reason || 'n/a'}</td>
    `;
    capacityScoreGridBody.appendChild(tr);
  });
}

function normalizeDesiredPlacementCount() {
  if (!capacityScoreDesiredCount) {
    return 1;
  }

  const rawValue = Number(capacityScoreDesiredCount.value || 1);
  const normalized = Math.max(1, Math.min(Number.isFinite(rawValue) ? rawValue : 1, 1000));
  capacityScoreDesiredCount.value = String(normalized);
  return normalized;
}

function getFamilyExtraSkus(familyValue) {
  const mapped = FAMILY_EXTRA_SKU_MAP[String(familyValue || '').trim()];
  return Array.isArray(mapped) ? mapped : [];
}

async function refreshLivePlacementScores() {
  if (!refreshLivePlacementBtn) {
    return;
  }

  const filters = getQueryFilters();
  const desiredCount = normalizeDesiredPlacementCount();
  const extraSkus = getFamilyExtraSkus(filters.family);
  setButtonBusy(refreshLivePlacementBtn, true, 'Refreshing...');
  if (capacityScoreLiveStatus) {
    capacityScoreLiveStatus.textContent = 'Refreshing live placement scores from Get-AzVMAvailability...';
  }

  try {
    const response = await fetch('/api/capacity/scores/live', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...filters,
        desiredCount,
        extraSkus
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || 'Failed to refresh live placement scores.');
    }

    renderCapacityScores(Array.isArray(payload.rows) ? payload.rows : []);
    if (capacityScoreLiveStatus) {
      const requestedCount = payload.requestedDesiredCount ?? desiredCount;
      const effectiveCount = payload.effectiveDesiredCount ?? desiredCount;
      const warningText = payload.warning ? ` ${payload.warning}` : '';
      capacityScoreLiveStatus.textContent = `Live placement refreshed at ${formatTimestamp(payload.liveCheckedAtUtc)} via ${payload.source}. Requested ${requestedCount} VM(s); evaluated ${effectiveCount}.${warningText}`;
    }
  } catch (error) {
    if (capacityScoreLiveStatus) {
      capacityScoreLiveStatus.textContent = error.message || 'Failed to refresh live placement scores.';
    }
  } finally {
    setButtonBusy(refreshLivePlacementBtn, false);
  }
}

function renderBarChart(host, items) {
  if (!host) return;
  host.innerHTML = '';
  if (!items || items.length === 0) {
    host.innerHTML = '<div class="inline-note">No data available</div>';
    return;
  }

  const maxValue = Math.max(...items.map((item) => item.value), 1);
  items.forEach((item) => {
    const width = Math.max(2, Math.round((item.value / maxValue) * 100));
    const row = document.createElement('div');
    row.className = 'chart-row';
    row.innerHTML = `
      <div>${item.label}</div>
      <div class="chart-track"><div class="chart-fill" style="width:${width}%"></div></div>
      <div>${item.value}</div>
    `;
    host.appendChild(row);
  });
}

function renderCharts(data) {
  const byRegion = new Map();
  data.forEach((row) => {
    const entry = byRegion.get(row.region) || { OK: 0, LIMITED: 0, CONSTRAINED: 0, RESTRICTED: 0 };
    entry[row.availability] = (entry[row.availability] || 0) + 1;
    byRegion.set(row.region, entry);
  });

  const regionItems = [...byRegion.entries()].map(([region, counts]) => ({
    label: region,
    value: (counts.OK || 0) + (counts.LIMITED || 0)
  })).sort((a, b) => b.value - a.value);
  renderBarChart(regionChart, regionItems);

  const bySku = new Map();
  data.forEach((row) => {
    const available = row.quotaLimit - row.quotaCurrent;
    bySku.set(row.sku, (bySku.get(row.sku) || 0) + available);
  });
  const skuItems = [...bySku.entries()]
    .map(([sku, value]) => ({ label: sku, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  renderBarChart(skuChart, skuItems);
}

function getQueryFilters() {
  const regionPreset = regionPresetFilter.value || 'USMajor';
  const region = regionPreset === 'custom' ? (regionFilter.value || 'all') : 'all';
  const family = familyFilter.value || 'all';
  const availability = availabilityFilter.value || 'all';
  const subscriptionIds = selectedSubscriptionCsv();
  const resourceType = resourceTypeFilter?.value || 'all';
  return { regionPreset, region, family, availability, subscriptionIds, resourceType };
}

async function loadAnalytics() {
  const baseFilters = getQueryFilters();
  const base = new URLSearchParams(baseFilters);
  const trendQuery = new URLSearchParams({ ...baseFilters, days: '7' });
  const familySummaryQuery = new URLSearchParams({ ...baseFilters, family: 'all' });
  const scoreHistoryQuery = new URLSearchParams({
    days: capacityScoreHistoryDays?.value || '30',
    region: baseFilters.region,
    family: baseFilters.family
  });

  try {
    const [subscriptionResponse, trendResponse, familyResponse, scoreResponse, scoreHistoryResponse] = await Promise.all([
      fetch(`/api/capacity/subscriptions?${base.toString()}`),
      fetch(`/api/capacity/trends?${trendQuery.toString()}`),
      fetch(`/api/capacity/families?${familySummaryQuery.toString()}`),
      fetch(`/api/capacity/scores?${base.toString()}`),
      fetch(`/api/capacity/scores/history?${scoreHistoryQuery.toString()}`)
    ]);

    const subscriptionPayload = subscriptionResponse.ok ? await subscriptionResponse.json() : { rows: [] };
    const trendPayload = trendResponse.ok ? await trendResponse.json() : { rows: [] };
    const familyPayload = familyResponse.ok ? await familyResponse.json() : { rows: [] };
    const scorePayload = scoreResponse.ok ? await scoreResponse.json() : { rows: [] };
    const scoreHistoryPayload = scoreHistoryResponse.ok ? await scoreHistoryResponse.json() : { rows: [] };

    renderSubscriptionSummary(Array.isArray(subscriptionPayload.rows) ? subscriptionPayload.rows : []);
    renderTrends(Array.isArray(trendPayload.rows) ? trendPayload.rows : []);
    const familyRows = Array.isArray(familyPayload.rows) ? familyPayload.rows : [];
    renderFamilySummary(familyRows.length > 0 ? familyRows : deriveFamilySummaryFromRows(reportScopedRows()));
    renderCapacityScores(Array.isArray(scorePayload.rows) ? scorePayload.rows : []);
    renderCapacityScoreHistory(Array.isArray(scoreHistoryPayload.rows) ? scoreHistoryPayload.rows : []);
    if (capacityScoreLiveStatus) {
      capacityScoreLiveStatus.textContent = 'Live placement has not been refreshed in this session.';
    }
  } catch (_) {
    renderSubscriptionSummary([]);
    renderTrends([]);
    renderFamilySummary([]);
    renderCapacityScores([]);
    renderCapacityScoreHistory([]);
  }
}

function renderSubscriptionOptions(options) {
  const subscriptionFilter = document.getElementById('subscriptionFilter');
  if (!subscriptionFilter) return;

  if (selectedSubscriptionIds.size === 0 && Array.isArray(options) && options.length > 0) {
    options.forEach((row) => {
      if (row.subscriptionId) {
        selectedSubscriptionIds.add(row.subscriptionId);
      }
    });
  }

  subscriptionFilter.innerHTML = '';
  options.forEach((row) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'subscription-checkbox-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = row.subscriptionId;
    checkbox.checked = selectedSubscriptionIds.has(row.subscriptionId);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedSubscriptionIds.add(row.subscriptionId);
      } else {
        selectedSubscriptionIds.delete(row.subscriptionId);
      }
      subscriptionSelectionInfo.textContent = `${selectedSubscriptionIds.size} selected`;
    });

    const text = document.createElement('span');
    text.textContent = row.subscriptionName ? `${row.subscriptionName} (${row.subscriptionId})` : row.subscriptionId;

    wrapper.appendChild(checkbox);
    wrapper.appendChild(text);
    subscriptionFilter.appendChild(wrapper);
  });

  subscriptionSelectionInfo.textContent = `${selectedSubscriptionIds.size} selected`;
}

async function loadSubscriptions(showStatus = false) {
  const query = new URLSearchParams({ limit: '500' });

  try {
    const response = await fetch(`/api/subscriptions?${query.toString()}`);
    if (response.status === 401) {
      window.location.href = '/auth/login';
      return;
    }
    if (!response.ok) {
      throw new Error('Failed to load subscriptions');
    }
    const payload = await response.json();
    subscriptionOptions = Array.isArray(payload.rows) ? payload.rows : [];
    renderSubscriptionOptions(subscriptionOptions);
    if (showStatus) {
      setAdminStatus(`Subscription catalog refreshed. ${subscriptionOptions.length} subscription(s) loaded.`, 'success');
    }
  } catch (_) {
    subscriptionOptions = [];
    renderSubscriptionOptions(subscriptionOptions);
    if (showStatus) {
      setAdminStatus('Subscription refresh failed. Check backend/API health.', 'error');
    }
  }
}

async function loadCapacityRows() {
  gridBody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:24px;color:#5d7085;">Loading…</td></tr>';
  const filters = getQueryFilters();
  const query = new URLSearchParams({
    ...filters,
    pageNumber: String(capacityPaging.pageNumber),
    pageSize: String(capacityPaging.pageSize)
  });

  try {
    const response = await fetch(`/api/capacity/paged?${query.toString()}`);
    if (response.status === 401) {
      window.location.href = '/auth/login';
      return;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    rows = Array.isArray(payload.data) ? payload.data : [];

    const paging = payload.pagination || {};
    capacityPaging.total = Number(paging.total || 0);
    capacityPaging.pageNumber = Number(paging.pageNumber || capacityPaging.pageNumber || 1);
    capacityPaging.pageSize = Number(paging.pageSize || capacityPaging.pageSize || 50);
    capacityPaging.pageCount = Math.max(1, Number(paging.pageCount || 1));
    capacityPaging.hasNext = Boolean(paging.hasNext);
    capacityPaging.hasPrev = Boolean(paging.hasPrev);
  } catch (_) {
    rows = [];
    capacityPaging.total = 0;
    capacityPaging.pageCount = 1;
    capacityPaging.hasNext = false;
    capacityPaging.hasPrev = false;
  }

  syncRegionOptions();
  syncFamilyOptions();
  renderGrid();
}

function wireTabs() {
  // Admin nav items switch top-level pages
  document.querySelectorAll('.nav-item[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item[data-nav]').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.nav-sub-item[data-report-view]').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const pageId = btn.dataset.nav + '-page';
      const page = document.getElementById(pageId);
      if (page) page.classList.add('active');
    });
  });
}

function wireViewTabs() {
  // Report sub-nav items switch view panels within the reporting page
  document.querySelectorAll('.nav-sub-item[data-report-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-sub-item[data-report-view]').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.view-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      // Always keep reporting page visible
      document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
      document.querySelector('#reporting-page')?.classList.add('active');
      const panel = document.getElementById(`view-${btn.dataset.reportView}`);
      if (panel) panel.classList.add('active');
      setActiveReportTitle(btn.dataset.reportView);

      renderSummaryForActiveView(filteredRows(), reportScopedRows());

      if (btn.dataset.reportView === 'region-matrix') {
        renderRegionMatrix(reportScopedRows());
      }
      if (btn.dataset.reportView === 'family-summary' && familySummaryGridBody && familySummaryGridBody.children.length === 0) {
        renderFamilySummary(deriveFamilySummaryFromRows(reportScopedRows()));
      }
    });
  });
}

function wireButtons() {
  const notYet = (label) => () => alert(`${label} hooked to UI. Next step: connect backend endpoint.`);
  document.getElementById('refreshBtn').addEventListener('click', loadCapacityRows);
  document.getElementById('exportBtn').addEventListener('click', notYet('Export CSV'));
  document.getElementById('discoverBtn').addEventListener('click', loadQuotaGroups);
  document.getElementById('planBtn').addEventListener('click', loadQuotaMovePlan);
  document.getElementById('candidateBtn').addEventListener('click', loadQuotaCandidates);
  document.getElementById('historyBtn').addEventListener('click', captureQuotaCandidateHistory);
  document.getElementById('refreshAnalyticsBtn').addEventListener('click', loadAnalytics);
  document.getElementById('simulateBtn').addEventListener('click', simulateQuotaImpact);
  triggerIngestBtn.addEventListener('click', triggerCapacityIngest);
  refreshLivePlacementBtn?.addEventListener('click', refreshLivePlacementScores);
  document.getElementById('applyBtn').addEventListener('click', () => {
    const ok = confirm('Apply quota movements is a write operation. Continue?');
    if (ok) alert('Apply request queued. Next step: backend orchestration + approval flow.');
  });

  subscriptionRefreshBtn.addEventListener('click', async () => {
    setAdminStatus('Refreshing subscription catalog...', 'info');
    await loadSubscriptions(true);
  });
  document.getElementById('subscriptionApplyBtn').addEventListener('click', () => {
    resetCapacityPaging();
    loadCapacityRows();
  });
  document.getElementById('subscriptionClearBtn').addEventListener('click', () => {
    selectedSubscriptionIds.clear();
    renderSubscriptionOptions(subscriptionOptions);
    resetCapacityPaging();
    loadCapacityRows();
  });

  capacityPageSize?.addEventListener('change', () => {
    const nextPageSize = Math.max(10, Math.min(Number(capacityPageSize.value || 50), 500));
    capacityPaging.pageSize = nextPageSize;
    resetCapacityPaging();
    loadCapacityRows();
  });

  capacityPrevPage?.addEventListener('click', () => {
    if (!capacityPaging.hasPrev) return;
    capacityPaging.pageNumber = Math.max(1, capacityPaging.pageNumber - 1);
    loadCapacityRows();
  });

  capacityNextPage?.addEventListener('click', () => {
    if (!capacityPaging.hasNext) return;
    capacityPaging.pageNumber = capacityPaging.pageNumber + 1;
    loadCapacityRows();
  });
}

quotaManagementGroupFilter?.addEventListener('change', () => {
  quotaGroupOptions = [];
  renderQuotaGroupOptions([]);
  renderQuotaRunOptions([]);
  renderQuotaGroups([]);
  renderQuotaCandidates([]);
  renderQuotaPlan([]);
  renderQuotaSimulation([]);
  setQuotaDiscoveryStatus('Management group changed. Run discovery to load quota groups for the new scope.', 'info');
  setQuotaMovementStatus('Management group changed. Select a quota group and captured analysis run before planning or simulation.', 'info');
});

quotaGroupFilter?.addEventListener('change', () => {
  renderQuotaGroups(quotaGroupOptions);
  renderQuotaCandidates([]);
  renderQuotaPlan([]);
  renderQuotaSimulation([]);
  loadQuotaCandidateRuns(true);
  setQuotaMovementStatus('Quota group changed. Build Move Plan and Simulate Impact use the selected captured analysis run.', 'info');
});

quotaRunFilter?.addEventListener('change', () => {
  renderQuotaPlan([]);
  renderQuotaSimulation([]);
  if (quotaRunFilter.value) {
    setQuotaMovementStatus(`Selected analysis run ${quotaRunFilter.value}. Build Move Plan or Simulate Impact to continue.`, 'info');
  }
});

regionPresetFilter.addEventListener('change', () => {
  syncRegionOptions();
  resetCapacityPaging();
  loadCapacityRows();
});

regionFilter.addEventListener('change', () => {
  resetCapacityPaging();
  loadCapacityRows();
});

resourceTypeFilter?.addEventListener('change', () => {
  familyFilter.value = 'all';
  if (familySearch) familySearch.value = '';
  resetCapacityPaging();
  loadCapacityRows();
});

familySearch?.addEventListener('input', () => {
  applyFamilySearch();
});

familyFilter.addEventListener('change', () => {
  resetCapacityPaging();
  loadCapacityRows();
});

availabilityFilter.addEventListener('change', () => {
  resetCapacityPaging();
  loadCapacityRows();
});

capacityScoreDesiredCount?.addEventListener('change', normalizeDesiredPlacementCount);

wireTabs();
wireViewTabs();
wireButtons();
if (capacityPageSize) {
  capacityPaging.pageSize = Math.max(10, Math.min(Number(capacityPageSize.value || 50), 500));
}
renderCapacityPaging();
syncRegionOptions();
loadViewerAuth().then((proceed) => {
  if (!proceed) return; // not authenticated — navigating to /auth/login
  loadManagementGroups();
  syncIngestStatus().catch(() => {});
  loadSubscriptions().then(() => loadCapacityRows()).then(() => loadAnalytics());
});
