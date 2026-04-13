'use strict';

/**
 * Entra ID (Azure AD) authentication middleware using MSAL Node.
 *
 * When AUTH_ENABLED=false (default for local dev) all auth checks are bypassed.
 * When AUTH_ENABLED=true the app uses an OAuth2 auth-code flow:
 *   GET /auth/login    → redirect to Microsoft login
 *   GET /auth/callback → exchange code for tokens, store claims in session
 *   GET /auth/logout   → destroy session + redirect to Microsoft logout
 *
 * Admin access is controlled by ADMIN_GROUP_ID. If the signed-in user's ID token
 * groups claim contains that Object ID they are treated as an administrator.
 * Leave ADMIN_GROUP_ID empty to disable admin gating (everyone is admin).
 *
 * Multi-tenant: authority uses 'common' so any Azure AD org account can sign in.
 * The groups claim in the ID token contains groups from the user's home tenant.
 *
 * NOTE: If a user is a member of > 200 groups, Azure AD omits the inline groups
 * claim and provides an overage endpoint instead. In that rare case this middleware
 * will not see the groups claim and admin access will be denied. A future
 * enhancement can call MS Graph /me/memberOf to handle the overage case.
 */

const { ConfidentialClientApplication } = require('@azure/msal-node');
const crypto = require('crypto');

const AUTH_ENABLED = (process.env.AUTH_ENABLED || 'false').toLowerCase() === 'true';
const ADMIN_GROUP_ID = (process.env.ADMIN_GROUP_ID || '').trim();

let _msalClient = null;

function getMsalClient() {
  if (_msalClient) return _msalClient;
  const clientId = process.env.ENTRA_CLIENT_ID;
  const clientSecret = process.env.ENTRA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  _msalClient = new ConfidentialClientApplication({
    auth: {
      clientId,
      // 'common' allows any Azure AD organisational account (multi-tenant)
      authority: 'https://login.microsoftonline.com/common',
      clientSecret
    }
  });
  return _msalClient;
}

function getRedirectUri() {
  return process.env.AUTH_REDIRECT_URI || 'http://localhost:3000/auth/callback';
}

/** Returns the session account object or null if not signed in. */
function getAccountFromSession(req) {
  return req.session?.account || null;
}

/** Returns true when the account's groups claim contains ADMIN_GROUP_ID. */
function isAdmin(account) {
  if (!account) return false;
  if (!ADMIN_GROUP_ID) return false;
  return (Array.isArray(account.groups) ? account.groups : []).includes(ADMIN_GROUP_ID);
}

/**
 * Middleware: require the user to be authenticated.
 * No-op when AUTH_ENABLED=false.
 * API/internal paths return 401 JSON; browser paths redirect to /auth/login.
 */
function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) return next();
  if (getAccountFromSession(req)) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/internal/')) {
    return res.status(401).json({ ok: false, error: 'Authentication required.' });
  }
  req.session.returnTo = req.originalUrl;
  return res.redirect('/auth/login');
}

/**
 * Middleware: require the user to be a member of ADMIN_GROUP_ID.
 * No-op when AUTH_ENABLED=false or ADMIN_GROUP_ID is not configured.
 */
function requireAdmin(req, res, next) {
  if (!AUTH_ENABLED || !ADMIN_GROUP_ID) return next();
  const account = getAccountFromSession(req);
  if (!account) {
    return res.status(401).json({ ok: false, error: 'Authentication required.' });
  }
  if (!isAdmin(account)) {
    return res.status(403).json({ ok: false, error: 'Admin group membership required.' });
  }
  return next();
}

/** Creates and returns the Express router for /auth/* routes. */
function buildAuthRouter() {
  const { Router } = require('express');
  const router = Router();

  // GET /auth/login  – initiate MSAL auth code flow
  router.get('/login', async (req, res) => {
    if (!AUTH_ENABLED) return res.redirect('/');
    const client = getMsalClient();
    if (!client) {
      return res.status(503).send(
        'Entra auth is not configured. ' +
        'Set ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET in your environment, ' +
        'or set AUTH_ENABLED=false to disable auth.'
      );
    }
    const state = crypto.randomBytes(16).toString('hex');
    req.session.authState = state;
    // Explicitly save session before redirecting to Microsoft to guarantee
    // the state is persisted before the browser leaves this origin.
    req.session.save(async (saveErr) => {
      if (saveErr) {
        console.error('[auth] session save failed:', saveErr.message);
        return res.status(500).send('Session error. Please try again.');
      }
      try {
        const url = await client.getAuthCodeUrl({
          scopes: ['openid', 'profile', 'email'],
          redirectUri: getRedirectUri(),
          state,
          prompt: 'select_account'
        });
        return res.redirect(url);
      } catch (err) {
        console.error('[auth] getAuthCodeUrl failed:', err.message);
        return res.status(500).send('Failed to initiate login. Verify ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET.');
      }
    });
  });

  // GET /auth/callback  – exchange auth code for tokens
  router.get('/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;
    if (error) {
      console.error('[auth] callback error:', error, error_description);
      return res.status(401).send(`Login failed: ${error_description || error}`);
    }
    if (!code) {
      return res.status(400).send('Missing authorization code.');
    }
    if (state !== req.session.authState) {
      console.error('[auth] state mismatch on callback — session may have expired or been lost');
      return res.status(400).send('State mismatch – please try logging in again.');
    }
    delete req.session.authState;

    const client = getMsalClient();
    if (!client) return res.status(503).send('Auth not configured.');

    try {
      const result = await client.acquireTokenByCode({
        code,
        scopes: ['openid', 'profile', 'email'],
        redirectUri: getRedirectUri()
      });

      const claims = result.idTokenClaims || {};
      req.session.account = {
        name: claims.name || result.account?.name || claims.preferred_username || 'User',
        username: claims.preferred_username || claims.upn || '',
        userId: claims.oid || claims.sub || '',
        tenantId: claims.tid || '',
        // groups claim: array of security group Object IDs from the user's home tenant
        groups: Array.isArray(claims.groups) ? claims.groups : []
      };

      const returnTo = req.session.returnTo || '/';
      delete req.session.returnTo;
      return res.redirect(returnTo);
    } catch (err) {
      console.error('[auth] acquireTokenByCode failed:', err.message);
      return res.status(500).send('Failed to complete login. Please try again.');
    }
  });

  // GET /auth/logout  – destroy session and redirect to Microsoft logout
  router.get('/logout', (req, res) => {
    req.session.destroy(() => {
      if (AUTH_ENABLED) {
        const post = encodeURIComponent(getRedirectUri().replace('/auth/callback', '/'));
        return res.redirect(
          `https://login.microsoftonline.com/common/oauth2/v2.0/logout?post_logout_redirect_uri=${post}`
        );
      }
      return res.redirect('/');
    });
  });

  return router;
}

module.exports = {
  AUTH_ENABLED,
  ADMIN_GROUP_ID,
  buildAuthRouter,
  requireAuth,
  requireAdmin,
  getAccountFromSession,
  isAdmin
};
