CREATE TABLE dbo.CapacitySnapshot (
    snapshotId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    capturedAtUtc DATETIME2 NOT NULL,
    sourceType NVARCHAR(50) NOT NULL,
    subscriptionKey NVARCHAR(64) NULL,
    region NVARCHAR(64) NOT NULL,
    skuName NVARCHAR(128) NOT NULL,
    skuFamily NVARCHAR(128) NOT NULL,
    availabilityState NVARCHAR(32) NOT NULL,
    quotaCurrent INT NOT NULL,
    quotaLimit INT NOT NULL,
    monthlyCostEstimate DECIMAL(18,2) NULL
);
GO

CREATE TABLE dbo.QuotaCandidateSnapshot (
    candidateId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    capturedAtUtc DATETIME2 NOT NULL,
    region NVARCHAR(64) NOT NULL,
    quotaName NVARCHAR(128) NOT NULL,
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
