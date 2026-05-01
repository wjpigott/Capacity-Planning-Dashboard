-- Manual repair script for existing environments.
-- Run as an Entra SQL admin or equivalent in SSMS against <sql-database-name>.
-- Purpose:
-- 1. Optionally grant the web app identity the database roles it needs.
-- 2. Apply the missing QuotaCandidateSnapshot expansion.
-- 3. Apply the current phase-3/runtime schema for AI and PaaS objects.
-- 4. Restore the current CapacityLatest / AIModelAvailabilityLatest views.
--
-- Notes:
-- - Replace __APP_IDENTITY_NAME__ with the target managed identity name to create
--   and grant database roles, or leave it unchanged to skip the identity setup.
-- - This script intentionally does NOT seed dbo.SchemaMigrationHistory because
--   the environment has no trustworthy historical migration record.
-- - CapacitySnapshot may still hash differently from dev after this repair if
--   the table was originally created with a different column order. That is a
--   historical artifact, not necessarily a functional mismatch.

SET NOCOUNT ON;

IF OBJECT_ID('tempdb..#RepairConfig') IS NOT NULL
    DROP TABLE #RepairConfig;

CREATE TABLE #RepairConfig (
    appIdentityName NVARCHAR(256) NULL
);

INSERT INTO #RepairConfig (appIdentityName)
VALUES (
    CASE
        WHEN N'__APP_IDENTITY_NAME__' = N'__APP_IDENTITY_NAME__' THEN NULL
        ELSE N'__APP_IDENTITY_NAME__'
    END
);
GO

