-- Migration: Add performance indexes for capacity queries
-- Date: 2026-04-14
-- Purpose: Optimize CapacityLatest view queries used by API endpoints

----- INDEX 1: Region + Family + Availability for grid filtering
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CapacitySnapshot_RegionFamilyAvailability')
BEGIN
    CREATE NONCLUSTERED INDEX IX_CapacitySnapshot_RegionFamilyAvailability
    ON dbo.CapacitySnapshot (region, skuFamily, availabilityState)
    INCLUDE (capturedAtUtc, subscriptionId, subscriptionName, skuName, quotaCurrent, quotaLimit, vCpu, memoryGB, zonesCsv, subscriptionKey)
    WITH (FILLFACTOR = 90);
    PRINT 'Created index: IX_CapacitySnapshot_RegionFamilyAvailability';
END
GO

----- INDEX 2: CapturedAtUtc DESC for latest-first sorting
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CapacitySnapshot_CapturedAtDesc')
BEGIN
    CREATE NONCLUSTERED INDEX IX_CapacitySnapshot_CapturedAtDesc
    ON dbo.CapacitySnapshot (capturedAtUtc DESC)
    INCLUDE (region, skuFamily, skuName, subscriptionId, subscriptionName, quotaCurrent, quotaLimit)
    WITH (FILLFACTOR = 90);
    PRINT 'Created index: IX_CapacitySnapshot_CapturedAtDesc';
END
GO

----- INDEX 3: SubscriptionId for subscription-filtered queries
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CapacitySnapshot_SubscriptionId')
BEGIN
    CREATE NONCLUSTERED INDEX IX_CapacitySnapshot_SubscriptionId
    ON dbo.CapacitySnapshot (subscriptionId)
    INCLUDE (region, skuFamily, skuName, availabilityState, quotaCurrent, quotaLimit, capturedAtUtc)
    WITH (FILLFACTOR = 90);
    PRINT 'Created index: IX_CapacitySnapshot_SubscriptionId';
END
GO

----- INDEX 4: Family summary queries
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CapacitySnapshot_FamilyRegion')
BEGIN
    CREATE NONCLUSTERED INDEX IX_CapacitySnapshot_FamilyRegion
    ON dbo.CapacitySnapshot (skuFamily, region)
    INCLUDE (quotaCurrent, quotaLimit, subscriptionId, subscriptionName, capturedAtUtc)
    WITH (FILLFACTOR = 90);
    PRINT 'Created index: IX_CapacitySnapshot_FamilyRegion';
END
GO

----- INDEX 5: CapacityScoreSnapshot indexes
IF OBJECT_ID('dbo.CapacityScoreSnapshot', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CapacityScoreSnapshot_RegionSku' AND object_id = OBJECT_ID('dbo.CapacityScoreSnapshot'))
    BEGIN
        CREATE NONCLUSTERED INDEX IX_CapacityScoreSnapshot_RegionSku
        ON dbo.CapacityScoreSnapshot (region, skuFamily, skuName)
        INCLUDE (capturedAtUtc, score, reason, utilizationPct)
        WITH (FILLFACTOR = 90);
        PRINT 'Created index: IX_CapacityScoreSnapshot_RegionSku';
    END
END
GO

----- STATISTICS UPDATE
UPDATE STATISTICS dbo.CapacitySnapshot;
PRINT 'Updated statistics on dbo.CapacitySnapshot';
GO

----- Create indexed view for latest capacity per family/region if not exists
PRINT 'Skipped unused CapacityLatestPerFamily view creation.';
GO

PRINT 'Migration complete: Performance indexes added successfully';
