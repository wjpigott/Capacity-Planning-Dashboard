const sql = require('mssql');
const { getSqlPool } = require('../store/sql');

const ARM_BASE = 'https://management.azure.com';
const DEFAULT_MODEL_CATALOG_INTERVAL_MINUTES = 1440;
const MODEL_CATALOG_API_VERSIONS = ['2024-10-01', '2023-05-01'];
const LEGACY_OPENAI_QUOTA_SOURCE_TYPE = 'live-azure-openai-ingest';
const PROVIDER_AI_QUOTA_SOURCE_TYPE_PREFIX = 'live-azure-ai-';

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

function getConfiguredValue(...values) {
  for (const value of values) {
    if (value == null) {
      continue;
    }

    if (typeof value === 'string' && value.trim() === '') {
      continue;
    }

    return value;
  }

  return undefined;
}

function getDefaultAISettings() {
  const aiEnabled = normalizeBoolean(
    getConfiguredValue(process.env.INGEST_AI_ENABLED, process.env.INGEST_OPENAI_ENABLED),
    false
  );
  const providerQuotaEnabled = normalizeBoolean(
    process.env.INGEST_AI_PROVIDER_QUOTA_ENABLED,
    false
  );

  return {
    aiEnabled,
    providerQuotaEnabled: aiEnabled && providerQuotaEnabled,
    modelCatalogEnabled: normalizeBoolean(
      getConfiguredValue(process.env.INGEST_AI_MODEL_CATALOG, process.env.INGEST_OPENAI_MODEL_CATALOG),
      true
    ),
    modelCatalogIntervalMinutes: normalizeIntervalMinutes(
      getConfiguredValue(
        process.env.INGEST_AI_MODEL_CATALOG_INTERVAL_MINUTES,
        process.env.INGEST_OPENAI_MODEL_CATALOG_INTERVAL_MINUTES
      ),
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
  const values = [];

  if (Array.isArray(modelData?.deploymentTypes) && modelData.deploymentTypes.length > 0) {
    values.push(...modelData.deploymentTypes.map((entry) => String(entry || '').trim()));
  }

  if (Array.isArray(modelData?.skus) && modelData.skus.length > 0) {
    values.push(...modelData.skus.map((sku) => String(sku?.name || sku || '').trim()));
  }

  const distinct = [...new Set(values.filter(Boolean))];
  return distinct.length > 0 ? distinct.join(', ') : null;
}

function getDeprecationDate(modelData, model) {
  const candidate = modelData?.deprecation?.inference
    || modelData?.deprecation?.fineTune
    || modelData?.deprecationDate
    || model?.deprecationDate
    || null;

  return candidate ? new Date(candidate) : null;
}

function normalizeProviderName(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return 'Unknown';
  }

  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases = {
    openai: 'OpenAI',
    azureopenai: 'OpenAI',
    anthropic: 'Anthropic',
    xai: 'xAI',
    meta: 'Meta',
    cohere: 'Cohere',
    mistral: 'Mistral AI',
    mistralai: 'Mistral AI',
    microsoft: 'Microsoft',
    deepseek: 'DeepSeek'
  };

  if (aliases[normalized]) {
    return aliases[normalized];
  }

  const prefixAliases = [
    ['anthropic', 'Anthropic'],
    ['claude', 'Anthropic'],
    ['xai', 'xAI'],
    ['grok', 'xAI'],
    ['meta', 'Meta'],
    ['llama', 'Meta'],
    ['cohere', 'Cohere'],
    ['mistral', 'Mistral AI'],
    ['deepseek', 'DeepSeek'],
    ['microsoft', 'Microsoft']
  ];

  const prefixMatch = prefixAliases.find(([prefix]) => normalized.startsWith(prefix));
  if (prefixMatch) {
    return prefixMatch[1];
  }

  if (raw === raw.toLowerCase()) {
    return raw.replace(/(^|[\s_-])([a-z])/g, (_, prefix, char) => `${prefix}${char.toUpperCase()}`);
  }

  return raw;
}

function normalizeUsageToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function slugifyProviderName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getAIQuotaSourceType(provider) {
  const normalizedProvider = normalizeProviderName(provider);
  if (normalizedProvider === 'OpenAI') {
    return LEGACY_OPENAI_QUOTA_SOURCE_TYPE;
  }

  const providerSlug = slugifyProviderName(normalizedProvider);
  return providerSlug
    ? `${PROVIDER_AI_QUOTA_SOURCE_TYPE_PREFIX}${providerSlug}-ingest`
    : null;
}

function isAIQuotaSourceType(sourceType) {
  const normalized = String(sourceType || '').trim().toLowerCase();
  return normalized === LEGACY_OPENAI_QUOTA_SOURCE_TYPE
    || /^live-azure-ai-[a-z0-9-]+-ingest$/.test(normalized);
}

function getAIUsageMetadata(usage) {
  const quotaName = String(usage?.name?.value || '').trim();
  if (!quotaName) {
    return { include: false, quotaName: '', quotaNameParts: [] };
  }

  const quotaNameParts = quotaName.split('.').map((part) => String(part || '').trim()).filter(Boolean);
  if (quotaNameParts.length === 0) {
    return { include: false, quotaName, quotaNameParts: [] };
  }

  const [firstPart, secondPart, thirdPart] = quotaNameParts;
  const firstToken = normalizeUsageToken(firstPart);

  if (firstToken.includes('openai')) {
    return {
      include: true,
      provider: 'OpenAI',
      quotaName,
      quotaNameParts,
      sourceType: LEGACY_OPENAI_QUOTA_SOURCE_TYPE,
      usageKind: secondPart || null,
      mappingSource: 'openai-name-prefix'
    };
  }

  if (firstToken === 'aiservices' && thirdPart) {
    const provider = normalizeProviderName(thirdPart);
    const sourceType = getAIQuotaSourceType(provider);
    if (!sourceType || provider === 'Unknown') {
      return { include: false, quotaName, quotaNameParts };
    }

    return {
      include: true,
      provider,
      quotaName,
      quotaNameParts,
      sourceType,
      usageKind: secondPart || null,
      mappingSource: 'aiservices-provider-suffix'
    };
  }

  return { include: false, quotaName, quotaNameParts };
}

function getAIQuotaProviderFromSnapshot(snapshot) {
  const sourceType = String(snapshot?.sourceType || '').trim();
  if (String(sourceType).toLowerCase() === LEGACY_OPENAI_QUOTA_SOURCE_TYPE) {
    return 'OpenAI';
  }

  const familyMetadata = getAIUsageMetadata({ name: { value: snapshot?.skuFamily } });
  if (familyMetadata.include && familyMetadata.provider && familyMetadata.provider !== 'Unknown') {
    return familyMetadata.provider;
  }

  const match = sourceType.match(/^live-azure-ai-(.+)-ingest$/i);
  if (!match) {
    return 'Unknown';
  }

  const slug = String(match[1] || '').trim();
  return slug
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ') || 'Unknown';
}

function countDelimitedValues(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .length;
}

function getCatalogRowScore(row) {
  return (countDelimitedValues(row?.deploymentTypes) * 100)
    + (row?.finetuneCapable ? 10 : 0)
    + (row?.isDefault ? 5 : 0)
    + (row?.skuName ? 1 : 0)
    + String(row?.capabilities || '').length;
}

function dedupeAIModelAvailabilityRows(rows) {
  const deduped = new Map();

  for (const row of rows || []) {
    if (!row) {
      continue;
    }

    const key = [
      String(row.region || '').trim().toLowerCase(),
      String(row.provider || 'Unknown').trim().toLowerCase(),
      String(row.modelName || '').trim().toLowerCase(),
      String(row.modelVersion || '').trim().toLowerCase()
    ].join('|');

    const existing = deduped.get(key);
    if (!existing || getCatalogRowScore(row) > getCatalogRowScore(existing)) {
      deduped.set(key, row);
    }
  }

  return [...deduped.values()];
}

function isTruthyCapability(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/**
 * Fetch Azure AI quota usage for a subscription/region.
 * Defaults to OpenAI-only rows unless provider-aware quota is explicitly enabled.
 *
 * @param {Function} armGetAll - Function to call ARM API with pagination
 * @param {string} token - ARM API access token
 * @param {string} subscriptionId - Azure subscription ID
 * @param {string} region - Azure region (e.g., 'eastus')
 * @returns {Promise<Array>} Array of quota usage items
 */
async function fetchAIUsages(armGetAll, token, subscriptionId, region, options = {}) {
  const usageUrl = `${ARM_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.CognitiveServices/locations/${region}/usages?api-version=2023-05-01`;
  const includeAllProviders = Boolean(options.includeAllProviders);

  try {
    const usages = await armGetAll(usageUrl, token);
    return usages.filter((item) => {
      const metadata = getAIUsageMetadata(item);
      if (!metadata.include) {
        return false;
      }

      return includeAllProviders || metadata.provider === 'OpenAI';
    });
  } catch (err) {
    console.warn(`Failed to fetch AI usages for ${region} in subscription ${subscriptionId}: ${err.message}`);
    return [];
  }
}

async function fetchOpenAIUsages(armGetAll, token, subscriptionId, region) {
  const usages = await fetchAIUsages(armGetAll, token, subscriptionId, region, { includeAllProviders: false });
  return usages.filter((item) => getAIUsageMetadata(item).provider === 'OpenAI');
}

/**
 * Fetch Azure AI model availability catalog for a subscription/region.
 * Returns provider-discovered model names, versions, deployment types, and capabilities.
 *
 * @param {Function} armGetAll - Function to call ARM API with pagination
 * @param {string} token - ARM API access token
 * @param {string} subscriptionId - Azure subscription ID
 * @param {string} region - Azure region
 * @returns {Promise<Array>} Array of model availability entries
 */
async function fetchAIModelAvailability(armGetAll, token, subscriptionId, region) {
  let lastError = null;

  for (let index = 0; index < MODEL_CATALOG_API_VERSIONS.length; index += 1) {
    const apiVersion = MODEL_CATALOG_API_VERSIONS[index];
    const modelsUrl = `${ARM_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.CognitiveServices/locations/${region}/models?api-version=${apiVersion}`;

    try {
      return await armGetAll(modelsUrl, token);
    } catch (err) {
      lastError = err;
      if (index < MODEL_CATALOG_API_VERSIONS.length - 1) {
        console.warn(
          `Failed to fetch AI model catalog for ${region} in subscription ${subscriptionId} with api-version ${apiVersion}; retrying with ${MODEL_CATALOG_API_VERSIONS[index + 1]}: ${err.message}`
        );
      }
    }
  }

  console.warn(`Failed to fetch AI model catalog for ${region} in subscription ${subscriptionId}: ${lastError?.message || 'Unknown error'}`);
  return [];
}

/**
 * Map OpenAI usage API response to CapacitySnapshot schema.
 *
 * @param {Object} usage - Raw usage item from ARM API
 * @param {Object} context - Context with subscription, region, timestamp
 * @returns {Object} CapacitySnapshot row
 */
function mapAIUsageToSnapshot(usage, context) {
  const metadata = getAIUsageMetadata(usage);
  if (!metadata.include) {
    return null;
  }

  const quotaName = metadata.quotaName || usage?.name?.value || 'Unknown';
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

  const parts = metadata.quotaNameParts.length > 0
    ? metadata.quotaNameParts
    : quotaName.split('.').map((part) => String(part || '').trim()).filter(Boolean);
  const skuFamily = quotaName;
  let skuName = quotaName;
  if (metadata.provider === 'OpenAI' && parts.length > 2) {
    skuName = parts.slice(2).join('.');
  } else if (parts.length > 3 && normalizeUsageToken(parts[0]) === 'aiservices') {
    skuName = parts.slice(3).join('.');
  } else if (parts.length > 2) {
    skuName = parts.slice(2).join('.');
  }

  return {
    capturedAtUtc: context.capturedAtUtc,
    sourceType: metadata.sourceType,
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

function mapOpenAIUsageToSnapshot(usage, context) {
  return mapAIUsageToSnapshot(usage, context);
}

/**
 * Map Azure AI model availability API response to AIModelAvailability table schema.
 *
 * @param {Object} model - Raw model item from ARM API
 * @param {Object} context - Context with subscription, region, timestamp
 * @returns {Object} AIModelAvailability row
 */
function mapAIModelToAvailability(model, context) {
  const modelData = extractModelData(model);
  const modelName = modelData?.name || model?.name || 'Unknown';
  const modelVersion = modelData?.version || model?.version || null;
  const skuName = modelData?.skuName || model?.skuName || null;
  const modelFormat = modelData?.format || model?.format || null;
  const provider = normalizeProviderName(
    modelData?.publisher
      || modelData?.provider
      || model?.kind
      || modelData?.kind
      || modelFormat
  );
  const deploymentTypes = getDeploymentTypes(modelData);
  const capabilities = normalizeCapabilities(modelData?.capabilities || model?.capabilities);
  const finetuneCapable = isTruthyCapability(
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
    provider,
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
  const dedupedRows = dedupeAIModelAvailabilityRows(rows);
  if (dedupedRows.length === 0) {
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
  table.columns.add('provider', sql.NVarChar(128), { nullable: false });
  table.columns.add('modelName', sql.NVarChar(128), { nullable: false });
  table.columns.add('modelVersion', sql.NVarChar(64), { nullable: true });
  table.columns.add('deploymentTypes', sql.NVarChar(512), { nullable: true });
  table.columns.add('finetuneCapable', sql.Bit, { nullable: false });
  table.columns.add('deprecationDate', sql.DateTime2, { nullable: true });
  table.columns.add('skuName', sql.NVarChar(128), { nullable: true });
  table.columns.add('modelFormat', sql.NVarChar(64), { nullable: true });
  table.columns.add('isDefault', sql.Bit, { nullable: false });
  table.columns.add('capabilities', sql.NVarChar(sql.MAX), { nullable: true });

  for (const row of dedupedRows) {
    table.rows.add(
      row.capturedAtUtc,
      row.subscriptionId,
      row.region,
      row.provider,
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
  return dedupedRows.length;
}

/**
 * Get AI-related dashboard settings.
 *
 * @returns {Promise<Object>} Settings object
 */
async function getAISettings() {
  const defaults = getDefaultAISettings();
  const envAiEnabled = defaults.aiEnabled;
  const envProviderQuotaEnabled = defaults.providerQuotaEnabled;
  const envModelCatalogEnabled = defaults.modelCatalogEnabled;
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
        'ingest.ai.enabled',
        'ingest.ai.providerQuota.enabled',
        'ingest.ai.modelCatalog.enabled',
        'ingest.openai.enabled',
        'ingest.openai.modelCatalog.enabled',
        'schedule.aiModelCatalog.intervalMinutes'
      )
    `);

    const settings = {};
    for (const row of result.recordset || []) {
      settings[row.settingKey] = row.settingValue;
    }

    const dbAiEnabled = normalizeBoolean(
      settings['ingest.ai.enabled'] ?? settings['ingest.openai.enabled'],
      false
    );
    const dbProviderQuotaEnabled = normalizeBoolean(
      settings['ingest.ai.providerQuota.enabled'],
      false
    );
    const dbModelCatalogEnabled = normalizeBoolean(
      settings['ingest.ai.modelCatalog.enabled'] ?? settings['ingest.openai.modelCatalog.enabled'],
      true
    );

    return {
      aiEnabled: envAiEnabled && dbAiEnabled,
      providerQuotaEnabled: envAiEnabled && dbAiEnabled && envProviderQuotaEnabled && dbProviderQuotaEnabled,
      modelCatalogEnabled: envAiEnabled && dbAiEnabled && envModelCatalogEnabled && dbModelCatalogEnabled,
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
  LEGACY_OPENAI_QUOTA_SOURCE_TYPE,
  getAIUsageMetadata,
  getAIQuotaSourceType,
  getAIQuotaProviderFromSnapshot,
  isAIQuotaSourceType,
  fetchAIUsages,
  fetchOpenAIUsages,
  fetchAIModelAvailability,
  mapAIUsageToSnapshot,
  mapOpenAIUsageToSnapshot,
  mapAIModelToAvailability,
  insertAIModelAvailability,
  getAISettings,
  shouldRefreshModelCatalog
};
