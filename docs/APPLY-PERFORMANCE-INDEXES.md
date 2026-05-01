# Quick Manual: Apply Performance Indexes via Azure Portal

## Step-by-Step Instructions

### Option A: Azure Portal Query Editor (Easiest - 5 minutes)

1. **Open Azure Portal**
   - Go to: https://portal.azure.com
   - Search for: "<sql-server-name>" or navigate to SQL servers

2. **Select Your Database**
   - Click: **Databases** → **<sql-database-name>**

3. **Open Query Editor**
   - Look for: "Query editor" in the left panel
   - Or search for "Query editor" in the portal search bar
   - Click: **Query editor (preview)**

4. **Copy & Paste SQL**
   - Copy the entire contents of: `sql/migrations/20260414-add-performance-indexes.sql`
   - Paste into the Query Editor
   - Click: **Run** or press **Ctrl+Enter**

5. **Wait for Completion**
   - Expected time: 1-2 minutes
   - Watch the results pane for success messages
   - Should see: "Created index: IX_CapacitySnapshot_RegionFamilyAvailability" etc.

---

### Option B: Verify Indexes Were Created

After running the SQL, verify with this query:

```sql
SELECT 
    name,
    type_desc,
    DATEDIFF(minute, create_date, GETDATE()) as created_minutes_ago
FROM sys.indexes 
WHERE object_id = OBJECT_ID('dbo.CapacitySnapshot')
AND name LIKE 'IX_Capacity%'
ORDER BY name;
```

You should see 5 indexes listed:
- IX_CapacitySnapshot_RegionFamilyAvailability
- IX_CapacitySnapshot_CapturedAtDesc
- IX_CapacitySnapshot_SubscriptionId
- IX_CapacitySnapshot_FamilyRegion
- IX_CapacityScoreSnapshot_RegionSku

---

### What to Expect

✅ **Performance improvements after indexes:**
- Grid loads 50-80% faster
- API responses: 100-300ms (vs 500-800ms)
- Database CPU usage: More stable, lower peaks
- Payload size: Already reduced 65% with DTOs

---

### Troubleshooting

**If you get permission errors:**
- Ensure you're logged in with the same Azure account that owns the subscription
- Check: User has "SQL Server Contributor" or higher role
- Or ask your Azure admin to run the SQL

**If query hangs:**
- Wait up to 3-5 minutes (index creation can be slow)
- If still hanging, click "Stop" and retry

**If indexes don't appear:**
- They may have already existed from a previous run
- Run the verification query above to confirm
- If confirmed present, indexes are active ✓

---

### Next Steps After Indexes

1. Test your dashboard: https://<web-app-name>.azurewebsites.net/
2. Navigate to different reports
3. Notice the improved responsiveness
4. If still slow after 1-2 weeks, consider scaling to S1 (see DATABASE-SCALING-GUIDE.md)

---

## SQL to Copy-Paste

The full SQL migration is in: `sql/migrations/20260414-add-performance-indexes.sql`

Looking for just the first index? Here's a sample:

```sql
CREATE NONCLUSTERED INDEX IX_CapacitySnapshot_RegionFamilyAvailability
ON dbo.CapacitySnapshot (region, skuFamily, availabilityState)
INCLUDE (capturedAtUtc, subscriptionId, subscriptionName, skuName, quotaCurrent, quotaLimit, vCpu, memoryGB, zonesCsv, subscriptionKey)
WITH (FILLFACTOR = 90);
```

All 5 indexes are defined in the migration file.

---

## Questions?

- Check: `docs/PERFORMANCE-OPTIMIZATION.md` for detailed tuning guide
- Check: `docs/DATABASE-SCALING-GUIDE.md` for scaling decisions
