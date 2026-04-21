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
