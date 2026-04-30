const test = require('node:test');
const assert = require('node:assert/strict');

const { __testHooks } = require('../src/services/quotaDiscoveryService');

test('getConfiguredManagementGroupFallbacks prefers QUOTA_MANAGEMENT_GROUP_ID and adds unique ingest management groups', () => {
  const originalQuotaManagementGroupId = process.env.QUOTA_MANAGEMENT_GROUP_ID;
  const originalIngestManagementGroupNames = process.env.INGEST_MANAGEMENT_GROUP_NAMES;

  process.env.QUOTA_MANAGEMENT_GROUP_ID = 'Demo-MG';
  process.env.INGEST_MANAGEMENT_GROUP_NAMES = 'Demo-MG, Child-MG , child-mg , Another-MG';

  try {
    assert.deepEqual(__testHooks.getConfiguredManagementGroupFallbacks(), [
      'Demo-MG',
      'Child-MG',
      'Another-MG'
    ]);
  } finally {
    process.env.QUOTA_MANAGEMENT_GROUP_ID = originalQuotaManagementGroupId;
    process.env.INGEST_MANAGEMENT_GROUP_NAMES = originalIngestManagementGroupNames;
  }
});

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
        shareableQuota: -15
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
    rawShareableQuota: -15,
    provisioningState: null
  });
});

test('filterShareableQuotaRows keeps only rows with reportable quota deficits and summarizes them', () => {
  const rows = __testHooks.filterShareableQuotaRows([
    {
      subscriptionId: 'sub-a',
      region: 'eastus',
      resourceName: 'family-a',
      displayName: 'Family A',
      shareableQuota: 0,
      quotaLimit: 20
    },
    {
      subscriptionId: 'sub-b',
      region: 'westus',
      resourceName: 'family-b',
      displayName: 'Family B',
      shareableQuota: 10,
      quotaLimit: 10
    },
    {
      subscriptionId: 'sub-c',
      region: 'westus2',
      resourceName: 'family-c',
      displayName: 'Family C',
      shareableQuota: 4,
      quotaLimit: 4
    },
    {
      subscriptionId: 'sub-d',
      region: 'centralus',
      resourceName: 'family-d',
      displayName: 'Family D',
      shareableQuota: 0,
      quotaLimit: 0
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
    totalShareableQuota: 14,
    totalAllocatedQuota: 14
  });
});

test('isIgnorableShareableQuotaLocationError treats missing location allocations as non-fatal', () => {
  assert.equal(__testHooks.isIgnorableShareableQuotaLocationError({ status: 404, body: 'NotFound' }), true);
  assert.equal(__testHooks.isIgnorableShareableQuotaLocationError({ status: 400, body: 'The location is not available for subscription 123.' }), true);
  assert.equal(__testHooks.isIgnorableShareableQuotaLocationError({ status: 400, body: 'eastusstg is an unsupported location' }), true);
  assert.equal(__testHooks.isIgnorableShareableQuotaLocationError({ status: 500, body: 'InternalServerError' }), false);
});

test('buildShareableQuotaRegionGroups collapses candidates to unique subscription-region fetch groups', () => {
  assert.deepEqual(__testHooks.buildShareableQuotaRegionGroups([
    { subscriptionId: 'sub-a', region: 'EastUS', family: 'standardDSv5Family' },
    { subscriptionId: 'sub-a', region: 'eastus', family: 'standardBSFamily' },
    { subscriptionId: 'sub-a', region: 'eastus', family: 'standardDSv5Family' },
    { subscriptionId: 'sub-b', region: 'westus', family: 'standardNCFamily' }
  ]), [
    {
      subscriptionId: 'sub-a',
      region: 'eastus',
      families: ['standardbsfamily', 'standarddsv5family']
    },
    {
      subscriptionId: 'sub-b',
      region: 'westus',
      families: ['standardncfamily']
    }
  ]);
});

test('buildSubscriptionLocationGroups expands subscription location maps into fetch groups', () => {
  const groups = __testHooks.buildSubscriptionLocationGroups(new Map([
    ['sub-a', [{ name: 'eastus' }, { name: 'westus' }]],
    ['sub-b', [{ name: 'centralus' }]]
  ]));

  assert.deepEqual(groups, [
    { subscriptionId: 'sub-a', region: 'eastus' },
    { subscriptionId: 'sub-a', region: 'westus' },
    { subscriptionId: 'sub-b', region: 'centralus' }
  ]);
});

test('indexQuotaAllocationEntries indexes positive-shareable quota entries by resource name', () => {
  const indexed = __testHooks.indexQuotaAllocationEntries([
    { properties: { resourceName: 'standarddsv5family', limit: 100, shareableQuota: 0 } },
    { properties: { resourceName: 'standarddsv5family', limit: 110, shareableQuota: -7 } },
    { properties: { name: { value: 'standardbsfamily' }, limit: 50, shareableQuota: -3 } }
  ]);

  assert.equal(indexed.get('standarddsv5family').properties.limit, 110);
  assert.equal(indexed.get('standardbsfamily').properties.limit, 50);
  assert.equal(indexed.has('missingfamily'), false);
});

test('filterShareableQuotaRows drops zero rows and keeps normalized deficit magnitudes', () => {
  const rows = __testHooks.filterShareableQuotaRows([
    { subscriptionId: 'sub-a', region: 'eastus', resourceName: 'standardunexpectedfamily', displayName: 'Unexpected Family', shareableQuota: 6, quotaLimit: 6 },
    { subscriptionId: 'sub-a', region: 'eastus', resourceName: 'standardallocatedfamily', displayName: 'Allocated Family', shareableQuota: 0, quotaLimit: 20 },
    { subscriptionId: 'sub-a', region: 'eastus', resourceName: 'standardzerofamily', displayName: 'Zero Family', shareableQuota: 0, quotaLimit: 0 }
  ]);

  assert.deepEqual(rows.map((row) => row.resourceName), ['standardunexpectedfamily']);
});

test('hasShareableQuotaDeficit only accepts strictly negative values', () => {
  assert.equal(__testHooks.hasShareableQuotaDeficit({ properties: { shareableQuota: 4 } }), false);
  assert.equal(__testHooks.hasShareableQuotaDeficit({ properties: { shareableQuota: 0 } }), false);
  assert.equal(__testHooks.hasShareableQuotaDeficit({ properties: { shareableQuota: -1 } }), true);
  assert.equal(__testHooks.hasShareableQuotaDeficit({ properties: { shareableQuota: null } }), false);
});

test('armGetNestedQuotaAllocations accepts top-level value payloads from Azure quota allocations', async () => {
  const originalFetch = global.fetch;
  const responses = [
    {
      ok: true,
      json: async () => ({
        value: [
          { properties: { resourceName: 'standardbsfamily', shareableQuota: 0, limit: 20 } }
        ],
        nextLink: 'https://example.test/page-2'
      })
    },
    {
      ok: true,
      json: async () => ({
        value: [
          { properties: { resourceName: 'standarddv2family', shareableQuota: 5, limit: 96 } }
        ]
      })
    }
  ];

  global.fetch = async () => responses.shift();

  try {
    const entries = await __testHooks.armGetNestedQuotaAllocations('https://example.test/page-1', 'token');
    assert.deepEqual(entries, [
      { properties: { resourceName: 'standardbsfamily', shareableQuota: 0, limit: 20 } },
      { properties: { resourceName: 'standarddv2family', shareableQuota: 5, limit: 96 } }
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});