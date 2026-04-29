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