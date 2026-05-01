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
  getCapacityAnalyticsSummary,
  getSubscriptions,
  getSubscriptionSummary,
  getCapacityTrends,
  getFamilySummary,
  getCapacityScoreSummary,
  getCapacityScoreSummaryPaginated,
  getSkuFamilyCatalog
} = require('./services/capacityService');
const { buildSqlPreviewForView } = require('./services/sqlPreviewService');
const {
  getLivePlacementScoreRows,
  getCapacityRecommendations,
  getRecommendationDiagnostics,
  startLivePlacementScheduler,
  updateLivePlacementScheduler,
  getLivePlacementSchedulerConfig,
  seedVmSkuCatalogIfEmpty
} = require('./services/livePlacementService');
const {
  runPaaSAvailabilityScan,
  getPaaSAvailabilitySnapshot,
  getPaaSPowerShellProbe
} = require('./services/paasAvailabilityService');
const { getQuotaCandidates, captureQuotaCandidateSnapshots } = require('./services/quotaCandidateService');
const { buildQuotaMovePlan, getQuotaCandidateRunHistory, simulateQuotaMovePlan } = require('./services/quotaPlanService');
const { applyQuotaMovePlan } = require('./services/quotaApplyService');
const {
  runCapacityIngestion,
  refreshModelCatalog,
  getIngestionStatus,
  startIngestionScheduler,
  updateIngestionScheduler,
  getIngestionSchedulerConfig
} = require('./services/azureIngestionService');
const { listManagementGroups, listQuotaGroups, listQuotaGroupShareableQuota } = require('./services/quotaDiscoveryService');
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
const { getAIQuotaProviderFromSnapshot, isAIQuotaSourceType } = require('./services/aiIngestionService');

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
  aiModelCatalogIntervalMinutes: 'schedule.aiModelCatalog.intervalMinutes',
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

function normalizeSqlIdentifierSegment(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).replace(/]]/g, ']');
  }

  return trimmed;
}

function getQuotedQualifiedSqlName(objectName, defaultSchema = 'dbo') {
  const parts = String(objectName || '')
    .split('.')
    .map((part) => normalizeSqlIdentifierSegment(part))
    .filter(Boolean);

  if (parts.length === 1) {
    const objectPart = parts[0];
    return `[${defaultSchema.replace(/]/g, ']]')}].[${objectPart.replace(/]/g, ']]')}]`;
  }

  if (parts.length === 2) {
    return `[${parts[0].replace(/]/g, ']]')}].[${parts[1].replace(/]/g, ']]')}]`;
  }

  return null;
}

function isSqlObjectMissingError(err) {
  const errorNumber = Number(err?.number);
  const message = String(err?.message || '').toLowerCase();
  return errorNumber === 208 || message.includes('invalid object name');
}

function isSqlSelectPermissionError(err) {
  const errorNumber = Number(err?.number);
  const message = String(err?.message || '').toLowerCase();
  return errorNumber === 229
    || message.includes('the select permission was denied')
    || message.includes('permission denied in database');
}

function isSqlSchemaPermissionError(err) {
  const errorNumber = Number(err?.number);
  const message = String(err?.message || '').toLowerCase();
  return errorNumber === 229
    || message.includes('create table permission denied')
    || message.includes('alter table permission denied')
    || message.includes('create index permission denied')
    || message.includes('cannot alter the view')
    || message.includes('permission denied in database');
}

async function sqlTableExistsForBootstrap(pool, objectName) {
  const qualifiedName = getQuotedQualifiedSqlName(objectName);
  if (!qualifiedName) {
    const result = await pool.request()
      .input('objectName', sql.NVarChar(256), objectName)
      .query(`
        SELECT CASE WHEN OBJECT_ID(@objectName, 'U') IS NULL THEN 0 ELSE 1 END AS existsFlag
      `);

    return Boolean(result.recordset?.[0]?.existsFlag);
  }

  try {
    await pool.request().query(`SELECT TOP (0) 1 AS bootstrapProbe FROM ${qualifiedName};`);
    return true;
  } catch (err) {
    if (isSqlObjectMissingError(err)) {
      return false;
    }

    if (isSqlSelectPermissionError(err)) {
      return true;
    }

    throw err;
  }
}

async function sqlObjectExists(pool, objectName, objectTypes = ['U']) {
  const checks = objectTypes
    .map((objectType) => `OBJECT_ID(@objectName, '${String(objectType).replace(/'/g, "''")}') IS NOT NULL`)
    .join(' OR ');

  const result = await pool.request()
    .input('objectName', sql.NVarChar(256), objectName)
    .query(`
      SELECT CASE WHEN ${checks} THEN 1 ELSE 0 END AS existsFlag
    `);

  return Boolean(result.recordset?.[0]?.existsFlag);
}

async function getSqlObjectRowCount(pool, objectName, objectTypes = ['U']) {
  if (!(await sqlObjectExists(pool, objectName, objectTypes))) {
    return null;
  }

  const result = await pool.request().query(`SELECT COUNT(1) AS rowCount FROM ${objectName}`);
  return Number(result.recordset?.[0]?.rowCount || 0);
}

async function getSqlObjectLatestCapture(pool, objectName, objectTypes = ['U'], columnName = 'capturedAtUtc') {
  if (!(await sqlObjectExists(pool, objectName, objectTypes))) {
    return null;
  }

  const result = await pool.request().query(`SELECT MAX(${columnName}) AS latestCapture FROM ${objectName}`);
  return result.recordset?.[0]?.latestCapture || null;
}

async function sqlColumnExists(pool, objectName, columnName) {
  const result = await pool.request()
    .input('objectName', sql.NVarChar(256), objectName)
    .input('columnName', sql.NVarChar(128), columnName)
    .query(`
      SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM sys.columns
        WHERE object_id = OBJECT_ID(@objectName)
          AND name = @columnName
      ) THEN 1 ELSE 0 END AS existsFlag
    `);

  return Boolean(result.recordset?.[0]?.existsFlag);
}

async function getAIModelAvailabilitySource(pool) {
  const latestViewName = 'dbo.AIModelAvailabilityLatest';
  if (await sqlObjectExists(pool, latestViewName, ['V'])) {
    return {
      objectName: latestViewName,
      hasProviderColumn: await sqlColumnExists(pool, latestViewName, 'provider')
    };
  }
  const tableName = 'dbo.AIModelAvailability';
  if (await sqlObjectExists(pool, tableName, ['U'])) {
    return {
      objectName: tableName,
      hasProviderColumn: await sqlColumnExists(pool, tableName, 'provider')
    };
  }

  return null;
}

function mapAIQuotaResponseRow(row) {
  return {
    ...row,
    provider: getAIQuotaProviderFromSnapshot(row),
    quotaAvailable: Number(row?.quotaLimit || 0) - Number(row?.quotaCurrent || 0)
  };
}

function truncateText(value, maxLength, fallback = null) {
  if (value == null) {
    return fallback;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, maxLength);
}

function normalizeInteger(value, { min = null, max = null, fallback = null } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  let normalized = Math.trunc(numeric);
  if (Number.isFinite(min)) {
    normalized = Math.max(min, normalized);
  }
  if (Number.isFinite(max)) {
    normalized = Math.min(max, normalized);
  }
  return normalized;
}

function normalizeJsonContext(value, maxLength = 4096) {
  if (value == null) {
    return null;
  }

  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      return null;
    }
    if (serialized.length <= maxLength) {
      return JSON.parse(serialized);
    }
    return {
      truncated: true,
      preview: serialized.slice(0, maxLength)
    };
  } catch {
    const preview = truncateText(value, maxLength, null);
    return preview ? { truncated: true, preview } : null;
  }
}

function normalizeErrorSeverity(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['error', 'warn', 'info'].includes(normalized) ? normalized : 'error';
}

function normalizeOperationStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['queued', 'running', 'success', 'failed', 'info'].includes(normalized) ? normalized : 'success';
}

function normalizeErrorLogEntry(body = {}) {
  return {
    source: truncateText(body.source, 64, 'unknown'),
    type: truncateText(body.type, 128, 'UnknownError'),
    message: truncateText(body.message, 2048, 'No error message'),
    stack: truncateText(body.stack, 8192, null),
    severity: normalizeErrorSeverity(body.severity),
    context: normalizeJsonContext(body.context),
    region: truncateText(body.region, 64, null),
    sku: truncateText(body.sku, 128, null),
    desiredCount: normalizeInteger(body.desiredCount, { min: 0, max: 100000, fallback: null }),
    occurredAtUtc: new Date()
  };
}

function normalizeOperationLogEntry(body = {}) {
  return {
    type: truncateText(body.type, 64, 'unknown'),
    name: truncateText(body.name || body.type, 128, 'Unknown'),
    status: normalizeOperationStatus(body.status),
    triggerSource: truncateText(body.triggerSource, 32, 'manual'),
    startedAtUtc: body.startedAtUtc || new Date(),
    completedAtUtc: body.completedAtUtc || new Date(),
    durationMs: normalizeInteger(body.durationMs, { min: 0, max: 7 * 24 * 60 * 60 * 1000, fallback: null }),
    rowsAffected: normalizeInteger(body.rowsAffected, { min: 0, max: 100000000, fallback: null }),
    subscriptionCount: normalizeInteger(body.subscriptionCount, { min: 0, max: 1000000, fallback: null }),
    requestedDesiredCount: normalizeInteger(body.requestedDesiredCount, { min: 0, max: 100000, fallback: null }),
    effectiveDesiredCount: normalizeInteger(body.effectiveDesiredCount, { min: 0, max: 100000, fallback: null }),
    regionPreset: truncateText(body.regionPreset, 64, null),
    note: truncateText(body.note, 512, null),
    errorMessage: truncateText(body.errorMessage, 2048, null)
  };
}

