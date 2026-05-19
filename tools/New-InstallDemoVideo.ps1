param(
    [string]$OutputDir = (Join-Path (Join-Path $PSScriptRoot '..') 'docs\video\install-demo'),
    [string]$FfmpegPath,
    [switch]$KeepIntermediate
)

$ErrorActionPreference = 'Stop'

function Resolve-FfmpegPath {
    param([string]$RequestedPath)

    if ($RequestedPath -and (Test-Path $RequestedPath)) {
        return (Resolve-Path $RequestedPath).Path
    }

    $command = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $tempTools = Join-Path ([System.IO.Path]::GetTempPath()) 'capacity-dashboard-video-tools'
    $ffmpegStatic = Join-Path (Join-Path $tempTools 'node_modules') 'ffmpeg-static\ffmpeg.exe'
    if (Test-Path $ffmpegStatic) {
        return $ffmpegStatic
    }

    $ffmpegInstaller = Join-Path (Join-Path $tempTools 'node_modules') '@ffmpeg-installer\win32-x64\ffmpeg.exe'
    if (Test-Path $ffmpegInstaller) {
        return $ffmpegInstaller
    }

    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw 'FFmpeg was not found and npm is unavailable. Install FFmpeg or pass -FfmpegPath.'
    }

    New-Item -ItemType Directory -Path $tempTools -Force | Out-Null
    Push-Location $tempTools
    try {
        if (-not (Test-Path (Join-Path $tempTools 'package.json'))) {
            npm init -y | Out-Null
        }
        npm install ffmpeg-static --no-audit --no-fund | Out-Null
    }
    finally {
        Pop-Location
    }

    if (Test-Path $ffmpegStatic) {
        return $ffmpegStatic
    }

    Push-Location $tempTools
    try {
        npm install '@ffmpeg-installer/ffmpeg' --no-audit --no-fund | Out-Null
    }
    finally {
        Pop-Location
    }

    if (Test-Path $ffmpegInstaller) {
        return $ffmpegInstaller
    }

    throw 'No FFmpeg binary was found. Install FFmpeg or pass -FfmpegPath.'
}

