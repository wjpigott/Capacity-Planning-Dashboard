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

const DEFAULT_PAAS_WORKER_TIMEOUT_MS = 10 * 60 * 1000;

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

function normalizeEditionList(value) {
  const values = Array.isArray(value) ? value : parseCsv(value);
  return values
    .filter(Boolean)
    .map((item) => {
      if (item === 'generalpurpose') return 'GeneralPurpose';
      if (item === 'businesscritical') return 'BusinessCritical';
      if (item === 'hyperscale') return 'Hyperscale';
      return item;
    });
}

function resolveWorkerBaseUrl() {
  return (process.env.CAPACITY_WORKER_BASE_URL || '').trim().replace(/\/$/, '');
}

function resolveWorkerSharedSecret() {
  return (process.env.CAPACITY_WORKER_SHARED_SECRET || '').trim();
}

function shouldDisableLocalFallback() {
  return String(process.env.CAPACITY_WORKER_DISABLE_LOCAL_FALLBACK || '').toLowerCase() === 'true';
}

function resolvePaaSWorkerTimeoutMs() {
  const configuredTimeoutMs = Number(process.env.CAPACITY_PAAS_WORKER_TIMEOUT_MS || 0);
  if (Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0) {
    return Math.max(configuredTimeoutMs, 1000);
  }

  return DEFAULT_PAAS_WORKER_TIMEOUT_MS;
}

async function getPowerShellMajorVersion(command) {
  try {
    const { stdout } = await execFileAsync(command, [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      '[int]$PSVersionTable.PSVersion.Major'
    ], {
      cwd: resolveProjectRoot(),
      env: process.env,
      maxBuffer: 1024 * 1024,
      timeout: 30000
    });

    const parsed = Number.parseInt(String(stdout || '').trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
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

function buildMergedMetadata(metadata, diagnostics) {
  if (metadata && diagnostics) {
    return {
      ...metadata,
      executionDiagnostics: diagnostics
    };
  }

  if (metadata) {
    return metadata;
  }

  if (diagnostics) {
    return { executionDiagnostics: diagnostics };
  }

  return {};
}

async function persistPaaSScanResult(rows, { requestedService, regionPreset, regions, metadata }) {
  try {
    const snapshotResult = await savePaaSAvailabilitySnapshots(rows, {
      requestedService,
      requestedRegionPreset: regionPreset,
      requestedRegions: regions,
      metadata: metadata || null
    });

    return {
      runId: snapshotResult.runId,
      rowCount: snapshotResult.rowCount,
      warning: null
    };
  } catch (error) {
    const warning = `PaaS availability rows were returned, but snapshot persistence failed: ${String(error?.message || 'unknown failure').trim()}`;

    await insertDashboardErrorLog({
      severity: 'warn',
      source: 'paas-availability',
      message: warning,
      context: { requestedService, regionPreset, regions }
    }).catch(() => {});

    return {
      runId: null,
      rowCount: 0,
      warning
    };
  }
}

async function finalizePaaSScanResult(parsed, { requestedService, regionPreset, regions, source, diagnostics }) {
  if (!parsed || !Array.isArray(parsed.rows)) {
    throw new Error('PaaS availability scan returned invalid JSON output.');
  }

  const rows = parsed.rows.map((row) => ({
    ...row,
    service: row.service || requestedService
  }));
  const effectiveRegions = parsed.summary?.regions || regions;
  const metadata = buildMergedMetadata(parsed.metadata || {}, diagnostics);
  const persistence = await persistPaaSScanResult(rows, {
    requestedService,
    regionPreset,
    regions: effectiveRegions,
    metadata
  });

  await logDashboardOperation({
    operationType: 'paas-scan',
    target: requestedService,
    status: 'success',
    note: persistence.warning
      ? `Captured ${rows.length} PaaS availability rows with persistence warning.`
      : `Captured ${rows.length} PaaS availability rows.`
  }).catch(() => {});

  return {
    ok: true,
    source,
    capturedAtUtc: parsed.capturedAtUtc,
    rows,
    summary: {
      ...(parsed.summary || {}),
      serviceSummary: groupRowsByService(rows),
      runId: persistence.runId,
      persistedRowCount: persistence.rowCount,
      persistenceWarning: persistence.warning
    },
    facets: buildFacets(rows),
    metadata
  };
}

async function runRemotePaaSAvailabilityScan(options = {}) {
  const baseUrl = resolveWorkerBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const controller = new AbortController();
  const timeoutMs = resolvePaaSWorkerTimeoutMs();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/api/paas-availability`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(resolveWorkerSharedSecret() ? { 'x-capacity-worker-key': resolveWorkerSharedSecret() } : {})
      },
      body: JSON.stringify(options),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.detail || payload?.error || `Remote worker failed with status ${response.status}.`);
    }

    return {
      parsed: payload?.result || payload,
      diagnostics: payload?.diagnostics || {
        executionMode: 'function-app',
        workerUrl: baseUrl
      }
    };
  } catch (error) {
    const prefix = error?.name === 'AbortError'
      ? `Remote worker timed out after ${timeoutMs}ms`
      : 'Remote worker call failed';
    throw new Error(`${prefix}: ${error.message}`);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function buildLocalPaaSArgs({ wrapperPath, repoRoot, requestedService, regions, regionPreset, edition, computeModel, sqlResourceType, includeDisabled, fetchPricing }) {
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

  return args;
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

async function probePowerShellRuntime(command, env) {
  try {
    const { stdout, stderr } = await execFileAsync(command, [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      "$payload = [pscustomobject]@{ ok = $true; psVersion = $PSVersionTable.PSVersion.ToString(); psEdition = $PSVersionTable.PSEdition; }; $payload | ConvertTo-Json -Compress"
    ], {
      cwd: resolveProjectRoot(),
      env,
      maxBuffer: 1024 * 1024,
      timeout: 30000
    });

    return {
      ok: true,
      payload: parseJsonFromMixedOutput(stdout),
      stderr: String(stderr || '').slice(0, 500)
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || 'unknown failure').trim(),
      stdout: String(error?.stdout || '').slice(0, 500),
      stderr: String(error?.stderr || '').slice(0, 500)
    };
  }
}

async function probePaaSModuleImport(command, env, repoRoot) {
  const modulePath = path.join(repoRoot, 'AzPaaSAvailability');

  try {
    const { stdout, stderr } = await execFileAsync(command, [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      `$modulePath = '${modulePath.replace(/'/g, "''")}'; Import-Module $modulePath -Force -ErrorAction Stop; $payload = [pscustomobject]@{ ok = $true; modulePath = $modulePath; commandCount = @((Get-Command -Module AzPaaSAvailability -ErrorAction SilentlyContinue)).Count }; $payload | ConvertTo-Json -Compress`
    ], {
      cwd: resolveProjectRoot(),
      env,
      maxBuffer: 1024 * 1024,
      timeout: 60000
    });

    return {
      ok: true,
      payload: parseJsonFromMixedOutput(stdout),
      stderr: String(stderr || '').slice(0, 500)
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || 'unknown failure').trim(),
      stdout: String(error?.stdout || '').slice(0, 500),
      stderr: String(error?.stderr || '').slice(0, 500)
    };
  }
}

