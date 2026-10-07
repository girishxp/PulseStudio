# Compatible with Windows PowerShell 5.1, included with Windows 10 and 11.
$ErrorActionPreference = 'Stop'
$AppDir = $PSScriptRoot
$RootDir = Split-Path -Parent $AppDir
$env:PULSESTUDIO_PORTABLE_ROOT = $RootDir
$NodeVersion = '24.21.0'
$OsArchitecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
# Existing Windows recording dependencies provide x64 binaries. Windows on ARM
# therefore uses the same x64 application through Windows 11's app emulation.
$NodeArch = if ($OsArchitecture -match '^(AMD64|x64|ARM64)$') { 'x64' } else { '' }
$LogRoot = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [Environment]::GetFolderPath('LocalApplicationData') }
$LogDir = Join-Path $LogRoot 'PulseStudio\logs'
$CacheDir = Join-Path $LogRoot 'PulseStudio\npm'
if (-not $LogRoot) { $LogRoot = [IO.Path]::GetTempPath(); $LogDir = Join-Path $LogRoot 'PulseStudio\logs'; $CacheDir = Join-Path $LogRoot 'PulseStudio\npm' }
$LogFile = Join-Path $LogDir 'launcher.log'
$SetupWindow = $null
$SetupLabel = $null
$SetupCancelled = $false
$ClosingSetup = $false

function Write-Status([string]$Message) {
    try { $Message | Add-Content -LiteralPath $LogFile -Encoding UTF8 } catch { }
    if ($SetupLabel) {
        $SetupLabel.Text = $Message
        [System.Windows.Forms.Application]::DoEvents()
    }
}

function Open-LauncherLog {
    if (Test-Path -LiteralPath $LogFile -PathType Leaf) {
        Start-Process -FilePath 'notepad.exe' -ArgumentList ('"' + $LogFile + '"') | Out-Null
    }
}

function Close-SetupWindow {
    if ($SetupWindow) {
        $script:ClosingSetup = $true
        $SetupWindow.Close()
        $SetupWindow.Dispose()
        $script:SetupWindow = $null
        $script:SetupLabel = $null
    }
}

function Show-LaunchError([string]$Message) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $Dialog = New-Object System.Windows.Forms.Form
        $Dialog.Text = 'PulseStudio could not start'
        $Dialog.ClientSize = New-Object System.Drawing.Size(540, 270)
        $Dialog.StartPosition = 'CenterScreen'
        $Dialog.FormBorderStyle = 'FixedDialog'
        $Dialog.MaximizeBox = $false
        $Dialog.MinimizeBox = $false
        $Details = New-Object System.Windows.Forms.TextBox
        $Details.Location = New-Object System.Drawing.Point(20, 20)
        $Details.Size = New-Object System.Drawing.Size(500, 185)
        $Details.Multiline = $true
        $Details.ReadOnly = $true
        $Details.ScrollBars = 'Vertical'
        $Details.Text = $Message + "`r`n`r`nKeep the complete extracted PulseStudio folder together. Launcher log: $LogFile"
        $Dialog.Controls.Add($Details)
        $LogButton = New-Object System.Windows.Forms.Button
        $LogButton.Text = 'Open Log'
        $LogButton.Location = New-Object System.Drawing.Point(20, 225)
        $LogButton.Size = New-Object System.Drawing.Size(105, 30)
        $LogButton.Add_Click({ Open-LauncherLog })
        $Dialog.Controls.Add($LogButton)
        $HelpButton = New-Object System.Windows.Forms.Button
        $HelpButton.Text = 'Open Help'
        $HelpButton.Location = New-Object System.Drawing.Point(135, 225)
        $HelpButton.Size = New-Object System.Drawing.Size(105, 30)
        $HelpButton.Add_Click({
            $HelpPath = Join-Path $RootDir 'README.md'
            if (Test-Path -LiteralPath $HelpPath -PathType Leaf) { Start-Process -FilePath 'notepad.exe' -ArgumentList ('"' + $HelpPath + '"') | Out-Null }
        })
        $Dialog.Controls.Add($HelpButton)
        $CloseButton = New-Object System.Windows.Forms.Button
        $CloseButton.Text = 'Close'
        $CloseButton.Location = New-Object System.Drawing.Point(415, 225)
        $CloseButton.Size = New-Object System.Drawing.Size(105, 30)
        $CloseButton.DialogResult = 'OK'
        $Dialog.Controls.Add($CloseButton)
        $Dialog.AcceptButton = $CloseButton
        $Dialog.CancelButton = $CloseButton
        $Dialog.ShowDialog() | Out-Null
        $Dialog.Dispose()
    } catch {
        try {
            $Shell = New-Object -ComObject WScript.Shell
            $Shell.Popup($Message + "`r`n`r`nLauncher log: $LogFile", 0, 'PulseStudio could not start', 16) | Out-Null
        } catch { }
    }
}

