const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
// Load local overrides — gitignored, safe to customise for local dev
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local'), override: true });

const session = require('express-session');
const { AUTH_ENABLED, buildAuthRouter, requireAuth, requireAdmin, getAccountFromSession, isAdmin } = require('./middleware/auth');

const {
  getCapacityRows,
  getCapacityRowsPaginated,
  getSubscriptions,
  getSubscriptionSummary,
  getCapacityTrends,
  getFamilySummary,
  getCapacityScoreSummary
} = require('./services/capacityService');
const { getLivePlacementScoreRows } = require('./services/livePlacementService');
const { getQuotaCandidates, captureQuotaCandidateSnapshots } = require('./services/quotaCandidateService');
const { buildQuotaMovePlan, getQuotaCandidateRunHistory, simulateQuotaMovePlan } = require('./services/quotaPlanService');
const {
  runCapacityIngestion,
  getIngestionStatus,
  startIngestionScheduler
} = require('./services/azureIngestionService');
const { listManagementGroups, listQuotaGroups } = require('./services/quotaDiscoveryService');
const { ensurePhase3Schema, getCapacityScoreSnapshotHistory } = require('./store/sql');

const app = express();
const port = process.env.PORT || 3000;

// Trust Azure App Service's reverse proxy so req.secure is correct for HTTPS
// connections. Required for secure session cookies to work on App Service.
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

// Session — required for MSAL auth code flow state and account storage
app.use(session({
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

// Protect all API routes; /api/auth/me is always open (used to check auth state)
app.use('/api', (req, res, next) => {
  if (req.path === '/auth/me') return next();
  requireAuth(req, res, next);
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
    const rows = await getCapacityScoreSummary({
      regionPreset: req.query.regionPreset,
      subscriptionIds: req.query.subscriptionIds,
      region: req.query.region,
      family: req.query.family,
      availability: req.query.availability
    });
    res.json({ rows });
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

app.listen(port, () => {
  startIngestionScheduler();
  console.log(`Capacity dashboard listening on port ${port}`);
});
