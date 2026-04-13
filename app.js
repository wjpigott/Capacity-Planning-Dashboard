let rows = [];
let subscriptionOptions = [];
const selectedSubscriptionIds = new Set();

const regionPresets = {
  USMajor: ['eastus', 'eastus2', 'centralus', 'westus', 'westus2']
};

const gridBody = document.querySelector('#capacityGrid tbody');
const regionPresetFilter = document.querySelector('#regionPresetFilter');
const regionFilter = document.querySelector('#regionFilter');
const familyFilter = document.querySelector('#familyFilter');
const availabilityFilter = document.querySelector('#availabilityFilter');
const summaryCards = document.querySelector('#summaryCards');
const subscriptionGridBody = document.querySelector('#subscriptionGrid tbody');
const trendGridBody = document.querySelector('#trendGrid tbody');
const familySummaryGridBody = document.querySelector('#familySummaryGrid tbody');
const familySummaryEmpty = document.querySelector('#familySummaryEmpty');
const regionChart = document.querySelector('#regionChart');
const skuChart = document.querySelector('#skuChart');
const subscriptionSelectionInfo = document.querySelector('#subscriptionSelectionInfo');
const adminStatus = document.querySelector('#adminStatus');
const triggerIngestBtn = document.querySelector('#triggerIngestBtn');
const subscriptionRefreshBtn = document.querySelector('#subscriptionRefreshBtn');

let ingestStatusPollHandle = null;

function setAdminStatus(message, tone = 'info') {
  if (!adminStatus) return;
  adminStatus.className = `admin-status ${tone}`;
  adminStatus.textContent = message;
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

function utilization(row) {
  if (!row.quotaLimit) return 0;
  return Math.round((row.quotaCurrent / row.quotaLimit) * 100);
}

function filteredRows() {
  return presetScopedRows(rows).filter((r) => {
    const byRegion = regionFilter.value === 'all' || r.region === regionFilter.value;
    const byFamily = familyFilter.value === 'all' || r.family === familyFilter.value;
    const byAvailability = availabilityFilter.value === 'all' || r.availability === availabilityFilter.value;
    return byRegion && byFamily && byAvailability;
  });
}

function syncRegionOptions() {
  const availableRegions = unique('region');
  const nextValue = availableRegions.includes(regionFilter.value) ? regionFilter.value : 'all';
  fillSelect(regionFilter, availableRegions);
  regionFilter.value = nextValue;
  regionFilter.disabled = regionPresetFilter.value !== 'custom';
}

function renderSummary(data) {
  const total = data.length;
  const constrained = data.filter((r) => r.availability === 'CONSTRAINED').length;
  const totalAvailQuota = data.reduce((acc, r) => acc + (r.quotaLimit - r.quotaCurrent), 0);
  const monthly = data.reduce((acc, r) => acc + (r.monthlyCost || 0), 0);

  summaryCards.innerHTML = `
    <div class="card"><h3>Rows</h3><p>${total}</p></div>
    <div class="card"><h3>Constrained Rows</h3><p>${constrained}</p></div>
    <div class="card"><h3>Available Quota</h3><p>${totalAvailQuota}</p></div>
    <div class="card"><h3>Monthly Cost</h3><p>$${monthly.toLocaleString()}</p></div>
  `;
}

function renderGrid() {
  const data = filteredRows();
  gridBody.innerHTML = '';
  if (data.length === 0) {
    gridBody.innerHTML = '<tr><td colspan="12" style="text-align: center; padding: 20px; color: #5d7085;">No data available. Ensure ingestion is running and subscriptions are in scope.</td></tr>';
    renderSummary([]);
    renderCharts([]);
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
  renderSummary(data);
  renderCharts(data);
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
    tr.innerHTML = `
      <td>${row.family}</td>
      <td>${row.skus}</td>
      <td>${row.ok}</td>
      <td>${row.largest}</td>
      <td>${row.zones}</td>
      <td>${row.status}</td>
      <td>${row.quota}</td>
    `;
    familySummaryGridBody.appendChild(tr);
  });
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
  return { regionPreset, region, family, availability, subscriptionIds };
}

async function loadAnalytics() {
  const baseFilters = getQueryFilters();
  const base = new URLSearchParams(baseFilters);
  const trendQuery = new URLSearchParams({ ...baseFilters, days: '7' });

  try {
    const [subscriptionResponse, trendResponse, familyResponse] = await Promise.all([
      fetch(`/api/capacity/subscriptions?${base.toString()}`),
      fetch(`/api/capacity/trends?${trendQuery.toString()}`),
      fetch(`/api/capacity/families?${base.toString()}`)
    ]);

    const subscriptionPayload = subscriptionResponse.ok ? await subscriptionResponse.json() : { rows: [] };
    const trendPayload = trendResponse.ok ? await trendResponse.json() : { rows: [] };
    const familyPayload = familyResponse.ok ? await familyResponse.json() : { rows: [] };

    renderSubscriptionSummary(Array.isArray(subscriptionPayload.rows) ? subscriptionPayload.rows : []);
    renderTrends(Array.isArray(trendPayload.rows) ? trendPayload.rows : []);
    renderFamilySummary(Array.isArray(familyPayload.rows) ? familyPayload.rows : []);
  } catch (_) {
    renderSubscriptionSummary([]);
    renderTrends([]);
    renderFamilySummary([]);
  }
}

