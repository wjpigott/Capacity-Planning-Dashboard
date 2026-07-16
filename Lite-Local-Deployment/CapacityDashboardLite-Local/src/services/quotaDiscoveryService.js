const { DefaultAzureCredential } = require('@azure/identity');

const ARM_SCOPE = 'https://management.azure.com/.default';
const ARM_BASE = 'https://management.azure.com';
const QUOTA_API_VERSION = '2025-09-01';
const MANAGEMENT_API_VERSION = '2023-04-01';
const SUBSCRIPTIONS_API_VERSION = '2022-12-01';
const COMPUTE_RESOURCE_PROVIDER = 'Microsoft.Compute';
const SHAREABLE_REPORT_REGION_CONCURRENCY = 8;

function getCredential() {
  const managedIdentityClientId = process.env.INGEST_MSI_CLIENT_ID || process.env.AZURE_CLIENT_ID || process.env.SQL_MSI_CLIENT_ID;
  return new DefaultAzureCredential({ managedIdentityClientId });
}

function getManagementGroupId() {
  return process.env.QUOTA_MANAGEMENT_GROUP_ID || '';
}

function getConfiguredManagementGroupFallbacks() {
  const configured = [];
  const directId = String(process.env.QUOTA_MANAGEMENT_GROUP_ID || '').trim();
  const ingestNames = String(process.env.INGEST_MANAGEMENT_GROUP_NAMES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (directId) {
    configured.push(directId);
  }

  for (const name of ingestNames) {
    if (!configured.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      configured.push(name);
    }
  }

  return configured;
}

async function getToken() {
  const credential = getCredential();
  return (await credential.getToken(ARM_SCOPE)).token;
}

async function armGetAll(url, token) {
  const items = [];
  let nextLink = url;

  while (nextLink) {
    const response = await fetch(nextLink, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const body = await response.text();
      const error = new Error(`ARM GET failed (${response.status}) for ${nextLink}: ${body}`);
      error.status = response.status;
      error.body = body;
      error.url = nextLink;
      throw error;
    }

    const payload = await response.json();
    if (Array.isArray(payload.value)) {
      items.push(...payload.value);
    }

    nextLink = payload.nextLink || null;
  }

  return items;
}

async function armGetJson(url, token) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`ARM GET failed (${response.status}) for ${url}: ${body}`);
    error.status = response.status;
    error.body = body;
    error.url = url;
    throw error;
  }

  return response.json();
}

async function armGetNestedQuotaAllocations(url, token) {
  const items = [];
  let nextLink = url;

  while (nextLink) {
    const response = await fetch(nextLink, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const body = await response.text();
      const error = new Error(`ARM GET failed (${response.status}) for ${nextLink}: ${body}`);
      error.status = response.status;
      error.body = body;
      error.url = nextLink;
      throw error;
    }

    const payload = await response.json();
    const currentItems = Array.isArray(payload?.properties?.value)
      ? payload.properties.value
      : Array.isArray(payload?.value)
        ? payload.value
        : [];
    items.push(...currentItems);

    nextLink = payload?.properties?.nextLink || payload?.nextLink || null;
  }

  return items;
}

async function getQuotaGroupAllocationEntry(managementGroupId, groupQuotaName, subscriptionId, region, quotaName, token, resourceProviderName = COMPUTE_RESOURCE_PROVIDER) {
  const url = `${ARM_BASE}/providers/Microsoft.Management/managementGroups/${encodeURIComponent(managementGroupId)}/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.Quota/groupQuotas/${encodeURIComponent(groupQuotaName)}/resourceProviders/${encodeURIComponent(resourceProviderName)}/quotaAllocations/${encodeURIComponent(String(region || '').trim().toLowerCase())}?api-version=${QUOTA_API_VERSION}`;
  const entries = await armGetNestedQuotaAllocations(url, token);
  const normalizedQuotaName = String(quotaName || '').trim().toLowerCase();

  return entries.find((entry) => {
    const properties = entry?.properties || {};
    const resourceName = String(properties.resourceName || properties?.name?.value || entry?.name || '').trim().toLowerCase();
    return resourceName && resourceName === normalizedQuotaName;
  }) || null;
}

async function listQuotaGroupAllocationEntries(managementGroupId, groupQuotaName, subscriptionId, region, token, resourceProviderName = COMPUTE_RESOURCE_PROVIDER) {
  const url = `${ARM_BASE}/providers/Microsoft.Management/managementGroups/${encodeURIComponent(managementGroupId)}/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.Quota/groupQuotas/${encodeURIComponent(groupQuotaName)}/resourceProviders/${encodeURIComponent(resourceProviderName)}/quotaAllocations/${encodeURIComponent(String(region || '').trim().toLowerCase())}?api-version=${QUOTA_API_VERSION}`;
  return armGetNestedQuotaAllocations(url, token);
}

