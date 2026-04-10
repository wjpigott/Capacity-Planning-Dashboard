const regionPresets = {
  USMajor: ['eastus', 'eastus2', 'centralus', 'westus', 'westus2']
};

function getRegionsForPreset(regionPreset) {
  if (!regionPreset || regionPreset === 'all' || regionPreset === 'custom') {
    return null;
  }

  return regionPresets[regionPreset] || null;
}

module.exports = { regionPresets, getRegionsForPreset };
