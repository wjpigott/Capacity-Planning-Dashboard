const { getQuotaCandidateSnapshots, listQuotaCandidateRuns } = require('../store/sql');

function getRecipientNeed(row) {
  const quotaAvailable = Number(row.quotaAvailable || 0);
  const safetyBuffer = Number(row.safetyBuffer || 0);
  const shortfall = Math.max(0, safetyBuffer - quotaAvailable);

  if (shortfall > 0) {
    return shortfall;
  }

  if ((row.availabilityState === 'CONSTRAINED' || row.availabilityState === 'LIMITED') && quotaAvailable <= 0) {
    return Math.max(1, Math.min(5, safetyBuffer || 1));
  }

  return 0;
}

function availabilityRank(value) {
  if (value === 'CONSTRAINED') {
    return 0;
  }

  if (value === 'LIMITED') {
    return 1;
  }

  return 2;
}

function parseSkuList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveSelectedSku(filters = {}, recipient = null, donor = null) {
  const requestedSku = String(filters.selectedSku || '').trim();
  const scopedSkus = parseSkuList(recipient?.skuList || donor?.skuList || '');

  if (requestedSku && scopedSkus.includes(requestedSku)) {
    return requestedSku;
  }

  return scopedSkus.length === 1 ? scopedSkus[0] : requestedSku;
}

function buildApplyMetadata(donor, transferAmount) {
  const donorQuotaCurrent = Number(donor?.quotaCurrent || 0);
  const donorQuotaLimit = Number(donor?.quotaLimit || 0);
  const safeTransferAmount = Math.max(0, Number(transferAmount || 0));

  return {
    donorQuotaCurrent,
    donorQuotaLimit,
    currentGroupLimit: donorQuotaLimit,
    proposedLimit: Math.max(0, donorQuotaLimit - safeTransferAmount),
    readyToApply: safeTransferAmount > 0,
    planStatus: safeTransferAmount > 0 ? 'Ready' : 'NoMovableQuota'
  };
}

function buildDonorScopedQuotaMovePlan(snapshotRows, filters = {}) {
  const donorSubscriptionId = String(filters.donorSubscriptionId || '').trim();
  const requestedRegion = String(filters.region || '').trim();
  const requestedQuotaName = String(filters.quotaName || filters.family || '').trim();

  if (!donorSubscriptionId) {
    throw new Error('donorSubscriptionId is required. Select a donor subscription before building a move plan.');
  }

  if (!requestedRegion || requestedRegion === 'all') {
    throw new Error('region is required for donor-scoped quota moves. Select a quota row from Quota Discovery first.');
  }

  if (!requestedQuotaName || requestedQuotaName === 'all') {
    throw new Error('family is required for donor-scoped quota moves. Select a quota row from Quota Discovery first.');
  }

  const donor = snapshotRows.find((row) => row.subscriptionId === donorSubscriptionId);
  if (!donor) {
    throw new Error(`The selected donor subscription '${donorSubscriptionId}' was not found for the requested quota scope.`);
  }

  const donorMovable = Number(donor.suggestedMovable || 0);
  if (donorMovable <= 0) {
    throw new Error('The selected donor has no movable quota for the chosen region and quota family.');
  }

  const requestedTransferAmount = Number(filters.transferAmount || donorMovable);
  if (!Number.isFinite(requestedTransferAmount) || requestedTransferAmount <= 0) {
    throw new Error('transferAmount must be a positive number of cores to move.');
  }

  const selectedSku = resolveSelectedSku(filters, null, donor);
  const scopedSkuList = parseSkuList(donor.skuList || '');
  const transferAmount = Math.min(donorMovable, Math.round(requestedTransferAmount));

  return {
    sourceAnalysisRunId: donor.analysisRunId,
    sourceCapturedAtUtc: donor.capturedAtUtc,
    managementGroupId: donor.managementGroupId,
    groupQuotaName: donor.groupQuotaName,
    donorSubscriptionId: donor.subscriptionId,
    donorSubscriptionName: donor.subscriptionName,
    recipientSubscriptionId: null,
    recipientSubscriptionName: 'Group Quota Pool',
    requestedSku: selectedSku,
    requestedTransferAmount,
    planRowCount: transferAmount > 0 ? 1 : 0,
    totalPlannedQuota: transferAmount,
    unresolvedRecipientCount: 0,
    planRows: transferAmount > 0 ? [{
      sourceAnalysisRunId: donor.analysisRunId,
      sourceCapturedAtUtc: donor.capturedAtUtc,
      managementGroupId: donor.managementGroupId,
      groupQuotaName: donor.groupQuotaName,
      region: donor.region,
      quotaName: donor.quotaName,
      selectedSku,
      skuList: scopedSkuList.join(', '),
      skuCount: scopedSkuList.length,
      donorSubscriptionId: donor.subscriptionId,
      donorSubscriptionName: donor.subscriptionName,
      recipientSubscriptionId: null,
      recipientSubscriptionName: 'Group Quota Pool',
      transferAmount,
      donorAvailableBefore: donor.quotaAvailable,
      donorRemainingMovable: Math.max(0, donorMovable - transferAmount),
      ...buildApplyMetadata(donor, transferAmount),
      recipientAvailableBefore: 0,
      recipientNeededQuota: transferAmount,
      recipientRemainingNeed: 0,
      recipientAvailabilityState: 'GROUP_QUOTA'
    }] : []
  };
}

