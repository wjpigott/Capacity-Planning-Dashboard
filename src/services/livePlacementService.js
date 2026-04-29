const fs = require('fs');
const { execFile } = require('child_process');
const https = require('https');
const path = require('path');
const { pipeline } = require('stream/promises');
const { getCapacityScoreSummary } = require('./capacityService');
const { getRegionsForPreset } = require('../config/regionPresets');
const { saveLivePlacementSnapshots, logDashboardOperation, insertDashboardErrorLog } = require('../store/sql');

// The current Dev worker/Az.Compute path is reliable for one SKU per request.
// Larger multi-SKU batches can return a non-JSON service payload that the cmdlet cannot parse.
const DEFAULT_MAX_SKUS_PER_CALL = 1;
const DEFAULT_MAX_REGIONS_PER_CALL = 8;
const POWERSHELL_RELEASE_API = 'https://api.github.com/repos/PowerShell/PowerShell/releases/latest';
const DEFAULT_WORKER_TIMEOUT_MS = 60000;
const DEFAULT_RECOMMENDATION_WORKER_TIMEOUT_MS = 180000;
const DEFAULT_MAX_LIVE_PLACEMENT_CALLS = 10;

let portablePowerShellPromise;
let azModuleBootstrapPromise;
let portablePowerShellError = null;
let azModuleBootstrapError = null;
let livePlacementSchedulerHandle;
let livePlacementSchedulerConfig = {
  intervalMinutes: 0,
  runOnStartup: false
};
let livePlacementRefreshInProgress = false;

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

function isAggregateSkuName(value) {
  const normalized = String(value || '').trim();
  return /(?:^|[_-])aggregate$/i.test(normalized) || /family-aggregate$/i.test(normalized);
}

function normalizeRecommendationContract(contract) {
  if (!contract || typeof contract !== 'object') {
    return contract;
  }

  const normalizeRecommendationRow = (row) => {
    if (!row || typeof row !== 'object') {
      return row;
    }

    return {
      ...row,
      sku: normalizeSkuName(row.sku)
    };
  };

  return {
    ...contract,
    target: contract.target && typeof contract.target === 'object'
      ? {
          ...contract.target,
          name: normalizeSkuName(contract.target.name)
        }
      : contract.target,
    recommendations: Array.isArray(contract.recommendations)
      ? contract.recommendations.map(normalizeRecommendationRow)
      : contract.recommendations,
    belowMinSpec: Array.isArray(contract.belowMinSpec)
      ? contract.belowMinSpec.map(normalizeRecommendationRow)
      : contract.belowMinSpec
  };
}


function parseExtraSkus(rawValue) {
  if (!rawValue) {
    return [];
  }

  if (Array.isArray(rawValue)) {
    return [...new Set(rawValue.map(normalizeSkuName).filter(Boolean))];
  }

  return [...new Set(String(rawValue)
    .split(',')
    .map(normalizeSkuName)
    .filter(Boolean))];
}

function parseCsv(rawValue) {
  if (!rawValue) {
    return [];
  }

  return String(rawValue)
    .split(',')
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function deriveFamilyFromSku(skuName) {
  const match = String(skuName || '').match(/^Standard_([A-Za-z]+)/);
  if (!match || !match[1]) {
    return 'Unknown';
  }

  return match[1].replace(/\d.*$/, '').toUpperCase();
}

function resolveTargetRegions(filters, currentRows) {
  const rowRegions = [...new Set((currentRows || []).map((row) => String(row.region || '').trim().toLowerCase()).filter(Boolean))];
  if (rowRegions.length > 0) {
    return rowRegions;
  }

  if (filters.region && filters.region !== 'all') {
    return [String(filters.region).trim().toLowerCase()];
  }

  const presetRegions = getRegionsForPreset(filters.regionPreset);
  if (Array.isArray(presetRegions) && presetRegions.length > 0) {
    return presetRegions.map((region) => String(region || '').trim().toLowerCase()).filter(Boolean);
  }

  return [];
}

function resolvePlacementWrapperPath() {
  return process.env.CAPACITY_PLACEMENT_WRAPPER_PATH
    || path.resolve(__dirname, '..', '..', 'tools', 'Get-LivePlacementScores.ps1');
}

function resolveRecommendationWrapperPath() {
  return process.env.CAPACITY_RECOMMEND_WRAPPER_PATH
    || path.resolve(__dirname, '..', '..', 'tools', 'Get-CapacityRecommendations.ps1');
}

function resolveWorkerBaseUrl() {
  return (process.env.CAPACITY_WORKER_BASE_URL || '').trim().replace(/\/$/, '');
}

function resolveWorkerSharedSecret() {
  return (process.env.CAPACITY_WORKER_SHARED_SECRET || '').trim();
}

function resolveRecommendationWorkerTimeoutMs(regionCount = 1) {
  const configuredTimeoutMs = Number(
    process.env.CAPACITY_RECOMMEND_WORKER_TIMEOUT_MS
    || process.env.CAPACITY_WORKER_TIMEOUT_MS
    || 0
  );

  if (Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0) {
    return Math.max(configuredTimeoutMs, 1000);
  }

  const count = Math.max(1, Number(regionCount) || 1);
  const dynamicTimeoutMs = DEFAULT_RECOMMENDATION_WORKER_TIMEOUT_MS + ((count - 1) * 15000);
  return Math.min(Math.max(dynamicTimeoutMs, 1000), 600000);
}

function useWorkerFirstMode() {
  return Boolean(resolveWorkerBaseUrl());
}

function shouldDisableLocalFallback() {
  return String(process.env.CAPACITY_WORKER_DISABLE_LOCAL_FALLBACK || '').toLowerCase() === 'true';
}

function resolveLivePlacementCallLimit() {
  const configuredLimit = Number(process.env.CAPACITY_LIVE_REFRESH_MAX_CALLS || DEFAULT_MAX_LIVE_PLACEMENT_CALLS);
  if (!Number.isFinite(configuredLimit) || configuredLimit < 1) {
    return DEFAULT_MAX_LIVE_PLACEMENT_CALLS;
  }

  return Math.floor(configuredLimit);
}

function resolveProjectRoot() {
  return path.resolve(__dirname, '..', '..');
}

function resolvePlacementRepoRoot() {
  const configuredRoot = String(process.env.GET_AZ_VM_AVAILABILITY_ROOT || '').trim();
  if (configuredRoot && fileExists(configuredRoot)) {
    return configuredRoot;
  }

  const bundledRoot = path.resolve(__dirname, '..', '..', 'tools', 'Get-AzVMAvailability');
  if (fileExists(bundledRoot)) {
    return bundledRoot;
  }

  return path.resolve(__dirname, '..', '..', '..', 'Get-AzVMAvailability');
}

function resolveRuntimeRoot() {
  if (process.env.CAPACITY_RUNTIME_ROOT) {
    return process.env.CAPACITY_RUNTIME_ROOT;
  }

  if (process.env.WEBSITE_INSTANCE_ID && process.env.HOME) {
    return path.join(process.env.HOME, 'data', 'capacity-runtime');
  }

  if (process.env.TEMP) {
    return path.join(process.env.TEMP, 'capacity-runtime');
  }

  if (process.env.TMP) {
    return path.join(process.env.TMP, 'capacity-runtime');
  }

  return path.resolve(resolveProjectRoot(), '.runtime');
}

function resolveModuleRoot() {
  return path.join(resolveRuntimeRoot(), 'modules');
}

function resolvePortablePowerShellPath() {
  return path.join(resolveRuntimeRoot(), 'powershell', 'pwsh.exe');
}

function getKnownPowerShell7Paths() {
  if (process.platform !== 'win32') {
    return [];
  }

  return [
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe',
    'C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe',
    'C:\\Program Files (x86)\\PowerShell\\7-preview\\pwsh.exe'
  ];
}

function findFileRecursive(directoryPath, targetFileName, maxDepth = 4) {
  if (!directoryPath || maxDepth < 0 || !fileExists(directoryPath)) {
    return null;
  }

  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === targetFileName.toLowerCase()) {
      return entryPath;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const match = findFileRecursive(path.join(directoryPath, entry.name), targetFileName, maxDepth - 1);
    if (match) {
      return match;
    }
  }

  return null;
}

