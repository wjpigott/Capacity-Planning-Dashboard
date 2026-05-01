const { randomUUID } = require('crypto');
const sql = require('mssql');
const { normalizeFamilyName } = require('../lib/familyNormalization');

let cachedPool;

function buildSqlConfig({ accessToken } = {}) {
  const server = process.env.SQL_SERVER || process.env.Sql__Server;
  const database = process.env.SQL_DATABASE || process.env.Sql__Database;
  const authMode = (process.env.SQL_AUTH_MODE || process.env.Sql__AuthMode || '').toLowerCase();
  const msiClientId = process.env.SQL_MSI_CLIENT_ID || process.env.Sql__MsiClientId;
  const user = process.env.SQL_USER;
  const password = process.env.SQL_PASSWORD;

  if (!server || !database) {
    return null;
  }

  const useManagedIdentity = authMode === 'managed-identity' || authMode === 'msi';
  if (!accessToken && !useManagedIdentity && (!user || !password)) {
    return null;
  }

  const config = {
    server,
    database,
    requestTimeout: Number(process.env.SQL_REQUEST_TIMEOUT_MS) || 600000,
    connectionTimeout: 30000,
    options: {
      encrypt: true,
      trustServerCertificate: false
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    }
  };

  if (accessToken) {
    config.authentication = {
      type: 'azure-active-directory-access-token',
      options: { token: accessToken }
    };
  } else if (useManagedIdentity) {
    config.authentication = {
      type: 'azure-active-directory-msi-app-service',
      options: msiClientId ? { clientId: msiClientId } : {}
    };
  } else {
    config.user = user;
    config.password = password;
  }

  return config;
}

function normalizeSkuName(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }

  const normalizeSuffix = (suffix) => String(suffix || '')
    .split('_')
    .map((segment) => {
      const normalized = String(segment || '').trim().toLowerCase();
      if (!normalized) {
        return '';
      }
      if (/^v\d+$/.test(normalized)) {
        return normalized;
      }
      return normalized.replace(/^([a-z]+)/, (match) => match.toUpperCase());
    })
    .filter(Boolean)
    .join('_');

  const prefixedSku = trimmed.match(/^(standard|basic|internal)(?:[_\s-]?)(.*)$/i);
  if (prefixedSku) {
    const prefixToken = String(prefixedSku[1] || '').toLowerCase();
    const prefix = prefixToken === 'standard'
      ? 'Standard'
      : (prefixToken === 'basic' ? 'Basic' : 'Internal');
    const rawSuffix = String(prefixedSku[2] || '').replace(/^[_\s-]+/, '');
    const suffix = normalizeSuffix(rawSuffix);
    return suffix ? `${prefix}_${suffix}` : prefix;
  }

  return trimmed;
}

async function getSqlPool() {
  const config = buildSqlConfig();
  if (!config) {
    return null;
  }

  if (cachedPool) {
    return cachedPool;
  }

  cachedPool = await sql.connect(config);
  return cachedPool;
}

async function createSqlPoolWithAccessToken(accessToken) {
  const normalizedToken = String(accessToken || '').trim();
  if (!normalizedToken) {
    throw new Error('SQL access token is required.');
  }

  const config = buildSqlConfig({ accessToken: normalizedToken });
  if (!config) {
    throw new Error('SQL connection is not configured.');
  }

  const pool = new sql.ConnectionPool(config);
  await pool.connect();
  return pool;
}

async function tableExists(pool, tableName) {
  if (!pool || !tableName) {
    return false;
  }

  const request = pool.request();
  request.input('tableName', sql.NVarChar(256), String(tableName));
  const result = await request.query(`
    SELECT 1 AS hasTable
    WHERE OBJECT_ID(@tableName, 'U') IS NOT NULL
  `);

  return Boolean(result.recordset && result.recordset.length > 0);
}

function isSchemaPermissionError(err) {
  const message = String(err?.message || '').toLowerCase();
  return message.includes('create table permission denied')
    || message.includes('alter table permission denied')
    || message.includes('create index permission denied')
    || message.includes('permission denied in database');
}

