@{
    RootModule        = 'AzPaaSAvailability.psm1'
    ModuleVersion     = '0.5.0'
    GUID              = 'b7e3f4a1-2c8d-4e5f-9a6b-1d3e5f7a9c2b'
    Author            = 'Zachary Luz'
    CompanyName       = 'Community'
    Copyright         = '(c) 2026 Zachary Luz. All rights reserved. MIT License.'
    Description       = 'Scan Azure PaaS service availability, capacity, quota, and pricing across regions. Supports SQL Database, Cosmos DB, PostgreSQL, MySQL, App Service, Container Apps, and more.'

    PowerShellVersion = '7.0'

    RequiredModules   = @('Az.Accounts')

    FunctionsToExport = @(
        'Get-AzPaaSAvailability'
        'Get-AzSqlAvailability'
        'Get-AzCosmosDBAvailability'
        'Get-AzPostgreSqlAvailability'
        'Get-AzMySqlAvailability'
        'Get-AzAppServiceAvailability'
        'Get-AzContainerAppsAvailability'
        'Get-AzAksAvailability'
        'Get-AzFunctionsAvailability'
        'Get-AzStorageAvailability'
        'Show-AzPaaSRegionMatrix'
        'Get-AzServiceTierAvailability'
        'Export-AzPaaSAvailabilityReport'
    )

    CmdletsToExport   = @()
    VariablesToExport  = @()
    AliasesToExport    = @()

    PrivateData = @{
        PSData = @{
            Tags         = @('Azure', 'PaaS', 'SQL', 'CosmosDB', 'Availability', 'Capacity', 'Quota', 'SKU')
            LicenseUri   = 'https://github.com/zacharyluz/Get-AzPaaSAvailability/blob/main/LICENSE'
            ProjectUri   = 'https://github.com/zacharyluz/Get-AzPaaSAvailability'
            ReleaseNotes = 'Initial module release — SQL Database, SQL Managed Instance, Cosmos DB.'
        }
    }
}
