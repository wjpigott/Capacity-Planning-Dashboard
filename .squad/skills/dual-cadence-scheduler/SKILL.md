# Dual-Cadence Scheduler Pattern

**Domain:** Background job orchestration, scheduled ingestion pipelines  
**Technology:** Node.js, setInterval, database-persisted settings  
**Last updated:** 2026-04-21

---

## Pattern Overview

Run multiple background jobs at different frequencies with independent scheduling controls, admin UI exposure, and graceful start/stop semantics.

**Use cases:**
- Ingest data from multiple sources at different refresh rates (e.g., fast quota tracking + slow model catalog refresh)
- Separate operational tasks by cadence (e.g., hourly metrics vs. daily cleanup)
- Allow admins to tune each scheduler independently without code changes

---

## Core Principles

1. **Independent scheduler loops:** Each scheduler uses its own `setInterval` handle
2. **Database-persisted settings:** Store intervals in a settings table, fallback to environment variables
3. **Admin UI exposure:** Allow runtime changes without restarts (clear + restart scheduler loop)
4. **Zero-interval disable:** `intervalMinutes=0` stops the scheduler without removing code
5. **Graceful restart:** Clearing old handle before starting new one prevents duplicate executions

---

## Implementation Pattern

### 1. Scheduler State Management

```javascript
// Global state for each scheduler
let schedulerHandleFast;
let schedulerHandleSlow;

const schedulerConfigFast = {
  intervalMinutes: 0,
  runOnStartup: false
};

const schedulerConfigSlow = {
  intervalMinutes: 0,
  runOnStartup: false
};

const statusFast = {
  inProgress: false,
  lastRunUtc: null,
  lastSuccessUtc: null,
  lastError: null
};

const statusSlow = {
  inProgress: false,
  lastRunUtc: null,
  lastSuccessUtc: null,
  lastError: null
};
```

### 2. Scheduler Start/Update Logic

```javascript
function startFastScheduler(config = {}) {
  const intervalMinutes = Math.max(0, Math.min(Math.trunc(config.intervalMinutes || 0), 7 * 24 * 60));
  const runOnStartup = Boolean(config.runOnStartup);

  // Clear existing scheduler to prevent duplicates
  if (schedulerHandleFast) {
    clearInterval(schedulerHandleFast);
    schedulerHandleFast = null;
  }

  schedulerConfigFast.intervalMinutes = intervalMinutes;
  schedulerConfigFast.runOnStartup = runOnStartup;

  // Run immediately if requested
  if (runOnStartup && intervalMinutes > 0) {
    runFastJob().catch((err) => console.error('Fast job startup error:', err));
  }

  // Start recurring scheduler
  if (intervalMinutes > 0) {
    const intervalMs = intervalMinutes * 60 * 1000;
    schedulerHandleFast = setInterval(() => {
      runFastJob().catch((err) => console.error('Fast job error:', err));
    }, intervalMs);
    console.log(`Fast scheduler started: ${intervalMinutes} min interval`);
  } else {
    console.log('Fast scheduler disabled (interval=0)');
  }
}

function updateFastScheduler(config = {}) {
  startFastScheduler(config); // Restart with new config
}

// Repeat pattern for slow scheduler
function startSlowScheduler(config = {}) { /* ... */ }
function updateSlowScheduler(config = {}) { /* ... */ }
```

### 3. Job Execution Logic

```javascript
async function runFastJob() {
  if (statusFast.inProgress) {
    console.warn('Fast job already in progress, skipping...');
    return { skipped: true };
  }

  statusFast.inProgress = true;
  statusFast.lastRunUtc = new Date().toISOString();
  statusFast.lastError = null;
  const startTime = Date.now();

  try {
    // Do work here
    const result = await performFastWork();
    
    statusFast.lastSuccessUtc = new Date().toISOString();
    statusFast.lastDurationMs = Date.now() - startTime;
    return result;
  } catch (error) {
    statusFast.lastError = error.message;
    throw error;
  } finally {
    statusFast.inProgress = false;
  }
}

async function runSlowJob() { /* ... */ }
```

### 4. Settings Persistence (Database)

```sql
-- Settings table
CREATE TABLE dbo.DashboardSetting (
    settingKey NVARCHAR(128) NOT NULL PRIMARY KEY,
    settingValue NVARCHAR(MAX) NOT NULL,
    updatedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

-- Example settings
INSERT INTO dbo.DashboardSetting (settingKey, settingValue, updatedAtUtc)
VALUES 
  ('schedule.fast.intervalMinutes', '360', SYSUTCDATETIME()),
  ('schedule.slow.intervalMinutes', '1440', SYSUTCDATETIME());
```

```javascript
// Load effective settings (DB overrides env vars)
async function getEffectiveSchedulerSettings() {
  const defaults = {
    fast: {
      intervalMinutes: Number(process.env.FAST_INTERVAL_MINUTES || 0),
      runOnStartup: process.env.FAST_RUN_ON_STARTUP === 'true'
    },
    slow: {
      intervalMinutes: Number(process.env.SLOW_INTERVAL_MINUTES || 0),
      runOnStartup: process.env.SLOW_RUN_ON_STARTUP === 'true'
    }
  };

  try {
    const dbSettings = await getDashboardSettings('schedule.');
    return {
      fast: {
        intervalMinutes: Number(dbSettings['schedule.fast.intervalMinutes']?.value ?? defaults.fast.intervalMinutes),
        runOnStartup: dbSettings['schedule.fast.runOnStartup']?.value === 'true' ? true : defaults.fast.runOnStartup
      },
      slow: {
        intervalMinutes: Number(dbSettings['schedule.slow.intervalMinutes']?.value ?? defaults.slow.intervalMinutes),
        runOnStartup: dbSettings['schedule.slow.runOnStartup']?.value === 'true' ? true : defaults.slow.runOnStartup
      }
    };
  } catch {
    return defaults;
  }
}
```

