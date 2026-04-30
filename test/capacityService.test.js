const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveCapacityTrendRows, deriveCapacityScoreRows } = require('../src/services/capacityService');

test('deriveCapacityTrendRows calculates daily and rolling peak utilization percentages', () => {
  const rows = deriveCapacityTrendRows([
    {
      capturedAtUtc: '2026-04-21T08:00:00Z',
      region: 'eastus',
      sku: 'Standard_D2s_v5',
      family: 'StandardDSv5Family',
      availability: 'OK',
      quotaLimit: 10,
      quotaCurrent: 3,
      subscriptionId: 'sub-a'
    },
    {
      capturedAtUtc: '2026-04-21T20:00:00Z',
      region: 'eastus',
      sku: 'Standard_D2s_v5',
      family: 'StandardDSv5Family',
      availability: 'LIMITED',
      quotaLimit: 10,
      quotaCurrent: 8,
      subscriptionId: 'sub-a'
    },
    {
      capturedAtUtc: '2026-04-22T08:00:00Z',
      region: 'eastus',
      sku: 'Standard_D2s_v5',
      family: 'StandardDSv5Family',
      availability: 'CONSTRAINED',
      quotaLimit: 10,
      quotaCurrent: 9,
      subscriptionId: 'sub-a'
    }
  ]);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    day: '2026-04-21',
    totalRows: 2,
    constrainedRows: 0,
    totalQuotaAvailable: 9,
    peakUtilizationPct: 80,
    rolling7DayPeakUtilizationPct: 80,
    rolling14DayPeakUtilizationPct: 80
  });
  assert.deepEqual(rows[1], {
    day: '2026-04-22',
    totalRows: 1,
    constrainedRows: 1,
    totalQuotaAvailable: 1,
    peakUtilizationPct: 90,
    rolling7DayPeakUtilizationPct: 90,
    rolling14DayPeakUtilizationPct: 90
  });
});

test('deriveCapacityTrendRows supports hourly buckets', () => {
  const rows = deriveCapacityTrendRows([
    {
      capturedAtUtc: '2026-04-21T08:15:00Z',
      availability: 'OK',
      quotaLimit: 10,
      quotaCurrent: 3
    },
    {
      capturedAtUtc: '2026-04-21T08:45:00Z',
      availability: 'LIMITED',
      quotaLimit: 10,
      quotaCurrent: 8
    },
    {
      capturedAtUtc: '2026-04-21T09:10:00Z',
      availability: 'CONSTRAINED',
      quotaLimit: 10,
      quotaCurrent: 9
    }
  ], { granularity: 'hourly' });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    day: '2026-04-21T08:00:00Z',
    totalRows: 2,
    constrainedRows: 0,
    totalQuotaAvailable: 9,
    peakUtilizationPct: 80,
    rolling7DayPeakUtilizationPct: 80,
    rolling14DayPeakUtilizationPct: 80
  });
  assert.deepEqual(rows[1], {
    day: '2026-04-21T09:00:00Z',
    totalRows: 1,
    constrainedRows: 1,
    totalQuotaAvailable: 1,
    peakUtilizationPct: 90,
    rolling7DayPeakUtilizationPct: 90,
    rolling14DayPeakUtilizationPct: 90
  });
});

test('deriveCapacityScoreRows aggregates subscription rows into a High score entry', () => {
  const rows = deriveCapacityScoreRows([
    {
      region: 'eastus',
      sku: 'Standard_D2s_v5',
      family: 'StandardDSv5Family',
      availability: 'OK',
      quotaLimit: 10,
      quotaCurrent: 2,
      subscriptionId: 'sub-a',
      capturedAtUtc: '2026-04-27T10:00:00Z'
    },
    {
      region: 'eastus',
      skuName: 'Standard_D2s_v5',
      skuFamily: 'StandardDSv5Family',
      availabilityState: 'OK',
      quotaLimit: 8,
      quotaCurrent: 1,
      subscriptionId: 'sub-b',
      capturedAtUtc: '2026-04-27T12:00:00Z'
    }
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    region: 'eastus',
    sku: 'Standard_D2s_v5',
    family: 'StandardDSv5Family',
    subscriptionCount: 2,
    okRows: 2,
    limitedRows: 0,
    constrainedRows: 0,
    totalQuotaAvailable: 15,
    utilizationPct: 17,
    score: 'High',
    reason: 'All in-scope snapshot rows are OK with positive available quota.',
    latestCapturedAtUtc: '2026-04-27T12:00:00Z'
  });
});

test('deriveCapacityScoreRows marks constrained zero-headroom entries as Low', () => {
  const rows = deriveCapacityScoreRows([
    {
      region: 'westus',
      sku: 'Standard_F4s_v2',
      family: 'StandardFSv2Family',
      availability: 'CONSTRAINED',
      quotaLimit: 5,
      quotaCurrent: 5,
      subscriptionId: 'sub-a',
      capturedAtUtc: '2026-04-27T09:00:00Z'
    }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].score, 'Low');
  assert.equal(rows[0].reason, 'No positive quota headroom remains and constrained rows dominate the in-scope snapshot.');
  assert.equal(rows[0].totalQuotaAvailable, 0);
});