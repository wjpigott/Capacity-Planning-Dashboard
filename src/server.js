const express = require('express');
const cors = require('cors');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const ExcelJS = require('exceljs');
const dotenv = require('dotenv');

const initialEnvKeys = new Set(Object.keys(process.env));
dotenv.config();

// Load local overrides — gitignored, safe to customise for local dev.
// Precedence is: explicit shell env > .env.local > .env.
const localEnvPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(localEnvPath)) {
  const localEnv = dotenv.parse(fs.readFileSync(localEnvPath));
  Object.entries(localEnv).forEach(([key, value]) => {
    if (!initialEnvKeys.has(key)) {
      process.env[key] = value;
    }
  });
}

const session = require('express-session');
const MSSQLStore = require('connect-mssql-v2');
const { AUTH_ENABLED, buildAuthRouter, requireAuth, requireAdmin, getAccountFromSession, isAdmin } = require('./middleware/auth');

const {
  getCapacityRows,
  getCapacityRowsPaginated,
  getSubscriptions,
  getSubscriptionSummary,
  getCapacityTrends,
  getFamilySummary,
  getCapacityScoreSummary,
  getCapacityScoreSummaryPaginated
} = require('./services/capacityService');
const { buildSqlPreviewForView } = require('./services/sqlPreviewService');
const {
  getLivePlacementScoreRows,
  getCapacityRecommendations,
  getRecommendationDiagnostics,
  startLivePlacementScheduler,
  updateLivePlacementScheduler,
  getLivePlacementSchedulerConfig
} = require('./services/livePlacementService');
const { getQuotaCandidates, captureQuotaCandidateSnapshots } = require('./services/quotaCandidateService');
const { buildQuotaMovePlan, getQuotaCandidateRunHistory, simulateQuotaMovePlan } = require('./services/quotaPlanService');
const { applyQuotaMovePlan } = require('./services/quotaApplyService');
const {
  runCapacityIngestion,
  getIngestionStatus,
  startIngestionScheduler,
  updateIngestionScheduler,
  getIngestionSchedulerConfig
} = require('./services/azureIngestionService');
const { listManagementGroups, listQuotaGroups } = require('./services/quotaDiscoveryService');
const {
  getSqlPool,
  createSqlPoolWithAccessToken,
  ensurePhase3Schema,
  ensurePhase3SchemaForPool,
  ensureSubscriptionsTableSchema,
  getCapacityScoreSnapshotHistory,
  insertDashboardErrorLog,
  listDashboardErrorLogs,
  logDashboardOperation,
  listDashboardOperations,
  getDashboardSettings,
  getDashboardSettingsPersistence,
  upsertDashboardSettings
} = require('./store/sql');
const { applyIndexes } = require('./maintenance/applyPerformanceIndexes');

const app = express();
const port = process.env.PORT || 3000;
const QUOTA_APPLY_JOB_TTL_MS = 6 * 60 * 60 * 1000;
const INGEST_JOB_TTL_MS = 6 * 60 * 60 * 1000;
const quotaApplyJobs = new Map();
const ingestionJobs = new Map();

const DASHBOARD_SETTING_KEYS = {
  ingestIntervalMinutes: 'schedule.ingest.intervalMinutes',
  ingestRunOnStartup: 'schedule.ingest.runOnStartup',
  livePlacementIntervalMinutes: 'schedule.livePlacement.intervalMinutes',
  livePlacementRunOnStartup: 'schedule.livePlacement.runOnStartup',
  showSqlPreview: 'ui.showSqlPreview'
};

function normalizeIntervalMinutes(value, fallback = 0) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate)) {
    return Math.max(0, Math.min(Math.trunc(Number(fallback) || 0), 7 * 24 * 60));
  }

  return Math.max(0, Math.min(Math.trunc(candidate), 7 * 24 * 60));
}

