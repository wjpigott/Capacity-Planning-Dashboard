const { DefaultAzureCredential } = require('@azure/identity');
const crypto = require('crypto');
const { getRegionsForPreset } = require('../config/regionPresets');
const { insertCapacitySnapshots } = require('../store/sql');

const ARM_SCOPE = 'https://management.azure.com/.default';
const ARM_BASE = 'https://management.azure.com';

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
  const source = explicitFilters && explicitFilters.length > 0
    ? explicitFilters.join(',')
    : (process.env.INGEST_QUOTA_FAMILY_FILTERS || 'standard_BS,standard_DS');

  return source
    .split(',')
    .map((v) => normalize(v))
    .filter(Boolean);
}

function familyMatches(familyName, normalizedFilters) {
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
    const response = await fetch(next, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`ARM GET failed (${response.status}) for ${next}: ${body}`);
    }

    const payload = await response.json();
    if (Array.isArray(payload.value)) {
      all.push(...payload.value);
    }

    next = payload.nextLink || null;
  }

  return all;
}

async function listSubscriptions(token, explicitSubscriptions) {
  if (explicitSubscriptions && explicitSubscriptions.length > 0) {
    return explicitSubscriptions.map((subId) => ({
      subscriptionId: subId,
      displayName: 'Configured subscription'
    }));
  }

  const configured = (process.env.INGEST_SUBSCRIPTION_IDS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    return configured.map((subId) => ({
      subscriptionId: subId,
      displayName: 'Configured subscription'
    }));
  }

  const url = `${ARM_BASE}/subscriptions?api-version=2020-01-01`;
  const subscriptions = await armGetAll(url, token);
  return subscriptions
    .filter((s) => (s.state || '').toLowerCase() === 'enabled')
    .map((s) => ({
      subscriptionId: s.subscriptionId,
      displayName: s.displayName || 'Subscription'
    }))
    .filter((s) => Boolean(s.subscriptionId));
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

async function armGetWithRetry(url, token, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await armGet(url, token);
    } catch (err) {
      const status = err.response?.status;
      // 429 = rate limit, 503 = service unavailable
      if ((status === 429 || status === 503) && attempt < maxRetries - 1) {
        const delayMs = (err.response?.headers?.['retry-after'] || Math.pow(2, attempt + 1)) * 1000;
        console.warn(`ARM API rate limit or unavailable (${status}). Retrying after ${delayMs}ms...`);
        await sleep(delayMs);
        continue;
      }
      throw err;
    }
  }
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
        for (const region of regions) {
          const usageUrl = `${ARM_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.Compute/locations/${region}/usages?api-version=2024-03-01`;
          const skusUrl = `${ARM_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.Compute/skus?$filter=${encodeURIComponent(`location eq '${region}'`)}&api-version=2024-03-01`;

          const usages = await armGetAll(usageUrl, token);
          const skus = await armGetAll(skusUrl, token);

          const familyUsages = usages.filter((item) => familyMatches(item?.name?.value, familyFilters));

          for (const usage of familyUsages) {
            const familyName = usage?.name?.value;
            const representativeSku = pickRepresentativeSku(skus, familyName);
            const quotaCurrent = Number(usage?.currentValue || 0);
            const quotaLimit = Number(usage?.limit || 0);

            rows.push({
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
        }
      }
    }

    const insertedRows = await insertCapacitySnapshots(rows);
    const durationMs = Date.now() - started;

    ingestStatus.lastSuccessUtc = new Date().toISOString();
    ingestStatus.lastDurationMs = durationMs;
    ingestStatus.lastInsertedRows = insertedRows;
    ingestStatus.lastSummary = {
      subscriptionCount: subscriptions.length,
      subscriptionKeys: [...new Set(rows.map((r) => r.subscriptionKey))],
      regions,
      familyFilters,
      insertedRows
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