function buildScopedQuotaMovePlan(snapshotRows, filters = {}) {
  const donorSubscriptionId = String(filters.donorSubscriptionId || '').trim();
  const recipientSubscriptionId = String(filters.recipientSubscriptionId || '').trim();
  const requestedRegion = String(filters.region || '').trim();
  const requestedQuotaName = String(filters.quotaName || filters.family || '').trim();

  if (!recipientSubscriptionId) {
    throw new Error('recipientSubscriptionId is required for targeted quota moves. Select a recipient candidate from Quota Discovery first.');
  }

  if (!requestedRegion || requestedRegion === 'all') {
    throw new Error('region is required for targeted quota moves. Select a recipient candidate from Quota Discovery first.');
  }

  if (!requestedQuotaName || requestedQuotaName === 'all') {
    throw new Error('family is required for targeted quota moves. Select a recipient candidate from Quota Discovery first.');
  }

  const donor = snapshotRows.find((row) => row.subscriptionId === donorSubscriptionId);
  if (!donor) {
    throw new Error(`The selected donor subscription '${donorSubscriptionId}' was not found for the requested recipient scope.`);
  }

  const recipient = snapshotRows.find((row) => row.subscriptionId === recipientSubscriptionId);
  if (!recipient) {
    throw new Error(`The selected recipient subscription '${recipientSubscriptionId}' was not found for the requested scope.`);
  }

  if (donor.subscriptionId === recipient.subscriptionId) {
    throw new Error('The donor and recipient subscriptions must be different.');
  }

  const donorMovable = Number(donor.suggestedMovable || 0);
  if (donorMovable <= 0) {
    throw new Error('The selected donor has no movable quota for the chosen region and quota family.');
  }

  const recipientNeed = getRecipientNeed(recipient);
  if (recipientNeed <= 0) {
    throw new Error('The selected recipient does not currently need additional quota in this scope.');
  }

  const requestedTransferAmount = Number(filters.transferAmount || recipientNeed);
  if (!Number.isFinite(requestedTransferAmount) || requestedTransferAmount <= 0) {
    throw new Error('transferAmount must be a positive number of cores to move.');
  }

  const selectedSku = resolveSelectedSku(filters, recipient, donor);
  const scopedSkuList = parseSkuList(recipient.skuList || donor.skuList || '');
  const transferAmount = Math.min(donorMovable, Math.round(requestedTransferAmount));
  const remainingNeed = Math.max(0, recipientNeed - transferAmount);

  return {
    sourceAnalysisRunId: recipient.analysisRunId,
    sourceCapturedAtUtc: recipient.capturedAtUtc,
    managementGroupId: recipient.managementGroupId,
    groupQuotaName: recipient.groupQuotaName,
    donorSubscriptionId: donor.subscriptionId,
    donorSubscriptionName: donor.subscriptionName,
    recipientSubscriptionId: recipient.subscriptionId,
    recipientSubscriptionName: recipient.subscriptionName,
    requestedSku: selectedSku,
    requestedTransferAmount,
    planRowCount: transferAmount > 0 ? 1 : 0,
    totalPlannedQuota: transferAmount,
    unresolvedRecipientCount: remainingNeed > 0 ? 1 : 0,
    planRows: transferAmount > 0 ? [{
      sourceAnalysisRunId: recipient.analysisRunId,
      sourceCapturedAtUtc: recipient.capturedAtUtc,
      managementGroupId: recipient.managementGroupId,
      groupQuotaName: recipient.groupQuotaName,
      region: recipient.region,
      quotaName: recipient.quotaName,
      selectedSku,
      skuList: scopedSkuList.join(', '),
      skuCount: scopedSkuList.length,
      donorSubscriptionId: donor.subscriptionId,
      donorSubscriptionName: donor.subscriptionName,
      recipientSubscriptionId: recipient.subscriptionId,
      recipientSubscriptionName: recipient.subscriptionName,
      transferAmount,
      donorAvailableBefore: donor.quotaAvailable,
      donorRemainingMovable: Math.max(0, donorMovable - transferAmount),
      ...buildApplyMetadata(donor, transferAmount),
      recipientAvailableBefore: recipient.quotaAvailable,
      recipientNeededQuota: recipientNeed,
      recipientRemainingNeed: remainingNeed,
      recipientAvailabilityState: recipient.availabilityState
    }] : []
  };
}