async function getPaaSPowerShellProbe() {
  const repoRoot = resolvePaaSRepoRoot();
  const powerShellRuntime = await getPowerShellCommands();
  const results = [];

  for (const command of powerShellRuntime.commands) {
    const majorVersion = await getPowerShellMajorVersion(command);
    const env = await ensureAzPlacementModules(command).catch(() => ({ ...process.env }));
    const shellProbe = await probePowerShellRuntime(command, env);
    const moduleProbe = majorVersion != null && majorVersion < 7
      ? {
          ok: false,
          skipped: true,
          error: `requires-powershell-7 | detectedVersion=${majorVersion}`
        }
      : await probePaaSModuleImport(command, env, repoRoot);

    results.push({
      runtime: command,
      majorVersion,
      shellProbe,
      moduleProbe
    });
  }

  return {
    ok: results.some((entry) => entry.shellProbe?.ok || entry.moduleProbe?.ok),
    wrapperPath: resolvePaaSWrapperPath(),
    repoRoot,
    runtimes: results,
    diagnostics: powerShellRuntime.diagnostics || {}
  };
}

async function runPaaSAvailabilityScan(options = {}) {
  const wrapperPath = resolvePaaSWrapperPath();
  const repoRoot = resolvePaaSRepoRoot();
  const requestedService = normalizeRequestedService(options.service);
  const regions = Array.isArray(options.regions) ? options.regions : parseCsv(options.regions);
  const regionPreset = String(options.regionPreset || '').trim() || null;
  const edition = normalizeEditionList(options.edition);
  const computeModel = String(options.computeModel || '').trim() || null;
  const sqlResourceType = String(options.sqlResourceType || 'SqlDatabase').trim() || 'SqlDatabase';
  const includeDisabled = Boolean(options.includeDisabled);
  const fetchPricing = Boolean(options.fetchPricing);

  const requestOptions = {
    service: requestedService,
    regions,
    regionPreset,
    edition,
    computeModel,
    sqlResourceType,
    includeDisabled,
    fetchPricing
  };

  if (resolveWorkerBaseUrl()) {
    try {
      const remoteResult = await runRemotePaaSAvailabilityScan(requestOptions);
      return await finalizePaaSScanResult(remoteResult.parsed, {
        requestedService,
        regionPreset,
        regions,
        source: 'function-worker',
        diagnostics: remoteResult.diagnostics
      });
    } catch (error) {
      if (shouldDisableLocalFallback()) {
        throw error;
      }
    }
  }

  const powerShellRuntime = await getPowerShellCommands();
  const runtimeFailures = [];

  for (const command of powerShellRuntime.commands) {
    const majorVersion = await getPowerShellMajorVersion(command);
    if (majorVersion != null && majorVersion < 7) {
      runtimeFailures.push(`runtime=${command} | error=requires-powershell-7 | detectedVersion=${majorVersion}`);
      continue;
    }

    try {
      const env = await ensureAzPlacementModules(command).catch(() => ({ ...process.env }));
      const args = buildLocalPaaSArgs({
        wrapperPath,
        repoRoot,
        requestedService,
        regions,
        regionPreset,
        edition,
        computeModel,
        sqlResourceType,
        includeDisabled,
        fetchPricing
      });

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

      return await finalizePaaSScanResult(parsed, {
        requestedService,
        regionPreset,
        regions,
        source: 'live-scan',
        diagnostics: {
          executionMode: 'local-app-service',
          shellCommand: command,
          runtimeRoot: powerShellRuntime.diagnostics.runtimeRoot,
          portablePwshPath: powerShellRuntime.diagnostics.portablePwshPath,
          portablePwshExists: powerShellRuntime.diagnostics.portablePwshExists,
          archivePath: powerShellRuntime.diagnostics.archivePath,
          archiveExists: powerShellRuntime.diagnostics.archiveExists,
          archiveSizeBytes: powerShellRuntime.diagnostics.archiveSizeBytes,
          extractedEntries: powerShellRuntime.diagnostics.extractedEntries,
          bootstrapError: powerShellRuntime.diagnostics.bootstrapError,
          moduleBootstrapError: powerShellRuntime.diagnostics.moduleBootstrapError
        }
      });
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
  getPaaSAvailabilitySnapshot,
  getPaaSPowerShellProbe
};