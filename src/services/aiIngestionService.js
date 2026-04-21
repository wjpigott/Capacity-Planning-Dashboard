const { getSqlPool } = require('../store/sql');

const ARM_BASE = 'https://management.azure.com';

/**
 * Fetch Azure OpenAI quota usage for a subscription/region.
 * Maps to the same ARM pattern as Compute but for CognitiveServices provider.
 * 
 * @param {Function} armGetAll - Function to call ARM API with pagination
 * @param {string} token - ARM API access token
 * @param {string} subscriptionId - Azure subscription ID
 * @param {string} region - Azure region (e.g., 'eastus')
 * @returns {Promise<Array>} Array of quota usage items
 */
async function fetchOpenAIUsages(armGetAll, token, subscriptionId, region) {
  const usageUrl = `${ARM_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.CognitiveServices/locations/${region}/usages?api-version=2023-05-01`;
  
  try {
    const usages = await armGetAll(usageUrl, token);
    
    // Filter to OpenAI-specific usages
    // Format: "OpenAI.Standard.gpt-4o" or similar
    return usages.filter((item) => {
      const name = item?.name?.value || '';
      return name.toLowerCase().includes('openai');
    });
  } catch (err) {
    console.warn(`Failed to fetch OpenAI usages for ${region} in subscription ${subscriptionId}: ${err.message}`);
    return [];
  }
}

/**
 * Fetch Azure OpenAI model availability catalog for a subscription/region.
 * Returns model names, versions, deployment types, and capabilities.
 * 
 * @param {Function} armGetAll - Function to call ARM API with pagination
 * @param {string} token - ARM API access token
 * @param {string} subscriptionId - Azure subscription ID
 * @param {string} region - Azure region
 * @returns {Promise<Array>} Array of model availability entries
 */
async function fetchOpenAIModelAvailability(armGetAll, token, subscriptionId, region) {
  const modelsUrl = `${ARM_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.CognitiveServices/locations/${region}/models?api-version=2023-05-01`;
  
  try {
    const models = await armGetAll(modelsUrl, token);
    
    // Filter to OpenAI models only
    return models.filter((model) => {
      const kind = model?.kind || model?.model?.kind || '';
      return kind.toLowerCase().includes('openai');
    });
  } catch (err) {
    console.warn(`Failed to fetch OpenAI model catalog for ${region} in subscription ${subscriptionId}: ${err.message}`);
    return [];
  }
}

/**
 * Map OpenAI usage API response to CapacitySnapshot schema.
 * 
 * @param {Object} usage - Raw usage item from ARM API
 * @param {Object} context - Context with subscription, region, timestamp
 * @returns {Object} CapacitySnapshot row
 */
function mapOpenAIUsageToSnapshot(usage, context) {
  const quotaName = usage?.name?.value || 'Unknown';
  const localizedName = usage?.name?.localizedValue || quotaName;
  const quotaCurrent = Number(usage?.currentValue || 0);
  const quotaLimit = Number(usage?.limit || 0);
  const unit = usage?.unit || 'Count';
  
  // Determine availability state based on utilization
  let availabilityState = 'OK';
  const available = quotaLimit - quotaCurrent;
  if (available <= 0) {
    availabilityState = 'CONSTRAINED';
  } else {
    const utilization = quotaLimit > 0 ? quotaCurrent / quotaLimit : 0;
    if (utilization >= 0.9) {
      availabilityState = 'LIMITED';
    }
  }
  
  // Parse model name from quota name (e.g., "OpenAI.Standard.gpt-4o")
  const parts = quotaName.split('.');
  const skuFamily = quotaName; // Full name: "OpenAI.Standard.gpt-4o"
  const skuName = parts.length > 2 ? parts.slice(2).join('.') : quotaName; // Model name: "gpt-4o"
  
  return {
    capturedAtUtc: context.capturedAtUtc,
    sourceType: 'live-azure-openai-ingest',
    subscriptionKey: context.subscriptionKey,
    subscriptionId: context.subscriptionId,
    subscriptionName: context.subscriptionName,
    region: context.region,
    skuName,
    skuFamily,
    vCpu: null, // Not applicable to AI models
    memoryGB: null, // Not applicable to AI models
    zonesCsv: null, // Not applicable to AI models
    availabilityState,
    quotaCurrent,
    quotaLimit,
    monthlyCostEstimate: null // Pricing for AI is token-based, not monthly VM cost
  };
}

/**
 * Map OpenAI model availability API response to AIModelAvailability table schema.
 * 
 * @param {Object} model - Raw model item from ARM API
 * @param {Object} context - Context with subscription, region, timestamp
 * @returns {Object} AIModelAvailability row
 */