function sendErrorResponse(res, {
  status = 500,
  clientMessage = 'Request failed.',
  err = null,
  scope = 'request',
  exposeMessage = false,
  extra = {}
} = {}) {
  const requestId = randomUUID();
  if (err) {
    console.error(`[${scope}] [${requestId}]`, err);
  }

  const payload = {
    ok: false,
    error: exposeMessage && err && err.message ? String(err.message) : clientMessage,
    requestId,
    ...extra
  };

  return res.status(status).json(payload);
}

async function runDiagnosticCheck(name, fn, { timeoutMs = 0 } = {}) {
  let timeoutHandle = null;

  try {
    const pendingValue = Promise.resolve().then(fn);
    const value = timeoutMs > 0
      ? await Promise.race([
        pendingValue,
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
        })
      ])
      : await pendingValue;

    return { name, ok: true, value };
  } catch (err) {
    return {
      name,
      ok: false,
      error: err?.message || String(err)
    };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function getFirstQueryValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : undefined;
  }

  return value;
}

function getCapacityFiltersFromQuery(query = {}) {
  return {
    regionPreset: getFirstQueryValue(query.regionPreset),
    subscriptionIds: query.subscriptionIds,
    region: getFirstQueryValue(query.region),
    family: getFirstQueryValue(query.family),
    familyBase: getFirstQueryValue(query.familyBase),
    sku: getFirstQueryValue(query.sku),
    availability: getFirstQueryValue(query.availability),
    resourceType: getFirstQueryValue(query.resourceType),
    pageNumber: getFirstQueryValue(query.pageNumber),
    pageSize: getFirstQueryValue(query.pageSize)
  };
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
    managementGroupNames: body.managementGroupNames,
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
    regionPreset: getFirstQueryValue(query.regionPreset),
    subscriptionIds: query.subscriptionIds,
    region: getFirstQueryValue(query.region),
    family: getFirstQueryValue(query.family),
    familyBase: getFirstQueryValue(query.familyBase),
    sku: getFirstQueryValue(query.sku),
    availability: getFirstQueryValue(query.availability),
    resourceType: getFirstQueryValue(query.resourceType),
    provider: getFirstQueryValue(query.provider),
    pageNumber: getFirstQueryValue(query.pageNumber),
    pageSize: getFirstQueryValue(query.pageSize)
  };
}

function normalizeCapacityExportFormat(rawFormat) {
  return String(rawFormat || 'csv').trim().toLowerCase() === 'xlsx' ? 'xlsx' : 'csv';
}

function normalizeCapacityExportVariant(rawVariant) {
  return String(rawVariant || 'grid').trim().toLowerCase() === 'report' ? 'report' : 'grid';
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
      provider: row.provider || '',
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
    { metric: 'Provider Filter', value: filters.provider || 'all' },
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
    'provider',
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
  return buildCapacityGridWorkbook({ exportRows, filters });
}

function applyWorksheetBorders(worksheet) {
  if (!worksheet.rowCount || !worksheet.columnCount) {
    return;
  }

  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD1D1D1' } },
        left: { style: 'thin', color: { argb: 'FFD1D1D1' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D1D1' } },
        right: { style: 'thin', color: { argb: 'FFD1D1D1' } }
      };
    });
  }
}

function applyAlternatingWorksheetRows(worksheet, startRow = 2, endRow = worksheet.rowCount) {
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    if (rowNumber % 2 !== 0) {
      continue;
    }
    worksheet.getRow(rowNumber).eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF8F9FB' }
      };
    });
  }
}

function styleWorksheetTitle(worksheet, title, subtitle = '') {
  worksheet.mergeCells('A1:H1');
  worksheet.getCell('A1').value = title;
  worksheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF0B1F33' } };
  worksheet.getCell('A1').alignment = { vertical: 'middle' };

  if (subtitle) {
    worksheet.mergeCells('A2:H2');
    worksheet.getCell('A2').value = subtitle;
    worksheet.getCell('A2').font = { italic: true, color: { argb: 'FF5B6B7A' } };
  }
}

function buildCapacityRegionSummaryRows(exportRows = []) {
  const byRegion = new Map();
  exportRows.forEach((row) => {
    const region = row.region || 'n/a';
    const current = byRegion.get(region) || {
      region,
      rows: 0,
      families: new Set(),
      subscriptions: new Set(),
      quotaAvailable: 0,
      limitedRows: 0,
      constrainedRows: 0,
      okRows: 0
    };
    current.rows += 1;
    current.families.add(row.family || '');
    current.subscriptions.add(row.subscriptionId || '');
    current.quotaAvailable += Number(row.quotaAvailable || 0);
    if (row.availability === 'OK') current.okRows += 1;
    if (row.availability === 'LIMITED') current.limitedRows += 1;
    if (row.availability === 'CONSTRAINED' || row.availability === 'RESTRICTED') current.constrainedRows += 1;
    byRegion.set(region, current);
  });

  return [...byRegion.values()]
    .map((entry) => ({
      region: entry.region,
      rows: entry.rows,
      families: entry.families.size,
      subscriptions: entry.subscriptions.size,
      quotaAvailable: entry.quotaAvailable,
      okRows: entry.okRows,
      limitedRows: entry.limitedRows,
      constrainedRows: entry.constrainedRows
    }))
    .sort((left, right) => left.region.localeCompare(right.region));
}

function buildCapacityFamilySummaryRows(exportRows = []) {
  const byFamily = new Map();
  exportRows.forEach((row) => {
    const family = row.family || 'n/a';
    const current = byFamily.get(family) || {
      family,
      rows: 0,
      regions: new Set(),
      skus: new Set(),
      quotaAvailable: 0,
      okRows: 0,
      limitedRows: 0,
      constrainedRows: 0
    };
    current.rows += 1;
    current.regions.add(row.region || '');
    current.skus.add(row.sku || '');
    current.quotaAvailable += Number(row.quotaAvailable || 0);
    if (row.availability === 'OK') current.okRows += 1;
    if (row.availability === 'LIMITED') current.limitedRows += 1;
    if (row.availability === 'CONSTRAINED' || row.availability === 'RESTRICTED') current.constrainedRows += 1;
    byFamily.set(family, current);
  });

  return [...byFamily.values()]
    .map((entry) => ({
      family: entry.family,
      rows: entry.rows,
      regions: entry.regions.size,
      skus: entry.skus.size,
      quotaAvailable: entry.quotaAvailable,
      okRows: entry.okRows,
      limitedRows: entry.limitedRows,
      constrainedRows: entry.constrainedRows
    }))
    .sort((left, right) => left.family.localeCompare(right.family));
}