function New-DirectoryClean {
    param([string]$Path)

    if (Test-Path $Path) {
        Remove-Item -Path $Path -Recurse -Force
    }

    New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Resolve-FfprobePath {
    param([string]$ResolvedFfmpegPath)

    $ffprobeCandidate = Join-Path (Split-Path -Parent $ResolvedFfmpegPath) 'ffprobe.exe'
    if (Test-Path $ffprobeCandidate) {
        return $ffprobeCandidate
    }

    $command = Get-Command ffprobe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    return $null
}

function Format-SrtTimestamp {
    param([double]$Seconds)

    $time = [TimeSpan]::FromSeconds($Seconds)
    return '{0:00}:{1:00}:{2:00},{3:000}' -f [Math]::Floor($time.TotalHours), $time.Minutes, $time.Seconds, $time.Milliseconds
}

function Split-TextLine {
    param(
        [System.Drawing.Graphics]$Graphics,
        [string]$Text,
        [System.Drawing.Font]$Font,
        [float]$MaxWidth
    )

    $words = $Text -split '\s+'
    $lines = New-Object System.Collections.Generic.List[string]
    $current = ''
    foreach ($word in $words) {
        $candidate = if ([string]::IsNullOrWhiteSpace($current)) { $word } else { "$current $word" }
        if ($Graphics.MeasureString($candidate, $Font).Width -le $MaxWidth -or [string]::IsNullOrWhiteSpace($current)) {
            $current = $candidate
        }
        else {
            $lines.Add($current)
            $current = $word
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($current)) {
        $lines.Add($current)
    }

    return $lines.ToArray()
}

function Add-WrappedText {
    param(
        [System.Drawing.Graphics]$Graphics,
        [string]$Text,
        [System.Drawing.Font]$Font,
        [System.Drawing.Brush]$Brush,
        [float]$X,
        [float]$Y,
        [float]$MaxWidth,
        [float]$LineHeight
    )

    foreach ($line in (Split-TextLine -Graphics $Graphics -Text $Text -Font $Font -MaxWidth $MaxWidth)) {
        $Graphics.DrawString($line, $Font, $Brush, $X, $Y)
        $Y += $LineHeight
    }

    return $Y
}

function New-SlideImage {
    param(
        [hashtable]$Slide,
        [int]$Index,
        [int]$Total,
        [string]$Path
    )

    Add-Type -AssemblyName System.Drawing
    $bitmap = New-Object System.Drawing.Bitmap 1920, 1080
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    $bg = [System.Drawing.Color]::FromArgb(247, 250, 252)
    $ink = [System.Drawing.Color]::FromArgb(15, 23, 42)
    $muted = [System.Drawing.Color]::FromArgb(71, 85, 105)
    $blue = [System.Drawing.Color]::FromArgb(37, 99, 235)
    $green = [System.Drawing.Color]::FromArgb(22, 163, 74)
    $panel = [System.Drawing.Color]::FromArgb(17, 24, 39)
    $terminalText = [System.Drawing.Color]::FromArgb(226, 232, 240)

    $graphics.Clear($bg)
    $graphics.FillRectangle((New-Object System.Drawing.SolidBrush $ink), 0, 0, 1920, 118)
    $graphics.FillRectangle((New-Object System.Drawing.SolidBrush $blue), 0, 118, 1920, 8)

    $fontBrand = New-Object System.Drawing.Font 'Segoe UI Semibold', 26
    $fontTitle = New-Object System.Drawing.Font 'Segoe UI Semibold', 54
    $fontSubtitle = New-Object System.Drawing.Font 'Segoe UI', 30
    $fontBullet = New-Object System.Drawing.Font 'Segoe UI', 30
    $fontTerminal = New-Object System.Drawing.Font 'Consolas', 24
    $fontSmall = New-Object System.Drawing.Font 'Segoe UI', 22

    $whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $inkBrush = New-Object System.Drawing.SolidBrush $ink
    $mutedBrush = New-Object System.Drawing.SolidBrush $muted
    $blueBrush = New-Object System.Drawing.SolidBrush $blue
    $greenBrush = New-Object System.Drawing.SolidBrush $green
    $terminalBrush = New-Object System.Drawing.SolidBrush $terminalText

    $graphics.DrawString('Capacity Planning Dashboard', $fontBrand, $whiteBrush, 84, 38)
    $graphics.DrawString("$Index / $Total", $fontSmall, $whiteBrush, 1710, 44)

    $y = 174
    $graphics.DrawString($Slide.Title, $fontTitle, $inkBrush, 84, $y)
    $y += 76
    if ($Slide.Subtitle) {
        $y = Add-WrappedText -Graphics $graphics -Text $Slide.Subtitle -Font $fontSubtitle -Brush $mutedBrush -X 88 -Y $y -MaxWidth 1660 -LineHeight 42
        $y += 28
    }

    if ($Slide.Terminal) {
        $terminalTop = [Math]::Max($y, 365)
        $terminalHeight = [Math]::Min(520, 980 - $terminalTop)
        $graphics.FillRectangle((New-Object System.Drawing.SolidBrush $panel), 88, $terminalTop, 1744, $terminalHeight)
        $graphics.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(248, 113, 113))), 118, ($terminalTop + 25), 18, 18)
        $graphics.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(250, 204, 21))), 148, ($terminalTop + 25), 18, 18)
        $graphics.FillEllipse($greenBrush, 178, ($terminalTop + 25), 18, 18)
        $terminalY = $terminalTop + 72
        foreach ($line in $Slide.Terminal) {
            $terminalY = Add-WrappedText -Graphics $graphics -Text $line -Font $fontTerminal -Brush $terminalBrush -X 126 -Y $terminalY -MaxWidth 1660 -LineHeight 34
            $terminalY += 4
        }
    }

    if ($Slide.Bullets) {
        foreach ($bullet in $Slide.Bullets) {
            $graphics.FillEllipse($blueBrush, 102, ($y + 13), 16, 16)
            $y = Add-WrappedText -Graphics $graphics -Text $bullet -Font $fontBullet -Brush $inkBrush -X 138 -Y $y -MaxWidth 1580 -LineHeight 42
            $y += 22
        }
    }

    if ($Slide.Callout) {
        $graphics.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(220, 252, 231))), 88, 900, 1744, 90)
        Add-WrappedText -Graphics $graphics -Text $Slide.Callout -Font $fontBullet -Brush (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(20, 83, 45))) -X 124 -Y 920 -MaxWidth 1660 -LineHeight 38 | Out-Null
    }

    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
}