-- 0. Grant the target app identity the rights it needs when specified.
DECLARE @appIdentityName NVARCHAR(256) = (SELECT TOP (1) appIdentityName FROM #RepairConfig);

IF @appIdentityName IS NOT NULL
AND NOT EXISTS (
    SELECT 1
    FROM sys.database_principals
    WHERE name = @appIdentityName
)
BEGIN
    DECLARE @createUserSql NVARCHAR(4000) = N'CREATE USER ' + QUOTENAME(@appIdentityName) + N' FROM EXTERNAL PROVIDER';
    EXEC sp_executesql @createUserSql;
END;
GO

DECLARE @appIdentityName NVARCHAR(256) = (SELECT TOP (1) appIdentityName FROM #RepairConfig);

IF @appIdentityName IS NOT NULL
AND NOT EXISTS (
    SELECT 1
    FROM sys.database_role_members AS roleMembers
    INNER JOIN sys.database_principals AS rolePrincipal
        ON rolePrincipal.principal_id = roleMembers.role_principal_id
    INNER JOIN sys.database_principals AS memberPrincipal
        ON memberPrincipal.principal_id = roleMembers.member_principal_id
    WHERE rolePrincipal.name = N'db_datareader'
      AND memberPrincipal.name = @appIdentityName
)
BEGIN
    DECLARE @grantReaderSql NVARCHAR(4000) = N'ALTER ROLE db_datareader ADD MEMBER ' + QUOTENAME(@appIdentityName);
    EXEC sp_executesql @grantReaderSql;
END;
GO

DECLARE @appIdentityName NVARCHAR(256) = (SELECT TOP (1) appIdentityName FROM #RepairConfig);

IF @appIdentityName IS NOT NULL
AND NOT EXISTS (
    SELECT 1
    FROM sys.database_role_members AS roleMembers
    INNER JOIN sys.database_principals AS rolePrincipal
        ON rolePrincipal.principal_id = roleMembers.role_principal_id
    INNER JOIN sys.database_principals AS memberPrincipal
        ON memberPrincipal.principal_id = roleMembers.member_principal_id
    WHERE rolePrincipal.name = N'db_datawriter'
      AND memberPrincipal.name = @appIdentityName
)
BEGIN
    DECLARE @grantWriterSql NVARCHAR(4000) = N'ALTER ROLE db_datawriter ADD MEMBER ' + QUOTENAME(@appIdentityName);
    EXEC sp_executesql @grantWriterSql;
END;
GO

DECLARE @appIdentityName NVARCHAR(256) = (SELECT TOP (1) appIdentityName FROM #RepairConfig);

IF @appIdentityName IS NOT NULL
AND NOT EXISTS (
    SELECT 1
    FROM sys.database_role_members AS roleMembers
    INNER JOIN sys.database_principals AS rolePrincipal
        ON rolePrincipal.principal_id = roleMembers.role_principal_id
    INNER JOIN sys.database_principals AS memberPrincipal
        ON memberPrincipal.principal_id = roleMembers.member_principal_id
    WHERE rolePrincipal.name = N'db_ddladmin'
      AND memberPrincipal.name = @appIdentityName
)
BEGIN
    DECLARE @grantDdlSql NVARCHAR(4000) = N'ALTER ROLE db_ddladmin ADD MEMBER ' + QUOTENAME(@appIdentityName);
    EXEC sp_executesql @grantDdlSql;
END;
GO

-- 1. Missing tracked migration: expand QuotaCandidateSnapshot.
IF OBJECT_ID('dbo.QuotaCandidateSnapshot', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.QuotaCandidateSnapshot (
        candidateId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        analysisRunId UNIQUEIDENTIFIER NOT NULL,
        capturedAtUtc DATETIME2 NOT NULL,
        sourceCapturedAtUtc DATETIME2 NULL,
        managementGroupId NVARCHAR(128) NOT NULL,
        groupQuotaName NVARCHAR(128) NOT NULL,
        subscriptionId NVARCHAR(64) NOT NULL,
        subscriptionName NVARCHAR(256) NOT NULL,
        region NVARCHAR(64) NOT NULL,
        quotaName NVARCHAR(128) NOT NULL,
        skuList NVARCHAR(MAX) NULL,
        skuCount INT NULL,
        availabilityState NVARCHAR(32) NOT NULL,
        quotaCurrent INT NOT NULL,
        quotaLimit INT NOT NULL,
        quotaAvailable INT NOT NULL,
        suggestedMovable INT NOT NULL,
        safetyBuffer INT NOT NULL,
        subscriptionHash NVARCHAR(128) NOT NULL,
        candidateStatus NVARCHAR(32) NOT NULL
    );
END;
GO

IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'analysisRunId') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD analysisRunId UNIQUEIDENTIFIER NULL');
GO
IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'sourceCapturedAtUtc') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD sourceCapturedAtUtc DATETIME2 NULL');
GO
IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'managementGroupId') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD managementGroupId NVARCHAR(128) NULL');
GO
IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'groupQuotaName') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD groupQuotaName NVARCHAR(128) NULL');
GO
IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'subscriptionId') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD subscriptionId NVARCHAR(64) NULL');
GO
IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'subscriptionName') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD subscriptionName NVARCHAR(256) NULL');
GO
IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'skuList') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD skuList NVARCHAR(MAX) NULL');
GO
IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'skuCount') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD skuCount INT NULL');
GO
IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'availabilityState') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD availabilityState NVARCHAR(32) NULL');
GO
IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'quotaCurrent') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD quotaCurrent INT NULL');
GO
IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'quotaLimit') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD quotaLimit INT NULL');
GO
IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'quotaAvailable') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD quotaAvailable INT NULL');
GO

UPDATE dbo.QuotaCandidateSnapshot
SET
    analysisRunId = ISNULL(analysisRunId, '00000000-0000-0000-0000-000000000000'),
    managementGroupId = ISNULL(managementGroupId, 'unknown'),
    groupQuotaName = ISNULL(groupQuotaName, 'unknown'),
    subscriptionId = ISNULL(subscriptionId, 'legacy-data'),
    subscriptionName = ISNULL(subscriptionName, 'Legacy data'),
    availabilityState = ISNULL(availabilityState, 'Unknown'),
    quotaCurrent = ISNULL(quotaCurrent, 0),
    quotaLimit = ISNULL(quotaLimit, 0),
    quotaAvailable = ISNULL(quotaAvailable, 0)
WHERE analysisRunId IS NULL
   OR managementGroupId IS NULL
   OR groupQuotaName IS NULL
   OR subscriptionId IS NULL
   OR subscriptionName IS NULL
   OR availabilityState IS NULL
   OR quotaCurrent IS NULL
   OR quotaLimit IS NULL
   OR quotaAvailable IS NULL;
GO

