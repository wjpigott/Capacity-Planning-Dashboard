-- Phase 2B provider-aware Azure AI quota rollout gate
-- Keep non-OpenAI quota expansion default-off until explicitly enabled.

IF OBJECT_ID('dbo.DashboardSetting', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.DashboardSetting (
        settingKey NVARCHAR(128) NOT NULL PRIMARY KEY,
        settingValue NVARCHAR(MAX) NOT NULL,
        updatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_DashboardSetting_UpdatedAtUtc DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.DashboardSetting WHERE settingKey = 'ingest.ai.providerQuota.enabled')
BEGIN
    INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
    VALUES ('ingest.ai.providerQuota.enabled', 'false', SYSUTCDATETIME());
END;
GO