### 5. Admin API Endpoints

```javascript
// GET /api/admin/scheduler/settings
app.get('/api/admin/scheduler/settings', requireAdmin, async (req, res) => {
  try {
    const settings = await getEffectiveSchedulerSettings();
    res.json({
      fast: {
        intervalMinutes: schedulerConfigFast.intervalMinutes,
        runOnStartup: schedulerConfigFast.runOnStartup,
        effectiveSettings: settings.fast
      },
      slow: {
        intervalMinutes: schedulerConfigSlow.intervalMinutes,
        runOnStartup: schedulerConfigSlow.runOnStartup,
        effectiveSettings: settings.slow
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/scheduler/settings
app.put('/api/admin/scheduler/settings', requireAdmin, async (req, res) => {
  try {
    const { fast, slow } = req.body;
    
    // Persist to database
    await upsertDashboardSettings({
      'schedule.fast.intervalMinutes': String(fast.intervalMinutes),
      'schedule.slow.intervalMinutes': String(slow.intervalMinutes)
    });

    // Apply runtime changes
    updateFastScheduler(fast);
    updateSlowScheduler(slow);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### 6. Startup Initialization

```javascript
async function initializeSchedulers() {
  const settings = await getEffectiveSchedulerSettings();
  
  startFastScheduler(settings.fast);
  startSlowScheduler(settings.slow);
  
  console.log('Schedulers initialized:', {
    fast: settings.fast,
    slow: settings.slow
  });
}

// Call during app startup
initializeSchedulers().catch(console.error);
```

---

## Key Design Decisions

### Why separate scheduler handles?
- **Independent lifecycles:** One scheduler failure doesn't affect the other
- **Different restart semantics:** Admin can change slow scheduler without affecting fast scheduler
- **Clearer debugging:** Logs show which scheduler triggered which job

### Why database-persisted settings?
- **No restart required:** Admin changes take effect immediately (clear + restart interval)
- **Audit trail:** `updatedAtUtc` column tracks when settings changed
- **Environment variable fallback:** Dev environments can skip database, use env vars

### Why allow `intervalMinutes=0`?
- **Feature flag pattern:** Disable scheduler without removing code
- **Operational flexibility:** Temporarily pause jobs without deployment
- **Safe defaults:** New deployments start with schedulers disabled until explicitly enabled

### Why `runOnStartup` separate from `intervalMinutes`?
- **Cold start optimization:** Run job immediately on app start, then wait full interval
- **Testing convenience:** Trigger job on startup for validation, but disable recurring runs
- **Production pattern:** Enable for quota ingestion (fast backfill), disable for model catalog (avoid startup stampede)

---

## Configuration Examples

### Development (schedulers disabled)
```bash
FAST_INTERVAL_MINUTES=0
SLOW_INTERVAL_MINUTES=0
```

### Staging (fast startup, slow recurring)
```bash
FAST_INTERVAL_MINUTES=60
FAST_RUN_ON_STARTUP=true
SLOW_INTERVAL_MINUTES=1440
SLOW_RUN_ON_STARTUP=false
```

### Production (both recurring, no startup runs)
```bash
FAST_INTERVAL_MINUTES=360
FAST_RUN_ON_STARTUP=false
SLOW_INTERVAL_MINUTES=1440
SLOW_RUN_ON_STARTUP=false
```

---

## Common Pitfalls

❌ **Forgetting to clear old interval handle before starting new one**
- Result: Multiple scheduler loops running concurrently
- Fix: Always `clearInterval(handle)` before `setInterval(...)`

❌ **Not checking `inProgress` flag before running job**
- Result: Overlapping job executions if job takes longer than interval
- Fix: Check `if (status.inProgress) { return { skipped: true }; }` at job start

❌ **Hardcoding intervals instead of persisting to database**
- Result: Admin changes require code deployment
- Fix: Store in `dbo.DashboardSetting`, expose via admin UI

❌ **Using same interval for fast and slow jobs**
- Result: Unnecessary API calls for slow-changing data (e.g., model catalogs)
- Fix: Tune each scheduler independently based on data volatility

❌ **Not validating interval bounds**
- Result: Negative intervals or intervals >7 days cause unexpected behavior
- Fix: Clamp to `[0, 10080]` (0 = disabled, max = 7 days)

---

## Testing Checklist

- [ ] Fast scheduler starts with correct interval
- [ ] Slow scheduler starts with correct interval
- [ ] Fast job runs immediately when `runOnStartup=true`
- [ ] Slow job skips startup run when `runOnStartup=false`
- [ ] Admin can change intervals via UI without restart
- [ ] Setting `intervalMinutes=0` stops scheduler
- [ ] Re-enabling scheduler (0 → N) starts new interval
- [ ] Overlapping job executions are prevented (skipped log entries)
- [ ] Database settings override environment variables
- [ ] Environment variables used when database settings missing
- [ ] Seeded setting keys match the API and UI contract exactly
- [ ] Feature-enable defaults stay aligned with the documented safe rollout state

---

## References

**Codebase examples:**
- `src/services/azureIngestionService.js` - Compute quota ingestion scheduler
- `src/services/livePlacementService.js` - Live placement refresh scheduler
- `src/server.js` (lines 593-646) - Settings management and scheduler initialization

**Related patterns:**
- Feature flag pattern (environment variable gating)
- Database-persisted configuration (settings table)
- Admin UI settings panel (runtime configuration changes)
