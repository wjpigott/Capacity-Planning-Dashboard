const { getWorkerAuthHeaders } = require('./workerAuthService');

function resolveWorkerBaseUrl() {
  return String(process.env.CAPACITY_WORKER_BASE_URL || '').trim().replace(/\/$/, '');
}

async function requestSnapshot({ refresh = false, services = ['All'], includeCapabilities = true } = {}) {
  const baseUrl = resolveWorkerBaseUrl();
  if (!baseUrl) {
    throw new Error('PaaS database quota snapshots require a configured Function worker.');
  }

  const controller = new AbortController();
  const timeoutMs = refresh ? 600000 : Math.max(Number(process.env.CAPACITY_WORKER_TIMEOUT_MS || 60000), 1000);
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/paas-db-quota-snapshot`, {
      method: refresh ? 'POST' : 'GET',
      headers: refresh
        ? { ...(await getWorkerAuthHeaders()), 'Content-Type': 'application/json' }
        : await getWorkerAuthHeaders(),
      body: refresh ? JSON.stringify({ services, includeCapabilities }) : undefined,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.detail || payload?.error || `PaaS database quota worker failed with status ${response.status}.`);
    }

    const snapshot = payload.snapshot || null;
    return {
      ok: true,
      source: 'worker-snapshot',
      capturedAtUtc: snapshot?.capturedAtUtc || null,
      rows: Array.isArray(snapshot?.rows) ? snapshot.rows : [],
      summary: snapshot?.summary || {},
      facets: null,
      metadata: snapshot?.metadata || null
    };
  } catch (error) {
    const prefix = error?.name === 'AbortError'
      ? `PaaS database quota snapshot timed out after ${timeoutMs}ms`
      : 'PaaS database quota snapshot request failed';
    throw new Error(`${prefix}: ${error.message}`);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

module.exports = {
  getLitePaaSDatabaseQuotaSnapshot: () => requestSnapshot(),
  refreshLitePaaSDatabaseQuotaSnapshot: (options) => requestSnapshot({ refresh: true, ...options })
};