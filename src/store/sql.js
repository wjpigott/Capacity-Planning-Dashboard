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
      request.input('region', sql.NVarChar(64), row.region);
      request.input('skuName', sql.NVarChar(128), row.skuName);
      request.input('skuFamily', sql.NVarChar(128), row.skuFamily);
      request.input('availabilityState', sql.NVarChar(32), row.availabilityState);
      request.input('quotaCurrent', sql.Int, row.quotaCurrent);
      request.input('quotaLimit', sql.Int, row.quotaLimit);
      request.input('monthlyCostEstimate', sql.Decimal(18, 2), row.monthlyCostEstimate ?? null);

      await request.query(`
        INSERT INTO dbo.CapacitySnapshot
        (capturedAtUtc, sourceType, region, skuName, skuFamily, availabilityState, quotaCurrent, quotaLimit, monthlyCostEstimate)
        VALUES
        (@capturedAtUtc, @sourceType, @region, @skuName, @skuFamily, @availabilityState, @quotaCurrent, @quotaLimit, @monthlyCostEstimate)
      `);
    }

    await transaction.commit();
    return rows.length;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = { getSqlPool, insertCapacitySnapshots };
