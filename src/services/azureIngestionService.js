const { DefaultAzureCredential } = require('@azure/identity');
const crypto = require('crypto');
const https = require('https');
const { getRegionsForPreset } = require('../config/regionPresets');
const { deriveCapacityScoreRows } = require('./capacityService');
const { insertCapacitySnapshots, insertCapacityScoreSnapshots } = require('../store/sql');

const ARM_SCOPE = 'https://management.azure.com/.default';
const ARM_BASE = 'https://management.azure.com';
const DEFAULT_ARM_MAX_RETRIES = 3;
const DEFAULT_REGION_CONCURRENCY = 4;
const DEFAULT_ARM_TIMEOUT_MS = 30000;

let schedulerHandle;
const ingestStatus = {
  inProgress: false,
  lastRunUtc: null,
  lastSuccessUtc: null,
  lastError: null,
  lastInsertedRows: 0,
  lastDurationMs: 0,
  lastSummary: null
};

function normalize(value) {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getFamilyFilters(explicitFilters) {
  // When no explicit filters are passed and the env var is absent/empty, return [] to mean "all families".
  const source = explicitFilters && explicitFilters.length > 0
    ? explicitFilters.join(',')
    : (process.env.INGEST_QUOTA_FAMILY_FILTERS || '');

  return source
    .split(',')
    .map((v) => normalize(v))
    .filter(Boolean);
}

function familyMatches(familyName, normalizedFilters) {
  // Empty filter list means no restriction — match every family.
  if (!normalizedFilters || normalizedFilters.length === 0) {
    return true;
  }
  const candidate = normalize(familyName);
  return normalizedFilters.some((filterValue) => candidate.includes(filterValue) || filterValue.includes(candidate));
}

function getRegions(regionPreset, explicitRegions) {
  if (explicitRegions && explicitRegions.length > 0) {
    return explicitRegions.map((r) => r.toLowerCase());
  }

  const preset = regionPreset || process.env.INGEST_REGION_PRESET || 'USMajor';
  return getRegionsForPreset(preset) || ['eastus', 'eastus2', 'centralus', 'westus', 'westus2'];
}

function getCredential() {
  const managedIdentityClientId = process.env.INGEST_MSI_CLIENT_ID || process.env.AZURE_CLIENT_ID || process.env.SQL_MSI_CLIENT_ID;
  return new DefaultAzureCredential({ managedIdentityClientId });
}

function getSubscriptionKey(subscriptionId) {
  const salt = process.env.INGEST_SUBSCRIPTION_HASH_SALT || '';
  const digest = crypto
    .createHash('sha256')
    .update(`${subscriptionId}|${salt}`)
    .digest('hex')
    .slice(0, 16);

  return `sub-${digest}`;
}

async function armGetAll(url, token) {
  const all = [];
  let next = url;

  while (next) {
    const response = await armGetPageWithRetry(next, token);
    const payload = await response.json();
    if (Array.isArray(payload.value)) {
      all.push(...payload.value);
    }

    next = payload.nextLink || null;
  }

  return all;
}

async function listSubscriptions(token, explicitSubscriptions) {
  const configured = (process.env.INGEST_SUBSCRIPTION_IDS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  const requested = (explicitSubscriptions && explicitSubscriptions.length > 0)
    ? explicitSubscriptions
    : configured;

  const requestedSet = new Set(requested.map((subId) => subId.toLowerCase()));

  const url = `${ARM_BASE}/subscriptions?api-version=2020-01-01`;
  const subscriptions = await armGetAll(url, token);
  const enabledSubscriptions = subscriptions
    .filter((s) => (s.state || '').toLowerCase() === 'enabled')
    .map((s) => ({
      subscriptionId: s.subscriptionId,
      displayName: s.displayName || 'Subscription'
    }))
    .filter((s) => Boolean(s.subscriptionId));

  if (requestedSet.size === 0) {
    return enabledSubscriptions;
  }

  const matchedSubscriptions = enabledSubscriptions.filter((s) => requestedSet.has(s.subscriptionId.toLowerCase()));

  const missingSubscriptions = requested
    .filter((subId) => !matchedSubscriptions.some((entry) => entry.subscriptionId.toLowerCase() === subId.toLowerCase()))
    .map((subId) => ({
      subscriptionId: subId,
      displayName: 'Configured subscription'
    }));

  return [...matchedSubscriptions, ...missingSubscriptions];
}

function getCapabilityValue(capabilities, name) {
  const match = (capabilities || []).find((c) => (c.name || '').toLowerCase() === name.toLowerCase());
  return match?.value;
}

function getZonesCsv(sku, region) {
  const locationInfo = (sku.locationInfo || []).find((entry) => (entry.location || '').toLowerCase() === region.toLowerCase());
  const zones = (locationInfo?.zones || []).map((z) => String(z).trim()).filter(Boolean);
  if (zones.length === 0) {
    return null;
  }
  return zones.sort().join(',');
}

function pickRepresentativeSku(skus, familyName) {
  const familyNorm = normalize(familyName);
  const candidates = skus
    .filter((sku) => sku.resourceType === 'virtualMachines')
    .filter((sku) => normalize(sku.family) === familyNorm);

  if (candidates.length === 0) {
    return null;
  }

  const unrestricted = candidates.find((sku) => !sku.restrictions || sku.restrictions.length === 0);
  return unrestricted || candidates[0];
}

function computeAvailabilityState(hasSku, quotaCurrent, quotaLimit) {
  if (!hasSku) {
    return 'RESTRICTED';
  }

  const available = quotaLimit - quotaCurrent;
  if (available <= 0) {
    return 'CONSTRAINED';
  }

  const limitedThreshold = Math.max(5, Math.round(quotaLimit * 0.1));
  if (available <= limitedThreshold) {
    return 'LIMITED';
  }

  return 'OK';
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

function getHeaderValue(headers, headerName) {
  const value = headers?.[headerName.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] || null;
  }

  return value || null;
}

function formatNetworkError(err) {
  const parts = [err?.message || 'Network request failed'];
  if (err?.code) {
    parts.push(`code=${err.code}`);
  }
  if (err?.cause?.code) {
    parts.push(`cause=${err.cause.code}`);
  }
  if (err?.cause?.message) {
    parts.push(err.cause.message);
  }

  return parts.join(' | ');
}

function armGetPage(url, token, { forceIPv4 = false } = {}) {
  const parsedUrl = new URL(url);

  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || undefined,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: 'GET',
      family: forceIPv4 ? 4 : undefined,
      timeout: DEFAULT_ARM_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${token}`
      }
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({
          ok: (response.statusCode || 0) >= 200 && (response.statusCode || 0) < 300,
          status: response.statusCode || 0,
          headers: {
            get: (headerName) => getHeaderValue(response.headers, headerName)
          },
          json: async () => JSON.parse(body || '{}'),
          text: async () => body
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(Object.assign(new Error(`ARM GET timed out after ${DEFAULT_ARM_TIMEOUT_MS}ms for ${url}`), { code: 'ETIMEDOUT' }));
    });

    request.on('error', reject);
    request.end();
  });
}

async function armGetPageWithRetry(url, token) {
  const maxRetries = Math.max(Number(process.env.INGEST_ARM_MAX_RETRIES || DEFAULT_ARM_MAX_RETRIES), 1);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let response;
    try {
      response = await armGetPage(url, token);
    } catch (primaryError) {
      try {
        response = await armGetPage(url, token, { forceIPv4: true });
      } catch (ipv4Error) {
        const networkMessage = `ARM GET network failure for ${url}: ${formatNetworkError(ipv4Error.code === primaryError.code ? primaryError : ipv4Error)}`;
        const retryableNetworkError = attempt < maxRetries - 1;
        if (retryableNetworkError) {
          const delayMs = getRetryDelayMs(null, attempt);
          console.warn(`${networkMessage}. Retrying in ${delayMs}ms...`);
          await sleep(delayMs);
          continue;
        }

        throw new Error(networkMessage);
      }
    }

    if (response.ok) {
      return response;
    }

    const retryable = response.status === 429 || response.status === 503;
    if (retryable && attempt < maxRetries - 1) {
      const retryAfter = response.headers.get('retry-after');
      const delayMs = getRetryDelayMs(retryAfter, attempt);
      console.warn(`ARM GET throttled/unavailable (${response.status}) for ${url}. Retrying in ${delayMs}ms...`);
      await sleep(delayMs);
      continue;
    }

    const body = await response.text();
    throw new Error(`ARM GET failed (${response.status}) for ${url}: ${body}`);
  }

  throw new Error(`ARM GET failed after retries for ${url}`);
}

async function mapWithConcurrency(items, concurrency, worker) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const safeConcurrency = Math.max(1, Math.min(concurrency || 1, items.length));
  const results = new Array(items.length);
  let index = 0;

  const runners = Array.from({ length: safeConcurrency }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  });

  await Promise.all(runners);
  return results;
}

async function runCapacityIngestion(options = {}) {
  if (ingestStatus.inProgress) {
    throw new Error('Capacity ingestion is already running.');
  }

  const started = Date.now();
  ingestStatus.inProgress = true;
  ingestStatus.lastRunUtc = new Date().toISOString();
  ingestStatus.lastError = null;

  try {
    const credential = getCredential();
    const token = (await credential.getToken(ARM_SCOPE)).token;
    const subscriptions = await listSubscriptions(token, options.subscriptionIds);
    const regions = getRegions(options.regionPreset, options.regions);
    const regionConcurrency = Math.max(
      Number(process.env.INGEST_REGION_CONCURRENCY || DEFAULT_REGION_CONCURRENCY),
      1
    );
    const familyFilters = getFamilyFilters(options.familyFilters);
    const capturedAtUtc = new Date();
    const rows = [];

    // Process subscriptions in batches to avoid ARM API rate limits
    const batchSize = 100;
    const subscriptionBatches = [];
    for (let i = 0; i < subscriptions.length; i += batchSize) {
      subscriptionBatches.push(subscriptions.slice(i, i + batchSize));
    }

    for (let batchIndex = 0; batchIndex < subscriptionBatches.length; batchIndex++) {
      const batch = subscriptionBatches[batchIndex];
      if (batchIndex > 0) {
        // 2-second delay between batches to avoid ARM throttling
        await sleep(2000);
      }

      for (const subscription of batch) {
        const subscriptionId = subscription.subscriptionId;
        const subscriptionName = subscription.displayName || 'Subscription';
        const subscriptionKey = getSubscriptionKey(subscriptionId);

        const regionRows = await mapWithConcurrency(regions, regionConcurrency, async (region) => {
          const usageUrl = `${ARM_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.Compute/locations/${region}/usages?api-version=2024-03-01`;
          const skusUrl = `${ARM_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.Compute/skus?$filter=${encodeURIComponent(`location eq '${region}'`)}&api-version=2024-03-01`;

          const [usages, skus] = await Promise.all([
            armGetAll(usageUrl, token),
            armGetAll(skusUrl, token)
          ]);

          const familyUsages = usages.filter((item) => familyMatches(item?.name?.value, familyFilters));
          const localRows = [];

          for (const usage of familyUsages) {
            const familyName = usage?.name?.value;
            const representativeSku = pickRepresentativeSku(skus, familyName);
            const quotaCurrent = Number(usage?.currentValue || 0);
            const quotaLimit = Number(usage?.limit || 0);

            localRows.push({
              capturedAtUtc,
              sourceType: 'live-azure-ingest',
              subscriptionKey,
              subscriptionId,
              subscriptionName,
              region,
              skuName: representativeSku?.name || `${familyName}-aggregate`,
              skuFamily: familyName,
              vCpu: Number(getCapabilityValue(representativeSku?.capabilities, 'vCPUs') || 0) || null,
              memoryGB: Number(getCapabilityValue(representativeSku?.capabilities, 'MemoryGB') || 0) || null,
              zonesCsv: representativeSku ? getZonesCsv(representativeSku, region) : null,
              availabilityState: computeAvailabilityState(Boolean(representativeSku), quotaCurrent, quotaLimit),
              quotaCurrent,
              quotaLimit,
              monthlyCostEstimate: null
            });
          }

          return localRows;
        });

        rows.push(...regionRows.flat());
      }
    }

    const insertedRows = await insertCapacitySnapshots(rows);
    const scoreRows = deriveCapacityScoreRows(rows).map((row) => ({
      ...row,
      capturedAtUtc,
      latestCapturedAtUtc: row.latestCapturedAtUtc || capturedAtUtc
    }));
    const insertedScoreRows = await insertCapacityScoreSnapshots(scoreRows);
    const durationMs = Date.now() - started;

    ingestStatus.lastSuccessUtc = new Date().toISOString();
    ingestStatus.lastDurationMs = durationMs;
    ingestStatus.lastInsertedRows = insertedRows;
    ingestStatus.lastSummary = {
      subscriptionCount: subscriptions.length,
      subscriptionKeys: [...new Set(rows.map((r) => r.subscriptionKey))],
      regions,
      familyFilters,
      insertedRows,
      insertedScoreRows
    };

    return ingestStatus.lastSummary;
  } catch (err) {
    ingestStatus.lastError = err.message;
    throw err;
  } finally {
    ingestStatus.inProgress = false;
  }
}

function getIngestionStatus() {
  return { ...ingestStatus };
}

function startIngestionScheduler() {
  if (schedulerHandle) {
    return;
  }

  const intervalMinutes = Number(process.env.INGEST_INTERVAL_MINUTES || 0);
  const runOnStartup = (process.env.INGEST_ON_STARTUP || '').toLowerCase() === 'true';

  if (runOnStartup) {
    setTimeout(() => {
      runCapacityIngestion().catch((err) => {
        ingestStatus.lastError = err.message;
      });
    }, 1000);
  }

  if (intervalMinutes > 0) {
    schedulerHandle = setInterval(() => {
      runCapacityIngestion().catch((err) => {
        ingestStatus.lastError = err.message;
      });
    }, intervalMinutes * 60 * 1000);
  }
}

module.exports = {
  runCapacityIngestion,
  getIngestionStatus,
  startIngestionScheduler
};