async function insertCapacitySnapshots(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const pool = await getSqlPool();
  if (!pool) {
    throw new Error('SQL connection is not configured for ingestion.');
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    for (const row of rows) {
      const request = new sql.Request(transaction);
      const normalizedSkuName = normalizeSkuName(row.skuName);
      const normalizedFamilyName = normalizeFamilyName(row.skuFamily);
      request.input('capturedAtUtc', sql.DateTime2, row.capturedAtUtc || new Date());
      request.input('sourceType', sql.NVarChar(50), row.sourceType || 'live-azure-ingest');
      request.input('subscriptionKey', sql.NVarChar(64), row.subscriptionKey || 'legacy-data');
      request.input('subscriptionId', sql.NVarChar(64), row.subscriptionId || 'legacy-data');
      request.input('subscriptionName', sql.NVarChar(256), row.subscriptionName || 'Legacy data');
      request.input('region', sql.NVarChar(64), row.region);
      request.input('skuName', sql.NVarChar(128), normalizedSkuName);
      request.input('skuFamily', sql.NVarChar(128), normalizedFamilyName);
      request.input('vCpu', sql.Int, row.vCpu ?? null);
      request.input('memoryGB', sql.Decimal(10, 2), row.memoryGB ?? null);
      request.input('zonesCsv', sql.NVarChar(256), row.zonesCsv ?? null);
      request.input('availabilityState', sql.NVarChar(32), row.availabilityState);
      request.input('quotaCurrent', sql.Int, row.quotaCurrent);
      request.input('quotaLimit', sql.Int, row.quotaLimit);
      request.input('monthlyCostEstimate', sql.Decimal(18, 2), row.monthlyCostEstimate ?? null);

      await request.query(`
        INSERT INTO dbo.CapacitySnapshot
        (capturedAtUtc, sourceType, subscriptionKey, subscriptionId, subscriptionName, region, skuName, skuFamily, vCpu, memoryGB, zonesCsv, availabilityState, quotaCurrent, quotaLimit, monthlyCostEstimate)
        VALUES
        (@capturedAtUtc, @sourceType, @subscriptionKey, @subscriptionId, @subscriptionName, @region, @skuName, @skuFamily, @vCpu, @memoryGB, @zonesCsv, @availabilityState, @quotaCurrent, @quotaLimit, @monthlyCostEstimate)
      `);
    }

    await transaction.commit();

    // Upsert distinct subscriptions from this batch (best-effort; non-transactional)
    await upsertSubscriptions(rows).catch(() => {/* silently skip if table doesn't exist yet */});

    return rows.length;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function upsertSubscriptions(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const pool = await getSqlPool();
  if (!pool) {
    return 0;
  }

  // Collect distinct (subscriptionId, subscriptionName) pairs from the batch
  const seen = new Map();
  for (const row of rows) {
    const id = row.subscriptionId;
    const name = row.subscriptionName;
    if (id && id !== 'legacy-data' && !seen.has(id)) {
      seen.set(id, name || id);
    }
  }
  if (seen.size === 0) {
    return 0;
  }

  const now = new Date();
  let upserted = 0;

  for (const [subscriptionId, subscriptionName] of seen) {
    const request = pool.request();
    request.input('subscriptionId', sql.NVarChar(64), subscriptionId);
    request.input('subscriptionName', sql.NVarChar(256), subscriptionName);
    request.input('updatedAtUtc', sql.DateTime2, now);

    await request.query(`
      IF OBJECT_ID('dbo.Subscriptions', 'U') IS NOT NULL
      BEGIN
        MERGE dbo.Subscriptions AS tgt
        USING (SELECT @subscriptionId AS subscriptionId, @subscriptionName AS subscriptionName, @updatedAtUtc AS updatedAtUtc) AS src
        ON tgt.subscriptionId = src.subscriptionId
        WHEN MATCHED THEN
          UPDATE SET subscriptionName = src.subscriptionName, updatedAtUtc = src.updatedAtUtc
        WHEN NOT MATCHED THEN
          INSERT (subscriptionId, subscriptionName, updatedAtUtc) VALUES (src.subscriptionId, src.subscriptionName, src.updatedAtUtc);
      END
    `);

    upserted++;
  }

  return upserted;
}

async function getSubscriptionsFromTable({ search, limit } = {}) {
  const pool = await getSqlPool();
  if (!pool) {
    return [{ subscriptionId: 'legacy-data', subscriptionName: 'Legacy data' }];
  }

  // If the Subscriptions table doesn't exist yet (pre-migration), fall back to
  // deriving the list from CapacityLatest (the old behaviour).
  if (!(await tableExists(pool, 'dbo.Subscriptions'))) {
    return null; // caller falls back to CapacityLatest GROUP BY
  }

  const maxLimit = Math.max(10, Math.min(Number(limit || 500), 1000));
  const request = pool.request();
  request.input('limitRows', sql.Int, maxLimit);

  let query = `
    SELECT TOP (@limitRows)
      subscriptionId,
      subscriptionName
    FROM dbo.Subscriptions
    WHERE 1 = 1
  `;

  if (search && search.trim()) {
    request.input('search', sql.NVarChar(256), `%${search.trim()}%`);
    query += ` AND (subscriptionId LIKE @search OR subscriptionName LIKE @search)`;
  }

  query += ` ORDER BY subscriptionName ASC`;

  const result = await request.query(query);
  return (result.recordset || []).map((r) => ({
    subscriptionId: r.subscriptionId,
    subscriptionName: r.subscriptionName
  }));
}

async function ensureSubscriptionsTableSchema(pool) {
  const createScript = `
    IF OBJECT_ID('dbo.Subscriptions', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.Subscriptions (
        subscriptionId NVARCHAR(64) NOT NULL,
        subscriptionName NVARCHAR(256) NOT NULL,
        updatedAtUtc DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT PK_Subscriptions PRIMARY KEY (subscriptionId)
      );
    END;

    IF COL_LENGTH('dbo.Subscriptions', 'subscriptionName') IS NULL
      EXEC('ALTER TABLE dbo.Subscriptions ADD subscriptionName NVARCHAR(256) NOT NULL CONSTRAINT DF_Subscriptions_SubscriptionName DEFAULT (''Unknown subscription'')');

    IF COL_LENGTH('dbo.Subscriptions', 'updatedAtUtc') IS NULL
      EXEC('ALTER TABLE dbo.Subscriptions ADD updatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_Subscriptions_UpdatedAtUtc DEFAULT GETUTCDATE()');
  `;

  const backfillScript = `
    MERGE dbo.Subscriptions AS tgt
    USING (
      SELECT
        subscriptionId,
        MAX(subscriptionName) AS subscriptionName,
        MAX(capturedAtUtc) AS updatedAtUtc
      FROM dbo.CapacitySnapshot
      WHERE subscriptionId IS NOT NULL
        AND subscriptionId <> 'legacy-data'
      GROUP BY subscriptionId
    ) AS src
    ON tgt.subscriptionId = src.subscriptionId
    WHEN MATCHED THEN
      UPDATE SET subscriptionName = src.subscriptionName, updatedAtUtc = src.updatedAtUtc
    WHEN NOT MATCHED THEN
      INSERT (subscriptionId, subscriptionName, updatedAtUtc)
      VALUES (src.subscriptionId, src.subscriptionName, src.updatedAtUtc);
  `;

  await pool.request().query(createScript);
  await pool.request().query(backfillScript);
}

async function ensureCapacityScoreSnapshotSchema(pool) {
  const createScript = `
    IF OBJECT_ID('dbo.CapacityScoreSnapshot', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.CapacityScoreSnapshot (
        scoreSnapshotId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        capturedAtUtc DATETIME2 NOT NULL,
        region NVARCHAR(64) NOT NULL,
        skuName NVARCHAR(128) NOT NULL,
        skuFamily NVARCHAR(128) NOT NULL,
        subscriptionCount INT NOT NULL,
        okRows INT NOT NULL,
        limitedRows INT NOT NULL,
        constrainedRows INT NOT NULL,
        totalQuotaAvailable INT NOT NULL,
        utilizationPct INT NOT NULL,
        score NVARCHAR(16) NOT NULL,
        reason NVARCHAR(512) NOT NULL,
        latestSourceCapturedAtUtc DATETIME2 NULL
      )
    END;
  `;

  const createIndexScript = `
    IF NOT EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE name = 'IX_CapacityScoreSnapshot_CapturedRegionSku'
        AND object_id = OBJECT_ID('dbo.CapacityScoreSnapshot')
    )
    BEGIN
      CREATE INDEX IX_CapacityScoreSnapshot_CapturedRegionSku
        ON dbo.CapacityScoreSnapshot (capturedAtUtc DESC, region, skuName);
    END;
  `;

  await pool.request().query(createScript);
  await pool.request().query(createIndexScript);
}

async function insertCapacityScoreSnapshots(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const pool = await getSqlPool();
  if (!pool) {
    throw new Error('SQL connection is not configured for capacity score history.');
  }

  try {
    if (!(await tableExists(pool, 'dbo.CapacityScoreSnapshot'))) {
      return 0;
    }

    await ensureCapacityScoreSnapshotSchema(pool);
  } catch (err) {
    if (isSchemaPermissionError(err)) {
      return 0;
    }

    throw err;
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    for (const row of rows) {
      const request = new sql.Request(transaction);
      const normalizedSkuName = normalizeSkuName(row.sku);
      const normalizedFamilyName = normalizeFamilyName(row.family);
      request.input('capturedAtUtc', sql.DateTime2, row.capturedAtUtc || new Date());
      request.input('region', sql.NVarChar(64), row.region);
      request.input('skuName', sql.NVarChar(128), normalizedSkuName);
      request.input('skuFamily', sql.NVarChar(128), normalizedFamilyName);
      request.input('subscriptionCount', sql.Int, row.subscriptionCount ?? 0);
      request.input('okRows', sql.Int, row.okRows ?? 0);
      request.input('limitedRows', sql.Int, row.limitedRows ?? 0);
      request.input('constrainedRows', sql.Int, row.constrainedRows ?? 0);
      request.input('totalQuotaAvailable', sql.Int, row.totalQuotaAvailable ?? 0);
      request.input('utilizationPct', sql.Int, row.utilizationPct ?? 0);
      request.input('score', sql.NVarChar(16), row.score || 'Unknown');
      request.input('reason', sql.NVarChar(512), row.reason || 'No reason recorded.');
      request.input('latestSourceCapturedAtUtc', sql.DateTime2, row.latestCapturedAtUtc ?? null);

      await request.query(`
        INSERT INTO dbo.CapacityScoreSnapshot
        (capturedAtUtc, region, skuName, skuFamily, subscriptionCount, okRows, limitedRows, constrainedRows, totalQuotaAvailable, utilizationPct, score, reason, latestSourceCapturedAtUtc)
        VALUES
        (@capturedAtUtc, @region, @skuName, @skuFamily, @subscriptionCount, @okRows, @limitedRows, @constrainedRows, @totalQuotaAvailable, @utilizationPct, @score, @reason, @latestSourceCapturedAtUtc)
      `);
    }

    await transaction.commit();
    return rows.length;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function getCapacityScoreSnapshotHistory(filters = {}) {
  const pool = await getSqlPool();
  if (!pool) {
    return [];
  }

  try {
    if (!(await tableExists(pool, 'dbo.CapacityScoreSnapshot'))) {
      return [];
    }

    await ensureCapacityScoreSnapshotSchema(pool);
  } catch (err) {
    if (isSchemaPermissionError(err)) {
      return [];
    }

    throw err;
  }

  const days = Math.max(1, Math.min(Number(filters.days || 30), 365));
  const request = pool.request();
  request.input('daysBack', sql.Int, days);

  let where = `
    WHERE capturedAtUtc >= DATEADD(day, -@daysBack, SYSUTCDATETIME())
  `;

  if (filters.region && filters.region !== 'all') {
    where += ' AND region = @region';
    request.input('region', sql.NVarChar(64), filters.region);
  }

  if (filters.family && filters.family !== 'all') {
    where += ' AND skuFamily = @family';
    request.input('family', sql.NVarChar(128), filters.family);
  }

  if (filters.score && filters.score !== 'all') {
    where += ' AND score = @score';
    request.input('score', sql.NVarChar(16), filters.score);
  }

  if (filters.sku && filters.sku !== 'all') {
    where += ' AND skuName = @sku';
    request.input('sku', sql.NVarChar(128), filters.sku);
  }

  const result = await request.query(`
    SELECT
      capturedAtUtc,
      region,
      skuName,
      skuFamily,
      subscriptionCount,
      okRows,
      limitedRows,
      constrainedRows,
      totalQuotaAvailable,
      utilizationPct,
      score,
      reason,
      latestSourceCapturedAtUtc
    FROM dbo.CapacityScoreSnapshot
    ${where}
    ORDER BY capturedAtUtc DESC, region ASC, skuName ASC
  `);

  return (result.recordset || []).map((row) => ({
    capturedAtUtc: row.capturedAtUtc,
    region: row.region,
    sku: row.skuName,
    family: row.skuFamily,
    subscriptionCount: Number(row.subscriptionCount || 0),
    okRows: Number(row.okRows || 0),
    limitedRows: Number(row.limitedRows || 0),
    constrainedRows: Number(row.constrainedRows || 0),
    totalQuotaAvailable: Number(row.totalQuotaAvailable || 0),
    utilizationPct: Number(row.utilizationPct || 0),
    score: row.score,
    reason: row.reason,
    latestCapturedAtUtc: row.latestSourceCapturedAtUtc
  }));
}

async function ensureQuotaCandidateSnapshotTable(pool) {
  const hasTable = await tableExists(pool, 'dbo.QuotaCandidateSnapshot');
  if (!hasTable) {
    throw new Error('Quota candidate history is unavailable because the QuotaCandidateSnapshot table is not provisioned. Run the SQL schema/bootstrap migration for this environment.');
  }
}

async function insertQuotaCandidateSnapshots(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const pool = await getSqlPool();
  if (!pool) {
    throw new Error('SQL connection is not configured for quota candidate capture.');
  }

  await ensureQuotaCandidateSnapshotTable(pool);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    for (const row of rows) {
      const request = new sql.Request(transaction);
      request.input('analysisRunId', sql.UniqueIdentifier, row.analysisRunId);
      request.input('capturedAtUtc', sql.DateTime2, row.capturedAtUtc || new Date());
      request.input('sourceCapturedAtUtc', sql.DateTime2, row.sourceCapturedAtUtc ?? null);
      request.input('managementGroupId', sql.NVarChar(128), row.managementGroupId);
      request.input('groupQuotaName', sql.NVarChar(128), row.groupQuotaName);
      request.input('subscriptionId', sql.NVarChar(64), row.subscriptionId);
      request.input('subscriptionName', sql.NVarChar(256), row.subscriptionName || 'Subscription');
      request.input('region', sql.NVarChar(64), row.region);
      request.input('quotaName', sql.NVarChar(128), row.quotaName);
      request.input('skuList', sql.NVarChar(sql.MAX), row.skuList || null);
      request.input('skuCount', sql.Int, row.skuCount ?? 0);
      request.input('availabilityState', sql.NVarChar(32), row.availabilityState || 'Unknown');
      request.input('quotaCurrent', sql.Int, row.quotaCurrent ?? 0);
      request.input('quotaLimit', sql.Int, row.quotaLimit ?? 0);
      request.input('quotaAvailable', sql.Int, row.quotaAvailable ?? 0);
      request.input('suggestedMovable', sql.Int, row.suggestedMovable ?? 0);
      request.input('safetyBuffer', sql.Int, row.safetyBuffer ?? 0);
      request.input('subscriptionHash', sql.NVarChar(128), row.subscriptionHash);
      request.input('candidateStatus', sql.NVarChar(32), row.candidateStatus || 'Unknown');

      await request.query(`
        INSERT INTO dbo.QuotaCandidateSnapshot
        (analysisRunId, capturedAtUtc, sourceCapturedAtUtc, managementGroupId, groupQuotaName, subscriptionId, subscriptionName, region, quotaName, skuList, skuCount, availabilityState, quotaCurrent, quotaLimit, quotaAvailable, suggestedMovable, safetyBuffer, subscriptionHash, candidateStatus)
        VALUES
        (@analysisRunId, @capturedAtUtc, @sourceCapturedAtUtc, @managementGroupId, @groupQuotaName, @subscriptionId, @subscriptionName, @region, @quotaName, @skuList, @skuCount, @availabilityState, @quotaCurrent, @quotaLimit, @quotaAvailable, @suggestedMovable, @safetyBuffer, @subscriptionHash, @candidateStatus)
      `);
    }

    await transaction.commit();
    return rows.length;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function getQuotaCandidateSnapshots(filters = {}) {
  const pool = await getSqlPool();
  if (!pool) {
    throw new Error('SQL connection is not configured for quota planning.');
  }

  const managementGroupId = filters.managementGroupId;
  const groupQuotaName = filters.groupQuotaName;
  const region = filters.region || 'all';
  const quotaName = filters.quotaName || filters.family || 'all';
  const analysisRunId = filters.analysisRunId || null;

  if (!managementGroupId) {
    throw new Error('managementGroupId is required.');
  }

  if (!groupQuotaName || groupQuotaName === 'all') {
    throw new Error('groupQuotaName is required.');
  }

  await ensureQuotaCandidateSnapshotTable(pool);

  const request = pool.request();
  request.input('managementGroupId', sql.NVarChar(128), managementGroupId);
  request.input('groupQuotaName', sql.NVarChar(128), groupQuotaName);
  request.input('region', sql.NVarChar(64), region);
  request.input('quotaName', sql.NVarChar(128), quotaName);
  request.input('analysisRunId', sql.UniqueIdentifier, analysisRunId);

  const result = await request.query(`
    WITH SelectedRun AS (
      SELECT TOP (1)
        analysisRunId,
        capturedAtUtc
      FROM dbo.QuotaCandidateSnapshot
      WHERE managementGroupId = @managementGroupId
        AND groupQuotaName = @groupQuotaName
        AND (@analysisRunId IS NULL OR analysisRunId = @analysisRunId)
        AND (@region = 'all' OR region = @region)
        AND (@quotaName = 'all' OR quotaName = @quotaName)
      GROUP BY analysisRunId, capturedAtUtc
      ORDER BY capturedAtUtc DESC, analysisRunId DESC
    )
    SELECT
      qcs.analysisRunId,
      qcs.capturedAtUtc,
      qcs.sourceCapturedAtUtc,
      qcs.managementGroupId,
      qcs.groupQuotaName,
      qcs.subscriptionId,
      qcs.subscriptionName,
      qcs.region,
      qcs.quotaName,
      qcs.skuList,
      qcs.skuCount,
      qcs.availabilityState,
      qcs.quotaCurrent,
      qcs.quotaLimit,
      qcs.quotaAvailable,
      qcs.suggestedMovable,
      qcs.safetyBuffer,
      qcs.subscriptionHash,
      qcs.candidateStatus
    FROM dbo.QuotaCandidateSnapshot qcs
    INNER JOIN SelectedRun selectedRun
      ON selectedRun.analysisRunId = qcs.analysisRunId
    WHERE (@region = 'all' OR qcs.region = @region)
      AND (@quotaName = 'all' OR qcs.quotaName = @quotaName)
    ORDER BY qcs.region, qcs.quotaName, qcs.suggestedMovable DESC, qcs.subscriptionName
  `);

  return result.recordset || [];
}

async function listQuotaCandidateRuns(filters = {}) {
  const pool = await getSqlPool();
  if (!pool) {
    throw new Error('SQL connection is not configured for quota planning.');
  }

  const managementGroupId = filters.managementGroupId;
  const groupQuotaName = filters.groupQuotaName;
  const region = filters.region || 'all';
  const quotaName = filters.quotaName || filters.family || 'all';

  if (!managementGroupId) {
    throw new Error('managementGroupId is required.');
  }

  if (!groupQuotaName || groupQuotaName === 'all') {
    throw new Error('groupQuotaName is required.');
  }

  await ensureQuotaCandidateSnapshotTable(pool);

  const request = pool.request();
  request.input('managementGroupId', sql.NVarChar(128), managementGroupId);
  request.input('groupQuotaName', sql.NVarChar(128), groupQuotaName);
  request.input('region', sql.NVarChar(64), region);
  request.input('quotaName', sql.NVarChar(128), quotaName);

  const result = await request.query(`
    SELECT
      analysisRunId,
      capturedAtUtc,
      MAX(sourceCapturedAtUtc) AS latestSourceCapturedAtUtc,
        COUNT(*) AS [rowCount],
        COUNT(DISTINCT subscriptionId) AS [subscriptionCount],
        SUM(CASE WHEN suggestedMovable > 0 THEN 1 ELSE 0 END) AS [movableCandidateCount]
    FROM dbo.QuotaCandidateSnapshot
    WHERE managementGroupId = @managementGroupId
      AND groupQuotaName = @groupQuotaName
      AND (@region = 'all' OR region = @region)
      AND (@quotaName = 'all' OR quotaName = @quotaName)
    GROUP BY analysisRunId, capturedAtUtc
    ORDER BY capturedAtUtc DESC, analysisRunId DESC
  `);

  return result.recordset || [];
}

async function ensureDashboardErrorLogSchema(pool) {
  const createScript = `
    IF OBJECT_ID('dbo.DashboardErrorLog', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.DashboardErrorLog (
        errorLogId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        errorSource NVARCHAR(64) NOT NULL,
        errorType NVARCHAR(128) NOT NULL,
        errorMessage NVARCHAR(2048) NOT NULL,
        stackTrace NVARCHAR(MAX) NULL,
        occurredAtUtc DATETIME2 NOT NULL,
        severity NVARCHAR(16) NOT NULL,
        context NVARCHAR(MAX) NULL,
        affectedRegion NVARCHAR(64) NULL,
        affectedSku NVARCHAR(128) NULL,
        affectedDesiredCount INT NULL,
        isResolved BIT NOT NULL DEFAULT 0,
        resolvedAtUtc DATETIME2 NULL,
        resolutionNotes NVARCHAR(512) NULL
      )
    END;
  `;

  const createIndexScript = `
    IF NOT EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE name = 'IX_DashboardErrorLog_OccurredAt'
        AND object_id = OBJECT_ID('dbo.DashboardErrorLog')
    )
    BEGIN
      CREATE INDEX IX_DashboardErrorLog_OccurredAt
        ON dbo.DashboardErrorLog (occurredAtUtc DESC, errorSource, severity);
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE name = 'IX_DashboardErrorLog_Unresolved'
        AND object_id = OBJECT_ID('dbo.DashboardErrorLog')
    )
    BEGIN
      CREATE INDEX IX_DashboardErrorLog_Unresolved
        ON dbo.DashboardErrorLog (isResolved, occurredAtUtc DESC)
        WHERE isResolved = 0;
    END;
  `;

  await pool.request().query(createScript);
  await pool.request().query(createIndexScript);
}

async function insertDashboardErrorLog(entry = {}) {
  const pool = await getSqlPool();
  if (!pool) {
    return 0;
  }

  await ensureDashboardErrorLogSchema(pool);

  const request = pool.request();
  request.input('errorSource', sql.NVarChar(64), entry.source || 'unknown');
  request.input('errorType', sql.NVarChar(128), entry.type || 'UnkownError');
  request.input('errorMessage', sql.NVarChar(2048), (entry.message || 'No error message').substring(0, 2048));
  request.input('stackTrace', sql.NVarChar(sql.MAX), entry.stack || null);
  request.input('occurredAtUtc', sql.DateTime2, entry.occurredAtUtc || new Date());
  request.input('severity', sql.NVarChar(16), entry.severity || 'error');
  request.input('context', sql.NVarChar(sql.MAX), entry.context ? JSON.stringify(entry.context) : null);
  request.input('affectedRegion', sql.NVarChar(64), entry.region || null);
  request.input('affectedSku', sql.NVarChar(128), entry.sku || null);
  request.input('affectedDesiredCount', sql.Int, Number.isFinite(entry.desiredCount) ? entry.desiredCount : null);

  try {
    await request.query(`
      INSERT INTO dbo.DashboardErrorLog
      (errorSource, errorType, errorMessage, stackTrace, occurredAtUtc, severity, context, affectedRegion, affectedSku, affectedDesiredCount, isResolved)
      VALUES
      (@errorSource, @errorType, @errorMessage, @stackTrace, @occurredAtUtc, @severity, @context, @affectedRegion, @affectedSku, @affectedDesiredCount, 0)
    `);
    return 1;
  } catch (err) {
    console.error('Failed to log error to database:', err.message);
    return 0;
  }
}

async function listDashboardErrorLogs(options = {}) {
  const pool = await getSqlPool();
  if (!pool) {
    return [];
  }

  await ensureDashboardErrorLogSchema(pool);

  const limit = Math.max(5, Math.min(Number(options.limit || 50), 200));
  const onlyUnresolved = Boolean(options.onlyUnresolved);
  const source = options.source || null;
  const severity = options.severity || null;
  const hoursBack = Math.max(1, Math.min(Number(options.hoursBack || 168), 24 * 365));

  const request = pool.request();
  request.input('limitRows', sql.Int, limit);
  request.input('hoursBack', sql.Int, hoursBack);

  let where = 'WHERE occurredAtUtc >= DATEADD(hour, -@hoursBack, SYSUTCDATETIME())';
  if (onlyUnresolved) {
    where += ' AND isResolved = 0';
  }
  if (source) {
    where += ' AND errorSource = @source';
    request.input('source', sql.NVarChar(64), source);
  }
  if (severity) {
    where += ' AND severity = @severity';
    request.input('severity', sql.NVarChar(16), severity);
  }

  const result = await request.query(`
    SELECT TOP (@limitRows)
      errorLogId,
      errorSource,
      errorType,
      errorMessage,
      stackTrace,
      occurredAtUtc,
      severity,
      context,
      affectedRegion,
      affectedSku,
      affectedDesiredCount,
      isResolved,
      resolvedAtUtc,
      resolutionNotes
    FROM dbo.DashboardErrorLog
    ${where}
    ORDER BY occurredAtUtc DESC, errorLogId DESC
  `);

  return (result.recordset || []).map((row) => {
    let contextObj = null;
    if (row.context) {
      try {
        contextObj = JSON.parse(row.context);
      } catch {
        contextObj = null;
      }
    }

    return {
      id: Number(row.errorLogId),
      source: row.errorSource,
      type: row.errorType,
      message: row.errorMessage,
      stack: row.stackTrace,
      occurredAtUtc: row.occurredAtUtc,
      severity: row.severity,
      context: contextObj,
      region: row.affectedRegion,
      sku: row.affectedSku,
      desiredCount: row.affectedDesiredCount == null ? null : Number(row.affectedDesiredCount),
      isResolved: Boolean(row.isResolved),
      resolvedAtUtc: row.resolvedAtUtc,
      resolutionNotes: row.resolutionNotes
    };
  });
}

async function ensureDashboardOperationLogSchema(pool) {
  const createScript = `
    IF OBJECT_ID('dbo.DashboardOperationLog', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.DashboardOperationLog (
        operationLogId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operationType NVARCHAR(64) NOT NULL,
        operationName NVARCHAR(128) NOT NULL,
        status NVARCHAR(16) NOT NULL,
        triggerSource NVARCHAR(32) NOT NULL,
        startedAtUtc DATETIME2 NOT NULL,
        completedAtUtc DATETIME2 NULL,
        durationMs INT NULL,
        rowsAffected INT NULL,
        subscriptionCount INT NULL,
        requestedDesiredCount INT NULL,
        effectiveDesiredCount INT NULL,
        regionPreset NVARCHAR(64) NULL,
        note NVARCHAR(512) NULL,
        errorMessage NVARCHAR(2048) NULL
      )
    END;
  `;

  const createIndexScript = `
    IF NOT EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE name = 'IX_DashboardOperationLog_StartedAt'
        AND object_id = OBJECT_ID('dbo.DashboardOperationLog')
    )
    BEGIN
      CREATE INDEX IX_DashboardOperationLog_StartedAt
        ON dbo.DashboardOperationLog (startedAtUtc DESC, operationType, status);
    END;
  `;

  await pool.request().query(createScript);
  await pool.request().query(createIndexScript);
}

async function logDashboardOperation(entry = {}) {
  const pool = await getSqlPool();
  if (!pool) {
    return 0;
  }

  await ensureDashboardOperationLogSchema(pool);

  const request = pool.request();
  request.input('operationType', sql.NVarChar(64), entry.type || 'unknown');
  request.input('operationName', sql.NVarChar(128), entry.name || entry.type || 'Unknown Operation');
  request.input('status', sql.NVarChar(16), entry.status || 'success');
  request.input('triggerSource', sql.NVarChar(32), entry.triggerSource || 'manual');
  request.input('startedAtUtc', sql.DateTime2, entry.startedAtUtc || new Date());
  request.input('completedAtUtc', sql.DateTime2, entry.completedAtUtc || new Date());
  request.input('durationMs', sql.Int, Number.isFinite(entry.durationMs) ? entry.durationMs : null);
  request.input('rowsAffected', sql.Int, Number.isFinite(entry.rowsAffected) ? entry.rowsAffected : null);
  request.input('subscriptionCount', sql.Int, Number.isFinite(entry.subscriptionCount) ? entry.subscriptionCount : null);
  request.input('requestedDesiredCount', sql.Int, Number.isFinite(entry.requestedDesiredCount) ? entry.requestedDesiredCount : null);
  request.input('effectiveDesiredCount', sql.Int, Number.isFinite(entry.effectiveDesiredCount) ? entry.effectiveDesiredCount : null);
  request.input('regionPreset', sql.NVarChar(64), entry.regionPreset || null);
  request.input('note', sql.NVarChar(512), entry.note || null);
  request.input('errorMessage', sql.NVarChar(2048), entry.errorMessage || null);

  try {
    await request.query(`
      INSERT INTO dbo.DashboardOperationLog
      (operationType, operationName, status, triggerSource, startedAtUtc, completedAtUtc, durationMs, rowsAffected, subscriptionCount, requestedDesiredCount, effectiveDesiredCount, regionPreset, note, errorMessage)
      VALUES
      (@operationType, @operationName, @status, @triggerSource, @startedAtUtc, @completedAtUtc, @durationMs, @rowsAffected, @subscriptionCount, @requestedDesiredCount, @effectiveDesiredCount, @regionPreset, @note, @errorMessage)
    `);
    return 1;
  } catch (err) {
    console.error('Failed to log operation:', err.message);
    return 0;
  }
}

async function listDashboardOperations(options = {}) {
  const pool = await getSqlPool();
  if (!pool) {
    return [];
  }

  await ensureDashboardOperationLogSchema(pool);

  const limit = Math.max(5, Math.min(Number(options.limit || 25), 100));
  const request = pool.request();
  request.input('limitRows', sql.Int, limit);

  let where = '';
  if (options.operationType) {
    where += ' WHERE operationType = @operationType';
    request.input('operationType', sql.NVarChar(64), options.operationType);
  }

  if (options.onlyFailed) {
    where = where ? where + ' AND status = \'failed\'' : ' WHERE status = \'failed\'';
  }

  const result = await request.query(`
    SELECT TOP (@limitRows)
      operationLogId,
      operationType,
      operationName,
      status,
      triggerSource,
      startedAtUtc,
      completedAtUtc,
      durationMs,
      rowsAffected,
      subscriptionCount,
      requestedDesiredCount,
      effectiveDesiredCount,
      regionPreset,
      note,
      errorMessage
    FROM dbo.DashboardOperationLog
    ${where}
    ORDER BY startedAtUtc DESC, operationLogId DESC
  `);

  return (result.recordset || []).map((row) => ({
    id: Number(row.operationLogId),
    type: row.operationType,
    name: row.operationName,
    status: row.status,
    triggerSource: row.triggerSource,
    startedAtUtc: row.startedAtUtc,
    completedAtUtc: row.completedAtUtc,
    durationMs: Number(row.durationMs || 0),
    rowsAffected: row.rowsAffected == null ? null : Number(row.rowsAffected),
    subscriptionCount: row.subscriptionCount == null ? null : Number(row.subscriptionCount),
    requestedDesiredCount: row.requestedDesiredCount == null ? null : Number(row.requestedDesiredCount),
    effectiveDesiredCount: row.effectiveDesiredCount == null ? null : Number(row.effectiveDesiredCount),
    regionPreset: row.regionPreset,
    note: row.note,
    errorMessage: row.errorMessage
  }));
}

async function ensureDashboardSettingSchema(pool) {
  const createScript = `
    IF OBJECT_ID('dbo.DashboardSetting', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.DashboardSetting (
        settingKey NVARCHAR(128) NOT NULL PRIMARY KEY,
        settingValue NVARCHAR(MAX) NOT NULL,
        updatedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      )
    END;
  `;

  await pool.request().query(createScript);
}

async function getDashboardSettings(prefix = null) {
  const pool = await getSqlPool();
  if (!pool) {
    return {};
  }

  if (!(await tableExists(pool, 'dbo.DashboardSetting'))) {
    return {};
  }

  const request = pool.request();
  let where = '';

  if (prefix && String(prefix).trim()) {
    request.input('prefix', sql.NVarChar(128), `${String(prefix).trim()}%`);
    where = 'WHERE settingKey LIKE @prefix';
  }

  const result = await request.query(`
    SELECT settingKey, settingValue, updatedAtUtc
    FROM dbo.DashboardSetting
    ${where}
    ORDER BY settingKey ASC
  `);

  const map = {};
  for (const row of result.recordset || []) {
    map[row.settingKey] = {
      value: row.settingValue,
      updatedAtUtc: row.updatedAtUtc
    };
  }

  return map;
}

async function getDashboardSettingsPersistence() {
  const pool = await getSqlPool();
  if (!pool) {
    return {
      available: false,
      source: 'runtime-defaults',
      message: 'SQL scheduler settings are unavailable because SQL connectivity is not configured.'
    };
  }

  if (!(await tableExists(pool, 'dbo.DashboardSetting'))) {
    return {
      available: false,
      source: 'runtime-defaults',
      message: 'SQL scheduler settings are unavailable because the DashboardSetting table is not provisioned.'
    };
  }

  return {
    available: true,
    source: 'sql',
    message: 'SQL scheduler settings are available.'
  };
}

async function upsertDashboardSettings(entries = {}) {
  const keys = Object.keys(entries || {});
  if (keys.length === 0) {
    return 0;
  }

  const pool = await getSqlPool();
  if (!pool) {
    return 0;
  }

  if (!(await tableExists(pool, 'dbo.DashboardSetting'))) {
    throw new Error('Scheduler settings are unavailable until the DashboardSetting table is provisioned in SQL.');
  }

  let updatedCount = 0;
  for (const key of keys) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
      continue;
    }

    const rawValue = entries[key];
    const normalizedValue = rawValue == null ? '' : String(rawValue);

    const request = pool.request();
    request.input('settingKey', sql.NVarChar(128), normalizedKey);
    request.input('settingValue', sql.NVarChar(sql.MAX), normalizedValue);

    await request.query(`
      MERGE dbo.DashboardSetting AS target
      USING (
        SELECT
          @settingKey AS settingKey,
          @settingValue AS settingValue,
          SYSUTCDATETIME() AS updatedAtUtc
      ) AS source
      ON target.settingKey = source.settingKey
      WHEN MATCHED THEN
        UPDATE SET
          settingValue = source.settingValue,
          updatedAtUtc = source.updatedAtUtc
      WHEN NOT MATCHED THEN
        INSERT (settingKey, settingValue, updatedAtUtc)
        VALUES (source.settingKey, source.settingValue, source.updatedAtUtc);
    `);

    updatedCount += 1;
  }

  return updatedCount;
}

async function ensureLivePlacementSnapshotSchema(pool) {
  const createScript = `
    IF OBJECT_ID('dbo.LivePlacementSnapshot', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.LivePlacementSnapshot (
        livePlacementSnapshotId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        capturedAtUtc DATETIME2 NOT NULL,
        desiredCount INT NOT NULL,
        region NVARCHAR(64) NOT NULL,
        skuName NVARCHAR(128) NOT NULL,
        livePlacementScore NVARCHAR(64) NOT NULL,
        livePlacementAvailable BIT NULL,
        livePlacementRestricted BIT NULL,
        warningMessage NVARCHAR(512) NULL
      )
    END;
  `;

  const createIndexScript = `
    IF NOT EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE name = 'IX_LivePlacementSnapshot_DesiredCapturedRegionSku'
        AND object_id = OBJECT_ID('dbo.LivePlacementSnapshot')
    )
    BEGIN
      CREATE INDEX IX_LivePlacementSnapshot_DesiredCapturedRegionSku
        ON dbo.LivePlacementSnapshot (desiredCount, capturedAtUtc DESC, region, skuName);
    END;
  `;

  await pool.request().query(createScript);
  await pool.request().query(createIndexScript);
}

async function ensurePaaSAvailabilitySnapshotSchema(pool) {
  const createScript = `
    IF OBJECT_ID('dbo.PaaSAvailabilitySnapshot', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.PaaSAvailabilitySnapshot (
        paasAvailabilitySnapshotId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        runId UNIQUEIDENTIFIER NOT NULL,
        capturedAtUtc DATETIME2 NOT NULL,
        requestedService NVARCHAR(64) NOT NULL,
        requestedRegionPreset NVARCHAR(64) NULL,
        requestedRegionsJson NVARCHAR(MAX) NULL,
        metadataJson NVARCHAR(MAX) NULL,
        category NVARCHAR(64) NOT NULL,
        service NVARCHAR(64) NOT NULL,
        region NVARCHAR(64) NOT NULL,
        resourceType NVARCHAR(64) NULL,
        name NVARCHAR(256) NOT NULL,
        displayName NVARCHAR(256) NULL,
        edition NVARCHAR(128) NULL,
        tier NVARCHAR(256) NULL,
        family NVARCHAR(128) NULL,
        status NVARCHAR(64) NULL,
        available BIT NULL,
        zoneRedundant BIT NULL,
        quotaCurrent INT NULL,
        quotaLimit INT NULL,
        metricPrimary NVARCHAR(256) NULL,
        metricSecondary NVARCHAR(256) NULL,
        detailsJson NVARCHAR(MAX) NULL
      );
    END;
  `;

  const createIndexScript = `
    IF NOT EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE name = 'IX_PaaSAvailabilitySnapshot_ServiceCaptured'
        AND object_id = OBJECT_ID('dbo.PaaSAvailabilitySnapshot')
    )
    BEGIN
      CREATE INDEX IX_PaaSAvailabilitySnapshot_ServiceCaptured
        ON dbo.PaaSAvailabilitySnapshot (requestedService, capturedAtUtc DESC, service, region);
    END;
  `;

  await pool.request().query(createScript);
  await pool.request().query(createIndexScript);
}

async function saveLivePlacementSnapshots(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const pool = await getSqlPool();
  if (!pool) {
    return 0;
  }

  await ensureLivePlacementSnapshotSchema(pool);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    for (const row of rows) {
      const request = new sql.Request(transaction);
      const normalizedSkuName = normalizeSkuName(row.sku);
      request.input('capturedAtUtc', sql.DateTime2, row.capturedAtUtc || new Date());
      request.input('desiredCount', sql.Int, Math.max(Number(row.desiredCount || 1), 1));
      request.input('region', sql.NVarChar(64), row.region);
      request.input('skuName', sql.NVarChar(128), normalizedSkuName);
      request.input('livePlacementScore', sql.NVarChar(64), row.livePlacementScore || 'N/A');
      request.input('livePlacementAvailable', sql.Bit, typeof row.livePlacementAvailable === 'boolean' ? row.livePlacementAvailable : null);
      request.input('livePlacementRestricted', sql.Bit, typeof row.livePlacementRestricted === 'boolean' ? row.livePlacementRestricted : null);
      request.input('warningMessage', sql.NVarChar(512), row.warning || null);

      await request.query(`
        INSERT INTO dbo.LivePlacementSnapshot
        (capturedAtUtc, desiredCount, region, skuName, livePlacementScore, livePlacementAvailable, livePlacementRestricted, warningMessage)
        VALUES
        (@capturedAtUtc, @desiredCount, @region, @skuName, @livePlacementScore, @livePlacementAvailable, @livePlacementRestricted, @warningMessage)
      `);
    }

    await transaction.commit();
    return rows.length;
  } catch (err) {
    await transaction.rollback();
    console.error('Failed to save live placement snapshots:', err.message);
    return 0;
  }
}

async function savePaaSAvailabilitySnapshots(rows = [], options = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { runId: null, rowCount: 0 };
  }

  const pool = await getSqlPool();
  if (!pool) {
    return { runId: null, rowCount: 0 };
  }

  await ensurePaaSAvailabilitySnapshotSchema(pool);

  const effectiveRunId = options.runId || randomUUID();
  const requestedService = String(options.requestedService || 'All').trim() || 'All';
  const requestedRegionPreset = options.requestedRegionPreset ? String(options.requestedRegionPreset).trim() : null;
  const requestedRegionsJson = Array.isArray(options.requestedRegions) ? JSON.stringify(options.requestedRegions) : (options.requestedRegions ? JSON.stringify(options.requestedRegions) : null);
  const metadataJson = options.metadata ? JSON.stringify(options.metadata) : null;

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    for (const row of rows) {
      const request = new sql.Request(transaction);
      request.input('runId', sql.UniqueIdentifier, effectiveRunId);
      request.input('capturedAtUtc', sql.DateTime2, row.capturedAtUtc || new Date());
      request.input('requestedService', sql.NVarChar(64), requestedService);
      request.input('requestedRegionPreset', sql.NVarChar(64), requestedRegionPreset);
      request.input('requestedRegionsJson', sql.NVarChar(sql.MAX), requestedRegionsJson);
      request.input('metadataJson', sql.NVarChar(sql.MAX), metadataJson);
      request.input('category', sql.NVarChar(64), String(row.category || 'unknown'));
      request.input('service', sql.NVarChar(64), String(row.service || requestedService));
      request.input('region', sql.NVarChar(64), String(row.region || 'global').toLowerCase());
      request.input('resourceType', sql.NVarChar(64), row.resourceType || null);
      request.input('name', sql.NVarChar(256), String(row.name || row.displayName || 'unknown'));
      request.input('displayName', sql.NVarChar(256), row.displayName || null);
      request.input('edition', sql.NVarChar(128), row.edition || null);
      request.input('tier', sql.NVarChar(256), row.tier || null);
      request.input('family', sql.NVarChar(128), row.family || null);
      request.input('status', sql.NVarChar(64), row.status || null);
      request.input('available', sql.Bit, typeof row.available === 'boolean' ? row.available : null);
      request.input('zoneRedundant', sql.Bit, typeof row.zoneRedundant === 'boolean' ? row.zoneRedundant : null);
      request.input('quotaCurrent', sql.Int, Number.isFinite(Number(row.quotaCurrent)) ? Number(row.quotaCurrent) : null);
      request.input('quotaLimit', sql.Int, Number.isFinite(Number(row.quotaLimit)) ? Number(row.quotaLimit) : null);
      request.input('metricPrimary', sql.NVarChar(256), row.metricPrimary == null ? null : String(row.metricPrimary));
      request.input('metricSecondary', sql.NVarChar(256), row.metricSecondary == null ? null : String(row.metricSecondary));
      request.input('detailsJson', sql.NVarChar(sql.MAX), row.details ? JSON.stringify(row.details) : null);

      await request.query(`
        INSERT INTO dbo.PaaSAvailabilitySnapshot
        (runId, capturedAtUtc, requestedService, requestedRegionPreset, requestedRegionsJson, metadataJson, category, service, region, resourceType, name, displayName, edition, tier, family, status, available, zoneRedundant, quotaCurrent, quotaLimit, metricPrimary, metricSecondary, detailsJson)
        VALUES
        (@runId, @capturedAtUtc, @requestedService, @requestedRegionPreset, @requestedRegionsJson, @metadataJson, @category, @service, @region, @resourceType, @name, @displayName, @edition, @tier, @family, @status, @available, @zoneRedundant, @quotaCurrent, @quotaLimit, @metricPrimary, @metricSecondary, @detailsJson)
      `);
    }

    await transaction.commit();
    return { runId: effectiveRunId, rowCount: rows.length };
  } catch (err) {
    await transaction.rollback();
    console.error('Failed to save PaaS availability snapshots:', err.message);
    return { runId: null, rowCount: 0 };
  }
}

