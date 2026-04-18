const crypto = require('crypto');
const { getCapacityRows } = require('./capacityService');
const { listQuotaGroups } = require('./quotaDiscoveryService');
const { insertQuotaCandidateSnapshots } = require('../store/sql');

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

  const capturedAtUtc = new Date();
  const analysisRunId = crypto.randomUUID();
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
        sourceCapturedAtUtc: row.capturedAtUtc || null,
        subscriptionKey: row.subscriptionKey || row.subscriptionId,
        quotaCurrent: 0,
        quotaLimit: 0,
        skuNames: new Set()
      });
    }

    const entry = grouped.get(key);
    entry.quotaCurrent += Number(row.quotaCurrent || 0);
    entry.quotaLimit += Number(row.quotaLimit || 0);
    const normalizedSku = normalizeSkuName(row.sku);
    if (normalizedSku) {
      entry.skuNames.add(normalizedSku);
    }
    if (row.capturedAtUtc && (!entry.sourceCapturedAtUtc || new Date(row.capturedAtUtc) > new Date(entry.sourceCapturedAtUtc))) {
      entry.sourceCapturedAtUtc = row.capturedAtUtc;
    }
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
        analysisRunId,
        capturedAtUtc: capturedAtUtc.toISOString(),
        skuList: [...entry.skuNames].sort(),
        skuCount: entry.skuNames.size,
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
    analysisRunId,
    capturedAtUtc: capturedAtUtc.toISOString(),
    managementGroupId,
    groupQuotaName,
    subscriptionCount: quotaGroup.subscriptionIds.length,
    candidateCount: candidates.filter((candidate) => candidate.suggestedMovable > 0).length,
    candidates
  };
}

async function captureQuotaCandidateSnapshots(filters = {}) {
  const result = await getQuotaCandidates(filters);
  const rows = result.candidates.map((candidate) => ({
    analysisRunId: result.analysisRunId,
    capturedAtUtc: result.capturedAtUtc,
    sourceCapturedAtUtc: candidate.sourceCapturedAtUtc,
    managementGroupId: candidate.managementGroupId,
    groupQuotaName: candidate.groupQuotaName,
    subscriptionId: candidate.subscriptionId,
    subscriptionName: candidate.subscriptionName,
    region: candidate.region,
    quotaName: candidate.family,
    skuList: Array.isArray(candidate.skuList) ? candidate.skuList.join(', ') : '',
    skuCount: Number(candidate.skuCount || 0),
    availabilityState: candidate.availability,
    quotaCurrent: candidate.quotaCurrent,
    quotaLimit: candidate.quotaLimit,
    quotaAvailable: candidate.quotaAvailable,
    suggestedMovable: candidate.suggestedMovable,
    safetyBuffer: candidate.safetyBuffer,
    subscriptionHash: candidate.subscriptionKey,
    candidateStatus: candidate.candidateStatus
  }));

  const insertedRows = await insertQuotaCandidateSnapshots(rows);
  return {
    ...result,
    insertedRows
  };
}

module.exports = {
  getQuotaCandidates,
  captureQuotaCandidateSnapshots
};