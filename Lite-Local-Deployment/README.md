# Self-Hosted Lite Deployment Bundle

`bin\CapacityDashboardLite-Local` is the clean, portable installation folder for **Capacity Dashboard Lite Local**. Zip that folder's contents, not the `bin` directory itself.

The bundle includes the Node dashboard and the PowerShell Azure Functions worker. It deliberately excludes `node_modules`, local settings, credentials, certificates, Azurite state, and captured report data.

## Create the bundle

From the repository root:

```powershell
.\Lite-Local-Deployment\New-SelfHostedLiteBundle.ps1
Compress-Archive -Path .\Lite-Local-Deployment\bin\CapacityDashboardLite-Local\* -DestinationPath .\Lite-Local-Deployment\bin\CapacityDashboardLite-Local.zip -Force
```

## Target configuration

1. Extract the archive to `C:\CapacityDashboardLite-Local`.
2. Run `Install-CapacityLitePrerequisites.ps1` in PowerShell 7 to check and install required local software.
3. Run `npm ci --omit=dev` in the extracted application directory.
4. Run `Configure-CapacityLite.ps1` to create the local settings and choose Azure scope/authentication.
5. Run `Start-CapacityLite.ps1` to start Azurite, the Functions worker, and the dashboard.

The complete operator instructions, download links, and Azure RBAC requirements are in `docs\SELF-HOSTED-LITE.pdf` in the bundle.

Keep `local.settings.json`, certificates, and the JSON data directory outside the deployment archive and source control.