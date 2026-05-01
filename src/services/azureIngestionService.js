const { DefaultAzureCredential } = require('@azure/identity');
const crypto = require('crypto');
const https = require('https');
const { getRegionsForPreset } = require('../config/regionPresets');
const { deriveCapacityScoreRows } = require('./capacityService');
const { insertCapacitySnapshots, insertCapacityScoreSnapshots, upsertVmSkuCatalogRows } = require('../store/sql');
const {
  fetchAIUsages,
  fetchAIModelAvailability,
  mapAIUsageToSnapshot,
  mapAIModelToAvailability,
  insertAIModelAvailability,
  getAISettings,
  shouldRefreshModelCatalog
} = require('./aiIngestionService');

const ARM_SCOPE = 'https://management.azure.com/.default';
const ARM_BASE = 'https://management.azure.com';
const MANAGEMENT_API_VERSION = '2020-05-01';
const RETAIL_PRICING_BASE = 'https://prices.azure.com/api/retail/prices';
const DEFAULT_ARM_MAX_RETRIES = 3;
const DEFAULT_REGION_CONCURRENCY = 4;
const DEFAULT_ARM_TIMEOUT_MS = 30000;
const DEFAULT_HOURS_PER_MONTH = 730;

let schedulerHandle;
let schedulerConfig = {
  intervalMinutes: 0,
  runOnStartup: false
};
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

function parseCsvList(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => String(entry || '').split(','))
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
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

async function listManagementGroupSubscriptions(token, managementGroupName) {
  const url = `${ARM_BASE}/providers/Microsoft.Management/managementGroups/${encodeURIComponent(managementGroupName)}/descendants?api-version=${MANAGEMENT_API_VERSION}`;
  const descendants = await armGetAll(url, token);

  return descendants
    .filter((entry) => {
      const type = String(entry?.type || '').toLowerCase();
      const id = String(entry?.id || '').toLowerCase();
      return type.includes('subscriptions') || id.startsWith('/subscriptions/');
    })
    .map((entry) => ({
      subscriptionId: entry?.name || String(entry?.id || '').split('/').filter(Boolean).pop() || null,
      displayName: entry?.properties?.displayName || 'Management group subscription',
      managementGroupName
    }))
    .filter((entry) => Boolean(entry.subscriptionId));
}

