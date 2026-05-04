const fs = require('fs');
const { execFile } = require('child_process');
const https = require('https');
const path = require('path');
const { pipeline } = require('stream/promises');
const { DefaultAzureCredential } = require('@azure/identity');
const { getCapacityScoreSummary } = require('./capacityService');
const { getRegionsForPreset } = require('../config/regionPresets');
const { saveLivePlacementSnapshots, logDashboardOperation, insertDashboardErrorLog } = require('../store/sql');

// The ARM placement score API supports up to five SKUs per request. The worker and
// web fallback use direct REST before falling back to the Az.Compute cmdlet, which
// avoids the cmdlet parser issue and reduces API throttling from one-call-per-SKU.
const DEFAULT_MAX_SKUS_PER_CALL = 5;
const DEFAULT_MAX_REGIONS_PER_CALL = 8;
const POWERSHELL_RELEASE_API = 'https://api.github.com/repos/PowerShell/PowerShell/releases/latest';
const DEFAULT_WORKER_TIMEOUT_MS = 60000;
const DEFAULT_RECOMMENDATION_WORKER_TIMEOUT_MS = 180000;
const DEFAULT_RECOMMENDATION_OUTPUT_BUFFER_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_LIVE_PLACEMENT_CALLS = 10;
const DEFAULT_ARM_MAX_RETRIES = 3;
const DEFAULT_ARM_TIMEOUT_MS = 30000;
const DEFAULT_RECOMMENDATION_REGION_CONCURRENCY = 4;
const DEFAULT_HOURS_PER_MONTH = 730;
const ARM_SCOPE = 'https://management.azure.com/.default';
const ARM_BASE = 'https://management.azure.com';
const PLACEMENT_API_VERSION = '2025-06-05';
const COMPUTE_SKUS_API_VERSION = '2024-03-01';
const SUBSCRIPTIONS_API_VERSION = '2020-01-01';
const RETAIL_PRICING_BASE = 'https://prices.azure.com/api/retail/prices';

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
let armCredential;

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

function shouldUseRemotePlacementWorker() {
  return useWorkerFirstMode() && String(process.env.CAPACITY_LIVE_PLACEMENT_USE_WORKER || 'true').toLowerCase() !== 'false';
}

