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
 * Tenant-scoped: authority uses ENTRA_TENANT_ID so only users in the configured
 * tenant directory (members + guests) can sign in.
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
const ENTRA_TENANT_ID = (process.env.ENTRA_TENANT_ID || '').trim();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_MAX_PENDING = 5;

let _msalClient = null;

function getMsalClient() {
  if (_msalClient) return _msalClient;
  const clientId = process.env.ENTRA_CLIENT_ID;
  const clientSecret = process.env.ENTRA_CLIENT_SECRET;
  if (!clientId || !clientSecret || !ENTRA_TENANT_ID) return null;
  _msalClient = new ConfidentialClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${ENTRA_TENANT_ID}`,
      clientSecret
    }
  });
  return _msalClient;
}

function getRedirectUri() {
  return process.env.AUTH_REDIRECT_URI || 'http://localhost:3000/auth/callback';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAuthPage(res, statusCode, title, message, detail) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeDetail = detail ? escapeHtml(detail) : '';
  return res.status(statusCode).type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    body { margin: 0; font-family: Segoe UI, Arial, sans-serif; background: #f4f7fb; color: #16324f; }
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { max-width: 640px; background: #fff; border: 1px solid #d7e1ea; border-radius: 12px; padding: 32px; box-shadow: 0 10px 30px rgba(0, 44, 88, 0.08); }
    h1 { margin: 0 0 12px; font-size: 28px; }
    p { margin: 0 0 12px; line-height: 1.5; }
    .detail { color: #52667a; font-size: 14px; }
    a { color: #005a9c; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
      ${safeDetail ? `<p class="detail">${safeDetail}</p>` : ''}
      <p><a href="/">Return to dashboard</a></p>
    </div>
  </div>
</body>
</html>`);
}

function renderAccessDenied(res, detail) {
  return renderAuthPage(
    res,
    403,
    'You do not have access',
    'Your account is not permitted to sign in to this dashboard. Contact the dashboard owner if you believe you should have access.',
    detail
  );
}

function renderExpiredLogin(res) {
  return renderAuthPage(
    res,
    400,
    'Sign-in expired',
    'Your sign-in attempt expired or could not be verified. Please start the sign-in process again.',
    null
  );
}

function isAccessDeniedError(errorCode, errorDescription) {
  const text = `${errorCode || ''} ${errorDescription || ''}`.toLowerCase();
  return text.includes('access_denied') ||
    text.includes('not assigned') ||
    text.includes('not authorized') ||
    text.includes('isn\'t assigned to') ||
    text.includes('needs to be assigned') ||
    text.includes('not found in the directory') ||
    text.includes('user account from identity provider');
}

/** Parses a named value from the raw Cookie request header without cookie-parser. */
function readCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function getOAuthStateCookieBaseOptions() {
  const redirectUri = getRedirectUri();
  const usesHttpsCallback = /^https:\/\//i.test(redirectUri);
  return {
    httpOnly: true,
    // form_post callback is a cross-site top-level POST from login.microsoftonline.com.
    // SameSite=Lax can drop cookies on POST, causing state mismatch.
    secure: usesHttpsCallback || process.env.NODE_ENV === 'production',
    sameSite: usesHttpsCallback ? 'none' : 'lax',
    path: '/'
  };
}

function parseOAuthStateList(rawValue) {
  if (!rawValue) return [];
  return String(rawValue)
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => /^[a-f0-9]{32}$/.test(v))
    .slice(-OAUTH_STATE_MAX_PENDING);
}