async function buildCapacityGridWorkbook({ exportRows, filters }) {
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
    { header: 'Provider', key: 'provider', width: 18 },
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
  detailSheet.autoFilter = 'A1:P1';

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

async function buildCapacityReportWorkbook({ exportRows, filters }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Capacity Dashboard';
  workbook.created = new Date();
  workbook.modified = new Date();

  const summaryRows = buildCapacityExportSummary(exportRows, filters);
  const regionSummaryRows = buildCapacityRegionSummaryRows(exportRows);
  const familySummaryRows = buildCapacityFamilySummaryRows(exportRows);

  const summarySheet = workbook.addWorksheet('Report Summary', { views: [{ state: 'frozen', ySplit: 6 }] });
  styleWorksheetTitle(summarySheet, 'Capacity Dashboard Report', 'This workbook reflects the current sidebar filter scope from the Capacity Grid export action.');

  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 32 },
    { header: 'Value', key: 'value', width: 48 }
  ];

  const filterText = [
    `Region preset: ${filters.regionPreset || 'all'}`,
    `Region: ${filters.region || 'all'}`,
    `Resource type: ${filters.resourceType || 'all'}`,
    `Family base: ${filters.familyBase || 'all'}`,
    `Family: ${filters.family || 'all'}`,
    `Availability: ${filters.availability || 'all'}`
  ].join(' | ');
  summarySheet.getCell('A4').value = 'Active filter scope';
  summarySheet.getCell('A4').font = { bold: true, color: { argb: 'FF0B1F33' } };
  summarySheet.getCell('B4').value = filterText;

  summarySheet.getRow(6).values = ['Metric', 'Value'];
  styleWorksheetHeader(summarySheet, 2);
  summaryRows.forEach((row) => summarySheet.addRow(row));
  applyAlternatingWorksheetRows(summarySheet, 7, 6 + summaryRows.length);
  applyWorksheetBorders(summarySheet);

  const legendStartRow = summarySheet.rowCount + 3;
  summarySheet.getCell(`A${legendStartRow}`).value = 'Status Legend';
  summarySheet.getCell(`A${legendStartRow}`).font = { bold: true, color: { argb: 'FF0B1F33' } };
  const legendRows = Object.entries(CAPACITY_EXPORT_STATUS_META)
    .filter(([status]) => status !== 'DEFAULT')
    .map(([status, meta]) => ({ status, meaning: meta.description }));
  summarySheet.getRow(legendStartRow + 1).values = ['Status', 'Meaning'];
  styleWorksheetHeader(summarySheet, 2);
  legendRows.forEach((row) => summarySheet.addRow(row));
  for (let rowNumber = legendStartRow + 2; rowNumber <= legendStartRow + 1 + legendRows.length; rowNumber += 1) {
    const statusCell = summarySheet.getCell(`A${rowNumber}`);
    const meta = CAPACITY_EXPORT_STATUS_META[String(statusCell.value || '').toUpperCase()] || CAPACITY_EXPORT_STATUS_META.DEFAULT;
    statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: meta.fill } };
    statusCell.font = { bold: true, color: { argb: meta.font } };
  }

  const regionSheet = workbook.addWorksheet('Regional Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  regionSheet.columns = [
    { header: 'Region', key: 'region', width: 18 },
    { header: 'Rows', key: 'rows', width: 12 },
    { header: 'Families', key: 'families', width: 12 },
    { header: 'Subscriptions', key: 'subscriptions', width: 14 },
    { header: 'Quota Available', key: 'quotaAvailable', width: 16 },
    { header: 'OK', key: 'okRows', width: 10 },
    { header: 'Limited', key: 'limitedRows', width: 10 },
    { header: 'Constrained', key: 'constrainedRows', width: 14 }
  ];
  regionSummaryRows.forEach((row) => regionSheet.addRow(row));
  styleWorksheetHeader(regionSheet, regionSheet.columns.length);
  applyAlternatingWorksheetRows(regionSheet);
  applyWorksheetBorders(regionSheet);

  const familySheet = workbook.addWorksheet('Family Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  familySheet.columns = [
    { header: 'Family', key: 'family', width: 22 },
    { header: 'Rows', key: 'rows', width: 12 },
    { header: 'Regions', key: 'regions', width: 12 },
    { header: 'SKUs', key: 'skus', width: 12 },
    { header: 'Quota Available', key: 'quotaAvailable', width: 16 },
    { header: 'OK', key: 'okRows', width: 10 },
    { header: 'Limited', key: 'limitedRows', width: 10 },
    { header: 'Constrained', key: 'constrainedRows', width: 14 }
  ];
  familySummaryRows.forEach((row) => familySheet.addRow(row));
  styleWorksheetHeader(familySheet, familySheet.columns.length);
  applyAlternatingWorksheetRows(familySheet);
  applyWorksheetBorders(familySheet);

  const detailSheet = workbook.addWorksheet('Capacity Details', { views: [{ state: 'frozen', ySplit: 1 }] });
  detailSheet.columns = [
    { header: 'Captured At (UTC)', key: 'capturedAtUtc', width: 24 },
    { header: 'Subscription Name', key: 'subscriptionName', width: 28 },
    { header: 'Region', key: 'region', width: 18 },
    { header: 'SKU', key: 'sku', width: 24 },
    { header: 'Family', key: 'family', width: 18 },
    { header: 'Availability', key: 'availability', width: 16 },
    { header: 'Quota Available', key: 'quotaAvailable', width: 16 },
    { header: 'vCPU', key: 'vCpu', width: 10 },
    { header: 'Memory GB', key: 'memoryGB', width: 12 },
    { header: 'Monthly Cost', key: 'monthlyCost', width: 14 },
    { header: 'Zones', key: 'zonesCsv', width: 18 }
  ];
  exportRows.forEach((row) => detailSheet.addRow(row));
  styleWorksheetHeader(detailSheet, detailSheet.columns.length);
  applyAlternatingWorksheetRows(detailSheet);
  applyWorksheetBorders(detailSheet);
  detailSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const availabilityCell = row.getCell('availability');
    const statusMeta = CAPACITY_EXPORT_STATUS_META[String(availabilityCell.value || '').toUpperCase()] || CAPACITY_EXPORT_STATUS_META.DEFAULT;
    availabilityCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusMeta.fill } };
    availabilityCell.font = { bold: true, color: { argb: statusMeta.font } };
    availabilityCell.alignment = { horizontal: 'center' };
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
    },
    aiModelCatalog: {
      intervalMinutes: normalizeIntervalMinutes(
        process.env.INGEST_AI_MODEL_CATALOG_INTERVAL_MINUTES || process.env.INGEST_OPENAI_MODEL_CATALOG_INTERVAL_MINUTES,
        1440
      )
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
    },
    aiModelCatalog: {
      intervalMinutes: normalizeIntervalMinutes(
        readValue(DASHBOARD_SETTING_KEYS.aiModelCatalogIntervalMinutes),
        defaults.aiModelCatalog.intervalMinutes
      )
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
    },
    aiModelCatalog: {
      intervalMinutes: normalizeIntervalMinutes(settings?.aiModelCatalog?.intervalMinutes, 1440)
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
    },
    aiModelCatalog: {
      intervalMinutes: normalizeIntervalMinutes(settings?.aiModelCatalog?.intervalMinutes, 1440)
    }
  };

  const savedCount = await upsertDashboardSettings({
    [DASHBOARD_SETTING_KEYS.ingestIntervalMinutes]: String(normalized.ingest.intervalMinutes),
    [DASHBOARD_SETTING_KEYS.ingestRunOnStartup]: normalized.ingest.runOnStartup ? 'true' : 'false',
    [DASHBOARD_SETTING_KEYS.livePlacementIntervalMinutes]: String(normalized.livePlacement.intervalMinutes),
    [DASHBOARD_SETTING_KEYS.livePlacementRunOnStartup]: normalized.livePlacement.runOnStartup ? 'true' : 'false',
    [DASHBOARD_SETTING_KEYS.aiModelCatalogIntervalMinutes]: String(normalized.aiModelCatalog.intervalMinutes)
  });

  if (savedCount < 5) {
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

function isSqlSessionStoreRuntimeError(err) {
  const message = String(err?.message || '').toLowerCase();
  return message.includes("invalid object name 'sessions'")
    || message.includes('connection is closed')
    || message.includes('failed to lookup session')
    || message.includes('session') && message.includes('mssql');
}

app.use((req, res, next) => activeSessionMiddleware(req, res, (err) => {
  if (!err) {
    return next();
  }

  if (isSqlSessionStoreRuntimeError(err)) {
    console.warn('[session] SQL session store request failed, falling back to MemoryStore:', err.message);
    activeSessionMiddleware = createSessionMiddleware(false);
    return activeSessionMiddleware(req, res, next);
  }

  return next(err);
}));

// Auth routes (/auth/login, /auth/callback, /auth/logout) — always accessible
app.use('/auth', buildAuthRouter());

// Protect all API routes with inline check — always returns 401 JSON (never
// redirects) because every path here is an API call. /api/auth/me is open so
// the frontend can check auth state before initiating a login redirect itself.
app.use('/api', (req, res, next) => {
  if (req.path === '/auth/me') return next();
  if (req.path === '/sku-catalog/families') return next();
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
      <p>Sign in to use the Capacity Dashboard experience.</p>
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
      const batchPreview = batches[index]
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(' ');

      throw new Error(
        `Failed applying ${path.basename(filePath)} batch ${index + 1}: ${err.message}. Batch preview: ${batchPreview}`
      );
    }
  }

  return batches.length;
}

async function runDatabaseBootstrap() {
  return runDatabaseBootstrapWithPool();
}

async function ensureSchemaMigrationHistoryTable(pool) {
  await pool.request().batch(`
    IF OBJECT_ID('dbo.SchemaMigrationHistory', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.SchemaMigrationHistory (
        migrationName NVARCHAR(255) NOT NULL PRIMARY KEY,
        appliedAtUtc DATETIME2(7) NOT NULL CONSTRAINT DF_SchemaMigrationHistory_AppliedAtUtc DEFAULT SYSUTCDATETIME()
      );
    END;
  `);
}

async function getAppliedSchemaMigrations(pool) {
  const hasSchemaMigrationHistory = await sqlTableExistsForBootstrap(pool, 'dbo.SchemaMigrationHistory');
  if (!hasSchemaMigrationHistory) {
    return null;
  }

  let appliedMigrationsResult;
  try {
    appliedMigrationsResult = await pool.request().query(`
      SELECT migrationName
      FROM dbo.SchemaMigrationHistory
    `);
  } catch (err) {
    if (isSqlSelectPermissionError(err)) {
      return null;
    }

    throw err;
  }

  return new Set(
    (appliedMigrationsResult.recordset || [])
      .map((row) => String(row.migrationName || '').trim())
      .filter(Boolean)
  );
}

async function recordAppliedSchemaMigration(pool, migrationName) {
  await pool.request()
    .input('migrationName', sql.NVarChar(255), migrationName)
    .query(`
      IF NOT EXISTS (
        SELECT 1
        FROM dbo.SchemaMigrationHistory
        WHERE migrationName = @migrationName
      )
      BEGIN
        INSERT INTO dbo.SchemaMigrationHistory (migrationName)
        VALUES (@migrationName);
      END;
    `);
}

