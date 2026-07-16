(function (global) {
  const FAMILY_SKUS = {
    standardhbv3family: ['Standard_HB120rs_v3'],
    standardhbv4family: ['Standard_HB176rs_v4'],
    standardndh100v5family: ['Standard_ND96isr_H100_v5'],
    standardncast4v3family: [
      'Standard_NC4as_T4_v3',
      'Standard_NC8as_T4_v3',
      'Standard_NC16as_T4_v3',
      'Standard_NC64as_T4_v3'
    ],
    standardnca100v4family: [
      'Standard_NC24ads_A100_v4',
      'Standard_NC48ads_A100_v4',
      'Standard_NC96ads_A100_v4'
    ],
    standardncadsh100v5family: [
      'Standard_NC40ads_H100_v5',
      'Standard_NC80adis_H100_v5'
    ],
    standardnccadsh100v5family: ['Standard_NCC40ads_H100_v5'],
    standarddsv5family: [
      'Standard_D2s_v5',
      'Standard_D4s_v5',
      'Standard_D8s_v5',
      'Standard_D16s_v5',
      'Standard_D32s_v5',
      'Standard_D48s_v5',
      'Standard_D64s_v5',
      'Standard_D96s_v5'
    ],
    standarddsv6family: [
      'Standard_D2s_v6',
      'Standard_D4s_v6',
      'Standard_D8s_v6',
      'Standard_D16s_v6',
      'Standard_D32s_v6',
      'Standard_D48s_v6',
      'Standard_D64s_v6',
      'Standard_D96s_v6',
      'Standard_D128s_v6',
      'Standard_D192s_v6'
    ]
  };

  const FAMILY_ALIASES = {
    standarddsv5: 'standarddsv5family',
    standarddsv6: 'standarddsv6family',
    standardhbv3: 'standardhbv3family',
    standardhbv4: 'standardhbv4family',
    standardndh100v5: 'standardndh100v5family',
    standardncast4v3: 'standardncast4v3family',
    standardncat4v3family: 'standardncast4v3family',
    standardnca100v4: 'standardnca100v4family',
    standardncadsa100v4family: 'standardnca100v4family',
    standardncadsa100v4: 'standardnca100v4family',
    standardncadsh100v5: 'standardncadsh100v5family',
    standardncadish100v5family: 'standardncadsh100v5family',
    standardnccadsh100v5: 'standardnccadsh100v5family'
  };

  function normalizeFamilyKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function resolveFamilyKey(value) {
    const normalized = normalizeFamilyKey(value);
    return FAMILY_SKUS[normalized] ? normalized : (FAMILY_ALIASES[normalized] || normalized);
  }

  function getSkusForFamily(value) {
    const resolved = resolveFamilyKey(value);
    return Array.isArray(FAMILY_SKUS[resolved]) ? [...FAMILY_SKUS[resolved]] : [];
  }

  global.CAPACITY_SKU_CATALOG = {
    familySkus: FAMILY_SKUS,
    getSkusForFamily,
    normalizeFamilyKey,
    resolveFamilyKey
  };
})(typeof window !== 'undefined' ? window : globalThis);