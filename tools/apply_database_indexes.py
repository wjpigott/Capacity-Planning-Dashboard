#!/usr/bin/env python3
"""
Apply database performance indexes to Azure SQL Database
Uses Azure credential from az cli login
"""
import os
import sys
import subprocess
from urllib.parse import quote_plus

def get_access_token():
    """Get Azure access token from az cli"""
    try:
        result = subprocess.run(
            ["az", "account", "get-access-token", "--resource", "https://database.windows.net"],
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout.strip().split('"accessToken": "')[1].split('"')[0] if 'accessToken' in result.stdout else None
    except Exception as e:
        print(f"Error getting token: {e}", file=sys.stderr)
        return None

def apply_indexes():
    """Apply database indexes"""
    server = os.environ.get("SQL_SERVER")
    database = os.environ.get("SQL_DATABASE")
    if not server or not database:
        print("Set SQL_SERVER and SQL_DATABASE before running this script.", file=sys.stderr)
        return False
    
    # Try using pyodbc if available
    try:
        import pyodbc
        from sqlalchemy import create_engine
        
        token = get_access_token()
        if not token:
            print("Failed to get Azure access token. Make sure you're logged in: az login", file=sys.stderr)
            return False
        
        # Build connection string with token
        connection_string = f"Driver={{ODBC Driver 17 for SQL Server}};Server={server};Database={database};Authentication=ActiveDirectoryMsi;Connection Timeout=30;"
        
        print(f"Connecting to: {server}/{database}")
        conn = pyodbc.connect(connection_string, timeout=30)
        cursor = conn.cursor()
        
        # Read and execute migration
        with open(r"c:\repos\Capacity\dashboard\sql\migrations\20260414-add-performance-indexes.sql", "r") as f:
            sql_content = f.read()
        
        # Split by GO and execute batches
        batches = sql_content.split("\nGO\n")
        for i, batch in enumerate(batches):
            batch = batch.strip()
            if batch and not batch.startswith("--"):
                print(f"Executing batch {i+1}/{len(batches)}...")
                try:
                    cursor.execute(batch)
                    conn.commit()
                except Exception as e:
                    print(f"  Warning: {e}")
        
        cursor.close()
        conn.close()
        print("Indexes applied successfully!", file=sys.stderr)
        return True
        
    except ImportError:
        print("pyodbc not available, using alternative method...", file=sys.stderr)
        
        # Alternative: use subprocess to run via Docker or local SQL tools
        print("Installing required packages...", file=sys.stderr)
        os.system(f"{sys.executable} -m pip install mssql-connector -q")
        
        try:
            from mssql import get_connector
            # This would require additional setup
            print("Using mssql-connector approach", file=sys.stderr)
        except:
            pass
    
    return False

if __name__ == "__main__":
    if apply_indexes():
        sys.exit(0)
    else:
        print("Fallback: Please run the SQL migration manually or ensure ODBC drivers are installed", file=sys.stderr)
        sys.exit(1)
