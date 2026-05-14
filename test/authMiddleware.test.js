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