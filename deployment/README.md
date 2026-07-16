# Self-Hosted Lite Deployment Bundle

`bin\app` is a clean staging directory for a self-hosted Capacity Dashboard Lite installation. Zip the contents of `bin\app`, not the `bin` directory itself.

The bundle includes the Node dashboard and the PowerShell Azure Functions worker. It deliberately excludes `node_modules`, local settings, credentials, certificates, Azurite state, and captured report data.

## Create the bundle

From the repository root:

```powershell
.\deployment\New-SelfHostedLiteBundle.ps1
Compress-Archive -Path .\deployment\bin\app\* -DestinationPath .\deployment\bin\CapacityDashboardLite.zip -Force
```

## Target prerequisites

- Node.js LTS
- PowerShell 7
- Azure Functions Core Tools v4
- Azurite
- Az PowerShell modules required by `functions\CapacityWorker\requirements.psd1`

## Target configuration

1. Extract the archive to `C:\CapacityDashboard\app`.
2. Copy `functions\CapacityWorker\local.settings.sample.json` to `functions\CapacityWorker\local.settings.json`.
3. Configure a unique `WORKER_SHARED_SECRET`, Azure scope, local data path, and the unattended service identity when applicable.
4. Run `npm install --omit=dev` in the extracted application directory.
5. Start Azurite, the Functions worker, and the dashboard as separate Windows services. See `docs\SELF-HOSTED-LITE.md` in the bundle for the required environment variables and start commands.

Keep `local.settings.json`, certificates, and the JSON data directory outside the deployment archive and source control.