const sql = require('mssql');
const { AzureCliCredential } = require('@azure/identity');

async function main() {
  const server = process.env.SQL_SERVER;
  const database = process.env.SQL_DATABASE;
  if (!server || !database) {
    throw new Error('Set SQL_SERVER and SQL_DATABASE before running this script.');
  }

  const credential = new AzureCliCredential();
  const token = (await credential.getToken('https://database.windows.net/.default')).token;

  const pool = await sql.connect({
    server,
    database,
    options: {
      encrypt: true,
      trustServerCertificate: false
    },
    authentication: {
      type: 'azure-active-directory-access-token',
      options: { token }
    }
  });

  await pool.request().query(`
    CREATE OR ALTER VIEW dbo.CapacityLatest AS
    WITH LatestCapture AS (
      SELECT MAX(capturedAtUtc) AS capturedAtUtc
      FROM dbo.CapacitySnapshot
    )
    SELECT
      snapshot.capturedAtUtc,
      snapshot.subscriptionKey,
      snapshot.subscriptionId,
      snapshot.subscriptionName,
      snapshot.region,
      snapshot.skuName,
      snapshot.skuFamily,
      snapshot.vCpu,
      snapshot.memoryGB,
      snapshot.zonesCsv,
      snapshot.availabilityState,
      snapshot.quotaCurrent,
      snapshot.quotaLimit,
      snapshot.monthlyCostEstimate
    FROM dbo.CapacitySnapshot AS snapshot
    INNER JOIN LatestCapture
      ON snapshot.capturedAtUtc = LatestCapture.capturedAtUtc;
  `);

  const result = await pool.request().query('SELECT COUNT(1) AS latestCount FROM dbo.CapacityLatest');
  console.log(JSON.stringify(result.recordset[0], null, 2));
  await pool.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});