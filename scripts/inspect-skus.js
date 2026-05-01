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
    options: { encrypt: true, trustServerCertificate: false },
    authentication: { type: 'azure-active-directory-access-token', options: { token } }
  });

  const tables = await pool.request().query(`
    SELECT t.name AS tableName, c.name AS columnName
    FROM sys.tables t
    JOIN sys.columns c ON c.object_id = t.object_id
    WHERE c.name LIKE '%sku%' OR c.name LIKE '%SKU%' OR c.name LIKE '%family%'
    ORDER BY t.name, c.column_id
  `);
  console.log('=== Tables with sku/family columns ===');
  console.log(JSON.stringify(tables.recordset, null, 2));

  const familyCounts = await pool.request().query(`
    SELECT skuFamily, COUNT(DISTINCT skuName) AS skuCount
    FROM dbo.CapacitySnapshot
    GROUP BY skuFamily
    ORDER BY skuFamily
  `);
  console.log('=== Distinct SKUs per family in CapacitySnapshot ===');
  console.log(JSON.stringify(familyCounts.recordset, null, 2));

  const dsSiblings = await pool.request().query(`
    SELECT DISTINCT skuFamily, skuName
    FROM dbo.CapacitySnapshot
    WHERE skuFamily LIKE '%DS%' OR skuName LIKE '%DS%' OR skuName LIKE '%_v6'
    ORDER BY skuFamily, skuName
  `);
  console.log('=== DS / v6 SKUs in CapacitySnapshot ===');
  console.log(JSON.stringify(dsSiblings.recordset, null, 2));

  await pool.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
