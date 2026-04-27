CREATE TABLE dbo.CapacitySnapshot (
    snapshotId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    capturedAtUtc DATETIME2 NOT NULL,
    sourceType NVARCHAR(50) NOT NULL,
    subscriptionKey NVARCHAR(64) NULL,
    subscriptionId NVARCHAR(64) NULL,
    subscriptionName NVARCHAR(256) NULL,
    region NVARCHAR(64) NOT NULL,
    skuName NVARCHAR(128) NOT NULL,
    skuFamily NVARCHAR(128) NOT NULL,
    vCpu INT NULL,
    memoryGB DECIMAL(10,2) NULL,
    zonesCsv NVARCHAR(256) NULL,
    availabilityState NVARCHAR(32) NOT NULL,
    quotaCurrent INT NOT NULL,
    quotaLimit INT NOT NULL,
    monthlyCostEstimate DECIMAL(18,2) NULL
);
GO

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
GO

CREATE TABLE dbo.QuotaApplyRequestLog (
    requestLogId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    createdAtUtc DATETIME2 NOT NULL,
    requestedBy NVARCHAR(256) NOT NULL,
    operationId NVARCHAR(128) NOT NULL,
    state NVARCHAR(64) NOT NULL,
    payloadJson NVARCHAR(MAX) NOT NULL,
    resultJson NVARCHAR(MAX) NULL
);
GO

CREATE TABLE dbo.CapacityScoreSnapshot (
    scoreSnapshotId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    capturedAtUtc DATETIME2 NOT NULL,
    region NVARCHAR(64) NOT NULL,
    skuName NVARCHAR(128) NOT NULL,
    skuFamily NVARCHAR(128) NOT NULL,
    subscriptionCount INT NOT NULL,
    okRows INT NOT NULL,
    limitedRows INT NOT NULL,
    constrainedRows INT NOT NULL,
    totalQuotaAvailable INT NOT NULL,
    utilizationPct INT NOT NULL,
    score NVARCHAR(16) NOT NULL,
    reason NVARCHAR(512) NOT NULL,
    latestSourceCapturedAtUtc DATETIME2 NULL
);
GO

CREATE TABLE dbo.DashboardSetting (
    settingKey NVARCHAR(128) NOT NULL PRIMARY KEY,
    settingValue NVARCHAR(MAX) NOT NULL,
    updatedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE TABLE dbo.AIModelAvailability (
    availabilityId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    capturedAtUtc DATETIME2 NOT NULL,
    subscriptionId NVARCHAR(64) NOT NULL,
    region NVARCHAR(64) NOT NULL,
    provider NVARCHAR(128) NOT NULL CONSTRAINT DF_AIModelAvailability_Provider DEFAULT 'Unknown',
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
GO

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
GO

CREATE NONCLUSTERED INDEX IX_AIModelAvailability_Region_Model
    ON dbo.AIModelAvailability(region, modelName, capturedAtUtc DESC);
GO

CREATE NONCLUSTERED INDEX IX_AIModelAvailability_Provider_Region_Model
    ON dbo.AIModelAvailability(provider, region, modelName, modelVersion, capturedAtUtc DESC);
GO

CREATE NONCLUSTERED INDEX IX_AIModelAvailability_CapturedAt
    ON dbo.AIModelAvailability(capturedAtUtc DESC);
GO

CREATE INDEX IX_PaaSAvailabilitySnapshot_ServiceCaptured
    ON dbo.PaaSAvailabilitySnapshot (requestedService, capturedAtUtc DESC, service, region);
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
