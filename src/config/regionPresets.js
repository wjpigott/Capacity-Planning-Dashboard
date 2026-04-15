const regionPresets = {
  USMajor: ['eastus', 'eastus2', 'centralus', 'northcentralus', 'southcentralus', 'westcentralus', 'westus', 'westus2', 'westus3'],
  CommercialAmericas: ['eastus', 'eastus2', 'centralus', 'northcentralus', 'southcentralus', 'westcentralus', 'westus', 'westus2', 'westus3', 'canadacentral', 'canadaeast', 'brazilsouth'],
  CommercialEurope: ['northeurope', 'westeurope', 'uksouth', 'ukwest', 'francecentral', 'germanywestcentral', 'swedencentral', 'switzerlandnorth'],
  CommercialIndiaME: ['centralindia', 'southindia', 'westindia', 'uaenorth', 'uaecentral', 'qatarcentral', 'israelcentral'],
  CommercialAPAC: ['eastasia', 'southeastasia', 'japaneast', 'japanwest', 'koreacentral', 'koreasouth'],
  CommercialAustralia: ['australiaeast', 'australiasoutheast', 'australiacentral', 'australiacentral2'],
  AzureGovernment: ['usgovvirginia', 'usgovtexas', 'usgovarizona'],
  AzureChina: ['chinaeast', 'chinaeast2', 'chinanorth', 'chinanorth2']
};

function getRegionsForPreset(regionPreset) {
  if (!regionPreset || regionPreset === 'all' || regionPreset === 'custom') {
    return null;
  }

  return regionPresets[regionPreset] || null;
}

module.exports = { regionPresets, getRegionsForPreset };
