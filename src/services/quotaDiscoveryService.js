const { DefaultAzureCredential } = require('@azure/identity');

const ARM_SCOPE = 'https://management.azure.com/.default';
const ARM_BASE = 'https://management.azure.com';
const QUOTA_API_VERSION = '2025-09-01';
const MANAGEMENT_API_VERSION = '2023-04-01';
const SUBSCRIPTIONS_API_VERSION = '2022-12-01';
const COMPUTE_RESOURCE_PROVIDER = 'Microsoft.Compute';

function getCredential() {
  const managedIdentityClientId = process.env.INGEST_MSI_CLIENT_ID || process.env.AZURE_CLIENT_ID || process.env.SQL_MSI_CLIENT_ID;
  return new DefaultAzureCredential({ managedIdentityClientId });
}

function getManagementGroupId() {
  return process.env.QUOTA_MANAGEMENT_GROUP_ID || '';
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
      throw new Error(`ARM GET failed (${response.status}) for ${nextLink}: ${body}`);
    }

    const payload = await response.json();
    if (Array.isArray(payload.value)) {
      items.push(...payload.value);
    }

    nextLink = payload.nextLink || null;
  }

  return items;
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
      throw new Error(`ARM GET failed (${response.status}) for ${nextLink}: ${body}`);
    }

    const payload = await response.json();
    if (Array.isArray(payload?.properties?.value)) {
      items.push(...payload.properties.value);
    }

    nextLink = payload?.properties?.nextLink || payload?.nextLink || null;
  }

  return items;
}

function normalizeShareableQuotaRow({ managementGroupId, groupQuotaName, subscriptionId, region, entry, resourceProviderName = COMPUTE_RESOURCE_PROVIDER }) {
  const properties = entry?.properties || {};
  const limitValue = Number(properties.limit);
  const shareableQuotaValue = Number(properties.shareableQuota);
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
    shareableQuota: Number.isFinite(shareableQuotaValue) ? shareableQuotaValue : 0,
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
  });

  return {
    rowCount: rows.length,
    subscriptionCount: subscriptionIds.size,
    regionCount: regions.size,
    skuCount: resourceNames.size,
    totalShareableQuota
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
  const fallbackManagementGroupId = getManagementGroupId();

  try {
    const groups = await armGetAll(groupsUrl, token);
    const mappedGroups = groups.map((group) => ({
      id: group.name,
      displayName: group?.properties?.displayName || group.name,
      tenantId: group?.properties?.tenantId || null
    }));

    if (!mappedGroups.length && fallbackManagementGroupId) {
      return [{
        id: fallbackManagementGroupId,
        displayName: fallbackManagementGroupId,
        tenantId: null
      }];
    }

    return mappedGroups;
  } catch (error) {
    if (!fallbackManagementGroupId || !error.message.includes('AuthorizationFailed')) {
      throw error;
    }

    return [{
      id: fallbackManagementGroupId,
      displayName: fallbackManagementGroupId,
      tenantId: null
    }];
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

async function listQuotaGroupShareableQuota(managementGroupIdOverride, groupQuotaName) {
  const managementGroupId = managementGroupIdOverride || getManagementGroupId();
  if (!managementGroupId) {
    throw new Error('QUOTA_MANAGEMENT_GROUP_ID is not configured.');
  }

  if (!groupQuotaName || groupQuotaName === 'all') {
    throw new Error('groupQuotaName is required.');
  }

  const token = await getToken();
  const quotaGroupsResult = await listQuotaGroups(managementGroupId);
  const quotaGroup = quotaGroupsResult.groups.find((group) => group.groupQuotaName === groupQuotaName);
  if (!quotaGroup) {
    throw new Error(`Quota group '${groupQuotaName}' was not found in management group '${managementGroupId}'.`);
  }

  const locationCache = new Map();
  const rawRows = [];

  for (const subscriptionId of quotaGroup.subscriptionIds) {
    let locations = locationCache.get(subscriptionId);
    if (!locations) {
      locations = await listSubscriptionLocations(subscriptionId, token);
      locationCache.set(subscriptionId, locations);
    }

    for (const location of locations) {
      const allocationsUrl = `${ARM_BASE}/providers/Microsoft.Management/managementGroups/${encodeURIComponent(managementGroupId)}/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.Quota/groupQuotas/${encodeURIComponent(groupQuotaName)}/resourceProviders/${encodeURIComponent(COMPUTE_RESOURCE_PROVIDER)}/quotaAllocations/${encodeURIComponent(location.name)}?api-version=${QUOTA_API_VERSION}`;
      const allocations = await armGetNestedQuotaAllocations(allocationsUrl, token);
      allocations.forEach((entry) => {
        rawRows.push(normalizeShareableQuotaRow({
          managementGroupId,
          groupQuotaName,
          subscriptionId,
          region: location.name,
          entry
        }));
      });
    }
  }

  const rows = filterShareableQuotaRows(rawRows);

  return {
    managementGroupId,
    groupQuotaName,
    displayName: quotaGroup.displayName,
    groupType: quotaGroup.groupType,
    provisioningState: quotaGroup.provisioningState,
    generatedAtUtc: new Date().toISOString(),
    scannedSubscriptionCount: quotaGroup.subscriptionIds.length,
    summary: summarizeShareableQuotaRows(rows),
    rows
  };
}

module.exports = {
  listManagementGroups,
  listQuotaGroups,
  listQuotaGroupShareableQuota,
  __testHooks: {
    normalizeShareableQuotaRow,
    filterShareableQuotaRows,
    summarizeShareableQuotaRows
  }
};