ALTER TABLE dbo.QuotaCandidateSnapshot ALTER COLUMN analysisRunId UNIQUEIDENTIFIER NOT NULL;
ALTER TABLE dbo.QuotaCandidateSnapshot ALTER COLUMN managementGroupId NVARCHAR(128) NOT NULL;
ALTER TABLE dbo.QuotaCandidateSnapshot ALTER COLUMN groupQuotaName NVARCHAR(128) NOT NULL;
ALTER TABLE dbo.QuotaCandidateSnapshot ALTER COLUMN subscriptionId NVARCHAR(64) NOT NULL;
ALTER TABLE dbo.QuotaCandidateSnapshot ALTER COLUMN subscriptionName NVARCHAR(256) NOT NULL;
ALTER TABLE dbo.QuotaCandidateSnapshot ALTER COLUMN availabilityState NVARCHAR(32) NOT NULL;
ALTER TABLE dbo.QuotaCandidateSnapshot ALTER COLUMN quotaCurrent INT NOT NULL;
ALTER TABLE dbo.QuotaCandidateSnapshot ALTER COLUMN quotaLimit INT NOT NULL;
ALTER TABLE dbo.QuotaCandidateSnapshot ALTER COLUMN quotaAvailable INT NOT NULL;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_QuotaCandidateSnapshot_RunScope'
      AND object_id = OBJECT_ID('dbo.QuotaCandidateSnapshot')
)
BEGIN
    CREATE INDEX IX_QuotaCandidateSnapshot_RunScope
        ON dbo.QuotaCandidateSnapshot (capturedAtUtc DESC, managementGroupId, groupQuotaName, subscriptionId);
END;
GO

-- 2. Current CapacitySnapshot view shape used by the app.
IF COL_LENGTH('dbo.CapacitySnapshot', 'subscriptionKey') IS NULL
    EXEC('ALTER TABLE dbo.CapacitySnapshot ADD subscriptionKey NVARCHAR(64) NULL');
GO
IF COL_LENGTH('dbo.CapacitySnapshot', 'subscriptionId') IS NULL
    EXEC('ALTER TABLE dbo.CapacitySnapshot ADD subscriptionId NVARCHAR(64) NULL');
GO
IF COL_LENGTH('dbo.CapacitySnapshot', 'subscriptionName') IS NULL
    EXEC('ALTER TABLE dbo.CapacitySnapshot ADD subscriptionName NVARCHAR(256) NULL');
GO
IF COL_LENGTH('dbo.CapacitySnapshot', 'sourceType') IS NULL
    EXEC('ALTER TABLE dbo.CapacitySnapshot ADD sourceType NVARCHAR(50) NOT NULL CONSTRAINT DF_CapacitySnapshot_SourceType DEFAULT ''live-azure-ingest''');
GO
IF COL_LENGTH('dbo.CapacitySnapshot', 'vCpu') IS NULL
    EXEC('ALTER TABLE dbo.CapacitySnapshot ADD vCpu INT NULL');
GO
IF COL_LENGTH('dbo.CapacitySnapshot', 'memoryGB') IS NULL
    EXEC('ALTER TABLE dbo.CapacitySnapshot ADD memoryGB DECIMAL(10,2) NULL');
GO
IF COL_LENGTH('dbo.CapacitySnapshot', 'zonesCsv') IS NULL
    EXEC('ALTER TABLE dbo.CapacitySnapshot ADD zonesCsv NVARCHAR(256) NULL');
GO

UPDATE dbo.CapacitySnapshot
SET
    subscriptionKey = ISNULL(subscriptionKey, 'legacy-data'),
    subscriptionId = ISNULL(subscriptionId, 'legacy-data'),
    subscriptionName = ISNULL(subscriptionName, 'Legacy data')
WHERE subscriptionKey IS NULL OR subscriptionId IS NULL OR subscriptionName IS NULL;
GO

CREATE OR ALTER VIEW dbo.CapacityLatest AS
WITH Ranked AS (
    SELECT
        capturedAtUtc,
        sourceType,
        subscriptionKey,
        subscriptionId,
        subscriptionName,
        region,
        skuName,
        skuFamily,
        vCpu,
        memoryGB,
        zonesCsv,
        availabilityState,
        quotaCurrent,
        quotaLimit,
        monthlyCostEstimate,
        ROW_NUMBER() OVER (
            PARTITION BY ISNULL(subscriptionKey, 'legacy-data'), ISNULL(sourceType, 'live-azure-ingest'), region, skuName
            ORDER BY capturedAtUtc DESC
        ) AS rn
    FROM dbo.CapacitySnapshot
)
SELECT
    capturedAtUtc,
    sourceType,
    subscriptionKey,
    subscriptionId,
    subscriptionName,
    region,
    skuName,
    skuFamily,
    vCpu,
    memoryGB,
    zonesCsv,
    availabilityState,
    quotaCurrent,
    quotaLimit,
    monthlyCostEstimate
