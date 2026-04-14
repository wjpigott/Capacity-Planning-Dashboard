const sql = require('mssql');

let cachedPool;

async function getSqlPool() {
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
  if (!useManagedIdentity && (!user || !password)) {
    return null;
  }

  if (cachedPool) {
    return cachedPool;
  }

  const config = {
    server,
    database,
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

  if (useManagedIdentity) {
    config.authentication = {
      type: 'azure-active-directory-msi-app-service',
      options: msiClientId ? { clientId: msiClientId } : {}
    };
  } else {
    config.user = user;
    config.password = password;
  }

  cachedPool = await sql.connect(config);
  return cachedPool;
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
      request.input('capturedAtUtc', sql.DateTime2, row.capturedAtUtc || new Date());
      request.input('sourceType', sql.NVarChar(50), row.sourceType || 'live-azure-ingest');
      request.input('subscriptionKey', sql.NVarChar(64), row.subscriptionKey || 'legacy-data');
      request.input('subscriptionId', sql.NVarChar(64), row.subscriptionId || 'legacy-data');
      request.input('subscriptionName', sql.NVarChar(256), row.subscriptionName || 'Legacy data');
      request.input('region', sql.NVarChar(64), row.region);
      request.input('skuName', sql.NVarChar(128), row.skuName);
      request.input('skuFamily', sql.NVarChar(128), row.skuFamily);
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
  const tableCheck = await pool.request().query(
    `SELECT 1 AS hasTable WHERE OBJECT_ID('dbo.Subscriptions', 'U') IS NOT NULL`
  );
  if (!tableCheck.recordset || tableCheck.recordset.length === 0) {
    return null; // caller falls back to CapacityLatest GROUP BY
  }

  const maxLimit = Math.max(10, Math.min(Number(limit || 500), 1000));
  const request = pool.request();
  request.input('limitRows', sql.Int, maxLimit);

  let query = `
    SELECT TOP (@limitRows)
      subscriptionId,
      subscriptionName,
      updatedAtUtc
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

  await ensureCapacityScoreSnapshotSchema(pool);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    for (const row of rows) {
      const request = new sql.Request(transaction);
      request.input('capturedAtUtc', sql.DateTime2, row.capturedAtUtc || new Date());
      request.input('region', sql.NVarChar(64), row.region);
      request.input('skuName', sql.NVarChar(128), row.sku);
      request.input('skuFamily', sql.NVarChar(128), row.family);
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

  await ensureCapacityScoreSnapshotSchema(pool);

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

async function ensureQuotaCandidateSnapshotSchema(pool) {
  const createScript = `
    IF OBJECT_ID('dbo.QuotaCandidateSnapshot', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.QuotaCandidateSnapshot (
        candidateId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        analysisRunId UNIQUEIDENTIFIER NOT NULL,
        capturedAtUtc DATETIME2 NOT NULL,
        sourceCapturedAtUtc DATETIME2 NULL,
        managementGroupId NVARCHAR(128) NOT NULL,
        groupQuotaName NVARCHAR(128) NOT NULL,
        subscriptionId NVARCHAR(64) NOT NULL,
        subscriptionName NVARCHAR(256) NOT NULL,
        region NVARCHAR(64) NOT NULL,
        quotaName NVARCHAR(128) NOT NULL,
        availabilityState NVARCHAR(32) NOT NULL,
        quotaCurrent INT NOT NULL,
        quotaLimit INT NOT NULL,
        quotaAvailable INT NOT NULL,
        suggestedMovable INT NOT NULL,
        safetyBuffer INT NOT NULL,
        subscriptionHash NVARCHAR(128) NOT NULL,
        candidateStatus NVARCHAR(32) NOT NULL
      )
    END;
  `;

  const alterStatements = [
    "IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'analysisRunId') IS NULL ALTER TABLE dbo.QuotaCandidateSnapshot ADD analysisRunId UNIQUEIDENTIFIER NULL;",
    "IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'sourceCapturedAtUtc') IS NULL ALTER TABLE dbo.QuotaCandidateSnapshot ADD sourceCapturedAtUtc DATETIME2 NULL;",
    "IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'managementGroupId') IS NULL ALTER TABLE dbo.QuotaCandidateSnapshot ADD managementGroupId NVARCHAR(128) NULL;",
    "IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'groupQuotaName') IS NULL ALTER TABLE dbo.QuotaCandidateSnapshot ADD groupQuotaName NVARCHAR(128) NULL;",
    "IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'subscriptionId') IS NULL ALTER TABLE dbo.QuotaCandidateSnapshot ADD subscriptionId NVARCHAR(64) NULL;",
    "IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'subscriptionName') IS NULL ALTER TABLE dbo.QuotaCandidateSnapshot ADD subscriptionName NVARCHAR(256) NULL;",
    "IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'availabilityState') IS NULL ALTER TABLE dbo.QuotaCandidateSnapshot ADD availabilityState NVARCHAR(32) NULL;",
    "IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'quotaCurrent') IS NULL ALTER TABLE dbo.QuotaCandidateSnapshot ADD quotaCurrent INT NULL;",
    "IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'quotaLimit') IS NULL ALTER TABLE dbo.QuotaCandidateSnapshot ADD quotaLimit INT NULL;",
    "IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'quotaAvailable') IS NULL ALTER TABLE dbo.QuotaCandidateSnapshot ADD quotaAvailable INT NULL;"
  ];

  const backfillScript = `
    UPDATE dbo.QuotaCandidateSnapshot
    SET
      analysisRunId = ISNULL(analysisRunId, NEWID()),
      managementGroupId = ISNULL(managementGroupId, 'legacy-mg'),
      groupQuotaName = ISNULL(groupQuotaName, 'legacy-quota-group'),
      subscriptionId = ISNULL(subscriptionId, subscriptionHash),
      subscriptionName = ISNULL(subscriptionName, subscriptionHash),
      availabilityState = ISNULL(availabilityState, 'Unknown'),
      quotaCurrent = ISNULL(quotaCurrent, 0),
      quotaLimit = ISNULL(quotaLimit, 0),
      quotaAvailable = ISNULL(quotaAvailable, 0)
    WHERE analysisRunId IS NULL
       OR managementGroupId IS NULL
       OR groupQuotaName IS NULL
       OR subscriptionId IS NULL
       OR subscriptionName IS NULL
       OR availabilityState IS NULL
       OR quotaCurrent IS NULL
       OR quotaLimit IS NULL
       OR quotaAvailable IS NULL;
  `;

  await pool.request().query(createScript);
  for (const statement of alterStatements) {
    await pool.request().query(statement);
  }
  await pool.request().query(backfillScript);
}

async function insertQuotaCandidateSnapshots(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const pool = await getSqlPool();
  if (!pool) {
    throw new Error('SQL connection is not configured for quota candidate capture.');
  }

  await ensureQuotaCandidateSnapshotSchema(pool);

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
        (analysisRunId, capturedAtUtc, sourceCapturedAtUtc, managementGroupId, groupQuotaName, subscriptionId, subscriptionName, region, quotaName, availabilityState, quotaCurrent, quotaLimit, quotaAvailable, suggestedMovable, safetyBuffer, subscriptionHash, candidateStatus)
        VALUES
        (@analysisRunId, @capturedAtUtc, @sourceCapturedAtUtc, @managementGroupId, @groupQuotaName, @subscriptionId, @subscriptionName, @region, @quotaName, @availabilityState, @quotaCurrent, @quotaLimit, @quotaAvailable, @suggestedMovable, @safetyBuffer, @subscriptionHash, @candidateStatus)
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

  await ensureQuotaCandidateSnapshotSchema(pool);

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

  await ensureQuotaCandidateSnapshotSchema(pool);

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
      COUNT(*) AS rowCount,
      COUNT(DISTINCT subscriptionId) AS subscriptionCount,
      SUM(CASE WHEN suggestedMovable > 0 THEN 1 ELSE 0 END) AS movableCandidateCount
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

async function ensurePhase3Schema() {
  const pool = await getSqlPool();
  if (!pool) {
    throw new Error('SQL connection is not configured.');
  }

  await ensureCapacityScoreSnapshotSchema(pool);

  const alterScript = `
    IF COL_LENGTH('dbo.CapacitySnapshot', 'subscriptionId') IS NULL
      EXEC('ALTER TABLE dbo.CapacitySnapshot ADD subscriptionId NVARCHAR(64) NULL');

    IF COL_LENGTH('dbo.CapacitySnapshot', 'subscriptionName') IS NULL
      EXEC('ALTER TABLE dbo.CapacitySnapshot ADD subscriptionName NVARCHAR(256) NULL');

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
          PARTITION BY ISNULL(subscriptionKey, 'legacy-data'), region, skuName
          ORDER BY capturedAtUtc DESC
        ) AS rn
      FROM dbo.CapacitySnapshot
    )
    SELECT
      capturedAtUtc,
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
      subscriptionId = ISNULL(subscriptionId, 'legacy-data'),
      subscriptionName = ISNULL(subscriptionName, 'Legacy data')
    WHERE subscriptionId IS NULL OR subscriptionName IS NULL;
  `;

  await pool.request().query(alterScript);
  await pool.request().query(viewScript);
  await pool.request().query(updateScript);
  return { ok: true };
}

module.exports = {
  getSqlPool,
  insertCapacitySnapshots,
  upsertSubscriptions,
  getSubscriptionsFromTable,
  insertCapacityScoreSnapshots,
  insertQuotaCandidateSnapshots,
  getCapacityScoreSnapshotHistory,
  getQuotaCandidateSnapshots,
  listQuotaCandidateRuns,
  ensurePhase3Schema
};
