const test = require('node:test');
const assert = require('node:assert/strict');

const AUTH_MODULE_PATH = '../src/middleware/auth';

function loadAuthWithEnv(env) {
  const savedEnv = { ...process.env };
  Object.keys(process.env).forEach((key) => {
    delete process.env[key];
  });
  Object.assign(process.env, savedEnv, env);
  delete require.cache[require.resolve(AUTH_MODULE_PATH)];
  const auth = require(AUTH_MODULE_PATH);
  Object.keys(process.env).forEach((key) => {
    delete process.env[key];
  });
  Object.assign(process.env, savedEnv);
  delete require.cache[require.resolve(AUTH_MODULE_PATH)];
  return auth;
}

test('report access is open when auth is disabled', () => {
  const auth = loadAuthWithEnv({ AUTH_ENABLED: 'false', ADMIN_GROUP_ID: 'admin-group', REPORT_VIEWER_GROUP_IDS: 'report-group' });

  assert.equal(auth.canAccessReports(null), true);
  assert.equal(auth.canAccessAdmin(null), true);
});

test('report access stays open for authenticated users when no report viewer group is configured', () => {
  const auth = loadAuthWithEnv({ AUTH_ENABLED: 'true', ADMIN_GROUP_ID: 'admin-group', REPORT_VIEWER_GROUP_IDS: '' });

  assert.equal(auth.canAccessReports({ groups: [] }), true);
  assert.equal(auth.canAccessAdmin({ groups: [] }), false);
});

test('report viewer group restricts reports while admin group still implies report access', () => {
  const auth = loadAuthWithEnv({ AUTH_ENABLED: 'true', ADMIN_GROUP_ID: 'admin-group', REPORT_VIEWER_GROUP_IDS: 'report-group,other-report-group' });

  assert.equal(auth.canAccessReports({ groups: ['report-group'] }), true);
  assert.equal(auth.canAccessReports({ groups: ['admin-group'] }), true);
  assert.equal(auth.canAccessReports({ groups: ['unrelated-group'] }), false);
  assert.equal(auth.isReportViewer({ groups: ['other-report-group'] }), true);
});

test('group matching is case-insensitive for Entra object IDs', () => {
  const auth = loadAuthWithEnv({ AUTH_ENABLED: 'true', ADMIN_GROUP_ID: 'ABCDEF12-3456-7890-ABCD-EF1234567890', REPORT_VIEWER_GROUP_IDS: '01234567-89AB-CDEF-0123-456789ABCDEF' });

  assert.equal(auth.canAccessAdmin({ groups: ['abcdef12-3456-7890-abcd-ef1234567890'] }), true);
  assert.equal(auth.canAccessReports({ groups: ['01234567-89ab-cdef-0123-456789abcdef'] }), true);
});

test('auth diagnostics report safe group claim status without exposing group ids', () => {
  const auth = loadAuthWithEnv({ AUTH_ENABLED: 'true', ADMIN_GROUP_ID: 'admin-group' });

  assert.deepEqual(auth.buildAuthDiagnostics({
    groups: ['admin-group', 'other-group'],
    groupClaimPresent: true,
    groupOverageClaimPresent: false
  }), {
    groupCount: 2,
    groupClaimPresent: true,
    groupOverageClaimPresent: false
  });

  assert.deepEqual(auth.buildAuthDiagnostics({
    groups: [],
    groupClaimPresent: false,
    groupOverageClaimPresent: true
  }), {
    groupCount: 0,
    groupClaimPresent: false,
    groupOverageClaimPresent: true
  });
});

test('getAccountFromSession falls back to Easy Auth principal headers', () => {
  const auth = loadAuthWithEnv({ AUTH_ENABLED: 'true', ADMIN_GROUP_ID: 'admin-group' });
  const principal = Buffer.from(JSON.stringify({
    userDetails: 'user@example.com',
    userId: 'user-id',
    claims: [
      { typ: 'name', val: 'Example User' },
      { typ: 'preferred_username', val: 'user@example.com' },
      { typ: 'oid', val: 'object-id' },
      { typ: 'tid', val: 'tenant-id' },
      { typ: 'groups', val: 'admin-group' }
    ]
  })).toString('base64');

  const account = auth.getAccountFromSession({
    session: {},
    headers: { 'x-ms-client-principal': principal }
  });

  assert.equal(account.name, 'Example User');
  assert.equal(account.username, 'user@example.com');
  assert.equal(account.userId, 'object-id');
  assert.equal(account.tenantId, 'tenant-id');
  assert.equal(auth.canAccessAdmin(account), true);
});