function New-NarrationAudio {
    param(
        [string]$Text,
        [string]$Path
    )

    $voice = New-Object -ComObject SAPI.SpVoice
    $stream = New-Object -ComObject SAPI.SpFileStream
    $stream.Open($Path, 3, $false)
    $voice.AudioOutputStream = $stream
    $voice.Rate = 0
    $voice.Volume = 95
    [void]$voice.Speak($Text, 0)
    $stream.Close()

    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($stream) | Out-Null
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($voice) | Out-Null
}

$slides = @(
    @{ Title = 'Guided Install Overview'; Subtitle = 'Deploy the Capacity Planning Dashboard with the guided installer.'; Bullets = @('The wizard collects Azure, Entra, SQL, RBAC, package, and bootstrap choices.', 'It previews the deployment command before making changes.', 'This video follows the clean Terraform path.'); Narration = 'In this walkthrough, we deploy the Capacity Planning Dashboard using the guided installer. The wizard collects the Azure, Entra, SQL, RBAC, package, and bootstrap choices, then previews the deployment command before making changes.' },
    @{ Title = 'Start From Azure CLI Context'; Subtitle = 'Confirm the subscription before answering prompts.'; Terminal = @('az account show --output table', 'cd C:\repos\Capacity\Capacity-Planning-Dashboard', '.\scripts\Start-CapacityDeployment.ps1'); Narration = 'Start by confirming Azure CLI is signed into the tenant and subscription where the dashboard will be deployed. Then run the guided installer from the repository root.' },
    @{ Title = 'Choose Terraform'; Subtitle = 'Use Terraform when this environment should be Terraform-managed from the start.'; Terminal = @('Which infrastructure provider should be used?', '  1. [*] Bicep', '  2. [ ] Terraform', 'Choose 1-2 [Bicep]: 2', 'Optional parameter/tfvars file path:'); Callout = 'For a clean demo, leave the optional tfvars path blank.'; Narration = 'The wizard supports Bicep and Terraform. Choose Terraform when the environment should be managed by Terraform from the start. For a clean demo, use a fresh suffix and leave the optional tfvars path blank.' },
    @{ Title = 'Name The Environment'; Subtitle = 'Subscription, region, environment, and suffix shape the generated resource names.'; Terminal = @('Resource group name: CapacityPlanning', 'Azure region for new resources [centralus]:', 'Environment label? dev', 'Workload suffix for generated resource names [demo001]: dev97', 'Randomize the workload suffix if an App Service host name is already taken? (Y/n): y'); Narration = 'The environment and workload suffix become part of the generated names. Keep suffix randomization enabled so the installer can recover if an App Service host name is already taken.' },
    @{ Title = 'Configure Entra Sign-In'; Subtitle = 'Use the prepared app registration and callback URL.'; Bullets = @('Enable Entra sign-in.', 'Accept the generated callback URL unless the customer has a custom host.', 'Allow the wrapper to add the callback only if the identity can update the app registration.', 'Confirm the app registration emits Security Group Object IDs in the ID token.'); Narration = 'The dashboard uses Microsoft Entra sign-in. Use the prepared app registration, accept the generated callback URL for the deployed app, and confirm the token configuration emits Security Group Object IDs in the ID token.' },
    @{ Title = 'Reuse Access Groups'; Subtitle = 'Resolve the built-in admin and report viewer groups.'; Terminal = @('How should dashboard access groups be configured?', '  1. [*] Reuse CapacityAdmin/CapacityReportViewers', 'Choose 1-3 [Reuse CapacityAdmin/CapacityReportViewers]:', 'Resolved CapacityAdmin and CapacityReportViewers group object IDs.'); Narration = 'For the standard path, reuse CapacityAdmin and CapacityReportViewers. Admin access and report viewer access are separate, and the wizard resolves the group object IDs before deployment.' },
    @{ Title = 'Clean Demo: Create Platform Resources'; Subtitle = 'Answer no to existing resources unless you are demonstrating reuse.'; Terminal = @('Use current Azure signed-in user as SQL Entra admin? (Y/n): y', 'Does the customer already have an Azure SQL server to reuse? (y/N): n', 'Does the customer already have a Key Vault to reuse? (y/N): n', 'Does the customer already have a worker storage account to reuse? (y/N): n', 'Does the customer already have a Virtual Network to reuse? (y/N): n'); Callout = 'If you answer Y to an existing resource prompt, be ready with exact names and resource groups.'; Narration = 'For a clean recording, let the deployment create the default SQL server, Key Vault, worker storage, and networking resources. Only answer yes when you want to demonstrate reuse and have the exact resource names ready.' },
    @{ Title = 'Set RBAC Scope'; Subtitle = 'Management group scope is the clean estate-wide option.'; Terminal = @('How should Azure RBAC scope be configured?', 'Choose 1-4 [Specify management group names]:', 'Management group names for Web App Reader access: TopDemoMg', 'Management group names for worker RBAC [TopDemoMg]:', 'Grant quota write RBAC for quota apply workflows now? (y/N): y'); Narration = 'RBAC determines what the dashboard and worker can read or execute after deployment. In this demo, use a management group such as TopDemoMg for dashboard reader access, worker RBAC, and quota workflows.' },
    @{ Title = 'Secrets, Packages, Bootstrap'; Subtitle = 'Keep the clean install path enabled end to end.'; Bullets = @('Let deployment resolve or generate INGEST_API_KEY and SESSION_SECRET.', 'Generate the worker shared secret.', 'Deploy the web package after infrastructure succeeds.', 'Deploy the worker package after infrastructure succeeds.', 'Run database bootstrap through the deployed web app.'); Narration = 'For a normal clean install, let the deployment resolve or generate the application secrets, generate the worker shared secret, publish both packages, and run database bootstrap so the environment is usable at the end.' },
    @{ Title = 'Review The Preview'; Subtitle = 'The wizard shows the plan and exact wrapper command before deployment.'; Terminal = @('Deployment plan:', '  Provider: Terraform', '  ExistingSql: No', '  RbacMode: Specify management group names', 'Command preview:', '& .\scripts\deploy-infra.ps1 -Provider "Terraform" ...'); Narration = 'Before anything runs, the wizard shows the deployment plan and the exact wrapper command. Confirm the subscription, resource group, suffix, auth redirect URI, RBAC mode, package choices, and database bootstrap choice.' },
    @{ Title = 'Terraform Runs Through The Wrapper'; Subtitle = 'The wrapper passes guided answers to Terraform safely.'; Terminal = @('Running Azure CLI preflight checks...', 'Azure CLI account OK', 'Microsoft Entra group read access OK.', 'Proceed with deployment now? (y/N): y', 'Running Terraform init...', 'Terraform has been successfully initialized!', 'Running Terraform apply...'); Callout = 'The wrapper uses a generated Terraform variable file for list values like management group names.'; Narration = 'After preflight, the wrapper runs Terraform init and Terraform apply. Guided answers are passed through a generated Terraform variable file, so list values such as management group names do not require the operator to hand write Terraform syntax.' },
    @{ Title = 'Validate The Deployment'; Subtitle = 'Sign in, then confirm access interpretation.'; Terminal = @('https://app-capdash-<environment>-<suffix>.azurewebsites.net', 'https://app-capdash-<environment>-<suffix>.azurewebsites.net/api/auth/me'); Bullets = @('isAuthenticated should be true after sign-in.', 'Admins should have canAccessAdmin and canAccessReports.', 'Report viewers should have canAccessReports.', 'Diagnostics should show group claims in the token.'); Narration = 'After deployment, open the dashboard URL, sign in, and check the auth diagnostics endpoint. The quickest validation is that the app sees the signed in user, group claims are present, and admin and report access match the Entra groups.' },
    @{ Title = 'Common Pitfalls'; Subtitle = 'A few checks prevent most install issues.'; Bullets = @('Run from the repo root.', 'Confirm Azure CLI context before deploying.', 'Use a fresh suffix for Terraform-owned environments.', 'Keep App Service name randomization enabled.', 'Configure the app registration groups claim.', 'Use RBAC handoff when central teams own role assignments.'); Narration = 'Most installation issues come from the wrong folder, wrong Azure context, reused names, missing group claims, or central RBAC ownership. The guided installer is designed to surface those choices early and produce a clear handoff when another team owns part of the setup.' },
    @{ Title = 'Ready For Users'; Subtitle = 'The guided installer deploys infrastructure, app packages, and database bootstrap.'; Bullets = @('Choose Bicep or Terraform.', 'Configure Entra sign-in and access groups.', 'Choose RBAC scope.', 'Publish the web and worker packages.', 'Validate sign-in and role access.'); Narration = 'That is the guided install experience end to end. The operator chooses Bicep or Terraform, configures Entra access, selects RBAC scope, publishes the app and worker, bootstraps the database, and validates sign-in and role access.' }
)

