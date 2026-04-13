IF OBJECT_ID('dbo.CapacityScoreSnapshot', 'U') IS NULL
BEGIN
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
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_CapacityScoreSnapshot_CapturedRegionSku'
      AND object_id = OBJECT_ID('dbo.CapacityScoreSnapshot')
)
BEGIN
    CREATE INDEX IX_CapacityScoreSnapshot_CapturedRegionSku
        ON dbo.CapacityScoreSnapshot (capturedAtUtc DESC, region, skuName);
END;
GO