async function getLatestPaaSAvailabilitySnapshots(options = {}) {
  const pool = await getSqlPool();
  if (!pool) {
    return { rows: [] };
  }

  await ensurePaaSAvailabilitySnapshotSchema(pool);

  const requestedService = String(options.requestedService || '').trim();
  const normalizedMaxAge = Math.max(1, Math.min(Number(options.maxAgeHours || 168), 24 * 365));

  const runRequest = pool.request();
  runRequest.input('maxAgeHours', sql.Int, normalizedMaxAge);
  let runQuery = `
    SELECT TOP (1)
      runId,
      capturedAtUtc,
      requestedService,
      requestedRegionPreset,
      requestedRegionsJson,
      metadataJson
    FROM dbo.PaaSAvailabilitySnapshot
    WHERE capturedAtUtc >= DATEADD(hour, -@maxAgeHours, SYSUTCDATETIME())
  `;

  if (requestedService) {
    runRequest.input('requestedService', sql.NVarChar(64), requestedService);
    runQuery += ` AND requestedService = @requestedService`;
  }

  runQuery += ` ORDER BY capturedAtUtc DESC, paasAvailabilitySnapshotId DESC`;

  const runResult = await runRequest.query(runQuery);
  const runRow = runResult.recordset && runResult.recordset[0];
  if (!runRow) {
    return { rows: [] };
  }

  const rowRequest = pool.request();
  rowRequest.input('runId', sql.UniqueIdentifier, runRow.runId);
  const rowResult = await rowRequest.query(`
    SELECT
      runId,
      capturedAtUtc,
      requestedService,
      requestedRegionPreset,
      requestedRegionsJson,
      metadataJson,
      category,
      service,
      region,
      resourceType,
      name,
      displayName,
      edition,
      tier,
      family,
      status,
      available,
      zoneRedundant,
      quotaCurrent,
      quotaLimit,
      metricPrimary,
      metricSecondary,
      detailsJson
    FROM dbo.PaaSAvailabilitySnapshot
    WHERE runId = @runId
    ORDER BY service ASC, region ASC, category ASC, name ASC
  `);

  return {
    runId: runRow.runId,
    capturedAtUtc: runRow.capturedAtUtc,
    requestedService: runRow.requestedService,
    requestedRegionPreset: runRow.requestedRegionPreset,
    requestedRegions: (() => {
      try {
        return JSON.parse(runRow.requestedRegionsJson || '[]');
      } catch {
        return [];
      }
    })(),
    metadata: (() => {
      try {
        return JSON.parse(runRow.metadataJson || 'null');
      } catch {
        return null;
      }
    })(),
    rows: (rowResult.recordset || []).map((row) => ({
      runId: row.runId,
      capturedAtUtc: row.capturedAtUtc,
      category: row.category,
      service: row.service,
      region: row.region,
      resourceType: row.resourceType,
      name: row.name,
      displayName: row.displayName,
      edition: row.edition,
      tier: row.tier,
      family: row.family,
      status: row.status,
      available: typeof row.available === 'boolean' ? row.available : null,
      zoneRedundant: typeof row.zoneRedundant === 'boolean' ? row.zoneRedundant : null,
      quotaCurrent: row.quotaCurrent,
      quotaLimit: row.quotaLimit,
      metricPrimary: row.metricPrimary,
      metricSecondary: row.metricSecondary,
      details: (() => {
        try {
          return JSON.parse(row.detailsJson || 'null');
        } catch {
          return null;
        }
      })()
    }))
  };
}