function locatePortablePowerShellBinary() {
  const directPath = resolvePortablePowerShellPath();
  if (fileExists(directPath)) {
    return directPath;
  }

  return findFileRecursive(path.dirname(directPath), 'pwsh.exe');
}

function listDirectoryNames(directoryPath) {
  try {
    return fs.readdirSync(directoryPath, { withFileTypes: true }).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

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

function parseJsonFromMixedOutput(rawText) {
  const text = String(rawText || '').trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    // Continue to brace-slice parsing for hosts that prepend warnings/progress lines.
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  const candidate = text.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

async function runRemotePlacementLookup({ skus, regions, desiredCount }) {
  const baseUrl = resolveWorkerBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(Number(process.env.CAPACITY_WORKER_TIMEOUT_MS || DEFAULT_WORKER_TIMEOUT_MS), 1000);
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/api/live-placement`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(resolveWorkerSharedSecret() ? { 'x-capacity-worker-key': resolveWorkerSharedSecret() } : {})
      },
      body: JSON.stringify({
        skus,
        regions,
        desiredCount
      }),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || payload?.detail || `Remote worker failed with status ${response.status}.`);
    }

    return {
      rows: Array.isArray(payload?.rows) ? payload.rows : [],
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

async function runRemoteRecommendationLookup({ targetSku, regions, topN, minScore, showPricing, showSpot }) {
  const baseUrl = resolveWorkerBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const controller = new AbortController();
  const timeoutMs = resolveRecommendationWorkerTimeoutMs(Array.isArray(regions) ? regions.length : 1);
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/api/recommendations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(resolveWorkerSharedSecret() ? { 'x-capacity-worker-key': resolveWorkerSharedSecret() } : {})
      },
      body: JSON.stringify({
        targetSku,
        regions,
        topN,
        minScore,
        showPricing,
        showSpot
      }),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.detail || payload?.error || `Remote worker failed with status ${response.status}.`);
    }

    return normalizeRecommendationContract({
      ...(payload?.result || {}),
      diagnostics: payload?.diagnostics || {
        executionMode: 'function-app',
        workerUrl: baseUrl
      }
    });
  } catch (error) {
    const prefix = error?.name === 'AbortError'
      ? `Remote worker timed out after ${timeoutMs}ms`
      : 'Remote worker call failed';
    throw new Error(`${prefix}: ${error.message}`);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': 'capacity-planning-dashboard',
        Accept: 'application/vnd.github+json'
      }
    }, (response) => {
      if ((response.statusCode || 0) >= 300 && (response.statusCode || 0) < 400 && response.headers.location) {
        response.resume();
        httpsGetJson(response.headers.location).then(resolve, reject);
        return;
      }

      if ((response.statusCode || 0) >= 400) {
        reject(new Error(`Runtime bootstrap failed while fetching ${url}: HTTP ${response.statusCode}`));
        response.resume();
        return;
      }

      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Runtime bootstrap returned invalid JSON from ${url}: ${error.message}`));
        }
      });
    });

    request.on('error', reject);
  });
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': 'capacity-planning-dashboard',
        Accept: 'application/octet-stream'
      }
    }, async (response) => {
      try {
        if ((response.statusCode || 0) >= 300 && (response.statusCode || 0) < 400 && response.headers.location) {
          response.resume();
          await downloadFile(response.headers.location, destination);
          resolve();
          return;
        }

        if ((response.statusCode || 0) >= 400) {
          response.resume();
          reject(new Error(`Runtime bootstrap failed while downloading ${url}: HTTP ${response.statusCode}`));
          return;
        }

        await pipeline(response, fs.createWriteStream(destination));
        resolve();
      } catch (error) {
        reject(error);
      }
    });

    request.on('error', reject);
  });
}

async function ensureDirectory(directoryPath) {
  await fs.promises.mkdir(directoryPath, { recursive: true });
}

async function ensurePortablePowerShell() {
  const portablePath = locatePortablePowerShellBinary() || resolvePortablePowerShellPath();
  if (fileExists(portablePath)) {
    portablePowerShellError = null;
    return portablePath;
  }

  if (process.platform !== 'win32') {
    return null;
  }

  if (!portablePowerShellPromise) {
    portablePowerShellPromise = (async () => {
      const runtimeRoot = resolveRuntimeRoot();
      const extractRoot = path.dirname(portablePath);
      const zipPath = path.join(runtimeRoot, 'powershell-win-x64.zip');

      await ensureDirectory(runtimeRoot);
      await fs.promises.rm(extractRoot, { recursive: true, force: true });
      await ensureDirectory(extractRoot);

      const release = await httpsGetJson(POWERSHELL_RELEASE_API);
      const asset = Array.isArray(release.assets)
        ? release.assets.find((item) => /win-x64\.zip$/i.test(item.name || ''))
        : null;

      if (!asset?.browser_download_url) {
        throw new Error('Runtime bootstrap could not find a PowerShell win-x64 zip asset.');
      }

      await downloadFile(asset.browser_download_url, zipPath);
      await execFileAsync('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `$zipPath = '${zipPath.replace(/'/g, "''")}'; $extractRoot = '${extractRoot.replace(/'/g, "''")}'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath); try { if ($archive.Entries.Count -eq 0) { throw 'Downloaded PowerShell archive contains no entries.' } } finally { $archive.Dispose() }; [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extractRoot)`
      ], {
        cwd: resolveProjectRoot(),
        maxBuffer: 1024 * 1024
      });

      const extractedPath = locatePortablePowerShellBinary();
      if (!extractedPath || !fileExists(extractedPath)) {
        throw new Error(`Runtime bootstrap completed but pwsh.exe was not found under ${extractRoot}.`);
      }

      portablePowerShellError = null;
      return extractedPath;
    })().catch((error) => {
      portablePowerShellError = error;
      portablePowerShellPromise = null;
      throw error;
    });
  }

  return portablePowerShellPromise;
}

