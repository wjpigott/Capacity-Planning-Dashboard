const { DefaultAzureCredential } = require('@azure/identity');

const ARM_SCOPE = 'https://management.azure.com/.default';
const ARM_BASE = 'https://management.azure.com';
const QUOTA_API_VERSION = '2025-09-01';
const MANAGEMENT_API_VERSION = '2023-04-01';

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

module.exports = {
  listManagementGroups,
  listQuotaGroups
};