function normalizeBoolean(value, fallback = false) {
  if (value == null) {
    return Boolean(fallback);
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const raw = String(value).trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

function cleanupQuotaApplyJobs() {
  const expiresBefore = Date.now() - QUOTA_APPLY_JOB_TTL_MS;
  for (const [jobId, job] of quotaApplyJobs.entries()) {
    const completedAt = job.completedAtUtc ? new Date(job.completedAtUtc).getTime() : 0;
    if (completedAt && completedAt < expiresBefore) {
      quotaApplyJobs.delete(jobId);
    }
  }
}

function cleanupIngestionJobs() {
  const expiresBefore = Date.now() - INGEST_JOB_TTL_MS;
  for (const [jobId, job] of ingestionJobs.entries()) {
    const completedAt = job.completedAtUtc ? new Date(job.completedAtUtc).getTime() : 0;
    if (completedAt && completedAt < expiresBefore) {
      ingestionJobs.delete(jobId);
    }
  }
}

function buildCapacityIngestionOptions(body = {}) {
  return {
    regionPreset: body.regionPreset,
    regions: body.regions,
    subscriptionIds: body.subscriptionIds,
    familyFilters: body.familyFilters
  };
}

function serializeIngestionJob(job) {
  return {
    ok: true,
    queued: job.status === 'queued' || job.status === 'running',
    jobId: job.jobId,
    status: job.status,
    createdAtUtc: job.createdAtUtc,
    startedAtUtc: job.startedAtUtc,
    completedAtUtc: job.completedAtUtc,
    error: job.error || null,
    result: job.result || null,
    options: job.options || null
  };
}

function getActiveIngestionJob() {
  cleanupIngestionJobs();
  let candidate = null;
  for (const job of ingestionJobs.values()) {
    if (job.status !== 'queued' && job.status !== 'running') {
      continue;
    }
    if (!candidate || new Date(job.createdAtUtc).getTime() > new Date(candidate.createdAtUtc).getTime()) {
      candidate = job;
    }
  }
  return candidate;
}

function queueCapacityIngestionJob(options) {
  cleanupIngestionJobs();

  const existing = getActiveIngestionJob();
  if (existing) {
    return existing;
  }

  const createdAtUtc = new Date().toISOString();
  const job = {
    jobId: randomUUID(),
    status: 'queued',
    createdAtUtc,
    startedAtUtc: null,
    completedAtUtc: null,
    options,
    result: null,
    error: null
  };

  ingestionJobs.set(job.jobId, job);

  setImmediate(async () => {
    const startedAt = Date.now();
    job.status = 'running';
    job.startedAtUtc = new Date(startedAt).toISOString();

    try {
      const result = await runCapacityIngestion(options);
      job.status = 'completed';
      job.completedAtUtc = new Date().toISOString();
      job.result = result;

      await logDashboardOperation({
        type: 'capacity-ingest',
        name: 'Capacity Ingestion',
        status: 'success',
        triggerSource: 'manual',
        startedAtUtc: job.startedAtUtc,
        completedAtUtc: job.completedAtUtc,
        durationMs: Date.now() - startedAt,
        rowsAffected: Number.isFinite(result?.insertedRows) ? result.insertedRows : null,
        subscriptionCount: Number.isFinite(result?.subscriptionCount) ? result.subscriptionCount : null,
        regionPreset: options.regionPreset || null,
        note: Array.isArray(result?.regions) && result.regions.length ? result.regions.join(', ') : null
      });
    } catch (err) {
      job.status = 'failed';
      job.completedAtUtc = new Date().toISOString();
      job.error = err.message;

      await logDashboardOperation({
        type: 'capacity-ingest',
        name: 'Capacity Ingestion',
        status: 'failed',
        triggerSource: 'manual',
        startedAtUtc: job.startedAtUtc || job.createdAtUtc,
        completedAtUtc: job.completedAtUtc,
        durationMs: Date.now() - startedAt,
        regionPreset: options.regionPreset || null,
        errorMessage: err.message
      });
    }
  });

  return job;
}

function buildQuotaApplyFilters(body = {}) {
  return {
    managementGroupId: body.managementGroupId,
    groupQuotaName: body.groupQuotaName,
    analysisRunId: body.analysisRunId,
    donorSubscriptionId: body.donorSubscriptionId,
    recipientSubscriptionId: body.recipientSubscriptionId,
    selectedSku: body.selectedSku,
    transferAmount: body.transferAmount,
    region: body.region,
    family: body.family,
    maxChanges: body.maxChanges
  };
}

function serializeQuotaApplyJob(job) {
  return {
    ok: true,
    queued: job.status === 'queued' || job.status === 'running',
    jobId: job.jobId,
    status: job.status,
    createdAtUtc: job.createdAtUtc,
    startedAtUtc: job.startedAtUtc,
    completedAtUtc: job.completedAtUtc,
    error: job.error || null,
    result: job.result || null,
    ...(job.result || {})
  };
}

function queueQuotaApplyJob(filters) {
  cleanupQuotaApplyJobs();

  const createdAtUtc = new Date().toISOString();
  const job = {
    jobId: randomUUID(),
    status: 'queued',
    createdAtUtc,
    startedAtUtc: null,
    completedAtUtc: null,
    filters,
    result: null,
    error: null
  };

  quotaApplyJobs.set(job.jobId, job);

  setImmediate(async () => {
    const startedAt = Date.now();
    job.status = 'running';
    job.startedAtUtc = new Date(startedAt).toISOString();

    try {
      const result = await applyQuotaMovePlan(filters);
      job.status = 'completed';
      job.completedAtUtc = new Date().toISOString();
      job.result = result;

      await logDashboardOperation({
        type: 'quota-apply',
        name: 'Quota Apply',
        status: result.failureCount > 0 ? 'failed' : 'success',
        triggerSource: 'manual',
        startedAtUtc: job.startedAtUtc,
        completedAtUtc: job.completedAtUtc,
        durationMs: Date.now() - startedAt,
        rowsAffected: Number.isFinite(result.submittedChangeCount) ? result.submittedChangeCount : null,
        subscriptionCount: Array.isArray(result.applyResults) ? new Set(result.applyResults.map((row) => row.subscriptionId).filter(Boolean)).size : null,
        note: `${filters.managementGroupId || 'unknown'} / ${filters.groupQuotaName || 'unknown'}`,
        errorMessage: result.failureCount > 0 ? `Quota apply completed with ${result.failureCount} failed submission(s).` : null
      });
    } catch (err) {
      job.status = 'failed';
      job.completedAtUtc = new Date().toISOString();
      job.error = err.message;

      await logDashboardOperation({
        type: 'quota-apply',
        name: 'Quota Apply',
        status: 'failed',
        triggerSource: 'manual',
        startedAtUtc: job.startedAtUtc || job.createdAtUtc,
        completedAtUtc: job.completedAtUtc,
        durationMs: Date.now() - startedAt,
        note: `${filters.managementGroupId || 'unknown'} / ${filters.groupQuotaName || 'unknown'}`,
        errorMessage: err.message
      });
    }
  });

  return job;
}

const CAPACITY_EXPORT_STATUS_META = {
  OK: {
    fill: 'FFC6EFCE',
    font: 'FF006100',
    description: 'Ready to deploy. No restrictions.'
  },
  LIMITED: {
    fill: 'FFFFEB9C',
    font: 'FF9C6500',
    description: "Your subscription can't use this. Request access via support ticket."
  },
  CONSTRAINED: {
    fill: 'FFFCE4D6',
    font: 'FF9C6500',
    description: 'Azure is low on hardware. Try a different zone or wait.'
  },
  PARTIAL: {
    fill: 'FFFFF2CC',
    font: 'FF9C6500',
    description: 'Some zones work, others are blocked. No zone redundancy.'
  },
  RESTRICTED: {
    fill: 'FFFFC7CE',
    font: 'FF9C0006',
    description: 'Cannot deploy. Pick a different region or SKU.'
  },
  DEFAULT: {
    fill: 'FFF3F2F1',
    font: 'FF605E5C',
    description: 'Status not classified.'
  }
};

function getCapacityFiltersFromQuery(query = {}) {
  return {
    regionPreset: query.regionPreset,
    subscriptionIds: query.subscriptionIds,
    region: query.region,
    family: query.family,
    availability: query.availability,
    resourceType: query.resourceType
  };
}

function normalizeCapacityExportFormat(rawFormat) {
  return String(rawFormat || 'csv').trim().toLowerCase() === 'xlsx' ? 'xlsx' : 'csv';
}

function buildCapacityExportRows(rows = []) {
  return rows.map((row) => {
    const quotaCurrent = Number(row.quotaCurrent || 0);
    const quotaLimit = Number(row.quotaLimit || 0);

    return {
      capturedAtUtc: row.capturedAtUtc ? new Date(row.capturedAtUtc).toISOString() : '',
      subscriptionName: row.subscriptionName || 'Legacy data',
      subscriptionId: row.subscriptionId || 'legacy-data',
      subscriptionKey: row.subscriptionKey || 'legacy-data',
      region: row.region || '',
      sku: row.sku || '',
      family: row.family || '',
      availability: row.availability || '',
      quotaCurrent,
      quotaLimit,
      quotaAvailable: quotaLimit - quotaCurrent,
      vCpu: Number(row.vCpu || 0),
      memoryGB: Number(row.memoryGB || 0),
      monthlyCost: Number(row.monthlyCost || 0),
      zonesCsv: row.zonesCsv || ''
    };
  });
}

function buildCapacityExportSummary(rows = [], filters = {}) {
  const regions = [...new Set(rows.map((row) => row.region).filter(Boolean))].sort();
  const families = [...new Set(rows.map((row) => row.family).filter(Boolean))].sort();
  const subscriptions = [...new Set(rows.map((row) => row.subscriptionId).filter(Boolean))];
  const selectedSubscriptions = String(filters.subscriptionIds || '').split(',').map((value) => value.trim()).filter(Boolean);

  return [
    { metric: 'Generated At (UTC)', value: new Date().toISOString() },
    { metric: 'Rows Exported', value: rows.length },
    { metric: 'Regions in Export', value: regions.length },
    { metric: 'Families in Export', value: families.length },
    { metric: 'Subscriptions in Export', value: subscriptions.length },
    { metric: 'Constrained Rows', value: rows.filter((row) => row.availability === 'CONSTRAINED').length },
    { metric: 'Limited Rows', value: rows.filter((row) => row.availability === 'LIMITED').length },
    { metric: 'Total Available Quota', value: rows.reduce((sum, row) => sum + Number(row.quotaAvailable || 0), 0) },
    { metric: 'Estimated Monthly Cost', value: rows.reduce((sum, row) => sum + Number(row.monthlyCost || 0), 0) },
    { metric: 'Region Preset', value: filters.regionPreset || 'all' },
    { metric: 'Region Filter', value: filters.region || 'all' },
    { metric: 'Family Filter', value: filters.family || 'all' },
    { metric: 'Availability Filter', value: filters.availability || 'all' },
    { metric: 'Resource Type Filter', value: filters.resourceType || 'all' },
    { metric: 'Selected Subscription Count', value: selectedSubscriptions.length }
  ];
}

function escapeCsvValue(value) {
  const text = String(value == null ? '' : value);
  if (!/[",\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCapacityCsv(exportRows = []) {
  const headers = [
    'capturedAtUtc',
    'subscriptionName',
    'subscriptionId',
    'subscriptionKey',
    'region',
    'sku',
    'family',
    'availability',
    'quotaCurrent',
    'quotaLimit',
    'quotaAvailable',
    'vCpu',
    'memoryGB',
    'monthlyCost',
    'zonesCsv'
  ];

  const lines = [headers.join(',')];
  exportRows.forEach((row) => {
    lines.push(headers.map((header) => escapeCsvValue(row[header])).join(','));
  });

  return `${lines.join('\r\n')}\r\n`;
}

function styleWorksheetHeader(worksheet, lastColumn) {
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  for (let column = 1; column <= lastColumn; column += 1) {
    const cell = headerRow.getCell(column);
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0078D4' }
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD1D1D1' } },
      left: { style: 'thin', color: { argb: 'FFD1D1D1' } },
      bottom: { style: 'thin', color: { argb: 'FFD1D1D1' } },
      right: { style: 'thin', color: { argb: 'FFD1D1D1' } }
    };
  }
}

async function buildCapacityWorkbook({ exportRows, filters }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Capacity Dashboard';
  workbook.created = new Date();
  workbook.modified = new Date();

  const summarySheet = workbook.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 28 },
    { header: 'Value', key: 'value', width: 36 }
  ];
  buildCapacityExportSummary(exportRows, filters).forEach((row) => summarySheet.addRow(row));
  styleWorksheetHeader(summarySheet, 2);

  summarySheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && rowNumber % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8F9FB' }
        };
      });
    }
  });

  const detailSheet = workbook.addWorksheet('Capacity Details', { views: [{ state: 'frozen', ySplit: 1 }] });
  detailSheet.columns = [
    { header: 'Captured At (UTC)', key: 'capturedAtUtc', width: 24 },
    { header: 'Subscription Name', key: 'subscriptionName', width: 28 },
    { header: 'Subscription ID', key: 'subscriptionId', width: 38 },
    { header: 'Subscription Key', key: 'subscriptionKey', width: 20 },
    { header: 'Region', key: 'region', width: 18 },
    { header: 'SKU', key: 'sku', width: 24 },
    { header: 'Family', key: 'family', width: 18 },
    { header: 'Availability', key: 'availability', width: 16 },
    { header: 'Quota Current', key: 'quotaCurrent', width: 14 },
    { header: 'Quota Limit', key: 'quotaLimit', width: 14 },
    { header: 'Quota Available', key: 'quotaAvailable', width: 16 },
    { header: 'vCPU', key: 'vCpu', width: 10 },
    { header: 'Memory GB', key: 'memoryGB', width: 12 },
    { header: 'Monthly Cost', key: 'monthlyCost', width: 14 },
    { header: 'Zones', key: 'zonesCsv', width: 18 }
  ];
  exportRows.forEach((row) => detailSheet.addRow(row));
  styleWorksheetHeader(detailSheet, detailSheet.columns.length);
  detailSheet.autoFilter = 'A1:O1';

  ['quotaCurrent', 'quotaLimit', 'quotaAvailable', 'vCpu', 'memoryGB'].forEach((key) => {
    detailSheet.getColumn(key).numFmt = '#,##0';
  });
  detailSheet.getColumn('monthlyCost').numFmt = '$#,##0.00';

  detailSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    if (rowNumber % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8F9FB' }
        };
      });
    }

    const availabilityCell = row.getCell('availability');
    const statusMeta = CAPACITY_EXPORT_STATUS_META[String(availabilityCell.value || '').toUpperCase()] || CAPACITY_EXPORT_STATUS_META.DEFAULT;
    availabilityCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: statusMeta.fill }
    };
    availabilityCell.font = { bold: true, color: { argb: statusMeta.font } };
    availabilityCell.alignment = { horizontal: 'center' };
  });

  const legendSheet = workbook.addWorksheet('Legend');
  legendSheet.columns = [
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Meaning', key: 'meaning', width: 68 }
  ];
  Object.entries(CAPACITY_EXPORT_STATUS_META)
    .filter(([status]) => status !== 'DEFAULT')
    .forEach(([status, meta]) => legendSheet.addRow({ status, meaning: meta.description }));
  styleWorksheetHeader(legendSheet, 2);

  legendSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const statusCell = row.getCell('status');
    const statusMeta = CAPACITY_EXPORT_STATUS_META[String(statusCell.value || '').toUpperCase()] || CAPACITY_EXPORT_STATUS_META.DEFAULT;
    statusCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: statusMeta.fill }
    };
    statusCell.font = { bold: true, color: { argb: statusMeta.font } };
  });

  return workbook.xlsx.writeBuffer();
}

