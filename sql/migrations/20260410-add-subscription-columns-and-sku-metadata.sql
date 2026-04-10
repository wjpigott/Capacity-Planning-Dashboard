IF COL_LENGTH('dbo.CapacitySnapshot', 'subscriptionId') IS NULL
BEGIN
    ALTER TABLE dbo.CapacitySnapshot
    ADD subscriptionId NVARCHAR(64) NULL;
END;
GO

IF COL_LENGTH('dbo.CapacitySnapshot', 'subscriptionName') IS NULL
BEGIN
    ALTER TABLE dbo.CapacitySnapshot
    ADD subscriptionName NVARCHAR(256) NULL;
END;
GO

IF COL_LENGTH('dbo.CapacitySnapshot', 'vCpu') IS NULL
BEGIN
    ALTER TABLE dbo.CapacitySnapshot
    ADD vCpu INT NULL;
END;
GO

IF COL_LENGTH('dbo.CapacitySnapshot', 'memoryGB') IS NULL
BEGIN
    ALTER TABLE dbo.CapacitySnapshot
    ADD memoryGB DECIMAL(10,2) NULL;
END;
GO

IF COL_LENGTH('dbo.CapacitySnapshot', 'zonesCsv') IS NULL
BEGIN
    ALTER TABLE dbo.CapacitySnapshot
    ADD zonesCsv NVARCHAR(256) NULL;
END;
GO

CREATE OR ALTER VIEW dbo.CapacityLatest AS
WITH Ranked AS (
    SELECT
        capturedAtUtc,
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
            PARTITION BY ISNULL(subscriptionKey, 'legacy-data'), region, skuName
            ORDER BY capturedAtUtc DESC
        ) AS rn
    FROM dbo.CapacitySnapshot
)
SELECT
    capturedAtUtc,
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

UPDATE dbo.CapacitySnapshot
SET
    subscriptionId = ISNULL(subscriptionId, 'legacy-data'),
    subscriptionName = ISNULL(subscriptionName, 'Legacy data')
WHERE subscriptionId IS NULL OR subscriptionName IS NULL;
GO
