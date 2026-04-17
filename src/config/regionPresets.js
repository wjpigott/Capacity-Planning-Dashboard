const baseRegionPresets = {
  USEastWest: ['eastus', 'eastus2', 'westus', 'westus2'],
  USCentral: ['centralus', 'northcentralus', 'southcentralus', 'westcentralus'],
  USMajor: ['eastus', 'eastus2', 'centralus', 'westus', 'westus2'],
  Europe: ['westeurope', 'northeurope', 'uksouth', 'francecentral', 'germanywestcentral'],
  AsiaPacific: ['eastasia', 'southeastasia', 'japaneast', 'australiaeast', 'koreacentral'],
  USGov: ['usgovvirginia', 'usgovtexas', 'usgovarizona'],
  China: ['chinaeast', 'chinanorth', 'chinaeast2', 'chinanorth2'],
  'ASR-EastWest': ['eastus', 'westus2'],
  'ASR-CentralUS': ['centralus', 'eastus2'],
  // Backward-compatible presets used by existing dashboard flows.
  CommercialAmericas: ['eastus', 'eastus2', 'centralus', 'northcentralus', 'southcentralus', 'westcentralus', 'westus', 'westus2', 'westus3', 'canadacentral', 'canadaeast', 'brazilsouth'],
  CommercialEurope: ['northeurope', 'westeurope', 'uksouth', 'ukwest', 'francecentral', 'germanywestcentral', 'swedencentral', 'switzerlandnorth'],
  CommercialIndiaME: ['centralindia', 'southindia', 'westindia', 'uaenorth', 'uaecentral', 'qatarcentral', 'israelcentral'],
  CommercialAPAC: ['eastasia', 'southeastasia', 'japaneast', 'japanwest', 'koreacentral', 'koreasouth'],
  CommercialAustralia: ['australiaeast', 'australiasoutheast', 'australiacentral', 'australiacentral2'],
  AzureGovernment: ['usgovvirginia', 'usgovtexas', 'usgovarizona'],
  AzureChina: ['chinaeast', 'chinaeast2', 'chinanorth', 'chinanorth2']
};

const globalRegions = [...new Set(Object.values(baseRegionPresets)
  .flat()
  .map((region) => String(region || '').trim().toLowerCase())
  .filter(Boolean))].sort();

const regionPresets = {
  ...baseRegionPresets,
  Global: globalRegions
};

function getRegionsForPreset(regionPreset) {
  if (!regionPreset || regionPreset === 'all' || regionPreset === 'custom') {
    return null;
  }

  const presetKey = String(regionPreset).trim();
  if (regionPresets[presetKey]) {
    return regionPresets[presetKey];
  }

  const match = Object.keys(regionPresets).find((key) => key.toLowerCase() === presetKey.toLowerCase());
  return match ? regionPresets[match] : null;
}

module.exports = { regionPresets, getRegionsForPreset };
