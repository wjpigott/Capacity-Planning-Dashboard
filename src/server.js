const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { getCapacityRows } = require('./services/capacityService');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, '..')));

app.get('/healthz', (_, res) => {
  res.json({ status: 'ok', service: 'capacity-dashboard-api' });
});

app.get('/api/capacity', async (req, res) => {
  try {
    const rows = await getCapacityRows({
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

app.get('*', (_, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'index.html'));
});

app.listen(port, () => {
  console.log(`Capacity dashboard listening on port ${port}`);
});
