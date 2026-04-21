const { execFile } = require('child_process');
const path = require('path');
const {
  getPowerShellCommands,
  ensureAzPlacementModules,
  resolveProjectRoot
} = require('./livePlacementService');
const {
  savePaaSAvailabilitySnapshots,
  getLatestPaaSAvailabilitySnapshots,
  logDashboardOperation,
  insertDashboardErrorLog
} = require('../store/sql');

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

function parseCsv(rawValue) {
  if (!rawValue) {
    return [];
  }

  return String(rawValue)
    .split(',')
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

function normalizeRequestedService(value) {
  const raw = String(value || 'All').trim();
  const supported = new Set(['All', 'SqlDatabase', 'CosmosDB', 'PostgreSQL', 'MySQL', 'AppService', 'ContainerApps', 'AKS', 'Functions', 'Storage']);
  return supported.has(raw) ? raw : 'All';
}

function resolvePaaSWrapperPath() {
  return process.env.CAPACITY_PAAS_WRAPPER_PATH
    || path.resolve(__dirname, '..', '..', 'tools', 'Get-PaaSAvailabilityReport.ps1');
}

function resolvePaaSRepoRoot() {
  const configuredRoot = String(process.env.GET_AZ_PAAS_AVAILABILITY_ROOT || '').trim();
  if (configuredRoot) {
    return configuredRoot;
  }

  return path.resolve(__dirname, '..', '..', 'tools', 'Get-AzPaaSAvailability');
}

function groupRowsByService(rows = []) {
  const summaryMap = new Map();

  rows.forEach((row) => {
    const service = String(row.service || 'Unknown');
    if (!summaryMap.has(service)) {
      summaryMap.set(service, {
        service,
        rowCount: 0,
        availableCount: 0,
        regionCount: 0,
        categoryCount: 0
      });
    }

    const current = summaryMap.get(service);
    current.rowCount += 1;
    if (row.available === true) {
      current.availableCount += 1;
    }
  });

  return Array.from(summaryMap.values()).sort((left, right) => left.service.localeCompare(right.service));
}

function buildFacets(rows = []) {
  return {
    services: [...new Set(rows.map((row) => String(row.service || '').trim()).filter(Boolean))].sort(),
    regions: [...new Set(rows.map((row) => String(row.region || '').trim().toLowerCase()).filter((value) => value && value !== 'global'))].sort(),
    categories: [...new Set(rows.map((row) => String(row.category || '').trim()).filter(Boolean))].sort()
  };
}

async function runPaaSAvailabilityScan(options = {}) {
  const wrapperPath = resolvePaaSWrapperPath();
  const repoRoot = resolvePaaSRepoRoot();
  const requestedService = normalizeRequestedService(options.service);
  const regions = Array.isArray(options.regions) ? options.regions : parseCsv(options.regions);
  const regionPreset = String(options.regionPreset || '').trim() || null;
  const edition = Array.isArray(options.edition)
    ? options.edition.filter(Boolean)
    : parseCsv(options.edition).map((value) => {
        if (value === 'generalpurpose') return 'GeneralPurpose';
        if (value === 'businesscritical') return 'BusinessCritical';
        if (value === 'hyperscale') return 'Hyperscale';
        return value;
      });
  const computeModel = String(options.computeModel || '').trim() || null;
  const sqlResourceType = String(options.sqlResourceType || 'SqlDatabase').trim() || 'SqlDatabase';
  const includeDisabled = Boolean(options.includeDisabled);
  const fetchPricing = Boolean(options.fetchPricing);

  const powerShellRuntime = await getPowerShellCommands();
  const runtimeFailures = [];

  for (const command of powerShellRuntime.commands) {
    try {
      const env = await ensureAzPlacementModules(command).catch(() => ({ ...process.env }));
      const args = [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        wrapperPath,
        '-RepoRoot',
        repoRoot,
        '-Service',
        requestedService,
        '-SqlResourceType',
        sqlResourceType
      ];

      if (regions.length > 0) {
        args.push('-RegionsJson', JSON.stringify(regions));
      }
      if (regionPreset) {
        args.push('-RegionPreset', regionPreset);
      }
      if (edition.length > 0) {
        args.push('-Edition', ...edition);
      }
      if (computeModel) {
        args.push('-ComputeModel', computeModel);
      }
      if (includeDisabled) {
        args.push('-IncludeDisabled');
      }
      if (fetchPricing) {
        args.push('-FetchPricing');
      }

      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: resolveProjectRoot(),
        env,
        maxBuffer: 8 * 1024 * 1024,
        timeout: 10 * 60 * 1000
      });

      const parsed = parseJsonFromMixedOutput(stdout) || parseJsonFromMixedOutput(`${stdout || ''}\n${stderr || ''}`);
      if (!parsed || !Array.isArray(parsed.rows)) {
        runtimeFailures.push(`runtime=${command} | error=invalid-json | stdout=${String(stdout || '').slice(0, 500)} | stderr=${String(stderr || '').slice(0, 500)}`);
        continue;
      }

      const rows = parsed.rows.map((row) => ({
        ...row,
        service: row.service || requestedService
      }));
      const snapshotResult = await savePaaSAvailabilitySnapshots(rows, {
        requestedService,
        requestedRegionPreset: regionPreset,
        requestedRegions: parsed.summary?.regions || regions,
        metadata: parsed.metadata || null
      });

      await logDashboardOperation({
        operationType: 'paas-scan',
        target: requestedService,
        status: 'success',
        note: `Captured ${rows.length} PaaS availability rows.`
      }).catch(() => {});

      return {
        ok: true,
        source: 'live-scan',
        capturedAtUtc: parsed.capturedAtUtc,
        rows,
        summary: {
          ...(parsed.summary || {}),
          serviceSummary: groupRowsByService(rows),
          runId: snapshotResult.runId,
          persistedRowCount: snapshotResult.rowCount
        },
        facets: buildFacets(rows),
        metadata: parsed.metadata || {}
      };
    } catch (error) {
      if (error?.code === 'ENOENT') {
        runtimeFailures.push(`runtime=${command} | error=ENOENT`);
        continue;
      }

      runtimeFailures.push(`runtime=${command} | error=${String(error?.message || 'unknown failure').trim()} | stderr=${String(error?.stderr || '').slice(0, 500)} | stdout=${String(error?.stdout || '').slice(0, 500)}`);
    }
  }

  const failureMessage = runtimeFailures.length > 0
    ? `PaaS availability scan failed across all PowerShell runtimes. ${runtimeFailures.join(' || ')}`
    : 'PaaS availability scan failed: no supported PowerShell executable was found.';

  await insertDashboardErrorLog({
    severity: 'error',
    source: 'paas-availability',
    message: failureMessage,
    context: { requestedService, regionPreset, regions }
  }).catch(() => {});

  throw new Error(failureMessage);
}

async function getPaaSAvailabilitySnapshot(options = {}) {
  const requestedService = normalizeRequestedService(options.service);
  const snapshot = await getLatestPaaSAvailabilitySnapshots({
    requestedService,
    maxAgeHours: options.maxAgeHours
  });

  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  return {
    ok: true,
    source: 'sql-snapshot',
    capturedAtUtc: snapshot.capturedAtUtc || null,
    rows,
    summary: {
      runId: snapshot.runId || null,
      requestedService: snapshot.requestedService || requestedService,
      requestedRegionPreset: snapshot.requestedRegionPreset || null,
      requestedRegions: snapshot.requestedRegions || [],
      rowCount: rows.length,
      serviceSummary: groupRowsByService(rows)
    },
    facets: buildFacets(rows),
    metadata: snapshot.metadata || null
  };
}

module.exports = {
  runPaaSAvailabilityScan,
  getPaaSAvailabilitySnapshot
};