function getDefaultSchedulerSettings() {
  return {
    ingest: {
      intervalMinutes: normalizeIntervalMinutes(process.env.INGEST_INTERVAL_MINUTES, 0),
      runOnStartup: normalizeBoolean(process.env.INGEST_ON_STARTUP, false)
    },
    livePlacement: {
      intervalMinutes: normalizeIntervalMinutes(process.env.LIVE_PLACEMENT_REFRESH_INTERVAL_MINUTES, 0),
      runOnStartup: normalizeBoolean(process.env.LIVE_PLACEMENT_REFRESH_ON_STARTUP, false)
    }
  };
}

function parseSchedulerSettingsFromDb(dbMap = {}) {
  const defaults = getDefaultSchedulerSettings();
  const readValue = (key) => (dbMap?.[key]?.value == null ? null : dbMap[key].value);

  return {
    ingest: {
      intervalMinutes: normalizeIntervalMinutes(readValue(DASHBOARD_SETTING_KEYS.ingestIntervalMinutes), defaults.ingest.intervalMinutes),
      runOnStartup: normalizeBoolean(readValue(DASHBOARD_SETTING_KEYS.ingestRunOnStartup), defaults.ingest.runOnStartup)
    },
    livePlacement: {
      intervalMinutes: normalizeIntervalMinutes(readValue(DASHBOARD_SETTING_KEYS.livePlacementIntervalMinutes), defaults.livePlacement.intervalMinutes),
      runOnStartup: normalizeBoolean(readValue(DASHBOARD_SETTING_KEYS.livePlacementRunOnStartup), defaults.livePlacement.runOnStartup)
    }
  };
}

async function getEffectiveSchedulerSettings() {
  try {
    const dbSettings = await getDashboardSettings('schedule.');
    return parseSchedulerSettingsFromDb(dbSettings);
  } catch {
    return getDefaultSchedulerSettings();
  }
}

