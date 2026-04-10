const fallbackRows = [
  { subscriptionId: 'legacy-data', subscriptionName: 'Legacy data', region: 'eastus', sku: 'Standard_D4s_v5', family: 'standardDSv5Family', availability: 'OK', zonesCsv: '1,2,3', quotaCurrent: 22, quotaLimit: 100, monthlyCost: 280, vCpu: 4, memoryGB: 16 },
  { subscriptionId: 'legacy-data', subscriptionName: 'Legacy data', region: 'eastus2', sku: 'Standard_E8s_v5', family: 'standardESv5Family', availability: 'LIMITED', zonesCsv: '1,2,3', quotaCurrent: 40, quotaLimit: 80, monthlyCost: 620, vCpu: 8, memoryGB: 64 },
  { subscriptionId: 'legacy-data', subscriptionName: 'Legacy data', region: 'centralus', sku: 'Standard_D16s_v5', family: 'standardDSv5Family', availability: 'CONSTRAINED', zonesCsv: '1,2,3', quotaCurrent: 75, quotaLimit: 80, monthlyCost: 1240, vCpu: 16, memoryGB: 64 },
  { subscriptionId: 'legacy-data', subscriptionName: 'Legacy data', region: 'westus2', sku: 'Standard_F8s_v2', family: 'standardFSv2Family', availability: 'OK', zonesCsv: '1,2,3', quotaCurrent: 18, quotaLimit: 120, monthlyCost: 510, vCpu: 8, memoryGB: 16 },
  { subscriptionId: 'legacy-data', subscriptionName: 'Legacy data', region: 'westus', sku: 'Standard_B12ms', family: 'standardBSFamily', availability: 'OK', zonesCsv: '1,2,3', quotaCurrent: 12, quotaLimit: 100, monthlyCost: 260, vCpu: 12, memoryGB: 48 }
];

let rows = [...fallbackRows];
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
const subscriptionSearch = document.querySelector('#subscriptionSearch');
const subscriptionOptionsHost = document.querySelector('#subscriptionOptions');
const subscriptionSelectionInfo = document.querySelector('#subscriptionSelectionInfo');

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
  data.forEach((r) => {
    const available = r.quotaLimit - r.quotaCurrent;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.subscriptionName || 'Legacy data'}</td>
      <td>${r.subscriptionId || 'legacy-data'}</td>
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
  if (!subscriptionOptionsHost) {
    return;
  }

  subscriptionOptionsHost.innerHTML = '';
  options.forEach((row) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'subscription-option';
    wrapper.innerHTML = `
      <input type="checkbox" data-subscription-id="${row.subscriptionId}" ${selectedSubscriptionIds.has(row.subscriptionId) ? 'checked' : ''} />
      <span>
        <strong>${row.subscriptionName}</strong><br />
        <span class="inline-note">${row.subscriptionId}${row.rowCount ? ` • ${row.rowCount} rows` : ''}</span>
      </span>
    `;
    subscriptionOptionsHost.appendChild(wrapper);
  });

  subscriptionOptionsHost.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener('change', (event) => {
      const subId = event.target.getAttribute('data-subscription-id');
      if (!subId) return;
      if (event.target.checked) {
        selectedSubscriptionIds.add(subId);
      } else {
        selectedSubscriptionIds.delete(subId);
      }
      subscriptionSelectionInfo.textContent = `${selectedSubscriptionIds.size} selected`;
    });
  });

  subscriptionSelectionInfo.textContent = `${selectedSubscriptionIds.size} selected`;
}

async function loadSubscriptions() {
  const search = subscriptionSearch?.value?.trim() || '';
  const query = new URLSearchParams({ search, limit: '200' });

  try {
    const response = await fetch(`/api/subscriptions?${query.toString()}`);
    if (!response.ok) {
      throw new Error('Failed to load subscriptions');
    }
    const payload = await response.json();
    subscriptionOptions = Array.isArray(payload.rows) ? payload.rows : [];
    renderSubscriptionOptions(subscriptionOptions);
  } catch (_) {
    subscriptionOptions = [{ subscriptionId: 'legacy-data', subscriptionName: 'Legacy data' }];
    renderSubscriptionOptions(subscriptionOptions);
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
    rows = [...fallbackRows];
  }

  syncRegionOptions();
  fillSelect(familyFilter, unique('family'));
  renderGrid();
  loadAnalytics();
}

function wireTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`${btn.dataset.tab}-panel`).classList.add('active');
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
  document.getElementById('applyBtn').addEventListener('click', () => {
    const ok = confirm('Apply quota movements is a write operation. Continue?');
    if (ok) alert('Apply request queued. Next step: backend orchestration + approval flow.');
  });

  document.getElementById('subscriptionRefreshBtn').addEventListener('click', loadSubscriptions);
  document.getElementById('subscriptionApplyBtn').addEventListener('click', loadCapacityRows);
  document.getElementById('subscriptionClearBtn').addEventListener('click', () => {
    selectedSubscriptionIds.clear();
    renderSubscriptionOptions(subscriptionOptions);
    loadCapacityRows();
  });

  subscriptionSearch.addEventListener('input', () => {
    clearTimeout(window.__subscriptionSearchDebounce);
    window.__subscriptionSearchDebounce = setTimeout(loadSubscriptions, 250);
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
wireButtons();
syncRegionOptions();
loadSubscriptions();
loadCapacityRows();
