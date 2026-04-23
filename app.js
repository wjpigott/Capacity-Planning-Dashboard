let rows = [];
let subscriptionOptions = [];
let managementGroupOptions = [];
let quotaGroupOptions = [];
let quotaRunOptions = [];
let quotaCandidateRows = [];
let capacityFacetRegions = [];
let capacityFacetFamilies = [];
let regionMatrixRows = [];
let analyticsRows = [];
let preservedRegionOptions = [];
let preserveRegionOptions = false;
let capacityGridSummary = null;
const selectedSubscriptionIds = new Set();
// Track which report views have had their data loaded at least once.
// Views not in this set will trigger a data fetch on first activation.
const loadedViews = new Set();

const MATRIX_DEFAULT_FAMILIES = [
  'A', 'B', 'D', 'DC', 'DS', 'E', 'F', 'FX', 'G', 'GS', 'H', 'HB', 'HC', 'HX',
  'L', 'M', 'N', 'NC', 'NCC', 'ND', 'NG', 'NV'
];

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

function getRowResourceType(row) {
  const sourceType = String(row?.sourceType || '').toLowerCase();
  const family = String(row?.family || '').toLowerCase();
  const sku = String(row?.sku || '').toLowerCase();
  if (sourceType.includes('azure-ai') || sourceType.includes('openai') || family.startsWith('openai') || family.startsWith('aiservices') || sku.startsWith('aiservices')) return 'AI';
  if (family.includes('disk') || sku.includes('disk') || sku.includes('snapshot')) return 'Disk';
  if (family.endsWith('family') || /^standard_/.test(String(row?.sku || ''))) return 'Compute';
  return 'Other';
}

function getAIModelProviderLabel(row) {
  const provider = String(row?.provider || row?.modelFormat || '').trim();
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
  const provider = String(row?.provider || '').trim();
  if (provider) {
    return provider;
  }

  const sourceType = String(row?.sourceType || '').trim();
  const family = String(row?.family || '').trim();
  if (/^live-azure-openai-ingest$/i.test(sourceType) || /^openai/i.test(family)) {
    return 'OpenAI';
  }

  const match = sourceType.match(/^live-azure-ai-(.+)-ingest$/i);
  return match ? (titleCaseProviderSlug(match[1]) || 'Unknown') : 'Unknown';
}

function getAIQuotaProviderDisplay(row) {
  if (getRowResourceType(row) !== 'AI') {
    return '—';
  }
  const provider = getAIQuotaProviderLabel(row);
  return provider === 'Unknown' ? 'Not tagged' : provider;
}

function rowMatchesSelectedAIQuotaProvider(row, selectedProvider = aiQuotaProviderFilter?.value || 'all') {
  return selectedProvider === 'all' || (getRowResourceType(row) === 'AI' && getAIQuotaProviderLabel(row) === selectedProvider);
}

function rowMatchesSelectedResourceType(row, selectedType = resourceTypeFilter?.value || 'all') {
  return selectedType === 'all' || getRowResourceType(row) === selectedType;
}

function getFamilyResourceType(familyValue) {
  // Reuse row classifier so family option filtering stays aligned with
  // chart/grid filtering logic for Resource Type.
  return getRowResourceType({
    family: familyValue,
    sku: familyValue
  });
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

function compareSkuValues(left, right) {
  return String(left || '').localeCompare(String(right || ''), undefined, {
    sensitivity: 'base',
    numeric: true
  });
}

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

const regionPresets = {
  USEastWest: ['eastus', 'eastus2', 'westus', 'westus2'],
  USCentral: ['centralus', 'northcentralus', 'southcentralus', 'westcentralus'],
  USMajor: ['eastus', 'eastus2', 'centralus', 'westus', 'westus2'],
  Europe: ['westeurope', 'northeurope', 'uksouth', 'francecentral', 'germanywestcentral'],
  AsiaPacific: ['eastasia', 'southeastasia', 'japaneast', 'australiaeast', 'koreacentral'],
  Global: ['eastus', 'westeurope', 'southeastasia', 'australiaeast', 'brazilsouth'],
  USGov: ['usgovvirginia', 'usgovtexas', 'usgovarizona'],
  China: ['chinaeast', 'chinanorth', 'chinaeast2', 'chinanorth2'],
  'ASR-EastWest': ['eastus', 'westus2'],
  'ASR-CentralUS': ['centralus', 'eastus2'],
  // Backward-compatible presets used by existing dashboard flows.
  CommercialAmericas: ['eastus', 'eastus2', 'centralus', 'northcentralus', 'southcentralus', 'westcentralus', 'westus', 'westus2', 'westus3', 'canadacentral', 'canadaeast', 'brazilsouth'],
  CommercialEurope: ['northeurope', 'westeurope', 'uksouth', 'ukwest', 'francecentral', 'germanywestcentral', 'swedencentral', 'switzerlandnorth'],
  CommercialIndiaME: ['centralindia', 'southindia', 'westindia', 'uaenorth', 'uaecentral', 'qatarcentral', 'israelcentral'],
  CommercialAPAC: ['eastasia', 'southeastasia', 'japaneast', 'japanwest', 'koreacentral', 'koreasouth'],
  CommercialAustralia: ['australiaeast', 'australiasoutheast', 'australiacentral', 'australiacentral2'],
  AzureGovernment: ['usgovvirginia', 'usgovtexas', 'usgovarizona'],
  AzureChina: ['chinaeast', 'chinaeast2', 'chinanorth', 'chinanorth2']
};

const RECOMMENDER_FAMILY_SKU_OPTIONS = {
  standardDSv5Family: FAMILY_EXTRA_SKU_MAP.standardDSv5Family,
  standardNCasT4v3Family: FAMILY_EXTRA_SKU_MAP.standardNCasT4v3Family,
  standardNCA100v4Family: FAMILY_EXTRA_SKU_MAP.standardNCA100v4Family,
  standardNCadsH100v5Family: FAMILY_EXTRA_SKU_MAP.standardNCadsH100v5Family,
  standardNCCadsH100v5Family: FAMILY_EXTRA_SKU_MAP.standardNCCadsH100v5Family
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
const trendQuotaChart = document.querySelector('#trendQuotaChart');
const trendObservationChart = document.querySelector('#trendObservationChart');
const familySummaryGridBody = document.querySelector('#familySummaryGrid tbody');
const familySummaryEmpty = document.querySelector('#familySummaryEmpty');
const capacityScoreGridBody = document.querySelector('#capacityScoreGrid tbody');
const capacityScoreEmpty = document.querySelector('#capacityScoreEmpty');
const capacityScoreHistoryDays = document.querySelector('#capacityScoreHistoryDays');
const capacityScoreDesiredCount = document.querySelector('#capacityScoreDesiredCount');
const refreshLivePlacementBtn = document.querySelector('#refreshLivePlacementBtn');
const capacityScoreLiveStatus = document.querySelector('#capacityScoreLiveStatus');
const sidebarToggle = document.querySelector('#sidebarToggle');
const regionHealthGridBody = document.querySelector('#regionHealthGrid tbody');
const skuChart = document.querySelector('#skuChart');
const subscriptionSelectionInfo = document.querySelector('#subscriptionSelectionInfo');
const adminStatus = document.querySelector('#adminStatus');
const quotaDiscoveryStatus = document.querySelector('#quotaDiscoveryStatus');
const quotaMovementStatus = document.querySelector('#quotaMovementStatus');
const quotaManagementGroupFilter = document.querySelector('#quotaManagementGroupFilter');
const quotaGroupFilter = document.querySelector('#quotaGroupFilter');
const quotaCandidateSubscriptionFilter = document.querySelector('#quotaCandidateSubscriptionFilter');
const quotaCandidateRegionFilter = document.querySelector('#quotaCandidateRegionFilter');
const quotaCandidateSkuFilter = document.querySelector('#quotaCandidateSkuFilter');
const quotaCandidateClearFiltersBtn = document.querySelector('#quotaCandidateClearFiltersBtn');
const quotaRunFilter = document.querySelector('#quotaRunFilter');
const triggerIngestBtn = document.querySelector('#triggerIngestBtn');
const subscriptionRefreshBtn = document.querySelector('#subscriptionRefreshBtn');
const ingestIntervalMinutesInput = document.querySelector('#ingestIntervalMinutesInput');
const ingestRunOnStartupInput = document.querySelector('#ingestRunOnStartupInput');
const livePlacementIntervalMinutesInput = document.querySelector('#livePlacementIntervalMinutesInput');
const livePlacementRunOnStartupInput = document.querySelector('#livePlacementRunOnStartupInput');
const saveSchedulerSettingsBtn = document.querySelector('#saveSchedulerSettingsBtn');
const reloadSchedulerSettingsBtn = document.querySelector('#reloadSchedulerSettingsBtn');
const aiModelCatalogIntervalHoursInput = document.querySelector('#aiModelCatalogIntervalHoursInput');
const scheduleSettingsStatus = document.querySelector('#scheduleSettingsStatus');
const scheduleSettingsLabel = document.querySelector('#scheduleSettingsLabel');
const scheduleExplainerPrimary = document.querySelector('#scheduleExplainerPrimary');
const scheduleExplainerSecondary = document.querySelector('#scheduleExplainerSecondary');
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
const operationHistoryBody = document.querySelector('#operationHistoryBody');
const operationHistoryContainer = document.querySelector('#operationHistoryContainer');
const topbarReportTitle = document.querySelector('#topbarReportTitle');
const environmentBadge = document.querySelector('#environmentBadge');
const capacityPageInfo = document.querySelector('#capacityPageInfo');
const capacityPageSize = document.querySelector('#capacityPageSize');
const capacityPrevPage = document.querySelector('#capacityPrevPage');
const capacityNextPage = document.querySelector('#capacityNextPage');
const capacityPageLabel = document.querySelector('#capacityPageLabel');
const capacityScorePageInfo = document.querySelector('#capacityScorePageInfo');
const capacityScorePageSize = document.querySelector('#capacityScorePageSize');
const capacityScorePrevPage = document.querySelector('#capacityScorePrevPage');
const capacityScoreNextPage = document.querySelector('#capacityScoreNextPage');
const capacityScorePageLabel = document.querySelector('#capacityScorePageLabel');
const recommendGridBody = document.querySelector('#recommendGrid tbody');
const recommendTargetSku = document.querySelector('#recommendTargetSku');
const recommendRegions = document.querySelector('#recommendRegions');
const recommendTopN = document.querySelector('#recommendTopN');
const recommendMinScore = document.querySelector('#recommendMinScore');
const recommendShowPricing = document.querySelector('#recommendShowPricing');
const recommendShowSpot = document.querySelector('#recommendShowSpot');
const runRecommendBtn = document.querySelector('#runRecommendBtn');
const recommendStatus = document.querySelector('#recommendStatus');
const recommendTargetSummary = document.querySelector('#recommendTargetSummary');
const recommendWarnings = document.querySelector('#recommendWarnings');
const aiModelsGridBody = document.querySelector('#aiModelsGrid tbody');
const aiModelsStatus = document.querySelector('#aiModelsStatus');
const aiModelNameFilter = document.querySelector('#aiModelNameFilter');
const aiProviderFilter = document.querySelector('#aiProviderFilter');
const aiDeploymentTypeFilter = document.querySelector('#aiDeploymentTypeFilter');
const aiDefaultOnlyInput = document.querySelector('#aiDefaultOnlyInput');
const aiFineTuneFilter = document.querySelector('#aiFineTuneFilter');
const refreshAiModelsBtn = document.querySelector('#refreshAiModelsBtn');
const aiQuotaProviderFilterLabel = document.querySelector('#aiQuotaProviderFilterLabel');
const aiQuotaProviderFilter = document.querySelector('#aiQuotaProviderFilter');

const reportViewLabels = {
  'capacity-grid': 'Capacity Grid',
  'region-health': 'Region Health',
  recommender: 'Capacity Recommender',
  'sku-chart': 'Top SKUs',
  'capacity-score': 'Capacity Score',
  'family-summary': 'Family Summary',
  'region-matrix': 'Region Matrix',
  trend: 'Trend History',
  'ai-model-availability': 'AI Model Availability'
};

const capacityPaging = {
  pageNumber: 1,
  pageSize: 50,
  total: 0,
  pageCount: 1,
  hasNext: false,
  hasPrev: false
};

const capacityScorePaging = {
  pageNumber: 1,
  pageSize: 50,
  total: 0,
  pageCount: 1,
  hasNext: false,
  hasPrev: false
};

let authRedirectInProgress = false;
let lastAutoRecommendTargetSku = '';
let lastAutoRecommendRegions = '';
let aiModelRows = [];

function detectDeploymentEnvironment(hostname = window.location.hostname) {
  const value = String(hostname || '').toLowerCase();

  if (value.includes('-test-') || value.includes('test') || value.includes('demo')) {
    return { key: 'test', label: 'TEST / DEMO' };
  }

  if (value.includes('-dev-') || value.includes('dev')) {
    return { key: 'dev', label: 'DEV' };
  }

  if (value.includes('-prod-') || value.includes('prod')) {
    return { key: 'prod', label: 'PROD' };
  }

  return { key: 'default', label: '' };
}

function applyDeploymentTheme() {
  const environment = detectDeploymentEnvironment();
  document.body.dataset.environment = environment.key;

  if (!environmentBadge) {
    return;
  }

  if (environment.label) {
    environmentBadge.textContent = environment.label;
    environmentBadge.hidden = false;
  } else {
    environmentBadge.hidden = true;
  }
}

function redirectToLoginOnce() {
  if (authRedirectInProgress) {
    return;
  }

  authRedirectInProgress = true;
  window.location.href = '/auth/login';
}

let ingestStatusPollHandle = null;
let operationHistoryPollHandle = null;
let currentIngestJobId = null;

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

function normalizeSchedulerInterval(value, fallback = 0) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate)) {
    return Math.max(0, Math.min(Math.trunc(Number(fallback) || 0), 10080));
  }
  return Math.max(0, Math.min(Math.trunc(candidate), 10080));
}

