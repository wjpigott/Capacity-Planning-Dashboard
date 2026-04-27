-- Run each query separately in SSMS.
-- Start with Query 0 every time to confirm you are connected to the intended server/database.

-- Query 0: Connection check
SELECT
    DB_NAME() AS database_name,
    @@SERVERNAME AS server_name,
    SYSDATETIMEOFFSET() AS captured_at;


-- Query 1: Table schema hashes
WITH column_inventory AS (
    SELECT
        schema_name = s.name,
        table_name = t.name,
        column_id = c.column_id,
        column_name = c.name,
        data_type = ty.name,
        max_length = c.max_length,
        precision_value = c.precision,
        scale_value = c.scale,
        is_nullable = c.is_nullable,
        is_identity = c.is_identity,
        is_computed = c.is_computed,
        collation_name = c.collation_name,
        default_definition = ISNULL(dc.definition, ''),
        computed_definition = ISNULL(cc.definition, '')
    FROM sys.tables AS t
    INNER JOIN sys.schemas AS s
        ON s.schema_id = t.schema_id
    INNER JOIN sys.columns AS c
        ON c.object_id = t.object_id
    INNER JOIN sys.types AS ty
        ON ty.user_type_id = c.user_type_id
    LEFT JOIN sys.default_constraints AS dc
        ON dc.parent_object_id = c.object_id
       AND dc.parent_column_id = c.column_id
    LEFT JOIN sys.computed_columns AS cc
        ON cc.object_id = c.object_id
       AND cc.column_id = c.column_id
    WHERE t.is_ms_shipped = 0
)
SELECT
    database_name = DB_NAME(),
    schema_name,
    table_name,
    column_count = COUNT(*),
    schema_hash = CONVERT(varchar(64), HASHBYTES('SHA2_256', STRING_AGG(CONCAT(
        column_id, ':',
        column_name, ':',
        data_type, ':',
        max_length, ':',
        precision_value, ':',
        scale_value, ':',
        is_nullable, ':',
        is_identity, ':',
        is_computed, ':',
        ISNULL(collation_name, ''), ':',
        default_definition, ':',
        computed_definition
    ), '|') WITHIN GROUP (ORDER BY column_id)), 2)
FROM column_inventory
GROUP BY schema_name, table_name
ORDER BY schema_name, table_name;


-- Query 2: Index hashes
WITH index_columns AS (
    SELECT
        schema_name = s.name,
        table_name = t.name,
        index_name = i.name,
        index_type = i.type_desc,
        is_unique = i.is_unique,
        is_primary_key = i.is_primary_key,
        has_filter = i.has_filter,
        filter_definition = ISNULL(i.filter_definition, ''),
        key_ordinal = ic.key_ordinal,
        is_included_column = ic.is_included_column,
        column_name = c.name,
        is_descending_key = ic.is_descending_key
    FROM sys.tables AS t
    INNER JOIN sys.schemas AS s
        ON s.schema_id = t.schema_id
    INNER JOIN sys.indexes AS i
        ON i.object_id = t.object_id
    INNER JOIN sys.index_columns AS ic
        ON ic.object_id = i.object_id
       AND ic.index_id = i.index_id
    INNER JOIN sys.columns AS c
        ON c.object_id = ic.object_id
       AND c.column_id = ic.column_id
    WHERE t.is_ms_shipped = 0
      AND i.type > 0
      AND i.is_hypothetical = 0
),
index_base AS (
    SELECT
        schema_name,
        table_name,
        index_name,
        index_type,
        is_unique,
        is_primary_key,
        has_filter,
        filter_definition
    FROM index_columns
    GROUP BY schema_name, table_name, index_name, index_type, is_unique, is_primary_key, has_filter, filter_definition
),
index_key_columns AS (
    SELECT
        schema_name,
        table_name,
        index_name,
        key_columns = STRING_AGG(
            CONCAT(column_name, CASE WHEN is_descending_key = 1 THEN ' DESC' ELSE ' ASC' END),
            ', '
        ) WITHIN GROUP (ORDER BY key_ordinal)
    FROM index_columns
    WHERE is_included_column = 0
    GROUP BY schema_name, table_name, index_name
),
index_include_columns AS (
    SELECT
        schema_name,
        table_name,
        index_name,
        include_columns = STRING_AGG(column_name, ', ') WITHIN GROUP (ORDER BY column_name)
    FROM index_columns
    WHERE is_included_column = 1
    GROUP BY schema_name, table_name, index_name
)
SELECT
    database_name = DB_NAME(),
    b.schema_name,
    b.table_name,
    b.index_name,
    b.index_type,
    b.is_unique,
    b.is_primary_key,
    b.has_filter,
    b.filter_definition,
    kc.key_columns,
    ic.include_columns,
    index_hash = CONVERT(varchar(64), HASHBYTES('SHA2_256', CONCAT(
        b.schema_name, ':', b.table_name, ':', b.index_name, ':', b.index_type, ':',
        b.is_unique, ':', b.is_primary_key, ':', b.has_filter, ':', b.filter_definition, ':',
        ISNULL(kc.key_columns, ''), ':', ISNULL(ic.include_columns, '')
    )), 2)
