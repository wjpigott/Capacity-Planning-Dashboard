const { execFile } = require('child_process');
const path = require('path');
const {
  getPowerShellCommands,
  ensureAzPlacementModules,
  resolveProjectRoot
} = require('./livePlacementService');
const {
  savePaaSDatabaseQuotaSnapshots,
  getLatestPaaSDatabaseQuotaSnapshots,
  logDashboardOperation,
  insertDashboardErrorLog
} = require('../store/sql');

const DEFAULT_MAX_AGE_HOURS = 168;

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseJsonFromMixedOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      return null;
    }

    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

function parseCsv(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function normalizeServices(value) {
  const raw = Array.isArray(value) ? value : parseCsv(value || 'All');
  const allowed = new Set(['All', 'CosmosDB', 'SqlDB', 'SqlMI', 'PostgreSQL', 'MySQL']);
  const services = raw.map((item) => String(item || '').trim()).filter((item) => allowed.has(item));
  return services.length > 0 ? services : ['All'];
}

function buildFacets(rows = []) {
  return {
    datasets: [...new Set(rows.map((row) => String(row.dataset || '').trim()).filter(Boolean))].sort(),
    services: [...new Set(rows.map((row) => String(row.service || '').trim()).filter(Boolean))].sort(),
    regions: [...new Set(rows.map((row) => String(row.region || '').trim().toLowerCase()).filter((region) => region && region !== 'subscription'))].sort(),
    subscriptions: [...new Set(rows.map((row) => String(row.subscriptionName || row.subscriptionId || '').trim()).filter(Boolean))].sort()
  };
}

function summarizeRows(rows = [], fallback = {}) {
  const usageRows = rows.filter((row) => row.dataset === 'usage');
  const accessRows = rows.filter((row) => row.dataset === 'access');
  const isBlockedAccess = (row) => row.accessAllowedForRegion === false
    || row.accessAllowedForRegion === 'false'
    || row.accessAllowedForRegion === 'False'
    || row.accessAllowedForAZ === false
    || row.accessAllowedForAZ === 'false'
    || row.accessAllowedForAZ === 'False';
  return {
    ...fallback,
    rowCount: rows.length,
    usageRowCount: usageRows.length,
    accessRowCount: accessRows.length,
    capabilityRowCount: rows.filter((row) => row.dataset === 'capability').length,
    warningCount: usageRows.filter((row) => Number(row.percentUsed) >= 80).length,
    blockedAccessCount: accessRows.filter(isBlockedAccess).length
  };
}

function resolveWrapperPath() {
  return process.env.CAPACITY_PAAS_DB_QUOTA_WRAPPER_PATH
    || path.resolve(__dirname, '..', '..', 'tools', 'Get-PaaSDatabaseQuotaReport.ps1');
}

function buildArgs({ wrapperPath, subscriptionIds, locations, services, includeCapabilities }) {
  const args = [
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    wrapperPath,
    '-SubscriptionIdsJson',
    JSON.stringify(subscriptionIds),
    '-LocationsJson',
    JSON.stringify(locations),
    '-Services',
    ...services
  ];

  if (includeCapabilities) {
    args.push('-IncludeCapabilities');
  }

  return args;
}

async function persistResult(parsed, options) {
  const startedAt = Date.now();
  const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
  const summary = parsed.summary || {};
  const persistence = await savePaaSDatabaseQuotaSnapshots(rows, {
    requestedServices: options.services,
    requestedRegions: options.locations,
    requestedSubscriptions: options.subscriptionIds,
    includeCapabilities: options.includeCapabilities,
    metadata: parsed.metadata || null
  });

  await logDashboardOperation({
    operationType: 'paas-db-quota-scan',
    target: options.services.join(','),
    status: 'success',
    note: `Captured ${rows.length} PaaS database quota rows; persisted ${persistence.rowCount}.`
  }).catch(() => {});

  const timings = {
    scanDurationMs: Number(summary.scanDurationMs || 0) || null,
    persistenceDurationMs: persistence.durationMs || null,
    totalServiceDurationMs: Date.now() - startedAt
  };

  return {
    ok: true,
    source: 'live-scan',
    capturedAtUtc: parsed.capturedAtUtc,
    rows,
    summary: {
      ...summarizeRows(rows, summary),
      runId: persistence.runId,
      persistedRowCount: persistence.rowCount,
      failedPersistedRowCount: persistence.failedRowCount || 0,
      persistenceWarnings: Array.isArray(persistence.failedRows) ? persistence.failedRows : [],
      timings
    },
    facets: buildFacets(rows),
    metadata: parsed.metadata || null
  };
}

async function runPaaSDatabaseQuotaScan(options = {}) {
  const serviceStartedAt = Date.now();
  const wrapperPath = resolveWrapperPath();
  const subscriptionIds = Array.isArray(options.subscriptionIds) ? options.subscriptionIds.map(String).filter(Boolean) : parseCsv(options.subscriptionIds);
  const locations = Array.isArray(options.locations) ? options.locations.map(String).filter(Boolean) : parseCsv(options.locations || options.regions);
  const services = normalizeServices(options.services || options.service);
  const includeCapabilities = Boolean(options.includeCapabilities);

  if (locations.length === 0) {
    throw new Error('At least one region is required for PaaS database quota scans.');
  }

  const powerShellRuntime = await getPowerShellCommands();
  const runtimeFailures = [];

  for (const command of powerShellRuntime.commands) {
    try {
      const env = await ensureAzPlacementModules(command).catch(() => ({ ...process.env }));
      const args = buildArgs({ wrapperPath, subscriptionIds, locations, services, includeCapabilities });
      const runtimeStartedAt = Date.now();
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: resolveProjectRoot(),
        env,
        maxBuffer: 16 * 1024 * 1024,
        timeout: Number(process.env.CAPACITY_PAAS_DB_QUOTA_TIMEOUT_MS || 10 * 60 * 1000)
      });

      const parsed = parseJsonFromMixedOutput(stdout) || parseJsonFromMixedOutput(`${stdout || ''}\n${stderr || ''}`);
      if (!parsed || !Array.isArray(parsed.rows)) {
        runtimeFailures.push(`runtime=${command} | error=invalid-json | stdout=${String(stdout || '').slice(0, 500)} | stderr=${String(stderr || '').slice(0, 500)}`);
        continue;
      }

      parsed.summary = {
        ...(parsed.summary || {}),
        runtimeCommand: command,
        runtimeDurationMs: Date.now() - runtimeStartedAt,
        serviceElapsedMs: Date.now() - serviceStartedAt
      };

      return await persistResult(parsed, { subscriptionIds, locations, services, includeCapabilities });
    } catch (error) {
      runtimeFailures.push(`runtime=${command} | error=${String(error?.message || 'unknown failure').trim()} | stderr=${String(error?.stderr || '').slice(0, 500)} | stdout=${String(error?.stdout || '').slice(0, 500)}`);
    }
  }

  const failureMessage = runtimeFailures.length > 0
    ? `PaaS database quota scan failed across all PowerShell runtimes. ${runtimeFailures.join(' || ')}`
    : 'PaaS database quota scan failed: no supported PowerShell executable was found.';

  await insertDashboardErrorLog({
    severity: 'error',
    source: 'paas-db-quota',
    message: failureMessage,
    context: { subscriptionIds, locations, services, includeCapabilities }
  }).catch(() => {});

  throw new Error(failureMessage);
}

async function getPaaSDatabaseQuotaSnapshot(options = {}) {
  const snapshot = await getLatestPaaSDatabaseQuotaSnapshots({
    maxAgeHours: options.maxAgeHours || DEFAULT_MAX_AGE_HOURS
  });
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];

  return {
    ok: true,
    source: 'sql-snapshot',
    capturedAtUtc: snapshot.capturedAtUtc || null,
    rows,
    summary: summarizeRows(rows, {
      runId: snapshot.runId || null,
      requestedServices: snapshot.requestedServices || [],
      requestedRegions: snapshot.requestedRegions || [],
      requestedSubscriptions: snapshot.requestedSubscriptions || [],
      includeCapabilities: Boolean(snapshot.includeCapabilities)
    }),
    facets: buildFacets(rows),
    metadata: snapshot.metadata || null
  };
}

module.exports = {
  runPaaSDatabaseQuotaScan,
  getPaaSDatabaseQuotaSnapshot
};