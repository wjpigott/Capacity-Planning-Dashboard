const fallbackRows = [
  { region: 'eastus', sku: 'Standard_D4s_v5', family: 'standardDSv5Family', availability: 'OK', quotaCurrent: 22, quotaLimit: 100, monthlyCost: 280 },
  { region: 'eastus2', sku: 'Standard_E8s_v5', family: 'standardESv5Family', availability: 'LIMITED', quotaCurrent: 40, quotaLimit: 80, monthlyCost: 620 },
  { region: 'centralus', sku: 'Standard_D16s_v5', family: 'standardDSv5Family', availability: 'CONSTRAINED', quotaCurrent: 75, quotaLimit: 80, monthlyCost: 1240 },
  { region: 'westus2', sku: 'Standard_F8s_v2', family: 'standardFSv2Family', availability: 'OK', quotaCurrent: 18, quotaLimit: 120, monthlyCost: 510 },
  { region: 'centralus', sku: 'Standard_D4s_v4', family: 'standardDSv4Family', availability: 'OK', quotaCurrent: 12, quotaLimit: 120, monthlyCost: 260 }
];

let rows = [...fallbackRows];

const regionPresets = {
  USMajor: ['eastus', 'eastus2', 'centralus', 'westus', 'westus2']
};

const gridBody = document.querySelector('#capacityGrid tbody');
const regionPresetFilter = document.querySelector('#regionPresetFilter');
const regionFilter = document.querySelector('#regionFilter');
const familyFilter = document.querySelector('#familyFilter');
const availabilityFilter = document.querySelector('#availabilityFilter');
const summaryCards = document.querySelector('#summaryCards');

function activePresetRegions() {
  const preset = regionPresetFilter.value;
  if (!preset || preset === 'all' || preset === 'custom') {
    return null;
  }
  return regionPresets[preset] || null;
}

function presetScopedRows(data) {
  const presetRegions = activePresetRegions();
  if (!presetRegions) {
    return data;
  }
  return data.filter((row) => presetRegions.includes(row.region));
}

const unique = (key) => [...new Set(presetScopedRows(rows).map(r => r[key]))].sort();

function fillSelect(select, values, allLabel = 'All') {
  select.innerHTML = '';
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = allLabel;
  select.appendChild(all);
  values.forEach(v => {
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
  return presetScopedRows(rows).filter(r => {
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
  const constrained = data.filter(r => r.availability === 'CONSTRAINED').length;
  const totalAvailQuota = data.reduce((acc, r) => acc + (r.quotaLimit - r.quotaCurrent), 0);
  const monthly = data.reduce((acc, r) => acc + r.monthlyCost, 0);

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
  data.forEach(r => {
    const available = r.quotaLimit - r.quotaCurrent;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.region}</td>
      <td>${r.sku}</td>
      <td>${r.family}</td>
      <td><span class="badge ${r.availability}">${r.availability}</span></td>
      <td>${r.quotaCurrent}</td>
      <td>${r.quotaLimit}</td>
      <td>${available}</td>
      <td>${utilization(r)}%</td>
      <td>$${r.monthlyCost.toLocaleString()}</td>
    `;
    gridBody.appendChild(tr);
  });
  renderSummary(data);
}

async function loadCapacityRows() {
  const regionPreset = regionPresetFilter.value || 'USMajor';
  const region = regionPreset === 'custom' ? (regionFilter.value || 'all') : 'all';
  const family = familyFilter.value || 'all';
  const availability = availabilityFilter.value || 'all';

  const query = new URLSearchParams({ regionPreset, region, family, availability });

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
}

function wireTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
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
  document.getElementById('simulateBtn').addEventListener('click', notYet('Simulate impact'));
  document.getElementById('applyBtn').addEventListener('click', () => {
    const ok = confirm('Apply quota movements is a write operation. Continue?');
    if (ok) alert('Apply request queued. Next step: backend orchestration + approval flow.');
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
});
familyFilter.addEventListener('change', renderGrid);
availabilityFilter.addEventListener('change', renderGrid);
wireTabs();
wireButtons();
syncRegionOptions();
loadCapacityRows();
