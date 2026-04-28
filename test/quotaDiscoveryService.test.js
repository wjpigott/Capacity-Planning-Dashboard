const test = require('node:test');
const assert = require('node:assert/strict');

const { __testHooks } = require('../src/services/quotaDiscoveryService');

test('normalizeShareableQuotaRow maps a quota allocation entry into report shape', () => {
  const row = __testHooks.normalizeShareableQuotaRow({
    managementGroupId: 'demo-mg',
    groupQuotaName: 'groupquota1',
    subscriptionId: '00000000-0000-0000-0000-000000000000',
    region: 'WestUS',
    entry: {
      properties: {
        name: {
          localizedValue: 'standard DDv4 Family vCPUs',
          value: 'standardddv4family'
        },
        limit: 25,
        resourceName: 'standardddv4family',
        shareableQuota: 15
      }
    }
  });

  assert.deepEqual(row, {
    managementGroupId: 'demo-mg',
    groupQuotaName: 'groupquota1',
    subscriptionId: '00000000-0000-0000-0000-000000000000',
    region: 'westus',
    resourceProviderName: 'Microsoft.Compute',
    resourceName: 'standardddv4family',
    displayName: 'standard DDv4 Family vCPUs',
    quotaLimit: 25,
    shareableQuota: 15,
    provisioningState: null
  });
});

test('filterShareableQuotaRows keeps only rows with positive shareable quota and summarizes them', () => {
  const rows = __testHooks.filterShareableQuotaRows([
    {
      subscriptionId: 'sub-a',
      region: 'eastus',
      resourceName: 'family-a',
      displayName: 'Family A',
      shareableQuota: 0
    },
    {
      subscriptionId: 'sub-b',
      region: 'westus',
      resourceName: 'family-b',
      displayName: 'Family B',
      shareableQuota: 10
    },
    {
      subscriptionId: 'sub-c',
      region: 'westus2',
      resourceName: 'family-c',
      displayName: 'Family C',
      shareableQuota: 4
    }
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].resourceName, 'family-b');
  assert.equal(rows[1].resourceName, 'family-c');

  assert.deepEqual(__testHooks.summarizeShareableQuotaRows(rows), {
    rowCount: 2,
    subscriptionCount: 2,
    regionCount: 2,
    skuCount: 2,
    totalShareableQuota: 14
  });
});