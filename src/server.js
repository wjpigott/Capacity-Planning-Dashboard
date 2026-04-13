const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const {
  getCapacityRows,
  getSubscriptions,
  getSubscriptionSummary,
  getCapacityTrends,
  getFamilySummary
} = require('./services/capacityService');
const {
  runCapacityIngestion,
  getIngestionStatus,
  startIngestionScheduler
} = require('./services/azureIngestionService');
const { ensurePhase3Schema } = require('./store/sql');

const app = express();
const port = process.env.PORT || 3000;
const adminRoleName = process.env.ADMIN_ROLE_NAME || 'CapacityAdmin';
const adminRbacMode = (process.env.ADMIN_RBAC_MODE || 'off').toLowerCase();

app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, '..')));

function parseClientPrincipal(req) {
  const encoded = req.header('x-ms-client-principal');
  if (!encoded) {
    return {
      isAuthenticated: false,
      name: null,
      userId: null,
      roles: []
    };
  }

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const principal = JSON.parse(decoded);
    const claims = Array.isArray(principal.claims) ? principal.claims : [];
    const roleType = (principal.role_typ || '').toLowerCase();
    const roleValues = claims
      .filter((claim) => {
        const claimType = (claim.typ || '').toLowerCase();
        return claimType === roleType || claimType.endsWith('/claims/role') || claimType === 'roles';
      })
      .map((claim) => claim.val)
      .filter(Boolean);

    return {
      isAuthenticated: true,
      name: principal.name || claims.find((claim) => claim.typ === principal.name_typ)?.val || null,
      userId: principal.userId || claims.find((claim) => claim.typ === 'http://schemas.microsoft.com/identity/claims/objectidentifier')?.val || null,
      roles: [...new Set([...(principal.userRoles || []), ...roleValues])]
    };
  } catch {
    return {
      isAuthenticated: false,
      name: null,
      userId: null,
      roles: []
    };
  }
}

function isAdminPrincipal(principal) {
  return principal.roles.some((role) => String(role).toLowerCase() === adminRoleName.toLowerCase());
}

function requireAdminRole(req, res, next) {
  if (adminRbacMode !== 'enforce') {
    next();
    return;
  }

  const principal = parseClientPrincipal(req);
  if (!principal.isAuthenticated) {
    res.status(401).json({ ok: false, error: 'Authentication is required for Admin access.' });
    return;
  }

  if (!isAdminPrincipal(principal)) {
    res.status(403).json({ ok: false, error: `Admin role '${adminRoleName}' is required.` });
    return;
  }

  next();
}

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
  const principal = parseClientPrincipal(req);
  const isAdmin = isAdminPrincipal(principal);

  res.json({
    ok: true,
    auth: {
      mode: adminRbacMode,
      adminRoleName,
      isAuthenticated: principal.isAuthenticated,
      principalName: principal.name,
      userId: principal.userId,
      roles: principal.roles,
      isAdmin,
      canAccessAdmin: adminRbacMode === 'enforce' ? isAdmin : true
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

app.get('/api/quota/groups', (_, res) => {
  res.json({
    groups: [
      { managementGroupName: 'placeholder-mg', groupQuotaName: 'placeholder-group', provisioningState: 'Succeeded' }
    ]
  });
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

app.post('/api/admin/ingest/capacity', requireAdminRole, async (req, res) => {
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

app.get('/api/admin/ingest/status', requireAdminRole, (_, res) => {
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
