IF OBJECT_ID('dbo.PaaSDatabaseQuotaSnapshot', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PaaSDatabaseQuotaSnapshot (
        paasDatabaseQuotaSnapshotId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        runId UNIQUEIDENTIFIER NOT NULL,
        capturedAtUtc DATETIME2 NOT NULL,
        requestedServicesJson NVARCHAR(MAX) NULL,
        requestedRegionsJson NVARCHAR(MAX) NULL,
        requestedSubscriptionsJson NVARCHAR(MAX) NULL,
        includeCapabilities BIT NOT NULL DEFAULT 0,
        metadataJson NVARCHAR(MAX) NULL,
        dataset NVARCHAR(32) NOT NULL,
        subscriptionId NVARCHAR(64) NULL,
        subscriptionName NVARCHAR(256) NULL,
        service NVARCHAR(64) NOT NULL,
        region NVARCHAR(64) NOT NULL,
        metric NVARCHAR(256) NOT NULL,
        currentUsage FLOAT NULL,
        quotaLimit FLOAT NULL,
        available FLOAT NULL,
        percentUsed FLOAT NULL,
        unit NVARCHAR(64) NULL,
        accessAllowedForRegion BIT NULL,
        accessAllowedForAZ NVARCHAR(32) NULL,
        notes NVARCHAR(MAX) NULL,
        detailsJson NVARCHAR(MAX) NULL
    );
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_PaaSDatabaseQuotaSnapshot_RunDataset'
      AND object_id = OBJECT_ID('dbo.PaaSDatabaseQuotaSnapshot')
)
BEGIN
    CREATE INDEX IX_PaaSDatabaseQuotaSnapshot_RunDataset
        ON dbo.PaaSDatabaseQuotaSnapshot (capturedAtUtc DESC, runId, dataset, service, region);
END;
GO