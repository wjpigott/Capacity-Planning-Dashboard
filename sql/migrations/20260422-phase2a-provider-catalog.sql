-- Phase 2A provider-discovered Azure AI model catalog support
-- Keeps quota ingestion OpenAI-only while widening the catalog slice to provider-aware rows.

IF OBJECT_ID('dbo.DashboardSetting', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.DashboardSetting (
        settingKey NVARCHAR(128) NOT NULL PRIMARY KEY,
        settingValue NVARCHAR(MAX) NOT NULL,
        updatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_DashboardSetting_UpdatedAtUtc DEFAULT SYSUTCDATETIME()
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
        finetuneCapable BIT NOT NULL DEFAULT 0,
        deprecationDate DATETIME2 NULL,
        skuName NVARCHAR(128) NULL,
        modelFormat NVARCHAR(64) NULL,
        isDefault BIT NOT NULL DEFAULT 0,
        capabilities NVARCHAR(MAX) NULL
    );
END;
GO

IF COL_LENGTH('dbo.AIModelAvailability', 'provider') IS NULL
BEGIN
    ALTER TABLE dbo.AIModelAvailability
        ADD provider NVARCHAR(128) NOT NULL
            CONSTRAINT DF_AIModelAvailability_Provider DEFAULT ('Unknown') WITH VALUES;

    UPDATE dbo.AIModelAvailability
    SET provider = COALESCE(NULLIF(provider, ''), NULLIF(modelFormat, ''), 'OpenAI')
    WHERE provider IS NULL OR LTRIM(RTRIM(provider)) = '';
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