function setScheduleSettingsStatus(message) {
  if (!scheduleSettingsStatus) {
    return;
  }
  scheduleSettingsStatus.textContent = message;
}

let schedulerPersistence = {
  available: true,
  source: 'sql',
  message: 'SQL scheduler settings are available.'
};

function renderSchedulerPersistence(persistence) {
  schedulerPersistence = persistence || schedulerPersistence;
  const available = schedulerPersistence.available !== false;

  if (scheduleSettingsLabel) {
    scheduleSettingsLabel.textContent = available ? 'Scheduler Settings (Stored in SQL)' : 'Scheduler Settings (Runtime Only)';
  }

  if (scheduleExplainerPrimary) {
    scheduleExplainerPrimary.innerHTML = available
      ? '<strong>Capacity ingest</strong>, <strong>Live placement refresh</strong>, and the <strong>AI model catalog cadence</strong> are stored in SQL and can be updated here without an app restart.'
      : '<strong>Capacity ingest</strong>, <strong>Live placement refresh</strong>, and the <strong>AI model catalog cadence</strong> are currently using runtime defaults because SQL-backed scheduler persistence is unavailable in this environment.';
  }

  if (scheduleExplainerSecondary) {
    scheduleExplainerSecondary.textContent = available
      ? 'Use startup toggles when you want a job to run one time after service start, in addition to its repeating interval. The AI model catalog interval is shown in hours because it refreshes more slowly than quota snapshots.'
      : 'The current runtime intervals are shown below, but scheduler values cannot be edited here until the DashboardSetting table is provisioned.';
  }

  [ingestIntervalMinutesInput, ingestRunOnStartupInput, livePlacementIntervalMinutesInput, livePlacementRunOnStartupInput, aiModelCatalogIntervalHoursInput].forEach((element) => {
    if (element) {
      element.disabled = !available;
    }
  });

  if (saveSchedulerSettingsBtn) {
    saveSchedulerSettingsBtn.disabled = !available;
  }
}

function renderSchedulerSettings(settings, runtime, persistence) {
  if (!settings) {
    return;
  }

  renderSchedulerPersistence(persistence);

  if (ingestIntervalMinutesInput) {
    ingestIntervalMinutesInput.value = String(normalizeSchedulerInterval(settings.ingest?.intervalMinutes, 0));
  }

  if (ingestRunOnStartupInput) {
    ingestRunOnStartupInput.checked = Boolean(settings.ingest?.runOnStartup);
  }

  if (livePlacementIntervalMinutesInput) {
    livePlacementIntervalMinutesInput.value = String(normalizeSchedulerInterval(settings.livePlacement?.intervalMinutes, 0));
  }

  if (livePlacementRunOnStartupInput) {
    livePlacementRunOnStartupInput.checked = Boolean(settings.livePlacement?.runOnStartup);
  }

  if (aiModelCatalogIntervalHoursInput) {
    aiModelCatalogIntervalHoursInput.value = String(Math.max(0, Math.round(Number(settings.aiModelCatalog?.intervalMinutes || 1440) / 60)));
  }

  const runtimeIngest = runtime?.ingest?.intervalMinutes;
  const runtimeLive = runtime?.livePlacement?.intervalMinutes;
  const runtimeAiModelCatalog = runtime?.aiModelCatalog?.intervalMinutes;
  if (schedulerPersistence.available === false) {
    setScheduleSettingsStatus(`${schedulerPersistence.message} Runtime intervals: ingest ${runtimeIngest ?? 0} min, live placement ${runtimeLive ?? 0} min, AI model catalog ${Math.max(0, Math.round(Number(runtimeAiModelCatalog ?? 1440) / 60))} hr.`);
    return;
  }

  if (runtimeIngest == null || runtimeLive == null || runtimeAiModelCatalog == null) {
    setScheduleSettingsStatus('Loaded schedule settings from SQL.');
    return;
  }

  setScheduleSettingsStatus(`Loaded schedule settings. Runtime intervals: ingest ${runtimeIngest} min, live placement ${runtimeLive} min, AI model catalog ${Math.max(0, Math.round(Number(runtimeAiModelCatalog) / 60))} hr.`);
}

async function fetchSchedulerSettings() {
  const response = await fetch('/api/admin/ingest/schedule');
  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Failed to load scheduler settings.');
  }

  return payload;
}

async function reloadSchedulerSettings() {
  if (!reloadSchedulerSettingsBtn) {
    return;
  }

  setButtonBusy(reloadSchedulerSettingsBtn, true, 'Loading...');
  setScheduleSettingsStatus('Loading scheduler settings...');

  try {
    const payload = await fetchSchedulerSettings();
    renderSchedulerSettings(payload.settings, payload.runtime, payload.persistence);
  } catch (error) {
    setScheduleSettingsStatus(error.message || 'Failed to load scheduler settings.');
  } finally {
    setButtonBusy(reloadSchedulerSettingsBtn, false);
  }
}

async function saveSchedulerSettings() {
  if (!saveSchedulerSettingsBtn) {
    return;
  }

  if (schedulerPersistence.available === false) {
    setScheduleSettingsStatus(schedulerPersistence.message || 'Scheduler settings are read-only in this environment.');
    return;
  }

  const settings = {
    ingest: {
      intervalMinutes: normalizeSchedulerInterval(ingestIntervalMinutesInput?.value, 0),
      runOnStartup: Boolean(ingestRunOnStartupInput?.checked)
    },
    livePlacement: {
      intervalMinutes: normalizeSchedulerInterval(livePlacementIntervalMinutesInput?.value, 0),
      runOnStartup: Boolean(livePlacementRunOnStartupInput?.checked)
    },
    aiModelCatalog: {
      intervalMinutes: normalizeSchedulerInterval((Number(aiModelCatalogIntervalHoursInput?.value || 0) || 0) * 60, 1440)
    }
  };

  setButtonBusy(saveSchedulerSettingsBtn, true, 'Saving...');
  setScheduleSettingsStatus('Saving schedule settings to SQL and applying runtime schedule...');

  try {
    const response = await fetch('/api/admin/ingest/schedule', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(settings)
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Failed to save scheduler settings.');
    }

    renderSchedulerSettings(payload.settings, payload.runtime, payload.persistence);
    setAdminStatus('Scheduler settings saved and applied.', 'success');
  } catch (error) {
    setScheduleSettingsStatus(error.message || 'Failed to save scheduler settings.');
    setAdminStatus(error.message || 'Failed to save scheduler settings.', 'error');
  } finally {
    setButtonBusy(saveSchedulerSettingsBtn, false);
  }
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

function formatCompactTimestamp(value) {
  if (!value) {
    return '--';
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return '--';
  }

  return timestamp.toLocaleString([], {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatRelativeAgeFromTimestamp(value) {
  if (!value) {
    return 'unknown age';
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return 'unknown age';
  }

  const diffMs = Date.now() - timestamp.getTime();
  if (diffMs < 0) {
    return 'just now';
  }

  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (diffMs < minuteMs) {
    return 'just now';
  }
  if (diffMs < hourMs) {
    const minutes = Math.floor(diffMs / minuteMs);
    return `${minutes} min ago`;
  }
  if (diffMs < dayMs) {
    const hours = Math.floor(diffMs / hourMs);
    return `${hours} hr ago`;
  }

  const days = Math.floor(diffMs / dayMs);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatDateOnly(value) {
  if (!value) {
    return 'n/a';
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return 'n/a';
  }

  return timestamp.toLocaleDateString();
}

function getCompactLiveStatus(row) {
  if (row.livePlacementAvailable == null) {
    if (row.livePlacementScore === 'N/A') {
      return { short: 'NS', full: 'No live score returned', className: 'status-pill--muted' };
    }

    return { short: '--', full: 'Not checked yet', className: 'status-pill--muted' };
  }

  if (row.livePlacementAvailable) {
    return { short: 'AVL', full: 'Available', className: 'status-pill--ok' };
  }

  if (row.livePlacementRestricted) {
    return { short: 'RST', full: 'Restricted', className: 'status-pill--warn' };
  }

  return { short: 'UNA', full: 'Unavailable', className: 'status-pill--off' };
}

function getCompactLiveScore(value) {
  const rawValue = String(value || 'N/A').trim();
  const normalized = rawValue.toLowerCase();

  // Detect error conditions first
  if (normalized.includes('error') || normalized.includes('failed') || normalized.includes('exception') || normalized.includes('unauthorized') || normalized.includes('denied')) {
    return { 
      short: '⚠ Err', 
      full: rawValue, 
      className: 'ERROR',
      isError: true,
      errorMessage: rawValue
    };
  }

  if (normalized === 'high') {
    return { short: 'High', full: rawValue, className: 'HIGH' };
  }

  if (normalized === 'medium') {
    return { short: 'Med', full: rawValue, className: 'MEDIUM' };
  }

  if (normalized === 'low') {
    return { short: 'Low', full: rawValue, className: 'LOW' };
  }

  if (normalized === 'n/a') {
    return { short: 'N/A', full: rawValue, className: 'N/A' };
  }

  if (normalized.includes('restricted')) {
    return { short: 'Rstr', full: rawValue, className: 'BLOCKED' };
  }

  if (normalized.includes('unavailable') || normalized.includes('notavailable')) {
    return { short: 'Unav', full: rawValue, className: 'BLOCKED' };
  }

  return { short: rawValue.slice(0, 4), full: rawValue, className: 'N/A' };
}

function setCapacityScoreStatus(message, fullDetail) {
  if (!capacityScoreLiveStatus) {
    return;
  }

  capacityScoreLiveStatus.textContent = message;
  capacityScoreLiveStatus.title = fullDetail || message;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

    // Silently fail — don't disrupt user experience if error logging fails
    if (!response.ok) {
      console.warn('Failed to log error to database:', response.status);
    }
  } catch (logErr) {
    console.warn('Error logging exception:', logErr.message);
  }
}

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  if (!sidebarToggle) {
    return;
  }

  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggle.title = collapsed ? 'Expand navigation' : 'Collapse navigation';
  const label = sidebarToggle.querySelector('.nav-label');
  if (label) {
    label.textContent = collapsed ? 'Expand' : 'Collapse';
  }
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
  if (!(auth?.authEnabled && auth?.isAuthenticated && auth?.name)) {
    el.innerHTML = '';
    return;
  }

  const username = String(auth?.username || '').trim();
  if (auth?.authEnabled && auth?.isAuthenticated && auth?.name) {
    el.innerHTML = `
      <span class="topbar-user-meta">
        <span class="topbar-username">${auth.name}</span>
        ${username ? `<span class="topbar-userid">${username}</span>` : ''}
      </span>
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
      redirectToLoginOnce();
      return false; // navigating away — callers should not proceed
    }
    updateTopbarUser(auth);
    applyAdminAccess(auth);
    document.body.classList.remove('auth-pending');
    return true;
  } catch {
    applyAdminAccess({ canAccessAdmin: true });
    document.body.classList.remove('auth-pending');
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

function summarizeIngestionStatus(status, activeJob = null) {
  if (!status) {
    return 'Ingestion status unavailable.';
  }

  if (activeJob && activeJob.status === 'queued') {
    return `Capacity ingestion is queued${activeJob.jobId ? ` (${activeJob.jobId.slice(0, 8)})` : ''}.`;
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
  if (operationHistoryPollHandle) {
    clearInterval(operationHistoryPollHandle);
    operationHistoryPollHandle = null;
  }
}

async function fetchAdminIngestStatus() {
  const response = await fetch('/api/admin/ingest/status');
  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Failed to retrieve ingestion status.');
  }

  return payload;
}

async function syncIngestStatus() {
  const payload = await fetchAdminIngestStatus();
  const status = payload.status;
  const activeJob = payload.activeJob || null;
  renderIngestionStatusCard(status);

  if (activeJob && activeJob.jobId) {
    currentIngestJobId = activeJob.jobId;
  }

  if ((activeJob && (activeJob.status === 'queued' || activeJob.status === 'running')) || status.inProgress) {
    setButtonBusy(triggerIngestBtn, true, 'Ingest Running...');
    setAdminStatus(summarizeIngestionStatus(status, activeJob), activeJob?.status === 'queued' ? 'warn' : 'info');
    return status;
  }

  stopIngestStatusPolling();
  setButtonBusy(triggerIngestBtn, false);

  const completedTrackedJob = Boolean(currentIngestJobId);
  currentIngestJobId = null;

  if (status.lastError) {
    setAdminStatus(summarizeIngestionStatus(status, activeJob), 'error');
    return status;
  }

  setAdminStatus(summarizeIngestionStatus(status, activeJob), 'success');
  if (completedTrackedJob) {
    await Promise.all([loadSubscriptions(), loadCapacityRows()]).catch(() => {});
  }
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

  // Also refresh operation history every 10 seconds while ingest is running
  operationHistoryPollHandle = setInterval(() => {
    syncOperationHistory().catch(() => {});
  }, 10000);
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

    currentIngestJobId = payload.jobId || currentIngestJobId;
    setButtonBusy(triggerIngestBtn, true, 'Ingest Running...');
    setAdminStatus(payload.status === 'queued' ? 'Capacity ingestion queued. Monitoring progress...' : 'Capacity ingestion started. Monitoring progress...', 'info');
    startIngestStatusPolling();
    await syncIngestStatus().catch(() => {});
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

async function fetchOperationHistory(options = {}) {
  try {
    const params = new URLSearchParams({
      limit: options.limit || 25,
      type: options.type || '',
      failed: options.failed ? 'true' : 'false'
    });

    const response = await fetch(`/api/admin/operations?${params.toString()}`);
    const payload = await response.ok ? await response.json() : { ok: false, rows: [] };
    return Array.isArray(payload.rows) ? payload.rows : [];
  } catch (err) {
    console.warn('Failed to fetch operation history:', err.message);
    return [];
  }
}

function renderOperationHistory(operations) {
  if (!operationHistoryBody) {
    return;
  }

  operationHistoryBody.innerHTML = '';
  if (!operations || operations.length === 0) {
    operationHistoryBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: #5d7085;">No recent operations. Ingest and refresh operations will appear here.</td></tr>';
    return;
  }

  operations.forEach((op) => {
    const timeText = op.startedAtUtc
      ? new Date(op.startedAtUtc).toLocaleString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit', month: 'short', day: 'numeric', year: '2-digit' })
      : 'unknown';
    const statusClass = op.status === 'success' ? 'success' : op.status === 'failed' ? 'failed' : 'running';
    const durationText = op.durationMs ? `${op.durationMs}ms` : '—';
    const rowsText = op.rowsAffected != null ? String(op.rowsAffected) : '—';
    const noteText = op.note || op.errorMessage || '—';
    const noteEscaped = String(noteText).slice(0, 200);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-time" title="${op.startedAtUtc || 'unknown'}">${timeText}</td>
      <td class="col-operation">${escapeHtml(op.name || op.type || 'Unknown')}</td>
      <td class="col-status"><span class="operation-status-badge ${statusClass}">${escapeHtml(op.status || 'unknown')}</span></td>
      <td class="col-duration">${durationText}</td>
      <td class="col-rows">${rowsText}</td>
      <td class="col-note" title="${escapeHtml(noteText)}">${escapeHtml(noteEscaped)}${noteText.length > 200 ? '...' : ''}</td>
    `;
    operationHistoryBody.appendChild(tr);
  });
}

async function syncOperationHistory() {
  if (!operationHistoryContainer) {
    return;
  }

  const operations = await fetchOperationHistory({ limit: 20 });
  renderOperationHistory(operations);
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

function normalizeFamilyOptionLabel(family) {
  const raw = String(family || '').trim();
  if (!raw) {
    return '';
  }

  // Normalize common SKU-family prefixes first, then apply family label formatting.
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
    if (!rawValue) {
      return;
    }

    const key = canonicalFamilyOptionKey(rawValue);
    if (!key || byCanonicalValue.has(key)) {
      return;
    }

    byCanonicalValue.set(key, {
      value: rawValue,
      label: normalizeFamilyOptionLabel(rawValue)
    });
  });

  return [...byCanonicalValue.values()].sort((left, right) => compareSkuValues(left.label, right.label));
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
  const dataFamilies = capacityFacetFamilies.length > 0 ? capacityFacetFamilies : unique('family');

  const selectedType = resourceTypeFilter?.value || 'all';
  const filteredFamilies = selectedType === 'all'
    ? dataFamilies
    : dataFamilies.filter((f) => getFamilyResourceType(f) === selectedType);

  familyFilter.innerHTML = '';
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = 'All';
  familyFilter.appendChild(all);

  buildFamilyOptions(filteredFamilies).forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    familyFilter.appendChild(option);
  });

  // Re-apply any existing search text after rebuilding options
  applyFamilySearch();

  const availableValues = [...familyFilter.options].map((option) => option.value);
  familyFilter.value = availableValues.includes(currentValue) ? currentValue : 'all';
}

