-- Azure AI Model Availability Table
-- Stores Azure OpenAI model catalog: which models are available in which regions,
-- their deployment types, fine-tuning capability, and version info.
-- Refreshed on a separate, slower cadence than quota ingestion.

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

-- Add AI-specific dashboard settings if not present
-- Model catalog refresh cadence (in minutes)
IF NOT EXISTS (SELECT 1 FROM dbo.DashboardSetting WHERE settingKey = 'schedule.aiModelCatalog.intervalMinutes')
BEGIN
    INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
    VALUES ('schedule.aiModelCatalog.intervalMinutes', '1440', SYSUTCDATETIME());
END;
GO

-- Enable/disable AI OpenAI quota ingestion
-- Safe rollout default stays off until an environment explicitly enables it.
IF NOT EXISTS (SELECT 1 FROM dbo.DashboardSetting WHERE settingKey = 'ingest.openai.enabled')
BEGIN
    INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
    VALUES ('ingest.openai.enabled', 'false', SYSUTCDATETIME());
END;
GO

-- Enable/disable AI model catalog ingestion
-- This child flag only matters when AI ingestion is enabled.
IF NOT EXISTS (SELECT 1 FROM dbo.DashboardSetting WHERE settingKey = 'ingest.openai.modelCatalog.enabled')
BEGIN
    INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
    VALUES ('ingest.openai.modelCatalog.enabled', 'true', SYSUTCDATETIME());
END;
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

-- View for latest AI model availability per region/model
CREATE OR ALTER VIEW dbo.AIModelAvailabilityLatest AS
WITH Ranked AS (
    SELECT
        capturedAtUtc,
        subscriptionId,
        region,
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
            PARTITION BY region, modelName, modelVersion
            ORDER BY capturedAtUtc DESC
        ) AS rn
    FROM dbo.AIModelAvailability
)
SELECT
    capturedAtUtc,
    subscriptionId,
    region,
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
