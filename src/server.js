const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
// Load local overrides — gitignored, safe to customise for local dev
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local'), override: true });

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
const {
  getLivePlacementScoreRows,
  startLivePlacementScheduler,
  updateLivePlacementScheduler,
  getLivePlacementSchedulerConfig
} = require('./services/livePlacementService');
const { getQuotaCandidates, captureQuotaCandidateSnapshots } = require('./services/quotaCandidateService');
const { buildQuotaMovePlan, getQuotaCandidateRunHistory, simulateQuotaMovePlan } = require('./services/quotaPlanService');
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
  ensurePhase3Schema,
  ensureSubscriptionsTableSchema,
  getCapacityScoreSnapshotHistory,
  insertDashboardErrorLog,
  listDashboardErrorLogs,
  logDashboardOperation,
  listDashboardOperations,
  getDashboardSettings,
  upsertDashboardSettings
} = require('./store/sql');
const { applyIndexes } = require('./maintenance/applyPerformanceIndexes');

const app = express();
const port = process.env.PORT || 3000;

const DASHBOARD_SETTING_KEYS = {
  ingestIntervalMinutes: 'schedule.ingest.intervalMinutes',
  ingestRunOnStartup: 'schedule.ingest.runOnStartup',
  livePlacementIntervalMinutes: 'schedule.livePlacement.intervalMinutes',
  livePlacementRunOnStartup: 'schedule.livePlacement.runOnStartup'
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

app.use(session({
  store: buildSessionStore(),
  secret: process.env.SESSION_SECRET || 'dev-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  }
}));

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

app.use(express.static(path.resolve(__dirname, '..')));

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
    const rows = await getCapacityRows({
      regionPreset: req.query.regionPreset,
      subscriptionIds: req.query.subscriptionIds,
      region: req.query.region,
      family: req.query.family,
      availability: req.query.availability
    });
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve capacity rows', detail: err.message });
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
      region: req.body?.region,
      family: req.body?.family
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.message.includes('required') || err.message.includes('Run Capture History first') ? 400 : 500;
    res.status(status).json({ ok: false, error: err.message, impactRows: [] });
  }
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

app.get('/api/capacity/trends', async (req, res) => {
  try {
    const rows = await getCapacityTrends({
      days: req.query.days,
      regionPreset: req.query.regionPreset,
      subscriptionIds: req.query.subscriptionIds,
      region: req.query.region,
      family: req.query.family,
      availability: req.query.availability
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
      availability: req.query.availability
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
    const status = err.message.includes('not found') || err.message.includes('not configured') ? 503 : 500;
    res.status(status).json({ error: 'Failed to retrieve live placement scores', detail: err.message, rows: [] });
  }
});

app.post('/api/admin/ingest/capacity', requireAdmin, async (req, res) => {
  try {
    const result = await runCapacityIngestion({
      regionPreset: req.body?.regionPreset,
      regions: req.body?.regions,
      subscriptionIds: req.body?.subscriptionIds,
      familyFilters: req.body?.familyFilters
    });
    res.json({ ok: true, result, status: getIngestionStatus() });
  } catch (err) {
    const code = err.message === 'Capacity ingestion is already running.' ? 409 : 500;
    res.status(code).json({ ok: false, error: err.message, status: getIngestionStatus() });
  }
});

app.get('/api/admin/ingest/status', requireAdmin, (_, res) => {
  res.json({ ok: true, status: getIngestionStatus() });
});

app.get('/api/admin/ingest/schedule', requireAdmin, async (_, res) => {
  try {
    const persisted = await getEffectiveSchedulerSettings();
    const runtime = {
      ingest: getIngestionSchedulerConfig(),
      livePlacement: getLivePlacementSchedulerConfig()
    };

    res.json({ ok: true, settings: persisted, runtime });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Failed to load scheduler settings.' });
  }
});

app.put('/api/admin/ingest/schedule', requireAdmin, async (req, res) => {
  try {
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

    res.json({ ok: true, settings: savedSettings, runtime });
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

app.get('*', (_, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'index.html'));
});

async function startServer() {
  try {
    await ensureSessionStoreSchema();
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