async function runDatabaseBootstrapWithPool(poolOverride = null) {
  const pool = poolOverride || await getSqlPool();
  const isRuntimePool = !poolOverride;
  if (!pool) {
    throw new Error('SQL connection is not configured.');
  }

  const schemaPath = path.resolve(__dirname, '..', 'sql', 'schema.sql');
  const migrationsDir = path.resolve(__dirname, '..', 'sql', 'migrations');
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter((fileName) => fileName.toLowerCase().endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  const hasCapacitySnapshot = await sqlTableExistsForBootstrap(pool, 'dbo.CapacitySnapshot');
  let appliedSchema = false;
  let skippedLegacyMigrations = false;

  if (!hasCapacitySnapshot) {
    await executeSqlScriptFile(pool, schemaPath);
    appliedSchema = true;
    await ensureSchemaMigrationHistoryTable(pool);
  }

  let appliedMigrations = await getAppliedSchemaMigrations(pool);
  if (appliedMigrations === null && hasCapacitySnapshot) {
    // Older databases may be fully provisioned but lack migration history.
    // Treat them as steady-state to avoid rerunning DDL under the app identity.
    skippedLegacyMigrations = true;
  }

  if (appliedMigrations === null && !skippedLegacyMigrations) {
    await ensureSchemaMigrationHistoryTable(pool);
    appliedMigrations = new Set();
  }

  const migrationsApplied = [];
  if (!skippedLegacyMigrations) {
    for (const migrationFile of migrationFiles) {
      if (appliedMigrations?.has(migrationFile)) {
        continue;
      }

      await executeSqlScriptFile(pool, path.resolve(migrationsDir, migrationFile));
      migrationsApplied.push(migrationFile);
      if (appliedMigrations) {
        await recordAppliedSchemaMigration(pool, migrationFile);
        appliedMigrations.add(migrationFile);
      }
    }
  }

  let phase3Ensured = false;
  let skippedPhase3SchemaDueToPermissions = false;
  try {
    await ensurePhase3SchemaForPool(pool);
    phase3Ensured = true;
  } catch (err) {
    if (isRuntimePool && hasCapacitySnapshot && isSqlSchemaPermissionError(err)) {
      skippedPhase3SchemaDueToPermissions = true;
    } else {
      throw err;
    }
  }

  return {
    ok: true,
    appliedSchema,
    migrationsApplied,
    skippedLegacyMigrations,
    phase3Ensured,
    skippedPhase3SchemaDueToPermissions
  };
}

async function runNamedDatabaseMigration(migrationName, poolOverride = null) {
  const normalizedMigrationName = path.basename(String(migrationName || '').trim());
  if (!normalizedMigrationName) {
    throw new Error('migrationName is required.');
  }

  const pool = poolOverride || await getSqlPool();
  if (!pool) {
    throw new Error('SQL connection is not configured.');
  }

  const migrationsDir = path.resolve(__dirname, '..', 'sql', 'migrations');
  const migrationPath = path.resolve(migrationsDir, normalizedMigrationName);
  if (!migrationPath.startsWith(migrationsDir + path.sep) || !fs.existsSync(migrationPath)) {
    throw new Error(`Migration file not found: ${normalizedMigrationName}`);
  }

  const batchesApplied = await executeSqlScriptFile(pool, migrationPath);
  await ensurePhase3SchemaForPool(pool);

  return {
    ok: true,
    migrationApplied: normalizedMigrationName,
    batchesApplied,
    phase3Ensured: true
  };
}

async function runFamilyCasingNormalizationBatch(batchSize = 1000, poolOverride = null) {
  const normalizedBatchSize = Math.max(1, Math.min(Number(batchSize || 1000), 10000));
  const pool = poolOverride || await getSqlPool();
  if (!pool) {
    throw new Error('SQL connection is not configured.');
  }

  async function updateInBatches(queryText) {
    const result = await pool.request()
      .input('batchSize', sql.Int, normalizedBatchSize)
      .query(queryText);
    return Number(result.recordset?.[0]?.rowsAffected || 0);
  }

  const updates = {
    capacitySnapshotStandardUnderscore: await updateInBatches(`
      UPDATE TOP (@batchSize) dbo.CapacitySnapshot
      SET skuFamily = 'standard' + SUBSTRING(skuFamily, 10, 119)
      WHERE LOWER(LEFT(skuFamily, 9)) = 'standard_';
      SELECT @@ROWCOUNT AS rowsAffected;
    `),
    capacitySnapshotStandardPrefix: await updateInBatches(`
      UPDATE TOP (@batchSize) dbo.CapacitySnapshot
      SET skuFamily = 'standard' + SUBSTRING(skuFamily, 9, 120)
      WHERE LOWER(LEFT(skuFamily, 8)) = 'standard'
        AND LOWER(LEFT(skuFamily, 9)) <> 'standard_'
        AND LEFT(skuFamily COLLATE Latin1_General_100_BIN2, 8) <> 'standard';
      SELECT @@ROWCOUNT AS rowsAffected;
    `),
    capacitySnapshotBasicUnderscore: await updateInBatches(`
      UPDATE TOP (@batchSize) dbo.CapacitySnapshot
      SET skuFamily = 'basic' + SUBSTRING(skuFamily, 7, 121)
      WHERE LOWER(LEFT(skuFamily, 6)) = 'basic_';
      SELECT @@ROWCOUNT AS rowsAffected;
    `),
    capacitySnapshotBasicPrefix: await updateInBatches(`
      UPDATE TOP (@batchSize) dbo.CapacitySnapshot
      SET skuFamily = 'basic' + SUBSTRING(skuFamily, 6, 122)
      WHERE LOWER(LEFT(skuFamily, 5)) = 'basic'
        AND LOWER(LEFT(skuFamily, 6)) <> 'basic_'
        AND LEFT(skuFamily COLLATE Latin1_General_100_BIN2, 5) <> 'basic';
      SELECT @@ROWCOUNT AS rowsAffected;
    `),
    capacityScoreStandardUnderscore: await updateInBatches(`
      UPDATE TOP (@batchSize) dbo.CapacityScoreSnapshot
      SET skuFamily = 'standard' + SUBSTRING(skuFamily, 10, 119)
      WHERE LOWER(LEFT(skuFamily, 9)) = 'standard_';
      SELECT @@ROWCOUNT AS rowsAffected;
    `),
    capacityScoreStandardPrefix: await updateInBatches(`
      UPDATE TOP (@batchSize) dbo.CapacityScoreSnapshot
      SET skuFamily = 'standard' + SUBSTRING(skuFamily, 9, 120)
      WHERE LOWER(LEFT(skuFamily, 8)) = 'standard'
        AND LOWER(LEFT(skuFamily, 9)) <> 'standard_'
        AND LEFT(skuFamily COLLATE Latin1_General_100_BIN2, 8) <> 'standard';
      SELECT @@ROWCOUNT AS rowsAffected;
    `),
    capacityScoreBasicUnderscore: await updateInBatches(`
      UPDATE TOP (@batchSize) dbo.CapacityScoreSnapshot
      SET skuFamily = 'basic' + SUBSTRING(skuFamily, 7, 121)
      WHERE LOWER(LEFT(skuFamily, 6)) = 'basic_';
      SELECT @@ROWCOUNT AS rowsAffected;
    `),
    capacityScoreBasicPrefix: await updateInBatches(`
      UPDATE TOP (@batchSize) dbo.CapacityScoreSnapshot
      SET skuFamily = 'basic' + SUBSTRING(skuFamily, 6, 122)
      WHERE LOWER(LEFT(skuFamily, 5)) = 'basic'
        AND LOWER(LEFT(skuFamily, 6)) <> 'basic_'
        AND LEFT(skuFamily COLLATE Latin1_General_100_BIN2, 5) <> 'basic';
      SELECT @@ROWCOUNT AS rowsAffected;
    `)
  };

  const totalUpdated = Object.values(updates).reduce((sum, count) => sum + Number(count || 0), 0);
  return {
    ok: true,
    batchSize: normalizedBatchSize,
    updates,
    totalUpdated,
    done: totalUpdated === 0
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
      canAccessAdmin: adminAccess
    }
  });
});

app.get('/api/capacity', async (req, res) => {
  try {
    const rows = await getCapacityRows(getCapacityFiltersFromQuery(req.query));
    res.json({ rows });
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to retrieve capacity rows.', err, scope: 'api/capacity' });
  }
});

