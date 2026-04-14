/**
 * IMPORTANT: Why Guest Users See No Data
 * 
 * CURRENT ARCHITECTURE:
 * ==================
 * User logs in (Entra ID auth) → Session created
 *     ↓
 * API request to /api/capacity
 *     ↓
 * App Service queries SQL using MANAGED IDENTITY (not user's credentials)
 *     ↓
 * SQL returns ALL rows the managed identity can see (usually all subscriptions)
 *     ↓
 * SAME DATA returned to all users (admin, guest, etc.)
 * 
 * 
 * PROBLEM FOR GUEST USERS:
 * =======================
 * Guest user CAN log in ✓
 * Guest user sees the dashboard UI ✓
 * BUT: Guest user sees ZERO data because:
 * 
 * 1. Database query ignores user identity
 *    - SQL is queried with App Service managed identity
 *    - Not the guest's actual Azure access
 * 
 * 2. No subscription filtering
 *    - Dashboard shows ALL capacity data
 *    - Assumes everyone has access to everything
 *    - Guest sees no rows (not authorized to view other subscriptions' data)
 * 
 * 3. Managed Identity sees all subscriptions
 *    - App Service has broad permissions
 *    - But guest user's token doesn't
 * 
 * 
 * SOLUTIONS:
 * ==========
 * 
 * OPTION A: Use User's Access Token (Recommended for security)
 * ────────────────────────────────
 * Change SQL queries to use user's own Azure access token to:
 * 1. List subscriptions they can access
 * 2. Only show capacity data from THOSE subscriptions
 * 
 * Pros:
 *   - Most secure (respects user's real permissions)
 *   - Guest sees only what they should
 *   - Follows principle of least privilege
 * 
 * Cons:
 *   - Requires token from user session
 *   - More complex implementation
 *   - Every API call needs user token lookup
 * 
 * Implementation: Use MSAL to acquire user's ARM token from session
 *                 Then check subscriptions with that token
 * 
 * 
 * OPTION B: Explicit App Role Assignment (Current best practice at scale)
 * ────────────────────────────────────────
 * Require users to be assigned to an app role or group that grants dashboard access
 * Then show them a limited set of subscriptions based on group membership
 * 
 * Pros:
 *   - Clear authorization model
 *   - Easy to audit who has access
 *   -Scale for many users/teams
 * 
 * Cons:
 *   - Requires manual group assignment
 *   - Not dynamic based on subscription access
 * 
 * Implementation: 
 *   1. Create Entra group "CapacityDashboard-Users"
 *   2. Assign guest user to group
 *   3. Check group membership in code
 *   4. Show allowed subscriptions only
 * 
 * 
 * OPTION C: RBAC per Subscription (Recommended for existing setups)
 * ──────────────────────────────────────
 * Read user's subscription access directly from Azure
 * Show capacity data only from subscriptions they can access
 * 
 * Pros:
 *   - Reuses existing RBAC model
 *   - Guest sees data if they're a Reader on that subscription
 *   - Automatic sync with subscription access
 * 
 * Cons:
 *   - Requires calling Azure ARM API on every request
 *   - More API calls = slightly slower
 *   - Requires user token in session (already have from MSAL)
 * 
 * Implementation:
 *   1. Get user's ARM access token from MSAL session
 *   2. Query ARM: GET /subscriptions (user's token, not managed identity)
 *   3. Filter SQL results to only those subscriptions
 * 
 * 
 * QUICKEST FIX (Option C - Recommended):
 * ======================================
 * 
 * In capacityService.js, wrap getCapacityRows() with filtered version:
 * 
 *   async function getCapacityRowsForUser(filters, userAccount) {
 *     // 1. Get user's subscriptions
 *     const userSubs = await getUserAccessibleSubscriptions(userAccount);
 *     
 *     // 2. Get all capacity data
 *     const allRows = await getCapacityRows(filters);
 *     
 *     // 3. Filter to user's subscriptions only
 *     return filterRowsByUserSubscriptions(allRows, userAccount, userSubs);
 *   }
 * 
 * Then in server.js, use it:
 *   
 *   app.get('/api/capacity', async (req, res) => {
 *     const account = getAccountFromSession(req); // Guest user's account
 *     const rows = await getCapacityRowsForUser(filters, account);
 *     res.json({ rows });
 *   });
 * 
 * Result: Guest user only sees capacity data from subscriptions they can access ✓
 * 
 * 
 * DIAGNOSIS CHECKLIST:
 * ====================
 * 
 * If guest sees NO data:
 * [ ] Confirm they logged in successfully (check browser console)
 * [ ] Check if they appear in Azure subscriptions they should access
 * [ ] Verify they have Reader+ role on those subscriptions
 * [ ] Check Application Insights logs for 401/403 errors from guest user's calls
 * 
 * To verify guest subscription access:
 * ```bash
 * # Run as guest user or check their assignments
 * az role assignment list --assignee <guest-upn>@<tenant>.onmicrosoft.com
 * ```
 * 
 * If empty → guest has NO subscription access → add them with:
 * ```bash
 * az role assignment create \
 *   --assignee <guest-upn>@<tenant>.onmicrosoft.com \
 *   --role "Reader" \
 *   --scope /subscriptions/<subscription-id>
 * ```
 * 
 */

module.exports = {
  // This file is for documentation only - see implementation in subscriptionAccessService.js
};