function buildPowerShellModulePath() {
  const moduleRoot = resolveModuleRoot();
  const existing = process.env.PSModulePath || '';
  return existing ? `${moduleRoot}${path.delimiter}${existing}` : moduleRoot;
}

async function canResolvePlacementCmdlet(command, env) {
  try {
    await execFileAsync(command, [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      'if (Get-Command Invoke-AzSpotPlacementScore -ErrorAction SilentlyContinue) { exit 0 } ; exit 1'
    ], {
      cwd: resolveProjectRoot(),
      env,
      maxBuffer: 1024 * 1024
    });
    return true;
  } catch {
    return false;
  }
}

async function ensureAzPlacementModules(command) {
  const moduleRoot = resolveModuleRoot();
  const requiredModules = ['Az.Accounts', 'Az.Compute'];
  const env = {
    ...process.env,
    PSModulePath: buildPowerShellModulePath()
  };

  if (await canResolvePlacementCmdlet(command, env)) {
    azModuleBootstrapError = null;
    return env;
  }

  if (!azModuleBootstrapPromise) {
    azModuleBootstrapPromise = (async () => {
      await ensureDirectory(moduleRoot);
      await execFileAsync(command, [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        `$modulePath = '${moduleRoot.replace(/'/g, "''")}'; $moduleNames = @('${requiredModules.join("','")}'); [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; if (Get-Command Set-PSRepository -ErrorAction SilentlyContinue) { try { Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction Stop } catch { } }; foreach ($moduleName in $moduleNames) { Save-Module -Name $moduleName -Repository PSGallery -Path $modulePath -Force -ErrorAction Stop }`
      ], {
        cwd: resolveProjectRoot(),
        env,
        maxBuffer: 8 * 1024 * 1024
      });
      azModuleBootstrapError = null;
    })().catch((error) => {
      azModuleBootstrapError = error;
      azModuleBootstrapPromise = null;
      throw error;
    });
  }

  await azModuleBootstrapPromise;
  return env;
}

async function getPowerShellCommands() {
  const commands = [];
  let bootstrapError = null;

  if (process.env.CAPACITY_PWSH_PATH) {
    commands.push(process.env.CAPACITY_PWSH_PATH);
  }

  const knownPaths = [
    locatePortablePowerShellBinary(),
    path.resolve(resolveProjectRoot(), 'tools', 'pwsh', 'pwsh.exe'),
    ...getKnownPowerShell7Paths()
  ].filter(Boolean);

  for (const candidate of knownPaths) {
    if (fileExists(candidate) && !commands.includes(candidate)) {
      commands.push(candidate);
    }
  }

  try {
    const provisioned = await ensurePortablePowerShell();
    if (provisioned && !commands.includes(provisioned)) {
      commands.push(provisioned);
    }
  } catch (error) {
    bootstrapError = error;
  }

  if (process.platform === 'win32') {
    commands.push('pwsh', 'powershell.exe');
  } else {
    commands.push('pwsh', 'powershell');
  }

  return {
    commands: [...new Set(commands)],
    diagnostics: {
      runtimeRoot: resolveRuntimeRoot(),
      portablePwshPath: locatePortablePowerShellBinary() || resolvePortablePowerShellPath(),
      portablePwshExists: Boolean(locatePortablePowerShellBinary()),
      archivePath: path.join(resolveRuntimeRoot(), 'powershell-win-x64.zip'),
      archiveExists: fileExists(path.join(resolveRuntimeRoot(), 'powershell-win-x64.zip')),
      archiveSizeBytes: fileExists(path.join(resolveRuntimeRoot(), 'powershell-win-x64.zip')) ? fs.statSync(path.join(resolveRuntimeRoot(), 'powershell-win-x64.zip')).size : null,
      extractedEntries: listDirectoryNames(path.join(resolveRuntimeRoot(), 'powershell')).slice(0, 20),
      bootstrapError: bootstrapError?.message || portablePowerShellError?.message || null,
      moduleBootstrapError: azModuleBootstrapError?.message || null
    }
  };
}

function chunk(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

async function runPlacementLookupLocal({ skus, regions, desiredCount }) {
  const wrapperPath = resolvePlacementWrapperPath();
  const repoRoot = resolvePlacementRepoRoot();
  const powerShellRuntime = await getPowerShellCommands();
  const commands = powerShellRuntime.commands;
  const args = [
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    wrapperPath,
    '-RepoRoot',
    repoRoot,
    '-SkuNamesJson',
    JSON.stringify(skus),
    '-RegionsJson',
    JSON.stringify(regions),
    '-DesiredCount',
    String(desiredCount)
  ];

  function tryCommand(commandIndex, resolve, reject) {
    if (commandIndex >= commands.length) {
      reject(new Error('Live placement lookup failed: no supported PowerShell executable was found.'));
      return;
    }

    const command = commands[commandIndex];
    const envPromise = ensureAzPlacementModules(command).catch(() => ({ ...process.env }));

    envPromise.then((env) => {
      execFile(
        command,
        args,
        {
          cwd: resolveProjectRoot(),
          env,
          maxBuffer: 1024 * 1024
        },
        (error, stdout, stderr) => {
          if (error) {
            if (error.code === 'ENOENT') {
              tryCommand(commandIndex + 1, resolve, reject);
              return;
            }

            const detail = stderr?.trim() || stdout?.trim() || error.message;
            reject(new Error(`Live placement lookup failed: ${detail}`));
            return;
          }

          try {
            const trimmedStdout = (stdout || '').trim();
            if (!trimmedStdout) {
              reject(new Error(`Live placement lookup returned no JSON output.${stderr?.trim() ? ` ${stderr.trim()}` : ''}`));
              return;
            }

            const parsed = JSON.parse(trimmedStdout);
            if (Array.isArray(parsed)) {
              resolve({ rows: parsed, diagnostics: null });
              return;
            }

            const diagnostics = parsed?.diagnostics
              ? {
                  ...parsed.diagnostics,
                  executionMode: parsed?.diagnostics?.executionMode || 'local-app-service',
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
              : {
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
                };

            resolve({
              rows: Array.isArray(parsed?.rows) ? parsed.rows : [],
              diagnostics
            });
          } catch (parseError) {
            reject(new Error(`Live placement lookup returned invalid JSON: ${parseError.message}`));
          }
        }
      );
    }).catch((error) => {
      reject(new Error(`Live placement lookup failed during PowerShell bootstrap: ${error.message}`));
    });
  }

  return new Promise((resolve, reject) => {
    tryCommand(0, resolve, reject);
  });
}

async function runPlacementLookup({ skus, regions, desiredCount }) {
  if (useWorkerFirstMode()) {
    try {
      const remoteResult = await runRemotePlacementLookup({ skus, regions, desiredCount });
      if (remoteResult) {
        return remoteResult;
      }
    } catch (error) {
      if (shouldDisableLocalFallback()) {
        throw error;
      }

      const localResult = await runPlacementLookupLocal({ skus, regions, desiredCount });
      return {
        ...localResult,
        diagnostics: localResult.diagnostics
          ? {
              ...localResult.diagnostics,
              executionMode: 'function-app-fallback',
              workerUrl: resolveWorkerBaseUrl(),
              fallbackReason: error.message
            }
          : {
              executionMode: 'function-app-fallback',
              workerUrl: resolveWorkerBaseUrl(),
              fallbackReason: error.message
            }
      };
    }
  }

  return runPlacementLookupLocal({ skus, regions, desiredCount });
}

function buildRegionUnavailableWarning(skus, region) {
  const skuLabel = Array.isArray(skus) && skus.length > 0 ? skus.join(', ') : 'requested SKU(s)';
  return `Live placement was unavailable for SKU(s) ${skuLabel} in region ${region}. Those rows were left as N/A.`;
}

function isRegionUnavailableError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes("expected '{' or '['")
    || message.includes('was string: you')
    || message.includes('returned invalid json')
    || message.includes('restrictedskunotavailable')
    || message.includes('skunotavailable')
    || message.includes('live placement lookup failed');
}

function isRegionUnavailableWarningText(text) {
  return isRegionUnavailableError({ message: text });
}

function batchProducedNoUsefulRows(result) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const warning = result?.diagnostics?.warning || null;
  if (rows.length > 0) {
    return false;
  }
  if (warning && isRegionUnavailableWarningText(warning)) {
    return true;
  }
  return false;
}

