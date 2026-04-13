const { execFile } = require('child_process');
const path = require('path');
const { getCapacityScoreSummary } = require('./capacityService');

const DEFAULT_MAX_SKUS_PER_CALL = 5;
const DEFAULT_MAX_REGIONS_PER_CALL = 8;

function resolvePlacementWrapperPath() {
  return process.env.CAPACITY_PLACEMENT_WRAPPER_PATH
    || path.resolve(__dirname, '..', '..', 'tools', 'Get-LivePlacementScores.ps1');
}

function resolvePlacementRepoRoot() {
  return process.env.GET_AZ_VM_AVAILABILITY_ROOT
    || path.resolve(__dirname, '..', '..', '..', 'Get-AzVMAvailability');
}

function getPowerShellCommand() {
  return process.env.CAPACITY_PWSH_PATH || 'pwsh';
}

function chunk(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

function runPlacementLookup({ skus, regions, desiredCount }) {
  const wrapperPath = resolvePlacementWrapperPath();
  const repoRoot = resolvePlacementRepoRoot();
  const pwsh = getPowerShellCommand();

  return new Promise((resolve, reject) => {
    execFile(
      pwsh,
      [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        wrapperPath,
        '-RepoRoot',
        repoRoot,
        '-SkuNamesJson',
        JSON.stringify(skus),
        '-RegionsJson',
        JSON.stringify(regions),
        '-DesiredCount',
        String(desiredCount)
      ],
      {
        cwd: path.resolve(__dirname, '..', '..'),
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim() || stdout?.trim() || error.message;
          reject(new Error(`Live placement lookup failed: ${detail}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdout || '[]');
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch (parseError) {
          reject(new Error(`Live placement lookup returned invalid JSON: ${parseError.message}`));
        }
      }
    );
  });
}

async function getLivePlacementScoreRows(filters = {}) {
  const currentRows = await getCapacityScoreSummary(filters);
  if (!Array.isArray(currentRows) || currentRows.length === 0) {
    return {
      rows: [],
      liveCheckedAtUtc: new Date().toISOString(),
      source: 'Get-AzVMAvailability:Get-PlacementScores',
      warning: null
    };
  }

  const desiredCount = Math.max(1, Math.min(Number(filters.desiredCount || 1), 1000));
  const uniqueSkus = [...new Set(currentRows.map((row) => row.sku).filter(Boolean))];
  const uniqueRegions = [...new Set(currentRows.map((row) => row.region).filter(Boolean))];
  const skuChunks = chunk(uniqueSkus, DEFAULT_MAX_SKUS_PER_CALL);
  const regionChunks = chunk(uniqueRegions, DEFAULT_MAX_REGIONS_PER_CALL);
  const liveCheckedAtUtc = new Date().toISOString();
  const liveMap = new Map();

  for (const skuChunk of skuChunks) {
    for (const regionChunk of regionChunks) {
      const results = await runPlacementLookup({
        skus: skuChunk,
        regions: regionChunk,
        desiredCount
      });

      for (const result of results) {
        liveMap.set(`${result.sku}|${String(result.region || '').toLowerCase()}`, result);
      }
    }
  }

  return {
    rows: currentRows.map((row) => {
      const live = liveMap.get(`${row.sku}|${String(row.region || '').toLowerCase()}`);
      return {
        ...row,
        livePlacementScore: live?.score || 'N/A',
        livePlacementAvailable: typeof live?.isAvailable === 'boolean' ? live.isAvailable : null,
        livePlacementRestricted: typeof live?.isRestricted === 'boolean' ? live.isRestricted : null,
        liveCheckedAtUtc
      };
    }),
    liveCheckedAtUtc,
    source: 'Get-AzVMAvailability:Get-PlacementScores',
    warning: null
  };
}

module.exports = {
  getLivePlacementScoreRows
};