async function buildQuotaMovePlan(filters = {}) {
  const snapshotRows = await getQuotaCandidateSnapshots(filters);
  if (!snapshotRows.length) {
    throw new Error('No captured candidate snapshots found for the selected scope. Run Capture History first.');
  }

  if (filters.recipientSubscriptionId) {
    return buildScopedQuotaMovePlan(snapshotRows, filters);
  }

  if (filters.donorSubscriptionId && filters.transferAmount && filters.region && filters.family) {
    return buildDonorScopedQuotaMovePlan(snapshotRows, filters);
  }

  const donorSubscriptionId = String(filters.donorSubscriptionId || '').trim();
  if (!donorSubscriptionId) {
    throw new Error('donorSubscriptionId is required. Select a donor subscription before building a move plan.');
  }

  const sourceAnalysisRunId = snapshotRows[0].analysisRunId;
  const sourceCapturedAtUtc = snapshotRows[0].capturedAtUtc;
  const grouped = new Map();

  const donorSubscription = snapshotRows.find((row) => row.subscriptionId === donorSubscriptionId);
  if (!donorSubscription) {
    throw new Error(`The selected donor subscription '${donorSubscriptionId}' was not found in the captured run.`);
  }

  for (const row of snapshotRows) {
    const key = [row.region, row.quotaName].join('|');
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push({ ...row });
  }

  const planRows = [];
  let totalPlannedQuota = 0;
  let unresolvedRecipientCount = 0;

  for (const entries of grouped.values()) {
    const donors = entries
      .filter((entry) => entry.subscriptionId === donorSubscriptionId && Number(entry.suggestedMovable || 0) > 0)
      .map((entry) => ({
        ...entry,
        remainingMovable: Number(entry.suggestedMovable || 0)
      }))
      .sort((left, right) => right.remainingMovable - left.remainingMovable || left.subscriptionName.localeCompare(right.subscriptionName));

    const recipients = entries
      .map((entry) => ({
        ...entry,
        neededQuota: getRecipientNeed(entry)
      }))
      .filter((entry) => entry.neededQuota > 0)
      .sort((left, right) => {
        if (availabilityRank(left.availabilityState) !== availabilityRank(right.availabilityState)) {
          return availabilityRank(left.availabilityState) - availabilityRank(right.availabilityState);
        }

        return right.neededQuota - left.neededQuota;
      });

    for (const recipient of recipients) {
      let remainingNeed = recipient.neededQuota;

      for (const donor of donors) {
        if (remainingNeed <= 0) {
          break;
        }

        if (donor.subscriptionId === recipient.subscriptionId || donor.remainingMovable <= 0) {
          continue;
        }

        const plannedAmount = Math.min(donor.remainingMovable, remainingNeed);
        if (plannedAmount <= 0) {
          continue;
        }

        donor.remainingMovable -= plannedAmount;
        remainingNeed -= plannedAmount;
        totalPlannedQuota += plannedAmount;

        planRows.push({
          sourceAnalysisRunId,
          sourceCapturedAtUtc,
          managementGroupId: recipient.managementGroupId,
          groupQuotaName: recipient.groupQuotaName,
          region: recipient.region,
          quotaName: recipient.quotaName,
          skuList: recipient.skuList || donor.skuList || '',
          skuCount: Number(recipient.skuCount || donor.skuCount || 0),
          donorSubscriptionId: donor.subscriptionId,
          donorSubscriptionName: donor.subscriptionName,
          recipientSubscriptionId: recipient.subscriptionId,
          recipientSubscriptionName: recipient.subscriptionName,
          transferAmount: plannedAmount,
          donorAvailableBefore: donor.quotaAvailable,
          donorRemainingMovable: donor.remainingMovable,
          ...buildApplyMetadata(donor, plannedAmount),
          recipientAvailableBefore: recipient.quotaAvailable,
          recipientNeededQuota: recipient.neededQuota,
          recipientRemainingNeed: remainingNeed,
          recipientAvailabilityState: recipient.availabilityState
        });
      }

      if (remainingNeed > 0) {
        unresolvedRecipientCount += 1;
      }
    }
  }

  return {
    sourceAnalysisRunId,
    sourceCapturedAtUtc,
    managementGroupId: filters.managementGroupId,
    groupQuotaName: filters.groupQuotaName,
    donorSubscriptionId,
    donorSubscriptionName: donorSubscription.subscriptionName,
    planRowCount: planRows.length,
    totalPlannedQuota,
    unresolvedRecipientCount,
    planRows
  };
}

