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

IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'analysisRunId') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD analysisRunId UNIQUEIDENTIFIER NULL');

IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'sourceCapturedAtUtc') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD sourceCapturedAtUtc DATETIME2 NULL');

IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'managementGroupId') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD managementGroupId NVARCHAR(128) NULL');

IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'groupQuotaName') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD groupQuotaName NVARCHAR(128) NULL');

IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'subscriptionId') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD subscriptionId NVARCHAR(64) NULL');

IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'subscriptionName') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD subscriptionName NVARCHAR(256) NULL');

IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'availabilityState') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD availabilityState NVARCHAR(32) NULL');

IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'quotaCurrent') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD quotaCurrent INT NULL');

IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'quotaLimit') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD quotaLimit INT NULL');

IF COL_LENGTH('dbo.QuotaCandidateSnapshot', 'quotaAvailable') IS NULL
    EXEC('ALTER TABLE dbo.QuotaCandidateSnapshot ADD quotaAvailable INT NULL');

UPDATE dbo.QuotaCandidateSnapshot
SET
    analysisRunId = ISNULL(analysisRunId, NEWID()),
    managementGroupId = ISNULL(managementGroupId, 'legacy-mg'),
    groupQuotaName = ISNULL(groupQuotaName, 'legacy-quota-group'),
    subscriptionId = ISNULL(subscriptionId, subscriptionHash),
    subscriptionName = ISNULL(subscriptionName, subscriptionHash),
    availabilityState = ISNULL(availabilityState, 'Unknown'),
    quotaCurrent = ISNULL(quotaCurrent, 0),
    quotaLimit = ISNULL(quotaLimit, 0),
    quotaAvailable = ISNULL(quotaAvailable, 0)
WHERE analysisRunId IS NULL
   OR managementGroupId IS NULL
   OR groupQuotaName IS NULL
   OR subscriptionId IS NULL
   OR subscriptionName IS NULL
   OR availabilityState IS NULL
   OR quotaCurrent IS NULL
   OR quotaLimit IS NULL
   OR quotaAvailable IS NULL;
GO

ALTER TABLE dbo.QuotaCandidateSnapshot ALTER COLUMN analysisRunId UNIQUEIDENTIFIER NOT NULL;
ALTER TABLE dbo.QuotaCandidateSnapshot ALTER COLUMN managementGroupId NVARCHAR(128) NOT NULL;
ALTER TABLE dbo.QuotaCandidateSnapshot ALTER COLUMN groupQuotaName NVARCHAR(128) NOT NULL;
ALTER TABLE dbo.QuotaCandidateSnapshot ALTER COLUMN subscriptionId NVARCHAR(64) NOT NULL;
ALTER TABLE dbo.QuotaCandidateSnapshot ALTER COLUMN subscriptionName NVARCHAR(256) NOT NULL;
ALTER TABLE dbo.QuotaCandidateSnapshot ALTER COLUMN availabilityState NVARCHAR(32) NOT NULL;
ALTER TABLE dbo.QuotaCandidateSnapshot ALTER COLUMN quotaCurrent INT NOT NULL;
ALTER TABLE dbo.QuotaCandidateSnapshot ALTER COLUMN quotaLimit INT NOT NULL;
ALTER TABLE dbo.QuotaCandidateSnapshot ALTER COLUMN quotaAvailable INT NOT NULL;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_QuotaCandidateSnapshot_RunScope'
      AND object_id = OBJECT_ID('dbo.QuotaCandidateSnapshot')
)
BEGIN
    CREATE INDEX IX_QuotaCandidateSnapshot_RunScope
        ON dbo.QuotaCandidateSnapshot (capturedAtUtc DESC, managementGroupId, groupQuotaName, subscriptionId);
END;
GO