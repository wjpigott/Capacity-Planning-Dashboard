IF COL_LENGTH('dbo.CapacitySnapshot', 'subscriptionKey') IS NULL
BEGIN
    ALTER TABLE dbo.CapacitySnapshot
    ADD subscriptionKey NVARCHAR(64) NULL;
END;
GO

CREATE OR ALTER VIEW dbo.CapacityLatest AS
WITH Ranked AS (
    SELECT
        capturedAtUtc,
        subscriptionKey,
        region,
        skuName,
        skuFamily,
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
    region,
    skuName,
    skuFamily,
    availabilityState,
    quotaCurrent,
    quotaLimit,
    monthlyCostEstimate
FROM Ranked
WHERE rn = 1;
GO

UPDATE dbo.CapacitySnapshot
SET subscriptionKey = 'legacy-data'
WHERE subscriptionKey IS NULL;
GO