function syncAIQuotaProviderOptions(dataRows = []) {
  if (!aiQuotaProviderFilter) {
    return;
  }

  const selectedType = resourceTypeFilter?.value || 'all';
  const previousValue = aiQuotaProviderFilter.value || 'all';
  const providers = [...new Set((Array.isArray(dataRows) ? dataRows : [])
    .filter((row) => getRowResourceType(row) === 'AI')
    .map((row) => getAIQuotaProviderLabel(row))
    .filter((provider) => provider && provider !== 'Unknown'))]
    .sort((left, right) => left.localeCompare(right));

  aiQuotaProviderFilter.innerHTML = '<option value="all">All verified providers</option>';
  providers.forEach((provider) => {
    const option = document.createElement('option');
    option.value = provider;
    option.textContent = provider;
    aiQuotaProviderFilter.appendChild(option);
  });

  aiQuotaProviderFilter.value = providers.includes(previousValue) ? previousValue : 'all';

  if (aiQuotaProviderFilterLabel) {
    aiQuotaProviderFilterLabel.style.display = selectedType === 'AI' && providers.length > 0 ? '' : 'none';
  }
}

function setAIModelsStatus(message, tone = 'info') {
  if (!aiModelsStatus) {
    return;
  }
  aiModelsStatus.className = `inline-note ${tone}`;
  aiModelsStatus.textContent = message;
}

function syncAIDeploymentTypeOptions(dataRows) {
  if (!aiDeploymentTypeFilter) {
    return;
  }

  const previousValue = aiDeploymentTypeFilter.value || 'all';
  const deploymentTypes = [...new Set((Array.isArray(dataRows) ? dataRows : [])
    .flatMap((row) => String(row.deploymentTypes || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)))]
    .sort((left, right) => left.localeCompare(right));

  aiDeploymentTypeFilter.innerHTML = '<option value="all">All deployment types</option>';
  deploymentTypes.forEach((deploymentType) => {
    const option = document.createElement('option');
    option.value = deploymentType;
    option.textContent = deploymentType;
    aiDeploymentTypeFilter.appendChild(option);
  });
  aiDeploymentTypeFilter.value = deploymentTypes.includes(previousValue) ? previousValue : 'all';
}

function syncAIProviderOptions(dataRows) {
  if (!aiProviderFilter) {
    return;
  }

  const previousValue = aiProviderFilter.value || 'all';
  const providers = [...new Set((Array.isArray(dataRows) ? dataRows : [])
    .map((row) => getAIModelProviderLabel(row))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));

  aiProviderFilter.innerHTML = '<option value="all">All providers</option>';
  providers.forEach((provider) => {
    const option = document.createElement('option');
    option.value = provider;
    option.textContent = provider;
    aiProviderFilter.appendChild(option);
  });
  aiProviderFilter.value = providers.includes(previousValue) ? previousValue : 'all';
}

function getFilteredAIModelRows() {
  const regionScope = activePresetRegions();
  const selectedRegion = String(regionFilter?.value || 'all').trim().toLowerCase();
  const searchTerm = String(aiModelNameFilter?.value || '').trim().toLowerCase();
  const provider = String(aiProviderFilter?.value || 'all').trim();
  const deploymentType = String(aiDeploymentTypeFilter?.value || 'all').trim().toLowerCase();
  const fineTune = String(aiFineTuneFilter?.value || 'all').trim().toLowerCase();
  const defaultOnly = Boolean(aiDefaultOnlyInput?.checked);

  return (Array.isArray(aiModelRows) ? aiModelRows : []).filter((row) => {
    const rowRegion = String(row.region || '').trim().toLowerCase();
    const byPreset = !Array.isArray(regionScope) || regionScope.length === 0 || regionScope.includes(rowRegion);
    const byRegion = selectedRegion === 'all' || rowRegion === selectedRegion;
    const providerLabel = getAIModelProviderLabel(row);
    const searchableText = `${providerLabel} ${row.modelName || ''} ${row.modelVersion || ''} ${row.skuName || ''}`.toLowerCase();
    const bySearch = !searchTerm || searchableText.includes(searchTerm);
    const byProvider = provider === 'all' || providerLabel === provider;
    const deploymentValues = String(row.deploymentTypes || '').toLowerCase().split(',').map((value) => value.trim()).filter(Boolean);
    const byDeployment = deploymentType === 'all' || deploymentValues.includes(deploymentType);
    const byFineTune = fineTune === 'all'
      || (fineTune === 'yes' && Boolean(row.finetuneCapable))
      || (fineTune === 'no' && !row.finetuneCapable);
    const byDefault = !defaultOnly || Boolean(row.isDefault);
    return byPreset && byRegion && bySearch && byProvider && byDeployment && byFineTune && byDefault;
  });
}

function renderAIModelSummary(dataRows) {
  const rowsToRender = Array.isArray(dataRows) ? dataRows : [];
  const uniqueModels = new Set(rowsToRender.map((row) => String(row.modelName || '').trim()).filter(Boolean));
  const uniqueRegions = new Set(rowsToRender.map((row) => String(row.region || '').trim()).filter(Boolean));
  const uniqueProviders = new Set(rowsToRender.map((row) => getAIModelProviderLabel(row)));
  const defaultRows = rowsToRender.filter((row) => Boolean(row.isDefault)).length;
  const fineTuneRows = rowsToRender.filter((row) => Boolean(row.finetuneCapable)).length;

  summaryCards.innerHTML = `
    <div class="card"><h3>Catalog Rows</h3><p>${rowsToRender.length.toLocaleString()}</p></div>
    <div class="card"><h3>Models in Scope</h3><p>${uniqueModels.size.toLocaleString()}</p></div>
    <div class="card"><h3>Regions in Scope</h3><p>${uniqueRegions.size.toLocaleString()}</p></div>
    <div class="card"><h3>Providers in Scope</h3><p>${uniqueProviders.size.toLocaleString()}</p></div>
    <div class="card"><h3>Default / Fine-Tune</h3><p>${defaultRows.toLocaleString()} / ${fineTuneRows.toLocaleString()}</p></div>
  `;
}

