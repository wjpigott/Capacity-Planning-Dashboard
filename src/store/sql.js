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
    return rows.length;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
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

async function ensurePhase3Schema() {
  const pool = await getSqlPool();
  if (!pool) {
    throw new Error('SQL connection is not configured.');
  }

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

module.exports = { getSqlPool, insertCapacitySnapshots, insertQuotaCandidateSnapshots, ensurePhase3Schema };