app.get('/api/capacity/export', async (req, res) => {
  try {
    const filters = getCapacityFiltersFromQuery(req.query);
    const format = normalizeCapacityExportFormat(req.query.format);
    const variant = normalizeCapacityExportVariant(req.query.variant);
    const rows = await getCapacityRows(filters);
    const exportRows = buildCapacityExportRows(rows);
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

    if (format === 'xlsx') {
      const workbookBuffer = variant === 'report'
        ? await buildCapacityReportWorkbook({ exportRows, filters })
        : await buildCapacityWorkbook({ exportRows, filters });
      const filenamePrefix = variant === 'report' ? 'capacity-dashboard-report' : 'capacity-dashboard';
      res.setHeader('Content-Disposition', `attachment; filename="${filenamePrefix}-${timestamp}.xlsx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(Buffer.from(workbookBuffer));
    }

    const csv = buildCapacityCsv(exportRows);
    res.setHeader('Content-Disposition', `attachment; filename="capacity-dashboard-${timestamp}.csv"`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(csv);
  } catch (err) {
    return sendErrorResponse(res, { clientMessage: 'Failed to export capacity rows.', err, scope: 'api/capacity/export' });
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
    const result = await getCapacityRowsPaginated(getCapacityFiltersFromQuery(req.query));
    res.json(result);
  } catch (err) {
    sendErrorResponse(res, {
      clientMessage: 'Failed to retrieve paginated capacity data.',
      err,
      scope: 'api/capacity/paged',
      exposeMessage: process.env.NODE_ENV !== 'production'
    });
  }
});

app.get('/api/sku-catalog/families', async (req, res) => {
  try {
    const forceRefresh = String(req.query?.refresh || '').toLowerCase() === 'true';
    const payload = await getSkuFamilyCatalog({ forceRefresh });
    const familyKeys = Object.keys(payload?.families || {});
    const dsv6Key = familyKeys.find((k) => /sv6$/i.test(k) || /DSv6/i.test(k));
    const dsv6Skus = dsv6Key ? (payload.families[dsv6Key] || []) : [];
    console.log(`[api/sku-catalog/families] source=${payload?.source} families=${familyKeys.length} dsv6Key=${dsv6Key || 'none'} dsv6Count=${dsv6Skus.length} dsv6Sample=${dsv6Skus.slice(0, 5).join(',')}`);
    res.set('Cache-Control', 'no-store');
    res.json(payload);
  } catch (err) {
    console.error('[api/sku-catalog/families] Failed to load SKU family catalog:', err?.message || err);
    res.status(503).json({ error: 'sku_catalog_unavailable', detail: err?.message || String(err) });
  }
});

app.get('/api/capacity/analytics', async (req, res) => {
  try {
    const result = await getCapacityAnalyticsSummary(getCapacityFiltersFromQuery(req.query));
    res.json(result);
  } catch (err) {
    console.error('[api/capacity/analytics] Falling back to default analytics payload after route error:', err);
    res.json({
      regionHealth: [],
      topSkus: [],
      matrix: { regions: [], rows: [] },
      recommendedTargetSku: '',
      aiQuotaProviderOptions: []
    });
  }
});

app.get('/api/quota/groups', requireAuth, async (_, res) => {
  try {
    const result = await listQuotaGroups(_.query.managementGroupId);
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.message.includes('QUOTA_MANAGEMENT_GROUP_ID') ? 503 : 500;
    sendErrorResponse(res, { status, clientMessage: 'Failed to discover quota groups.', err, scope: 'api/quota/groups', extra: { groups: [] } });
  }
});

app.get('/api/quota/shareable-report', requireAuth, async (req, res) => {
  try {
    const result = await listQuotaGroupShareableQuota(req.query.managementGroupId, req.query.groupQuotaName);
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.message.includes('required') ? 400 : (err.message.includes('QUOTA_MANAGEMENT_GROUP_ID') ? 503 : 500);
    sendErrorResponse(res, {
      status,
      clientMessage: status === 400 ? 'Quota shareable report request is invalid.' : 'Failed to load the shareable quota report.',
      err,
      scope: 'api/quota/shareable-report',
      exposeMessage: status === 400,
      extra: {
        rows: [],
        summary: {
          rowCount: 0,
          subscriptionCount: 0,
          regionCount: 0,
          skuCount: 0,
          totalShareableQuota: 0
        }
      }
    });
  }
});

app.get('/api/quota/management-groups', requireAuth, async (_, res) => {
  try {
    const groups = await listManagementGroups();
    res.json({ ok: true, groups, defaultManagementGroupId: process.env.QUOTA_MANAGEMENT_GROUP_ID || null });
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to retrieve management groups.', err, scope: 'api/quota/management-groups', extra: { groups: [] } });
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
    sendErrorResponse(res, { status, clientMessage: status === 400 ? 'Quota candidate request is invalid.' : 'Failed to generate quota candidates.', err, scope: 'api/quota/candidates', exposeMessage: status === 400, extra: { candidates: [] } });
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
    sendErrorResponse(res, { status, clientMessage: status === 400 ? 'Quota capture request is invalid.' : 'Failed to capture quota candidate history.', err, scope: 'api/quota/candidates/capture', exposeMessage: status === 400 });
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
    sendErrorResponse(res, { status, clientMessage: status === 400 ? 'Quota run history request is invalid.' : 'Failed to retrieve quota run history.', err, scope: 'api/quota/candidate-runs', exposeMessage: status === 400, extra: { runs: [] } });
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
    sendErrorResponse(res, { status, clientMessage: status === 400 ? 'Quota plan request is invalid.' : 'Failed to build quota move plan.', err, scope: 'api/quota/plan', exposeMessage: status === 400, extra: { planRows: [] } });
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
    sendErrorResponse(res, { status, clientMessage: status === 400 ? 'Quota simulation request is invalid.' : 'Failed to simulate quota move plan.', err, scope: 'api/quota/simulate', exposeMessage: status === 400, extra: { impactRows: [] } });
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
    sendErrorResponse(res, { status, clientMessage: status === 400 ? 'Quota apply request is invalid.' : 'Failed to apply quota move plan.', err, scope: 'api/quota/apply', exposeMessage: status === 400, extra: { applyResults: [] } });
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
    sendErrorResponse(res, { clientMessage: 'Failed to retrieve subscriptions.', err, scope: 'api/subscriptions' });
  }
});

app.get('/api/capacity/subscriptions', async (req, res) => {
  try {
    const rows = await getSubscriptionSummary({
      regionPreset: req.query.regionPreset,
      subscriptionIds: req.query.subscriptionIds,
      region: req.query.region,
      family: req.query.family,
      familyBase: req.query.familyBase,
      sku: req.query.sku,
      availability: req.query.availability,
      resourceType: req.query.resourceType,
      provider: req.query.provider
    });
    res.json({ rows });
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to retrieve subscription summary.', err, scope: 'api/capacity/subscriptions' });
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
      familyBase: req.query.familyBase,
      sku: req.query.sku,
      quotaName: req.query.quotaName,
      availability: req.query.availability,
      resourceType: req.query.resourceType,
      managementGroupId: req.query.managementGroupId,
      groupQuotaName: req.query.groupQuotaName,
      analysisRunId: req.query.analysisRunId
    });
    res.json({ rows });
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to build SQL preview.', err, scope: 'api/admin/sql-preview' });
  }
});

app.get('/api/capacity/trends', async (req, res) => {
  try {
    const rows = await getCapacityTrends({
      days: req.query.days,
      granularity: req.query.granularity,
      regionPreset: req.query.regionPreset,
      subscriptionIds: req.query.subscriptionIds,
      region: req.query.region,
      family: req.query.family,
      familyBase: req.query.familyBase,
      sku: req.query.sku,
      availability: req.query.availability,
      resourceType: req.query.resourceType
    });
    res.json({ rows });
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to retrieve capacity trends.', err, scope: 'api/capacity/trends' });
  }
});

app.get('/api/capacity/families', async (req, res) => {
  try {
    const rows = await getFamilySummary({
      regionPreset: req.query.regionPreset,
      subscriptionIds: req.query.subscriptionIds,
      region: req.query.region,
      family: req.query.family,
      familyBase: req.query.familyBase,
      sku: req.query.sku,
      availability: req.query.availability
    });
    res.json({ rows });
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to retrieve family summary.', err, scope: 'api/capacity/families' });
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
      familyBase: req.query.familyBase,
      sku: req.query.sku,
      availability: req.query.availability,
      desiredCount: req.query.desiredCount
    }, pageNumber, pageSize);
    
    res.json(payload);
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to retrieve capacity score summary.', err, scope: 'api/capacity/scores' });
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
    sendErrorResponse(res, { clientMessage: 'Failed to retrieve capacity score history.', err, scope: 'api/capacity/scores/history' });
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
    sendErrorResponse(res, { status, clientMessage: 'Failed to retrieve live placement scores.', err, scope: 'api/capacity/scores/live', extra: { rows: [] } });
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
    const status = err.statusCode || (err.message.includes('not found') || err.message.includes('not configured') ? 503 : 500);
    sendErrorResponse(res, {
      status,
      clientMessage: 'Failed to retrieve capacity recommendations.',
      err,
      scope: 'api/capacity/recommendations',
      extra: {
        detail: err && err.message ? String(err.message).slice(0, 4000) : null
      }
    });
  }
});

app.get('/api/paas-availability', async (req, res) => {
  try {
    const result = await getPaaSAvailabilitySnapshot({
      service: req.query.service,
      maxAgeHours: req.query.maxAgeHours
    });
    res.json(result);
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to retrieve cached PaaS availability.', err, scope: 'api/paas-availability:get', extra: { rows: [] } });
  }
});

app.get('/api/paas-availability/probe', async (_req, res) => {
  try {
    const result = await getPaaSPowerShellProbe();
    res.json(result);
  } catch (err) {
    sendErrorResponse(res, {
      clientMessage: 'Failed to probe PaaS PowerShell runtime.',
      err,
      scope: 'api/paas-availability:probe',
      extra: { runtimes: [] }
    });
  }
});

app.post('/api/paas-availability/refresh', async (req, res) => {
  try {
    const result = await runPaaSAvailabilityScan({
      service: req.body?.service,
      regions: req.body?.regions,
      regionPreset: req.body?.regionPreset,
      edition: req.body?.edition,
      computeModel: req.body?.computeModel,
      sqlResourceType: req.body?.sqlResourceType,
      includeDisabled: req.body?.includeDisabled,
      fetchPricing: req.body?.fetchPricing
    });
    res.json(result);
  } catch (err) {
    const status = err.message.includes('not found') || err.message.includes('not configured') ? 503 : 500;
    sendErrorResponse(res, {
      status,
      clientMessage: 'Failed to refresh PaaS availability.',
      err,
      scope: 'api/paas-availability:refresh',
      extra: {
        rows: [],
        detail: err && err.message ? String(err.message).slice(0, 4000) : null
      }
    });
  }
});

app.get('/api/admin/recommendations/diagnostics', requireAdmin, (req, res) => {
  try {
    const diagnostics = getRecommendationDiagnostics();
    res.json({ ok: true, diagnostics });
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to retrieve diagnostics.', err, scope: 'api/admin/recommendations/diagnostics' });
  }
});

// AI Model Availability endpoints
app.get('/api/ai/models', async (req, res) => {
  try {
    const pool = await getSqlPool();
    if (!pool) {
      res.status(503).json({ error: 'Database not configured' });
      return;
    }

    const availabilitySource = await getAIModelAvailabilitySource(pool);
    if (!availabilitySource) {
      res.json({ rows: [] });
      return;
    }

    const { objectName, hasProviderColumn } = availabilitySource;
    const region = req.query.region;
    const provider = req.query.provider;
    const modelName = req.query.modelName;
    const deploymentType = req.query.deploymentType;

    let query = hasProviderColumn
      ? `SELECT * FROM ${objectName} WHERE 1=1`
      : `SELECT *, CAST('OpenAI' AS NVARCHAR(128)) AS provider FROM ${objectName} WHERE 1=1`;
    const request = pool.request();
    
    if (region) {
      query += ' AND region = @region';
      request.input('region', sql.NVarChar, region);
    }

    if (provider) {
      if (!hasProviderColumn) {
        const normalizedProvider = String(provider).trim().toLowerCase();
        if (normalizedProvider !== 'openai') {
          res.json({ rows: [] });
          return;
        }
      }

      query += ' AND provider = @provider';
      request.input('provider', sql.NVarChar, provider);
    }
    
    if (modelName) {
      query += ' AND modelName LIKE @modelName';
      request.input('modelName', sql.NVarChar, `%${modelName}%`);
    }
    
    if (deploymentType) {
      query += ' AND deploymentTypes LIKE @deploymentType';
      request.input('deploymentType', sql.NVarChar, `%${deploymentType}%`);
    }
    
    query += hasProviderColumn
      ? ' ORDER BY provider, region, modelName, modelVersion'
      : ' ORDER BY region, modelName, modelVersion';
    
    const result = await request.query(query);
    res.json({ rows: result.recordset });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve AI model availability', detail: err.message });
  }
});

app.get('/api/ai/models/providers', async (req, res) => {
  try {
    const pool = await getSqlPool();
    if (!pool) {
      res.status(503).json({ error: 'Database not configured' });
      return;
    }

    const availabilitySource = await getAIModelAvailabilitySource(pool);
    if (!availabilitySource) {
      res.json({ providers: [] });
      return;
    }

    const { objectName, hasProviderColumn } = availabilitySource;
    if (!hasProviderColumn) {
      res.json({ providers: ['OpenAI'] });
      return;
    }

    const region = req.query.region;
    const request = pool.request();
    let query = `
      SELECT DISTINCT provider
      FROM ${objectName}
      WHERE provider IS NOT NULL AND LTRIM(RTRIM(provider)) <> ''
    `;

    if (region) {
      query += ' AND region = @region';
      request.input('region', sql.NVarChar, region);
    }

    query += ' ORDER BY provider';

    const result = await request.query(query);
    res.json({ providers: result.recordset.map((row) => row.provider) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve AI providers', detail: err.message });
  }
});

app.get('/api/ai/models/regions', async (req, res) => {
  try {
    const pool = await getSqlPool();
    if (!pool) {
      res.status(503).json({ error: 'Database not configured' });
      return;
    }

    const availabilitySource = await getAIModelAvailabilitySource(pool);
    if (!availabilitySource) {
      res.json({ regions: [] });
      return;
    }

    const { objectName, hasProviderColumn } = availabilitySource;

    const provider = req.query.provider;
    const request = pool.request();
    let query = `
      SELECT DISTINCT region 
      FROM ${objectName}
      WHERE 1 = 1
    `;

    if (provider) {
      if (!hasProviderColumn) {
        const normalizedProvider = String(provider).trim().toLowerCase();
        if (normalizedProvider !== 'openai') {
          res.json({ regions: [] });
          return;
        }
      }

      query += ' AND provider = @provider';
      request.input('provider', sql.NVarChar, provider);
    }

    query += ' ORDER BY region';

    const result = await request.query(query);

    res.json({ regions: result.recordset.map(r => r.region) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve AI regions', detail: err.message });
  }
});

app.get('/api/ai/quota/providers', async (req, res) => {
  try {
    const pool = await getSqlPool();
    if (!pool) {
      res.status(503).json({ error: 'Database not configured' });
      return;
    }

    const request = pool.request();
    const result = await request.query(`
      WITH LatestAICapture AS (
        SELECT MAX(capturedAtUtc) AS capturedAtUtc
        FROM dbo.CapacitySnapshot
        WHERE sourceType = 'live-azure-openai-ingest'
           OR sourceType LIKE 'live-azure-ai-%-ingest'
      )
      SELECT snapshot.sourceType, snapshot.skuFamily, snapshot.skuName
      FROM dbo.CapacitySnapshot AS snapshot
      INNER JOIN LatestAICapture
        ON snapshot.capturedAtUtc = LatestAICapture.capturedAtUtc
      WHERE snapshot.sourceType = 'live-azure-openai-ingest'
         OR snapshot.sourceType LIKE 'live-azure-ai-%-ingest'
    `);

    const providers = [...new Set(
      (result.recordset || [])
        .filter((row) => isAIQuotaSourceType(row?.sourceType))
        .map((row) => getAIQuotaProviderFromSnapshot(row))
        .filter((provider) => provider && provider !== 'Unknown')
    )].sort((left, right) => left.localeCompare(right));

    res.json({ providers });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve AI quota providers', detail: err.message });
  }
});

app.get('/api/ai/quota', async (req, res) => {
  try {
    const pool = await getSqlPool();
    if (!pool) {
      res.status(503).json({ error: 'Database not configured' });
      return;
    }
    
    const region = req.query.region;
    const provider = req.query.provider;
    const modelName = req.query.modelName;
    
    let query = `
      WITH LatestAICapture AS (
        SELECT MAX(capturedAtUtc) AS capturedAtUtc
        FROM dbo.CapacitySnapshot
        WHERE sourceType = 'live-azure-openai-ingest'
           OR sourceType LIKE 'live-azure-ai-%-ingest'
      )
      SELECT 
        snapshot.region,
        snapshot.sourceType,
        snapshot.skuFamily,
        snapshot.skuName,
        snapshot.quotaCurrent,
        snapshot.quotaLimit,
        snapshot.availabilityState,
        snapshot.capturedAtUtc,
        snapshot.subscriptionName
      FROM dbo.CapacitySnapshot AS snapshot
      INNER JOIN LatestAICapture
        ON snapshot.capturedAtUtc = LatestAICapture.capturedAtUtc
      WHERE snapshot.sourceType = 'live-azure-openai-ingest'
         OR snapshot.sourceType LIKE 'live-azure-ai-%-ingest'
    `;
    
    const request = pool.request();
    
    if (region) {
      query += ' AND snapshot.region = @region';
      request.input('region', sql.NVarChar, region);
    }
    
    if (modelName) {
      query += ' AND (snapshot.skuFamily LIKE @modelName OR snapshot.skuName LIKE @modelName)';
      request.input('modelName', sql.NVarChar, `%${modelName}%`);
    }
    
    query += ' ORDER BY snapshot.region, snapshot.skuFamily, snapshot.skuName';
    
    const result = await request.query(query);
    const rows = (result.recordset || [])
      .filter((row) => isAIQuotaSourceType(row?.sourceType))
      .map((row) => mapAIQuotaResponseRow(row))
      .filter((row) => !provider || row.provider === provider)
      .sort((left, right) => {
        if (left.provider !== right.provider) {
          return left.provider.localeCompare(right.provider);
        }
        if (left.region !== right.region) {
          return left.region.localeCompare(right.region);
        }
        if (left.skuFamily !== right.skuFamily) {
          return left.skuFamily.localeCompare(right.skuFamily);
        }
        return left.skuName.localeCompare(right.skuName);
      });

    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve AI quota', detail: err.message });
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

app.post('/api/admin/ingest/model-catalog', requireAdmin, async (req, res) => {
  try {
    const result = await refreshModelCatalog(buildCapacityIngestionOptions(req.body));
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
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
      livePlacement: getLivePlacementSchedulerConfig(),
      aiModelCatalog: {
        intervalMinutes: persisted.aiModelCatalog.intervalMinutes
      }
    };

    res.json({ ok: true, settings: persisted, runtime, persistence });
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to load scheduler settings.', err, scope: 'api/admin/ingest/schedule' });
  }
});

app.get('/api/admin/ui-settings', requireAdmin, async (_, res) => {
  try {
    const settings = await getEffectiveUiSettings();
    res.json({ ok: true, settings });
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to load UI settings.', err, scope: 'api/admin/ui-settings:get' });
  }
});

app.put('/api/admin/ui-settings', requireAdmin, async (req, res) => {
  try {
    const settings = await saveUiSettings({
      showSqlPreview: req.body?.showSqlPreview
    });
    res.json({ ok: true, settings });
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to save UI settings.', err, scope: 'api/admin/ui-settings:put' });
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
          livePlacement: getLivePlacementSchedulerConfig(),
          aiModelCatalog: {
            intervalMinutes: normalizeIntervalMinutes(
              req.body?.aiModelCatalog?.intervalMinutes,
              process.env.INGEST_AI_MODEL_CATALOG_INTERVAL_MINUTES || process.env.INGEST_OPENAI_MODEL_CATALOG_INTERVAL_MINUTES || 1440
            )
          }
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
      },
      aiModelCatalog: {
        intervalMinutes: req.body?.aiModelCatalog?.intervalMinutes
      }
    };

    const savedSettings = await saveSchedulerSettings(candidate);
    const runtime = applyRuntimeSchedulerSettings(savedSettings);

    res.json({ ok: true, settings: savedSettings, runtime, persistence });
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to save scheduler settings.', err, scope: 'api/admin/ingest/schedule:put' });
  }
});

app.post('/api/admin/errors/log', requireAuth, async (req, res) => {
  try {
    const entry = normalizeErrorLogEntry(req.body);

    const result = await insertDashboardErrorLog(entry);
    res.json({ ok: true, logged: result > 0 });
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to record the error event.', err, scope: 'api/admin/errors/log', extra: { logged: false } });
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
    sendErrorResponse(res, { clientMessage: 'Failed to retrieve error history.', err, scope: 'api/admin/errors' });
  }
});

app.post('/api/admin/operations/log', requireAuth, async (req, res) => {
  try {
    const entry = normalizeOperationLogEntry(req.body);

    const result = await logDashboardOperation(entry);
    res.json({ ok: true, logged: result > 0 });
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to record the operation event.', err, scope: 'api/admin/operations/log', extra: { logged: false } });
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
    sendErrorResponse(res, { clientMessage: 'Failed to retrieve operation history.', err, scope: 'api/admin/operations' });
  }
});

app.post('/internal/ingest/capacity', requireIngestKey, async (req, res) => {
  try {
    const result = await runCapacityIngestion({
      regionPreset: req.body?.regionPreset,
      regions: req.body?.regions,
      subscriptionIds: req.body?.subscriptionIds,
      managementGroupNames: req.body?.managementGroupNames,
      familyFilters: req.body?.familyFilters
    });
    res.json({ ok: true, result });
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to run capacity ingestion.', err, scope: 'internal/ingest/capacity' });
  }
});

app.get('/internal/ingest/status', requireIngestKey, (req, res) => {
  res.json({ ok: true, status: getIngestionStatus() });
});

app.get('/internal/diagnostics/report-counts', requireIngestKey, async (req, res) => {
  try {
    const filters = getCapacityFiltersFromQuery(req.query);
    const pool = await getSqlPool();

    const checks = await Promise.all([
      runDiagnosticCheck('capacityRows', () => getCapacityRows(filters), { timeoutMs: 8000 }),
      runDiagnosticCheck('capacityPaged', () => getCapacityRowsPaginated({ ...filters, pageNumber: 1, pageSize: 10 }), { timeoutMs: 8000 }),
      runDiagnosticCheck('subscriptions', () => getSubscriptions({ limit: 20 }), { timeoutMs: 8000 }),
      runDiagnosticCheck('subscriptionSummary', () => getSubscriptionSummary(filters), { timeoutMs: 8000 }),
      runDiagnosticCheck('trendRows', () => getCapacityTrends({ ...filters, days: 7 }), { timeoutMs: 8000 }),
      runDiagnosticCheck('familyRows', () => getFamilySummary(filters), { timeoutMs: 8000 }),
      runDiagnosticCheck('scoreSummary', () => getCapacityScoreSummary(filters), { timeoutMs: 8000 }),
      runDiagnosticCheck('capacitySnapshotCount', () => (pool ? getSqlObjectRowCount(pool, 'dbo.CapacitySnapshot', ['U']) : null), { timeoutMs: 8000 }),
      runDiagnosticCheck('capacitySnapshotLatestUtc', () => (pool ? getSqlObjectLatestCapture(pool, 'dbo.CapacitySnapshot', ['U']) : null), { timeoutMs: 8000 }),
      runDiagnosticCheck('capacityLatestCount', () => (pool ? getSqlObjectRowCount(pool, 'dbo.CapacityLatest', ['V']) : null), { timeoutMs: 8000 }),
      runDiagnosticCheck('capacityLatestLatestUtc', () => (pool ? getSqlObjectLatestCapture(pool, 'dbo.CapacityLatest', ['V']) : null), { timeoutMs: 8000 }),
      runDiagnosticCheck('subscriptionsTableCount', () => (pool ? getSqlObjectRowCount(pool, 'dbo.Subscriptions', ['U']) : null), { timeoutMs: 8000 }),
      runDiagnosticCheck('scoreSnapshotCount', () => (pool ? getSqlObjectRowCount(pool, 'dbo.CapacityScoreSnapshot', ['U']) : null), { timeoutMs: 8000 })
    ]);

    const byName = Object.fromEntries(checks.map((check) => [check.name, check]));

    res.json({
      ok: true,
      filters,
      raw: {
        capacitySnapshotCount: byName.capacitySnapshotCount?.value ?? null,
        capacitySnapshotLatestUtc: byName.capacitySnapshotLatestUtc?.value ?? null,
        capacityLatestCount: byName.capacityLatestCount?.value ?? null,
        capacityLatestLatestUtc: byName.capacityLatestLatestUtc?.value ?? null,
        subscriptionsTableCount: byName.subscriptionsTableCount?.value ?? null,
        scoreSnapshotCount: byName.scoreSnapshotCount?.value ?? null
      },
      app: {
        capacityRows: Array.isArray(byName.capacityRows?.value) ? byName.capacityRows.value.length : 0,
        pagedRows: Array.isArray(byName.capacityPaged?.value?.data) ? byName.capacityPaged.value.data.length : 0,
        pagedTotal: Number(byName.capacityPaged?.value?.pagination?.total || 0),
        subscriptions: Array.isArray(byName.subscriptions?.value) ? byName.subscriptions.value.length : 0,
        subscriptionSummary: Array.isArray(byName.subscriptionSummary?.value) ? byName.subscriptionSummary.value.length : 0,
        trendRows: Array.isArray(byName.trendRows?.value) ? byName.trendRows.value.length : 0,
        familyRows: Array.isArray(byName.familyRows?.value) ? byName.familyRows.value.length : 0,
        scoreRows: Array.isArray(byName.scoreSummary?.value) ? byName.scoreSummary.value.length : 0,
        sampleCapacityRows: Array.isArray(byName.capacityRows?.value) ? byName.capacityRows.value.slice(0, 3) : [],
        sampleSubscriptions: Array.isArray(byName.subscriptions?.value) ? byName.subscriptions.value.slice(0, 5) : []
      },
      failures: checks.filter((check) => !check.ok),
      ingestStatus: getIngestionStatus()
    });
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to retrieve internal report diagnostics.', err, scope: 'internal/diagnostics/report-counts' });
  }
});

app.get('/internal/diagnostics/sql-objects', requireIngestKey, async (_req, res) => {
  try {
    const pool = await getSqlPool();
    if (!pool) {
      return res.status(503).json({ ok: false, error: 'SQL connection is not configured.' });
    }

    const checks = await Promise.all([
      runDiagnosticCheck('capacitySnapshotCount', () => getSqlObjectRowCount(pool, 'dbo.CapacitySnapshot', ['U']), { timeoutMs: 8000 }),
      runDiagnosticCheck('capacitySnapshotLatestUtc', () => getSqlObjectLatestCapture(pool, 'dbo.CapacitySnapshot', ['U']), { timeoutMs: 8000 }),
      runDiagnosticCheck('capacityLatestCount', () => getSqlObjectRowCount(pool, 'dbo.CapacityLatest', ['V']), { timeoutMs: 8000 }),
      runDiagnosticCheck('capacityLatestLatestUtc', () => getSqlObjectLatestCapture(pool, 'dbo.CapacityLatest', ['V']), { timeoutMs: 8000 }),
      runDiagnosticCheck('subscriptionsTableCount', () => getSqlObjectRowCount(pool, 'dbo.Subscriptions', ['U']), { timeoutMs: 8000 }),
      runDiagnosticCheck('scoreSnapshotCount', () => getSqlObjectRowCount(pool, 'dbo.CapacityScoreSnapshot', ['U']), { timeoutMs: 8000 })
    ]);

    const byName = Object.fromEntries(checks.map((check) => [check.name, check]));

    res.json({
      ok: true,
      capacitySnapshotCount: byName.capacitySnapshotCount?.value ?? null,
      capacitySnapshotLatestUtc: byName.capacitySnapshotLatestUtc?.value ?? null,
      capacityLatestCount: byName.capacityLatestCount?.value ?? null,
      capacityLatestLatestUtc: byName.capacityLatestLatestUtc?.value ?? null,
      subscriptionsTableCount: byName.subscriptionsTableCount?.value ?? null,
      scoreSnapshotCount: byName.scoreSnapshotCount?.value ?? null,
      failures: checks.filter((check) => !check.ok)
    });
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to retrieve SQL object diagnostics.', err, scope: 'internal/diagnostics/sql-objects' });
  }
});

app.get('/internal/diagnostics/sql-ping', requireIngestKey, async (req, res) => {
  try {
    const pool = await getSqlPool();
    if (!pool) {
      return res.status(503).json({ ok: false, error: 'SQL connection is not configured.' });
    }

    const target = String(req.query.target || 'ping').trim().toLowerCase();
    const targetMap = {
      ping: {
        name: 'sqlPing',
        query: `
          SELECT
            DB_NAME() AS databaseName,
            @@SPID AS sessionId,
            SYSUTCDATETIME() AS currentUtc
        `
      },
      snapshot: {
        name: 'capacitySnapshotTop1',
        query: `
          SELECT TOP (1)
            capturedAtUtc,
            subscriptionId,
            region,
            skuName
          FROM dbo.CapacitySnapshot WITH (READUNCOMMITTED)
          ORDER BY capturedAtUtc DESC
        `
      },
      subscriptions: {
        name: 'subscriptionsTop1',
        query: `
          SELECT TOP (1)
            subscriptionId,
            subscriptionName,
            updatedAtUtc
          FROM dbo.Subscriptions WITH (READUNCOMMITTED)
          ORDER BY updatedAtUtc DESC
        `
      },
      latest: {
        name: 'capacityLatestTop1',
        query: `
          SELECT TOP (1)
            capturedAtUtc,
            subscriptionId,
            region,
            skuName,
            skuFamily,
            availabilityState
          FROM dbo.CapacityLatest
          ORDER BY capturedAtUtc DESC
        `
      }
    };

    const targetConfig = targetMap[target];
    if (!targetConfig) {
      return res.status(400).json({ ok: false, error: 'Unsupported target. Use ping, snapshot, subscriptions, or latest.' });
    }

    const check = await runDiagnosticCheck(targetConfig.name, async () => {
      const result = await pool.request().query(targetConfig.query);
      return result.recordset?.[0] || null;
    }, { timeoutMs: 8000 });

    res.json({
      ok: true,
      target,
      result: check.ok ? check.value ?? null : null,
      failures: check.ok ? [] : [check]
    });
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to retrieve SQL ping diagnostics.', err, scope: 'internal/diagnostics/sql-ping' });
  }
});

app.get('/internal/diagnostics/capacity-read', requireIngestKey, async (req, res) => {
  try {
    const filters = getCapacityFiltersFromQuery(req.query);
    const target = String(req.query.target || 'all').trim().toLowerCase();
    const targetChecks = {
      capacityrows: { name: 'capacityRows', run: () => getCapacityRows(filters) },
      capacitypaged: { name: 'capacityPaged', run: () => getCapacityRowsPaginated({ ...filters, pageNumber: 1, pageSize: 10 }) },
      trendrows: { name: 'trendRows', run: () => getCapacityTrends({ ...filters, days: 7 }) },
      familyrows: { name: 'familyRows', run: () => getFamilySummary(filters) },
      subscriptions: { name: 'subscriptions', run: () => getSubscriptions({ limit: 20 }) }
    };

    const requestedChecks = target === 'all'
      ? Object.values(targetChecks)
      : (targetChecks[target] ? [targetChecks[target]] : null);

    if (!requestedChecks) {
      return res.status(400).json({ ok: false, error: 'Unsupported target. Use all, capacityRows, capacityPaged, trendRows, familyRows, or subscriptions.' });
    }

    const checks = await Promise.all(requestedChecks.map((check) => runDiagnosticCheck(check.name, check.run, { timeoutMs: 8000 })));

    const byName = Object.fromEntries(checks.map((check) => [check.name, check]));

    res.json({
      ok: true,
      target,
      filters,
      capacityRows: Array.isArray(byName.capacityRows?.value) ? byName.capacityRows.value.length : 0,
      pagedRows: Array.isArray(byName.capacityPaged?.value?.data) ? byName.capacityPaged.value.data.length : 0,
      pagedTotal: Number(byName.capacityPaged?.value?.pagination?.total || 0),
      trendRows: Array.isArray(byName.trendRows?.value) ? byName.trendRows.value.length : 0,
      familyRows: Array.isArray(byName.familyRows?.value) ? byName.familyRows.value.length : 0,
      subscriptions: Array.isArray(byName.subscriptions?.value) ? byName.subscriptions.value.length : 0,
      sampleCapacityRows: Array.isArray(byName.capacityRows?.value) ? byName.capacityRows.value.slice(0, 3) : [],
      sampleSubscriptions: Array.isArray(byName.subscriptions?.value) ? byName.subscriptions.value.slice(0, 5) : [],
      failures: checks.filter((check) => !check.ok)
    });
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to retrieve capacity read diagnostics.', err, scope: 'internal/diagnostics/capacity-read' });
  }
});

app.post('/internal/db/ensure-phase3-schema', requireIngestKey, async (_, res) => {
  try {
    const result = await ensurePhase3Schema();
    res.json(result);
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to ensure the phase-3 schema.', err, scope: 'internal/db/ensure-phase3-schema' });
  }
});

app.post('/internal/db/bootstrap', requireIngestKey, async (_, res) => {
  try {
    const result = await runDatabaseBootstrap();
    res.json(result);
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to bootstrap the database.', err, scope: 'internal/db/bootstrap' });
  }
});

app.post('/internal/db/migrate', requireIngestKey, express.json(), async (req, res) => {
  try {
    const result = await runNamedDatabaseMigration(req.body?.migrationName);
    res.json(result);
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to run the requested migration.', err, scope: 'internal/db/migrate' });
  }
});

app.post('/internal/db/normalize-family-casing', requireIngestKey, express.json(), async (req, res) => {
  try {
    const result = await runFamilyCasingNormalizationBatch(req.body?.batchSize);
    res.json(result);
  } catch (err) {
    sendErrorResponse(res, { clientMessage: 'Failed to normalize family casing.', err, scope: 'internal/db/normalize-family-casing' });
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
    sendErrorResponse(res, { clientMessage: 'Failed to complete admin database bootstrap.', err, scope: 'internal/db/bootstrap-admin' });
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

app.get('/classic', (req, res) => {
  return res.sendFile(path.resolve(__dirname, '..', 'index.html'));
});

app.get('/classic/*', (req, res) => {
  return res.sendFile(path.resolve(__dirname, '..', 'index.html'));
});

app.get('/', (req, res) => {
  if (AUTH_ENABLED && !getAccountFromSession(req)) {
    return sendReactAuthGate(res);
  }

  return res.redirect('/react/');
});

app.get('*', (req, res) => {
  if (AUTH_ENABLED && !getAccountFromSession(req)) {
    return sendReactAuthGate(res);
  }

  return res.redirect('/react/');
});

async function runStartupWarmup() {
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

  try {
    const settings = await getEffectiveSchedulerSettings();
    startIngestionScheduler(settings.ingest);
    startLivePlacementScheduler(settings.livePlacement);
  } catch (err) {
    console.warn('⚠ Failed to load DB scheduler settings; falling back to environment defaults:', err.message);
    startIngestionScheduler();
    startLivePlacementScheduler();
  }

  if (process.env.SQL_SERVER) {
    try {
      const success = await applyIndexes();
      if (success) {
        console.log('✓ Performance indexes verified/created');
      } else {
        console.warn('⚠ Could not apply performance indexes - will retry on next startup');
      }
    } catch (err) {
      console.warn('⚠ Performance index setup failed (non-blocking):', err.message);
    }
  }

  try {
    const seedResult = await seedVmSkuCatalogIfEmpty();
    if (seedResult.seeded) {
      console.log(`[VmSkuCatalog] Seeded ${seedResult.count} VM SKU catalog rows from ARM (region=${seedResult.region}).`);
    }
  } catch (err) {
    console.warn('⚠ VmSkuCatalog seed failed (non-blocking):', err?.message || err);
  }
}

async function startServer() {
  app.listen(port, () => {
    console.log(`Capacity dashboard listening on port ${port}`);
    runStartupWarmup().catch((err) => {
      console.warn('⚠ Startup warmup encountered an error (non-blocking):', err?.message || err);
    });
  });
}

startServer();
