const { DefaultAzureCredential } = require('@azure/identity');

let workerCredential;

function getWorkerAuthMode() {
  const mode = String(process.env.CAPACITY_WORKER_AUTH_MODE || 'shared-secret').trim().toLowerCase();
  if (mode === 'entra' || mode === 'managed-identity') {
    return 'entra';
  }
  if (mode === 'function-key' || mode === 'function') {
    return 'function-key';
  }
  return 'shared-secret';
}

function getWorkerCredential() {
  if (!workerCredential) {
    const managedIdentityClientId = process.env.CAPACITY_WORKER_AUTH_CLIENT_ID
      || process.env.INGEST_MSI_CLIENT_ID
      || process.env.AZURE_CLIENT_ID
      || process.env.SQL_MSI_CLIENT_ID;
    workerCredential = new DefaultAzureCredential({ managedIdentityClientId });
  }

  return workerCredential;
}

function resolveWorkerTokenScope() {
  const audience = String(process.env.CAPACITY_WORKER_TOKEN_AUDIENCE || '').trim();
  if (!audience) {
    throw new Error('CAPACITY_WORKER_TOKEN_AUDIENCE is required when CAPACITY_WORKER_AUTH_MODE=entra.');
  }

  return audience.endsWith('/.default') ? audience : `${audience.replace(/\/$/, '')}/.default`;
}

async function getWorkerAuthHeaders() {
  const mode = getWorkerAuthMode();

  if (mode === 'entra') {
    const token = await getWorkerCredential().getToken(resolveWorkerTokenScope());
    if (!token || !token.token) {
      throw new Error('Failed to acquire Function worker Microsoft Entra token.');
    }
    return { Authorization: `Bearer ${token.token}` };
  }

  if (mode === 'function-key') {
    const functionKey = String(process.env.CAPACITY_WORKER_FUNCTION_KEY || '').trim();
    if (!functionKey) {
      throw new Error('CAPACITY_WORKER_FUNCTION_KEY is required when CAPACITY_WORKER_AUTH_MODE=function-key.');
    }
    return { 'x-functions-key': functionKey };
  }

  const sharedSecret = String(process.env.CAPACITY_WORKER_SHARED_SECRET || '').trim();
  return sharedSecret ? { 'x-capacity-worker-key': sharedSecret } : {};
}

module.exports = {
  getWorkerAuthMode,
  getWorkerAuthHeaders
};