async function getLatestLivePlacementSnapshots(desiredCount = 1, maxAgeHours = 168) {
  const pool = await getSqlPool();
  if (!pool) {
    return [];
  }

  await ensureLivePlacementSnapshotSchema(pool);

  const normalizedDesiredCount = Math.max(1, Math.min(Number(desiredCount || 1), 1000));
  const normalizedMaxAge = Math.max(1, Math.min(Number(maxAgeHours || 168), 24 * 365));

  const request = pool.request();
  request.input('desiredCount', sql.Int, normalizedDesiredCount);
  request.input('maxAgeHours', sql.Int, normalizedMaxAge);

  const result = await request.query(`
    WITH RankedSnapshots AS (
      SELECT
        capturedAtUtc,
        desiredCount,
        region,
        skuName,
        livePlacementScore,
        livePlacementAvailable,
        livePlacementRestricted,
        warningMessage,
        ROW_NUMBER() OVER (
          PARTITION BY region, skuName
          ORDER BY capturedAtUtc DESC, livePlacementSnapshotId DESC
        ) AS rn
      FROM dbo.LivePlacementSnapshot
      WHERE desiredCount = @desiredCount
        AND capturedAtUtc >= DATEADD(hour, -@maxAgeHours, SYSUTCDATETIME())
    )
    SELECT
      capturedAtUtc,
      region,
      skuName,
      livePlacementScore,
      livePlacementAvailable,
      livePlacementRestricted,
      warningMessage
    FROM RankedSnapshots
    WHERE rn = 1
  `);

  return (result.recordset || []).map((row) => ({
    capturedAtUtc: row.capturedAtUtc,
    region: row.region,
    sku: row.skuName,
    livePlacementScore: row.livePlacementScore,
    livePlacementAvailable: typeof row.livePlacementAvailable === 'boolean' ? row.livePlacementAvailable : null,
    livePlacementRestricted: typeof row.livePlacementRestricted === 'boolean' ? row.livePlacementRestricted : null,
    warning: row.warningMessage
  }));
}

