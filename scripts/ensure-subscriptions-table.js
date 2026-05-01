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
    IF OBJECT_ID('dbo.Subscriptions', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.Subscriptions (
        subscriptionId NVARCHAR(64) NOT NULL,
        subscriptionName NVARCHAR(256) NOT NULL,
        updatedAtUtc DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT PK_Subscriptions PRIMARY KEY (subscriptionId)
      );
    END;
  `);

  await pool.request().query(`
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
  `);

  const result = await pool.request().query('SELECT COUNT(1) AS subscriptionsCount FROM dbo.Subscriptions');
  console.log(JSON.stringify(result.recordset[0], null, 2));
  await pool.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});