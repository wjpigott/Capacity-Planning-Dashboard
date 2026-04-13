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

async function buildQuotaMovePlan(filters = {}) {
  const snapshotRows = await getQuotaCandidateSnapshots(filters);
  if (!snapshotRows.length) {
    throw new Error('No captured candidate snapshots found for the selected scope. Run Capture History first.');
  }

  const sourceAnalysisRunId = snapshotRows[0].analysisRunId;
  const sourceCapturedAtUtc = snapshotRows[0].capturedAtUtc;
  const grouped = new Map();

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
      .filter((entry) => Number(entry.suggestedMovable || 0) > 0)
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
          donorSubscriptionId: donor.subscriptionId,
          donorSubscriptionName: donor.subscriptionName,
          recipientSubscriptionId: recipient.subscriptionId,
          recipientSubscriptionName: recipient.subscriptionName,
          transferAmount: plannedAmount,
          donorAvailableBefore: donor.quotaAvailable,
          donorRemainingMovable: donor.remainingMovable,
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