async function ensureVmSkuCatalogSchema(pool) {
  await pool.request().query(`
    IF OBJECT_ID('dbo.VmSkuCatalog', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.VmSkuCatalog (
        skuFamily NVARCHAR(128) NOT NULL,
        skuName NVARCHAR(128) NOT NULL,
        vCpu INT NULL,
        memoryGB DECIMAL(10,2) NULL,
        firstSeenUtc DATETIME2 NOT NULL CONSTRAINT DF_VmSkuCatalog_FirstSeenUtc DEFAULT SYSUTCDATETIME(),
        lastSeenUtc DATETIME2 NOT NULL CONSTRAINT DF_VmSkuCatalog_LastSeenUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_VmSkuCatalog PRIMARY KEY (skuFamily, skuName)
      );
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VmSkuCatalog_Family' AND object_id = OBJECT_ID('dbo.VmSkuCatalog'))
      CREATE NONCLUSTERED INDEX IX_VmSkuCatalog_Family ON dbo.VmSkuCatalog(skuFamily, skuName);
  `);
}

async function upsertVmSkuCatalogRows(rows) {
  const pool = await getSqlPool();
  if (!pool || !Array.isArray(rows) || rows.length === 0) {
    return { upserted: 0 };
  }

  await ensureVmSkuCatalogSchema(pool);

  // Deduplicate by (family, name) within the batch.
  const dedup = new Map();
  rows.forEach((row) => {
    const family = String(row?.skuFamily || '').trim();
    const name = String(row?.skuName || '').trim();
    if (!family || !name) return;
    const key = `${family.toLowerCase()}|${name.toLowerCase()}`;
    if (!dedup.has(key)) {
      dedup.set(key, {
        skuFamily: family,
        skuName: name,
        vCpu: row.vCpu == null ? null : Number(row.vCpu),
        memoryGB: row.memoryGB == null ? null : Number(row.memoryGB)
      });
    }
  });
  const items = [...dedup.values()];
  if (items.length === 0) {
    return { upserted: 0 };
  }

  const json = JSON.stringify(items);
  const request = pool.request();
  request.input('payload', sql.NVarChar(sql.MAX), json);
  await request.query(`
    DECLARE @now DATETIME2 = SYSUTCDATETIME();
    MERGE dbo.VmSkuCatalog AS target
    USING (
      SELECT
        skuFamily,
        skuName,
        vCpu,
        memoryGB
      FROM OPENJSON(@payload)
      WITH (
        skuFamily NVARCHAR(128) '$.skuFamily',
        skuName NVARCHAR(128) '$.skuName',
        vCpu INT '$.vCpu',
        memoryGB DECIMAL(10,2) '$.memoryGB'
      )
    ) AS source
      ON target.skuFamily = source.skuFamily AND target.skuName = source.skuName
    WHEN MATCHED THEN UPDATE SET
      vCpu = COALESCE(source.vCpu, target.vCpu),
      memoryGB = COALESCE(source.memoryGB, target.memoryGB),
      lastSeenUtc = @now
    WHEN NOT MATCHED THEN INSERT (skuFamily, skuName, vCpu, memoryGB, firstSeenUtc, lastSeenUtc)
      VALUES (source.skuFamily, source.skuName, source.vCpu, source.memoryGB, @now, @now);
  `);

  return { upserted: items.length };
}

