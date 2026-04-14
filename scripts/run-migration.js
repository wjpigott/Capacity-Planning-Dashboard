#!/usr/bin/env node
/**
 * Migration Runner - Executes SQL migration files using the app's connection pool
 * Usage: node run-migration.js <pathToMigrationFile>
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

async function runMigration(migrationFilePath) {
  if (!migrationFilePath) {
    console.error('Usage: node run-migration.js <pathToMigrationFile>');
    process.exit(1);
  }

  if (!fs.existsSync(migrationFilePath)) {
    console.error(`Migration file not found: ${migrationFilePath}`);
    process.exit(1);
  }

  const server = process.env.SQL_SERVER || process.env.Sql__Server;
  const database = process.env.SQL_DATABASE || process.env.Sql__Database;
  const authMode = (process.env.SQL_AUTH_MODE || process.env.Sql__AuthMode || '').toLowerCase();
  const msiClientId = process.env.SQL_MSI_CLIENT_ID || process.env.Sql__MsiClientId;
  const user = process.env.SQL_USER;
  const password = process.env.SQL_PASSWORD;

  if (!server || !database) {
    console.error('SQL_SERVER and SQL_DATABASE environment variables are required.');
    console.error('Current values:', { server, database });
    process.exit(1);
  }

  console.log(`Connecting to ${server}/${database}...`);

  const useManagedIdentity = authMode === 'managed-identity' || authMode === 'msi';
  if (!useManagedIdentity && (!user || !password)) {
    console.error(
      'For SQL authentication, set SQL_USER and SQL_PASSWORD. For MSI, set SQL_AUTH_MODE=msi.'
    );
    process.exit(1);
  }

  const config = {
    server,
    database,
    options: {
      encrypt: true,
      trustServerCertificate: false
    },
    pool: {
      max: 1,
      min: 0,
      idleTimeoutMillis: 5000
    }
  };

  if (useManagedIdentity) {
    config.authentication = {
      type: 'azure-active-directory-msi-app-service',
      options: msiClientId ? { clientId: msiClientId } : {}
    };
    console.log('Using Azure Managed Identity for authentication...');
  } else {
    config.user = user;
    config.password = password;
    console.log(`Using SQL authentication as user: ${user}`);
  }

  let pool;
  try {
    pool = await sql.connect(config);
    console.log('✓ Connected to SQL Server');
  } catch (err) {
    console.error('✗ Failed to connect to SQL Server:', err.message);
    process.exit(1);
  }

  const migrationContent = fs.readFileSync(migrationFilePath, 'utf-8');
  console.log(`Executing migration from: ${path.basename(migrationFilePath)}`);

  try {
    const request = pool.request();
    await request.batch(migrationContent);
    console.log('✓ Migration executed successfully');
  } catch (err) {
    console.error('✗ Migration failed:', err.message);
    if (err.originalError) {
      console.error('  Details:', err.originalError.message);
    }
    process.exit(1);
  } finally {
    await pool.close();
  }
}

// Run if invoked directly
if (require.main === module) {
  const migrationFile = process.argv[2];
  runMigration(migrationFile).catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(1);
  });
}

module.exports = { runMigration };
