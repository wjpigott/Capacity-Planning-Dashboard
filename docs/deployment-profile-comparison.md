# Capacity Dashboard Deployment Profiles

The same web package and React bundle serve both deployment profiles. The App Service setting `CAPACITY_DEPLOYMENT_PROFILE` selects the active API surface and UI at runtime.

```mermaid
flowchart TB
    Package[Shared repository and web package\nReact UI + Express API + Function worker]
    Profile{CAPACITY_DEPLOYMENT_PROFILE}
    Package --> Profile

    subgraph Lite[Lite: database-free reporting]
        direction TB
        LiteWeb[App Service\nLite UI and API]
        LiteWorker[Function App worker\nReport snapshot + live placement]
        LiteStorage[Storage account\nlatest.json + scope.json\nFunction host state]
        Azure[Azure Resource Manager\nCompute and Quota APIs]
        LiteWeb --> LiteWorker
        LiteWorker --> LiteStorage
        LiteWorker --> Azure
        LiteWeb --> Azure
        LiteNote[No Azure SQL\nNo Key Vault required\nNo scheduler, history, quota apply]
    end

    subgraph Full[Full: persistent planning platform]
        direction TB
        FullWeb[App Service\nFull UI and API]
        FullWorker[Function App worker\nIngestion + live tools]
        Sql[Azure SQL Database\nSessions, snapshots, history,\nscheduler and quota plans]
        Vault[Key Vault\nCentralized deployment/runtime secrets]
        AzureFull[Azure Resource Manager\nCompute, Quota, Cost APIs]
        FullWeb --> FullWorker
        FullWeb --> Sql
        FullWorker --> Sql
        FullWeb --> Vault
        FullWorker --> AzureFull
        FullNote[Includes ingestion scheduling, history,\nquota planning/apply, and server XLSX exports]
    end

    Profile -->|lite| LiteWeb
    Profile -->|full| FullWeb
```

## Feature Boundary

| Capability | Lite | Full |
| --- | --- | --- |
| Capacity Grid and Region Matrix | Worker-generated Blob snapshot | SQL-backed current state |
| Capacity Spot Score and Recommender | Supported | Supported |
| Runtime Azure scope | `scope.json` plus RBAC | Deployment and scheduler configuration |
| Exports | Snapshot-filtered CSV | Client CSV and server CSV/XLSX |
| Historical analytics and scheduler | Not included | Included |
| Quota planning, simulation, and apply | Not included | Included |
| Azure SQL | Not deployed | Required |
| Key Vault | Optional hardening only | Used by the deployment/runtime design |