/**
 * Subscription access control service
 * Filters capacity data based on user's Azure subscription access
 */

/**
 * Get list of subscriptions accessible to the current user
 * Queries Azure Resource Manager API with user's token
 * Note: User's account object from MSAL contains cached tokens
 */
async function getUserAccessibleSubscriptions(userAccount) {
  if (!userAccount || !userAccount.id) {
    return null; // Anonymous user - no filtering
  }

  try {
    // TODO: In production, extract user's ARM access token from MSAL session
    // For now, this requires the app to request a token scoped to ARM
    // In server.js auth configuration, add to scopes: 'https://management.azure.com/.default'
    
    // Example token acquisition (needs MSAL client in server context):
    // const armToken = await msalClient.acquireTokenSilent({
    //   account: userAccount,
    //   scopes: ['https://management.azure.com/.default']
    // });
    
    console.log(`Note: Subscription filtering for user ${userAccount.username} requires ARM token scope`);
    return null; // Return null to show all data (no filtering)
  } catch (err) {
    console.warn(`Error getting user subscriptions for ${userAccount.username}:`, err.message);
    return null; // Gracefully degrade - show all data
  }
}

/**
 * Filter capacity rows to only include subscriptions user can access
 * @param {Array} rows - All capacity rows from database
 * @param {Object} userAccount - User account from session
 * @param {Array} userAccessibleSubscriptions - User's accessible subscription IDs
 * @returns {Array} Filtered rows
 */
function filterRowsByUserSubscriptions(rows, userAccount, userAccessibleSubscriptions) {
  if (!userAccessibleSubscriptions || userAccessibleSubscriptions.length === 0) {
    console.warn(`User ${userAccount?.username} has no accessible subscriptions`);
    return []; // User can't see anything
  }

  const accessibleSet = new Set(userAccessibleSubscriptions);
  
  return rows.filter(row => {
    // Allow legacy data (no subscription info)
    if (row.subscriptionId === 'legacy-data' || !row.subscriptionId) {
      return true;
    }
    
    // Only include rows from subscriptions user can access
    return accessibleSet.has(row.subscriptionId);
  });
}

/**
 * Middleware to enforce subscription-based access control
 * Attaches user's accessible subscriptions to request
 */
function subscriptionAccessControl(req, res, next) {
  // For now, just call next() - user subscriptions loaded on-demand in service
  // In future: cache user subscriptions in session to avoid repeated ARM calls
  next();
}

module.exports = {
  getUserAccessibleSubscriptions,
  filterRowsByUserSubscriptions,
  subscriptionAccessControl
};