FROM Ranked
WHERE rn = 1;
GO

-- 3. Supporting phase-3 tables and indexes.
IF OBJECT_ID('dbo.PaaSAvailabilitySnapshot', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PaaSAvailabilitySnapshot (
        paasAvailabilitySnapshotId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        runId UNIQUEIDENTIFIER NOT NULL,
        capturedAtUtc DATETIME2 NOT NULL,
        requestedService NVARCHAR(64) NOT NULL,
        requestedRegionPreset NVARCHAR(64) NULL,
        requestedRegionsJson NVARCHAR(MAX) NULL,
        metadataJson NVARCHAR(MAX) NULL,
        category NVARCHAR(64) NOT NULL,
        service NVARCHAR(64) NOT NULL,
        region NVARCHAR(64) NOT NULL,
        resourceType NVARCHAR(64) NULL,
        name NVARCHAR(256) NOT NULL,
        displayName NVARCHAR(256) NULL,
        edition NVARCHAR(128) NULL,
        tier NVARCHAR(256) NULL,
        family NVARCHAR(128) NULL,
        status NVARCHAR(64) NULL,
        available BIT NULL,
        zoneRedundant BIT NULL,
        quotaCurrent INT NULL,
        quotaLimit INT NULL,
        metricPrimary NVARCHAR(256) NULL,
        metricSecondary NVARCHAR(256) NULL,
        detailsJson NVARCHAR(MAX) NULL
    );
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_PaaSAvailabilitySnapshot_ServiceCaptured'
      AND object_id = OBJECT_ID('dbo.PaaSAvailabilitySnapshot')
)
BEGIN
    CREATE INDEX IX_PaaSAvailabilitySnapshot_ServiceCaptured
        ON dbo.PaaSAvailabilitySnapshot (requestedService, capturedAtUtc DESC, service, region);
END;
GO