$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
$framesDir = Join-Path $OutputDir 'frames'
$audioDir = Join-Path $OutputDir 'audio'
$segmentsDir = Join-Path $OutputDir 'segments'
New-DirectoryClean -Path $OutputDir
New-Item -ItemType Directory -Path $framesDir -Force | Out-Null
New-Item -ItemType Directory -Path $audioDir -Force | Out-Null
New-Item -ItemType Directory -Path $segmentsDir -Force | Out-Null

$resolvedFfmpeg = Resolve-FfmpegPath -RequestedPath $FfmpegPath
$resolvedFfprobe = Resolve-FfprobePath -ResolvedFfmpegPath $resolvedFfmpeg
Write-Host "Using FFmpeg: $resolvedFfmpeg"
if ($resolvedFfprobe) {
    Write-Host "Using FFprobe: $resolvedFfprobe"
}

$concatFile = Join-Path $OutputDir 'concat.txt'
$narrationFile = Join-Path $OutputDir 'install-demo-narration.txt'
$captionsFile = Join-Path $OutputDir 'install-demo-captions.srt'
Set-Content -Path $concatFile -Value '' -Encoding ASCII
Set-Content -Path $narrationFile -Value '' -Encoding UTF8
Set-Content -Path $captionsFile -Value '' -Encoding UTF8

