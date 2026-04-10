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

module.exports = { getSqlPool };