async function getVmSkuCatalogFamilies() {
  const pool = await getSqlPool();
  if (!pool) {
    return null;
  }
  await ensureVmSkuCatalogSchema(pool);
  const result = await pool.request().query(`
    SELECT skuFamily, skuName, vCpu, memoryGB
    FROM dbo.VmSkuCatalog
    ORDER BY skuFamily, skuName
  `);
  return result.recordset || [];
}

async function ensurePhase3SchemaForPool(pool) {
  const alterScript = `
    IF COL_LENGTH('dbo.CapacitySnapshot', 'subscriptionKey') IS NULL
      EXEC('ALTER TABLE dbo.CapacitySnapshot ADD subscriptionKey NVARCHAR(64) NULL');

    IF COL_LENGTH('dbo.CapacitySnapshot', 'subscriptionId') IS NULL
      EXEC('ALTER TABLE dbo.CapacitySnapshot ADD subscriptionId NVARCHAR(64) NULL');

    IF COL_LENGTH('dbo.CapacitySnapshot', 'subscriptionName') IS NULL
      EXEC('ALTER TABLE dbo.CapacitySnapshot ADD subscriptionName NVARCHAR(256) NULL');

    IF COL_LENGTH('dbo.CapacitySnapshot', 'sourceType') IS NULL
      EXEC('ALTER TABLE dbo.CapacitySnapshot ADD sourceType NVARCHAR(50) NOT NULL CONSTRAINT DF_CapacitySnapshot_SourceType DEFAULT ''live-azure-ingest''');

    IF COL_LENGTH('dbo.CapacitySnapshot', 'vCpu') IS NULL
      EXEC('ALTER TABLE dbo.CapacitySnapshot ADD vCpu INT NULL');

    IF COL_LENGTH('dbo.CapacitySnapshot', 'memoryGB') IS NULL
      EXEC('ALTER TABLE dbo.CapacitySnapshot ADD memoryGB DECIMAL(10,2) NULL');

    IF COL_LENGTH('dbo.CapacitySnapshot', 'zonesCsv') IS NULL
      EXEC('ALTER TABLE dbo.CapacitySnapshot ADD zonesCsv NVARCHAR(256) NULL');
  `;

  const viewScript = `
    CREATE OR ALTER VIEW dbo.CapacityLatest AS
    WITH Ranked AS (
      SELECT
        capturedAtUtc,
        sourceType,
        subscriptionKey,
        subscriptionId,
        subscriptionName,
        region,
        skuName,
        skuFamily,
        vCpu,
        memoryGB,
        zonesCsv,
        availabilityState,
        quotaCurrent,
        quotaLimit,
        monthlyCostEstimate,
        ROW_NUMBER() OVER (
          PARTITION BY ISNULL(subscriptionKey, 'legacy-data'), ISNULL(sourceType, 'live-azure-ingest'), region, skuName
          ORDER BY capturedAtUtc DESC
        ) AS rn
      FROM dbo.CapacitySnapshot
    )
    SELECT
      capturedAtUtc,
      sourceType,
      subscriptionKey,
      subscriptionId,
      subscriptionName,
      region,
      skuName,
      skuFamily,
      vCpu,
      memoryGB,
      zonesCsv,
      availabilityState,
      quotaCurrent,
      quotaLimit,
      monthlyCostEstimate
    FROM Ranked
    WHERE rn = 1;
  `;

  const updateScript = `
    UPDATE dbo.CapacitySnapshot
    SET
      subscriptionKey = ISNULL(subscriptionKey, 'legacy-data'),
      subscriptionId = ISNULL(subscriptionId, 'legacy-data'),
      subscriptionName = ISNULL(subscriptionName, 'Legacy data')
    WHERE subscriptionKey IS NULL OR subscriptionId IS NULL OR subscriptionName IS NULL;
  `;

  const aiSchemaScript = `
    IF OBJECT_ID('dbo.DashboardSetting', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.DashboardSetting (
        settingKey NVARCHAR(128) NOT NULL PRIMARY KEY,
        settingValue NVARCHAR(MAX) NOT NULL,
        updatedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END;

    IF OBJECT_ID('dbo.AIModelAvailability', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.AIModelAvailability (
        availabilityId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        capturedAtUtc DATETIME2 NOT NULL,
        subscriptionId NVARCHAR(64) NOT NULL,
        region NVARCHAR(64) NOT NULL,
        provider NVARCHAR(128) NOT NULL CONSTRAINT DF_AIModelAvailability_Provider DEFAULT ('Unknown'),
        modelName NVARCHAR(128) NOT NULL,
        modelVersion NVARCHAR(64) NULL,
        deploymentTypes NVARCHAR(512) NULL,
        finetuneCapable BIT NOT NULL CONSTRAINT DF_AIModelAvailability_FinetuneCapable DEFAULT ((0)),
        deprecationDate DATETIME2 NULL,
        skuName NVARCHAR(128) NULL,
        modelFormat NVARCHAR(64) NULL,
        isDefault BIT NOT NULL CONSTRAINT DF_AIModelAvailability_IsDefault DEFAULT ((0)),
        capabilities NVARCHAR(MAX) NULL
      );
    END;

    IF COL_LENGTH('dbo.AIModelAvailability', 'provider') IS NULL
    BEGIN
      ALTER TABLE dbo.AIModelAvailability ADD provider NVARCHAR(128) NULL;
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE name = 'IX_AIModelAvailability_Region_Model'
        AND object_id = OBJECT_ID('dbo.AIModelAvailability')
    )
    BEGIN
      CREATE NONCLUSTERED INDEX IX_AIModelAvailability_Region_Model
        ON dbo.AIModelAvailability(region, modelName, capturedAtUtc DESC);
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE name = 'IX_AIModelAvailability_CapturedAt'
        AND object_id = OBJECT_ID('dbo.AIModelAvailability')
    )
    BEGIN
      CREATE NONCLUSTERED INDEX IX_AIModelAvailability_CapturedAt
        ON dbo.AIModelAvailability(capturedAtUtc DESC);
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.DashboardSetting WHERE settingKey = 'schedule.aiModelCatalog.intervalMinutes')
    BEGIN
      INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
      VALUES ('schedule.aiModelCatalog.intervalMinutes', '1440', SYSUTCDATETIME());
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.DashboardSetting WHERE settingKey = 'ingest.openai.enabled')
    BEGIN
      INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
      VALUES ('ingest.openai.enabled', 'false', SYSUTCDATETIME());
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.DashboardSetting WHERE settingKey = 'ingest.ai.enabled')
    BEGIN
      INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
      VALUES (
        'ingest.ai.enabled',
        COALESCE((SELECT settingValue FROM dbo.DashboardSetting WHERE settingKey = 'ingest.openai.enabled'), 'false'),
        SYSUTCDATETIME()
      );
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.DashboardSetting WHERE settingKey = 'ingest.ai.providerQuota.enabled')
    BEGIN
      INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
      VALUES ('ingest.ai.providerQuota.enabled', 'false', SYSUTCDATETIME());
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.DashboardSetting WHERE settingKey = 'ingest.openai.modelCatalog.enabled')
    BEGIN
      INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
      VALUES ('ingest.openai.modelCatalog.enabled', 'true', SYSUTCDATETIME());
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.DashboardSetting WHERE settingKey = 'ingest.ai.modelCatalog.enabled')
    BEGIN
      INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
      VALUES (
        'ingest.ai.modelCatalog.enabled',
        COALESCE((SELECT settingValue FROM dbo.DashboardSetting WHERE settingKey = 'ingest.openai.modelCatalog.enabled'), 'true'),
        SYSUTCDATETIME()
      );
    END;
  `;

  const aiViewScript = `
    CREATE OR ALTER VIEW dbo.AIModelAvailabilityLatest AS
    WITH Ranked AS (
      SELECT
        capturedAtUtc,
        subscriptionId,
        region,
        provider,
        modelName,
        modelVersion,
        deploymentTypes,
        finetuneCapable,
        deprecationDate,
        skuName,
        modelFormat,
        isDefault,
        capabilities,
        ROW_NUMBER() OVER (
          PARTITION BY region, provider, modelName, modelVersion
          ORDER BY capturedAtUtc DESC
        ) AS rn
      FROM dbo.AIModelAvailability
    )
    SELECT
      capturedAtUtc,
      subscriptionId,
      region,
      provider,
      modelName,
      modelVersion,
      deploymentTypes,
      finetuneCapable,
      deprecationDate,
      skuName,
      modelFormat,
      isDefault,
      capabilities
    FROM Ranked
    WHERE rn = 1;
  `;

  const aiProviderMigrationScript = `
    UPDATE dbo.AIModelAvailability
    SET provider = CASE
      WHEN NULLIF(LTRIM(RTRIM(modelFormat)), '') IS NULL THEN 'OpenAI'
      WHEN LOWER(LTRIM(RTRIM(modelFormat))) IN ('openai', 'azureopenai') THEN 'OpenAI'
      ELSE LTRIM(RTRIM(modelFormat))
    END
    WHERE provider IS NULL OR LTRIM(RTRIM(provider)) = '';

    IF EXISTS (
      SELECT 1
      FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.AIModelAvailability')
        AND name = 'provider'
        AND is_nullable = 1
    )
    BEGIN
      -- Drop objects that depend on the provider column before altering it
      IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AIModelAvailability_Provider_Region_Model' AND object_id = OBJECT_ID('dbo.AIModelAvailability'))
        DROP INDEX IX_AIModelAvailability_Provider_Region_Model ON dbo.AIModelAvailability;

      DECLARE @providerDefaultConstraintName SYSNAME;
      SELECT @providerDefaultConstraintName = sys.default_constraints.name
      FROM sys.default_constraints
      INNER JOIN sys.columns
        ON sys.columns.object_id = sys.default_constraints.parent_object_id
       AND sys.columns.column_id = sys.default_constraints.parent_column_id
      WHERE sys.default_constraints.parent_object_id = OBJECT_ID('dbo.AIModelAvailability')
        AND sys.columns.name = 'provider';

      IF @providerDefaultConstraintName IS NOT NULL
      BEGIN
        DECLARE @dropProviderDefaultSql NVARCHAR(4000) =
          N'ALTER TABLE dbo.AIModelAvailability DROP CONSTRAINT ' + QUOTENAME(@providerDefaultConstraintName) + N';';
        EXEC sp_executesql @dropProviderDefaultSql;
      END

      ALTER TABLE dbo.AIModelAvailability ALTER COLUMN provider NVARCHAR(128) NOT NULL;

      ALTER TABLE dbo.AIModelAvailability
        ADD CONSTRAINT DF_AIModelAvailability_Provider DEFAULT ('Unknown') FOR provider;

      CREATE NONCLUSTERED INDEX IX_AIModelAvailability_Provider_Region_Model
        ON dbo.AIModelAvailability(provider, region, modelName, modelVersion, capturedAtUtc DESC);
    END
    ELSE
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM sys.default_constraints
        INNER JOIN sys.columns
          ON sys.columns.object_id = sys.default_constraints.parent_object_id
         AND sys.columns.column_id = sys.default_constraints.parent_column_id
        WHERE sys.default_constraints.parent_object_id = OBJECT_ID('dbo.AIModelAvailability')
          AND sys.columns.name = 'provider'
      )
        ALTER TABLE dbo.AIModelAvailability ADD CONSTRAINT DF_AIModelAvailability_Provider DEFAULT ('Unknown') FOR provider;

      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AIModelAvailability_Provider_Region_Model' AND object_id = OBJECT_ID('dbo.AIModelAvailability'))
        CREATE NONCLUSTERED INDEX IX_AIModelAvailability_Provider_Region_Model
          ON dbo.AIModelAvailability(provider, region, modelName, modelVersion, capturedAtUtc DESC);
    END;
  `;

  await pool.request().query(alterScript);
  await pool.request().query(updateScript);
  await ensureSubscriptionsTableSchema(pool);
  await ensureCapacityScoreSnapshotSchema(pool);
  await ensureLivePlacementSnapshotSchema(pool);
  await ensurePaaSAvailabilitySnapshotSchema(pool);
  await ensureDashboardErrorLogSchema(pool);
  await ensureDashboardOperationLogSchema(pool);
  await ensureVmSkuCatalogSchema(pool);
  await pool.request().query(viewScript);
  await pool.request().query(aiSchemaScript);
  await pool.request().query(aiProviderMigrationScript);
  await pool.request().query(aiViewScript);
  return { ok: true };
}

