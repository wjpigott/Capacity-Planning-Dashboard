const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { DefaultAzureCredential } = require('@azure/identity');
const { buildQuotaMovePlan } = require('./quotaPlanService');
const { getPowerShellCommands, ensureAzPlacementModules, resolveProjectRoot } = require('./livePlacementService');

const ARM_SCOPE = 'https://management.azure.com/.default';

function getQuotaApplyManagedIdentityClientId() {
  return process.env.QUOTA_APPLY_MSI_CLIENT_ID
    || process.env.QUOTA_WRITE_MSI_CLIENT_ID
    || process.env.INGEST_MSI_CLIENT_ID
    || process.env.AZURE_CLIENT_ID
    || process.env.SQL_MSI_CLIENT_ID;
}

function getQuotaApplyCredential() {
  const managedIdentityClientId = getQuotaApplyManagedIdentityClientId();
  return new DefaultAzureCredential({ managedIdentityClientId });
}

async function getQuotaApplyBearerToken() {
  const credential = getQuotaApplyCredential();
  const token = await credential.getToken(ARM_SCOPE);
  if (!token?.token) {
    throw new Error('Azure credential did not return an ARM bearer token for quota apply.');
  }

  return token.token;
}

function getQuotaApplyScriptPath() {
  return path.resolve(resolveProjectRoot(), 'tools', 'Get-AzVMAvailability', 'Apply-QuotaGroupMove.ps1');
}

function ensureArtifactsDirectory() {
  const outputDir = path.resolve(resolveProjectRoot(), 'artifacts', 'quota-group-apply');
  fs.mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

function formatTimestamp(date = new Date()) {
  const datePart = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('');
  const timePart = [String(date.getHours()).padStart(2, '0'), String(date.getMinutes()).padStart(2, '0'), String(date.getSeconds()).padStart(2, '0')].join('');
  return `${datePart}-${timePart}`;
}

function escapeCsvValue(value) {
  const text = String(value == null ? '' : value);
  if (!/[",\r\n]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsvFile(filePath, rows) {
  const headers = Object.keys(rows[0] || {});
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    lines.push(headers.map((header) => escapeCsvValue(row[header])).join(','));
  });
  fs.writeFileSync(filePath, `${lines.join('\r\n')}\r\n`, 'utf8');
}

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function formatOutputPreview(label, value, maxLength = 1200) {
  const text = String(value || '').trim();
  if (!text) {
    return `${label}: <empty>`;
  }

  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return `${label}: ${normalized}`;
  }

  return `${label}: ${normalized.slice(0, maxLength)}... [truncated ${normalized.length - maxLength} chars]`;
}

async function runPowerShellProbe(command, { scriptPath, cwd, env }) {
  const modulePath = path.join(path.dirname(scriptPath), 'AzVMAvailability', 'AzVMAvailability.psd1');
  const probeScript = [
    `$scriptPath = '${scriptPath.replace(/'/g, "''")}'`,
    `$modulePath = '${modulePath.replace(/'/g, "''")}'`,
    '[pscustomobject]@{',
    '  psEdition = $PSVersionTable.PSEdition',
    '  psVersion = $PSVersionTable.PSVersion.ToString()',
    '  workingDirectory = (Get-Location).Path',
    '  scriptExists = Test-Path -LiteralPath $scriptPath',
    '  moduleExists = Test-Path -LiteralPath $modulePath',
    '} | ConvertTo-Json -Compress'
  ].join('; ');

  try {
    const { stdout, stderr } = await execFileAsync(command, [
      '-NoLogo',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      probeScript
    ], {
      cwd,
      env,
      maxBuffer: 512 * 1024
    });

    return [formatOutputPreview('probe.stdout', stdout, 600), formatOutputPreview('probe.stderr', stderr, 600)].join(' | ');
  } catch (error) {
    return [
      `probe.error: ${String(error?.message || 'unknown probe failure').trim()}`,
      formatOutputPreview('probe.stdout', error?.stdout, 600),
      formatOutputPreview('probe.stderr', error?.stderr, 600)
    ].join(' | ');
  }
}

function parseJsonFromMixedOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      return null;
    }
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

function augmentQuotaApplyErrorMessage(message) {
  const text = String(message || '').trim();
  if (!text || !/\(403\) Forbidden/i.test(text)) {
    return text;
  }

  return `${text} Quota apply is using an ARM token, but the selected managed identity does not appear to have Microsoft.Quota write access. Configure QUOTA_APPLY_MSI_CLIENT_ID or QUOTA_WRITE_MSI_CLIENT_ID to a managed identity with quota-group write permissions for the target management group and subscriptions.`;
}