function buildShareableQuotaRegionGroups(candidates = []) {
  const groups = new Map();

  candidates.forEach((candidate) => {
    const subscriptionId = String(candidate?.subscriptionId || '').trim();
    const region = String(candidate?.region || '').trim().toLowerCase();
    const family = String(candidate?.family || '').trim().toLowerCase();
    if (!subscriptionId || !region || !family) {
      return;
    }

    const key = `${subscriptionId}|${region}`;
    if (!groups.has(key)) {
      groups.set(key, {
        subscriptionId,
        region,
        families: new Set()
      });
    }

    groups.get(key).families.add(family);
  });

  return [...groups.values()].map((group) => ({
    subscriptionId: group.subscriptionId,
    region: group.region,
    families: [...group.families].sort()
  }));
}

function buildSubscriptionLocationGroups(subscriptionLocations = new Map()) {
  const groups = [];

  for (const [subscriptionId, locations] of subscriptionLocations.entries()) {
    for (const location of locations || []) {
      const region = String(location?.name || '').trim().toLowerCase();
      if (!subscriptionId || !region) {
        continue;
      }

      groups.push({
        subscriptionId,
        region
      });
    }
  }

  return groups;
}

function hasShareableQuotaDeficit(entry) {
  const shareableQuota = Number(entry?.properties?.shareableQuota);
  return Number.isFinite(shareableQuota) && shareableQuota < 0;
}

function indexQuotaAllocationEntries(entries = []) {
  const indexed = new Map();

  entries.forEach((entry) => {
    const properties = entry?.properties || {};
    const resourceName = String(properties.resourceName || properties?.name?.value || entry?.name || '').trim().toLowerCase();
    if (!resourceName || !hasShareableQuotaDeficit(entry)) {
      return;
    }

    const existing = indexed.get(resourceName);
    const existingShareable = Math.abs(Number(existing?.properties?.shareableQuota || 0));
    const currentShareable = Math.abs(Number(properties.shareableQuota || 0));
    const existingLimit = Number(existing?.properties?.limit || 0);
    const currentLimit = Number(properties.limit || 0);
    if (!existing || currentShareable > existingShareable || (currentShareable === existingShareable && currentLimit > existingLimit)) {
      indexed.set(resourceName, entry);
    }
  });

  return indexed;
}

