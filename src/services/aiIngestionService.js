const sql = require('mssql');
const { getSqlPool } = require('../store/sql');

const ARM_BASE = 'https://management.azure.com';
const DEFAULT_MODEL_CATALOG_INTERVAL_MINUTES = 1440;

function normalizeBoolean(value, fallback = false) {
  if (value == null) {
    return Boolean(fallback);
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function normalizeIntervalMinutes(value, fallback = DEFAULT_MODEL_CATALOG_INTERVAL_MINUTES) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate)) {
    return Math.max(0, Math.min(Math.trunc(Number(fallback) || DEFAULT_MODEL_CATALOG_INTERVAL_MINUTES), 7 * 24 * 60));
  }

  return Math.max(0, Math.min(Math.trunc(candidate), 7 * 24 * 60));
}

function getDefaultAISettings() {
  return {
    openaiEnabled: normalizeBoolean(process.env.INGEST_OPENAI_ENABLED, false),
    modelCatalogEnabled: normalizeBoolean(process.env.INGEST_OPENAI_MODEL_CATALOG, true),
    modelCatalogIntervalMinutes: normalizeIntervalMinutes(
      process.env.INGEST_OPENAI_MODEL_CATALOG_INTERVAL_MINUTES,
      DEFAULT_MODEL_CATALOG_INTERVAL_MINUTES
    )
  };
}

async function sqlObjectExists(pool, objectName, objectTypes = ['U']) {
  const checks = objectTypes
    .map((objectType) => `OBJECT_ID(@objectName, '${String(objectType).replace(/'/g, "''")}') IS NOT NULL`)
    .join(' OR ');

  const result = await pool.request()
    .input('objectName', sql.NVarChar(256), objectName)
    .query(`
      SELECT CASE WHEN ${checks} THEN 1 ELSE 0 END AS existsFlag
    `);

  return Boolean(result.recordset?.[0]?.existsFlag);
}

function extractModelData(model) {
  return model?.properties || model?.model || model || {};
}

function normalizeCapabilities(rawCapabilities) {
  if (!rawCapabilities) {
    return null;
  }

  if (Array.isArray(rawCapabilities)) {
    const mapped = rawCapabilities.reduce((acc, entry) => {
      const key = String(entry?.name || entry?.key || '').trim();
      if (!key) {
        return acc;
      }

      acc[key] = entry?.value ?? true;
      return acc;
    }, {});

    return Object.keys(mapped).length > 0 ? mapped : null;
  }

  if (typeof rawCapabilities === 'object') {
    return rawCapabilities;
  }

  return null;
}

function getDeploymentTypes(modelData) {
  if (Array.isArray(modelData?.deploymentTypes) && modelData.deploymentTypes.length > 0) {
    return modelData.deploymentTypes.map((entry) => String(entry || '').trim()).filter(Boolean).join(', ');
  }

  if (Array.isArray(modelData?.skus) && modelData.skus.length > 0) {
    return modelData.skus
      .map((sku) => String(sku?.name || sku || '').trim())
      .filter(Boolean)
      .join(', ');
  }

  return null;
}