async function runPlacementLookupResilient({ skus, regions, desiredCount }) {
  let initialResult = null;
  let initialError = null;
  try {
    initialResult = await runPlacementLookup({ skus, regions, desiredCount });
  } catch (error) {
    initialError = error;
  }

  const needsPerRegionRetry = Boolean(initialError) || batchProducedNoUsefulRows(initialResult);

  if (!needsPerRegionRetry) {
    return {
      rows: Array.isArray(initialResult?.rows) ? initialResult.rows : [],
      diagnostics: initialResult?.diagnostics ? [initialResult.diagnostics] : [],
      warnings: []
    };
  }

  // Single-region batch: nothing to split further. Translate to humanized warning if possible.
  if (!Array.isArray(regions) || regions.length <= 1) {
    const singleRegion = Array.isArray(regions) && regions.length === 1 ? regions[0] : null;
    const batchWarning = initialResult?.diagnostics?.warning || null;

    if (initialError) {
      if (singleRegion && isRegionUnavailableError(initialError)) {
        return {
          rows: [],
          diagnostics: [{
            warning: initialError.message,
            errorType: initialError.name || 'LivePlacementLookupError',
            errorRecord: initialError.stack || null,
            requestedSkus: skus,
            requestedRegions: [singleRegion],
            requestedDesiredCount: desiredCount
          }],
          warnings: [buildRegionUnavailableWarning(skus, singleRegion)]
        };
      }
      throw initialError;
    }

    if (singleRegion && batchWarning && isRegionUnavailableWarningText(batchWarning)) {
      return {
        rows: [],
        diagnostics: initialResult?.diagnostics ? [initialResult.diagnostics] : [],
        warnings: [buildRegionUnavailableWarning(skus, singleRegion)]
      };
    }

    return {
      rows: Array.isArray(initialResult?.rows) ? initialResult.rows : [],
      diagnostics: initialResult?.diagnostics ? [initialResult.diagnostics] : [],
      warnings: []
    };
  }

  const rows = [];
  const diagnostics = [];
  const warnings = [];
  const regionWarnings = [];
  let hasSuccessfulRegion = false;

  const addRegionWarning = (region, message) => {
    warnings.push(message);
    regionWarnings.push({ skus: [...skus], region, message });
  };

  for (const region of regions) {
    try {
      const result = await runPlacementLookup({ skus, regions: [region], desiredCount });
      const regionRows = Array.isArray(result?.rows) ? result.rows : [];
      const regionWarning = result?.diagnostics?.warning || null;

      if (regionRows.length > 0) {
        hasSuccessfulRegion = true;
        rows.push(...regionRows);
        if (result?.diagnostics) {
          diagnostics.push(result.diagnostics);
        }
      } else if (regionWarning && isRegionUnavailableWarningText(regionWarning)) {
        // Confirmed unavailable — surface the humanized warning.
        addRegionWarning(region, buildRegionUnavailableWarning(skus, region));
        if (result?.diagnostics) {
          diagnostics.push(result.diagnostics);
        }
      } else {
        // Empty rows without a recognized error — treat as a soft miss, log only.
        if (result?.diagnostics) {
          diagnostics.push({
            ...result.diagnostics,
            warning: result.diagnostics.warning || 'Live placement returned no rows for this region.',
            softMiss: true,
            requestedSkus: skus,
            requestedRegions: [region]
          });
        }
      }
    } catch (regionError) {
      if (isRegionUnavailableError(regionError)) {
        addRegionWarning(region, buildRegionUnavailableWarning(skus, region));
      } else {
        addRegionWarning(region, `Live placement lookup failed for SKU(s) ${skus.join(', ')} in region(s) ${region}: ${regionError.message}`);
      }
      diagnostics.push({
        warning: regionError.message,
        errorType: regionError.name || 'LivePlacementLookupError',
        errorRecord: regionError.stack || null,
        requestedSkus: skus,
        requestedRegions: [region],
        requestedDesiredCount: desiredCount
      });
    }
  }

  if (!hasSuccessfulRegion && initialError && warnings.length === 0) {
    throw initialError;
  }

  return {
    rows,
    diagnostics,
    warnings,
    regionWarnings
  };
}

