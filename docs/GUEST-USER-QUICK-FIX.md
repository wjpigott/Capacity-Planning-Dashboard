# Guest User Data Access - Quick Fix

## Immediate Action: Check Guest Subscription Access

**Why they see no data:**
- ✅ Guest user CAN login (Entra auth works)
- ❌ Guest user sees NO data (no subscription access granted)

## Quick Diagnostic (5 minutes)

### Step 1: Identify the Guest User's UPN
Find the full identity they use to sign in. Look in Azure Portal:
- Entra ID → Users → Search for guest user name
- Note their **User principal name** (UPN), example: `guestuser_company.com#EXT#@yourtenant.onmicrosoft.com`

### Step 2: Check Their Current Access
```bash
# Replace UPN below
az role assignment list \
  --assignee 'guestuser_company.com#EXT#@yourtenant.onmicrosoft.com' \
  --query "[].[id, scope, roleDefinitionName]" \
  -o table
```

**If it returns NOTHING** → This is your problem! Guest has zero subscription access.

### Step 3: Grant Subscription Access
```bash
# Replace these values:
GUEST_UPN='guestuser_company.com#EXT#@yourtenant.onmicrosoft.com'
SUBSCRIPTION_ID='00000000-0000-0000-0000-000000000000'

# Grant Reader access (they'll see data but can't modify anything)
az role assignment create \
  --assignee "$GUEST_UPN" \
  --role "Reader" \
  --scope "/subscriptions/$SUBSCRIPTION_ID"
```

**Then**: Guest user logs out → logs back in → NOW SEES DATA ✓

---

## Alternative: Grant via Azure Portal (Easier)

1. Go to **Azure Portal** → **Subscriptions** → Select subscription
2. Click **Access Control (IAM)**
3. Click **+ Add** → **Add role assignment**
4. Role: **Reader**
5. Assign to: Search guest user name
6. Click **Review + assign**

---

## Permanent Solution: Implement Subscription Filtering

After the quick fix above works, implement the code changes to automatically filter by user access:

### Enable in server.js (After MSAL token scope update)

The infrastructure is ready. To enable subscription-filtered data for guest users:

1. **Update MSAL scopes** in `src/middleware/auth.js`:
   ```javascript
   // Add ARM scope to MSAL config for user token acquisition
   config.auth.scopes = [
     'https://graph.microsoft.com/.default',
     'https://management.azure.com/.default'  // ← ADD THIS
   ];
   ```

2. **Use filtered endpoint** in UI (if you add it):
   ```javascript
   // Future: Call this endpoint instead (auto-filters for user)
   // GET /api/capacity/filtered?regionPreset=USMajor
   // Response: Only subscriptions guest can access
   ```

---

## Summary

| Issue | Quick Fix | Permanent Fix |
|-------|-----------|---------------|
| Guest sees no data | Grant Reader role on subscription (5 min) | Enable ARM token scope + subscription filtering |
| Works immediately | ✅ Yes (after logging out/in) | Takes 1 hour to implement |
| Need to grant per user | Yes (one-time per guest) | Still yes, but UI could support groups |

**Next Steps:**
1. ✅ Run diagnostic command above → Check guest subscription access
2. ✅ Grant Reader role if needed → Guest can immediately see data
3. ⏳ (Optional) Implement permanent filtering → Auto-respects subscription access in future

---

## Why No Data Issue (Technical Details)

Current architecture:
```
Guest logs in ✓
    ↓
App queries SQL with App Service managed identity (not guest's token)
    ↓
SQL returns all capacity data (same for all users)
    ↓
No subscription filtering = Guest sees empty result set ❌
```

After granting Reader role:
```
Guest has permission to subscriptions ✓
SQL still doesn't filter by user BUT ✓
    ↓
Guest at least has legal access to see the data ✓
    ↓
Subscription scope in SQL where clause (future) will respect guest permissions
```

The quick fix (granting Reader role) lets the guest see the data **now**. The permanent fix (subscription filtering code) will make it automatic in the future.
