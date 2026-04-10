const mockRows = [
  { region: 'eastus', sku: 'Standard_D4s_v5', family: 'standardDSv5Family', availability: 'OK', quotaCurrent: 22, quotaLimit: 100, monthlyCost: 280 },
  { region: 'eastus2', sku: 'Standard_E8s_v5', family: 'standardESv5Family', availability: 'LIMITED', quotaCurrent: 40, quotaLimit: 80, monthlyCost: 620 },
  { region: 'centralus', sku: 'Standard_D16s_v5', family: 'standardDSv5Family', availability: 'CONSTRAINED', quotaCurrent: 75, quotaLimit: 80, monthlyCost: 1240 },
  { region: 'westus2', sku: 'Standard_F8s_v2', family: 'standardFSv2Family', availability: 'OK', quotaCurrent: 18, quotaLimit: 120, monthlyCost: 510 },
  { region: 'centralus', sku: 'Standard_D4s_v4', family: 'standardDSv4Family', availability: 'OK', quotaCurrent: 12, quotaLimit: 120, monthlyCost: 260 }
];

module.exports = { mockRows };