async function runRecommendationLookupLocal({ targetSku, regions, topN, minScore, showPricing, showSpot }) {
  const wrapperPath = resolveRecommendationWrapperPath();
  const repoRoot = resolvePlacementRepoRoot();
  const scriptPath = path.join(repoRoot, 'Get-AzVMAvailability.ps1');
  const powerShellRuntime = await getPowerShellCommands();
  const commands = powerShellRuntime.commands;
  const args = [
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    wrapperPath,
    '-RepoRoot',
    repoRoot,
    '-TargetSku',
    String(targetSku || ''),
    '-RegionsJson',
    JSON.stringify(regions || []),
    '-TopN',
    String(topN),
    '-MinScore',
    String(minScore)
  ];

  if (showPricing) {
    args.push('-ShowPricing');
  }
  if (showSpot) {
    args.push('-ShowSpot');
  }

  const timeoutMs = resolveRecommendationWorkerTimeoutMs(Array.isArray(regions) ? regions.length : 1);

  function tryCommand(commandIndex, resolve, reject) {
    if (commandIndex >= commands.length) {
      reject(new Error('Capacity recommendation failed: no supported PowerShell executable was found.'));
      return;
    }

    const command = commands[commandIndex];
    const envPromise = ensureAzPlacementModules(command).catch(() => ({ ...process.env }));

    envPromise.then((env) => {
      execFile(
        command,
        args,
        {
          cwd: resolveProjectRoot(),
          env,
          maxBuffer: 2 * 1024 * 1024,
          timeout: timeoutMs
        },
        (error, stdout, stderr) => {
          const stdoutText = String(stdout || '').trim();
          const stderrText = String(stderr || '').trim();
          const outputContext = {
            command,
            cwd: resolveProjectRoot(),
            wrapperPath,
            wrapperExists: fileExists(wrapperPath),
            repoRoot,
            repoExists: fileExists(repoRoot),
            scriptPath,
            scriptExists: fileExists(scriptPath),
            targetSku,
            regions,
            topN,
            minScore,
            showPricing,
            showSpot,
            stdoutLength: stdoutText.length,
            stderrLength: stderrText.length,
            stdoutSnippet: stdoutText.slice(0, 500),
            stderrSnippet: stderrText.slice(0, 500)
          };

          if (error) {
            if (error.code === 'ENOENT') {
              tryCommand(commandIndex + 1, resolve, reject);
              return;
            }

            const detail = stderrText || stdoutText || error.message;
            reject(new Error(`Capacity recommendation failed: ${detail} | Context: ${JSON.stringify(outputContext)}`));
            return;
          }

          const parsedStdout = parseJsonFromMixedOutput(stdout);
          if (parsedStdout) {
            resolve(normalizeRecommendationContract(parsedStdout));
            return;
          }

          const combinedOutput = [stdoutText, stderrText]
            .filter(Boolean)
            .join('\n');
          const parsedCombined = parseJsonFromMixedOutput(combinedOutput);
          if (parsedCombined) {
            resolve(normalizeRecommendationContract(parsedCombined));
            return;
          }

          const detail = combinedOutput || 'No output was returned by the recommendation wrapper.';
          reject(new Error(`Capacity recommendation returned no JSON output. ${detail} | Context: ${JSON.stringify(outputContext)}`));
        }
      );
    }).catch((bootstrapError) => {
      reject(new Error(`Capacity recommendation failed during PowerShell bootstrap: ${bootstrapError.message}`));
    });
  }

  return new Promise((resolve, reject) => {
    tryCommand(0, resolve, reject);
  });
}

function getRecommendationDiagnostics() {
  const configuredRepoRoot = String(process.env.GET_AZ_VM_AVAILABILITY_ROOT || '').trim();
  const wrapperPath = resolveRecommendationWrapperPath();
  const repoRoot = resolvePlacementRepoRoot();
  const wrapperExists = fileExists(wrapperPath);
  const repoExists = fileExists(repoRoot);
  const scriptPath = path.join(repoRoot, 'Get-AzVMAvailability.ps1');
  const scriptExists = fileExists(scriptPath);

  return {
    configuredRepoRoot,
    configuredRepoRootExists: configuredRepoRoot ? fileExists(configuredRepoRoot) : null,
    wrapperPath,
    wrapperExists,
    repoRoot,
    repoExists,
    scriptPath,
    scriptExists,
    projectRoot: resolveProjectRoot(),
    runtimeRoot: resolveRuntimeRoot()
  };
}

async function getCapacityRecommendations(options = {}) {
  const targetSku = normalizeSkuName(options.targetSku);
  if (!targetSku) {
    throw new Error('Target SKU is required for recommendations.');
  }
  if (isAggregateSkuName(targetSku)) {
    const aggregateError = new Error(`Target SKU must be a concrete Azure VM size, not an aggregate label. Use a real SKU such as Standard_NC24ads_A100_v4, Standard_NC4as_T4_v3, or Standard_NC40ads_H100_v5 instead of ${targetSku}.`);
    aggregateError.statusCode = 400;
    throw aggregateError;
  }

  const explicitRegions = (Array.isArray(options.regions)
    ? options.regions
    : parseCsv(options.regions)
  )
    .map((region) => String(region || '').trim().toLowerCase())
    .filter(Boolean);
  const presetRegions = getRegionsForPreset(options.regionPreset);
  const resolvedRegions = explicitRegions.length > 0
    ? [...new Set(explicitRegions)]
    : (Array.isArray(presetRegions) && presetRegions.length > 0
      ? [...new Set(presetRegions.map((region) => String(region || '').trim().toLowerCase()).filter(Boolean))]
      : []);

  if (resolvedRegions.length === 0) {
    throw new Error('At least one target region is required for recommendations.');
  }

  const topN = Math.max(1, Math.min(Number(options.topN || 10), 25));
  const minScore = Math.max(0, Math.min(Number(options.minScore ?? 50), 100));
  const showPricing = String(options.showPricing).toLowerCase() !== 'false';
  const showSpot = Boolean(options.showSpot);

  let contract;
  let fallbackApplied = false;
  try {
    if (useWorkerFirstMode()) {
      contract = await runRemoteRecommendationLookup({
        targetSku,
        regions: resolvedRegions,
        topN,
        minScore,
        showPricing,
        showSpot
      });
    } else {
      contract = await runRecommendationLookupLocal({
        targetSku,
        regions: resolvedRegions,
        topN,
        minScore,
        showPricing,
        showSpot
      });
    }
  } catch (error) {
    if (showSpot) {
      try {
        const retryResult = useWorkerFirstMode()
          ? await runRemoteRecommendationLookup({
              targetSku,
              regions: resolvedRegions,
              topN,
              minScore,
              showPricing,
              showSpot: false
            })
          : await runRecommendationLookupLocal({
              targetSku,
              regions: resolvedRegions,
              topN,
              minScore,
              showPricing,
              showSpot: false
            });

        contract = {
          ...retryResult,
          diagnostics: retryResult?.diagnostics
            ? {
                ...retryResult.diagnostics,
                executionMode: useWorkerFirstMode() ? 'function-app-spot-disabled' : retryResult.diagnostics.executionMode,
                fallbackReason: error.message
              }
            : {
                executionMode: useWorkerFirstMode() ? 'function-app-spot-disabled' : 'local-spot-disabled',
                fallbackReason: error.message
              }
        };
        fallbackApplied = true;
      } catch {
        // Fall through to the normal worker/local fallback handling below.
      }
    }

    if (contract) {
      // A showSpot retry succeeded; treat the request as degraded but successful.
    } else if (useWorkerFirstMode() && !shouldDisableLocalFallback()) {
      const localResult = await runRecommendationLookupLocal({
        targetSku,
        regions: resolvedRegions,
        topN,
        minScore,
        showPricing,
        showSpot
      });
      contract = {
        ...localResult,
        diagnostics: localResult?.diagnostics
          ? {
              ...localResult.diagnostics,
              executionMode: 'function-app-fallback',
              workerUrl: resolveWorkerBaseUrl(),
              fallbackReason: error.message
            }
          : {
              executionMode: 'function-app-fallback',
              workerUrl: resolveWorkerBaseUrl(),
              fallbackReason: error.message
            }
      };
      fallbackApplied = true;
    } else {
      const errorText = String(error?.message || '').toLowerCase();
      const isNoOutputFailure = errorText.includes('returned no json output') || errorText.includes('no output was returned by the recommendation wrapper');

      if (showSpot && isNoOutputFailure) {
        contract = await runRecommendationLookupLocal({
          targetSku,
          regions: resolvedRegions,
          topN,
          minScore,
          showPricing,
          showSpot: false
        });
        fallbackApplied = true;
      } else {
        throw error;
      }
    }
  }

  if (fallbackApplied) {
    const warnings = Array.isArray(contract?.warnings) ? contract.warnings : [];
    const executionMode = String(contract?.diagnostics?.executionMode || '').toLowerCase();
    const alreadyHasDegradedWarning = warnings.some((warning) => /recommendation lookup failed/i.test(String(warning || '')));
    if (!alreadyHasDegradedWarning && !warnings.some((warning) => /fallback/i.test(String(warning || '')))) {
      warnings.push(
        executionMode === 'function-app-spot-disabled' || executionMode === 'local-spot-disabled'
          ? 'Spot pricing could not be retrieved, so recommendations were retried with Show Spot disabled.'
          : (useWorkerFirstMode()
            ? 'Recommendations were served from the local fallback runner after the remote worker failed.'
            : 'Spot pricing request was retried with Show Spot disabled after an empty-output runner response.')
      );
    }
    contract = {
      ...contract,
      warnings
    };
  }

  return {
    ...contract,
    requestedTargetSku: targetSku,
    requestedRegions: resolvedRegions,
    requestedTopN: topN,
    requestedMinScore: minScore,
    requestedShowPricing: showPricing,
    requestedShowSpot: showSpot
  };
}