function writeOAuthStateList(res, states) {
  const sanitized = parseOAuthStateList((states || []).join(','));
  if (sanitized.length === 0) {
    res.clearCookie('oauth_state', getOAuthStateCookieBaseOptions());
    return;
  }
  res.cookie('oauth_state', sanitized.join(','), {
    ...getOAuthStateCookieBaseOptions(),
    maxAge: OAUTH_STATE_TTL_MS
  });
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
  console.log(`[auth:requireAuth] path=${req.path}, AUTH_ENABLED=${AUTH_ENABLED}, hasAccount=${!!getAccountFromSession(req)}`);
  if (!AUTH_ENABLED) return next();
 if (getAccountFromSession(req)) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/internal/')) {
    return res.status(401).json({ ok: false, error: 'Authentication required.' });
  }
  console.log(`[auth:requireAuth] redirecting ${req.path} to /auth/login`);
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

  async function handleAuthCallback(req, res) {
    const callbackPayload = req.method === 'POST' ? req.body : req.query;
    const { code, state, error, error_description } = callbackPayload || {};
    if (error) {
      console.error('[auth] callback error:', error, error_description);
      if (isAccessDeniedError(error, error_description)) {
        return renderAccessDenied(res, error_description || error);
      }
      return renderAuthPage(
        res,
        401,
        'Sign-in failed',
        'The dashboard could not complete your sign-in request.',
        error_description || error
      );
    }
    if (!code) {
      return renderAuthPage(
        res,
        400,
        'Sign-in failed',
        'The identity provider did not return an authorization code.',
        null
      );
    }
    const callbackState = String(state || '').trim().toLowerCase();
    const pendingStates = parseOAuthStateList(readCookie(req, 'oauth_state'));
    if (!callbackState || pendingStates.length === 0 || !pendingStates.includes(callbackState)) {
      console.error('[auth] state mismatch on callback — cookie may have expired or been lost');
      return renderExpiredLogin(res);
    }
    writeOAuthStateList(res, pendingStates.filter((s) => s !== callbackState));

    const client = getMsalClient();
    if (!client) {
      return renderAuthPage(
        res,
        503,
        'Sign-in unavailable',
        'Authentication is not configured for this dashboard right now.',
        null
      );
    }

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

      let returnTo = req.session.returnTo || '/';
      // Don't redirect to API endpoints — this prevents accidental 401 responses
      // from being displayed as pages. Always go to home if returnTo looks suspicious.
      if (returnTo.startsWith('/api/') || returnTo.startsWith('/internal/')) {
        returnTo = '/';
      }
      delete req.session.returnTo;
      // Explicitly save session before redirecting to ensure account is persisted
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('[auth] session save failed:', saveErr.message);
          return renderAuthPage(
            res,
            500,
            'Sign-in failed',
            'The dashboard could not save your sign-in session. Please try again.',
            null
          );
        }
        return res.redirect(returnTo);
      });
    } catch (err) {
      console.error('[auth] acquireTokenByCode failed:', err.message);
      return renderAuthPage(
        res,
        500,
        'Sign-in failed',
        'The dashboard could not complete your sign-in request. Please try again.',
        err.message
      );
    }
  }

  // GET /auth/login  – initiate MSAL auth code flow
  router.get('/login', async (req, res) => {
    if (!AUTH_ENABLED) return res.redirect('/');
    const client = getMsalClient();
    if (!client) {
      return res.status(503).send(
        'Entra auth is not configured. ' +
        'Set ENTRA_CLIENT_ID, ENTRA_TENANT_ID, and ENTRA_CLIENT_SECRET in your environment, ' +
        'or set AUTH_ENABLED=false to disable auth.'
      );
    }
    const state = crypto.randomBytes(16).toString('hex');
    // Keep a short rolling list of pending states to tolerate users opening
    // multiple login tabs or retrying quickly without causing false mismatches.
    const pendingStates = parseOAuthStateList(readCookie(req, 'oauth_state'));
    const nextStates = pendingStates
      .filter((s) => s !== state)
      .concat(state)
      .slice(-OAUTH_STATE_MAX_PENDING);
    writeOAuthStateList(res, nextStates);
    try {
      const url = await client.getAuthCodeUrl({
        scopes: ['openid', 'profile', 'email'],
        redirectUri: getRedirectUri(),
        state,
        responseMode: 'form_post',
        prompt: 'select_account'
      });
      return res.redirect(url);
    } catch (err) {
      console.error('[auth] getAuthCodeUrl failed:', err.message);
      return res.status(500).send('Failed to initiate login. Verify ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET.');
    }
  });

  // Callback supports both POST (preferred form_post mode) and legacy GET mode.
  router.post('/callback', handleAuthCallback);
  router.get('/callback', handleAuthCallback);

  // GET /auth/logout  – destroy session and redirect to Microsoft logout
  router.get('/logout', (req, res) => {
    req.session.destroy(() => {
      if (AUTH_ENABLED) {
        const post = encodeURIComponent(getRedirectUri().replace('/auth/callback', '/'));
        const tenant = ENTRA_TENANT_ID || 'common';
        return res.redirect(
          `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/logout?post_logout_redirect_uri=${post}`
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
