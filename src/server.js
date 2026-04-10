const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { getCapacityRows } = require('./services/capacityService');
const {
  runCapacityIngestion,
  getIngestionStatus,
  startIngestionScheduler
} = require('./services/azureIngestionService');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, '..')));

function requireIngestKey(req, res, next) {
  const expected = process.env.INGEST_API_KEY;
  if (!expected) {
    res.status(503).json({ error: 'Ingestion API key is not configured.' });
    return;
  }

  const provided = req.header('x-ingest-key') || req.query.key;
  if (provided !== expected) {
    res.status(401).json({ error: 'Invalid ingest key.' });
    return;
  }

  next();
}

app.get('/healthz', (_, res) => {
  res.json({ status: 'ok', service: 'capacity-dashboard-api' });
});

app.get('/api/capacity', async (req, res) => {
  try {
    const rows = await getCapacityRows({
      regionPreset: req.query.regionPreset,
      region: req.query.region,
      family: req.query.family,
      availability: req.query.availability
    });
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve capacity rows', detail: err.message });
  }
});

app.get('/api/quota/groups', (_, res) => {
  res.json({
    groups: [
      { managementGroupName: 'placeholder-mg', groupQuotaName: 'placeholder-group', provisioningState: 'Succeeded' }
    ]
  });
});

app.post('/internal/ingest/capacity', requireIngestKey, async (req, res) => {
  try {
    const result = await runCapacityIngestion({
      regionPreset: req.body?.regionPreset,
      regions: req.body?.regions,
      subscriptionIds: req.body?.subscriptionIds,
      familyFilters: req.body?.familyFilters
    });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/internal/ingest/status', requireIngestKey, (req, res) => {
  res.json({ ok: true, status: getIngestionStatus() });
});

app.get('*', (_, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'index.html'));
});

app.listen(port, () => {
  startIngestionScheduler();
  console.log(`Capacity dashboard listening on port ${port}`);
});