function Stop-PulseStudio([string]$Message) {
    if ($SetupCancelled) { Write-Status 'PulseStudio setup was cancelled.'; Close-SetupWindow; exit 130 }
    Write-Status $Message
    Close-SetupWindow
    Show-LaunchError $Message
    exit 1
}

function Show-SetupWindow {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $script:SetupWindow = New-Object System.Windows.Forms.Form
    $SetupWindow.Text = 'PulseStudio'
    $SetupWindow.ClientSize = New-Object System.Drawing.Size(520, 200)
    $SetupWindow.StartPosition = 'CenterScreen'
    $SetupWindow.FormBorderStyle = 'FixedDialog'
    $SetupWindow.MaximizeBox = $false
    $script:SetupLabel = New-Object System.Windows.Forms.Label
    $SetupLabel.Location = New-Object System.Drawing.Point(20, 20)
    $SetupLabel.Size = New-Object System.Drawing.Size(480, 75)
    $SetupLabel.Text = 'Preparing PulseStudio from this source package...'
    $SetupWindow.Controls.Add($SetupLabel)
    $Progress = New-Object System.Windows.Forms.ProgressBar
    $Progress.Location = New-Object System.Drawing.Point(20, 105)
    $Progress.Size = New-Object System.Drawing.Size(480, 18)
    $Progress.Style = 'Marquee'
    $SetupWindow.Controls.Add($Progress)
    $LogButton = New-Object System.Windows.Forms.Button
    $LogButton.Text = 'Open Setup Log'
    $LogButton.Location = New-Object System.Drawing.Point(20, 145)
    $LogButton.Size = New-Object System.Drawing.Size(130, 32)
    $LogButton.Add_Click({ Open-LauncherLog })
    $SetupWindow.Controls.Add($LogButton)
    $CancelButton = New-Object System.Windows.Forms.Button
    $CancelButton.Text = 'Cancel Setup'
    $CancelButton.Location = New-Object System.Drawing.Point(370, 145)
    $CancelButton.Size = New-Object System.Drawing.Size(130, 32)
    $CancelButton.Add_Click({ $script:SetupCancelled = $true })
    $SetupWindow.Controls.Add($CancelButton)
    $SetupWindow.Add_FormClosing({
        if (-not $script:ClosingSetup) { $_.Cancel = $true; $script:SetupCancelled = $true }
    })
    $SetupWindow.Show()
    [System.Windows.Forms.Application]::DoEvents()
}

function Assert-SetupActive {
    if ($SetupWindow) { [System.Windows.Forms.Application]::DoEvents() }
    if ($SetupCancelled) { throw 'PulseStudio setup was cancelled.' }
}

