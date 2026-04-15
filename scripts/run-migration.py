#!/usr/bin/env python3
"""
Migration Runner - Executes SQL migration files via Azure CLI authentication
"""

import sys
import os
import subprocess
import json

def get_connection_token():
    """Get an Azure authentication token via CLI"""
    try:
        result = subprocess.run(
            ['az', 'account', 'get-access-token', '--resource', 'https://database.windows.net'],
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode != 0:
            print(f"Failed to get token: {result.stderr}")
            return None
        token_data = json.loads(result.stdout)
        return token_data.get('accessToken')
    except Exception as e:
        print(f"Error getting token: {e}")
        return None

def run_migration(migration_file, server, database):
    """Execute migration using Token-based auth"""
    if not os.path.exists(migration_file):
        print(f"Migration file not found: {migration_file}")
        sys.exit(1)
    
    with open(migration_file, 'r') as f:
        sql_content = f.read()
    
    token = get_connection_token()
    if not token:
        print("Failed to obtain authentication token")
        sys.exit(1)
    
    print(f"Connecting to {server}/{database}...")
    
    try:
        import pyodbc
        
        # Build connection string using token
        conn_str = (
            f"Driver={{ODBC Driver 17 for SQL Server}};"
            f"Server=tcp:{server},1433;"
            f"Database={database};"
            f"Encrypt=yes;"
            f"TrustServerCertificate=no;"
            f"Connection Timeout=30"
        )
        
        conn = pyodbc.connect(conn_str, Authentication='ActiveDirectoryAccessToken', AccessToken=token)
        cursor = conn.cursor()
        
        print("✓ Connected to SQL Server")
        print(f"Executing migration from: {os.path.basename(migration_file)}")
        
        # Execute migration in batches (sqlcmd behavior)
        for statement in sql_content.split('GO'):
            statement = statement.strip()
            if statement:
                cursor.execute(statement)
                conn.commit()
        
        print("✓ Migration executed successfully")
        conn.close()
        
    except Exception as e:
        print(f"✗ Migration failed: {e}")
        sys.exit(1)

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Usage: python run-migration.py <migrationFile> <server> <database>")
        sys.exit(1)
    
    run_migration(sys.argv[1], sys.argv[2], sys.argv[3])
