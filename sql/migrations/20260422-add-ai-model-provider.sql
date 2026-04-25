IF OBJECT_ID('dbo.AIModelAvailability', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.AIModelAvailability', 'provider') IS NULL
    BEGIN
        ALTER TABLE dbo.AIModelAvailability
            ADD provider NVARCHAR(128) NOT NULL
                CONSTRAINT DF_AIModelAvailability_Provider DEFAULT ('Unknown') WITH VALUES;
    END;
END;
GO

IF OBJECT_ID('dbo.AIModelAvailability', 'U') IS NOT NULL
BEGIN
    UPDATE dbo.AIModelAvailability
    SET provider = CASE
        WHEN NULLIF(LTRIM(RTRIM(modelFormat)), '') IS NULL THEN 'OpenAI'
        WHEN LOWER(LTRIM(RTRIM(modelFormat))) IN ('openai', 'azureopenai') THEN 'OpenAI'
        ELSE LTRIM(RTRIM(modelFormat))
    END
    WHERE provider IS NULL OR LTRIM(RTRIM(provider)) = '';
END;
GO

IF OBJECT_ID('dbo.AIModelAvailability', 'U') IS NOT NULL
AND EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.AIModelAvailability')
      AND name = 'provider'
      AND is_nullable = 1
)
BEGIN
    ALTER TABLE dbo.AIModelAvailability ALTER COLUMN provider NVARCHAR(128) NOT NULL;
END;
GO

IF OBJECT_ID('dbo.AIModelAvailability', 'U') IS NOT NULL
AND NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_AIModelAvailability_Provider_Region_Model'
      AND object_id = OBJECT_ID('dbo.AIModelAvailability')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_AIModelAvailability_Provider_Region_Model
        ON dbo.AIModelAvailability(provider, region, modelName, modelVersion, capturedAtUtc DESC);
END;
GO

IF OBJECT_ID('dbo.AIModelAvailability', 'U') IS NOT NULL
BEGIN
    EXEC(N'
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
    ');
END;
GO