function shouldUseDirectRecommendationApi() {
  return String(process.env.CAPACITY_RECOMMEND_USE_DIRECT_API || '').toLowerCase() === 'true';
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

function getArmCredential() {
  if (!armCredential) {
    const managedIdentityClientId = process.env.INGEST_MSI_CLIENT_ID || process.env.AZURE_CLIENT_ID || process.env.SQL_MSI_CLIENT_ID;
    armCredential = new DefaultAzureCredential({ managedIdentityClientId });
  }

  return armCredential;
}

async function getArmAccessToken() {
  const token = await getArmCredential().getToken(ARM_SCOPE);
  if (!token || !token.token) {
    throw new Error('Failed to acquire an Azure Resource Manager token with DefaultAzureCredential.');
  }

  return token.token;
}

function extractPlacementRows(payload) {
  if (Array.isArray(payload?.placementScores)) {
    return payload.placementScores;
  }

  if (Array.isArray(payload?.rows)) {
    return payload.rows;
  }

  if (Array.isArray(payload?.value)) {
    return payload.value;
  }

  return [];
}

function normalizePlacementScoreRows(payload) {
  return extractPlacementRows(payload)
    .map((row) => {
      const sku = normalizeSkuName(row?.sku || row?.Sku || row?.skuName || row?.SkuName || row?.vmSize || row?.VmSize || row?.armSkuName || row?.ArmSkuName || '');
      const region = String(row?.region || row?.Region || row?.location || row?.Location || row?.armRegionName || row?.ArmRegionName || '')
        .trim()
        .toLowerCase();
      const scoreValue = row?.score ?? row?.Score ?? row?.placementScore ?? row?.PlacementScore ?? row?.availabilityScore ?? row?.AvailabilityScore ?? null;
      const score = scoreValue == null || scoreValue === '' ? 'N/A' : String(scoreValue);
      const isAvailable = row?.isQuotaAvailable ?? row?.IsQuotaAvailable ?? row?.isAvailable ?? row?.IsAvailable ?? null;
      const isRestricted = row?.isRestricted ?? row?.IsRestricted ?? null;

      if (!sku || !region) {
        return null;
      }

      return {
        sku,
        region,
        score,
        isAvailable: typeof isAvailable === 'boolean' ? isAvailable : null,
        isRestricted: typeof isRestricted === 'boolean' ? isRestricted : null
      };
    })
    .filter(Boolean);
}

async function runPlacementLookupDirect({ subscriptionId, skus, regions, desiredCount }) {
  const normalizedSubscriptionId = String(subscriptionId || '').trim();
  const normalizedSkus = [...new Set((Array.isArray(skus) ? skus : []).map(normalizeSkuName).filter(Boolean))];
  const normalizedRegions = [...new Set((Array.isArray(regions) ? regions : []).map((region) => String(region || '').trim().toLowerCase()).filter(Boolean))];

  if (!normalizedSubscriptionId) {
    throw new Error('Live placement direct lookup requires a subscription id.');
  }

  if (normalizedSkus.length === 0 || normalizedRegions.length === 0) {
    return {
      rows: [],
      diagnostics: {
        executionMode: 'local-app-service-direct-rest',
        transport: 'arm-rest',
        warning: 'Live placement direct lookup skipped because no valid SKU or region values were provided.'
      }
    };
  }

  const anchorRegion = normalizedRegions[0];
  const token = await getArmAccessToken();
  const url = `${ARM_BASE}/subscriptions/${encodeURIComponent(normalizedSubscriptionId)}/providers/Microsoft.Compute/locations/${encodeURIComponent(anchorRegion)}/placementScores/spot/generate?api-version=${PLACEMENT_API_VERSION}`;
  const requestBody = {
    desiredLocations: normalizedRegions,
    desiredSizes: normalizedSkus.map((sku) => ({ sku })),
    desiredCount: Math.max(1, Math.min(Number(desiredCount) || 1, 1000))
  };
  const startedAt = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });
  const elapsedMs = Date.now() - startedAt;
  const rawText = await response.text();
  const payload = parseJsonFromMixedOutput(rawText) ?? rawText;

  if (!response.ok) {
    const detail = typeof payload === 'string'
      ? payload
      : (payload?.error?.message || payload?.message || JSON.stringify(payload));
    const error = new Error(`Direct placement REST failed (${response.status}) for ${anchorRegion}: ${detail}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return {
    rows: normalizePlacementScoreRows(payload),
    diagnostics: {
      executionMode: 'local-app-service-direct-rest',
      transport: 'arm-rest',
      subscriptionId: normalizedSubscriptionId,
      anchorRegion,
      requestedSkus: normalizedSkus,
      requestedRegions: normalizedRegions,
      requestedDesiredCount: requestBody.desiredCount,
      elapsedMs,
      apiVersion: PLACEMENT_API_VERSION
    }
  };
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(retryAfterHeader, attempt) {
  if (!retryAfterHeader) {
    return Math.pow(2, attempt + 1) * 1000;
  }

  const asSeconds = Number.parseInt(retryAfterHeader, 10);
  if (Number.isFinite(asSeconds)) {
    return Math.max(asSeconds, 1) * 1000;
  }

  const asDateMs = Date.parse(retryAfterHeader);
  if (!Number.isNaN(asDateMs)) {
    return Math.max(asDateMs - Date.now(), 1000);
  }

  return Math.pow(2, attempt + 1) * 1000;
}

async function fetchJsonWithRetry(url, { method = 'GET', token = null, body = null, maxRetries = DEFAULT_ARM_MAX_RETRIES } = {}) {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), DEFAULT_ARM_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });

      if (response.ok) {
        return response.json();
      }

      if ((response.status === 429 || response.status === 503) && attempt < maxRetries - 1) {
        const delayMs = getRetryDelayMs(response.headers.get('retry-after'), attempt);
        await sleep(delayMs);
        continue;
      }

      const responseText = await response.text();
      throw new Error(`Request failed (${response.status}) for ${url}: ${responseText}`);
    } catch (error) {
      if (attempt >= maxRetries - 1) {
        throw error;
      }

      const isAbort = error?.name === 'AbortError';
      const delayMs = getRetryDelayMs(null, attempt);
      if (isAbort) {
        await sleep(delayMs);
        continue;
      }

      const message = String(error?.message || 'request failed').toLowerCase();
      const isRetryableNetworkError = message.includes('fetch failed') || message.includes('network') || message.includes('timed out');
      if (!isRetryableNetworkError) {
        throw error;
      }

      await sleep(delayMs);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw new Error(`Request failed after retries for ${url}`);
}

async function armGetAll(url, token) {
  const items = [];
  let nextUrl = url;

  while (nextUrl) {
    const payload = await fetchJsonWithRetry(nextUrl, { token });
    if (Array.isArray(payload?.value)) {
      items.push(...payload.value);
    }
    nextUrl = payload?.nextLink || null;
  }

  return items;
}

async function retailGetAll(url) {
  const items = [];
  let nextUrl = url;

  while (nextUrl) {
    const payload = await fetchJsonWithRetry(nextUrl);
    if (Array.isArray(payload?.Items)) {
      items.push(...payload.Items);
    }
    nextUrl = payload?.NextPageLink || null;
  }

  return items;
}

async function mapWithConcurrency(items, concurrency, worker) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const safeConcurrency = Math.max(1, Math.min(Number(concurrency) || 1, items.length));
  const results = new Array(items.length);
  let currentIndex = 0;

  const runners = Array.from({ length: safeConcurrency }, async () => {
    while (currentIndex < items.length) {
      const itemIndex = currentIndex;
      currentIndex += 1;
      results[itemIndex] = await worker(items[itemIndex], itemIndex);
    }
  });

  await Promise.all(runners);
  return results;
}

function getCapabilityValue(capabilities, name) {
  const match = (capabilities || []).find((capability) => String(capability?.name || capability?.Name || '').toLowerCase() === String(name || '').toLowerCase());
  return match?.value ?? match?.Value ?? null;
}

function getSkuFamily(skuName) {
  const match = String(skuName || '').match(/Standard_([A-Z]+)\d/i);
  return match?.[1] || 'Unknown';
}

function getSkuFamilyVersion(skuName) {
  const match = String(skuName || '').match(/_v(\d+)/i);
  return match ? Number(match[1]) : 1;
}

function getProcessorVendor(skuName) {
  const body = String(skuName || '').replace(/^Standard_/i, '').replace(/_v\d+$/i, '');
  if (/p(?![\d])/i.test(body)) {
    return 'ARM';
  }
  const family = getSkuFamily(skuName);
  if (family !== 'A' && /a(?![\d])/i.test(body)) {
    return 'AMD';
  }
  return 'Intel';
}

function getDiskCode({ hasTempDisk, hasNvme }) {
  if (hasNvme && hasTempDisk) return 'NV+T';
  if (hasNvme) return 'NVMe';
  if (hasTempDisk) return 'SC+T';
  return 'SCSI';
}

function getSkuCapabilities(sku) {
  const tempDiskMb = Number(getCapabilityValue(sku?.capabilities, 'MaxResourceVolumeMB') || 0);
  return {
    HyperVGenerations: getCapabilityValue(sku?.capabilities, 'HyperVGenerations') || 'V1',
    CpuArchitecture: getCapabilityValue(sku?.capabilities, 'CpuArchitectureType') || 'x64',
    TempDiskGB: tempDiskMb > 0 ? Math.round(tempDiskMb / 1024) : 0,
    AcceleratedNetworkingEnabled: String(getCapabilityValue(sku?.capabilities, 'AcceleratedNetworkingEnabled') || '').toLowerCase() === 'true',
    NvmeSupport: getCapabilityValue(sku?.capabilities, 'NvmeDiskSizeInMiB') != null,
    MaxDataDiskCount: Number(getCapabilityValue(sku?.capabilities, 'MaxDataDiskCount') || 0),
    MaxNetworkInterfaces: Number(getCapabilityValue(sku?.capabilities, 'MaxNetworkInterfaces') || 1),
    EphemeralOSDiskSupported: String(getCapabilityValue(sku?.capabilities, 'EphemeralOSDiskSupported') || '').toLowerCase() === 'true',
    UltraSSDAvailable: String(getCapabilityValue(sku?.capabilities, 'UltraSSDAvailable') || '').toLowerCase() === 'true',
    UncachedDiskIOPS: Number(getCapabilityValue(sku?.capabilities, 'UncachedDiskIOPS') || 0),
    UncachedDiskBytesPerSecond: Number(getCapabilityValue(sku?.capabilities, 'UncachedDiskBytesPerSecond') || 0),
    EncryptionAtHostSupported: String(getCapabilityValue(sku?.capabilities, 'EncryptionAtHostSupported') || '').toLowerCase() === 'true'
  };
}

function getRestrictionDetails(sku, region = null) {
  const locationInfo = Array.isArray(sku?.locationInfo)
    ? (region
      ? sku.locationInfo.find((entry) => String(entry?.location || '').toLowerCase() === String(region || '').toLowerCase()) || sku.locationInfo[0]
      : sku.locationInfo[0])
    : null;
  const allZones = Array.isArray(locationInfo?.zones) ? locationInfo.zones.map((zone) => String(zone)) : [];

  if (!Array.isArray(sku?.restrictions) || sku.restrictions.length === 0) {
    return {
      Status: 'OK',
      ZonesOK: allZones,
      ZonesLimited: [],
      ZonesRestricted: [],
      RestrictionReasons: []
    };
  }

  const zonesOk = new Set();
  const zonesLimited = new Set();
  const zonesRestricted = new Set();
  const reasonCodes = new Set();

  for (const restriction of sku.restrictions) {
    const type = String(restriction?.type || restriction?.Type || '');
    const reasonCode = String(restriction?.reasonCode || restriction?.ReasonCode || '');
    if (reasonCode) {
      reasonCodes.add(reasonCode);
    }
    const zones = Array.isArray(restriction?.restrictionInfo?.zones)
      ? restriction.restrictionInfo.zones
      : (Array.isArray(restriction?.RestrictionInfo?.Zones) ? restriction.RestrictionInfo.Zones : []);
    if (type !== 'Zone' || zones.length === 0) {
      continue;
    }

    for (const zone of zones) {
      const zoneText = String(zone);
      if (reasonCode === 'NotAvailableForSubscription') {
        zonesLimited.add(zoneText);
      } else {
        zonesRestricted.add(zoneText);
      }
    }
  }

  for (const zone of allZones) {
    if (!zonesLimited.has(zone) && !zonesRestricted.has(zone)) {
      zonesOk.add(zone);
    }
  }

  const status = zonesRestricted.size > 0
    ? (zonesOk.size === 0 ? 'RESTRICTED' : 'PARTIAL')
    : (zonesLimited.size > 0
      ? (zonesOk.size === 0 ? 'LIMITED' : 'CAPACITY-CONSTRAINED')
      : 'OK');

  return {
    Status: status,
    ZonesOK: [...zonesOk].sort(),
    ZonesLimited: [...zonesLimited].sort(),
    ZonesRestricted: [...zonesRestricted].sort(),
    RestrictionReasons: [...reasonCodes]
  };
}

function buildRecommendationSkuProfile(sku) {
  const caps = getSkuCapabilities(sku);
  const hasNvme = caps.NvmeSupport;
  return {
    Name: normalizeSkuName(sku?.name || sku?.Name || ''),
    vCPU: Number(getCapabilityValue(sku?.capabilities, 'vCPUs') || 0),
    MemoryGB: Number(getCapabilityValue(sku?.capabilities, 'MemoryGB') || 0),
    Family: getSkuFamily(sku?.name || sku?.Name || ''),
    FamilyVersion: getSkuFamilyVersion(sku?.name || sku?.Name || ''),
    Generation: caps.HyperVGenerations,
    Architecture: caps.CpuArchitecture,
    PremiumIO: String(getCapabilityValue(sku?.capabilities, 'PremiumIO') || '').toLowerCase() === 'true',
    Processor: getProcessorVendor(sku?.name || sku?.Name || ''),
    TempDiskGB: caps.TempDiskGB,
    DiskCode: getDiskCode({ hasTempDisk: caps.TempDiskGB > 0, hasNvme }),
    AccelNet: caps.AcceleratedNetworkingEnabled,
    MaxDataDiskCount: caps.MaxDataDiskCount,
    MaxNetworkInterfaces: caps.MaxNetworkInterfaces,
    EphemeralOSDiskSupported: caps.EphemeralOSDiskSupported,
    UltraSSDAvailable: caps.UltraSSDAvailable,
    UncachedDiskIOPS: caps.UncachedDiskIOPS,
    UncachedDiskBytesPerSecond: caps.UncachedDiskBytesPerSecond,
    EncryptionAtHostSupported: caps.EncryptionAtHostSupported,
    Caps: caps
  };
}

function testSkuCompatibility(target, candidate) {
  const failures = [];
  const targetFamily = target?.Family || getSkuFamily(target?.Name);
  const candidateFamily = candidate?.Family || getSkuFamily(candidate?.Name);

  if (candidateFamily === 'B' && targetFamily !== 'B') {
    failures.push(`Category: burstable (B-series) cannot replace non-burstable (${targetFamily}-series)`);
  }
  if (candidate.vCPU > 0 && target.vCPU > 0 && candidate.vCPU < target.vCPU) {
    failures.push(`vCPU: candidate ${candidate.vCPU} < target ${target.vCPU}`);
  }
  if (candidate.vCPU > 0 && target.vCPU > 0 && candidate.vCPU > (target.vCPU * 2)) {
    failures.push(`vCPU: candidate ${candidate.vCPU} exceeds 2x target ${target.vCPU} (licensing risk)`);
  }
  if (candidate.MemoryGB > 0 && target.MemoryGB > 0 && candidate.MemoryGB < target.MemoryGB) {
    failures.push(`MemoryGB: candidate ${candidate.MemoryGB} < target ${target.MemoryGB}`);
  }
  if (target.MaxNetworkInterfaces > 1 && candidate.MaxNetworkInterfaces < target.MaxNetworkInterfaces) {
    failures.push(`MaxNICs: candidate ${candidate.MaxNetworkInterfaces} < target ${target.MaxNetworkInterfaces}`);
  }
  if (target.AccelNet === true && candidate.AccelNet !== true) {
    failures.push('AcceleratedNetworking: target requires it, candidate lacks it');
  }
  if (target.PremiumIO === true && candidate.PremiumIO !== true) {
    failures.push('PremiumIO: target requires it, candidate lacks it');
  }
  if (/NV/.test(String(target.DiskCode || '')) && !/NV/.test(String(candidate.DiskCode || ''))) {
    failures.push('DiskInterface: target uses NVMe, candidate only has SCSI');
  }
  if (target.EphemeralOSDiskSupported === true && candidate.EphemeralOSDiskSupported !== true) {
    failures.push('EphemeralOSDisk: target requires it, candidate lacks it');
  }
  if (target.UltraSSDAvailable === true && candidate.UltraSSDAvailable !== true) {
    failures.push('UltraSSD: target requires it, candidate lacks it');
  }

  return {
    Compatible: failures.length === 0,
    Failures: failures
  };
}

function getSkuSimilarityScore(target, candidate) {
  let score = 0;

  if (target.vCPU > 0 && candidate.vCPU > 0) {
    const maxCpu = Math.max(target.vCPU, candidate.vCPU);
    score += Math.round((1 - (Math.abs(target.vCPU - candidate.vCPU) / maxCpu)) * 20);
  }

  if (target.MemoryGB > 0 && candidate.MemoryGB > 0) {
    const maxMemory = Math.max(target.MemoryGB, candidate.MemoryGB);
    score += Math.round((1 - (Math.abs(target.MemoryGB - candidate.MemoryGB) / maxMemory)) * 20);
  }

  if (target.Family === candidate.Family) {
    score += 18;
  } else if (String(target.Family || '')[0] && String(target.Family || '')[0] === String(candidate.Family || '')[0]) {
    score += 9;
  }

  const targetVersion = Number(target.FamilyVersion || 1);
  const candidateVersion = Number(candidate.FamilyVersion || 1);
  if (target.Family === candidate.Family) {
    if (candidateVersion > targetVersion) {
      const versionBonus = candidateVersion >= 7 ? 4 : candidateVersion >= 6 ? 3 : candidateVersion >= 5 ? 2 : 1;
      score += Math.min(8 + versionBonus, 12);
    } else if (candidateVersion === targetVersion) {
      score += 5;
    } else {
      score += 1;
    }
  } else {
    score += candidateVersion >= 7 ? 10
      : candidateVersion >= 6 ? 9
        : candidateVersion >= 5 ? 7
          : candidateVersion >= 4 ? 5
            : candidateVersion >= 3 ? 3
              : candidateVersion >= 2 ? 1
                : 0;
  }

  if (target.Architecture === candidate.Architecture) {
    score += 10;
  }

  if (target.PremiumIO === true && candidate.PremiumIO === true) {
    score += 5;
  } else if (target.PremiumIO !== true) {
    score += 5;
  }

  if (target.UncachedDiskIOPS > 0 && candidate.UncachedDiskIOPS > 0) {
    const maxIops = Math.max(target.UncachedDiskIOPS, candidate.UncachedDiskIOPS);
    score += Math.round((1 - (Math.abs(target.UncachedDiskIOPS - candidate.UncachedDiskIOPS) / maxIops)) * 8);
  } else if (target.UncachedDiskIOPS <= 0) {
    score += 8;
  }

  if (target.MaxDataDiskCount > 0 && candidate.MaxDataDiskCount > 0) {
    const maxDisks = Math.max(target.MaxDataDiskCount, candidate.MaxDataDiskCount);
    score += Math.round((1 - (Math.abs(target.MaxDataDiskCount - candidate.MaxDataDiskCount) / maxDisks)) * 7);
  } else if (target.MaxDataDiskCount <= 0) {
    score += 7;
  }

  return Math.min(score, 100);
}

function getPricingCacheKey(region, skuName) {
  return `${String(region || '').trim().toLowerCase()}|${normalizeSkuName(skuName).toLowerCase()}`;
}

function pickConsumptionPrice(items) {
  const candidate = (items || [])
    .filter((item) => Number.isFinite(Number(item?.retailPrice)) && Number(item?.retailPrice) > 0)
    .sort((left, right) => Number(left.retailPrice) - Number(right.retailPrice))[0];
  return candidate ? Number(candidate.retailPrice) : null;
}

function getRetailPriceUrl(region, skuName) {
  const filters = [
    "serviceName eq 'Virtual Machines'",
    `armRegionName eq '${String(region || '').trim().toLowerCase()}'`,
    `armSkuName eq '${normalizeSkuName(skuName)}'`,
    "priceType eq 'Consumption'"
  ];

  return `${RETAIL_PRICING_BASE}?$filter=${encodeURIComponent(filters.join(' and '))}`;
}

async function getVmRetailPricing(region, skuName, cache) {
  const cacheKey = getPricingCacheKey(region, skuName);
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  try {
    const allItems = await retailGetAll(getRetailPriceUrl(region, skuName));
    const primaryItems = allItems.filter((item) => item?.isPrimaryMeterRegion === true);
    const linuxItems = primaryItems.filter((item) => !/windows/i.test(String(item?.productName || '')));
    const regularItems = linuxItems.filter((item) => !/spot|low priority/i.test(String(item?.meterName || item?.skuName || '')));
    const spotItems = linuxItems.filter((item) => /spot/i.test(String(item?.meterName || item?.skuName || '')));
    const hourly = pickConsumptionPrice(regularItems);
    const spotHourly = pickConsumptionPrice(spotItems);
    const pricing = {
      hourly,
      monthly: Number.isFinite(hourly) ? Number((hourly * DEFAULT_HOURS_PER_MONTH).toFixed(2)) : null,
      spotHourly,
      spotMonthly: Number.isFinite(spotHourly) ? Number((spotHourly * DEFAULT_HOURS_PER_MONTH).toFixed(2)) : null
    };
    cache.set(cacheKey, pricing);
    return pricing;
  } catch {
    const pricing = { hourly: null, monthly: null, spotHourly: null, spotMonthly: null };
    cache.set(cacheKey, pricing);
    return pricing;
  }
}

async function resolveRecommendationSubscriptionId() {
  const configuredSubscriptionId = String(process.env.CAPACITY_RECOMMEND_SUBSCRIPTION_ID || '').trim();
  if (configuredSubscriptionId) {
    return configuredSubscriptionId;
  }

  const configuredIngestSubscriptionId = parseCsv(process.env.INGEST_SUBSCRIPTION_IDS)[0] || null;
  if (configuredIngestSubscriptionId) {
    return configuredIngestSubscriptionId;
  }

  const token = await getArmAccessToken();
  const subscriptions = await armGetAll(`${ARM_BASE}/subscriptions?api-version=${SUBSCRIPTIONS_API_VERSION}`, token);
  const enabledSubscription = subscriptions.find((subscription) => String(subscription?.state || '').toLowerCase() === 'enabled');
  if (!enabledSubscription?.subscriptionId) {
    throw new Error('No enabled Azure subscription was available for the direct API recommender path.');
  }

  return String(enabledSubscription.subscriptionId);
}

async function fetchRecommendationRegionData(subscriptionId, regions) {
  const token = await getArmAccessToken();
  const regionConcurrency = Math.max(Number(process.env.CAPACITY_RECOMMEND_REGION_CONCURRENCY || DEFAULT_RECOMMENDATION_REGION_CONCURRENCY), 1);
  const regionResults = await mapWithConcurrency(regions, regionConcurrency, async (region) => {
    const skusUrl = `${ARM_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.Compute/skus?$filter=${encodeURIComponent(`location eq '${region}'`)}&api-version=${COMPUTE_SKUS_API_VERSION}`;
    const skus = await armGetAll(skusUrl, token);
    return {
      region,
      skus: skus.filter((sku) => String(sku?.resourceType || '').toLowerCase() === 'virtualmachines')
    };
  });

  return regionResults;
}

function buildRecommendationOutputContract({ targetProfile, targetAvailability, recommendations, warnings, belowMinSpec, minScore, topN, fetchPricing, showSpot, diagnostics }) {
  return {
    schemaVersion: '1.0',
    mode: 'recommend',
    generatedAt: new Date().toISOString(),
    minScore,
    topN,
    pricingEnabled: fetchPricing,
    placementEnabled: false,
    spotPricingEnabled: Boolean(fetchPricing && showSpot),
    target: targetProfile,
    targetAvailability,
    recommendations: recommendations.map((item, index) => ({
      rank: index + 1,
      sku: item.SKU,
      region: item.Region,
      vCPU: item.vCPU,
      memGiB: item.MemGiB,
      family: item.Family,
      purpose: item.Purpose,
      gen: item.Gen,
      arch: item.Arch,
      cpu: item.CPU,
      disk: item.Disk,
      tempDiskGB: item.TempGB,
      accelNet: item.AccelNet,
      maxDisks: item.MaxDisks,
      maxNICs: item.MaxNICs,
      iops: item.IOPS,
      score: item.Score,
      capacity: item.Capacity,
      allocScore: null,
      zonesOK: item.ZonesOK,
      priceHr: item.PriceHr,
      priceMo: item.PriceMo,
      spotPriceHr: item.SpotPriceHr,
      spotPriceMo: item.SpotPriceMo
    })),
    warnings,
    belowMinSpec: belowMinSpec.map((item) => ({
      sku: item.SKU,
      region: item.Region,
      vCPU: item.vCPU,
      memGiB: item.MemGiB,
      score: item.Score,
      capacity: item.Capacity
    })),
    diagnostics
  };
}

async function applyPricingToRecommendations(recommendations, { fetchPricing, showSpot }) {
  if (!fetchPricing || !Array.isArray(recommendations) || recommendations.length === 0) {
    return recommendations;
  }

  const pricingCache = new Map();
  const priced = await Promise.all(recommendations.map(async (item) => {
    const pricing = await getVmRetailPricing(item.Region, item.SKU, pricingCache);
    return {
      ...item,
      PriceHr: pricing.hourly,
      PriceMo: pricing.monthly,
      SpotPriceHr: showSpot ? pricing.spotHourly : null,
      SpotPriceMo: showSpot ? pricing.spotMonthly : null
    };
  }));
  return priced;
}

async function runRecommendationLookupDirect({ targetSku, regions, topN, minScore, showPricing, showSpot }) {
  const totalStartedAt = Date.now();
  const subscriptionId = await resolveRecommendationSubscriptionId();
  const dataCollectionStartedAt = Date.now();
  const regionData = await fetchRecommendationRegionData(subscriptionId, regions);
  const dataCollectionMs = Date.now() - dataCollectionStartedAt;

  let targetSkuEntry = null;
  const targetAvailability = [];
  for (const data of regionData) {
    for (const sku of data.skus) {
      if (normalizeSkuName(sku?.name) !== targetSku) {
        continue;
      }
      const restrictions = getRestrictionDetails(sku, data.region);
      targetAvailability.push({
        Region: String(data.region),
        Status: restrictions.Status,
        ZonesOK: restrictions.ZonesOK.length
      });
      if (!targetSkuEntry) {
        targetSkuEntry = sku;
      }
    }
  }

  if (!targetSkuEntry) {
    throw new Error(`SKU '${targetSku}' was not found in any scanned region.`);
  }

  const targetProfile = buildRecommendationSkuProfile(targetSkuEntry);
  const recommendStartedAt = Date.now();
  const candidates = [];

  for (const data of regionData) {
    for (const sku of data.skus) {
      const normalizedSku = normalizeSkuName(sku?.name);
      if (!normalizedSku || normalizedSku === targetSku) {
        continue;
      }

      const candidateProfile = buildRecommendationSkuProfile(sku);
      const restrictions = getRestrictionDetails(sku, data.region);

      const compatibility = testSkuCompatibility(targetProfile, candidateProfile);
      if (!compatibility.Compatible) {
        continue;
      }

      const similarityScore = getSkuSimilarityScore(targetProfile, candidateProfile);
      candidates.push({
        SKU: normalizedSku,
        Region: String(data.region),
        vCPU: candidateProfile.vCPU,
        MemGiB: candidateProfile.MemoryGB,
        Family: candidateProfile.Family,
        Purpose: '',
        Gen: String(candidateProfile.Generation || '').replace(/V/g, '').replace(/,/g, ','),
        Arch: candidateProfile.Architecture,
        CPU: candidateProfile.Processor,
        Disk: candidateProfile.DiskCode,
        TempGB: candidateProfile.TempDiskGB,
        AccelNet: candidateProfile.AccelNet,
        MaxDisks: candidateProfile.MaxDataDiskCount,
        MaxNICs: candidateProfile.MaxNetworkInterfaces,
        IOPS: candidateProfile.UncachedDiskIOPS,
        Score: similarityScore,
        Capacity: restrictions.Status,
        ZonesOK: restrictions.ZonesOK.length,
        PriceHr: null,
        PriceMo: null,
        SpotPriceHr: null,
        SpotPriceMo: null
      });
    }
  }

  const belowMinSpecBySku = new Map();
  let filtered = [...candidates];
  filtered.filter((item) => item.vCPU < targetProfile.vCPU && item.Capacity === 'OK').forEach((item) => {
    if (!belowMinSpecBySku.has(item.SKU)) {
      belowMinSpecBySku.set(item.SKU, item);
    }
  });
  filtered = filtered.filter((item) => item.vCPU >= targetProfile.vCPU);
  filtered.filter((item) => item.MemGiB < targetProfile.MemoryGB && item.Capacity === 'OK').forEach((item) => {
    if (!belowMinSpecBySku.has(item.SKU)) {
      belowMinSpecBySku.set(item.SKU, item);
    }
  });
  filtered = filtered.filter((item) => item.MemGiB >= targetProfile.MemoryGB);
  filtered = filtered.filter((item) => item.Score >= minScore);
  const belowMinSpec = [...belowMinSpecBySku.values()];

  const rankWeight = (value) => {
    if (value === 'OK') return 0;
    if (value === 'LIMITED') return 1;
    return 2;
  };

  let ranked = [...filtered]
    .sort((left, right) => right.Score - left.Score || rankWeight(left.Capacity) - rankWeight(right.Capacity) || right.ZonesOK - left.ZonesOK)
    .filter((item, index, array) => array.findIndex((entry) => entry.SKU === item.SKU) === index)
    .slice(0, topN);

  if (!ranked.some((item) => Number(item.vCPU) === Number(targetProfile.vCPU))) {
    const likeForLike = filtered
      .filter((item) => Number(item.vCPU) === Number(targetProfile.vCPU))
      .sort((left, right) => right.Score - left.Score)
      .find((item, index, array) => array.findIndex((entry) => entry.SKU === item.SKU) === index);
    if (likeForLike) {
      ranked = [...ranked, likeForLike];
    }
  }

  if (Number(targetProfile.UncachedDiskIOPS) > 0 && !ranked.some((item) => Number(item.IOPS) >= Number(targetProfile.UncachedDiskIOPS))) {
    const iopsMatch = filtered
      .filter((item) => Number(item.IOPS) >= Number(targetProfile.UncachedDiskIOPS))
      .sort((left, right) => right.Score - left.Score)
      .find((item, index, array) => array.findIndex((entry) => entry.SKU === item.SKU) === index);
    if (iopsMatch) {
      ranked = [...ranked, iopsMatch];
    }
  }

  ranked = await applyPricingToRecommendations(ranked, { fetchPricing: showPricing, showSpot });

  const recommendMs = Date.now() - recommendStartedAt;
  const diagnostics = {
    executionMode: 'local-app-service-direct-api',
    subscriptionId,
    performance: {
      dataCollectionMs,
      recommendMs,
      totalMs: Date.now() - totalStartedAt
    },
    counts: {
      regionCount: regionData.length,
      candidateCount: candidates.length,
      rankedCount: ranked.length,
      belowMinSpecCount: belowMinSpec.length
    }
  };

  return buildRecommendationOutputContract({
    targetProfile: {
      name: targetProfile.Name,
      vCPU: targetProfile.vCPU,
      MemoryGB: targetProfile.MemoryGB,
      Family: targetProfile.Family,
      FamilyVersion: targetProfile.FamilyVersion,
      Generation: targetProfile.Generation,
      Architecture: targetProfile.Architecture,
      PremiumIO: targetProfile.PremiumIO,
      Processor: targetProfile.Processor,
      TempDiskGB: targetProfile.TempDiskGB,
      DiskCode: targetProfile.DiskCode,
      AccelNet: targetProfile.AccelNet,
      MaxDataDiskCount: targetProfile.MaxDataDiskCount,
      MaxNetworkInterfaces: targetProfile.MaxNetworkInterfaces,
      EphemeralOSDiskSupported: targetProfile.EphemeralOSDiskSupported,
      UltraSSDAvailable: targetProfile.UltraSSDAvailable,
      UncachedDiskIOPS: targetProfile.UncachedDiskIOPS,
      UncachedDiskBytesPerSecond: targetProfile.UncachedDiskBytesPerSecond,
      EncryptionAtHostSupported: targetProfile.EncryptionAtHostSupported
    },
    targetAvailability,
    recommendations: ranked,
    warnings: [],
    belowMinSpec,
    minScore,
    topN,
    fetchPricing: showPricing,
    showSpot,
    diagnostics
  });
}

async function runPlacementLookupLocal({ subscriptionId, skus, regions, desiredCount }) {
  let directError = null;
  if (subscriptionId) {
    try {
      return await runPlacementLookupDirect({ subscriptionId, skus, regions, desiredCount });
    } catch (error) {
      directError = error;
    }
  }

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
            const combinedDetail = directError
              ? `Live placement lookup failed after direct REST fallback. Direct REST: ${directError.message}. PowerShell: ${detail}`
              : `Live placement lookup failed: ${detail}`;
            reject(new Error(combinedDetail));
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
                  transport: parsed?.diagnostics?.transport || 'powershell-wrapper',
                  shellCommand: command,
                  runtimeRoot: powerShellRuntime.diagnostics.runtimeRoot,
                  portablePwshPath: powerShellRuntime.diagnostics.portablePwshPath,
                  portablePwshExists: powerShellRuntime.diagnostics.portablePwshExists,
                  archivePath: powerShellRuntime.diagnostics.archivePath,
                  archiveExists: powerShellRuntime.diagnostics.archiveExists,
                  archiveSizeBytes: powerShellRuntime.diagnostics.archiveSizeBytes,
                  extractedEntries: powerShellRuntime.diagnostics.extractedEntries,
                  bootstrapError: powerShellRuntime.diagnostics.bootstrapError,
                  moduleBootstrapError: powerShellRuntime.diagnostics.moduleBootstrapError,
                  directRestFallbackReason: directError?.message || null
                }
              : {
                  executionMode: 'local-app-service',
                  transport: 'powershell-wrapper',
                  shellCommand: command,
                  runtimeRoot: powerShellRuntime.diagnostics.runtimeRoot,
                  portablePwshPath: powerShellRuntime.diagnostics.portablePwshPath,
                  portablePwshExists: powerShellRuntime.diagnostics.portablePwshExists,
                  archivePath: powerShellRuntime.diagnostics.archivePath,
                  archiveExists: powerShellRuntime.diagnostics.archiveExists,
                  archiveSizeBytes: powerShellRuntime.diagnostics.archiveSizeBytes,
                  extractedEntries: powerShellRuntime.diagnostics.extractedEntries,
                  bootstrapError: powerShellRuntime.diagnostics.bootstrapError,
                  moduleBootstrapError: powerShellRuntime.diagnostics.moduleBootstrapError,
                  directRestFallbackReason: directError?.message || null
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

async function runPlacementLookup({ subscriptionId, skus, regions, desiredCount }) {
  if (shouldUseRemotePlacementWorker()) {
    try {
      const remoteResult = await runRemotePlacementLookup({ skus, regions, desiredCount });
      if (remoteResult) {
        if (remotePlacementResultShouldFallback(remoteResult) && !shouldDisableLocalFallback()) {
          const localResult = await runPlacementLookupLocal({ subscriptionId, skus, regions, desiredCount });
          return {
            ...localResult,
            diagnostics: localResult.diagnostics
              ? {
                  ...localResult.diagnostics,
                  executionMode: 'function-app-empty-result-fallback',
                  workerUrl: resolveWorkerBaseUrl(),
                  fallbackReason: remoteResult.diagnostics?.warning || remoteResult.diagnostics?.restError || 'Remote worker returned no live placement rows.'
                }
              : {
                  executionMode: 'function-app-empty-result-fallback',
                  workerUrl: resolveWorkerBaseUrl(),
                  fallbackReason: remoteResult.diagnostics?.warning || remoteResult.diagnostics?.restError || 'Remote worker returned no live placement rows.'
                }
          };
        }
        return remoteResult;
      }
    } catch (error) {
      if (shouldDisableLocalFallback()) {
        throw error;
      }

      const localResult = await runPlacementLookupLocal({ subscriptionId, skus, regions, desiredCount });
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

  return runPlacementLookupLocal({ subscriptionId, skus, regions, desiredCount });
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

function remotePlacementResultShouldFallback(result) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const warning = result?.diagnostics?.warning || result?.diagnostics?.restError || null;
  return rows.length === 0 && warning && isRegionUnavailableWarningText(warning);
}

async function runPlacementLookupResilient({ subscriptionId, skus, regions, desiredCount }) {
  let initialResult = null;
  let initialError = null;
  try {
    initialResult = await runPlacementLookup({ subscriptionId, skus, regions, desiredCount });
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
      const result = await runPlacementLookup({ subscriptionId, skus, regions: [region], desiredCount });
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
  const maxBufferBytes = Number(process.env.CAPACITY_RECOMMEND_MAX_BUFFER_BYTES || DEFAULT_RECOMMENDATION_OUTPUT_BUFFER_BYTES);

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
          maxBuffer: maxBufferBytes,
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
            timeoutMs,
            maxBufferBytes,
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

            if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxBuffer/i.test(String(error.message || ''))) {
              reject(new Error(`Capacity recommendation failed: recommendation output exceeded the child-process buffer (${maxBufferBytes} bytes). Reduce the request scope or increase CAPACITY_RECOMMEND_MAX_BUFFER_BYTES. | Context: ${JSON.stringify(outputContext)}`));
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
  if (shouldUseDirectRecommendationApi()) {
    try {
      contract = await runRecommendationLookupDirect({
        targetSku,
        regions: resolvedRegions,
        topN,
        minScore,
        showPricing,
        showSpot
      });
    } catch (error) {
      const fallbackWarnings = [`Direct API recommender failed and fell back to the existing runner: ${error.message}`];
      try {
        const fallbackContract = useWorkerFirstMode()
          ? await runRemoteRecommendationLookup({
              targetSku,
              regions: resolvedRegions,
              topN,
              minScore,
              showPricing,
              showSpot
            })
          : await runRecommendationLookupLocal({
              targetSku,
              regions: resolvedRegions,
              topN,
              minScore,
              showPricing,
              showSpot
            });
        contract = {
          ...fallbackContract,
          warnings: [...new Set([...(Array.isArray(fallbackContract?.warnings) ? fallbackContract.warnings : []), ...fallbackWarnings])],
          diagnostics: fallbackContract?.diagnostics
            ? {
                ...fallbackContract.diagnostics,
                executionMode: `${fallbackContract.diagnostics.executionMode || 'fallback'}-after-direct-api-failure`,
                directApiFailure: error.message
              }
            : {
                executionMode: 'fallback-after-direct-api-failure',
                directApiFailure: error.message
              }
        };
      } catch {
        throw error;
      }
    }
  }

  try {
    if (!contract && useWorkerFirstMode()) {
      contract = await runRemoteRecommendationLookup({
        targetSku,
        regions: resolvedRegions,
        topN,
        minScore,
        showPricing,
        showSpot
      });
    } else if (!contract) {
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
  const selectedSubscriptionId = selectedSubscriptionIds[0] || null;
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
          subscriptionId: selectedSubscriptionId,
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

async function seedVmSkuCatalogIfEmpty({ region = process.env.SKU_CATALOG_SEED_REGION || 'eastus' } = {}) {
  const { upsertVmSkuCatalogRows, getVmSkuCatalogFamilies } = require('../store/sql');
  try {
    const existing = await getVmSkuCatalogFamilies();
    if (Array.isArray(existing) && existing.length > 0) {
      return { seeded: false, reason: 'already-populated', count: existing.length };
    }

    const subscriptionId = await resolveRecommendationSubscriptionId();
    const token = await getArmAccessToken();
    const url = `${ARM_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.Compute/skus?$filter=${encodeURIComponent(`location eq '${region}'`)}&api-version=${COMPUTE_SKUS_API_VERSION}`;
    const skus = await armGetAll(url, token);
    const rows = [];
    for (const sku of skus) {
      if (!sku || sku.resourceType !== 'virtualMachines') continue;
      const family = String(sku.family || '').trim();
      const name = String(sku.name || '').trim();
      if (!family || !name) continue;
      rows.push({
        skuFamily: family,
        skuName: name,
        vCpu: Number(getCapabilityValue(sku.capabilities, 'vCPUs') || 0) || null,
        memoryGB: Number(getCapabilityValue(sku.capabilities, 'MemoryGB') || 0) || null
      });
    }
    if (rows.length === 0) {
      return { seeded: false, reason: 'no-vm-skus' };
    }
    const result = await upsertVmSkuCatalogRows(rows);
    return { seeded: true, count: result.upserted, region };
  } catch (err) {
    console.warn('[seedVmSkuCatalogIfEmpty] Skipping seed due to error:', err?.message || err);
    return { seeded: false, reason: 'error', error: err?.message || String(err) };
  }
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
  seedVmSkuCatalogIfEmpty,
  __testHooks: {
    normalizeSkuName,
    isAggregateSkuName,
    normalizeRecommendationContract,
    parseExtraSkus,
    getRestrictionDetails,
    buildRecommendationSkuProfile,
    testSkuCompatibility,
    getSkuSimilarityScore,
    buildRecommendationOutputContract,
    runPlacementLookupDirect,
    runPlacementLookupLocal,
    shouldUseDirectRecommendationApi
  }
};