$total = $slides.Count
$captionStartSeconds = 0.0
for ($i = 0; $i -lt $slides.Count; $i++) {
    $slideNumber = $i + 1
    $baseName = '{0:D2}' -f $slideNumber
    $imagePath = Join-Path $framesDir "$baseName.png"
    $audioPath = Join-Path $audioDir "$baseName.wav"
    $segmentPath = Join-Path $segmentsDir "$baseName.mp4"

    Write-Host "Rendering slide $slideNumber of ${total}: $($slides[$i].Title)"
    New-SlideImage -Slide $slides[$i] -Index $slideNumber -Total $total -Path $imagePath
    New-NarrationAudio -Text $slides[$i].Narration -Path $audioPath

    Add-Content -Path $narrationFile -Value ("Slide {0}: {1}`r`n{2}`r`n" -f $slideNumber, $slides[$i].Title, $slides[$i].Narration) -Encoding UTF8

    & $resolvedFfmpeg -y -loop 1 -framerate 30 -i $imagePath -i $audioPath -c:v libx264 -tune stillimage -vf 'scale=1920:1080,format=yuv420p' -c:a aac -b:a 160k -shortest $segmentPath | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "FFmpeg failed while rendering segment $slideNumber."
    }

    $segmentDuration = 10.0
    if ($resolvedFfprobe) {
        $durationText = & $resolvedFfprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $segmentPath
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($durationText)) {
            $segmentDuration = [double]::Parse($durationText.Trim(), [System.Globalization.CultureInfo]::InvariantCulture)
        }
    }

    $captionEndSeconds = $captionStartSeconds + $segmentDuration
    Add-Content -Path $captionsFile -Value ("{0}`r`n{1} --> {2}`r`n{3}`r`n" -f $slideNumber, (Format-SrtTimestamp $captionStartSeconds), (Format-SrtTimestamp $captionEndSeconds), $slides[$i].Narration) -Encoding UTF8
    $captionStartSeconds = $captionEndSeconds

    $concatPath = $segmentPath.Replace('\', '/')
    Add-Content -Path $concatFile -Value "file '$concatPath'" -Encoding ASCII
}

$videoPath = Join-Path $OutputDir 'capacity-dashboard-install-demo.mp4'
& $resolvedFfmpeg -y -f concat -safe 0 -i $concatFile -c copy $videoPath | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'FFmpeg failed while concatenating video segments.'
}

$videoItem = Get-Item $videoPath
Write-Host "Created video: $($videoItem.FullName)"
Write-Host "Size: $([Math]::Round($videoItem.Length / 1MB, 2)) MB"
Write-Host "Narration: $narrationFile"
Write-Host "Captions: $captionsFile"

if (-not $KeepIntermediate) {
    Remove-Item -Path $framesDir, $audioDir, $segmentsDir, $concatFile -Recurse -Force -ErrorAction SilentlyContinue
}