IF OBJECT_ID('dbo.DashboardSetting', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.DashboardSetting (
        settingKey NVARCHAR(128) NOT NULL PRIMARY KEY,
        settingValue NVARCHAR(MAX) NOT NULL,
        updatedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF OBJECT_ID('dbo.AIModelAvailability', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AIModelAvailability (
        availabilityId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        capturedAtUtc DATETIME2 NOT NULL,
        subscriptionId NVARCHAR(64) NOT NULL,
        region NVARCHAR(64) NOT NULL,
        provider NVARCHAR(128) NOT NULL CONSTRAINT DF_AIModelAvailability_Provider DEFAULT ('Unknown'),
        modelName NVARCHAR(128) NOT NULL,
        modelVersion NVARCHAR(64) NULL,
        deploymentTypes NVARCHAR(512) NULL,
        finetuneCapable BIT NOT NULL CONSTRAINT DF_AIModelAvailability_FinetuneCapable DEFAULT ((0)),
        deprecationDate DATETIME2 NULL,
        skuName NVARCHAR(128) NULL,
        modelFormat NVARCHAR(64) NULL,
        isDefault BIT NOT NULL CONSTRAINT DF_AIModelAvailability_IsDefault DEFAULT ((0)),
        capabilities NVARCHAR(MAX) NULL
    );
END;
GO

IF COL_LENGTH('dbo.AIModelAvailability', 'provider') IS NULL
BEGIN
    ALTER TABLE dbo.AIModelAvailability ADD provider NVARCHAR(128) NULL;
END;
GO

UPDATE dbo.AIModelAvailability
SET provider = CASE
    WHEN NULLIF(LTRIM(RTRIM(modelFormat)), '') IS NULL THEN 'OpenAI'
    WHEN LOWER(LTRIM(RTRIM(modelFormat))) IN ('openai', 'azureopenai') THEN 'OpenAI'
    ELSE LTRIM(RTRIM(modelFormat))
END
WHERE provider IS NULL OR LTRIM(RTRIM(provider)) = '';
GO

IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.AIModelAvailability')
      AND name = 'provider'
      AND is_nullable = 1
)
BEGIN
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AIModelAvailability_Provider_Region_Model' AND object_id = OBJECT_ID('dbo.AIModelAvailability'))
        DROP INDEX IX_AIModelAvailability_Provider_Region_Model ON dbo.AIModelAvailability;

    DECLARE @providerDefaultConstraintName SYSNAME;
    SELECT @providerDefaultConstraintName = dc.name
    FROM sys.default_constraints AS dc
    INNER JOIN sys.columns AS c
        ON c.object_id = dc.parent_object_id
       AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.AIModelAvailability')
      AND c.name = 'provider';

    IF @providerDefaultConstraintName IS NOT NULL
    BEGIN
        DECLARE @dropProviderDefaultSql NVARCHAR(4000) =
            N'ALTER TABLE dbo.AIModelAvailability DROP CONSTRAINT ' + QUOTENAME(@providerDefaultConstraintName) + N';';
        EXEC sp_executesql @dropProviderDefaultSql;
    END;

    ALTER TABLE dbo.AIModelAvailability ALTER COLUMN provider NVARCHAR(128) NOT NULL;
    ALTER TABLE dbo.AIModelAvailability ADD CONSTRAINT DF_AIModelAvailability_Provider DEFAULT ('Unknown') FOR provider;
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_AIModelAvailability_Region_Model'
      AND object_id = OBJECT_ID('dbo.AIModelAvailability')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_AIModelAvailability_Region_Model
        ON dbo.AIModelAvailability(region, modelName, capturedAtUtc DESC);
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_AIModelAvailability_CapturedAt'
      AND object_id = OBJECT_ID('dbo.AIModelAvailability')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_AIModelAvailability_CapturedAt
        ON dbo.AIModelAvailability(capturedAtUtc DESC);
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_AIModelAvailability_Provider_Region_Model'
      AND object_id = OBJECT_ID('dbo.AIModelAvailability')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_AIModelAvailability_Provider_Region_Model
        ON dbo.AIModelAvailability(provider, region, modelName, modelVersion, capturedAtUtc DESC);
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.DashboardSetting WHERE settingKey = 'schedule.aiModelCatalog.intervalMinutes')
BEGIN
    INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
    VALUES ('schedule.aiModelCatalog.intervalMinutes', '1440', SYSUTCDATETIME());
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.DashboardSetting WHERE settingKey = 'ingest.openai.enabled')
BEGIN
    INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
    VALUES ('ingest.openai.enabled', 'false', SYSUTCDATETIME());
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.DashboardSetting WHERE settingKey = 'ingest.ai.enabled')
BEGIN
    INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
    VALUES (
        'ingest.ai.enabled',
        COALESCE((SELECT settingValue FROM dbo.DashboardSetting WHERE settingKey = 'ingest.openai.enabled'), 'false'),
        SYSUTCDATETIME()
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.DashboardSetting WHERE settingKey = 'ingest.ai.providerQuota.enabled')
BEGIN
    INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
    VALUES ('ingest.ai.providerQuota.enabled', 'false', SYSUTCDATETIME());
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.DashboardSetting WHERE settingKey = 'ingest.openai.modelCatalog.enabled')
BEGIN
    INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
    VALUES ('ingest.openai.modelCatalog.enabled', 'true', SYSUTCDATETIME());
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.DashboardSetting WHERE settingKey = 'ingest.ai.modelCatalog.enabled')
BEGIN
    INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
    VALUES (
        'ingest.ai.modelCatalog.enabled',
        COALESCE((SELECT settingValue FROM dbo.DashboardSetting WHERE settingKey = 'ingest.openai.modelCatalog.enabled'), 'true'),
        SYSUTCDATETIME()
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.DashboardSetting WHERE settingKey = 'ui.showSqlPreview')
BEGIN
    INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
    VALUES ('ui.showSqlPreview', 'true', SYSUTCDATETIME());
END;
GO

CREATE OR ALTER VIEW dbo.AIModelAvailabilityLatest AS
WITH Ranked AS (
    SELECT
        capturedAtUtc,
        subscriptionId,
        region,
        provider,
        modelName,
        modelVersion,
        deploymentTypes,
        finetuneCapable,
        deprecationDate,
        skuName,
        modelFormat,
        isDefault,
        capabilities,
        ROW_NUMBER() OVER (
            PARTITION BY region, provider, modelName, modelVersion
            ORDER BY capturedAtUtc DESC
        ) AS rn
    FROM dbo.AIModelAvailability
)
SELECT
    capturedAtUtc,
    subscriptionId,
    region,
    provider,
    modelName,
    modelVersion,
    deploymentTypes,
    finetuneCapable,
    deprecationDate,
    skuName,
    modelFormat,
    isDefault,
    capabilities
