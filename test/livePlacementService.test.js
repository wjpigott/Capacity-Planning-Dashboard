const test = require('node:test');
const assert = require('node:assert/strict');

const { __testHooks } = require('../src/services/livePlacementService');

test('normalizeRecommendationContract normalizes target and recommendation SKU names', () => {
  const contract = __testHooks.normalizeRecommendationContract({
    target: { name: 'standardd2sv5' },
    recommendations: [
      { sku: 'standardd4sv5' },
      { sku: 'Basic_A1' }
    ],
    belowMinSpec: [
      { sku: 'standarde2sv5' }
    ]
  });

  assert.equal(contract.target.name, 'Standard_D2sv5');
  assert.deepEqual(
    contract.recommendations.map((entry) => entry.sku),
    ['Standard_D4sv5', 'Basic_A1']
  );
  assert.deepEqual(
    contract.belowMinSpec.map((entry) => entry.sku),
    ['Standard_E2sv5']
  );
});

test('parseExtraSkus normalizes and deduplicates requested SKUs', () => {
  const parsed = __testHooks.parseExtraSkus([
    'standardd2sv5',
    'Standard_D2sv5',
    ' basic_a1 '
  ]);

  assert.deepEqual(parsed, ['Standard_D2sv5', 'Basic_A1']);
});

test('getRestrictionDetails classifies zonal availability states', () => {
  const details = __testHooks.getRestrictionDetails({
    locationInfo: [{ location: 'eastus', zones: ['1', '2', '3'] }],
    restrictions: [
      {
        type: 'Zone',
        reasonCode: 'NotAvailableForSubscription',
        restrictionInfo: { zones: ['2'] }
      },
      {
        type: 'Zone',
        reasonCode: 'SkuNotAvailable',
        restrictionInfo: { zones: ['3'] }
      }
    ]
  }, 'eastus');

  assert.equal(details.Status, 'PARTIAL');
  assert.deepEqual(details.ZonesOK, ['1']);
  assert.deepEqual(details.ZonesLimited, ['2']);
  assert.deepEqual(details.ZonesRestricted, ['3']);
});

test('buildRecommendationSkuProfile extracts compatibility fields from ARM SKU data', () => {
  const profile = __testHooks.buildRecommendationSkuProfile({
    name: 'Standard_D4s_v5',
    capabilities: [
      { name: 'vCPUs', value: '4' },
      { name: 'MemoryGB', value: '16' },
      { name: 'HyperVGenerations', value: 'V2' },
      { name: 'CpuArchitectureType', value: 'x64' },
      { name: 'PremiumIO', value: 'True' },
      { name: 'MaxResourceVolumeMB', value: '16384' },
      { name: 'AcceleratedNetworkingEnabled', value: 'True' },
      { name: 'MaxDataDiskCount', value: '8' },
      { name: 'MaxNetworkInterfaces', value: '2' },
      { name: 'EphemeralOSDiskSupported', value: 'True' },
      { name: 'UltraSSDAvailable', value: 'True' },
      { name: 'UncachedDiskIOPS', value: '12800' },
      { name: 'UncachedDiskBytesPerSecond', value: '196608000' },
      { name: 'EncryptionAtHostSupported', value: 'True' }
    ]
  });

  assert.equal(profile.Name, 'Standard_D4s_v5');
  assert.equal(profile.Family, 'D');
  assert.equal(profile.FamilyVersion, 5);
  assert.equal(profile.vCPU, 4);
  assert.equal(profile.MemoryGB, 16);
  assert.equal(profile.PremiumIO, true);
  assert.equal(profile.AccelNet, true);
  assert.equal(profile.DiskCode, 'SC+T');
  assert.equal(profile.UncachedDiskIOPS, 12800);
});

test('testSkuCompatibility rejects incompatible burstable and undersized candidates', () => {
  const result = __testHooks.testSkuCompatibility(
    {
      Name: 'Standard_D4s_v5',
      Family: 'D',
      vCPU: 4,
      MemoryGB: 16,
      MaxNetworkInterfaces: 2,
      AccelNet: true,
      PremiumIO: true,
      DiskCode: 'NVMe',
      EphemeralOSDiskSupported: true,
      UltraSSDAvailable: true
    },
    {
      Name: 'Standard_B2s',
      Family: 'B',
      vCPU: 2,
      MemoryGB: 8,
      MaxNetworkInterfaces: 1,
      AccelNet: false,
      PremiumIO: false,
      DiskCode: 'SCSI',
      EphemeralOSDiskSupported: false,
      UltraSSDAvailable: false
    }
  );

  assert.equal(result.Compatible, false);
  assert.ok(result.Failures.some((failure) => failure.includes('burstable')));
  assert.ok(result.Failures.some((failure) => failure.includes('candidate 2 < target 4')));
});

test('getSkuSimilarityScore rewards closer like-for-like candidates more highly', () => {
  const target = {
    Family: 'D',
    FamilyVersion: 5,
    vCPU: 4,
    MemoryGB: 16,
    Architecture: 'x64',
    PremiumIO: true,
    UncachedDiskIOPS: 12800,
    MaxDataDiskCount: 8
  };

  const closerCandidate = {
    Family: 'D',
    FamilyVersion: 6,
    vCPU: 4,
    MemoryGB: 16,
    Architecture: 'x64',
    PremiumIO: true,
    UncachedDiskIOPS: 16000,
    MaxDataDiskCount: 8
  };

  const fartherCandidate = {
    Family: 'E',
    FamilyVersion: 3,
    vCPU: 8,
    MemoryGB: 32,
    Architecture: 'x64',
    PremiumIO: true,
    UncachedDiskIOPS: 20000,
    MaxDataDiskCount: 16
  };

  assert.ok(__testHooks.getSkuSimilarityScore(target, closerCandidate) > __testHooks.getSkuSimilarityScore(target, fartherCandidate));
});