async function getLivePlacementScoreRows(filters = {}) {
  const selectedSubscriptionIds = parseCsv(filters.subscriptionIds);
  if (selectedSubscriptionIds.length !== 1) {
    const scopeError = new Error(selectedSubscriptionIds.length === 0
      ? 'Live placement refresh requires exactly one selected subscription. Choose the specific subscription that needs additional capacity before refreshing.'
      : `Live placement refresh requires exactly one selected subscription. ${selectedSubscriptionIds.length} subscriptions are currently selected.`);
    scopeError.statusCode = 400;
    scopeError.details = {
      selectedSubscriptionCount: selectedSubscriptionIds.length,
      selectedSubscriptionIds
    };
    throw scopeError;
  }

  if (!filters.family || String(filters.family).trim().toLowerCase() === 'all') {
    const scopeError = new Error('Live placement refresh requires a specific family. Choose the family you want to validate before refreshing live placement.');
    scopeError.statusCode = 400;
    scopeError.details = {
      selectedSubscriptionCount: selectedSubscriptionIds.length,
      family: filters.family || 'all'
    };
    throw scopeError;
  }

  const currentRows = await getCapacityScoreSummary(filters);
  const extraSkus = parseExtraSkus(filters.extraSkus);
  const targetRegions = resolveTargetRegions(filters, currentRows);
  const requestedDesiredCount = Number(filters.desiredCount || 1);
  const effectiveDesiredCount = Math.max(1, Math.min(requestedDesiredCount, 1000));
  const warnings = [];
  if (requestedDesiredCount > 1000) {
    warnings.push('Desired Placement Count is capped at 1000 for the live placement API.');
  }

  let workingRows = Array.isArray(currentRows) ? [...currentRows] : [];

  if (extraSkus.length > 0) {
    if (targetRegions.length === 0) {
      warnings.push('Additional SKUs were provided but no target regions were found from current filters.');
    } else {
      const existingKeys = new Set(workingRows.map((row) => `${String(row.sku || '').toLowerCase()}|${String(row.region || '').toLowerCase()}`));

      for (const sku of extraSkus) {
        for (const region of targetRegions) {
          const key = `${sku.toLowerCase()}|${region}`;
          if (existingKeys.has(key)) {
            continue;
          }

          workingRows.push({
            region,
            sku,
            family: deriveFamilyFromSku(sku),
            score: 'N/A',
            subscriptionCount: 0,
            okRows: 0,
            limitedRows: 0,
            constrainedRows: 0,
            totalQuotaAvailable: 0,
            utilizationPct: 0,
            reason: 'Additional SKU included for live placement validation.'
          });
          existingKeys.add(key);
        }
      }
    }
  }

  if (!Array.isArray(workingRows) || workingRows.length === 0) {
    return {
      rows: [],
      liveCheckedAtUtc: new Date().toISOString(),
      source: 'Get-AzVMAvailability:Get-PlacementScores',
      requestedDesiredCount,
      effectiveDesiredCount,
      warning: warnings.length > 0 ? warnings.join(' ') : null
    };
  }

  const placeholderSkuPattern = /-aggregate$|family-aggregate/i;
  const isRealSku = (sku) => {
    if (!sku) return false;
    const text = String(sku).trim();
    if (!text) return false;
    if (placeholderSkuPattern.test(text)) return false;
    if (!/^Standard_/i.test(text) && !/^Basic_/i.test(text)) return false;
    return true;
  };
  const placeholderSkus = new Set(workingRows.map((row) => row.sku).filter((sku) => sku && !isRealSku(sku)));
  if (placeholderSkus.size > 0) {
    warnings.push(`Skipped ${placeholderSkus.size} aggregate/placeholder SKU(s) that cannot be scored via live placement: ${[...placeholderSkus].join(', ')}.`);
  }

  const uniqueSkus = [...new Set(workingRows.map((row) => row.sku).filter(isRealSku))];
  const uniqueRegions = [...new Set(workingRows.map((row) => row.region).filter(Boolean))];
  const skuChunks = chunk(uniqueSkus, DEFAULT_MAX_SKUS_PER_CALL);
  const regionChunks = chunk(uniqueRegions, DEFAULT_MAX_REGIONS_PER_CALL);
  const estimatedCallCount = skuChunks.length * regionChunks.length;
  const maxCallCount = resolveLivePlacementCallLimit();

  if (estimatedCallCount > maxCallCount) {
    const scopeError = new Error(`Live placement refresh scope is too large: ${uniqueSkus.length} SKU(s) across ${uniqueRegions.length} region(s) would require ${estimatedCallCount} lookup call(s). Narrow the filters to fewer subscriptions, a single family, or a smaller region scope.`);
    scopeError.statusCode = 400;
    scopeError.details = {
      uniqueSkuCount: uniqueSkus.length,
      uniqueRegionCount: uniqueRegions.length,
      estimatedCallCount,
      maxCallCount
    };
    throw scopeError;
  }

  const liveCheckedAtUtc = new Date().toISOString();
  const liveMap = new Map();
  const diagnostics = [];
  const pendingRegionWarnings = [];
  const unavailableKeySet = new Set();

  for (const skuChunk of skuChunks) {
    for (const regionChunk of regionChunks) {
      try {
        const chunkResult = await runPlacementLookupResilient({
          skus: skuChunk,
          regions: regionChunk,
          desiredCount: effectiveDesiredCount
        });

        if (Array.isArray(chunkResult.regionWarnings) && chunkResult.regionWarnings.length > 0) {
          pendingRegionWarnings.push(...chunkResult.regionWarnings);
        } else if (Array.isArray(chunkResult.warnings) && chunkResult.warnings.length > 0) {
          // Backwards-compat: warnings without per-region metadata apply to the whole chunk.
          for (const message of chunkResult.warnings) {
            pendingRegionWarnings.push({ skus: skuChunk, region: null, message });
          }
        }

        if (Array.isArray(chunkResult.diagnostics) && chunkResult.diagnostics.length > 0) {
          diagnostics.push(...chunkResult.diagnostics.filter(Boolean));
        }

        for (const row of chunkResult.rows) {
          liveMap.set(`${row.sku}|${String(row.region || '').toLowerCase()}`, row);
        }
      } catch (err) {
        const chunkSkuLabel = skuChunk.join(', ');
        const chunkRegionLabel = regionChunk.join(', ');
        const message = isRegionUnavailableError(err)
          ? `Live placement was unavailable for SKU(s) ${chunkSkuLabel} in region(s) ${chunkRegionLabel}. Those rows were left as N/A.`
          : `Live placement lookup failed for SKU(s) ${chunkSkuLabel} in region(s) ${chunkRegionLabel}: ${err.message}`;
        pendingRegionWarnings.push({ skus: skuChunk, region: null, message, chunkRegions: regionChunk });
        diagnostics.push({
          warning: err.message,
          errorType: err.name || 'LivePlacementLookupError',
          errorRecord: err.stack || null,
          requestedSkus: skuChunk,
          requestedRegions: regionChunk,
          requestedDesiredCount: effectiveDesiredCount
        });
        continue;
      }
    }
  }

  // Drop warnings for sku/region combinations that were actually resolved with live data.
  for (const entry of pendingRegionWarnings) {
    const entrySkus = Array.isArray(entry.skus) ? entry.skus : [];
    const regionsToCheck = entry.region
      ? [entry.region]
      : (Array.isArray(entry.chunkRegions) ? entry.chunkRegions : uniqueRegions);
    let allCovered = entrySkus.length > 0 && regionsToCheck.length > 0;
    for (const sku of entrySkus) {
      for (const region of regionsToCheck) {
        if (!liveMap.has(`${sku}|${String(region || '').toLowerCase()}`)) {
          allCovered = false;
          break;
        }
      }
      if (!allCovered) break;
    }
    if (!allCovered) {
      warnings.push(entry.message);
      const isUnavailableWarning = /^Live placement was unavailable for SKU\(s\)/.test(String(entry.message || ''));
      if (isUnavailableWarning) {
        for (const sku of entrySkus) {
          for (const region of regionsToCheck) {
            const key = `${sku}|${String(region || '').toLowerCase()}`;
            if (!liveMap.has(key)) {
              unavailableKeySet.add(key);
            }
          }
        }
      }
    }
  }

  const rawDiagnosticWarning = warnings.length === 0
    ? (diagnostics.map((item) => item?.warning).find(Boolean) || null)
    : null;
  // Never leak raw worker/PowerShell exception text into the user-facing banner.
  const diagnosticWarning = rawDiagnosticWarning && !isRegionUnavailableWarningText(rawDiagnosticWarning)
    ? rawDiagnosticWarning
    : null;
  const primaryDiagnostic = diagnostics.find(Boolean) || null;
  const combinedWarning = [...warnings, diagnosticWarning].filter(Boolean).join(' ');

  const enrichedRows = workingRows.map((row) => {
    const rowKey = `${row.sku}|${String(row.region || '').toLowerCase()}`;
    const live = liveMap.get(rowKey);
    const isUnavailableThisRun = unavailableKeySet.has(rowKey);
    return {
      ...row,
      livePlacementScore: live?.score || (isUnavailableThisRun ? 'N/A' : (row.livePlacementScore || 'N/A')),
      livePlacementAvailable: typeof live?.isAvailable === 'boolean'
        ? live.isAvailable
        : (isUnavailableThisRun ? null : (typeof row.livePlacementAvailable === 'boolean' ? row.livePlacementAvailable : null)),
      livePlacementRestricted: typeof live?.isRestricted === 'boolean'
        ? live.isRestricted
        : (isUnavailableThisRun ? null : (typeof row.livePlacementRestricted === 'boolean' ? row.livePlacementRestricted : null)),
      liveCheckedAtUtc: live ? liveCheckedAtUtc : (isUnavailableThisRun ? null : (row.liveCheckedAtUtc || null))
    };
  });

  const snapshotsToSave = enrichedRows
    .filter((row) => {
      const rowKey = `${row.sku}|${String(row.region || '').toLowerCase()}`;
      return Boolean(liveMap.has(rowKey) || unavailableKeySet.has(rowKey));
    })
    .map((row) => {
      const rowKey = `${row.sku}|${String(row.region || '').toLowerCase()}`;
      const isUnavailableThisRun = unavailableKeySet.has(rowKey);
      return {
        capturedAtUtc: liveCheckedAtUtc,
        desiredCount: effectiveDesiredCount,
        region: row.region,
        sku: row.sku,
        livePlacementScore: isUnavailableThisRun ? 'N/A' : row.livePlacementScore,
        livePlacementAvailable: isUnavailableThisRun ? null : row.livePlacementAvailable,
        livePlacementRestricted: isUnavailableThisRun ? null : row.livePlacementRestricted,
        warning: isUnavailableThisRun ? 'Live placement was unavailable during the latest refresh.' : null
      };
    });

  if (snapshotsToSave.length > 0) {
    saveLivePlacementSnapshots(snapshotsToSave).catch((saveErr) => {
      console.warn('Failed to persist live placement snapshots:', saveErr.message);
      // Silently fail — don't break the response
    });
  }

  return {
    rows: enrichedRows,
    liveCheckedAtUtc,
    source: 'Get-AzVMAvailability:Get-PlacementScores',
    requestedDesiredCount,
    effectiveDesiredCount,
    estimatedCallCount,
    warning: combinedWarning || null,
    diagnostics: primaryDiagnostic
  };
}