FROM Ranked
WHERE rn = 1;
GO

-- 4. Backfill/create current helper tables if missing.
IF OBJECT_ID('dbo.Subscriptions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Subscriptions (
        subscriptionId NVARCHAR(64) NOT NULL,
        subscriptionName NVARCHAR(256) NOT NULL,
        updatedAtUtc DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT PK_Subscriptions PRIMARY KEY (subscriptionId)
    );
END;
GO

MERGE dbo.Subscriptions AS tgt
USING (
    SELECT subscriptionId, subscriptionName, updatedAtUtc
    FROM (
        SELECT
            ISNULL(subscriptionId, 'legacy-data') AS subscriptionId,
            ISNULL(subscriptionName, 'Legacy data') AS subscriptionName,
            capturedAtUtc AS updatedAtUtc,
            ROW_NUMBER() OVER (
                PARTITION BY ISNULL(subscriptionId, 'legacy-data')
                ORDER BY capturedAtUtc DESC, ISNULL(subscriptionName, 'Legacy data') DESC
            ) AS rowNumber
        FROM dbo.CapacitySnapshot
        WHERE subscriptionId IS NOT NULL
          AND subscriptionId <> 'legacy-data'
    ) AS ranked
    WHERE rowNumber = 1
) AS src
ON tgt.subscriptionId = src.subscriptionId
WHEN MATCHED THEN
    UPDATE SET subscriptionName = src.subscriptionName,
               updatedAtUtc = src.updatedAtUtc
WHEN NOT MATCHED THEN
    INSERT (subscriptionId, subscriptionName, updatedAtUtc)
    VALUES (src.subscriptionId, src.subscriptionName, src.updatedAtUtc);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CapacitySnapshot_RegionFamilyAvailability' AND object_id = OBJECT_ID('dbo.CapacitySnapshot'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_CapacitySnapshot_RegionFamilyAvailability
    ON dbo.CapacitySnapshot (region, skuFamily, availabilityState)
    INCLUDE (capturedAtUtc, subscriptionId, subscriptionName, skuName, quotaCurrent, quotaLimit, vCpu, memoryGB, zonesCsv, subscriptionKey)
    WITH (FILLFACTOR = 90);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CapacitySnapshot_CapturedAtDesc' AND object_id = OBJECT_ID('dbo.CapacitySnapshot'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_CapacitySnapshot_CapturedAtDesc
    ON dbo.CapacitySnapshot (capturedAtUtc DESC)
    INCLUDE (region, skuFamily, skuName, subscriptionId, subscriptionName, quotaCurrent, quotaLimit)
    WITH (FILLFACTOR = 90);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CapacitySnapshot_SubscriptionId' AND object_id = OBJECT_ID('dbo.CapacitySnapshot'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_CapacitySnapshot_SubscriptionId
    ON dbo.CapacitySnapshot (subscriptionId)
    INCLUDE (region, skuFamily, skuName, availabilityState, quotaCurrent, quotaLimit, capturedAtUtc)
    WITH (FILLFACTOR = 90);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CapacitySnapshot_FamilyRegion' AND object_id = OBJECT_ID('dbo.CapacitySnapshot'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_CapacitySnapshot_FamilyRegion
    ON dbo.CapacitySnapshot (skuFamily, region)
    INCLUDE (quotaCurrent, quotaLimit, subscriptionId, subscriptionName, capturedAtUtc)
    WITH (FILLFACTOR = 90);
END;
GO

IF OBJECT_ID('dbo.CapacityScoreSnapshot', 'U') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CapacityScoreSnapshot_RegionSku' AND object_id = OBJECT_ID('dbo.CapacityScoreSnapshot'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_CapacityScoreSnapshot_RegionSku
    ON dbo.CapacityScoreSnapshot (region, skuFamily, skuName)
    INCLUDE (capturedAtUtc, score, reason, utilizationPct)
    WITH (FILLFACTOR = 90);
END;
GO

IF OBJECT_ID('tempdb..#RepairConfig') IS NOT NULL
    DROP TABLE #RepairConfig;
GO

PRINT 'Test manual repair completed. Rerun Query 1, Query 2, Query 3, Query 4, and Query 5 against the target SQL database.';