async function listSubscriptions(token, explicitSubscriptions, explicitManagementGroupNames) {
  const configuredSubscriptions = parseCsvList(process.env.INGEST_SUBSCRIPTION_IDS);
  const configuredManagementGroupNames = parseCsvList(process.env.INGEST_MANAGEMENT_GROUP_NAMES);
  const requestedSubscriptions = parseCsvList(explicitSubscriptions);
  const requestedManagementGroupNames = parseCsvList(explicitManagementGroupNames);
  const effectiveSubscriptionIds = requestedSubscriptions.length > 0
    ? requestedSubscriptions
    : configuredSubscriptions;
  const effectiveManagementGroupNames = requestedManagementGroupNames.length > 0
    ? requestedManagementGroupNames
    : configuredManagementGroupNames;

  const requestedSet = new Set(effectiveSubscriptionIds.map((subId) => subId.toLowerCase()));
  const requestedDisplayNames = new Map(
    effectiveSubscriptionIds.map((subscriptionId) => [subscriptionId.toLowerCase(), 'Configured subscription'])
  );

  if (effectiveManagementGroupNames.length > 0) {
    const managementGroupResults = await Promise.all(
      [...new Set(effectiveManagementGroupNames.map((name) => name.toLowerCase()))].map(async (normalizedName) => {
        const originalName = effectiveManagementGroupNames.find((entry) => entry.toLowerCase() === normalizedName) || normalizedName;
        return listManagementGroupSubscriptions(token, originalName);
      })
    );

    managementGroupResults.flat().forEach((subscription) => {
      requestedSet.add(subscription.subscriptionId.toLowerCase());
      requestedDisplayNames.set(subscription.subscriptionId.toLowerCase(), subscription.displayName || 'Management group subscription');
    });
  }

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
  const matchedSet = new Set(matchedSubscriptions.map((entry) => entry.subscriptionId.toLowerCase()));

  const missingSubscriptions = [...requestedSet]
    .filter((subId) => !matchedSet.has(subId))
    .map((subId) => ({
      subscriptionId: subId,
      displayName: requestedDisplayNames.get(subId) || 'Configured subscription'
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
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || undefined,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: 'GET',
      family: forceIPv4 ? 4 : undefined,
      timeout: DEFAULT_ARM_TIMEOUT_MS,
      headers
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

function normalizeRegionName(region) {
  return String(region || '').trim().toLowerCase();
}

function normalizeSkuName(skuName) {
  return String(skuName || '').trim();
}

function getPricingCacheKey(region, skuName) {
  return `${normalizeRegionName(region)}|${normalizeSkuName(skuName).toLowerCase()}`;
}

function getRetailPriceUrl(region, skuName, includeSpot) {
  const filters = [
    "serviceName eq 'Virtual Machines'",
    `armRegionName eq '${normalizeRegionName(region)}'`,
    `armSkuName eq '${normalizeSkuName(skuName)}'`,
    "priceType eq 'Consumption'"
  ];

  if (includeSpot) {
    filters.push("contains(meterName, 'Spot')");
  } else {
    filters.push("contains(productName, 'Linux')");
    filters.push('isPrimaryMeterRegion eq true');
  }

  return `${RETAIL_PRICING_BASE}?$filter=${encodeURIComponent(filters.join(' and '))}`;
}

async function retailGetAll(url) {
  const all = [];
  let next = url;

  while (next) {
    const response = await armGetPageWithRetry(next, null);
    const payload = await response.json();
    if (Array.isArray(payload.Items)) {
      all.push(...payload.Items);
    }

    next = payload.NextPageLink || null;
  }

  return all;
}

function pickConsumptionPrice(items) {
  const candidate = (items || [])
    .filter((item) => Number.isFinite(Number(item?.retailPrice)) && Number(item.retailPrice) > 0)
    .sort((a, b) => Number(a.retailPrice) - Number(b.retailPrice))[0];

  return candidate ? Number(candidate.retailPrice) : null;
}

async function getVmRetailPricing(region, skuName, cache) {
  const cacheKey = getPricingCacheKey(region, skuName);
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const regularUrl = getRetailPriceUrl(region, skuName, false);
  const spotUrl = getRetailPriceUrl(region, skuName, true);

  try {
    const [regularItems, spotItems] = await Promise.all([
      retailGetAll(regularUrl),
      retailGetAll(spotUrl)
    ]);

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
    const pricing = {
      hourly: null,
      monthly: null,
      spotHourly: null,
      spotMonthly: null
    };
    cache.set(cacheKey, pricing);
    return pricing;
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
    const subscriptions = await listSubscriptions(token, options.subscriptionIds, options.managementGroupNames);
    const regions = getRegions(options.regionPreset, options.regions);
    const regionConcurrency = Math.max(
      Number(process.env.INGEST_REGION_CONCURRENCY || DEFAULT_REGION_CONCURRENCY),
      1
    );
    const familyFilters = getFamilyFilters(options.familyFilters);
    const capturedAtUtc = new Date();
    const rows = [];
    const pricingEnabled = String(process.env.INGEST_ENABLE_PRICING || 'true').toLowerCase() !== 'false';
    const pricingCache = new Map();
    
    // AI-specific ingestion tracking
    const aiSettings = await getAISettings();
    const aiRows = [];
    const aiModelRows = [];

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

          const catalogRows = [];
          for (const sku of skus) {
            if (!sku || sku.resourceType !== 'virtualMachines') continue;
            const family = String(sku.family || '').trim();
            const name = String(sku.name || '').trim();
            if (!family || !name) continue;
            catalogRows.push({
              skuFamily: family,
              skuName: name,
              vCpu: Number(getCapabilityValue(sku.capabilities, 'vCPUs') || 0) || null,
              memoryGB: Number(getCapabilityValue(sku.capabilities, 'MemoryGB') || 0) || null
            });
          }
          if (catalogRows.length > 0) {
            try {
              await upsertVmSkuCatalogRows(catalogRows);
            } catch (err) {
              console.warn(`[ingest] VmSkuCatalog upsert failed for ${region}: ${err?.message || err}`);
            }
          }

          const familyUsages = usages.filter((item) => familyMatches(item?.name?.value, familyFilters));
          const localRows = [];

          for (const usage of familyUsages) {
            const familyName = usage?.name?.value;
            const representativeSku = pickRepresentativeSku(skus, familyName);
            const quotaCurrent = Number(usage?.currentValue || 0);
            const quotaLimit = Number(usage?.limit || 0);
            const skuName = representativeSku?.name || `${familyName}-aggregate`;
            const pricing = (pricingEnabled && representativeSku?.name)
              ? await getVmRetailPricing(region, representativeSku.name, pricingCache)
              : { monthly: null };

            localRows.push({
              capturedAtUtc,
              sourceType: 'live-azure-ingest',
              subscriptionKey,
              subscriptionId,
              subscriptionName,
              region,
              skuName,
              skuFamily: familyName,
              vCpu: Number(getCapabilityValue(representativeSku?.capabilities, 'vCPUs') || 0) || null,
              memoryGB: Number(getCapabilityValue(representativeSku?.capabilities, 'MemoryGB') || 0) || null,
              zonesCsv: representativeSku ? getZonesCsv(representativeSku, region) : null,
              availabilityState: computeAvailabilityState(Boolean(representativeSku), quotaCurrent, quotaLimit),
              quotaCurrent,
              quotaLimit,
              monthlyCostEstimate: pricing.monthly
            });
          }

          return localRows;
        });

        rows.push(...regionRows.flat());
        
        // Ingest verified AI quota rows only when both the App Service flag and DB safety gate resolve on.
        if (aiSettings.aiEnabled) {
          const aiRegionRows = await mapWithConcurrency(regions, regionConcurrency, async (region) => {
            const aiUsages = await fetchAIUsages(armGetAll, token, subscriptionId, region, {
              includeAllProviders: aiSettings.providerQuotaEnabled
            });
            const localAiRows = aiUsages
              .map((usage) => mapAIUsageToSnapshot(usage, {
                capturedAtUtc,
                subscriptionKey,
                subscriptionId,
                subscriptionName,
                region
              }))
              .filter(Boolean);
             
            return localAiRows;
          });
          
          aiRows.push(...aiRegionRows.flat());
        }
      }
    }

    // Insert compute capacity snapshots
    const allRows = [...rows, ...aiRows];
    const insertedRows = await insertCapacitySnapshots(allRows);
    const scoreRows = deriveCapacityScoreRows(allRows).map((row) => ({
      ...row,
      capturedAtUtc,
      latestCapturedAtUtc: row.latestCapturedAtUtc || capturedAtUtc
    }));
    const insertedScoreRows = await insertCapacityScoreSnapshots(scoreRows);
    
    // Ingest AI model catalog if enabled and due for refresh
    let insertedAIModelRows = 0;
    if (aiSettings.aiEnabled && aiSettings.modelCatalogEnabled) {
      const shouldRefresh = await shouldRefreshModelCatalog(aiSettings.modelCatalogIntervalMinutes);
      if (shouldRefresh) {
        console.log(`Refreshing provider-discovered AI model catalog (interval: ${aiSettings.modelCatalogIntervalMinutes} minutes)`);
        
        // Fetch model catalog for one representative subscription (first in list)
        if (subscriptions.length > 0) {
          const subscription = subscriptions[0];
          const subscriptionId = subscription.subscriptionId;
          
          const modelRegionRows = await mapWithConcurrency(regions, regionConcurrency, async (region) => {
            const models = await fetchAIModelAvailability(armGetAll, token, subscriptionId, region);
            const localModelRows = models.map((model) =>
              mapAIModelToAvailability(model, {
                capturedAtUtc,
                subscriptionId,
                region
              })
            );
            
            return localModelRows;
          });
          
          aiModelRows.push(...modelRegionRows.flat());
          insertedAIModelRows = await insertAIModelAvailability(aiModelRows);
        }
      }
    }
    
    const durationMs = Date.now() - started;

    ingestStatus.lastSuccessUtc = new Date().toISOString();
    ingestStatus.lastDurationMs = durationMs;
    ingestStatus.lastInsertedRows = insertedRows;
    ingestStatus.lastSummary = {
      subscriptionCount: subscriptions.length,
      subscriptionKeys: [...new Set(allRows.map((r) => r.subscriptionKey))],
      regions,
      familyFilters,
      insertedRows,
      insertedScoreRows,
      insertedAIRows: aiRows.length,
      aiQuotaScope: aiSettings.providerQuotaEnabled ? 'provider-aware' : 'openai-only',
      insertedAIModelRows
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

function normalizeSchedulerConfig(config = {}) {
  const envInterval = Number(process.env.INGEST_INTERVAL_MINUTES || 0);
  const envRunOnStartup = String(process.env.INGEST_ON_STARTUP || '').toLowerCase() === 'true';

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

function applyIngestionScheduler(config = {}, options = {}) {
  const normalized = normalizeSchedulerConfig(config);
  const shouldRunStartup = Boolean(options.runStartup) && normalized.runOnStartup;

  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }

  schedulerConfig = normalized;

  if (shouldRunStartup) {
    setTimeout(() => {
      runCapacityIngestion().catch((err) => {
        ingestStatus.lastError = err.message;
      });
    }, 1000);
  }

  if (normalized.intervalMinutes > 0) {
    schedulerHandle = setInterval(() => {
      runCapacityIngestion().catch((err) => {
        ingestStatus.lastError = err.message;
      });
    }, normalized.intervalMinutes * 60 * 1000);
  }

  return { ...schedulerConfig };
}

function startIngestionScheduler(config = {}) {
  return applyIngestionScheduler(config, { runStartup: true });
}

function updateIngestionScheduler(config = {}) {
  return applyIngestionScheduler(config, { runStartup: false });
}

function getIngestionSchedulerConfig() {
  return { ...schedulerConfig };
}

async function refreshModelCatalog(options = {}) {
  const credential = getCredential();
  const token = (await credential.getToken(ARM_SCOPE)).token;
  const subscriptions = await listSubscriptions(token, options.subscriptionIds, options.managementGroupNames);
  if (subscriptions.length === 0) {
    return { ok: true, insertedAIModelRows: 0, message: 'No subscriptions available.' };
  }
  const regions = getRegions(options.regionPreset, options.regions);
  const regionConcurrency = Math.max(
    Number(process.env.INGEST_REGION_CONCURRENCY || DEFAULT_REGION_CONCURRENCY),
    1
  );
  const subscriptionId = subscriptions[0].subscriptionId;
  const capturedAtUtc = new Date();
  const allModelRows = [];

  const modelRegionRows = await mapWithConcurrency(regions, regionConcurrency, async (region) => {
    const models = await fetchAIModelAvailability(armGetAll, token, subscriptionId, region);
    return models.map((model) =>
      mapAIModelToAvailability(model, { capturedAtUtc, subscriptionId, region })
    );
  });

  allModelRows.push(...modelRegionRows.flat());
  const insertedAIModelRows = await insertAIModelAvailability(allModelRows);

  return { ok: true, insertedAIModelRows, regions, subscriptionId };
}

module.exports = {
  runCapacityIngestion,
  refreshModelCatalog,
  getIngestionStatus,
  startIngestionScheduler,
  updateIngestionScheduler,
  getIngestionSchedulerConfig
};
