const { DefaultAzureCredential } = require('@azure/identity');
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execFileAsync = promisify(execFile);

const ARM_SCOPE = 'https://management.azure.com/.default';
const ARM_BASE = 'https://management.azure.com';
const PLACEMENT_API_VERSION = '2025-06-05';

function parseArgs(argv) {
  const options = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = 'true';
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return options;
}

function parseCsv(value, fallback = []) {
  if (!value) {
    return fallback;
  }

  return String(value)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

async function resolveSubscriptionId(explicitValue) {
  const fromEnv = explicitValue
    || process.env.CAPACITY_SUBSCRIPTION_ID
    || process.env.AZURE_SUBSCRIPTION_ID
    || process.env.ARM_SUBSCRIPTION_ID;

  if (fromEnv) {
    return String(fromEnv).trim();
  }

  const { stdout } = await execFileAsync('az', ['account', 'show', '--query', 'id', '-o', 'tsv'], {
    cwd: process.cwd(),
    windowsHide: true
  });

  const subscriptionId = String(stdout || '').trim();
  if (!subscriptionId) {
    throw new Error('Unable to resolve subscription id. Pass --subscription <id> or set AZURE_SUBSCRIPTION_ID.');
  }

  return subscriptionId;
}

function getCredential() {
  const managedIdentityClientId = process.env.INGEST_MSI_CLIENT_ID || process.env.AZURE_CLIENT_ID || process.env.SQL_MSI_CLIENT_ID;
  return new DefaultAzureCredential({ managedIdentityClientId });
}

async function getArmToken() {
  const token = await getCredential().getToken(ARM_SCOPE);
  if (!token || !token.token) {
    throw new Error('Failed to acquire ARM token with DefaultAzureCredential.');
  }

  return token.token;
}

async function runDirectPlacementBenchmark({ subscriptionId, location, desiredLocations, sku, desiredCount }) {
  const token = await getArmToken();
  const url = `${ARM_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.Compute/locations/${location}/placementScores/spot/generate?api-version=${PLACEMENT_API_VERSION}`;
  const body = {
    desiredLocations,
    desiredSizes: [{ sku }],
    desiredCount
  };

  const startedAt = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const elapsedMs = Math.round(performance.now() - startedAt);

  const responseText = await response.text();
  let payload = null;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    payload = responseText;
  }

  if (!response.ok) {
    const error = new Error(`Direct placement REST failed (${response.status}).`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return {
    mode: 'direct-rest',
    elapsedMs,
    url,
    request: body,
    response: payload
  };
}

function resolvePowerShellCommand(explicitValue) {
  if (explicitValue) {
    return explicitValue;
  }

  if (process.platform === 'win32') {
    return 'pwsh';
  }

  return 'pwsh';
}

async function runPowerShellPlacementBenchmark({ repoRoot, powerShellCommand, sku, desiredLocations, desiredCount }) {
  const wrapperPath = path.join(repoRoot, 'tools', 'Get-LivePlacementScores.ps1');
  const placementRepoRoot = path.join(repoRoot, 'tools', 'Get-AzVMAvailability');
  const args = [
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    wrapperPath,
    '-RepoRoot',
    placementRepoRoot,
    '-SkuNamesJson',
    JSON.stringify([sku]),
    '-RegionsJson',
    JSON.stringify(desiredLocations),
    '-DesiredCount',
    String(desiredCount)
  ];

  const startedAt = performance.now();
  const { stdout, stderr } = await execFileAsync(powerShellCommand, args, {
    cwd: repoRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4
  });
  const elapsedMs = Math.round(performance.now() - startedAt);

  const trimmedStdout = String(stdout || '').trim();
  if (!trimmedStdout) {
    throw new Error(`PowerShell placement benchmark returned no stdout.${stderr ? ` ${String(stderr).trim()}` : ''}`);
  }

  let payload;
  try {
    payload = JSON.parse(trimmedStdout);
  } catch (error) {
    throw new Error(`PowerShell placement benchmark returned invalid JSON: ${error.message}`);
  }

  return {
    mode: 'powershell-wrapper',
    elapsedMs,
    command: powerShellCommand,
    response: payload
  };
}

function extractPlacementScores(payload) {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload.placementScores)) {
    return payload.placementScores;
  }

  if (Array.isArray(payload.rows)) {
    return payload.rows;
  }

  return [];
}

function summarizeResult(result) {
  const rows = extractPlacementScores(result.response);
  return {
    mode: result.mode,
    elapsedMs: result.elapsedMs,
    rowCount: rows.length,
    scores: rows.map((row) => ({
      sku: row.sku || row.Sku || null,
      region: row.region || row.Region || null,
      score: row.score || row.Score || null,
      isQuotaAvailable: row.isQuotaAvailable ?? row.IsQuotaAvailable ?? row.isAvailable ?? row.IsAvailable ?? null
    }))
  };
}

async function main() {
  const options = parseArgs(process.argv);
  const repoRoot = path.resolve(__dirname, '..');
  const subscriptionId = await resolveSubscriptionId(options.subscription);
  const desiredLocations = parseCsv(options.regions || options.region, ['centralus']);
  const location = String(options.location || desiredLocations[0] || 'centralus').trim().toLowerCase();
  const sku = String(options.sku || 'Standard_D4s_v5').trim();
  const desiredCount = Math.max(1, Math.min(Number(options['desired-count'] || options.desiredCount || 1), 1000));
  const powerShellCommand = resolvePowerShellCommand(options.pwsh);

  if (desiredLocations.length === 0) {
    throw new Error('At least one region must be provided via --regions or --region.');
  }

  const direct = await runDirectPlacementBenchmark({
    subscriptionId,
    location,
    desiredLocations,
    sku,
    desiredCount
  });

  const powershell = await runPowerShellPlacementBenchmark({
    repoRoot,
    powerShellCommand,
    sku,
    desiredLocations,
    desiredCount
  });

  const summary = {
    subscriptionId,
    location,
    desiredLocations,
    sku,
    desiredCount,
    direct: summarizeResult(direct),
    powershell: summarizeResult(powershell),
    deltaMs: powershell.elapsedMs - direct.elapsedMs
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  const detail = {
    message: error.message,
    status: error.status || null,
    payload: error.payload || null
  };
  console.error(JSON.stringify(detail, null, 2));
  process.exitCode = 1;
});