function ConvertTo-WindowsArgument([string]$Argument) {
    # ProcessStartInfo.Arguments follows Windows argv rules, without cmd.exe.
    $Builder = New-Object System.Text.StringBuilder
    [void]$Builder.Append('"')
    $Backslashes = 0
    foreach ($Character in $Argument.ToCharArray()) {
        if ($Character -eq '\') { $Backslashes++ }
        elseif ($Character -eq '"') {
            [void]$Builder.Append(('\' * (2 * $Backslashes + 1)))
            [void]$Builder.Append('"')
            $Backslashes = 0
        } else {
            [void]$Builder.Append(('\' * $Backslashes))
            [void]$Builder.Append($Character)
            $Backslashes = 0
        }
    }
    [void]$Builder.Append(('\' * (2 * $Backslashes)))
    [void]$Builder.Append('"')
    return $Builder.ToString()
}

function Stop-SetupProcess([System.Diagnostics.Process]$Process) {
    if (-not $Process) { return }
    try { if ($Process.HasExited) { return } } catch { return }
    $KillInfo = New-Object System.Diagnostics.ProcessStartInfo
    $KillInfo.FileName = Join-Path $env:SystemRoot 'System32\taskkill.exe'
    $KillInfo.Arguments = '/PID ' + [string]$Process.Id + ' /T /F'
    $KillInfo.UseShellExecute = $false
    $KillInfo.CreateNoWindow = $true
    $KillProcess = [System.Diagnostics.Process]::Start($KillInfo)
    if (-not $KillProcess.WaitForExit(5000)) { $KillProcess.Kill() }
    $KillProcess.Dispose()
}

function Invoke-LoggedCommand([string]$Command, [string[]]$Arguments, [int]$MaximumSuccessCode = 0, [int]$TimeoutMs = 300000, [string]$Status = 'Preparing PulseStudio') {
    # Every setup operation has a deadline and owns its child process tree.
    $SetupRunner = Join-Path $AppDir 'setup-runner.cjs'
    if (-not $NodeExe -or -not (Test-Path -LiteralPath $SetupRunner -PathType Leaf)) { throw 'The bounded setup runner is unavailable. Extract the complete ZIP again.' }
    $RunnerArguments = @($SetupRunner, '--timeout-ms', [string]$TimeoutMs, '--progress-ms', '15000', '--status', $Status, '--', $Command) + $Arguments
    Assert-SetupActive
    Write-Status $Status
    $StartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $StartInfo.FileName = $NodeExe
    $StartInfo.Arguments = (($RunnerArguments | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join ' ')
    $StartInfo.WorkingDirectory = $AppDir
    $StartInfo.UseShellExecute = $false
    $StartInfo.CreateNoWindow = $true
    $StartInfo.RedirectStandardOutput = $true
    $StartInfo.RedirectStandardError = $true
    $Process = New-Object System.Diagnostics.Process
    $Process.StartInfo = $StartInfo
    try {
        if (-not $Process.Start()) { throw 'The setup process could not start.' }
        $OutputTask = $Process.StandardOutput.ReadLineAsync()
        $ErrorTask = $Process.StandardError.ReadLineAsync()
        $Deadline = (Get-Date).AddMilliseconds($TimeoutMs + 10000)
        while (-not $Process.HasExited -or $OutputTask -or $ErrorTask) {
            Assert-SetupActive
            if ((Get-Date) -gt $Deadline) { throw "Setup timed out while $Status. Check internet access, then launch again." }
            if ($OutputTask -and $OutputTask.IsCompleted) {
                $Line = $OutputTask.GetAwaiter().GetResult()
                $OutputTask = $null
                if ($null -ne $Line) {
                    $Line | Add-Content -LiteralPath $LogFile -Encoding UTF8
                    if ($Line.StartsWith('PULSE_STATUS: ')) { Write-Status $Line.Substring(14) }
                    $OutputTask = $Process.StandardOutput.ReadLineAsync()
                }
            }
            if ($ErrorTask -and $ErrorTask.IsCompleted) {
                $Line = $ErrorTask.GetAwaiter().GetResult()
                $ErrorTask = $null
                if ($null -ne $Line) {
                    $Line | Add-Content -LiteralPath $LogFile -Encoding UTF8
                    $ErrorTask = $Process.StandardError.ReadLineAsync()
                }
            }
            Start-Sleep -Milliseconds 100
        }
        $Process.WaitForExit()
        $script:CommandExitCode = $Process.ExitCode
    } finally {
        Stop-SetupProcess $Process
        $Process.Dispose()
    }
    if ($script:CommandExitCode -eq 124) { throw "Setup timed out after $([int]($TimeoutMs / 1000)) seconds while $Status. Check internet access, then launch again." }
    if ($script:CommandExitCode -lt 0 -or $script:CommandExitCode -gt $MaximumSuccessCode) { throw "Command failed with exit code $script:CommandExitCode." }
}

function Invoke-SetupDownload([string]$Uri, [string]$Destination, [int]$TimeoutSec) {
    Assert-SetupActive
    $Job = Start-Job -ArgumentList $Uri, $Destination, $TimeoutSec -ScriptBlock {
        param($DownloadUri, $DownloadPath, $DownloadTimeout)
        $ErrorActionPreference = 'Stop'
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $DownloadUri -OutFile $DownloadPath -TimeoutSec $DownloadTimeout
    }
    try {
        $Deadline = (Get-Date).AddSeconds($TimeoutSec + 10)
        while ($Job.State -in @('Running', 'NotStarted')) {
            Assert-SetupActive
            if ((Get-Date) -gt $Deadline) { throw 'The runtime download timed out. Check internet access, then launch again.' }
            Start-Sleep -Milliseconds 100
        }
        Receive-Job -Job $Job -ErrorAction Stop | Out-Null
        if ($Job.State -ne 'Completed') { throw 'The runtime download did not complete.' }
    } finally {
        if ($Job.State -in @('Running', 'NotStarted')) { Stop-Job -Job $Job }
        Remove-Job -Job $Job -Force -ErrorAction SilentlyContinue
    }
}

function Read-Stamp([string]$Path) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) { return (Get-Content -LiteralPath $Path -Raw).Trim() }
    return ''
}

function Open-PulseStudio([string]$Executable) {
    Assert-SetupActive
    Write-Status 'Starting PulseStudio...'
    Close-SetupWindow
    Start-Process -FilePath $Executable -WorkingDirectory (Split-Path -Parent $Executable) | Out-Null
    exit 0
}

function Get-LegacyOuterRoot {
    $Ancestor = Get-Item -LiteralPath $RootDir
    $OuterRoot = ''
    while ($Ancestor) {
        if ($Ancestor.Name -eq '.pulsestudio-runtime-windows' -and $Ancestor.Parent -and $Ancestor.Parent.Name -eq 'app') {
            $OuterRoot = $Ancestor.Parent.Parent.FullName
            break
        }
        $Ancestor = $Ancestor.Parent
    }
    return $OuterRoot
}

function Repair-LegacyUpdate([string]$ExpectedVersion) {
    # v0.2.129's packaged Windows updater chose resources/ as the portable root.
    # Its newly copied launcher can recover the original outer folder using the
    # already downloaded update archive, without deleting the old runtime.
    $OuterRoot = Get-LegacyOuterRoot
    if (-not $OuterRoot) { return }
    if (-not (Test-Path -LiteralPath (Join-Path $OuterRoot 'app\package.json') -PathType Leaf)) {
        Stop-PulseStudio 'The original PulseStudio folder could not be found after the update. Extract the complete new ZIP into a regular folder and open its Windows launcher.'
    }
    $UpdateRoot = Join-Path $env:APPDATA 'PulseStudio\updates'
    $UpdateZip = Join-Path $UpdateRoot "PulseStudio-cross-platform-v$ExpectedVersion.zip"
    if (-not (Test-Path -LiteralPath $UpdateZip -PathType Leaf)) {
        Stop-PulseStudio "The earlier updater left this launch inside its runtime folder. Extract the new ZIP into the original PulseStudio folder ($OuterRoot), then open its Windows launcher."
    }
    $MigrationDir = Join-Path ([IO.Path]::GetTempPath()) ('PulseStudio-launcher-repair-' + [Guid]::NewGuid().ToString('N'))
    Write-Status "Completing the update in your original PulseStudio folder: $OuterRoot"
    try {
        Expand-Archive -LiteralPath $UpdateZip -DestinationPath $MigrationDir -Force
        $SourceRoot = Join-Path $MigrationDir 'PulseStudio'
        $SourcePackage = Join-Path $SourceRoot 'app\package.json'
        if (-not (Test-Path -LiteralPath $SourcePackage -PathType Leaf)) { throw 'The update archive does not contain PulseStudio/app/package.json.' }
        $SourceInfo = Get-Content -LiteralPath $SourcePackage -Raw | ConvertFrom-Json
        if ($SourceInfo.name -ne 'pulsestudio' -or $SourceInfo.version -ne $ExpectedVersion) { throw 'The legacy update archive version does not match the new launcher.' }
        if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot 'app\launch-windows.ps1') -PathType Leaf)) { throw 'The update archive does not contain the new launcher.' }
        Get-ChildItem -LiteralPath $SourceRoot -File | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $OuterRoot $_.Name) -Force
        }
        # Also copy the sibling .app so the shared folder keeps both launchers.
        Get-ChildItem -LiteralPath $SourceRoot -Directory | Where-Object { $_.Name -notin @('app', '.git', 'node_modules', 'logs', 'recordings', 'recovery') } | ForEach-Object {
            Invoke-LoggedCommand 'robocopy.exe' @($_.FullName, (Join-Path $OuterRoot $_.Name), '/MIR', '/IS', '/IT', '/R:2', '/W:1') 7 60000 'Completing the earlier update'
        }
        Invoke-LoggedCommand 'robocopy.exe' @((Join-Path $SourceRoot 'app'), (Join-Path $OuterRoot 'app'), '/MIR', '/IS', '/IT', '/R:2', '/W:1', '/XD', 'node_modules', 'logs', '.pulsestudio-runtime-windows', '.pulsestudio-node-runtime') 7 60000 'Completing the earlier update'
        $OuterLauncher = Join-Path $OuterRoot 'Start PulseStudio - Windows.bat'
        if (-not (Test-Path -LiteralPath $OuterLauncher -PathType Leaf)) { throw 'The updated Windows launcher was not copied.' }
        $env:PULSESTUDIO_PORTABLE_ROOT = $OuterRoot
        Start-Process -FilePath $OuterLauncher -WorkingDirectory $OuterRoot | Out-Null
    } catch {
        $_ | Out-String | Add-Content -LiteralPath $LogFile -Encoding UTF8
        Stop-PulseStudio "The earlier update could not be completed automatically. Extract the complete new ZIP into the original PulseStudio folder ($OuterRoot), then open its Windows launcher."
    } finally {
        if (Test-Path -LiteralPath $MigrationDir) { Remove-Item -LiteralPath $MigrationDir -Recurse -Force -ErrorAction SilentlyContinue }
    }
    exit 0
}

try {
    New-Item -ItemType Directory -Force -Path $LogDir, $CacheDir | Out-Null
    "PulseStudio launcher - $(Get-Date -Format o)" | Set-Content -LiteralPath $LogFile -Encoding UTF8
    if (-not $NodeArch) { Stop-PulseStudio 'PulseStudio requires a 64-bit Windows computer (x64 or ARM64).' }
    $PackagePath = Join-Path $AppDir 'package.json'
    if (-not (Test-Path -LiteralPath $PackagePath -PathType Leaf)) {
        Stop-PulseStudio 'The application folder is missing. Extract the complete ZIP before launching PulseStudio.'
    }
    $Package = Get-Content -LiteralPath $PackagePath -Raw | ConvertFrom-Json
    $AppVersion = [string]$Package.version
    if ($AppVersion -notmatch '^\d+\.\d+\.\d+(?:[-+].+)?$') { Stop-PulseStudio 'The PulseStudio version could not be read. Extract the complete ZIP again.' }
    Write-Status "PulseStudio $AppVersion for Windows $NodeArch"
    if ($OsArchitecture -match '^ARM64$') { Write-Status 'Preparing x64 PulseStudio for Windows on ARM; Windows 11 x64 app support is required.' }
    $LegacyOuterRoot = Get-LegacyOuterRoot

    # Release ZIPs launch their complete, immutable Windows app immediately.
    # A legacy nested update must migrate first, even if a ready runtime exists.
    $BundledRoot = Join-Path $AppDir "runtime\windows-$NodeArch"
    $BundledExe = Join-Path $BundledRoot 'PulseStudio.exe'
    $BundledVersion = Join-Path $BundledRoot 'version.txt'
    $BundledArch = Join-Path $BundledRoot 'architecture.txt'
    if (-not $LegacyOuterRoot -and (Read-Stamp $BundledVersion) -eq $AppVersion -and (Read-Stamp $BundledArch) -eq $NodeArch -and (Test-Path -LiteralPath $BundledExe -PathType Leaf)) {
        Open-PulseStudio $BundledExe
    }
    if (-not $LegacyOuterRoot -and (Test-Path -LiteralPath $BundledRoot -PathType Container)) {
        Stop-PulseStudio 'The bundled Windows app is incomplete or belongs to a different version. Extract the complete latest ZIP again.'
    }

    # The branded Electron application contains its own dependencies and Node runtime.
    $BuildRoot = Join-Path $AppDir '.pulsestudio-runtime-windows'
    $BuildFolder = 'win-unpacked'
    $ExePath = Join-Path $BuildRoot "$BuildFolder\PulseStudio.exe"
    $VersionStamp = Join-Path $BuildRoot 'version.txt'
    $ArchStamp = Join-Path $BuildRoot 'architecture.txt'
    if (-not $LegacyOuterRoot -and (Read-Stamp $VersionStamp) -eq $AppVersion -and (Read-Stamp $ArchStamp) -eq $NodeArch -and (Test-Path -LiteralPath $ExePath -PathType Leaf)) {
        Open-PulseStudio $ExePath
    }

    Show-SetupWindow
    $NodeExe = ''
    $NpmCli = ''
    $InstalledNode = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $InstalledNpm = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($InstalledNode -and $InstalledNpm) {
        try {
            # npm.cmd only locates npm. Invoke its JavaScript entry point with
            # Node directly so paths with spaces never pass through cmd.exe.
            $CandidateNpmCli = Join-Path (Split-Path -Parent $InstalledNpm.Source) 'node_modules\npm\bin\npm-cli.js'
            $NodeInfo = (& $InstalledNode.Source -p "JSON.stringify({major:Number(process.versions.node.split('.')[0]),arch:process.arch})" 2>$null) | ConvertFrom-Json
            if ($LASTEXITCODE -eq 0 -and $NodeInfo.major -ge 22 -and $NodeInfo.arch -eq $NodeArch -and (Test-Path -LiteralPath $CandidateNpmCli -PathType Leaf)) {
                $NpmCheck = & $InstalledNode.Source $CandidateNpmCli --version 2>$null
                if ($LASTEXITCODE -eq 0 -and $NpmCheck) {
                    $NodeExe = $InstalledNode.Source
                    $NpmCli = $CandidateNpmCli
                    Write-Status 'Using the compatible Node.js installation on this computer.'
                }
            }
        } catch {
            # Fall back to the isolated runtime if the installed toolchain is incomplete.
        }
    }

    if (-not $NodeExe) {
        # Keep this outside node_modules so dependency installation cannot remove it.
        $RuntimeRoot = Join-Path $AppDir ".pulsestudio-node-runtime\win-$NodeArch"
        $RuntimeDir = Join-Path $RuntimeRoot "node-v$NodeVersion-win-$NodeArch"
        $NodeExe = Join-Path $RuntimeDir 'node.exe'
        $NpmCli = Join-Path $RuntimeDir 'node_modules\npm\bin\npm-cli.js'
        $RuntimeValid = $false
        if ((Test-Path -LiteralPath $NodeExe -PathType Leaf) -and (Test-Path -LiteralPath $NpmCli -PathType Leaf)) {
            try {
                $RuntimeInfo = (& $NodeExe -p "process.versions.node + '/' + process.arch" 2>$null).Trim()
                $RuntimeValid = $LASTEXITCODE -eq 0 -and $RuntimeInfo -eq "$NodeVersion/$NodeArch"
            } catch { $RuntimeValid = $false }
        }
        if (-not $RuntimeValid) {
            New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
            $ArchiveName = "node-v$NodeVersion-win-$NodeArch.zip"
            $ZipFile = Join-Path $RuntimeRoot "$ArchiveName.partial"
            $ChecksumFile = Join-Path $RuntimeRoot 'SHASUMS256.txt'
            $ExtractionDir = Join-Path $RuntimeRoot ('extract-' + [Guid]::NewGuid().ToString('N'))
            Write-Status 'First launch needs internet access. Downloading the official private Node.js runtime...'
            try {
                [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
                Invoke-SetupDownload "https://nodejs.org/dist/v$NodeVersion/$ArchiveName" $ZipFile 180
                Invoke-SetupDownload "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" $ChecksumFile 60
                $ChecksumPattern = '^([a-fA-F0-9]{64})\s+\*?' + [regex]::Escape($ArchiveName) + '$'
                $Expected = ''
                foreach ($ChecksumLine in (Get-Content -LiteralPath $ChecksumFile)) {
                    if ($ChecksumLine -match $ChecksumPattern) { $Expected = $Matches[1]; break }
                }
                $Actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $ZipFile).Hash
                if (-not $Expected -or $Actual -ne $Expected) { throw 'Node.js download failed its SHA-256 integrity check.' }
                # Expand-Archive requires the .zip extension in Windows PowerShell 5.1.
                $VerifiedZip = Join-Path $RuntimeRoot $ArchiveName
                Move-Item -LiteralPath $ZipFile -Destination $VerifiedZip -Force
                Expand-Archive -LiteralPath $VerifiedZip -DestinationPath $ExtractionDir -Force
                $ExtractedRuntime = Join-Path $ExtractionDir "node-v$NodeVersion-win-$NodeArch"
                if (-not (Test-Path -LiteralPath (Join-Path $ExtractedRuntime 'node.exe') -PathType Leaf)) { throw 'The Node.js archive is incomplete.' }
                if (Test-Path -LiteralPath $RuntimeDir) { Remove-Item -LiteralPath $RuntimeDir -Recurse -Force }
                Move-Item -LiteralPath $ExtractedRuntime -Destination $RuntimeDir
            } catch {
                $_ | Out-String | Add-Content -LiteralPath $LogFile -Encoding UTF8
                Stop-PulseStudio 'The private runtime could not be prepared. Check internet or proxy access to nodejs.org, then launch again.'
            } finally {
                foreach ($TemporaryPath in @($ZipFile, $ChecksumFile, $VerifiedZip, $ExtractionDir)) {
                    if ($TemporaryPath -and (Test-Path -LiteralPath $TemporaryPath)) { Remove-Item -LiteralPath $TemporaryPath -Recurse -Force -ErrorAction SilentlyContinue }
                }
            }
        }
        if (-not (Test-Path -LiteralPath $NpmCli -PathType Leaf)) { Stop-PulseStudio 'The private runtime is incomplete. Launch again while connected to the internet.' }
        $env:PATH = "$RuntimeDir;$env:PATH"
    } else {
        $env:PATH = "$(Split-Path -Parent $NodeExe);$env:PATH"
    }

    # Migration copies are bounded using the now-available private or installed
    # runtime, and must complete before any dependencies or application build.
    Repair-LegacyUpdate $AppVersion

    $env:npm_config_cache = $CacheDir
    $env:npm_config_fetch_retries = '1'
    $env:npm_config_fetch_timeout = '20000'
    $env:npm_config_fetch_retry_mintimeout = '2000'
    $env:npm_config_fetch_retry_maxtimeout = '5000'
    $env:npm_config_prefer_offline = 'true'
    $env:npm_config_audit = 'false'
    $env:npm_config_fund = 'false'
    $env:npm_config_update_notifier = 'false'
    $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    Set-Location -LiteralPath $AppDir
    # Versions and launcher-only edits do not change this dependency stamp.
    $HashCode = "const fs=require('fs'),crypto=require('crypto'),p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(crypto.createHash('sha256').update(JSON.stringify({dependencies:p.dependencies||{},devDependencies:p.devDependencies||{},platform:'win32',arch:process.argv[2]})).digest('hex'));"
    $PackageHash = (& $NodeExe -e $HashCode $PackagePath $NodeArch).Trim()
    if ($LASTEXITCODE -ne 0 -or $PackageHash -notmatch '^[a-f0-9]{64}$') { throw 'The dependency manifest could not be checked.' }
    $HashStamp = Join-Path $AppDir 'node_modules\.pulsestudio-package-hash'
    $HostStamp = Join-Path $AppDir 'node_modules\.pulsestudio-host.json'
    $HostMatches = $false
    $HasDifferentHost = $false
    if (Test-Path -LiteralPath $HostStamp -PathType Leaf) {
        try {
            $DependencyHost = Get-Content -LiteralPath $HostStamp -Raw | ConvertFrom-Json
            $HostMatches = $DependencyHost.platform -eq 'win32' -and $DependencyHost.arch -eq $NodeArch
            $HasDifferentHost = -not $HostMatches
        } catch { $HasDifferentHost = $true }
    }
    $NeedsInstall = -not $HostMatches -or (Read-Stamp $HashStamp) -ne $PackageHash
    $RequiredPackages = @($Package.dependencies.PSObject.Properties.Name) + @($Package.devDependencies.PSObject.Properties.Name)
    foreach ($PackageName in $RequiredPackages) {
        if (-not (Test-Path -LiteralPath (Join-Path $AppDir "node_modules\$PackageName\package.json") -PathType Leaf)) { $NeedsInstall = $true }
    }
    if ($NeedsInstall) {
        Write-Status 'Preparing PulseStudio dependencies from the local cache first...'
        try {
            if ($HasDifferentHost) {
                Write-Status 'Refreshing dependencies for this Windows computer...'
                Remove-Item -LiteralPath (Join-Path $AppDir 'node_modules') -Recurse -Force
            }
            $InstallArguments = @($NpmCli, 'install', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund')
            $OfflineReady = $false
            try {
                Invoke-LoggedCommand $NodeExe ($InstallArguments + @('--offline')) 0 60000 'Preparing cached dependencies'
                $OfflineReady = $true
            } catch {
                Write-Status 'The local cache is incomplete. Downloading the missing dependencies...'
            }
            if ($OfflineReady) {
                # Resolve packages without downloads first; then run required
                # native/binary lifecycle installers with a separate time limit.
                Invoke-LoggedCommand $NodeExe @($NpmCli, 'rebuild', '--foreground-scripts', '--no-audit', '--no-fund') 0 300000 'Preparing dependency binaries'
            } else {
                Invoke-LoggedCommand $NodeExe @($NpmCli, 'install', '--include=dev', '--foreground-scripts', '--no-audit', '--no-fund') 0 300000 'Downloading dependencies'
            }
            foreach ($PackageName in $RequiredPackages) {
                if (-not (Test-Path -LiteralPath (Join-Path $AppDir "node_modules\$PackageName\package.json") -PathType Leaf)) { throw "Dependency $PackageName is missing after installation." }
            }
            $PackageHash | Set-Content -LiteralPath $HashStamp -Encoding ASCII
            ([ordered]@{ platform = 'win32'; arch = $NodeArch } | ConvertTo-Json -Compress) | Set-Content -LiteralPath $HostStamp -Encoding ASCII
        } catch {
            $_ | Out-String | Add-Content -LiteralPath $LogFile -Encoding UTF8
            Stop-PulseStudio 'PulseStudio dependencies could not be installed. Check internet access to npm and GitHub, then launch again.'
        }
    }

    $ElectronExe = Join-Path $AppDir 'node_modules\electron\dist\electron.exe'
    if (-not (Test-Path -LiteralPath $ElectronExe -PathType Leaf)) {
        Write-Status 'Downloading the Electron desktop runtime. This step needs internet access...'
        $ElectronInstall = Join-Path $AppDir 'node_modules\electron\install.js'
        if (-not (Test-Path -LiteralPath $ElectronInstall -PathType Leaf)) { Stop-PulseStudio 'The Electron installer is missing. Extract the complete ZIP again.' }
        Remove-Item Env:ELECTRON_SKIP_BINARY_DOWNLOAD -ErrorAction SilentlyContinue
        Invoke-LoggedCommand $NodeExe @($ElectronInstall) 0 300000 'Downloading the Electron desktop runtime'
        if (-not (Test-Path -LiteralPath $ElectronExe -PathType Leaf)) { Stop-PulseStudio 'The Electron desktop runtime could not be downloaded. Check internet access to GitHub, then launch again.' }
    }

    $FfmpegExe = Join-Path $AppDir 'node_modules\ffmpeg-static\ffmpeg.exe'
    if (-not (Test-Path -LiteralPath $FfmpegExe -PathType Leaf)) {
        Write-Status 'Preparing the recording encoder. This step needs internet access...'
        Invoke-LoggedCommand $NodeExe @((Join-Path $AppDir 'node_modules\ffmpeg-static\install.js')) 0 300000 'Preparing the recording encoder'
        if (-not (Test-Path -LiteralPath $FfmpegExe -PathType Leaf)) { Stop-PulseStudio 'The recording encoder could not be prepared. Check internet access to GitHub, then launch again.' }
    }

    $BuilderCli = Join-Path $AppDir 'node_modules\electron-builder\cli.js'
    if (-not (Test-Path -LiteralPath $BuilderCli -PathType Leaf)) { Stop-PulseStudio 'The PulseStudio app builder is missing. Launch again while connected to the internet.' }
    Write-Status 'Preparing the native PulseStudio application for this Windows computer...'
    if (Test-Path -LiteralPath $BuildRoot) { Remove-Item -LiteralPath $BuildRoot -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $BuildRoot | Out-Null
    Invoke-LoggedCommand $NodeExe @($BuilderCli, '--win', "--$NodeArch", '--dir', '--publish', 'never', "--config.directories.output=$BuildRoot") 0 600000 'Preparing the native Windows application'
    if (-not (Test-Path -LiteralPath $ExePath -PathType Leaf)) { Stop-PulseStudio 'The native PulseStudio executable was not created. Review the launcher log and launch again.' }
    $AppVersion | Set-Content -LiteralPath $VersionStamp -Encoding ASCII
    $NodeArch | Set-Content -LiteralPath $ArchStamp -Encoding ASCII
    Open-PulseStudio $ExePath
} catch {
    try { $_ | Out-String | Add-Content -LiteralPath $LogFile -Encoding UTF8 } catch { }
    if ($SetupCancelled) { Write-Status 'PulseStudio setup was cancelled.'; Close-SetupWindow; exit 130 }
    Stop-PulseStudio 'PulseStudio could not be prepared or started. Review the launcher log, then launch again.'
} finally {
    Close-SetupWindow
}