function mapOpenAIModelToAvailability(model, context) {
  const modelData = model?.model || model;
  const modelName = modelData?.name || model?.name || 'Unknown';
  const modelVersion = modelData?.version || model?.version || null;
  const skuName = modelData?.skuName || model?.skuName || null;
  const modelFormat = modelData?.format || model?.format || null;
  
  // Deployment types from model capabilities/skus
  const skus = modelData?.skus || [];
  const deploymentTypes = skus
    .map((sku) => sku?.name || '')
    .filter(Boolean)
    .join(', ');
  
  // Fine-tune capability
  const capabilities = modelData?.capabilities || {};
  const finetuneCapable = Boolean(capabilities?.finetuneCapable || capabilities?.fineTune);
  
  // Deprecation info
  const deprecationDate = modelData?.deprecation?.fineTune || modelData?.deprecation?.inference || null;
  
  // Is this the default version for the model?
  const isDefault = Boolean(modelData?.default || modelData?.isDefault);
  
  return {
    capturedAtUtc: context.capturedAtUtc,
    subscriptionId: context.subscriptionId,
    region: context.region,
    modelName,
    modelVersion,
    deploymentTypes: deploymentTypes || null,
    finetuneCapable,
    deprecationDate: deprecationDate ? new Date(deprecationDate) : null,
    skuName,
    modelFormat,
    isDefault,
    capabilities: Object.keys(capabilities).length > 0 ? JSON.stringify(capabilities) : null
  };
}

/**
 * Insert AI model availability rows into the database.
 * 
 * @param {Array} rows - Array of AIModelAvailability rows
 * @returns {Promise<number>} Number of rows inserted
 */
async function insertAIModelAvailability(rows) {
  if (!rows || rows.length === 0) {
    return 0;
  }
  
  const pool = await getSqlPool();
  if (!pool) {
    throw new Error('SQL pool not available');
  }
  
  const table = pool.request().table('dbo.AIModelAvailability');
  const columns = [
    'capturedAtUtc',
    'subscriptionId',
    'region',
    'modelName',
    'modelVersion',
    'deploymentTypes',
    'finetuneCapable',
    'deprecationDate',
    'skuName',
    'modelFormat',
    'isDefault',
    'capabilities'
  ];
  
  for (const row of rows) {
    table.row(
      row.capturedAtUtc,
      row.subscriptionId,
      row.region,
      row.modelName,
      row.modelVersion,
      row.deploymentTypes,
      row.finetuneCapable ? 1 : 0,
      row.deprecationDate,
      row.skuName,
      row.modelFormat,
      row.isDefault ? 1 : 0,
      row.capabilities
    );
  }
  
  await pool.request().bulk(table);
  return rows.length;
}

/**
 * Get AI-related dashboard settings.
 * 
 * @returns {Promise<Object>} Settings object
 */
async function getAISettings() {
  const pool = await getSqlPool();
  if (!pool) {
    return {
      openaiEnabled: false,
      modelCatalogEnabled: false,
      modelCatalogIntervalMinutes: 1440
    };
  }
  
  const result = await pool.request().query(`
    SELECT settingKey, settingValue
    FROM dbo.DashboardSetting
    WHERE settingKey IN (
      'ingest.openai.enabled',
      'ingest.openai.modelCatalog.enabled',
      'schedule.aiModelCatalog.intervalMinutes'
    )
  `);
  
  const settings = {};
  for (const row of result.recordset) {
    settings[row.settingKey] = row.settingValue;
  }
  
  return {
    openaiEnabled: (settings['ingest.openai.enabled'] || 'false').toLowerCase() === 'true',
    modelCatalogEnabled: (settings['ingest.openai.modelCatalog.enabled'] || 'true').toLowerCase() === 'true',
    modelCatalogIntervalMinutes: Number(settings['schedule.aiModelCatalog.intervalMinutes'] || 1440)
  };
}

/**
 * Get latest model catalog refresh timestamp.
 * 
 * @returns {Promise<Date|null>} Last refresh timestamp or null
 */
async function getLastModelCatalogRefresh() {
  const pool = await getSqlPool();
  if (!pool) {
    return null;
  }
  
  const result = await pool.request().query(`
    SELECT MAX(capturedAtUtc) AS lastRefresh
    FROM dbo.AIModelAvailability
  `);
  
  if (result.recordset.length > 0 && result.recordset[0].lastRefresh) {
    return new Date(result.recordset[0].lastRefresh);
  }
  
  return null;
}

/**
 * Check if model catalog should be refreshed based on configured interval.
 * 
 * @param {number} intervalMinutes - Refresh interval in minutes
 * @returns {Promise<boolean>} True if refresh is needed
 */
async function shouldRefreshModelCatalog(intervalMinutes) {
  const lastRefresh = await getLastModelCatalogRefresh();
  if (!lastRefresh) {
    return true; // Never refreshed, do it now
  }
  
  const elapsedMinutes = (Date.now() - lastRefresh.getTime()) / (1000 * 60);
  return elapsedMinutes >= intervalMinutes;
}

module.exports = {
  fetchOpenAIUsages,
  fetchOpenAIModelAvailability,
  mapOpenAIUsageToSnapshot,
  mapOpenAIModelToAvailability,
  insertAIModelAvailability,
  getAISettings,
  shouldRefreshModelCatalog
};