async function mapWithConcurrency(items, limit, mapper) {
  const concurrency = Math.max(1, Number(limit) || 1);
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function collectShareableQuotaRowsFromRegionGroups(regionGroups, { managementGroupId, groupQuotaName, token }) {
  const rawGroupRows = await mapWithConcurrency(regionGroups, SHAREABLE_REPORT_REGION_CONCURRENCY, async (group) => {
    try {
      const entries = await listQuotaGroupAllocationEntries(
        managementGroupId,
        groupQuotaName,
        group.subscriptionId,
        group.region,
        token
      );
      return entries
        .filter((entry) => hasShareableQuotaDeficit(entry))
        .map((entry) => normalizeShareableQuotaRow({
          managementGroupId,
          groupQuotaName,
          subscriptionId: group.subscriptionId,
          region: group.region,
          entry
        }));
    } catch (error) {
      if (isIgnorableShareableQuotaLocationError(error)) {
        return [];
      }
      throw error;
    }
  });

  return rawGroupRows.flat();
}

function isIgnorableShareableQuotaLocationError(error) {
  if (!error) {
    return false;
  }

  if (Number(error.status) === 404) {
    return true;
  }

  const detail = String(error.body || error.message || '').toLowerCase();
  return detail.includes('notfound')
    || detail.includes('was not found')
    || detail.includes('no registered resource provider found')
    || detail.includes('unsupported location')
    || detail.includes('not supported in location')
    || detail.includes('location is not available')
    || detail.includes('not available for subscription');
}

function normalizeShareableQuotaRow({ managementGroupId, groupQuotaName, subscriptionId, region, entry, resourceProviderName = COMPUTE_RESOURCE_PROVIDER }) {
  const properties = entry?.properties || {};
  const limitValue = Number(properties.limit);
  const rawShareableQuotaValue = Number(properties.shareableQuota);
  const localizedName = String(properties?.name?.localizedValue || '').trim();
  const resourceName = String(properties.resourceName || properties?.name?.value || entry?.name || '').trim();

  return {
    managementGroupId,
    groupQuotaName,
    subscriptionId,
    region: String(region || '').trim().toLowerCase(),
    resourceProviderName,
    resourceName,
    displayName: localizedName || resourceName,
    quotaLimit: Number.isFinite(limitValue) ? limitValue : null,
    shareableQuota: Number.isFinite(rawShareableQuotaValue) && rawShareableQuotaValue < 0 ? Math.abs(rawShareableQuotaValue) : 0,
    rawShareableQuota: Number.isFinite(rawShareableQuotaValue) ? rawShareableQuotaValue : 0,
    provisioningState: properties.provisioningState || null
  };
}

function filterShareableQuotaRows(rows = []) {
  return rows
    .filter((row) => row.resourceName && Number(row.shareableQuota || 0) > 0)
    .sort((left, right) => {
      const byShareable = Number(right.shareableQuota || 0) - Number(left.shareableQuota || 0);
      if (byShareable !== 0) {
        return byShareable;
      }

      const byLimit = Number(right.quotaLimit || 0) - Number(left.quotaLimit || 0);
      if (byLimit !== 0) {
        return byLimit;
      }

      return String(left.region || '').localeCompare(String(right.region || ''))
        || String(left.displayName || left.resourceName || '').localeCompare(String(right.displayName || right.resourceName || ''))
        || String(left.subscriptionId || '').localeCompare(String(right.subscriptionId || ''));
    });
}

function summarizeShareableQuotaRows(rows = []) {
  const subscriptionIds = new Set();
  const regions = new Set();
  const resourceNames = new Set();

  let totalShareableQuota = 0;
  let totalAllocatedQuota = 0;
  rows.forEach((row) => {
    if (row.subscriptionId) {
      subscriptionIds.add(row.subscriptionId);
    }
    if (row.region) {
      regions.add(row.region);
    }
    if (row.resourceName) {
      resourceNames.add(row.resourceName);
    }
    totalShareableQuota += Number(row.shareableQuota || 0);
    totalAllocatedQuota += Number(row.quotaLimit || 0);
  });

  return {
    rowCount: rows.length,
    subscriptionCount: subscriptionIds.size,
    regionCount: regions.size,
    skuCount: resourceNames.size,
    totalShareableQuota,
    totalAllocatedQuota
  };
}

async function listSubscriptionLocations(subscriptionId, token) {
  const url = `${ARM_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}/locations?api-version=${SUBSCRIPTIONS_API_VERSION}`;
  const locations = await armGetAll(url, token);
  return locations
    .map((location) => ({
      name: String(location?.name || '').trim().toLowerCase(),
      regionType: String(location?.metadata?.regionType || '').trim(),
      displayName: String(location?.displayName || location?.regionalDisplayName || location?.name || '').trim()
    }))
    .filter((location) => location.name && (!location.regionType || location.regionType === 'Physical'))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function listManagementGroups() {
  const token = await getToken();
  const groupsUrl = `${ARM_BASE}/providers/Microsoft.Management/managementGroups?api-version=${MANAGEMENT_API_VERSION}`;
  const fallbackManagementGroupIds = getConfiguredManagementGroupFallbacks();

  try {
    const groups = await armGetAll(groupsUrl, token);
    const mappedGroups = groups.map((group) => ({
      id: group.name,
      displayName: group?.properties?.displayName || group.name,
      tenantId: group?.properties?.tenantId || null
    }));

    for (const fallbackId of fallbackManagementGroupIds) {
      if (!mappedGroups.some((group) => group.id.toLowerCase() === fallbackId.toLowerCase())) {
        mappedGroups.push({
          id: fallbackId,
          displayName: fallbackId,
          tenantId: null
        });
      }
    }

    if (!mappedGroups.length && fallbackManagementGroupIds.length > 0) {
      return fallbackManagementGroupIds.map((fallbackId) => ({
        id: fallbackId,
        displayName: fallbackId,
        tenantId: null
      }));
    }

    return mappedGroups;
  } catch (error) {
    if (fallbackManagementGroupIds.length === 0) {
      throw error;
    }

    return fallbackManagementGroupIds.map((fallbackId) => ({
      id: fallbackId,
      displayName: fallbackId,
      tenantId: null
    }));
  }
}

async function listQuotaGroups(managementGroupIdOverride) {
  const managementGroupId = managementGroupIdOverride || getManagementGroupId();
  if (!managementGroupId) {
    throw new Error('QUOTA_MANAGEMENT_GROUP_ID is not configured.');
  }

  const token = await getToken();
  const groupsUrl = `${ARM_BASE}/providers/Microsoft.Management/managementGroups/${encodeURIComponent(managementGroupId)}/providers/Microsoft.Quota/groupQuotas?api-version=${QUOTA_API_VERSION}`;
  const groups = await armGetAll(groupsUrl, token);

  const enrichedGroups = await Promise.all(groups.map(async (group) => {
    const groupQuotaName = group.name;
    const subscriptionsUrl = `${ARM_BASE}/providers/Microsoft.Management/managementGroups/${encodeURIComponent(managementGroupId)}/providers/Microsoft.Quota/groupQuotas/${encodeURIComponent(groupQuotaName)}/subscriptions?api-version=${QUOTA_API_VERSION}`;
    const subscriptions = await armGetAll(subscriptionsUrl, token);
    const subscriptionIds = subscriptions
      .map((subscription) => subscription?.properties?.subscriptionId || subscription?.name)
      .filter(Boolean);

    return {
      managementGroupId,
      groupQuotaName,
      displayName: group?.properties?.displayName || groupQuotaName,
      groupType: group?.properties?.groupType || null,
      provisioningState: group?.properties?.provisioningState || null,
      subscriptionCount: subscriptionIds.length,
      subscriptionIds
    };
  }));

  return {
    managementGroupId,
    groups: enrichedGroups
  };
}

async function getQuotaGroup(managementGroupId, groupQuotaName, token) {
  const url = `${ARM_BASE}/providers/Microsoft.Management/managementGroups/${encodeURIComponent(managementGroupId)}/providers/Microsoft.Quota/groupQuotas/${encodeURIComponent(groupQuotaName)}?api-version=${QUOTA_API_VERSION}`;
  const group = await armGetJson(url, token);

  return {
    managementGroupId,
    groupQuotaName,
    displayName: group?.properties?.displayName || groupQuotaName,
    groupType: group?.properties?.groupType || null,
    provisioningState: group?.properties?.provisioningState || null
  };
}

async function listQuotaGroupSubscriptions(managementGroupId, groupQuotaName, token) {
  const url = `${ARM_BASE}/providers/Microsoft.Management/managementGroups/${encodeURIComponent(managementGroupId)}/providers/Microsoft.Quota/groupQuotas/${encodeURIComponent(groupQuotaName)}/subscriptions?api-version=${QUOTA_API_VERSION}`;
  const subscriptions = await armGetAll(url, token);

  return subscriptions
    .map((subscription) => subscription?.properties?.subscriptionId || subscription?.name)
    .filter(Boolean);
}

async function listQuotaGroupShareableQuota(managementGroupIdOverride, groupQuotaName) {
  const managementGroupId = managementGroupIdOverride || getManagementGroupId();
  if (!managementGroupId) {
    throw new Error('QUOTA_MANAGEMENT_GROUP_ID is not configured.');
  }

  if (!groupQuotaName || groupQuotaName === 'all') {
    throw new Error('groupQuotaName is required.');
  }

  const token = await getToken();
  const [quotaGroup, subscriptionIds] = await Promise.all([
    getQuotaGroup(managementGroupId, groupQuotaName, token),
    listQuotaGroupSubscriptions(managementGroupId, groupQuotaName, token)
  ]);

  const { getQuotaCandidates } = require('./quotaCandidateService');
  let candidateResult = { candidates: [] };
  try {
    candidateResult = await getQuotaCandidates({
      managementGroupId,
      groupQuotaName,
      region: 'all',
      family: 'all'
    });
  } catch {
    candidateResult = { candidates: [] };
  }

  const regionGroups = buildShareableQuotaRegionGroups(candidateResult.candidates);
  let rawRows = await collectShareableQuotaRowsFromRegionGroups(regionGroups, {
    managementGroupId,
    groupQuotaName,
    token
  });

  if (rawRows.length === 0 && subscriptionIds.length > 0) {
    const subscriptionLocations = new Map();
    await mapWithConcurrency(subscriptionIds, SHAREABLE_REPORT_REGION_CONCURRENCY, async (subscriptionId) => {
      try {
        const locations = await listSubscriptionLocations(subscriptionId, token);
        subscriptionLocations.set(subscriptionId, locations);
      } catch (error) {
        if (!isIgnorableShareableQuotaLocationError(error)) {
          throw error;
        }
      }
    });

    const fallbackRegionGroups = buildSubscriptionLocationGroups(subscriptionLocations);
    rawRows = await collectShareableQuotaRowsFromRegionGroups(fallbackRegionGroups, {
      managementGroupId,
      groupQuotaName,
      token
    });
  }

  const rows = filterShareableQuotaRows(rawRows);

  return {
    managementGroupId,
    groupQuotaName,
    displayName: quotaGroup.displayName,
    groupType: quotaGroup.groupType,
    provisioningState: quotaGroup.provisioningState,
    generatedAtUtc: new Date().toISOString(),
    scannedSubscriptionCount: subscriptionIds.length,
    summary: summarizeShareableQuotaRows(rows),
    rows
  };
}

module.exports = {
  listManagementGroups,
  listQuotaGroups,
  listQuotaGroupShareableQuota,
  __testHooks: {
    armGetNestedQuotaAllocations,
    getConfiguredManagementGroupFallbacks,
    normalizeShareableQuotaRow,
    filterShareableQuotaRows,
    summarizeShareableQuotaRows,
    isIgnorableShareableQuotaLocationError,
    buildShareableQuotaRegionGroups,
    buildSubscriptionLocationGroups,
    indexQuotaAllocationEntries,
    hasShareableQuotaDeficit
  }
};