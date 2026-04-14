-- Create a dedicated Subscriptions table so the subscription list is O(1) to query
-- instead of aggregating GROUP BY over the entire CapacitySnapshot table.
-- The ingest process upserts rows here on every run.

IF OBJECT_ID('dbo.Subscriptions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Subscriptions (
        subscriptionId   NVARCHAR(64)  NOT NULL,
        subscriptionName NVARCHAR(256) NOT NULL,
        updatedAtUtc     DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT PK_Subscriptions PRIMARY KEY (subscriptionId)
    );
END
GO

-- Back-fill from existing ingest data
MERGE dbo.Subscriptions AS tgt
USING (
    SELECT
        ISNULL(subscriptionId, 'legacy-data')       AS subscriptionId,
        ISNULL(subscriptionName, 'Legacy data')      AS subscriptionName,
        MAX(capturedAtUtc)                           AS updatedAtUtc
    FROM dbo.CapacitySnapshot
    WHERE subscriptionId IS NOT NULL
      AND subscriptionId <> 'legacy-data'
    GROUP BY subscriptionId, subscriptionName
) AS src
ON tgt.subscriptionId = src.subscriptionId
WHEN MATCHED THEN
    UPDATE SET subscriptionName = src.subscriptionName,
               updatedAtUtc     = src.updatedAtUtc
WHEN NOT MATCHED THEN
    INSERT (subscriptionId, subscriptionName, updatedAtUtc)
    VALUES (src.subscriptionId, src.subscriptionName, src.updatedAtUtc);
GO