function getScheduledLivePlacementFilters() {
  return {
    regionPreset: process.env.LIVE_PLACEMENT_REFRESH_REGION_PRESET || process.env.INGEST_REGION_PRESET || 'USMajor',
    subscriptionIds: process.env.LIVE_PLACEMENT_REFRESH_SUBSCRIPTION_IDS || process.env.INGEST_SUBSCRIPTION_IDS || '',
    region: process.env.LIVE_PLACEMENT_REFRESH_REGION || 'all',
    family: process.env.LIVE_PLACEMENT_REFRESH_FAMILY || 'all',
    availability: process.env.LIVE_PLACEMENT_REFRESH_AVAILABILITY || 'all',
    desiredCount: Number(process.env.LIVE_PLACEMENT_REFRESH_DESIRED_COUNT || 1),
    extraSkus: parseExtraSkus(process.env.LIVE_PLACEMENT_REFRESH_EXTRA_SKUS)
  };
}

async function runScheduledLivePlacementRefresh(options = {}) {
  if (livePlacementRefreshInProgress) {
    return { ok: false, skipped: true, reason: 'Live placement refresh is already running.' };
  }

  const filters = {
    ...getScheduledLivePlacementFilters(),
    ...(options.filters || {})
  };
  const startedAt = new Date();
  livePlacementRefreshInProgress = true;

  try {
    const result = await getLivePlacementScoreRows(filters);
    const completedAt = new Date();
    const desiredCount = Number(result.effectiveDesiredCount || filters.desiredCount || 1);
    const rowsAffected = Array.isArray(result.rows)
      ? result.rows.filter((row) => row.livePlacementScore && row.livePlacementScore !== 'N/A').length
      : 0;
    const subscriptionCount = parseCsv(filters.subscriptionIds).length || null;

    await logDashboardOperation({
      type: 'live-placement-refresh',
      name: 'Live Placement Refresh',
      status: 'success',
      triggerSource: options.triggerSource || 'scheduler',
      startedAtUtc: startedAt,
      completedAtUtc: completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      rowsAffected,
      subscriptionCount,
      requestedDesiredCount: Number(filters.desiredCount || 1),
      effectiveDesiredCount: desiredCount,
      regionPreset: filters.regionPreset || null,
      note: result.warning || `Refreshed ${rowsAffected} live placement snapshots.`
    });

    return { ok: true, rowsAffected, result };
  } catch (err) {
    const completedAt = new Date();
    const errorMessage = err?.message || 'Unknown live placement refresh failure';

    await logDashboardOperation({
      type: 'live-placement-refresh',
      name: 'Live Placement Refresh',
      status: 'failed',
      triggerSource: options.triggerSource || 'scheduler',
      startedAtUtc: startedAt,
      completedAtUtc: completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      subscriptionCount: parseCsv(filters.subscriptionIds).length || null,
      requestedDesiredCount: Number(filters.desiredCount || 1),
      effectiveDesiredCount: Number(filters.desiredCount || 1),
      regionPreset: filters.regionPreset || null,
      note: 'Scheduled live placement refresh failed.',
      errorMessage
    });

    await insertDashboardErrorLog({
      source: 'live-placement-scheduler',
      type: 'LivePlacementRefreshError',
      message: errorMessage,
      severity: 'error',
      context: JSON.stringify({
        triggerSource: options.triggerSource || 'scheduler',
        regionPreset: filters.regionPreset || null,
        region: filters.region || null,
        family: filters.family || null,
        availability: filters.availability || null
      }),
      desiredCount: Number(filters.desiredCount || 1),
      occurredAtUtc: completedAt
    });

    throw err;
  } finally {
    livePlacementRefreshInProgress = false;
  }
}

