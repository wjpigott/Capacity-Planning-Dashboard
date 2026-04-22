-- Normalize persisted compute family casing so SQL filtering and UI facets use a single canonical value.
-- Safe to re-run: updates only the standard/basic family prefix variants that can produce duplicates.

IF OBJECT_ID('dbo.CapacitySnapshot', 'U') IS NOT NULL
BEGIN
    UPDATE dbo.CapacitySnapshot
    SET skuFamily = 'standard' + SUBSTRING(skuFamily, 10, 119)
    WHERE LOWER(LEFT(skuFamily, 9)) = 'standard_';

    UPDATE dbo.CapacitySnapshot
    SET skuFamily = 'standard' + SUBSTRING(skuFamily, 9, 120)
    WHERE LOWER(LEFT(skuFamily, 8)) = 'standard'
      AND LOWER(LEFT(skuFamily, 9)) <> 'standard_'
      AND LEFT(skuFamily COLLATE Latin1_General_100_BIN2, 8) <> 'standard';

    UPDATE dbo.CapacitySnapshot
    SET skuFamily = 'basic' + SUBSTRING(skuFamily, 7, 121)
    WHERE LOWER(LEFT(skuFamily, 6)) = 'basic_';

    UPDATE dbo.CapacitySnapshot
    SET skuFamily = 'basic' + SUBSTRING(skuFamily, 6, 122)
    WHERE LOWER(LEFT(skuFamily, 5)) = 'basic'
      AND LOWER(LEFT(skuFamily, 6)) <> 'basic_'
      AND LEFT(skuFamily COLLATE Latin1_General_100_BIN2, 5) <> 'basic';
END;
GO

IF OBJECT_ID('dbo.CapacityScoreSnapshot', 'U') IS NOT NULL
BEGIN
    UPDATE dbo.CapacityScoreSnapshot
    SET skuFamily = 'standard' + SUBSTRING(skuFamily, 10, 119)
    WHERE LOWER(LEFT(skuFamily, 9)) = 'standard_';

    UPDATE dbo.CapacityScoreSnapshot
    SET skuFamily = 'standard' + SUBSTRING(skuFamily, 9, 120)
    WHERE LOWER(LEFT(skuFamily, 8)) = 'standard'
      AND LOWER(LEFT(skuFamily, 9)) <> 'standard_'
      AND LEFT(skuFamily COLLATE Latin1_General_100_BIN2, 8) <> 'standard';

    UPDATE dbo.CapacityScoreSnapshot
    SET skuFamily = 'basic' + SUBSTRING(skuFamily, 7, 121)
    WHERE LOWER(LEFT(skuFamily, 6)) = 'basic_';

    UPDATE dbo.CapacityScoreSnapshot
    SET skuFamily = 'basic' + SUBSTRING(skuFamily, 6, 122)
    WHERE LOWER(LEFT(skuFamily, 5)) = 'basic'
      AND LOWER(LEFT(skuFamily, 6)) <> 'basic_'
      AND LEFT(skuFamily COLLATE Latin1_General_100_BIN2, 5) <> 'basic';
END;
GO