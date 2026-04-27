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

IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'skuList') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD skuList NVARCHAR(MAX) NULL');
GO

IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'skuCount') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD skuCount INT NULL');
GO

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