FROM index_base AS b
LEFT JOIN index_key_columns AS kc
    ON kc.schema_name = b.schema_name
   AND kc.table_name = b.table_name
   AND kc.index_name = b.index_name
LEFT JOIN index_include_columns AS ic
    ON ic.schema_name = b.schema_name
   AND ic.table_name = b.table_name
   AND ic.index_name = b.index_name
ORDER BY b.schema_name, b.table_name, b.index_name;


-- Query 3: View hashes
SELECT
    database_name = DB_NAME(),
    schema_name = s.name,
    view_name = v.name,
    definition_hash = CONVERT(varchar(64), HASHBYTES('SHA2_256', sm.definition), 2)
FROM sys.views AS v
INNER JOIN sys.schemas AS s
    ON s.schema_id = v.schema_id
INNER JOIN sys.sql_modules AS sm
    ON sm.object_id = v.object_id
WHERE v.is_ms_shipped = 0
ORDER BY schema_name, view_name;


-- Query 4: Migration history
IF OBJECT_ID('dbo.SchemaMigrationHistory', 'U') IS NOT NULL
BEGIN
    SELECT
        database_name = DB_NAME(),
        migrationName,
        appliedAtUtc
    FROM dbo.SchemaMigrationHistory
    ORDER BY migrationName;
END
ELSE
BEGIN
    SELECT
        database_name = DB_NAME(),
        message = 'dbo.SchemaMigrationHistory does not exist';
END;


-- Query 5: Dashboard settings
IF OBJECT_ID('dbo.DashboardSetting', 'U') IS NOT NULL
BEGIN
    SELECT
        database_name = DB_NAME(),
        settingKey,
        settingValue,
        updatedAtUtc
    FROM dbo.DashboardSetting
    ORDER BY settingKey;
END
ELSE
BEGIN
    SELECT
        database_name = DB_NAME(),
        message = 'dbo.DashboardSetting does not exist';
END;


-- Query 6: Column inventory for one table
-- Replace dbo.YourTableName before running.
SELECT
    database_name = DB_NAME(),
    schema_name = s.name,
    table_name = t.name,
    column_id = c.column_id,
    column_name = c.name,
    data_type = ty.name,
    max_length = c.max_length,
    precision_value = c.precision,
    scale_value = c.scale,
    is_nullable = c.is_nullable,
    is_identity = c.is_identity,
    is_computed = c.is_computed,
    collation_name = c.collation_name,
    default_definition = ISNULL(dc.definition, ''),
    computed_definition = ISNULL(cc.definition, '')
FROM sys.tables AS t
INNER JOIN sys.schemas AS s
    ON s.schema_id = t.schema_id
INNER JOIN sys.columns AS c
    ON c.object_id = t.object_id
INNER JOIN sys.types AS ty
    ON ty.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints AS dc
    ON dc.parent_object_id = c.object_id
   AND dc.parent_column_id = c.column_id
LEFT JOIN sys.computed_columns AS cc
    ON cc.object_id = c.object_id
   AND cc.column_id = c.column_id
WHERE s.name = 'dbo'
  AND t.name = 'YourTableName'
ORDER BY c.column_id;