function normalizeApplyRows(planRows = []) {
  return planRows.map((row) => ({
    CapturedAtUtc: row.sourceCapturedAtUtc || '',
    ManagementGroupId: row.managementGroupId || '',
    GroupQuotaName: row.groupQuotaName || '',
    SubscriptionName: row.donorSubscriptionName || '',
    SubscriptionId: row.donorSubscriptionId || '',
    Region: row.region || '',
    ResourceProviderName: 'Microsoft.Compute',
    QuotaName: row.quotaName || '',
    SubscriptionCurrentValue: Number(row.donorQuotaCurrent || 0),
    SubscriptionLimit: Number(row.donorQuotaLimit || row.currentGroupLimit || 0),
    SubscriptionAvailable: Number(row.donorAvailableBefore || 0),
    SuggestedMovable: Number(row.transferAmount || 0),
    CurrentGroupLimit: Number(row.currentGroupLimit || row.donorQuotaLimit || 0),
    GroupShareableQuota: '',
    GroupProvisioningState: '',
    ProposedLimit: Number(row.proposedLimit || 0),
    InGroup: 'True',
    ReadyToApply: row.readyToApply === false ? 'False' : 'True',
    PlanStatus: row.planStatus || 'Ready'
  }));
}

async function runQuotaApplyScript({ planFile, managementGroupId, groupQuotaName, reportPath, maxChanges }) {
  const scriptPath = getQuotaApplyScriptPath();
  const powerShellRuntime = await getPowerShellCommands();
  const quotaBearerToken = await getQuotaApplyBearerToken();
  const runtimeFailures = [];

  for (const command of powerShellRuntime.commands) {
    try {
      const env = await ensureAzPlacementModules(command).catch(() => ({ ...process.env }));
      const scriptEnv = {
        ...env,
        CAPACITY_QUOTA_BEARER_TOKEN: quotaBearerToken
      };
      const { stdout, stderr } = await execFileAsync(command, [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-PlanFile',
        planFile,
        '-QuotaGroupManagementGroupName',
        managementGroupId,
        '-QuotaGroupName',
        groupQuotaName,
        '-QuotaGroupReportPath',
        reportPath,
        '-QuotaGroupForceConfirm',
        '-QuotaGroupApplyMaxChanges',
        String(maxChanges),
        '-JsonOutput'
      ], {
        cwd: resolveProjectRoot(),
        env: scriptEnv,
        maxBuffer: 2 * 1024 * 1024
      });

      const parsed = parseJsonFromMixedOutput(stdout);
      if (!parsed) {
        const probeSummary = await runPowerShellProbe(command, {
          scriptPath,
          cwd: resolveProjectRoot(),
          env: scriptEnv
        });
        runtimeFailures.push([
          `runtime=${command}`,
          `script=${scriptPath}`,
          formatOutputPreview('stdout', stdout),
          formatOutputPreview('stderr', stderr),
          probeSummary
        ].join(' | '));
        continue;
      }

      return parsed;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        runtimeFailures.push(`runtime=${command} | error=ENOENT`);
        continue;
      }

      runtimeFailures.push([
        `runtime=${command}`,
        formatOutputPreview('stderr', error?.stderr),
        formatOutputPreview('stdout', error?.stdout),
        `error=${String(error?.message || 'Quota apply failed.').trim()}`
      ].join(' | '));
    }
  }

  if (runtimeFailures.length > 0) {
    throw new Error(augmentQuotaApplyErrorMessage(`Quota apply failed across all PowerShell runtimes. ${runtimeFailures.join(' || ')}`));
  }

  throw new Error('Quota apply failed: no supported PowerShell executable was found.');
}

async function applyQuotaMovePlan(filters = {}) {
  const plan = await buildQuotaMovePlan(filters);
  if (!Array.isArray(plan.planRows) || plan.planRows.length === 0) {
    throw new Error('No quota move plan rows are available to apply. Build a plan first.');
  }

  const applyRows = normalizeApplyRows(plan.planRows).filter((row) => row.ReadyToApply === 'True');
  if (!applyRows.length) {
    throw new Error('No plan rows are ready to apply.');
  }

  const outputDir = ensureArtifactsDirectory();
  const planFile = path.join(outputDir, `AzVMAvailability-QuotaGroupMovePlan-${formatTimestamp()}.csv`);
  writeCsvFile(planFile, applyRows);

  const applyResponse = await runQuotaApplyScript({
    planFile,
    managementGroupId: plan.managementGroupId || filters.managementGroupId,
    groupQuotaName: plan.groupQuotaName || filters.groupQuotaName,
    reportPath: outputDir,
    maxChanges: Number(filters.maxChanges || applyRows.length || 1)
  });

  const applyResults = Array.isArray(applyResponse?.Results)
    ? applyResponse.Results.map((row) => ({
        subscriptionId: row.SubscriptionId || '',
        region: row.Region || '',
        quotaName: row.QuotaName || '',
        rowsSubmitted: Number(row.RowsSubmitted || 0),
        requestedCores: Number(row.RequestedCores || 0),
        status: row.Status || '',
        error: row.Error || ''
      }))
    : [];

  return {
    ...plan,
    applyPlanFile: planFile,
    applyReportFile: applyResponse?.ReportFile || null,
    submittedChangeCount: Number(applyResponse?.SubmittedChangeCount || 0),
    submittedRequestedCores: Number(applyResponse?.SubmittedRequestedCores || 0),
    failureCount: Number(applyResponse?.FailureCount || 0),
    applyResults
  };
}

module.exports = {
  applyQuotaMovePlan
};