function normalizeLivePlacementSchedulerConfig(config = {}) {
  const envInterval = Number(process.env.LIVE_PLACEMENT_REFRESH_INTERVAL_MINUTES || 0);
  const envRunOnStartup = String(process.env.LIVE_PLACEMENT_REFRESH_ON_STARTUP || '').toLowerCase() === 'true';

  const intervalMinutesRaw = config.intervalMinutes == null ? envInterval : Number(config.intervalMinutes);
  const intervalMinutes = Number.isFinite(intervalMinutesRaw)
    ? Math.max(0, Math.min(Math.trunc(intervalMinutesRaw), 7 * 24 * 60))
    : 0;

  const runOnStartup = config.runOnStartup == null
    ? envRunOnStartup
    : String(config.runOnStartup).toLowerCase() === 'true' || config.runOnStartup === true;

  return {
    intervalMinutes,
    runOnStartup
  };
}

function applyLivePlacementScheduler(config = {}, options = {}) {
  const normalized = normalizeLivePlacementSchedulerConfig(config);
  const shouldRunStartup = Boolean(options.runStartup) && normalized.runOnStartup;

  if (livePlacementSchedulerHandle) {
    clearInterval(livePlacementSchedulerHandle);
    livePlacementSchedulerHandle = null;
  }

  livePlacementSchedulerConfig = normalized;

  if (shouldRunStartup) {
    setTimeout(() => {
      runScheduledLivePlacementRefresh({ triggerSource: 'startup' }).catch((err) => {
        console.warn('Scheduled live placement startup refresh failed:', err.message);
      });
    }, 1500);
  }

  if (normalized.intervalMinutes > 0) {
    livePlacementSchedulerHandle = setInterval(() => {
      runScheduledLivePlacementRefresh({ triggerSource: 'scheduler' }).catch((err) => {
        console.warn('Scheduled live placement refresh failed:', err.message);
      });
    }, normalized.intervalMinutes * 60 * 1000);
  }

  return { ...livePlacementSchedulerConfig };
}

function startLivePlacementScheduler(config = {}) {
  return applyLivePlacementScheduler(config, { runStartup: true });
}

function updateLivePlacementScheduler(config = {}) {
  return applyLivePlacementScheduler(config, { runStartup: false });
}

function getLivePlacementSchedulerConfig() {
  return { ...livePlacementSchedulerConfig };
}

module.exports = {
  getLivePlacementScoreRows,
  getCapacityRecommendations,
  getRecommendationDiagnostics,
  getPowerShellCommands,
  ensureAzPlacementModules,
  resolveProjectRoot,
  runScheduledLivePlacementRefresh,
  startLivePlacementScheduler,
  updateLivePlacementScheduler,
  getLivePlacementSchedulerConfig,
  __testHooks: {
    normalizeSkuName,
    isAggregateSkuName,
    normalizeRecommendationContract,
    parseExtraSkus
  }
};