async function getQuotaCandidateRunHistory(filters = {}) {
  const runs = await listQuotaCandidateRuns(filters);
  return {
    managementGroupId: filters.managementGroupId,
    groupQuotaName: filters.groupQuotaName,
    runCount: runs.length,
    runs
  };
}

async function simulateQuotaMovePlan(filters = {}) {
  const plan = await buildQuotaMovePlan(filters);
  const snapshotRows = await getQuotaCandidateSnapshots({
    ...filters,
    analysisRunId: plan.sourceAnalysisRunId
  });

  const impactByKey = new Map();
  for (const row of snapshotRows) {
    const key = [row.subscriptionId, row.region, row.quotaName].join('|');
    impactByKey.set(key, {
      subscriptionId: row.subscriptionId,
      subscriptionName: row.subscriptionName,
      region: row.region,
      quotaName: row.quotaName,
      skuList: row.skuList || '',
      skuCount: Number(row.skuCount || 0),
      availabilityStateBefore: row.availabilityState,
      quotaAvailableBefore: Number(row.quotaAvailable || 0),
      quotaAvailableAfter: Number(row.quotaAvailable || 0),
      safetyBuffer: Number(row.safetyBuffer || 0),
      delta: 0
    });
  }

  for (const move of plan.planRows) {
    const donorKey = [move.donorSubscriptionId, move.region, move.quotaName].join('|');
    const recipientKey = [move.recipientSubscriptionId, move.region, move.quotaName].join('|');

    if (impactByKey.has(donorKey)) {
      const donor = impactByKey.get(donorKey);
      donor.quotaAvailableAfter -= Number(move.transferAmount || 0);
      donor.delta -= Number(move.transferAmount || 0);
    }

    if (impactByKey.has(recipientKey)) {
      const recipient = impactByKey.get(recipientKey);
      recipient.quotaAvailableAfter += Number(move.transferAmount || 0);
      recipient.delta += Number(move.transferAmount || 0);
    } else if (!move.recipientSubscriptionId) {
      impactByKey.set([`group-pool:${move.groupQuotaName}`, move.region, move.quotaName].join('|'), {
        subscriptionId: '',
        subscriptionName: `${move.groupQuotaName} (Group Quota Pool)`,
        region: move.region,
        quotaName: move.quotaName,
        skuList: move.skuList || '',
        skuCount: Number(move.skuCount || 0),
        availabilityStateBefore: 'GROUP_QUOTA',
        quotaAvailableBefore: 0,
        quotaAvailableAfter: Number(move.transferAmount || 0),
        safetyBuffer: 0,
        delta: Number(move.transferAmount || 0)
      });
    }
  }

  const impactRows = [...impactByKey.values()]
    .filter((row) => row.delta !== 0)
    .map((row) => {
      const gapBefore = Math.max(0, row.safetyBuffer - row.quotaAvailableBefore);
      const gapAfter = Math.max(0, row.safetyBuffer - row.quotaAvailableAfter);
      const role = row.delta > 0 ? 'Recipient' : 'Donor';
      let projectedState = 'Neutral';

      if (row.delta > 0 && gapAfter === 0) {
        projectedState = 'Covered';
      } else if (row.delta > 0 && gapAfter > 0) {
        projectedState = 'ResidualGap';
      } else if (row.delta < 0 && row.quotaAvailableAfter < row.safetyBuffer) {
        projectedState = 'BufferBreach';
      } else if (row.delta < 0) {
        projectedState = 'WithinBuffer';
      }

      return {
        ...row,
        role,
        gapBefore,
        gapAfter,
        projectedState
      };
    })
    .sort((left, right) => {
      if (left.region !== right.region) {
        return left.region.localeCompare(right.region);
      }

      if (left.quotaName !== right.quotaName) {
        return left.quotaName.localeCompare(right.quotaName);
      }

      return left.subscriptionName.localeCompare(right.subscriptionName);
    });

  const recipientResolvedCount = impactRows.filter((row) => row.role === 'Recipient' && row.gapAfter === 0).length;
  const atRiskDonorCount = impactRows.filter((row) => row.role === 'Donor' && row.projectedState === 'BufferBreach').length;

  return {
    ...plan,
    impactedRowCount: impactRows.length,
    recipientResolvedCount,
    atRiskDonorCount,
    impactRows
  };
}

module.exports = {
  buildQuotaMovePlan,
  getQuotaCandidateRunHistory,
  simulateQuotaMovePlan
};