function renderAIModelAvailability() {
  if (!aiModelsGridBody) {
    return;
  }

  const filtered = getFilteredAIModelRows();
  aiModelsGridBody.innerHTML = '';

  if (filtered.length === 0) {
    aiModelsGridBody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px; color: #5d7085;">No AI model availability rows match the current provider and filter scope.</td></tr>';
    renderAIModelSummary([]);
    return;
  }

  filtered.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(getAIModelProviderLabel(row))}</td>
      <td>${escapeHtml(row.modelName || 'n/a')}</td>
      <td>${escapeHtml(row.modelVersion || 'n/a')}</td>
      <td>${escapeHtml(row.region || 'n/a')}</td>
      <td>${escapeHtml(row.deploymentTypes || 'n/a')}</td>
      <td><span class="badge ${row.finetuneCapable ? 'OK' : 'N/A'}">${row.finetuneCapable ? 'Yes' : 'No'}</span></td>
      <td><span class="badge ${row.isDefault ? 'OK' : 'N/A'}">${row.isDefault ? 'Default' : 'Optional'}</span></td>
      <td>${escapeHtml(row.modelFormat || 'n/a')}</td>
      <td>${escapeHtml(row.skuName || 'n/a')}</td>
      <td>${escapeHtml(formatDateOnly(row.deprecationDate))}</td>
      <td>${escapeHtml(formatCompactTimestamp(row.capturedAtUtc))}</td>
    `;
    aiModelsGridBody.appendChild(tr);
  });

  renderAIModelSummary(filtered);
}

function utilization(row) {
  if (!row.quotaLimit) return 0;
  return Math.round((row.quotaCurrent / row.quotaLimit) * 100);
}

function filteredRows() {
  const selectedType = resourceTypeFilter?.value || 'all';
  const selectedProvider = aiQuotaProviderFilter?.value || 'all';
  return presetScopedRows(rows).filter((r) => {
    const byRegion = regionFilter.value === 'all' || r.region === regionFilter.value;
    const byFamily = familyFilter.value === 'all' || r.family === familyFilter.value;
    const byAvailability = availabilityFilter.value === 'all' || r.availability === availabilityFilter.value;
    const byType = rowMatchesSelectedResourceType(r, selectedType);
    const byProvider = rowMatchesSelectedAIQuotaProvider(r, selectedProvider);
    return byRegion && byFamily && byAvailability && byType && byProvider;
  });
}

function reportScopedRows() {
  const selectedProvider = aiQuotaProviderFilter?.value || 'all';
  return presetScopedRows(rows).filter((r) => {
    const byRegion = regionFilter.value === 'all' || r.region === regionFilter.value;
    const byAvailability = availabilityFilter.value === 'all' || r.availability === availabilityFilter.value;
    const byProvider = rowMatchesSelectedAIQuotaProvider(r, selectedProvider);
    return byRegion && byAvailability && byProvider;
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
  const presetRegions = activePresetRegions();
  const availableRegions = Array.isArray(presetRegions) && presetRegions.length > 0
    ? [...presetRegions].sort()
    : (capacityFacetRegions.length > 0 ? capacityFacetRegions : unique('region'));
  const shouldReuseAvailableRegions = (!Array.isArray(presetRegions) || presetRegions.length === 0)
    && preserveRegionOptions
    && regionFilter.value !== 'all'
    && preservedRegionOptions.length > 0;

  if ((!Array.isArray(presetRegions) || presetRegions.length === 0) && availableRegions.length > 0 && !shouldReuseAvailableRegions) {
    preservedRegionOptions = [...availableRegions];
  }

  const optionValues = shouldReuseAvailableRegions ? preservedRegionOptions : availableRegions;
  const nextValue = optionValues.includes(regionFilter.value) ? regionFilter.value : 'all';
  fillSelect(regionFilter, optionValues);
  regionFilter.value = nextValue;
  regionFilter.disabled = optionValues.length === 0;
  preserveRegionOptions = false;
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

function resetCapacityScorePaging() {
  capacityScorePaging.pageNumber = 1;
}

function renderCapacityScorePaging() {
  const total = Number(capacityScorePaging.total || 0);
  const pageSize = Number(capacityScorePaging.pageSize || 50);
  const pageNumber = Number(capacityScorePaging.pageNumber || 1);
  const pageCount = Math.max(1, Number(capacityScorePaging.pageCount || 1));
  const start = total === 0 ? 0 : ((pageNumber - 1) * pageSize) + 1;
  const end = total === 0 ? 0 : Math.min(pageNumber * pageSize, total);

  if (capacityScorePageInfo) {
    capacityScorePageInfo.textContent = `Showing ${start}-${end} of ${total}`;
  }
  if (capacityScorePageLabel) {
    capacityScorePageLabel.textContent = `Page ${pageNumber} of ${pageCount}`;
  }
  if (capacityScorePrevPage) {
    capacityScorePrevPage.disabled = !capacityScorePaging.hasPrev;
  }
  if (capacityScoreNextPage) {
    capacityScoreNextPage.disabled = !capacityScorePaging.hasNext;
  }
  if (capacityScorePageSize) {
    capacityScorePageSize.value = String(pageSize);
  }
}

function renderSummary(data, summaryOverride = null) {
  const total = Number(capacityPaging.total || data.length || 0);
  const rowsShown = Number(data.length || 0);
  const rowsLabel = total > rowsShown 
    ? `${rowsShown.toLocaleString()} of ${total.toLocaleString()}` 
    : `${total.toLocaleString()}`;
  const constrained = summaryOverride && Number.isFinite(Number(summaryOverride.constrainedRows))
    ? Number(summaryOverride.constrainedRows)
    : data.filter((r) => isBlockedAvailability(r.availability)).length;
  const totalAvailQuota = summaryOverride && Number.isFinite(Number(summaryOverride.availableQuota))
    ? Number(summaryOverride.availableQuota)
    : data.reduce((acc, r) => acc + (r.quotaLimit - r.quotaCurrent), 0);
  const latestCapturedAtMs = data
    .map((row) => new Date(row?.capturedAtUtc || '').getTime())
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);
  const latestCapturedAt = summaryOverride?.lastDataUpdatedUtc
    || (latestCapturedAtMs > 0 ? new Date(latestCapturedAtMs).toISOString() : null);
  const lastUpdatedDisplay = latestCapturedAt
    ? `${formatCompactTimestamp(latestCapturedAt)} (${formatRelativeAgeFromTimestamp(latestCapturedAt)})`
    : 'No timestamp available';

  summaryCards.innerHTML = `
    <div class="card"><h3>SKU Observations</h3><p>${rowsLabel}</p></div>
    <div class="card"><h3>Constrained Observations</h3><p>${constrained.toLocaleString()}</p></div>
    <div class="card"><h3>Available Quota</h3><p>${totalAvailQuota.toLocaleString()}</p></div>
    <div class="card"><h3>Last Data Update</h3><p>${lastUpdatedDisplay}</p></div>
  `;
}

function getActiveReportViewKey() {
  const active = document.querySelector('.nav-sub-item.active[data-report-view]');
  return active?.dataset?.reportView || 'capacity-grid';
}

function renderRegionMatrixSummary(data) {
  const scopedData = (Array.isArray(data) ? data : []).filter((row) => isVmComputeFamily(row.family));
  const regions = resolveMatrixRegions(scopedData);
  const familyMap = {};
  const priority = { OK: 4, LIMITED: 3, CONSTRAINED: 2, RESTRICTED: 1 };

  scopedData.forEach((row) => {
    const fam = normalizeFamilyLabel(row.family, row.sku) || deriveFamilyFromSkuName(row.sku) || '?';
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

  const families = Object.keys(familyMap).sort();
  let familiesWithAnyOk = 0;
  let familiesFullyBlocked = 0;

  families.forEach((family) => {
    const statuses = Object.values(familyMap[family] || {});
    if (statuses.includes('OK')) {
      familiesWithAnyOk += 1;
      return;
    }

    if (!statuses.includes('LIMITED') && !statuses.some((status) => isBlockedAvailability(status))) {
      familiesFullyBlocked += 1;
    }
  });

  summaryCards.innerHTML = `
    <div class="card"><h3>Families Shown</h3><p>${families.length.toLocaleString()}</p></div>
    <div class="card"><h3>Families with Any OK</h3><p>${familiesWithAnyOk.toLocaleString()}</p></div>
    <div class="card"><h3>Fully Blocked Families</h3><p>${familiesFullyBlocked.toLocaleString()}</p></div>
    <div class="card"><h3>Regions in Scope</h3><p>${regions.length.toLocaleString()}</p></div>
  `;
}

function renderSummaryForActiveView(gridData, matrixData) {
  const view = getActiveReportViewKey();
  if (view === 'region-matrix') {
    renderRegionMatrixSummary(matrixData);
    return;
  }
  if (view === 'ai-model-availability') {
    renderAIModelSummary(getFilteredAIModelRows());
    return;
  }

  renderSummary(gridData, view === 'capacity-grid' ? capacityGridSummary : null);
}

function renderGrid() {
  const data = filteredRows();
  const matrixData = reportScopedRows();
  gridBody.innerHTML = '';
  if (data.length === 0) {
    gridBody.innerHTML = '<tr><td colspan="13" style="text-align: center; padding: 20px; color: #5d7085;">No data available. Ensure ingestion is running and subscriptions are in scope.</td></tr>';
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
      <td>${escapeHtml(getAIQuotaProviderDisplay(r))}</td>
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

  const scopedCandidates = getScopedQuotaCandidates(candidates);
  quotaCandidatesGridBody.innerHTML = '';
  if (!candidates || candidates.length === 0) {
    quotaCandidatesGridBody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px; color: #5d7085;">No quota candidates generated for the selected scope.</td></tr>';
    return;
  }

  if (scopedCandidates.length === 0) {
    quotaCandidatesGridBody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px; color: #5d7085;">No quota candidates match the selected top filters.</td></tr>';
    return;
  }

  scopedCandidates.forEach((candidate) => {
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

function getScopedQuotaCandidates(candidates) {
  const rowsToFilter = Array.isArray(candidates) ? candidates : [];
  const selectedSubscriptionId = quotaCandidateSubscriptionFilter?.value || 'all';
  const selectedRegion = quotaCandidateRegionFilter?.value || 'all';
  const skuFamilyTerm = String(quotaCandidateSkuFilter?.value || '').trim().toLowerCase();

  return rowsToFilter.filter((candidate) => {
    const bySubscription = selectedSubscriptionId === 'all' || String(candidate.subscriptionId || '') === selectedSubscriptionId;
    const byRegion = selectedRegion === 'all' || String(candidate.region || '').toLowerCase() === selectedRegion.toLowerCase();
    const familyText = String(candidate.family || '').toLowerCase();
    const quotaNameText = String(candidate.quotaName || '').toLowerCase();
    const bySkuFamily = !skuFamilyTerm
      || familyText.includes(skuFamilyTerm)
      || quotaNameText.includes(skuFamilyTerm);

    return bySubscription && byRegion && bySkuFamily;
  });
}

function renderQuotaCandidateFilterOptions(candidates) {
  if (!quotaCandidateSubscriptionFilter || !quotaCandidateRegionFilter) {
    return;
  }

  const rowsToUse = Array.isArray(candidates) ? candidates : [];
  const previousSubscription = quotaCandidateSubscriptionFilter.value || 'all';
  const previousRegion = quotaCandidateRegionFilter.value || 'all';

  const subscriptionMap = new Map();
  rowsToUse.forEach((candidate) => {
    const subscriptionId = String(candidate.subscriptionId || '').trim();
    if (!subscriptionId || subscriptionMap.has(subscriptionId)) {
      return;
    }
    subscriptionMap.set(subscriptionId, String(candidate.subscriptionName || '').trim());
  });

  const subscriptionIds = [...subscriptionMap.keys()].sort((a, b) => a.localeCompare(b));
  fillSelect(quotaCandidateSubscriptionFilter, subscriptionIds, 'All Subscriptions');
  [...quotaCandidateSubscriptionFilter.options].forEach((option) => {
    if (option.value === 'all') {
      return;
    }
    const subscriptionName = subscriptionMap.get(option.value);
    if (subscriptionName) {
      option.textContent = `${subscriptionName} (${option.value})`;
    }
  });

  const regions = [...new Set(rowsToUse.map((candidate) => String(candidate.region || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  fillSelect(quotaCandidateRegionFilter, regions, 'All Regions');

  quotaCandidateSubscriptionFilter.value = subscriptionIds.includes(previousSubscription) ? previousSubscription : 'all';
  quotaCandidateRegionFilter.value = regions.includes(previousRegion) ? previousRegion : 'all';
  quotaCandidateSubscriptionFilter.disabled = subscriptionIds.length === 0;
  quotaCandidateRegionFilter.disabled = regions.length === 0;
}

function resetQuotaCandidateFilters(resetSku = true) {
  if (quotaCandidateSubscriptionFilter) {
    quotaCandidateSubscriptionFilter.value = 'all';
  }
  if (quotaCandidateRegionFilter) {
    quotaCandidateRegionFilter.value = 'all';
  }
  if (resetSku && quotaCandidateSkuFilter) {
    quotaCandidateSkuFilter.value = '';
  }
}

function getQuotaCandidateScopeFilters() {
  const selectedSubscriptionId = quotaCandidateSubscriptionFilter?.value || 'all';
  return {
    region: quotaCandidateRegionFilter?.value || 'all',
    family: String(quotaCandidateSkuFilter?.value || '').trim() || 'all',
    subscriptionIds: selectedSubscriptionId === 'all' ? '' : selectedSubscriptionId
  };
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
    quotaCandidateRows = [];
    renderQuotaCandidateFilterOptions([]);
    resetQuotaCandidateFilters();
    renderQuotaGroups(groups);
    renderQuotaCandidates([]);
    setQuotaDiscoveryStatus(`Quota discovery completed. ${groups.length} group quota(s) found for management group ${payload.managementGroupId}.`, 'success');
  } catch (error) {
    quotaGroupOptions = [];
    quotaCandidateRows = [];
    renderQuotaCandidateFilterOptions([]);
    resetQuotaCandidateFilters();
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
    const candidateFilters = getQuotaCandidateScopeFilters();
    const query = new URLSearchParams({
      managementGroupId,
      groupQuotaName,
      regionPreset: regionPresetFilter.value || 'all',
      region: candidateFilters.region,
      family: candidateFilters.family,
      subscriptionIds: candidateFilters.subscriptionIds
    });
    const response = await fetch(`/api/quota/candidates?${query.toString()}`);
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Failed to generate quota candidates.');
    }

    quotaCandidateRows = Array.isArray(payload.candidates) ? payload.candidates : [];
    renderQuotaCandidateFilterOptions(quotaCandidateRows);
    renderQuotaCandidates(quotaCandidateRows);
    const visibleCount = getScopedQuotaCandidates(quotaCandidateRows).length;
    setQuotaDiscoveryStatus(`Candidate generation completed. ${payload.candidateCount} movable candidate row(s) found across ${payload.subscriptionCount} subscription(s). ${visibleCount} row(s) match the current top filters.`, 'success');
  } catch (error) {
    quotaCandidateRows = [];
    renderQuotaCandidateFilterOptions([]);
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
    const candidateFilters = getQuotaCandidateScopeFilters();
    const query = new URLSearchParams({
      managementGroupId,
      groupQuotaName,
      region: candidateFilters.region,
      family: candidateFilters.family,
      subscriptionIds: candidateFilters.subscriptionIds
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
    const candidateFilters = getQuotaCandidateScopeFilters();
    const response = await fetch('/api/quota/candidates/capture', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        managementGroupId,
        groupQuotaName,
        regionPreset: regionPresetFilter.value || 'all',
        region: candidateFilters.region,
        family: candidateFilters.family,
        subscriptionIds: candidateFilters.subscriptionIds
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Failed to capture quota candidate history.');
    }

    quotaCandidateRows = Array.isArray(payload.candidates) ? payload.candidates : [];
    renderQuotaCandidateFilterOptions(quotaCandidateRows);
    renderQuotaCandidates(quotaCandidateRows);
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
    const candidateFilters = getQuotaCandidateScopeFilters();
    const query = new URLSearchParams({
      managementGroupId,
      groupQuotaName,
      analysisRunId,
      region: candidateFilters.region,
      family: candidateFilters.family,
      subscriptionIds: candidateFilters.subscriptionIds
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
      <td>${Number(row.totalRows || 0).toLocaleString()}</td>
      <td>${Number(row.constrainedRows || 0).toLocaleString()}</td>
      <td>${Number(row.totalQuotaAvailable || 0).toLocaleString()}</td>
    `;
    trendGridBody.appendChild(tr);
  });

  renderTrendLineChart(trendQuotaChart, trendRows, {
    title: 'Total Quota Available',
    series: [
      {
        key: 'totalQuotaAvailable',
        label: 'Quota Available',
        color: '#0063b1'
      }
    ]
  });

  renderTrendLineChart(trendObservationChart, trendRows, {
    title: 'Observation Counts',
    series: [
      {
        key: 'totalRows',
        label: 'Total SKU Observations',
        color: '#19793a'
      },
      {
        key: 'constrainedRows',
        label: 'Constrained Observations',
        color: '#c75a00'
      }
    ]
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
    const okTone = okSkuCount === 0 ? 'CONSTRAINED' : (okSkuCount === skuCount ? 'OK' : 'LIMITED');
    tr.innerHTML = `
      <td><span class="family-series-pill">${formatFamilyLabel(row.family)}</span></td>
      <td><span class="family-summary-count">${skuCount} SKU${skuCount === 1 ? '' : 's'}</span></td>
      <td><span class="badge ${okTone}">${okSkuCount} OK</span></td>
      <td>${row.largest}</td>
      <td>${row.zones}</td>
      <td><span class="badge ${row.status}">${row.status}</span></td>
      <td>${row.quota}</td>
    `;
    familySummaryGridBody.appendChild(tr);
  });
}

