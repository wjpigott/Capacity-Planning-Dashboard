const { getCapacityRows } = require('./capacityService');
const { listQuotaGroups } = require('./quotaDiscoveryService');

function getSafetyBuffer(quotaLimit) {
  return Math.max(5, Math.round(Number(quotaLimit || 0) * 0.1));
}

function getCandidateStatus(suggestedMovable, availability) {
  if (suggestedMovable > 0) {
    return 'Ready';
  }

  if (availability === 'CONSTRAINED') {
    return 'Retain';
  }

  return 'InsufficientHeadroom';
}

async function getQuotaCandidates(filters = {}) {
  const managementGroupId = filters.managementGroupId;
  const groupQuotaName = filters.groupQuotaName;

  if (!managementGroupId) {
    throw new Error('managementGroupId is required.');
  }

  if (!groupQuotaName || groupQuotaName === 'all') {
    throw new Error('groupQuotaName is required.');
  }

  const quotaGroupsResult = await listQuotaGroups(managementGroupId);
  const quotaGroup = quotaGroupsResult.groups.find((group) => group.groupQuotaName === groupQuotaName);
  if (!quotaGroup) {
    throw new Error(`Quota group '${groupQuotaName}' was not found in management group '${managementGroupId}'.`);
  }

  const capacityRows = await getCapacityRows({
    regionPreset: filters.regionPreset || 'all',
    region: filters.region || 'all',
    family: filters.family || 'all',
    availability: 'all',
    subscriptionIds: quotaGroup.subscriptionIds.join(',')
  });

  const grouped = new Map();
  for (const row of capacityRows) {
    const key = [row.subscriptionId, row.subscriptionName, row.region, row.family].join('|');
    if (!grouped.has(key)) {
      grouped.set(key, {
        managementGroupId,
        groupQuotaName,
        subscriptionId: row.subscriptionId,
        subscriptionName: row.subscriptionName,
        region: row.region,
        family: row.family,
        availability: row.availability,
        quotaCurrent: 0,
        quotaLimit: 0
      });
    }

    const entry = grouped.get(key);
    entry.quotaCurrent += Number(row.quotaCurrent || 0);
    entry.quotaLimit += Number(row.quotaLimit || 0);
    if (row.availability === 'CONSTRAINED') {
      entry.availability = 'CONSTRAINED';
    } else if (row.availability === 'LIMITED' && entry.availability !== 'CONSTRAINED') {
      entry.availability = 'LIMITED';
    }
  }

  const candidates = [...grouped.values()]
    .map((entry) => {
      const quotaAvailable = entry.quotaLimit - entry.quotaCurrent;
      const safetyBuffer = getSafetyBuffer(entry.quotaLimit);
      const suggestedMovable = Math.max(0, quotaAvailable - safetyBuffer);

      return {
        ...entry,
        quotaAvailable,
        safetyBuffer,
        suggestedMovable,
        candidateStatus: getCandidateStatus(suggestedMovable, entry.availability)
      };
    })
    .sort((left, right) => {
      if (right.suggestedMovable !== left.suggestedMovable) {
        return right.suggestedMovable - left.suggestedMovable;
      }

      return left.subscriptionName.localeCompare(right.subscriptionName);
    });

  return {
    managementGroupId,
    groupQuotaName,
    subscriptionCount: quotaGroup.subscriptionIds.length,
    candidateCount: candidates.filter((candidate) => candidate.suggestedMovable > 0).length,
    candidates
  };
}

module.exports = {
  getQuotaCandidates
};