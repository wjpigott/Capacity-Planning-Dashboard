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

  const counts = await pool.request().query(`
    SELECT
      OBJECT_ID('dbo.CapacityLatest', 'V') AS capacityLatestObjectId,
      (SELECT COUNT(1) FROM dbo.CapacitySnapshot) AS snapshotCount,
      (SELECT COUNT(1) FROM dbo.CapacityLatest) AS latestCount,
      CASE WHEN OBJECT_ID('dbo.Subscriptions', 'U') IS NULL THEN CAST(0 AS BIT) ELSE CAST(1 AS BIT) END AS subscriptionsTableExists
  `);

  const summary = counts.recordset[0];
  let subscriptionsCount = 0;
  if (summary.subscriptionsTableExists) {
    const subscriptionCountResult = await pool.request().query('SELECT COUNT(1) AS subscriptionsCount FROM dbo.Subscriptions');
    subscriptionsCount = subscriptionCountResult.recordset[0].subscriptionsCount;
  }

  console.log(JSON.stringify({ ...summary, subscriptionsCount }, null, 2));

  const sample = await pool.request().query(`
    SELECT TOP 5
      subscriptionId,
      subscriptionName,
      region,
      skuName,
      skuFamily,
      capturedAtUtc
    FROM dbo.CapacityLatest
    ORDER BY capturedAtUtc DESC
  `);

  console.log(JSON.stringify(sample.recordset, null, 2));
  await pool.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});