async function ensurePhase3Schema() {
  const pool = await getSqlPool();
  if (!pool) {
    throw new Error('SQL connection is not configured.');
  }

  return ensurePhase3SchemaForPool(pool);
}

module.exports = {
  getSqlPool,
  createSqlPoolWithAccessToken,
  insertCapacitySnapshots,
  upsertSubscriptions,
  getSubscriptionsFromTable,
  ensureSubscriptionsTableSchema,
  insertCapacityScoreSnapshots,
  insertQuotaCandidateSnapshots,
  getCapacityScoreSnapshotHistory,
  getQuotaCandidateSnapshots,
  listQuotaCandidateRuns,
  ensureLivePlacementSnapshotSchema,
  saveLivePlacementSnapshots,
  getLatestLivePlacementSnapshots,
  ensurePaaSAvailabilitySnapshotSchema,
  savePaaSAvailabilitySnapshots,
  getLatestPaaSAvailabilitySnapshots,
  ensureDashboardErrorLogSchema,
  insertDashboardErrorLog,
  listDashboardErrorLogs,
  ensureDashboardOperationLogSchema,
  logDashboardOperation,
  listDashboardOperations,
  ensureDashboardSettingSchema,
  getDashboardSettings,
  getDashboardSettingsPersistence,
  upsertDashboardSettings,
  ensurePhase3SchemaForPool,
  ensurePhase3Schema,
  ensureVmSkuCatalogSchema,
  upsertVmSkuCatalogRows,
  getVmSkuCatalogFamilies
};