function applyRuntimeSchedulerSettings(settings = {}) {
  const normalized = {
    ingest: {
      intervalMinutes: normalizeIntervalMinutes(settings?.ingest?.intervalMinutes, 0),
      runOnStartup: normalizeBoolean(settings?.ingest?.runOnStartup, false)
    },
    livePlacement: {
      intervalMinutes: normalizeIntervalMinutes(settings?.livePlacement?.intervalMinutes, 0),
      runOnStartup: normalizeBoolean(settings?.livePlacement?.runOnStartup, false)
    }
  };

  updateIngestionScheduler(normalized.ingest);
  updateLivePlacementScheduler(normalized.livePlacement);
  return normalized;
}

async function saveSchedulerSettings(settings = {}) {
  const normalized = {
    ingest: {
      intervalMinutes: normalizeIntervalMinutes(settings?.ingest?.intervalMinutes, 0),
      runOnStartup: normalizeBoolean(settings?.ingest?.runOnStartup, false)
    },
    livePlacement: {
      intervalMinutes: normalizeIntervalMinutes(settings?.livePlacement?.intervalMinutes, 0),
      runOnStartup: normalizeBoolean(settings?.livePlacement?.runOnStartup, false)
    }
  };

  const savedCount = await upsertDashboardSettings({
    [DASHBOARD_SETTING_KEYS.ingestIntervalMinutes]: String(normalized.ingest.intervalMinutes),
    [DASHBOARD_SETTING_KEYS.ingestRunOnStartup]: normalized.ingest.runOnStartup ? 'true' : 'false',
    [DASHBOARD_SETTING_KEYS.livePlacementIntervalMinutes]: String(normalized.livePlacement.intervalMinutes),
    [DASHBOARD_SETTING_KEYS.livePlacementRunOnStartup]: normalized.livePlacement.runOnStartup ? 'true' : 'false'
  });

  if (savedCount < 4) {
    throw new Error('SQL scheduler settings could not be saved. Verify SQL connectivity and permissions.');
  }

  return normalized;
}

function getDefaultUiSettings() {
  return {
    showSqlPreview: false
  };
}

function parseUiSettingsFromDb(dbMap = {}) {
  const defaults = getDefaultUiSettings();
  const showSqlPreview = dbMap[DASHBOARD_SETTING_KEYS.showSqlPreview];

  return {
    showSqlPreview: normalizeBoolean(showSqlPreview ? showSqlPreview.value : defaults.showSqlPreview, defaults.showSqlPreview)
  };
}

async function getEffectiveUiSettings() {
  try {
    const dbSettings = await getDashboardSettings('ui.');
    return parseUiSettingsFromDb(dbSettings);
  } catch {
    return getDefaultUiSettings();
  }
}

async function saveUiSettings(settings = {}) {
  const normalized = {
    showSqlPreview: normalizeBoolean(settings?.showSqlPreview, false)
  };

  const savedCount = await upsertDashboardSettings({
    [DASHBOARD_SETTING_KEYS.showSqlPreview]: normalized.showSqlPreview ? 'true' : 'false'
  });

  if (savedCount < 1) {
    throw new Error('SQL UI settings could not be saved. Verify SQL connectivity and permissions.');
  }

  return normalized;
}

// Trust Azure App Service's reverse proxy so req.secure is correct for HTTPS
// connections. Required for secure session cookies to work on App Service.
app.set('trust proxy', 1);

// Enforce HTTPS in production so Secure auth/session cookies are never dropped
// when a user accidentally opens the HTTP endpoint.
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production') return next();
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string' && forwardedProto.toLowerCase() !== 'https') {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  return next();
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Session — required for MSAL auth code flow state and account storage.
// In production, prefer SQL-backed sessions when SQL is configured so auth
// survives redirects and worker recycling. The required table is ensured at
// startup before the server begins accepting traffic.
function shouldUseSqlSessionStore() {
  const sqlServer = process.env.SQL_SERVER;
  const sqlDatabase = process.env.SQL_DATABASE;
  const rawSetting = String(process.env.SESSION_STORE_SQL_ENABLED || '').toLowerCase();

  if (!sqlServer || !sqlDatabase || process.env.NODE_ENV !== 'production') {
    return false;
  }

  if (rawSetting === 'false' || rawSetting === '0' || rawSetting === 'no') {
    return false;
  }

  return true;
}

function buildSessionStore() {
  const sqlServer = process.env.SQL_SERVER;
  const sqlDatabase = process.env.SQL_DATABASE;
  if (!shouldUseSqlSessionStore()) {
    return undefined; // express-session uses MemoryStore by default
  }
  try {
    const sqlConfig = {
      server: sqlServer,
      database: sqlDatabase,
      options: { encrypt: true, trustServerCertificate: false },
      authentication: {
        type: process.env.SQL_AUTH_MODE === 'managed-identity' ? 'azure-active-directory-default' : 'default',
        options: process.env.SQL_AUTH_MODE === 'managed-identity'
          ? {}
          : { userName: process.env.SQL_USER, password: process.env.SQL_PASSWORD }
      }
    };
    const storeOptions = {
      table: process.env.SESSION_STORE_SQL_TABLE || 'sessions',
      autoRemove: true,
      autoRemoveInterval: 1000 * 60 * 60
    };
    return new MSSQLStore(sqlConfig, storeOptions);
  } catch (e) {
    console.warn('[session] SQL store init failed, falling back to MemoryStore:', e.message);
    return undefined;
  }
}

function createSessionMiddleware(useConfiguredStore = false) {
  return session({
    store: useConfiguredStore ? buildSessionStore() : undefined,
    secret: process.env.SESSION_SECRET || 'dev-session-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000
    }
  });
}

async function ensureSessionStoreSchema() {
  if (!shouldUseSqlSessionStore()) {
    return;
  }

  const sessionTable = process.env.SESSION_STORE_SQL_TABLE || 'sessions';
  const pool = await getSqlPool();
  if (!pool) {
    throw new Error('SQL session store is enabled but SQL connection is not configured.');
  }

  await pool.request()
    .input('sessionTable', sessionTable)
    .query(`
      DECLARE @tableName SYSNAME = @sessionTable;
      DECLARE @schemaName SYSNAME = 'dbo';
      DECLARE @qualifiedTable NVARCHAR(258) = QUOTENAME(@schemaName) + '.' + QUOTENAME(@tableName);

      IF OBJECT_ID(@qualifiedTable, 'U') IS NULL
      BEGIN
        EXEC(N'
          CREATE TABLE ' + @qualifiedTable + '(
            [sid] NVARCHAR(255) NOT NULL PRIMARY KEY,
            [session] NVARCHAR(MAX) NOT NULL,
            [expires] DATETIME NOT NULL
          )
        ');
      END
    `);

  console.log(`[session] SQL session table ready: dbo.${sessionTable}`);
}

let activeSessionMiddleware = createSessionMiddleware(false);

app.use((req, res, next) => activeSessionMiddleware(req, res, next));

// Auth routes (/auth/login, /auth/callback, /auth/logout) — always accessible
app.use('/auth', buildAuthRouter());