function deriveFamilySummaryFromRows(dataRows) {
  const byFamily = new Map();

  (dataRows || []).forEach((row) => {
    const familyRaw = String(row.family || '').trim();
    const canonicalFamily = normalizeFamilyLabel(familyRaw, row.sku);
    const isVmComputeFamily = /^(STANDARD|BASIC)[A-Z0-9]+FAMILY$/i.test(familyRaw);
    if (!familyRaw || !isVmComputeFamily || !canonicalFamily) {
      return;
    }

    if (!byFamily.has(canonicalFamily)) {
      byFamily.set(canonicalFamily, {
        family: canonicalFamily,
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

    const entry = byFamily.get(canonicalFamily);
    entry.skus.add(row.sku);
    if (row.availability === 'OK') {
      entry.okSkus.add(row.sku);
    }

    entry.maxVcpu = Math.max(entry.maxVcpu, Number(row.vCpu || 0));
    entry.maxMemoryGB = Math.max(entry.maxMemoryGB, Number(row.memoryGB || 0));
    entry.quotaMax = Math.max(entry.quotaMax, Number(row.quotaLimit || 0));
    entry.hasLimited = entry.hasLimited || row.availability === 'LIMITED';
    entry.hasConstrained = entry.hasConstrained || isBlockedAvailability(row.availability);

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

function normalizeFamilyLabel(rawFamily, skuName) {
  return canonicalComputeFamilyLabel(rawFamily, skuName);
}

function isBlockedAvailability(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'CONSTRAINED' || normalized === 'RESTRICTED';
}

function deriveFamilyFromSkuName(skuName) {
  const match = String(skuName || '').match(/^Standard_([A-Za-z]+)/i);
  if (!match || !match[1]) {
    return '';
  }

  return normalizeFamilyLabel('', match[1]);
}

function isVmComputeFamily(familyName) {
  return /^(STANDARD|BASIC)[A-Z0-9]+FAMILY$/i.test(String(familyName || '').trim());
}

function resolveMatrixRegions(scopedData) {
  if (regionFilter.value && regionFilter.value !== 'all') {
    return [String(regionFilter.value).trim().toLowerCase()];
  }

  const selectedRegions = activePresetRegions();
  if (Array.isArray(selectedRegions) && selectedRegions.length > 0) {
    return [...new Set(selectedRegions.map((region) => String(region || '').trim().toLowerCase()).filter(Boolean))].sort();
  }

  return [...new Set((scopedData || []).map((row) => String(row.region || '').trim().toLowerCase()).filter(Boolean))].sort();
}

function renderRegionMatrix(data) {
  const container = document.querySelector('#regionMatrixContainer');
  const empty = document.querySelector('#regionMatrixEmpty');
  if (!container) return;

  container.innerHTML = '';

  const scopedData = ((data && data.length > 0 ? data : filteredRows()) || []).filter((row) => isVmComputeFamily(row.family));
  const regions = resolveMatrixRegions(scopedData);

  if ((!scopedData || scopedData.length === 0) && regions.length === 0) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  // Status priority: OK > LIMITED > CONSTRAINED > (absent)
  const priority = { OK: 4, LIMITED: 3, CONSTRAINED: 2, RESTRICTED: 1 };

  // Build map: family -> region -> best status
  const familyMap = {};

  scopedData.forEach((r) => {
    const fam = normalizeFamilyLabel(r.family, r.sku) || deriveFamilyFromSkuName(r.sku) || '?';
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

  const families = Object.keys(familyMap).sort();

  // Row-level rollup: best status across all regions for row highlight
  function rowRollup(regionMap) {
    const statuses = Object.values(regionMap || {});
    if (statuses.includes('OK')) return 'OK';
    if (statuses.includes('LIMITED')) return 'LIMITED';
    if (statuses.includes('CONSTRAINED')) return 'CONSTRAINED';
    if (statuses.includes('RESTRICTED')) return 'RESTRICTED';
    return 'NONE';
  }

  function cellLabel(status) {
    if (status === 'OK') return '✓ OK';
    if (status === 'LIMITED') return '⚠ LTD';
    if (status === 'CONSTRAINED') return '⚠ CON';
    if (status === 'RESTRICTED') return '⛔ RST';
    return '✗';
  }

  function rowBg(rollup) {
    if (rollup === 'OK') return 'background:#f0fbf4;';
    if (rollup === 'LIMITED') return 'background:#fffbf0;';
    if (rollup === 'CONSTRAINED') return 'background:#fff5f6;';
    if (rollup === 'RESTRICTED') return 'background:#fff2f2;';
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
    const liveScore = getCompactLiveScore(row.livePlacementScore);
    const liveStatus = getCompactLiveStatus(row);
    const regionText = escapeHtml(row.region || 'n/a');
    const skuText = escapeHtml(normalizeSkuName(row.sku) || 'n/a');
    const familyText = escapeHtml(formatFamilyLabel(row.family) || 'n/a');
    const scoreText = escapeHtml(row.score || 'n/a');
    const liveScoreText = escapeHtml(liveScore.short);
    const liveScoreTitleText = escapeHtml(liveScore.full);
    const liveStatusText = escapeHtml(liveStatus.full);
    const liveStatusShortText = escapeHtml(liveStatus.short);
    const liveCheckedTitleText = escapeHtml(row.liveCheckedAtUtc ? formatTimestamp(row.liveCheckedAtUtc) : 'Not checked');
    const liveCheckedText = escapeHtml(formatCompactTimestamp(row.liveCheckedAtUtc));
    const reasonText = escapeHtml(row.reason || 'n/a');
    
    // Build the live score cell content with error display
    let liveScoreCellHtml = '';
    if (liveScore.isError) {
      // Display error as visible text instead of just in tooltip
      const errorMsg = escapeHtml(liveScore.errorMessage || 'Unknown error');
      liveScoreCellHtml = `<span class="badge ${liveScore.className}" title="${liveScoreTitleText}">${liveScoreText}</span><div class="live-score-error-text">${errorMsg.slice(0, 50)}${errorMsg.length > 50 ? '...' : ''}</div>`;
    } else {
      liveScoreCellHtml = `<span class="badge ${liveScore.className}" title="${liveScoreTitleText}">${liveScoreText}</span>`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="score-cell-region" title="${regionText}">${regionText}</td>
      <td class="score-cell-sku" title="${skuText}">${skuText}</td>
      <td class="score-cell-family" title="${familyText}">${familyText}</td>
      <td class="score-cell-score"><span class="badge ${scoreClass}">${scoreText}</span></td>
      <td class="score-cell-live-score" title="${liveScoreTitleText}">${liveScoreCellHtml}</td>
      <td class="score-cell-status" title="${liveStatusText}"><span class="status-pill ${liveStatus.className}">${liveStatusShortText}</span></td>
      <td class="score-cell-live-check" title="${liveCheckedTitleText}">${liveCheckedText}</td>
      <td class="score-cell-metric">${row.subscriptionCount ?? 0}</td>
      <td class="score-cell-metric">${row.okRows ?? 0}</td>
      <td class="score-cell-metric">${row.limitedRows ?? 0}</td>
      <td class="score-cell-metric">${row.constrainedRows ?? 0}</td>
      <td class="score-cell-quota">${row.totalQuotaAvailable ?? 0}</td>
      <td class="score-cell-utilization">${row.utilizationPct ?? 0}%</td>
      <td class="score-cell-reason" title="${reasonText}">${reasonText}</td>
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

function setCapacityScoreSnapshotStatus(scoreRows, desiredCount) {
  if (!capacityScoreLiveStatus) {
    return;
  }

  const latestSnapshot = (Array.isArray(scoreRows) ? scoreRows : [])
    .map((row) => row?.liveCheckedAtUtc)
    .filter(Boolean)
    .sort((left, right) => new Date(right) - new Date(left))[0];

  if (!latestSnapshot) {
    capacityScoreLiveStatus.textContent = `No saved live placement snapshot found in SQL for desired count ${desiredCount}. Press Refresh Live Placement to calculate it.`;
    capacityScoreLiveStatus.title = capacityScoreLiveStatus.textContent;
    return;
  }

  const message = `Showing saved live placement snapshot for desired count ${desiredCount}, last checked ${formatTimestamp(latestSnapshot)}. Press Refresh Live Placement to update it.`;
  capacityScoreLiveStatus.textContent = message;
  capacityScoreLiveStatus.title = message;
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
  setCapacityScoreStatus('Refreshing live placement scores...', 'Refreshing live placement scores from Get-AzVMAvailability...');

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
    const requestedCount = payload.requestedDesiredCount ?? desiredCount;
    const effectiveCount = payload.effectiveDesiredCount ?? desiredCount;
    const statusMessage = `Live refresh ${formatCompactTimestamp(payload.liveCheckedAtUtc)}. Requested ${requestedCount}; evaluated ${effectiveCount}.${payload.warning ? ' Warning.' : ''}`;
    const detailMessage = `Live placement refreshed at ${formatTimestamp(payload.liveCheckedAtUtc)} via ${payload.source}. Requested ${requestedCount} VM(s); evaluated ${effectiveCount}.${payload.warning ? ` ${payload.warning}` : ''}`;
    setCapacityScoreStatus(statusMessage, detailMessage);
  } catch (error) {
    const errorMsg = error.message || 'Failed to refresh live placement scores.';
    setCapacityScoreStatus('Live refresh failed.', errorMsg);
    
    // Log error to database for support visibility
    await logErrorToDatabase({
      source: 'live-placement-refresh',
      type: error.name || 'LivePlacementError',
      message: errorMsg,
      stack: error.stack || null,
      severity: 'error',
      context: { filters: getQueryFilters(), desiredCount },
      region: filters.region && filters.region !== 'all' ? filters.region : null,
      desiredCount
    });
  } finally {
    setButtonBusy(refreshLivePlacementBtn, false);
  }
}

function renderBarChart(host, items, options = {}) {
  if (!host) return;
  host.innerHTML = '';
  if (!items || items.length === 0) {
    host.innerHTML = '<div class="inline-note">No data available</div>';
    return;
  }

  const maxValue = Math.max(...items.map((item) => item.value), 1);
  const valueFormatter = typeof options.valueFormatter === 'function'
    ? options.valueFormatter
    : ((value) => String(value));
  items.forEach((item) => {
    const width = Math.max(2, Math.round((item.value / maxValue) * 100));
    const row = document.createElement('div');
    row.className = 'chart-row';
    row.innerHTML = `
      <div>${item.label}</div>
      <div class="chart-track"><div class="chart-fill" style="width:${width}%"></div></div>
      <div>${valueFormatter(item.value, item)}</div>
    `;
    host.appendChild(row);
  });
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

function renderTrendLineChart(host, rows, options = {}) {
  if (!host) {
    return;
  }

  host.innerHTML = '';

  const scopedRows = Array.isArray(rows) ? rows : [];
  const series = Array.isArray(options.series) ? options.series : [];
  if (scopedRows.length === 0 || series.length === 0) {
    host.innerHTML = '<div class="inline-note">No trend history rows available.</div>';
    return;
  }

  const width = 920;
  const height = 276;
  const margin = { top: 16, right: 20, bottom: 34, left: 58 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(1, ...scopedRows.flatMap((row) => series.map((item) => Number(row?.[item.key] || 0))));
  const tickCount = 4;
  const xStep = scopedRows.length > 1 ? innerWidth / (scopedRows.length - 1) : 0;

  const legend = document.createElement('div');
  legend.className = 'trend-chart-legend';
  legend.innerHTML = series.map((item) => `
    <div class="trend-chart-legend__item">
      <span class="trend-chart-legend__swatch" style="background:${item.color}"></span>
      <strong>${escapeHtml(item.label)}</strong>
      <span>${escapeHtml(formatCompactNumber(scopedRows[scopedRows.length - 1]?.[item.key]))}</span>
    </div>
  `).join('');

  const svgParts = [];
  for (let index = 0; index <= tickCount; index += 1) {
    const value = (maxValue / tickCount) * index;
    const y = margin.top + innerHeight - (value / maxValue) * innerHeight;
    svgParts.push(`<line class="trend-line-chart__grid" x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}"></line>`);
    svgParts.push(`<text class="trend-line-chart__tick" x="${margin.left - 10}" y="${y + 4}" text-anchor="end">${escapeHtml(formatCompactNumber(value))}</text>`);
  }

  series.forEach((item) => {
    const points = scopedRows.map((row, index) => {
      const value = Number(row?.[item.key] || 0);
      const x = margin.left + (scopedRows.length === 1 ? innerWidth / 2 : xStep * index);
      const y = margin.top + innerHeight - (value / maxValue) * innerHeight;
      return { x, y, value, day: row.day };
    });

    svgParts.push(`<polyline class="trend-line-chart__line" fill="none" stroke="${item.color}" stroke-width="3" points="${points.map((point) => `${point.x},${point.y}`).join(' ')}"></polyline>`);
    points.forEach((point) => {
      svgParts.push(`<circle cx="${point.x}" cy="${point.y}" r="4" fill="${item.color}"><title>${escapeHtml(`${item.label}: ${Number(point.value || 0).toLocaleString()} on ${point.day}`)}</title></circle>`);
    });
  });

  scopedRows.forEach((row, index) => {
    const x = margin.left + (scopedRows.length === 1 ? innerWidth / 2 : xStep * index);
    svgParts.push(`<text class="trend-line-chart__tick trend-line-chart__tick--x" x="${x}" y="${height - 10}" text-anchor="middle">${escapeHtml(formatShortDay(row.day))}</text>`);
  });

  const chart = document.createElement('div');
  chart.className = 'trend-line-chart__canvas';
  chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.title || 'Trend chart')}">${svgParts.join('')}</svg>`;

  host.appendChild(legend);
  host.appendChild(chart);
}

function parseRegionListInput(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
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
  const preferred = RECOMMENDER_FAMILY_SKU_OPTIONS[familyKey];
  if (Array.isArray(preferred) && preferred.length > 0) {
    return preferred;
  }
  const mapped = FAMILY_EXTRA_SKU_MAP[familyKey];
  return Array.isArray(mapped) ? mapped : [];
}

function defaultRecommendTargetSkuFromFilters() {
  const selectedType = resourceTypeFilter?.value || 'all';
  const selectedFamily = familyFilter?.value || 'all';
  const selectedAvailability = availabilityFilter?.value || 'all';
  const familyPreferredSkus = getRecommenderFamilySkuOptions(selectedFamily);

  if (Array.isArray(familyPreferredSkus) && familyPreferredSkus.length > 0) {
    return normalizeSkuName(familyPreferredSkus[0]);
  }

  const scoped = presetScopedRows(rows).filter((row) => {
    const byFamily = selectedFamily === 'all' || row.family === selectedFamily;
    const byAvailability = selectedAvailability === 'all' || row.availability === selectedAvailability;
    const byType = rowMatchesSelectedResourceType(row, selectedType);
    return byFamily && byAvailability && byType;
  });

  if (!Array.isArray(scoped) || scoped.length === 0) {
    return '';
  }

  const bySku = new Map();
  scoped.forEach((row) => {
    const sku = normalizeSkuName(row?.sku);
    if (!sku || isAggregateSkuName(sku)) {
      return;
    }

    const current = bySku.get(sku) || { weight: 0, count: 0 };
    current.weight += recommendationAvailabilityWeight(row?.availability);
    current.count += 1;
    bySku.set(sku, current);
  });

  const ordered = [...bySku.entries()]
    .sort((a, b) => {
      if (b[1].weight !== a[1].weight) {
        return b[1].weight - a[1].weight;
      }
      if (b[1].count !== a[1].count) {
        return b[1].count - a[1].count;
      }
      return compareSkuValues(a[0], b[0]);
    });

  return ordered[0]?.[0] || '';
}

function defaultRecommendRegionsFromFilters() {
  const currentRegion = String(regionFilter?.value || '').trim().toLowerCase();
  if (currentRegion && currentRegion !== 'all') {
    return currentRegion;
  }

  const presetRegions = activePresetRegions();
  if (Array.isArray(presetRegions) && presetRegions.length > 0) {
    return presetRegions.join(',');
  }

  if (Array.isArray(capacityFacetRegions) && capacityFacetRegions.length > 0) {
    return capacityFacetRegions.join(',');
  }

  const scopedRegions = [...new Set(filteredRows()
    .map((row) => String(row?.region || '').trim().toLowerCase())
    .filter(Boolean))];
  if (scopedRegions.length > 0) {
    return scopedRegions.join(',');
  }

  return '';
}

function recommendationSkuOptionsFromTopFilters() {
  const selectedType = resourceTypeFilter?.value || 'all';
  const selectedFamily = familyFilter?.value || 'all';
  const selectedAvailability = availabilityFilter?.value || 'all';
  const options = new Set();

  const scopedRows = presetScopedRows(rows).filter((row) => {
    const byFamily = selectedFamily === 'all' || row.family === selectedFamily;
    const byAvailability = selectedAvailability === 'all' || row.availability === selectedAvailability;
    const byType = rowMatchesSelectedResourceType(row, selectedType);
    return byFamily && byAvailability && byType;
  });

  scopedRows.forEach((row) => {
    const sku = normalizeSkuName(row?.sku);
    if (sku && !isAggregateSkuName(sku)) {
      options.add(sku);
    }
  });

  const familyPreferredSkus = getRecommenderFamilySkuOptions(selectedFamily);
  if (Array.isArray(familyPreferredSkus)) {
    familyPreferredSkus.forEach((sku) => {
      const normalizedSku = normalizeSkuName(sku);
      if (normalizedSku) {
        options.add(normalizedSku);
      }
    });
  }

  return [...options].sort((a, b) => compareSkuValues(a, b));
}

function syncRecommendationSkuOptions() {
  if (!recommendTargetSku) {
    return;
  }

  recommendTargetSku.setAttribute('list', 'recommendTargetSkuOptions');
  const list = document.querySelector('#recommendTargetSkuOptions');
  if (!list) {
    return;
  }

  list.innerHTML = '';
  recommendationSkuOptionsFromTopFilters().forEach((sku) => {
    const option = document.createElement('option');
    option.value = sku;
    list.appendChild(option);
  });
}

function syncRecommendationInputsFromTopFilters({ force = false } = {}) {
  syncRecommendationSkuOptions();

  const targetSkuFromFilters = defaultRecommendTargetSkuFromFilters();
  const regionsFromFilters = defaultRecommendRegionsFromFilters();

  if (
    recommendTargetSku
    && targetSkuFromFilters
    && (force || !recommendTargetSku.value || recommendTargetSku.value === lastAutoRecommendTargetSku)
  ) {
    recommendTargetSku.value = targetSkuFromFilters;
    lastAutoRecommendTargetSku = targetSkuFromFilters;
  }
  if (
    recommendRegions
    && regionsFromFilters
    && (force || !recommendRegions.value || recommendRegions.value === lastAutoRecommendRegions)
  ) {
    recommendRegions.value = regionsFromFilters;
    lastAutoRecommendRegions = regionsFromFilters;
  }
}

function normalizeRecommendInputs() {
  const targetSku = normalizeSkuName(recommendTargetSku?.value || '');
  const regions = parseRegionListInput(recommendRegions?.value || '');
  const topN = Math.max(1, Math.min(Number(recommendTopN?.value || 10), 25));
  const minScore = Math.max(0, Math.min(Number(recommendMinScore?.value || 50), 100));
  const showPricing = Boolean(recommendShowPricing?.checked);
  const showSpot = Boolean(recommendShowSpot?.checked);

  if (recommendTopN) {
    recommendTopN.value = String(topN);
  }
  if (recommendMinScore) {
    recommendMinScore.value = String(minScore);
  }

  return {
    targetSku,
    regions,
    topN,
    minScore,
    showPricing,
    showSpot
  };
}

function setRecommendStatus(message, tone = 'info') {
  if (!recommendStatus) {
    return;
  }
  recommendStatus.className = `inline-note ${tone}`;
  recommendStatus.textContent = message;
}

function buildRecommendationErrorMessage(payload) {
  const base = payload?.detail || payload?.error || 'Recommendation request failed.';
  const diagnostics = payload?.diagnostics;
  if (!diagnostics || typeof diagnostics !== 'object') {
    return base;
  }

  const parts = [];
  if (diagnostics.wrapperExists === false) {
    parts.push('wrapper script not found');
  }
  if (diagnostics.scriptExists === false) {
    parts.push('Get-AzVMAvailability.ps1 not found');
  }
  if (diagnostics.repoExists === false) {
    parts.push('repo root not found');
  }

  if (parts.length === 0) {
    return base;
  }

  return `${base} (${parts.join('; ')})`;
}

function normalizeRecommendationCapacityState(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) {
    return 'N/A';
  }

  if (normalized.includes('OK') || normalized.includes('AVAILABLE')) {
    return 'OK';
  }
  if (normalized.includes('LIMIT')) {
    return 'LIMITED';
  }
  if (normalized.includes('CONSTRAINED') || normalized.includes('BLOCKED') || normalized.includes('UNAVAILABLE')) {
    return 'CONSTRAINED';
  }

  return 'N/A';
}

function renderRecommendationCapacityBadge(value) {
  const state = normalizeRecommendationCapacityState(value);
  const text = String(value || 'n/a').trim() || 'n/a';
  return `<span class="badge ${state}">${escapeHtml(text)}</span>`;
}

function renderRecommendations(payload) {
  if (!recommendGridBody) {
    return;
  }

  const target = payload?.target || null;
  const targetAvailability = Array.isArray(payload?.targetAvailability) ? payload.targetAvailability : [];
  const recommendations = Array.isArray(payload?.recommendations) ? payload.recommendations : [];
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
  const belowMinSpec = Array.isArray(payload?.belowMinSpec) ? payload.belowMinSpec : [];

  if (recommendTargetSummary) {
    if (target?.name) {
      const targetStatus = targetAvailability.length > 0
        ? targetAvailability.map((row) => `${row.region}: ${row.capacity}`).join(' | ')
        : 'No target region status returned.';
      recommendTargetSummary.textContent = `Target ${normalizeSkuName(target.name)} | ${target.vCPU ?? 'n/a'} vCPU | ${target.memoryGB ?? 'n/a'} GiB | ${target.arch || 'n/a'} | ${target.disk || 'n/a'} | Status: ${targetStatus}`;
    } else {
      recommendTargetSummary.textContent = '';
    }
  }

  if (recommendWarnings) {
    const warningTexts = [...warnings, ...(belowMinSpec.length > 0 ? [`${belowMinSpec.length} recommendation candidate(s) were below minimum vCPU/memory filters.`] : [])];
    recommendWarnings.textContent = warningTexts.length > 0 ? warningTexts.join(' ') : '';
  }

  recommendGridBody.innerHTML = '';
  if (recommendations.length === 0) {
    recommendGridBody.innerHTML = '<tr><td colspan="15" style="text-align: center; padding: 20px; color: #5d7085;">No alternatives matched the current recommend filters.</td></tr>';
    return;
  }

  recommendations.forEach((row) => {
    const normalizedSku = normalizeSkuName(row.sku);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.rank ?? ''}</td>
      <td>${normalizedSku || 'n/a'}</td>
      <td>${row.region || 'n/a'}</td>
      <td>${row.vCPU ?? 'n/a'}</td>
      <td>${row.memGiB ?? 'n/a'}</td>
      <td>${row.score != null ? `${row.score}%` : 'n/a'}</td>
      <td>${row.cpu || 'n/a'}</td>
      <td>${row.disk || 'n/a'}</td>
      <td>${row.purpose || 'n/a'}</td>
      <td>${renderRecommendationCapacityBadge(row.capacity)}</td>
      <td>${row.zonesOK ?? 'n/a'}</td>
      <td>${row.priceHr != null ? `$${Number(row.priceHr).toFixed(2)}` : 'n/a'}</td>
      <td>${row.priceMo != null ? `$${Number(row.priceMo).toFixed(0)}` : 'n/a'}</td>
      <td>${row.spotPriceHr != null ? `$${Number(row.spotPriceHr).toFixed(2)}` : 'n/a'}</td>
      <td>${row.spotPriceMo != null ? `$${Number(row.spotPriceMo).toFixed(0)}` : 'n/a'}</td>
    `;
    recommendGridBody.appendChild(tr);
  });
}

function initializeRecommendationView() {
  if (!recommendTargetSku || !recommendGridBody) {
    return;
  }

  syncRecommendationInputsFromTopFilters();

  const { targetSku } = normalizeRecommendInputs();
  if (!targetSku) {
    setRecommendStatus('Enter a target SKU, then press Run Recommendation.', 'warn');
    recommendGridBody.innerHTML = '<tr><td colspan="15" style="text-align: center; padding: 20px; color: #5d7085;">Enter a target SKU and press Run Recommendation.</td></tr>';
    return;
  }

  setRecommendStatus('Press Run Recommendation to evaluate alternatives.', 'info');
  recommendGridBody.innerHTML = '<tr><td colspan="15" style="text-align: center; padding: 20px; color: #5d7085;">Press Run Recommendation to evaluate alternatives for the current target SKU and regions.</td></tr>';
}

async function loadRecommendationView() {
  if (!recommendTargetSku || !recommendGridBody) {
    return;
  }

  syncRecommendationInputsFromTopFilters();

  const { targetSku, regions, topN, minScore, showPricing, showSpot } = normalizeRecommendInputs();
  if (!targetSku) {
    setRecommendStatus('Enter a target SKU to run recommendations.', 'warn');
    recommendGridBody.innerHTML = '<tr><td colspan="15" style="text-align: center; padding: 20px; color: #5d7085;">Enter a target SKU and press Run Recommendation.</td></tr>';
    return;
  }

  setRecommendStatus(`Running recommendations for ${targetSku}...`, 'info');
  setButtonBusy(runRecommendBtn, true, 'Running...');

  try {
    const baseFilters = getQueryFilters();
    const response = await fetch('/api/capacity/recommendations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        targetSku,
        regions,
        regionPreset: baseFilters.regionPreset,
        topN,
        minScore,
        showPricing,
        showSpot
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(buildRecommendationErrorMessage(payload));
    }

    renderRecommendations(payload.result || {});
    const count = Array.isArray(payload.result?.recommendations) ? payload.result.recommendations.length : 0;
    setRecommendStatus(`Recommendation completed. ${count} alternative SKU(s) returned.`, 'success');
  } catch (error) {
    const errorMessage = error.message || 'Failed to run recommendations.';
    setRecommendStatus(errorMessage, 'error');
    recommendGridBody.innerHTML = `<tr><td colspan="15" style="text-align: center; padding: 20px; color: #5d7085;">Recommendation run failed: ${escapeHtml(errorMessage)}</td></tr>`;
  } finally {
    loadedViews.add('recommender');
    setButtonBusy(runRecommendBtn, false);
  }
}

function renderCharts(data) {
  const selectedType = resourceTypeFilter?.value || 'all';
  const scopedRows = (Array.isArray(data) ? data : []).filter((row) => rowMatchesSelectedResourceType(row, selectedType));
  renderRegionHealth(scopedRows);

  const bySku = new Map();
  scopedRows.forEach((row) => {
    const available = row.quotaLimit - row.quotaCurrent;
    const normalizedSku = normalizeSkuName(row.sku);
    if (!normalizedSku) {
      return;
    }
    bySku.set(normalizedSku, (bySku.get(normalizedSku) || 0) + available);
  });
  const skuItems = [...bySku.entries()]
    .map(([sku, value]) => ({ label: sku, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  renderBarChart(skuChart, skuItems, {
    valueFormatter: (value) => Number(value).toLocaleString()
  });
}

function formatPercent(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return '0.0%';
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function renderRegionHealth(data) {
  if (!regionHealthGridBody) {
    return;
  }

  const scopedRows = Array.isArray(data) ? data : [];
  regionHealthGridBody.innerHTML = '';

  if (scopedRows.length === 0) {
    regionHealthGridBody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px; color: #5d7085;">No data available for the current filter scope.</td></tr>';
    return;
  }

  const byRegion = new Map();

  scopedRows.forEach((row) => {
    const region = String(row.region || '').trim();
    if (!region) {
      return;
    }

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
    const subscriptionIdentity = String(row.subscriptionId || row.subscriptionKey || '').trim();
    const provider = getAIQuotaProviderLabel(row);

    entry.totalRows += 1;
    entry.totalQuotaHeadroom += Number(row.quotaLimit || 0) - Number(row.quotaCurrent || 0);
    if (provider && provider !== 'Unknown') {
      entry.providers.add(provider);
    }

    if (availability === 'OK' || availability === 'LIMITED') {
      entry.deployableRows += 1;
      entry.deployableFamilies.add(family);
      if (subscriptionIdentity) {
        entry.deployableSubscriptions.add(subscriptionIdentity);
      }
    }

    if (availability === 'CONSTRAINED' || availability === 'RESTRICTED') {
      entry.constrainedRows += 1;
      entry.constrainedFamilyCounts.set(family, (entry.constrainedFamilyCounts.get(family) || 0) + 1);
    }
  });

  const regionItems = [...byRegion.entries()]
    .map(([region, entry]) => ({
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
    }))
    .sort((a, b) => {
      const deployableRateA = a.totalRows > 0 ? a.deployableRows / a.totalRows : 0;
      const deployableRateB = b.totalRows > 0 ? b.deployableRows / b.totalRows : 0;
      if (deployableRateB !== deployableRateA) {
        return deployableRateB - deployableRateA;
      }

      if (b.totalQuotaHeadroom !== a.totalQuotaHeadroom) {
        return b.totalQuotaHeadroom - a.totalQuotaHeadroom;
      }

      return a.region.localeCompare(b.region);
    });

  regionItems.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.region}</td>
      <td>${item.totalRows.toLocaleString()}</td>
      <td>${item.deployableRows.toLocaleString()}</td>
      <td>${formatPercent(item.deployableRows, item.totalRows)}</td>
      <td>${item.constrainedRows.toLocaleString()}</td>
      <td>${formatPercent(item.constrainedRows, item.totalRows)}</td>
      <td>${Math.round(item.totalQuotaHeadroom).toLocaleString()}</td>
      <td>${item.deployableFamilyCount.toLocaleString()}</td>
      <td>${item.deployableSubscriptionCount.toLocaleString()}</td>
      <td>${escapeHtml(item.providers.join(', ') || 'n/a')}</td>
      <td>${item.topConstrainedFamilies.join(', ') || 'n/a'}</td>
    `;
    regionHealthGridBody.appendChild(tr);
  });
}

function getQueryFilters() {
  const regionPreset = regionPresetFilter.value || 'USMajor';
  const region = regionFilter.value || 'all';
  const family = familyFilter.value || 'all';
  const availability = availabilityFilter.value || 'all';
  const subscriptionIds = selectedSubscriptionCsv();
  const resourceType = resourceTypeFilter?.value || 'all';
  const provider = resourceType === 'AI' ? (aiQuotaProviderFilter?.value || 'all') : 'all';
  return {
    regionPreset,
    region,
    family,
    availability,
    subscriptionIds,
    resourceType,
    ...(provider && provider !== 'all' ? { provider } : {})
  };
}

async function loadCapacityScoreView() {
  const baseFilters = getQueryFilters();
  const base = new URLSearchParams(baseFilters);
  const desiredCount = normalizeDesiredPlacementCount();
  base.append('desiredCount', String(desiredCount));
  
  // Add pagination parameters
  base.append('pageNumber', String(capacityScorePaging.pageNumber));
  base.append('pageSize', String(capacityScorePaging.pageSize));

  try {
    const [subscriptionResponse, scoreResponse] = await Promise.all([
      fetch(`/api/capacity/subscriptions?${base.toString()}`),
      fetch(`/api/capacity/scores?${base.toString()}`)
    ]);

    const subscriptionPayload = subscriptionResponse.ok ? await subscriptionResponse.json() : { rows: [] };
    const scorePayload = scoreResponse.ok ? await scoreResponse.json() : { rows: [] };

    renderSubscriptionSummary(Array.isArray(subscriptionPayload.rows) ? subscriptionPayload.rows : []);
  const scoreRows = Array.isArray(scorePayload.rows) ? scorePayload.rows : [];
  renderCapacityScores(scoreRows);
    
    // Update pagination info from response
    const paging = scorePayload.pagination || {};
    capacityScorePaging.total = Number(paging.total || 0);
    capacityScorePaging.pageNumber = Number(paging.pageNumber || capacityScorePaging.pageNumber || 1);
    capacityScorePaging.pageSize = Number(paging.pageSize || capacityScorePaging.pageSize || 50);
    capacityScorePaging.pageCount = Math.max(1, Number(paging.pageCount || 1));
    capacityScorePaging.hasNext = Boolean(paging.hasNext);
    capacityScorePaging.hasPrev = Boolean(paging.hasPrev);
    renderCapacityScorePaging();
    
    setCapacityScoreSnapshotStatus(scoreRows, desiredCount);
  } catch (_) {
    renderSubscriptionSummary([]);
    renderCapacityScores([]);
    capacityScorePaging.total = 0;
    capacityScorePaging.pageCount = 1;
    capacityScorePaging.hasNext = false;
    capacityScorePaging.hasPrev = false;
    renderCapacityScorePaging();
    setCapacityScoreSnapshotStatus([], normalizeDesiredPlacementCount());
  }

  loadedViews.add('capacity-score');
}

async function loadTrendView() {
  const baseFilters = getQueryFilters();
  const trendQuery = new URLSearchParams({ ...baseFilters, days: '7' });

  try {
    const trendResponse = await fetch(`/api/capacity/trends?${trendQuery.toString()}`);
    const trendPayload = trendResponse.ok ? await trendResponse.json() : { rows: [] };
    renderTrends(Array.isArray(trendPayload.rows) ? trendPayload.rows : []);
  } catch (_) {
    renderTrends([]);
  }

  loadedViews.add('trend');
}

async function loadAIModelAvailabilityView() {
  setAIModelsStatus('Loading AI model availability catalog...', 'info');
  if (refreshAiModelsBtn) {
    refreshAiModelsBtn.disabled = true;
    refreshAiModelsBtn.textContent = 'Loading...';
  }

  try {
    const [modelsResponse, regionsResponse] = await Promise.all([
      fetch('/api/ai/models'),
      fetch('/api/ai/models/regions')
    ]);

    if (modelsResponse.status === 401 || regionsResponse.status === 401) {
      redirectToLoginOnce();
      return;
    }

    const modelsPayload = modelsResponse.ok ? await modelsResponse.json() : { rows: [] };
    aiModelRows = Array.isArray(modelsPayload.rows) ? modelsPayload.rows : [];
    const regionsPayload = regionsResponse.ok ? await regionsResponse.json() : { regions: [] };
    if (Array.isArray(regionsPayload.regions) && regionsPayload.regions.length > 0) {
      capacityFacetRegions = Array.from(new Set([...capacityFacetRegions, ...regionsPayload.regions])).sort();
    }
    syncAIProviderOptions(aiModelRows);
    syncAIDeploymentTypeOptions(aiModelRows);
    renderAIModelAvailability();
    setAIModelsStatus(`Loaded ${aiModelRows.length.toLocaleString()} AI model availability row(s).`, 'success');
  } catch (error) {
    aiModelRows = [];
    syncAIProviderOptions([]);
    syncAIDeploymentTypeOptions([]);
    renderAIModelAvailability();
    setAIModelsStatus(error.message || 'Failed to load AI model availability.', 'error');
  } finally {
    if (refreshAiModelsBtn) {
      refreshAiModelsBtn.disabled = false;
      refreshAiModelsBtn.textContent = 'Refresh AI Catalog';
    }
  }

  loadedViews.add('ai-model-availability');
}

async function loadFamilySummaryView() {
  const baseFilters = getQueryFilters();
  const familySummaryQuery = new URLSearchParams({ ...baseFilters, family: 'all' });

  try {
    const familyResponse = await fetch(`/api/capacity/families?${familySummaryQuery.toString()}`);
    const familyPayload = familyResponse.ok ? await familyResponse.json() : { rows: [] };
    const familyRows = Array.isArray(familyPayload.rows) ? familyPayload.rows : [];
    renderFamilySummary(familyRows.length > 0 ? familyRows : deriveFamilySummaryFromRows(reportScopedRows()));
  } catch (_) {
    renderFamilySummary(deriveFamilySummaryFromRows(reportScopedRows()));
  }

  loadedViews.add('family-summary');
}

async function loadDerivedAnalyticsRows() {
  const baseFilters = getQueryFilters();
  const query = new URLSearchParams(baseFilters);

  const response = await fetch(`/api/capacity?${query.toString()}`);
  const payload = response.ok ? await response.json() : { rows: [] };
  analyticsRows = Array.isArray(payload.rows)
    ? payload.rows.map((row) => ({
        ...row,
        sku: normalizeSkuName(row?.sku)
      }))
    : [];
  syncAIQuotaProviderOptions(analyticsRows);
  return analyticsRows;
}

async function loadChartViews() {
  try {
    const data = await loadDerivedAnalyticsRows();
    renderCharts(data);
    renderSummary(data);
  } catch (_) {
    analyticsRows = [];
    renderCharts(filteredRows());
    renderSummary(filteredRows());
  }

  loadedViews.add('region-health');
  loadedViews.add('sku-chart');
}

async function loadRegionMatrixView() {
  try {
    regionMatrixRows = await loadDerivedAnalyticsRows();
    renderRegionMatrix(regionMatrixRows);
    renderSummaryForActiveView(regionMatrixRows, regionMatrixRows);
  } catch (_) {
    analyticsRows = [];
    regionMatrixRows = [];
    renderRegionMatrix(reportScopedRows());
    renderSummaryForActiveView(filteredRows(), reportScopedRows());
  }

  loadedViews.add('region-matrix');
}

function refreshActiveAnalyticsView() {
  const view = getActiveReportViewKey();
  // Remove from loaded set so the tab handler re-fetches fresh data
  loadedViews.delete(view);
  if (view === 'recommender') return initializeRecommendationView();
  if (view === 'capacity-score') {
    resetCapacityScorePaging();
    return loadCapacityScoreView();
  }
  if (view === 'trend') return loadTrendView();
  if (view === 'family-summary') return loadFamilySummaryView();
  if (view === 'ai-model-availability') return loadAIModelAvailabilityView();
  if (view === 'region-matrix') return loadRegionMatrixView();
  if (view === 'region-health' || view === 'sku-chart') return loadChartViews();
}

// Keep loadAnalytics as a convenience for refreshing all views at once
// (e.g., after a new ingest). Not called on startup.
async function loadAnalytics() {
  await Promise.all([loadCapacityScoreView(), loadTrendView(), loadFamilySummaryView()]);
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
      redirectToLoginOnce();
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
  gridBody.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:24px;color:#5d7085;">Loading…</td></tr>';
  const filters = getQueryFilters();
  const query = new URLSearchParams({
    ...filters,
    pageNumber: String(capacityPaging.pageNumber),
    pageSize: String(capacityPaging.pageSize)
  });

  try {
    const response = await fetch(`/api/capacity/paged?${query.toString()}`);
    if (response.status === 401) {
      redirectToLoginOnce();
      return;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    rows = Array.isArray(payload.data)
      ? payload.data.map((row) => ({
          ...row,
          sku: normalizeSkuName(row?.sku)
        }))
      : [];
    capacityFacetRegions = Array.isArray(payload.facets?.regions) ? payload.facets.regions : [];
    capacityFacetFamilies = Array.isArray(payload.facets?.families) ? payload.facets.families : [];
    capacityGridSummary = payload.summary
      ? {
          constrainedRows: Number(payload.summary.constrainedRows || 0),
          availableQuota: Number(payload.summary.availableQuota || 0),
          monthlyCost: Number(payload.summary.monthlyCost || 0)
        }
      : null;
    const paging = payload.pagination || {};
    capacityPaging.total = Number(paging.total || 0);
    capacityPaging.pageNumber = Number(paging.pageNumber || capacityPaging.pageNumber || 1);
    capacityPaging.pageSize = Number(paging.pageSize || capacityPaging.pageSize || 50);
    capacityPaging.pageCount = Math.max(1, Number(paging.pageCount || 1));
    capacityPaging.hasNext = Boolean(paging.hasNext);
    capacityPaging.hasPrev = Boolean(paging.hasPrev);
  } catch (_) {
    rows = [];
    capacityFacetRegions = [];
    capacityFacetFamilies = [];
    capacityGridSummary = null;
    capacityPaging.total = 0;
    capacityPaging.pageCount = 1;
    capacityPaging.hasNext = false;
    capacityPaging.hasPrev = false;
  }

  syncRegionOptions();
  syncFamilyOptions();
  syncAIQuotaProviderOptions(analyticsRows.length > 0 ? analyticsRows : rows);
  syncRecommendationInputsFromTopFilters();
  renderGrid();

  const activeView = getActiveReportViewKey();
  if (activeView === 'region-matrix') {
    await loadRegionMatrixView();
  } else if (activeView === 'region-health' || activeView === 'sku-chart') {
    await loadChartViews();
  } else if (activeView === 'ai-model-availability' && loadedViews.has('ai-model-availability')) {
    renderAIModelAvailability();
  }
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

      const derivedRows = analyticsRows.length > 0 ? analyticsRows : filteredRows();
      const derivedMatrixRows = regionMatrixRows.length > 0 ? regionMatrixRows : reportScopedRows();
      renderSummaryForActiveView(derivedRows, derivedMatrixRows);

      const view = btn.dataset.reportView;

      if (view === 'region-matrix') {
        if (!loadedViews.has('region-matrix')) {
          loadRegionMatrixView();
        } else {
          const matrixRows = regionMatrixRows.length > 0 ? regionMatrixRows : reportScopedRows();
          renderRegionMatrix(matrixRows);
          renderSummaryForActiveView(analyticsRows.length > 0 ? analyticsRows : filteredRows(), matrixRows);
        }
      } else if (view === 'region-health' || view === 'sku-chart') {
        if (!loadedViews.has('region-health') || !loadedViews.has('sku-chart')) {
          loadChartViews();
        } else {
          const chartRows = analyticsRows.length > 0 ? analyticsRows : filteredRows();
          renderCharts(chartRows);
          renderSummary(chartRows);
        }
      } else if (view === 'capacity-score' && !loadedViews.has('capacity-score')) {
        resetCapacityScorePaging();
        loadCapacityScoreView();
      } else if (view === 'recommender' && !loadedViews.has('recommender')) {
        initializeRecommendationView();
      } else if (view === 'family-summary' && !loadedViews.has('family-summary')) {
        loadFamilySummaryView();
      } else if (view === 'trend' && !loadedViews.has('trend')) {
        loadTrendView();
      } else if (view === 'ai-model-availability') {
        if (!loadedViews.has('ai-model-availability')) {
          loadAIModelAvailabilityView();
        } else {
          renderAIModelAvailability();
        }
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
  document.getElementById('refreshAnalyticsBtn').addEventListener('click', refreshActiveAnalyticsView);
  document.getElementById('simulateBtn').addEventListener('click', simulateQuotaImpact);
  triggerIngestBtn.addEventListener('click', triggerCapacityIngest);
  runRecommendBtn?.addEventListener('click', loadRecommendationView);
  recommendTargetSku?.addEventListener('input', () => {
    const caretPos = recommendTargetSku.selectionStart;
    const normalized = normalizeSkuName(recommendTargetSku.value || '');
    if (normalized && normalized !== recommendTargetSku.value) {
      recommendTargetSku.value = normalized;
      if (typeof caretPos === 'number') {
        const nextPos = Math.min(caretPos, normalized.length);
        recommendTargetSku.setSelectionRange(nextPos, nextPos);
      }
    }
  });
  recommendTargetSku?.addEventListener('blur', () => {
    const normalized = normalizeSkuName(recommendTargetSku.value || '');
    if (normalized) {
      recommendTargetSku.value = normalized;
    }
  });
  refreshLivePlacementBtn?.addEventListener('click', refreshLivePlacementScores);
  refreshAiModelsBtn?.addEventListener('click', loadAIModelAvailabilityView);
  document.getElementById('applyBtn').addEventListener('click', () => {
    const ok = confirm('Apply quota movements is a write operation. Continue?');
    if (ok) alert('Apply request queued. Next step: backend orchestration + approval flow.');
  });

  subscriptionRefreshBtn.addEventListener('click', async () => {
    setAdminStatus('Refreshing subscription catalog...', 'info');
    await loadSubscriptions(true);
  });
  saveSchedulerSettingsBtn?.addEventListener('click', saveSchedulerSettings);
  reloadSchedulerSettingsBtn?.addEventListener('click', reloadSchedulerSettings);
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

  capacityScorePageSize?.addEventListener('change', () => {
    const nextPageSize = Math.max(10, Math.min(Number(capacityScorePageSize.value || 50), 500));
    capacityScorePaging.pageSize = nextPageSize;
    resetCapacityScorePaging();
    loadCapacityScoreView();
  });

  capacityScorePrevPage?.addEventListener('click', () => {
    if (!capacityScorePaging.hasPrev) return;
    capacityScorePaging.pageNumber = Math.max(1, capacityScorePaging.pageNumber - 1);
    loadCapacityScoreView();
  });

  capacityScoreNextPage?.addEventListener('click', () => {
    if (!capacityScorePaging.hasNext) return;
    capacityScorePaging.pageNumber = capacityScorePaging.pageNumber + 1;
    loadCapacityScoreView();
  });

  sidebarToggle?.addEventListener('click', () => {
    setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'));
  });
}

quotaManagementGroupFilter?.addEventListener('change', () => {
  quotaGroupOptions = [];
  quotaCandidateRows = [];
  renderQuotaGroupOptions([]);
  renderQuotaCandidateFilterOptions([]);
  resetQuotaCandidateFilters();
  renderQuotaRunOptions([]);
  renderQuotaGroups([]);
  renderQuotaCandidates([]);
  renderQuotaPlan([]);
  renderQuotaSimulation([]);
  setQuotaDiscoveryStatus('Management group changed. Run discovery to load quota groups for the new scope.', 'info');
  setQuotaMovementStatus('Management group changed. Select a quota group and captured analysis run before planning or simulation.', 'info');
});

quotaGroupFilter?.addEventListener('change', () => {
  quotaCandidateRows = [];
  renderQuotaCandidateFilterOptions([]);
  resetQuotaCandidateFilters();
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

quotaCandidateSubscriptionFilter?.addEventListener('change', () => {
  renderQuotaCandidates(quotaCandidateRows);
});

quotaCandidateRegionFilter?.addEventListener('change', () => {
  renderQuotaCandidates(quotaCandidateRows);
});

quotaCandidateSkuFilter?.addEventListener('input', () => {
  renderQuotaCandidates(quotaCandidateRows);
});

quotaCandidateClearFiltersBtn?.addEventListener('click', () => {
  resetQuotaCandidateFilters();
  renderQuotaCandidates(quotaCandidateRows);
});

regionPresetFilter.addEventListener('change', () => {
  preserveRegionOptions = false;
  syncRegionOptions();
  resetCapacityPaging();
  loadCapacityRows();
});

regionFilter.addEventListener('change', () => {
  preserveRegionOptions = regionFilter.value !== 'all';
  resetCapacityPaging();
  loadCapacityRows();
});

resourceTypeFilter?.addEventListener('change', () => {
  familyFilter.value = 'all';
  if (familySearch) familySearch.value = '';
  if (aiQuotaProviderFilter) {
    aiQuotaProviderFilter.value = 'all';
  }
  syncAIQuotaProviderOptions(analyticsRows.length > 0 ? analyticsRows : rows);
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

aiQuotaProviderFilter?.addEventListener('change', () => {
  resetCapacityPaging();
  loadCapacityRows();
});

aiModelNameFilter?.addEventListener('input', () => {
  if (getActiveReportViewKey() === 'ai-model-availability') {
    renderAIModelAvailability();
  }
});

aiProviderFilter?.addEventListener('change', () => {
  if (getActiveReportViewKey() === 'ai-model-availability') {
    renderAIModelAvailability();
  }
});

aiDeploymentTypeFilter?.addEventListener('change', () => {
  if (getActiveReportViewKey() === 'ai-model-availability') {
    renderAIModelAvailability();
  }
});

aiDefaultOnlyInput?.addEventListener('change', () => {
  if (getActiveReportViewKey() === 'ai-model-availability') {
    renderAIModelAvailability();
  }
});

aiFineTuneFilter?.addEventListener('change', () => {
  if (getActiveReportViewKey() === 'ai-model-availability') {
    renderAIModelAvailability();
  }
});

capacityScoreDesiredCount?.addEventListener('change', () => {
  normalizeDesiredPlacementCount();
  resetCapacityScorePaging();
  loadCapacityScoreView();
});

wireTabs();
wireViewTabs();
wireButtons();
applyDeploymentTheme();
if (capacityPageSize) {
  capacityPaging.pageSize = Math.max(10, Math.min(Number(capacityPageSize.value || 50), 500));
}
if (capacityScorePageSize) {
  capacityScorePaging.pageSize = Math.max(10, Math.min(Number(capacityScorePageSize.value || 50), 500));
}
setSidebarCollapsed(false);
renderCapacityPaging();
renderCapacityScorePaging();
syncRegionOptions();
loadViewerAuth().then((proceed) => {
  if (!proceed) return; // not authenticated — navigating to /auth/login
  loadManagementGroups();
  syncIngestStatus().catch(() => {});
  reloadSchedulerSettings().catch(() => {});
  syncOperationHistory().catch(() => {});
  // Load subscriptions (fast — queries dbo.Subscriptions table), then load
  // the default capacity-grid view. All other report views load on first click.
  loadSubscriptions().then(() => loadCapacityRows());
});
