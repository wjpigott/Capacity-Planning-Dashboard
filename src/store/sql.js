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

module.exports = { getSqlPool, insertCapacitySnapshots, ensurePhase3Schema };