function getDeprecationDate(modelData, model) {
  const candidate = modelData?.deprecation?.inference
    || modelData?.deprecation?.fineTune
    || modelData?.deprecationDate
    || model?.deprecationDate
    || null;

  return candidate ? new Date(candidate) : null;
}

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

    const filtered = models.filter((model) => {
      const modelData = extractModelData(model);
      const kind = [
        model?.kind,
        modelData?.kind,
        modelData?.publisher,
        modelData?.provider
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return kind.includes('openai');
    });
    return filtered;
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
  const quotaCurrent = Number(usage?.currentValue || 0);
  const quotaLimit = Number(usage?.limit || 0);

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

  const parts = quotaName.split('.');
  const skuFamily = quotaName;
  const skuName = parts.length > 2 ? parts.slice(2).join('.') : quotaName;

  return {
    capturedAtUtc: context.capturedAtUtc,
    sourceType: 'live-azure-openai-ingest',
    subscriptionKey: context.subscriptionKey,
    subscriptionId: context.subscriptionId,
    subscriptionName: context.subscriptionName,
    region: context.region,
    skuName,
    skuFamily,
    vCpu: null,
    memoryGB: null,
    zonesCsv: null,
    availabilityState,
    quotaCurrent,
    quotaLimit,
    monthlyCostEstimate: null
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
  const modelData = extractModelData(model);
  const modelName = modelData?.name || model?.name || 'Unknown';
  const modelVersion = modelData?.version || model?.version || null;
  const skuName = modelData?.skuName || model?.skuName || null;
  const modelFormat = modelData?.format || model?.format || null;
  const deploymentTypes = getDeploymentTypes(modelData);
  const capabilities = normalizeCapabilities(modelData?.capabilities || model?.capabilities);
  const finetuneCapable = Boolean(
    capabilities?.finetuneCapable
      || capabilities?.fineTune
      || capabilities?.fineTunable
      || capabilities?.supportsFineTuning
  );
  const deprecationDate = getDeprecationDate(modelData, model);
  const isDefault = Boolean(modelData?.default || modelData?.isDefault);

  return {
    capturedAtUtc: context.capturedAtUtc,
    subscriptionId: context.subscriptionId,
    region: context.region,
    modelName,
    modelVersion,
    deploymentTypes: deploymentTypes || null,
    finetuneCapable,
    deprecationDate,
    skuName,
    modelFormat,
    isDefault,
    capabilities: capabilities ? JSON.stringify(capabilities) : null
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

  if (!(await sqlObjectExists(pool, 'dbo.AIModelAvailability', ['U']))) {
    throw new Error('AIModelAvailability table is not provisioned in SQL.');
  }

  const table = new sql.Table('dbo.AIModelAvailability');
  table.create = false;
  table.columns.add('capturedAtUtc', sql.DateTime2, { nullable: false });
  table.columns.add('subscriptionId', sql.NVarChar(64), { nullable: false });
  table.columns.add('region', sql.NVarChar(64), { nullable: false });
  table.columns.add('modelName', sql.NVarChar(128), { nullable: false });
  table.columns.add('modelVersion', sql.NVarChar(64), { nullable: true });
  table.columns.add('deploymentTypes', sql.NVarChar(512), { nullable: true });
  table.columns.add('finetuneCapable', sql.Bit, { nullable: false });
  table.columns.add('deprecationDate', sql.DateTime2, { nullable: true });
  table.columns.add('skuName', sql.NVarChar(128), { nullable: true });
  table.columns.add('modelFormat', sql.NVarChar(64), { nullable: true });
  table.columns.add('isDefault', sql.Bit, { nullable: false });
  table.columns.add('capabilities', sql.NVarChar(sql.MAX), { nullable: true });

  for (const row of rows) {
    table.rows.add(
      row.capturedAtUtc,
      row.subscriptionId,
      row.region,
      row.modelName,
      row.modelVersion,
      row.deploymentTypes,
      row.finetuneCapable,
      row.deprecationDate,
      row.skuName,
      row.modelFormat,
      row.isDefault,
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
  const defaults = getDefaultAISettings();
  const pool = await getSqlPool();
  if (!pool) {
    return defaults;
  }

  try {
    if (!(await sqlObjectExists(pool, 'dbo.DashboardSetting', ['U']))) {
      return defaults;
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
    for (const row of result.recordset || []) {
      settings[row.settingKey] = row.settingValue;
    }

    const dbModelCatalogEnabled = normalizeBoolean(settings['ingest.openai.modelCatalog.enabled'], true);

    return {
      openaiEnabled: defaults.openaiEnabled,
      modelCatalogEnabled: defaults.openaiEnabled && defaults.modelCatalogEnabled && dbModelCatalogEnabled,
      modelCatalogIntervalMinutes: normalizeIntervalMinutes(
        settings['schedule.aiModelCatalog.intervalMinutes'],
        defaults.modelCatalogIntervalMinutes
      )
    };
  } catch {
    return defaults;
  }
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

  try {
    if (!(await sqlObjectExists(pool, 'dbo.AIModelAvailability', ['U']))) {
      return null;
    }

    const result = await pool.request().query(`
      SELECT MAX(capturedAtUtc) AS lastRefresh
      FROM dbo.AIModelAvailability
    `);

    if (result.recordset.length > 0 && result.recordset[0].lastRefresh) {
      return new Date(result.recordset[0].lastRefresh);
    }
  } catch {
    return null;
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
  if (Number(intervalMinutes) <= 0) {
    return false;
  }

  const lastRefresh = await getLastModelCatalogRefresh();
  if (!lastRefresh) {
    return true;
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