function renderSubscriptionOptions(options) {
  const subscriptionFilter = document.getElementById('subscriptionFilter');
  if (!subscriptionFilter) return;

  subscriptionFilter.innerHTML = '';
  options.forEach((row) => {
    const opt = document.createElement('option');
    opt.value = row.subscriptionId;
    opt.textContent = row.subscriptionName ? `${row.subscriptionName} (${row.subscriptionId})` : row.subscriptionId;
    opt.selected = selectedSubscriptionIds.has(row.subscriptionId);
    subscriptionFilter.appendChild(opt);
  });

  subscriptionFilter.addEventListener('change', () => {
    const selected = Array.from(subscriptionFilter.selectedOptions).map((o) => o.value);
    selectedSubscriptionIds.clear();
    selected.forEach((id) => selectedSubscriptionIds.add(id));
    subscriptionSelectionInfo.textContent = `${selectedSubscriptionIds.size} selected`;
  });

  subscriptionSelectionInfo.textContent = `${selectedSubscriptionIds.size} selected`;
}

async function loadSubscriptions(showStatus = false) {
  const query = new URLSearchParams({ limit: '500' });

  try {
    const response = await fetch(`/api/subscriptions?${query.toString()}`);
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
  const filters = getQueryFilters();
  const query = new URLSearchParams(filters);

  try {
    const response = await fetch(`/api/capacity?${query.toString()}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    rows = Array.isArray(payload.rows) ? payload.rows : [];
  } catch (_) {
    rows = [];
  }

  syncRegionOptions();
  fillSelect(familyFilter, unique('family'));
  renderGrid();
  loadAnalytics();
}

function wireTabs() {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((t) => t.classList.remove('active'));
      // pages use display:contents so we must toggle each individually
      document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const pageId = btn.dataset.nav + '-page';
      const page = document.getElementById(pageId);
      if (page) page.classList.add('active');
    });
  });
}

function wireViewTabs() {
  document.querySelectorAll('.view-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.view-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
    });
  });
}

function wireButtons() {
  const notYet = (label) => () => alert(`${label} hooked to UI. Next step: connect backend endpoint.`);
  document.getElementById('refreshBtn').addEventListener('click', loadCapacityRows);
  document.getElementById('exportBtn').addEventListener('click', notYet('Export CSV'));
  document.getElementById('discoverBtn').addEventListener('click', notYet('Discover quota groups'));
  document.getElementById('planBtn').addEventListener('click', notYet('Build move plan'));
  document.getElementById('candidateBtn').addEventListener('click', notYet('Generate quota candidates'));
  document.getElementById('historyBtn').addEventListener('click', notYet('Capture quota history'));
  document.getElementById('refreshAnalyticsBtn').addEventListener('click', loadAnalytics);
  document.getElementById('simulateBtn').addEventListener('click', notYet('Simulate impact'));
  triggerIngestBtn.addEventListener('click', triggerCapacityIngest);
  document.getElementById('applyBtn').addEventListener('click', () => {
    const ok = confirm('Apply quota movements is a write operation. Continue?');
    if (ok) alert('Apply request queued. Next step: backend orchestration + approval flow.');
  });

  subscriptionRefreshBtn.addEventListener('click', async () => {
    setAdminStatus('Refreshing subscription catalog...', 'info');
    await loadSubscriptions(true);
  });
  document.getElementById('subscriptionApplyBtn').addEventListener('click', loadCapacityRows);
  document.getElementById('subscriptionClearBtn').addEventListener('click', () => {
    selectedSubscriptionIds.clear();
    renderSubscriptionOptions(subscriptionOptions);
    loadCapacityRows();
  });
}

regionPresetFilter.addEventListener('change', () => {
  syncRegionOptions();
  loadCapacityRows();
});

regionFilter.addEventListener('change', () => {
  if (regionPresetFilter.value === 'custom') {
    loadCapacityRows();
    return;
  }
  renderGrid();
  loadAnalytics();
});

familyFilter.addEventListener('change', () => {
  renderGrid();
  loadAnalytics();
});

availabilityFilter.addEventListener('change', () => {
  renderGrid();
  loadAnalytics();
});

wireTabs();
wireViewTabs();
wireButtons();
syncRegionOptions();
syncIngestStatus().catch(() => {});
loadSubscriptions();
loadCapacityRows();