// Protect all API routes with inline check — always returns 401 JSON (never
// redirects) because every path here is an API call. /api/auth/me is open so
// the frontend can check auth state before initiating a login redirect itself.
app.use('/api', (req, res, next) => {
  if (req.path === '/auth/me') return next();
  if (!AUTH_ENABLED) return next();
  if (getAccountFromSession(req)) return next();
  return res.status(401).json({ ok: false, error: 'Authentication required.' });
});

function isReactPrototypeHostAllowed(hostname = '') {
  const value = String(hostname || '').toLowerCase();
  return value.includes('localhost')
    || value.includes('127.0.0.1')
    || value.includes('-dev-')
    || value.includes('-test-')
    || value.includes('dev')
    || value.includes('test');
}

function sendReactAuthGate(res) {
  return res.status(401).type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign In Required</title>
  <style>
    body { margin: 0; font-family: Segoe UI, Arial, sans-serif; background: #f4f7fb; color: #16324f; }
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { max-width: 560px; background: #fff; border: 1px solid #d7e1ea; border-radius: 12px; padding: 32px; box-shadow: 0 10px 30px rgba(0, 44, 88, 0.08); text-align: center; }
    h1 { margin: 8px 0 12px; font-size: 28px; }
    p { margin: 0 0 16px; line-height: 1.5; color: #52667a; }
    a { display: inline-block; padding: 12px 18px; border-radius: 999px; background: #005a9c; color: #fff; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div style="letter-spacing: .12em; text-transform: uppercase; font-size: 12px; font-weight: 700; color: #005a9c;">Access Restricted</div>
      <h1>You do not have access</h1>
      <p>Sign in to use the React dashboard experience.</p>
      <a href="/auth/login">Sign In</a>
    </div>
  </div>
</body>
</html>`);
}

app.use('/react', (req, res, next) => {
  if (isReactPrototypeHostAllowed(req.hostname)) {
    return next();
  }

  return res.status(404).type('text/plain').send('React prototype is available in dev and test only.');
});

app.use('/react', (req, res, next) => {
  // React assets are served with stable filenames, so disable browser caching
  // to keep dev and test aligned immediately after a deployment.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use(express.static(path.resolve(__dirname, '..'), {
  index: false
}));

function requireIngestKey(req, res, next) {
  const expected = process.env.INGEST_API_KEY;
  if (!expected) {
    res.status(503).json({ error: 'Ingestion API key is not configured.' });
    return;
  }

  const provided = req.header('x-ingest-key') || req.query.key;
  if (provided !== expected) {
    res.status(401).json({ error: 'Invalid ingest key.' });
    return;
  }

  next();
}

function splitSqlBatches(scriptContent = '') {
  return String(scriptContent || '')
    .split(/^\s*GO\s*$/gmi)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

async function executeSqlScriptFile(pool, filePath) {
  const scriptContent = fs.readFileSync(filePath, 'utf8');
  const batches = splitSqlBatches(scriptContent);

  for (let index = 0; index < batches.length; index += 1) {
    try {
      await pool.request().batch(batches[index]);
    } catch (err) {
      throw new Error(`Failed applying ${path.basename(filePath)} batch ${index + 1}: ${err.message}`);
    }
  }

  return batches.length;
}

async function runDatabaseBootstrap() {
  return runDatabaseBootstrapWithPool();
}

async function runDatabaseBootstrapWithPool(poolOverride = null) {
  const pool = poolOverride || await getSqlPool();
  if (!pool) {
    throw new Error('SQL connection is not configured.');
  }

  const schemaPath = path.resolve(__dirname, '..', 'sql', 'schema.sql');
  const migrationsDir = path.resolve(__dirname, '..', 'sql', 'migrations');
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter((fileName) => fileName.toLowerCase().endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  const existsResult = await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID('dbo.CapacitySnapshot', 'U') IS NULL THEN 0 ELSE 1 END AS hasCapacitySnapshot
  `);
  const hasCapacitySnapshot = Boolean(existsResult.recordset?.[0]?.hasCapacitySnapshot);
  let appliedSchema = false;

  if (!hasCapacitySnapshot) {
    await executeSqlScriptFile(pool, schemaPath);
    appliedSchema = true;
  }

  for (const migrationFile of migrationFiles) {
    await executeSqlScriptFile(pool, path.resolve(migrationsDir, migrationFile));
  }

  await ensurePhase3SchemaForPool(pool);

  return {
    ok: true,
    appliedSchema,
    migrationsApplied: migrationFiles,
    phase3Ensured: true
  };
}

function normalizeDatabasePrincipalName(value, fallback = '') {
  const normalized = String(value == null ? fallback : value).trim().replace(/^[\[]|[\]]$/g, '');
  return normalized;
}

function normalizeDatabaseRoles(roles = [], { includeBootstrapRole = false } = {}) {
  const allowedRoles = new Set(['db_datareader', 'db_datawriter', 'db_ddladmin']);
  const values = Array.isArray(roles) ? roles : [roles];
  const normalized = values
    .map((role) => String(role || '').trim().toLowerCase())
    .filter((role) => allowedRoles.has(role));

  if (!normalized.includes('db_datareader')) {
    normalized.push('db_datareader');
  }

  if (!normalized.includes('db_datawriter')) {
    normalized.push('db_datawriter');
  }

  if (includeBootstrapRole && !normalized.includes('db_ddladmin')) {
    normalized.push('db_ddladmin');
  }

  return [...new Set(normalized)];
}

async function ensureDatabasePrincipalAccess(pool, principalName, roles = []) {
  const normalizedPrincipalName = normalizeDatabasePrincipalName(principalName);
  if (!normalizedPrincipalName) {
    throw new Error('Database principal name is required.');
  }

  const normalizedRoles = normalizeDatabaseRoles(roles);
  await pool.request()
    .input('principalName', sql.NVarChar(256), normalizedPrincipalName)
    .query(`
      IF NOT EXISTS (
        SELECT 1
        FROM sys.database_principals
        WHERE name = @principalName
      )
      BEGIN
        DECLARE @createUserSql NVARCHAR(4000) = N'CREATE USER ' + QUOTENAME(@principalName) + N' FROM EXTERNAL PROVIDER';
        EXEC sp_executesql @createUserSql;
      END
    `);

  for (const roleName of normalizedRoles) {
    await pool.request()
      .input('principalName', sql.NVarChar(256), normalizedPrincipalName)
      .query(`
        IF NOT EXISTS (
          SELECT 1
          FROM sys.database_role_members AS roleMembers
          INNER JOIN sys.database_principals AS rolePrincipal
            ON rolePrincipal.principal_id = roleMembers.role_principal_id
          INNER JOIN sys.database_principals AS memberPrincipal
            ON memberPrincipal.principal_id = roleMembers.member_principal_id
          WHERE rolePrincipal.name = N'${roleName}'
            AND memberPrincipal.name = @principalName
        )
        BEGIN
          DECLARE @grantRoleSql NVARCHAR(4000) = N'ALTER ROLE ${roleName} ADD MEMBER ' + QUOTENAME(@principalName);
          EXEC sp_executesql @grantRoleSql;
        END
      `);
  }

  return normalizedRoles;
}

app.get('/healthz', (_, res) => {
  res.json({ status: 'ok', service: 'capacity-dashboard-api' });
});

app.get('/api/auth/me', (req, res) => {
  const account = getAccountFromSession(req);
  const authEnabled = AUTH_ENABLED;
  const adminEnabled = !!process.env.ADMIN_GROUP_ID;
  const isAuthenticated = !authEnabled || account !== null;
  const adminAccess = !authEnabled || !adminEnabled || isAdmin(account);

  res.json({
    ok: true,
    auth: {
      authEnabled,
      isAuthenticated,
      name: account?.name || null,
      username: account?.username || null,
      userId: account?.userId || null,
      isAdmin: adminAccess,
      canAccessAdmin: adminAccess
    }
  });
});

app.get('/api/capacity', async (req, res) => {
  try {
    const rows = await getCapacityRows(getCapacityFiltersFromQuery(req.query));
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve capacity rows', detail: err.message });
  }
});

app.get('/api/capacity/export', async (req, res) => {
  try {
    const filters = getCapacityFiltersFromQuery(req.query);
    const format = normalizeCapacityExportFormat(req.query.format);
    const rows = await getCapacityRows(filters);
    const exportRows = buildCapacityExportRows(rows);
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

    if (format === 'xlsx') {
      const workbookBuffer = await buildCapacityWorkbook({ exportRows, filters });
      res.setHeader('Content-Disposition', `attachment; filename="capacity-dashboard-${timestamp}.xlsx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(Buffer.from(workbookBuffer));
    }

    const csv = buildCapacityCsv(exportRows);
    res.setHeader('Content-Disposition', `attachment; filename="capacity-dashboard-${timestamp}.csv"`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(csv);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to export capacity rows', detail: err.message });
  }
});

/**
 * Optimized capacity endpoint with pagination and DTO projection
 * Reduces payload size by ~65% compared to /api/capacity
 * Supports: pageNumber, pageSize (default 100, max 500)
 * Example: GET /api/capacity/paged?pageNumber=1&pageSize=50&region=eastus
 */
app.get('/api/capacity/paged', async (req, res) => {
  try {
    const result = await getCapacityRowsPaginated({
      regionPreset: req.query.regionPreset,
      subscriptionIds: req.query.subscriptionIds,
      region: req.query.region,
      family: req.query.family,
      availability: req.query.availability,
      resourceType: req.query.resourceType,
      pageNumber: req.query.pageNumber,
      pageSize: req.query.pageSize
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve paginated capacity data', detail: err.message });
  }
});

app.get('/api/quota/groups', requireAdmin, async (_, res) => {
  try {
    const result = await listQuotaGroups(_.query.managementGroupId);
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.message.includes('QUOTA_MANAGEMENT_GROUP_ID') ? 503 : 500;
    res.status(status).json({ ok: false, error: err.message, groups: [] });
  }
});

app.get('/api/quota/management-groups', requireAdmin, async (_, res) => {
  try {
    const groups = await listManagementGroups();
    res.json({ ok: true, groups, defaultManagementGroupId: process.env.QUOTA_MANAGEMENT_GROUP_ID || null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, groups: [] });
  }
});

app.get('/api/quota/candidates', requireAdmin, async (req, res) => {
  try {
    const result = await getQuotaCandidates({
      managementGroupId: req.query.managementGroupId,
      groupQuotaName: req.query.groupQuotaName,
      regionPreset: req.query.regionPreset,
      region: req.query.region,
      family: req.query.family
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.message.includes('required') ? 400 : 500;
    res.status(status).json({ ok: false, error: err.message, candidates: [] });
  }
});

app.post('/api/quota/candidates/capture', requireAdmin, async (req, res) => {
  try {
    const result = await captureQuotaCandidateSnapshots({
      managementGroupId: req.body?.managementGroupId,
      groupQuotaName: req.body?.groupQuotaName,
      regionPreset: req.body?.regionPreset,
      region: req.body?.region,
      family: req.body?.family
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.message.includes('required') ? 400 : 500;
    res.status(status).json({ ok: false, error: err.message });
  }
});

app.get('/api/quota/candidate-runs', requireAdmin, async (req, res) => {
  try {
    const result = await getQuotaCandidateRunHistory({
      managementGroupId: req.query.managementGroupId,
      groupQuotaName: req.query.groupQuotaName,
      region: req.query.region,
      family: req.query.family
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.message.includes('required') ? 400 : 500;
    res.status(status).json({ ok: false, error: err.message, runs: [] });
  }
});

app.get('/api/quota/plan', requireAdmin, async (req, res) => {
  try {
    const result = await buildQuotaMovePlan({
      managementGroupId: req.query.managementGroupId,
      groupQuotaName: req.query.groupQuotaName,
      analysisRunId: req.query.analysisRunId,
      donorSubscriptionId: req.query.donorSubscriptionId,
      recipientSubscriptionId: req.query.recipientSubscriptionId,
      selectedSku: req.query.selectedSku,
      transferAmount: req.query.transferAmount,
      region: req.query.region,
      family: req.query.family
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.message.includes('required') || err.message.includes('Run Capture History first') ? 400 : 500;
    res.status(status).json({ ok: false, error: err.message, planRows: [] });
  }
});

app.post('/api/quota/simulate', requireAdmin, async (req, res) => {
  try {
    const result = await simulateQuotaMovePlan({
      managementGroupId: req.body?.managementGroupId,
      groupQuotaName: req.body?.groupQuotaName,
      analysisRunId: req.body?.analysisRunId,
      donorSubscriptionId: req.body?.donorSubscriptionId,
      recipientSubscriptionId: req.body?.recipientSubscriptionId,
      selectedSku: req.body?.selectedSku,
      transferAmount: req.body?.transferAmount,
      region: req.body?.region,
      family: req.body?.family
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.message.includes('required') || err.message.includes('Run Capture History first') ? 400 : 500;
    res.status(status).json({ ok: false, error: err.message, impactRows: [] });
  }
});

app.post('/api/quota/apply', requireAdmin, async (req, res) => {
  const filters = buildQuotaApplyFilters(req.body);

  if (req.body?.async === true) {
    const job = queueQuotaApplyJob(filters);
    res.json(serializeQuotaApplyJob(job));
    return;
  }

  try {
    const result = await applyQuotaMovePlan(filters);
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.message.includes('required') || err.message.includes('Build a plan first') || err.message.includes('No plan rows') ? 400 : 500;
    res.status(status).json({ ok: false, error: err.message, applyResults: [] });
  }
});

app.get('/api/quota/apply/jobs/:jobId', requireAdmin, (req, res) => {
  cleanupQuotaApplyJobs();
  const job = quotaApplyJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ ok: false, error: 'Quota apply job was not found or has expired.' });
    return;
  }

  res.json(serializeQuotaApplyJob(job));
});

app.get('/api/subscriptions', async (req, res) => {
  try {
    const rows = await getSubscriptions({
      search: req.query.search,
      limit: req.query.limit
    });
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve subscriptions', detail: err.message });
  }
});

app.get('/api/capacity/subscriptions', async (req, res) => {
  try {
    const rows = await getSubscriptionSummary({
      regionPreset: req.query.regionPreset,
      subscriptionIds: req.query.subscriptionIds,
      region: req.query.region,
      family: req.query.family,
      availability: req.query.availability
    });
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve subscription summary', detail: err.message });
  }
});

app.get('/api/admin/sql-preview', requireAdmin, async (req, res) => {
  try {
    const rows = buildSqlPreviewForView(req.query.view, {
      pageNumber: req.query.pageNumber,
      pageSize: req.query.pageSize,
      days: req.query.days,
      desiredCount: req.query.desiredCount,
      regionPreset: req.query.regionPreset,
      subscriptionIds: req.query.subscriptionIds,
      region: req.query.region,
      family: req.query.family,
      quotaName: req.query.quotaName,
      availability: req.query.availability,
      resourceType: req.query.resourceType,
      managementGroupId: req.query.managementGroupId,
      groupQuotaName: req.query.groupQuotaName,
      analysisRunId: req.query.analysisRunId
    });
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to build SQL preview', detail: err.message });
  }
});

app.get('/api/capacity/trends', async (req, res) => {
  try {
    const rows = await getCapacityTrends({
      days: req.query.days,
      regionPreset: req.query.regionPreset,
      subscriptionIds: req.query.subscriptionIds,
      region: req.query.region,
      family: req.query.family,
      availability: req.query.availability,
      resourceType: req.query.resourceType
    });
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve capacity trends', detail: err.message });
  }
});

app.get('/api/capacity/families', async (req, res) => {
  try {
    const rows = await getFamilySummary({
      regionPreset: req.query.regionPreset,
      subscriptionIds: req.query.subscriptionIds,
      region: req.query.region,
      family: req.query.family,
      availability: req.query.availability
    });
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve family summary', detail: err.message });
  }
});

app.get('/api/capacity/scores', async (req, res) => {
  try {
    const pageNumber = Number(req.query.pageNumber || 1);
    const pageSize = Number(req.query.pageSize || 50);
    
    const payload = await getCapacityScoreSummaryPaginated({
      regionPreset: req.query.regionPreset,
      subscriptionIds: req.query.subscriptionIds,
      region: req.query.region,
      family: req.query.family,
      availability: req.query.availability,
      desiredCount: req.query.desiredCount
    }, pageNumber, pageSize);
    
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve capacity score summary', detail: err.message });
  }
});

app.get('/api/capacity/scores/history', async (req, res) => {
  try {
    const rows = await getCapacityScoreSnapshotHistory({
      days: req.query.days,
      region: req.query.region,
      family: req.query.family,
      sku: req.query.sku,
      score: req.query.score
    });
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve capacity score history', detail: err.message });
  }
});

app.post('/api/capacity/scores/live', async (req, res) => {
  try {
    const result = await getLivePlacementScoreRows({
      regionPreset: req.body?.regionPreset,
      subscriptionIds: req.body?.subscriptionIds,
      region: req.body?.region,
      family: req.body?.family,
      availability: req.body?.availability,
      desiredCount: req.body?.desiredCount,
      extraSkus: req.body?.extraSkus
    });
    res.json(result);
  } catch (err) {
    const status = err.statusCode
      || (err.message.includes('not found') || err.message.includes('not configured') ? 503 : 500);
    res.status(status).json({ error: 'Failed to retrieve live placement scores', detail: err.message, rows: [], diagnostics: err.details || null });
  }
});

app.post('/api/capacity/recommendations', async (req, res) => {
  try {
    const result = await getCapacityRecommendations({
      targetSku: req.body?.targetSku,
      regions: req.body?.regions,
      regionPreset: req.body?.regionPreset,
      topN: req.body?.topN,
      minScore: req.body?.minScore,
      showPricing: req.body?.showPricing,
      showSpot: req.body?.showSpot
    });
    res.json({ ok: true, result });
  } catch (err) {
    const status = err.message.includes('not found') || err.message.includes('not configured') ? 503 : 500;
    const diagnostics = getRecommendationDiagnostics();
    res.status(status).json({ ok: false, error: 'Failed to retrieve capacity recommendations', detail: err.message, diagnostics });
  }
});

app.get('/api/admin/recommendations/diagnostics', requireAdmin, (req, res) => {
  try {
    const diagnostics = getRecommendationDiagnostics();
    res.json({ ok: true, diagnostics });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Failed to retrieve diagnostics', detail: err.message });
  }
});

app.post('/api/admin/ingest/capacity', requireAdmin, async (req, res) => {
  const activeJob = getActiveIngestionJob();
  if (activeJob) {
    res.json({ ...serializeIngestionJob(activeJob), statusSnapshot: getIngestionStatus() });
    return;
  }

  if (getIngestionStatus().inProgress) {
    res.status(409).json({ ok: false, error: 'Capacity ingestion is already running.', status: getIngestionStatus() });
    return;
  }

  const job = queueCapacityIngestionJob(buildCapacityIngestionOptions(req.body));
  res.status(202).json({ ...serializeIngestionJob(job), statusSnapshot: getIngestionStatus() });
});

app.get('/api/admin/ingest/status', requireAdmin, (_, res) => {
  const activeJob = getActiveIngestionJob();
  res.json({ ok: true, status: getIngestionStatus(), activeJob: activeJob ? serializeIngestionJob(activeJob) : null });
});

app.get('/api/admin/ingest/jobs/:jobId', requireAdmin, (req, res) => {
  cleanupIngestionJobs();
  const job = ingestionJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ ok: false, error: 'Capacity ingestion job was not found or has expired.' });
    return;
  }

  res.json(serializeIngestionJob(job));
});

app.get('/api/admin/ingest/schedule', requireAdmin, async (_, res) => {
  try {
    const persisted = await getEffectiveSchedulerSettings();
    const persistence = await getDashboardSettingsPersistence();
    const runtime = {
      ingest: getIngestionSchedulerConfig(),
      livePlacement: getLivePlacementSchedulerConfig()
    };

    res.json({ ok: true, settings: persisted, runtime, persistence });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Failed to load scheduler settings.' });
  }
});

app.get('/api/admin/ui-settings', requireAdmin, async (_, res) => {
  try {
    const settings = await getEffectiveUiSettings();
    res.json({ ok: true, settings });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Failed to load UI settings.' });
  }
});

app.put('/api/admin/ui-settings', requireAdmin, async (req, res) => {
  try {
    const settings = await saveUiSettings({
      showSqlPreview: req.body?.showSqlPreview
    });
    res.json({ ok: true, settings });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Failed to save UI settings.' });
  }
});

app.put('/api/admin/ingest/schedule', requireAdmin, async (req, res) => {
  try {
    const persistence = await getDashboardSettingsPersistence();
    if (!persistence.available) {
      return res.status(409).json({
        ok: false,
        error: `${persistence.message} Runtime schedule remains available, but SQL-backed persistence cannot be updated from the UI.`,
        runtime: {
          ingest: getIngestionSchedulerConfig(),
          livePlacement: getLivePlacementSchedulerConfig()
        },
        persistence
      });
    }

    const candidate = {
      ingest: {
        intervalMinutes: req.body?.ingest?.intervalMinutes,
        runOnStartup: req.body?.ingest?.runOnStartup
      },
      livePlacement: {
        intervalMinutes: req.body?.livePlacement?.intervalMinutes,
        runOnStartup: req.body?.livePlacement?.runOnStartup
      }
    };

    const savedSettings = await saveSchedulerSettings(candidate);
    const runtime = applyRuntimeSchedulerSettings(savedSettings);

    res.json({ ok: true, settings: savedSettings, runtime, persistence });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Failed to save scheduler settings.' });
  }
});

app.post('/api/admin/errors/log', async (req, res) => {
  try {
    const entry = {
      source: req.body?.source || 'unknown',
      type: req.body?.type || 'UnknownError',
      message: req.body?.message || 'No error message',
      stack: req.body?.stack || null,
      severity: req.body?.severity || 'error',
      context: req.body?.context || null,
      region: req.body?.region || null,
      sku: req.body?.sku || null,
      desiredCount: req.body?.desiredCount || null,
      occurredAtUtc: new Date()
    };

    const result = await insertDashboardErrorLog(entry);
    res.json({ ok: true, logged: result > 0 });
  } catch (err) {
    // Log to console but return success so client doesn't break
    console.error('Failed to log error entry:', err.message);
    res.json({ ok: false, logged: false, error: err.message });
  }
});

app.get('/api/admin/errors', requireAdmin, async (req, res) => {
  try {
    const options = {
      limit: req.query.limit ? Math.min(Number(req.query.limit), 200) : 50,
      onlyUnresolved: req.query.unresolved === 'true',
      source: req.query.source || null,
      severity: req.query.severity || null,
      hoursBack: req.query.hoursBack ? Math.min(Number(req.query.hoursBack), 24 * 365) : 168
    };

    const logs = await listDashboardErrorLogs(options);
    res.json({ ok: true, rows: logs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/admin/operations/log', async (req, res) => {
  try {
    const entry = {
      type: req.body?.type || 'unknown',
      name: req.body?.name || req.body?.type || 'Unknown',
      status: req.body?.status || 'success',
      triggerSource: req.body?.triggerSource || 'manual',
      startedAtUtc: req.body?.startedAtUtc || new Date(),
      completedAtUtc: req.body?.completedAtUtc || new Date(),
      durationMs: req.body?.durationMs || null,
      rowsAffected: req.body?.rowsAffected || null,
      subscriptionCount: req.body?.subscriptionCount || null,
      requestedDesiredCount: req.body?.requestedDesiredCount || null,
      effectiveDesiredCount: req.body?.effectiveDesiredCount || null,
      regionPreset: req.body?.regionPreset || null,
      note: req.body?.note || null,
      errorMessage: req.body?.errorMessage || null
    };

    const result = await logDashboardOperation(entry);
    res.json({ ok: true, logged: result > 0 });
  } catch (err) {
    console.error('Failed to log operation:', err.message);
    res.json({ ok: false, logged: false, error: err.message });
  }
});

app.get('/api/admin/operations', requireAdmin, async (req, res) => {
  try {
    const options = {
      limit: req.query.limit ? Math.min(Number(req.query.limit), 100) : 25,
      operationType: req.query.type || null,
      onlyFailed: req.query.failed === 'true'
    };

    const logs = await listDashboardOperations(options);
    res.json({ ok: true, rows: logs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/internal/ingest/capacity', requireIngestKey, async (req, res) => {
  try {
    const result = await runCapacityIngestion({
      regionPreset: req.body?.regionPreset,
      regions: req.body?.regions,
      subscriptionIds: req.body?.subscriptionIds,
      familyFilters: req.body?.familyFilters
    });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/internal/ingest/status', requireIngestKey, (req, res) => {
  res.json({ ok: true, status: getIngestionStatus() });
});

app.post('/internal/db/ensure-phase3-schema', requireIngestKey, async (_, res) => {
  try {
    const result = await ensurePhase3Schema();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/internal/db/bootstrap', requireIngestKey, async (_, res) => {
  try {
    const result = await runDatabaseBootstrap();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/internal/db/bootstrap-admin', requireIngestKey, async (req, res) => {
  const sqlAccessToken = String(req.body?.sqlAccessToken || '').trim();
  const appIdentityName = normalizeDatabasePrincipalName(req.body?.appIdentityName, process.env.WEBSITE_SITE_NAME || '');
  const runtimeRoles = normalizeDatabaseRoles(req.body?.runtimeRoles, {
    includeBootstrapRole: normalizeBoolean(req.body?.grantBootstrapRole, false)
  });

  if (!sqlAccessToken) {
    return res.status(400).json({ ok: false, error: 'sqlAccessToken is required.' });
  }

  if (!appIdentityName) {
    return res.status(400).json({ ok: false, error: 'appIdentityName is required.' });
  }

  let adminPool;
  try {
    adminPool = await createSqlPoolWithAccessToken(sqlAccessToken);
    const bootstrapResult = await runDatabaseBootstrapWithPool(adminPool);
    const grantedRoles = await ensureDatabasePrincipalAccess(adminPool, appIdentityName, runtimeRoles);

    res.json({
      ...bootstrapResult,
      ok: true,
      usedAdminAccessToken: true,
      appIdentityName,
      grantedRoles
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (adminPool) {
      adminPool.close().catch(() => {});
    }
  }
});

app.get('/react', (req, res) => {
  if (AUTH_ENABLED && !getAccountFromSession(req)) {
    return sendReactAuthGate(res);
  }

  res.sendFile(path.resolve(__dirname, '..', 'react', 'index.html'));
});

app.get('/react/*', (req, res, next) => {
  if (path.extname(req.path)) {
    return next();
  }

  if (AUTH_ENABLED && !getAccountFromSession(req)) {
    return sendReactAuthGate(res);
  }

  return res.sendFile(path.resolve(__dirname, '..', 'react', 'index.html'));
});

app.get('*', (_, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'index.html'));
});

async function startServer() {
  try {
    await ensureSessionStoreSchema();
    if (shouldUseSqlSessionStore()) {
      activeSessionMiddleware = createSessionMiddleware(true);
      console.log('[session] SQL session store enabled');
    }
  } catch (err) {
    console.warn('⚠ Session store schema setup failed, continuing with current session configuration:', err.message);
  }

  try {
    await ensurePhase3Schema();
    console.log('[schema] Phase-3 dashboard schema ready');
  } catch (err) {
    console.warn('⚠ Dashboard schema setup failed, continuing with existing SQL objects:', err.message);
  }

  app.listen(port, () => {
    getEffectiveSchedulerSettings()
      .then((settings) => {
        startIngestionScheduler(settings.ingest);
        startLivePlacementScheduler(settings.livePlacement);
      })
      .catch((err) => {
        console.warn('⚠ Failed to load DB scheduler settings; falling back to environment defaults:', err.message);
        startIngestionScheduler();
        startLivePlacementScheduler();
      });

    // Apply performance indexes on startup (idempotent - safe to run multiple times)
    if (process.env.SQL_SERVER) {
      applyIndexes().then(success => {
        if (success) {
          console.log('✓ Performance indexes verified/created');
        } else {
          console.warn('⚠ Could not apply performance indexes - will retry on next startup');
        }
      }).catch(err => {
        console.warn('⚠ Performance index setup failed (non-blocking):', err.message);
      });
    }

    console.log(`Capacity dashboard listening on port ${port}`);
  });
}

startServer();
