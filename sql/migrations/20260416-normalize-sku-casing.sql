-- Normalize persisted SKU casing so Standard_/Basic_ prefixes are stored consistently.
-- Safe to re-run: updates only rows whose stored prefix is not already canonical.

IF OBJECT_ID('dbo.CapacitySnapshot', 'U') IS NOT NULL
BEGIN
    UPDATE dbo.CapacitySnapshot
    SET skuName = 'Standard_' + SUBSTRING(skuName, 10, 119)
    WHERE LOWER(LEFT(skuName, 9)) = 'standard_'
      AND LEFT(skuName COLLATE Latin1_General_100_BIN2, 9) <> 'Standard_';

    UPDATE dbo.CapacitySnapshot
    SET skuName = 'Basic_' + SUBSTRING(skuName, 7, 121)
    WHERE LOWER(LEFT(skuName, 6)) = 'basic_'
      AND LEFT(skuName COLLATE Latin1_General_100_BIN2, 6) <> 'Basic_';
END;
GO

IF OBJECT_ID('dbo.CapacityScoreSnapshot', 'U') IS NOT NULL
BEGIN
    UPDATE dbo.CapacityScoreSnapshot
    SET skuName = 'Standard_' + SUBSTRING(skuName, 10, 119)
    WHERE LOWER(LEFT(skuName, 9)) = 'standard_'
      AND LEFT(skuName COLLATE Latin1_General_100_BIN2, 9) <> 'Standard_';

    UPDATE dbo.CapacityScoreSnapshot
    SET skuName = 'Basic_' + SUBSTRING(skuName, 7, 121)
    WHERE LOWER(LEFT(skuName, 6)) = 'basic_'
      AND LEFT(skuName COLLATE Latin1_General_100_BIN2, 6) <> 'Basic_';
END;
GO

IF OBJECT_ID('dbo.LivePlacementSnapshot', 'U') IS NOT NULL
BEGIN
    UPDATE dbo.LivePlacementSnapshot
    SET skuName = 'Standard_' + SUBSTRING(skuName, 10, 119)
    WHERE LOWER(LEFT(skuName, 9)) = 'standard_'
      AND LEFT(skuName COLLATE Latin1_General_100_BIN2, 9) <> 'Standard_';

    UPDATE dbo.LivePlacementSnapshot
    SET skuName = 'Basic_' + SUBSTRING(skuName, 7, 121)
    WHERE LOWER(LEFT(skuName, 6)) = 'basic_'
      AND LEFT(skuName COLLATE Latin1_General_100_BIN2, 6) <> 'Basic_';
END;
GO