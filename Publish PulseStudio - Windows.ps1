#requires -Version 5.1
# PulseStudio owner-controlled GitHub publisher for Windows PowerShell 5.1.
# Publisher 1.1.0. Keep this script beside Publish PulseStudio - Windows.bat.
# Optional environment settings: PULSESTUDIO_REPO, PULSESTUDIO_GITHUB_REPO.
# No environment tokens are changed or printed; no shell command text is built.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:TempDirectory = $null
$script:RestorePlan = New-Object System.Collections.ArrayList
$script:CreatedDirectories = New-Object System.Collections.ArrayList
$script:CommitCreated = $false
$script:SourceChanged = $false
$script:IndexTouched = $false
$script:PreparedBaseHead = $null
$script:GitCommand = $null
$script:GhCommand = $null
$script:RepoDirectory = if ($env:PULSESTUDIO_REPO) { $env:PULSESTUDIO_REPO } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Developer/PulseStudio' }
$script:GitHubRepository = if ($env:PULSESTUDIO_GITHUB_REPO) { $env:PULSESTUDIO_GITHUB_REPO } else { 'girishxp/PulseStudio' }
$script:Branch = 'main'

function Invoke-External([string]$Command, [string[]]$Arguments) {
    $oldPreference = $ErrorActionPreference
    try {
        # Native stderr is collected privately even on Windows PowerShell 5.1,
        # where native error records otherwise inherit ErrorActionPreference.
        $ErrorActionPreference = 'Continue'
        $output = @(& $Command @Arguments 2>&1)
        $code = $LASTEXITCODE
        return [pscustomobject]@{ ExitCode = $code; Text = (($output | ForEach-Object { [string]$_ }) -join "`n").Trim() }
    } finally { $ErrorActionPreference = $oldPreference }
}

function Invoke-GitHub([string[]]$Arguments) {
    $previousHost = $env:GH_HOST
    try {
        # A saved enterprise account or GH_HOST must not redirect this release.
        $env:GH_HOST = 'github.com'
        return Invoke-External $script:GhCommand $Arguments
    } finally {
        if ($null -eq $previousHost) { Remove-Item Env:GH_HOST -ErrorAction SilentlyContinue } else { $env:GH_HOST = $previousHost }
    }
}

function Invoke-Git([string[]]$Arguments, [string]$FailureMessage) {
    $result = Invoke-External $script:GitCommand (@('-C', $script:RepoDirectory) + $Arguments)
    if ($result.ExitCode -ne 0) { throw $FailureMessage }
    return $result.Text
}

function Find-Application([string]$Name, [string]$Instructions) {
    $command = Get-Command -Name $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) { throw "Required tool '$Name' was not found. $Instructions" }
    return $command.Source
}

function Assert-GitHubAccess {
    $login = Invoke-GitHub @('api', '--hostname', 'github.com', '--method', 'GET', 'user', '--jq', '.login')
    if ($login.ExitCode -ne 0) {
        if ($login.Text -match 'HTTP 401|Bad credentials|not logged|gh auth login') {
            if ($env:GH_TOKEN -or $env:GITHUB_TOKEN) { throw 'GitHub rejected the GH_TOKEN/GITHUB_TOKEN environment token. It overrides the saved browser login. Remove or refresh that environment setting, then try again.' }
            throw "The active GitHub.com login could not be verified. Run 'gh auth login --hostname github.com' once, then try again."
        }
        throw 'Could not connect to GitHub.com to verify your login. Check your internet connection, VPN/proxy and GitHub availability. This is not a request to log in again.'
    }
    if ($login.Text -notmatch '^[A-Za-z0-9][A-Za-z0-9-]*$') { throw 'GitHub.com returned an unexpected account response. Nothing will be published.' }
    $access = Invoke-GitHub @('api', '--hostname', 'github.com', '--method', 'GET', "repos/$script:GitHubRepository", '--jq', '.permissions.push')
    if ($access.ExitCode -ne 0) {
        if ($access.Text -match 'HTTP 404|Not Found') { throw "GitHub.com login succeeded as $($login.Text), but $script:GitHubRepository was not found or this account cannot access it. Check the repository name and permissions." }
        if ($access.Text -match 'HTTP 403|HTTP 401|Bad credentials') { throw "GitHub.com login succeeded as $($login.Text), but repository access was denied. Check repository permissions and token access." }
        throw "GitHub.com login succeeded as $($login.Text), but repository access could not be checked. Check your network/VPN connection and try again."
    }
    if ($access.Text -cne 'true') { throw "GitHub.com login succeeded as $($login.Text), but write/push permission for $script:GitHubRepository was not verified. Use an account/token with permission to publish it." }
    Write-Host "GitHub.com login verified: $($login.Text)"
    Write-Host "Repository write access verified: $script:GitHubRepository"
}

function Get-LatestBuild([string]$Directory) {
    if (-not $Directory -or -not [IO.Directory]::Exists($Directory)) { return $null }
    return (Get-ChildItem -LiteralPath $Directory -File -Filter 'PulseStudio-cross-platform-v*.zip' | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1)
}

function Read-ZipText($Archive, [string]$Name) {
    $entry = $Archive.GetEntry($Name)
    if (-not $entry) { throw "The shared ZIP is missing $Name." }
    $reader = New-Object IO.StreamReader($entry.Open())
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

function Assert-SharedBuild([string]$ZipPath, [string]$Version) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $names = @{}
        foreach ($entry in $archive.Entries) {
            $name = $entry.FullName.Replace('\', '/')
            # Windows paths are case-insensitive. Refuse collisions, alternate
            # streams, absolute/traversal paths and reserved device filenames.
            if ($name -notmatch '^PulseStudio/' -or $name -match '(^|/)\.\.(/|$)|(^|/)\.(/|$)|[:\x00-\x1F]' -or $name -match '/{2,}') { throw 'The ZIP contains an unsafe or unexpected path. It must contain one PulseStudio folder.' }
            foreach ($part in $name.TrimEnd('/').Split('/')) {
                if ($part -match '[. ]$|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$') { throw 'The ZIP contains a filename that is unsafe on Windows.' }
            }
            if ($names.ContainsKey($name)) { throw 'The ZIP contains duplicate or case-colliding paths.' }
            $names[$name] = $true
            # Unix symbolic links must never turn extraction or source copying
            # into an operation outside the selected package/repository.
            if ((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'The shared ZIP must not contain symbolic links.' }
        }
        $package = (Read-ZipText $archive 'PulseStudio/app/package.json') | ConvertFrom-Json
        if ($package.version -cne $Version) { throw "Version mismatch: ZIP says $Version but app/package.json says $($package.version)." }
        $windowsVersion = (Read-ZipText $archive 'PulseStudio/app/runtime/windows-x64/version.txt').Trim()
        if ($windowsVersion -cne $Version) { throw 'The included Windows runtime version does not match this release.' }
        $macInfo = Read-ZipText $archive 'PulseStudio/PulseStudio.app/Contents/Info.plist'
        if ($macInfo -notmatch '(?s)<key>\s*CFBundleShortVersionString\s*</key>\s*<string>\s*([^<]+)\s*</string>' -or $Matches[1].Trim() -cne $Version) { throw 'The included Mac launcher version does not match this release.' }
        foreach ($name in @('PulseStudio/app/main.js', 'PulseStudio/README.md', 'PulseStudio/Start PulseStudio - Windows.bat', 'PulseStudio/Start PulseStudio - macOS.command', 'PulseStudio/PulseStudio.app/Contents/MacOS/PulseStudioLauncher', 'PulseStudio/app/runtime/windows-x64/PulseStudio.exe', 'PulseStudio/app/runtime/windows-x64/resources/app.asar', 'PulseStudio/app/launcher-cache/manifest.json', 'PulseStudio/app/launcher-cache/macos-arm64-dependencies.zip')) {
            $entry = $archive.GetEntry($name)
            if (-not $entry -or $entry.Length -lt 1) { throw "The complete Mac/Windows shared ZIP is missing $name." }
        }
        if ((Read-ZipText $archive 'PulseStudio/app/runtime/windows-x64/architecture.txt').Trim() -cne 'x64') { throw 'The included Windows runtime architecture is not x64.' }
        $manifest = (Read-ZipText $archive 'PulseStudio/app/launcher-cache/manifest.json') | ConvertFrom-Json
        if ($manifest.archive -cne 'macos-arm64-dependencies.zip' -or $manifest.sha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'The prepared Mac runtime manifest is invalid.' }
        $runtime = $archive.GetEntry('PulseStudio/app/launcher-cache/macos-arm64-dependencies.zip').Open()
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { $actual = ([BitConverter]::ToString($hasher.ComputeHash($runtime))).Replace('-', '').ToLowerInvariant() } finally { $hasher.Dispose(); $runtime.Dispose() }
        if ($actual -cne $manifest.sha256.ToLowerInvariant()) { throw 'The prepared Mac runtime does not match its manifest checksum.' }
    } finally { $archive.Dispose() }
}

function Test-ProtectedSource([string]$RelativePath) {
    $path = $RelativePath.Replace('\', '/').Trim('/')
    $parts = $path.Split('/')
    if ($parts[0] -in @('.git', '.github') -or $path -ieq '.gitignore') { return $true }
    foreach ($part in $parts) {
        if ($part -in @('node_modules', 'recordings', 'recovery', 'logs', '.DS_Store') -or $part -like '*.log' -or $part -like '.pulsestudio-*') { return $true }
    }
    if ($path -match '^app/(runtime|launcher-cache)(/|$)') { return $true }
    return $false
}

function Expand-SourceOnly([string]$ZipPath, [string]$Destination) {
    # Runtime archives/executables remain in the exact uploaded ZIP. They do
    # not need extracting merely to prepare a small Git source commit.
    $archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        foreach ($entry in $archive.Entries) {
            $name = $entry.FullName.Replace('\', '/')
            if ($name.EndsWith('/')) { continue }
            $relative = $name.Substring('PulseStudio/'.Length)
            if (Test-ProtectedSource $relative) { continue }
            $path = Join-Path $Destination $relative
            [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path))
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $path, $false)
        }
    } finally { $archive.Dispose() }
}

function Get-SourceFiles([string]$Root) {
    $result = @{}
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $queue = New-Object 'System.Collections.Generic.Queue[string]'
    $queue.Enqueue($rootPath)
    while ($queue.Count -gt 0) {
        $directory = $queue.Dequeue()
        foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
            $relative = $item.FullName.Substring($rootPath.Length + 1).Replace('\', '/')
            if (Test-ProtectedSource $relative) { continue }
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Publishing refuses symbolic links or junctions in source: $relative" }
            if ($item.PSIsContainer) { $queue.Enqueue($item.FullName) } else { $result[$relative] = $item.FullName }
        }
    }
    return $result
}

function Ensure-SourceDirectory([string]$Directory) {
    if ([IO.Directory]::Exists($Directory)) { return }
    $parent = [IO.Path]::GetDirectoryName($Directory)
    if ($parent -and -not [IO.Directory]::Exists($parent)) { Ensure-SourceDirectory $parent }
    [void][IO.Directory]::CreateDirectory($Directory)
    [void]$script:CreatedDirectories.Add($Directory)
}

function Sync-Source([string]$BuildRoot) {
    $buildFiles = Get-SourceFiles $BuildRoot
    $repoFiles = Get-SourceFiles $script:RepoDirectory
    $allPaths = @(@($buildFiles.Keys) + @($repoFiles.Keys) | Sort-Object -Unique)
    foreach ($relative in $allPaths) {
        $source = if ($buildFiles.ContainsKey($relative)) { $buildFiles[$relative] } else { $null }
        $oldPath = if ($repoFiles.ContainsKey($relative)) { $repoFiles[$relative] } else { $null }
        if ($source -and $oldPath -and (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ceq (Get-FileHash -LiteralPath $oldPath -Algorithm SHA256).Hash) { continue }
        $destination = Join-Path $script:RepoDirectory $relative
        $backup = $null
        if ($oldPath) {
            $backup = Join-Path $script:TempDirectory ('rollback/' + $relative)
            [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($backup))
            [IO.File]::Copy($oldPath, $backup, $true)
        }
        # Record undo information before touching each destination. Cancellation
        # restores only our changes, never git reset/clean or ignored user data.
        [void]$script:RestorePlan.Add([pscustomobject]@{ Destination = $destination; Backup = $backup; PreparedHash = if ($source) { (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash } else { $null } })
        $script:SourceChanged = $true
        if ($source) {
            Ensure-SourceDirectory ([IO.Path]::GetDirectoryName($destination))
            [IO.File]::Copy($source, $destination, $true)
        } elseif ($oldPath) { [IO.File]::Delete($destination) }
    }
}

function Restore-UncommittedSource {
    if (-not $script:SourceChanged -or $script:CommitCreated) { return }
    Write-Host 'Restoring the source files changed by this publisher...'
    if ((Invoke-Git @('rev-parse', 'HEAD') 'Could not inspect HEAD during rollback.') -cne $script:PreparedBaseHead) { throw 'HEAD changed after source preparation. The publisher will not overwrite that work; consult the retained backup.' }
    # Unstage our changes after a failed add/commit, preserving the original HEAD.
    if ($script:IndexTouched) { Invoke-Git @('reset', '--mixed', 'HEAD') 'Could not restore the original Git index.' | Out-Null }
    for ($index = $script:RestorePlan.Count - 1; $index -ge 0; $index--) {
        $item = $script:RestorePlan[$index]
        if ($item.PreparedHash) {
            if (-not [IO.File]::Exists($item.Destination) -or (Get-FileHash -LiteralPath $item.Destination -Algorithm SHA256).Hash -cne $item.PreparedHash) { throw 'A source file changed after preparation. Those subsequent edits are preserved; consult the retained backup before restoring other publisher changes.' }
        } elseif ([IO.File]::Exists($item.Destination)) { throw 'A deleted source file was recreated after preparation. It is preserved; consult the retained backup.' }
        if ($item.Backup) { [IO.File]::Copy($item.Backup, $item.Destination, $true) } else { [IO.File]::Delete($item.Destination) }
    }
    for ($index = $script:CreatedDirectories.Count - 1; $index -ge 0; $index--) {
        $directory = $script:CreatedDirectories[$index]
        if ([IO.Directory]::Exists($directory) -and [IO.Directory]::GetFileSystemEntries($directory).Length -eq 0) { [IO.Directory]::Delete($directory) }
    }
    $script:SourceChanged = $false
}

function Invoke-Publisher([string[]]$Arguments) {
    $checkOnly = $false
    $zipPath = $null
    foreach ($argument in $Arguments) {
        switch ($argument) {
            { $_ -in @('--help', '-h') } {
                Write-Host 'Usage: Publish PulseStudio - Windows.bat [--check-only] [PulseStudio-cross-platform-vX.Y.Z.zip]'
                Write-Host 'Double-click to publish, with confirmation before commit, push and release.'
                Write-Host '--check-only verifies GitHub.com account and repository access without changing files.'
                return
            }
            { $_ -in @('--check-only', '--check') } { $checkOnly = $true; continue }
            { $_ -like '--*' } { throw "Unknown option: $argument. Use --help for usage." }
            default { if ($zipPath) { throw 'Supply only one PulseStudio build ZIP.' }; $zipPath = $argument }
        }
    }
    if ($script:GitHubRepository -notmatch '^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+$') { throw 'PULSESTUDIO_GITHUB_REPO must be an owner/repository name on GitHub.com.' }
    Write-Host ''
    Write-Host '============================================================'
    Write-Host '                 PulseStudio Publisher'
    Write-Host '============================================================'
    Write-Host ''
    $script:GhCommand = Find-Application 'gh' 'Install GitHub CLI from https://cli.github.com/, then run gh auth login --hostname github.com.'
    Assert-GitHubAccess
    if ($checkOnly) { Write-Host 'Checks passed. No repository files were changed and nothing was published.'; return }
    $script:GitCommand = Find-Application 'git' 'Install Git for Windows from https://git-scm.com/download/win.'
    if (-not $zipPath) {
        $build = Get-LatestBuild $PSScriptRoot
        if (-not $build) { $build = Get-LatestBuild (Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads') }
        if ($build) { $zipPath = $build.FullName }
    }
    if (-not $zipPath -or -not [IO.File]::Exists($zipPath)) { throw 'No build ZIP was found. Put the newest PulseStudio-cross-platform-vX.Y.Z.zip beside the publisher or in Downloads, or supply its full path.' }
    $zipPath = (Get-Item -LiteralPath $zipPath).FullName
    $zipName = [IO.Path]::GetFileName($zipPath)
    if ($zipName -cnotmatch '^PulseStudio-cross-platform-v((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*))\.zip$') { throw 'ZIP name must be exactly PulseStudio-cross-platform-vX.Y.Z.zip with a release semantic version.' }
    $version = $Matches[1]
    $tag = "v$version"
    $script:RepoDirectory = [IO.Path]::GetFullPath($script:RepoDirectory)
    if (-not [IO.Directory]::Exists((Join-Path $script:RepoDirectory '.git'))) { throw "PulseStudio Git repository was not found at $script:RepoDirectory. Set PULSESTUDIO_REPO if it is elsewhere." }
    $branch = Invoke-Git @('rev-parse', '--abbrev-ref', 'HEAD') 'Could not read the repository branch.'
    if ($branch -cne $script:Branch) { throw "Repository must be on '$script:Branch'. Current branch: $branch" }
    if (Invoke-Git @('status', '--porcelain') 'Could not inspect repository status.') { throw 'The repository has uncommitted changes. Commit or discard them first so publishing cannot overwrite your work.' }
    $origin = Invoke-Git @('remote', 'get-url', 'origin') "The repository does not have an 'origin' remote."
    if ($origin -match '^https://github\.com/([^/]+/[^/]+?)(\.git)?/?$' -or $origin -match '^git@github\.com:([^/]+/[^/]+?)(\.git)?$' -or $origin -match '^ssh://git@github\.com/([^/]+/[^/]+?)(\.git)?/?$') {
        if ($Matches[1] -ine $script:GitHubRepository) { throw 'Origin points to a different repository. Nothing will be published.' }
    } else { throw 'Origin must be the selected repository on github.com. Nothing will be published.' }
    # Validate the complete, original upload before altering source files.
    Assert-SharedBuild $zipPath $version
    $sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host 'Checking GitHub and syncing main...'
    Invoke-Git @('fetch', 'origin', $script:Branch, '--tags', '--quiet') 'Could not fetch main and release tags. Check network and Git access.' | Out-Null
    Invoke-Git @('pull', '--ff-only', 'origin', $script:Branch, '--quiet') 'Could not fast-forward main. Resolve local divergence before publishing.' | Out-Null
    $script:PreparedBaseHead = Invoke-Git @('rev-parse', 'HEAD') 'Could not snapshot main before preparing source.'
    $remoteTag = Invoke-External $script:GitCommand @('-C', $script:RepoDirectory, 'ls-remote', '--exit-code', '--tags', 'origin', "refs/tags/$tag")
    if ($remoteTag.ExitCode -eq 0) { throw "Tag $tag already exists on GitHub. Existing release versions are never overwritten." }
    if ($remoteTag.ExitCode -ne 2) { throw 'Could not check remote release tags. Nothing will be published.' }
    $release = Invoke-GitHub @('api', '--hostname', 'github.com', '--method', 'GET', "repos/$script:GitHubRepository/releases/tags/$tag")
    if ($release.ExitCode -eq 0) { throw "GitHub Release $tag already exists. Existing releases are never overwritten." }
    if ($release.Text -notmatch 'HTTP 404|Not Found') { throw 'Could not check whether the release already exists. Check network/repository access and try again.' }
    $script:TempDirectory = Join-Path ([IO.Path]::GetTempPath()) ('pulsestudio-publish-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($script:TempDirectory)
    $uploadDirectory = Join-Path $script:TempDirectory 'upload'
    [void][IO.Directory]::CreateDirectory($uploadDirectory)
    $uploadZip = Join-Path $uploadDirectory $zipName
    [IO.File]::Copy($zipPath, $uploadZip, $false)
    if ((Get-FileHash -LiteralPath $uploadZip -Algorithm SHA256).Hash.ToLowerInvariant() -cne $sha256) { throw 'The ZIP changed while preparing the upload. Nothing will be published.' }
    $extracted = Join-Path $script:TempDirectory 'source'
    Expand-SourceOnly $uploadZip $extracted
    Write-Host ''
    Write-Host "Build verified: $version"
    Write-Host "Repository: $script:GitHubRepository"
    Write-Host "Local repo: $script:RepoDirectory"
    Write-Host "ZIP: $zipName"
    Write-Host "SHA-256: $sha256"
    Sync-Source $extracted
    if (-not $script:SourceChanged -or -not (Invoke-Git @('status', '--porcelain') 'Could not inspect prepared source changes.')) { throw 'The build produced no source changes. Nothing will be published.' }
    $preparedHead = Invoke-Git @('rev-parse', 'HEAD') 'Could not read the prepared source commit.'
    $preparedStatus = Invoke-Git @('status', '--porcelain') 'Could not snapshot the prepared change list.'
    $preparedFiles = Get-SourceFiles $script:RepoDirectory
    $preparedHashes = @{}
    foreach ($relative in $preparedFiles.Keys) { $preparedHashes[$relative] = (Get-FileHash -LiteralPath $preparedFiles[$relative] -Algorithm SHA256).Hash }
    Write-Host ''
    Write-Host 'Files that will be published:'
    Write-Host (Invoke-Git @('status', '--short') 'Could not display prepared source changes.')
    Write-Host (Invoke-Git @('diff', '--stat') 'Could not display the source change summary.')
    Write-Host ''
    Write-Host "This will commit 'PulseStudio v$version', push main, create $tag, upload the complete shared ZIP and mark the public release as Latest."
    $answer = Read-Host "Continue and publish PulseStudio v${version}? [y/N]"
    if ($answer -notmatch '^(y|yes)$') { Write-Host 'Cancelled. Nothing was committed or published.'; return }
    if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $sha256 -or (Get-FileHash -LiteralPath $uploadZip -Algorithm SHA256).Hash.ToLowerInvariant() -cne $sha256) { throw 'The ZIP changed after verification. Nothing will be published; use the unchanged build and try again.' }
    if ((Invoke-Git @('rev-parse', 'HEAD') 'Could not recheck the local source commit.') -cne $preparedHead -or (Invoke-Git @('status', '--porcelain') 'Could not recheck the local change list.') -cne $preparedStatus) { throw 'The local repository changed while confirmation was open. Nothing will be published.' }
    $currentFiles = Get-SourceFiles $script:RepoDirectory
    if ($currentFiles.Count -ne $preparedHashes.Count) { throw 'Local source files changed while confirmation was open. Nothing will be published.' }
    foreach ($relative in $currentFiles.Keys) {
        if (-not $preparedHashes.ContainsKey($relative) -or (Get-FileHash -LiteralPath $currentFiles[$relative] -Algorithm SHA256).Hash -cne $preparedHashes[$relative]) { throw 'Local source files changed while confirmation was open. Nothing will be published.' }
    }
    Write-Host 'Committing source...'
    $script:IndexTouched = $true
    Invoke-Git @('add', '-A') 'Could not stage the prepared source changes.' | Out-Null
    Invoke-Git @('commit', '-m', "PulseStudio v$version", '-m', "Automated PulseStudio production release $tag.") 'Could not commit source. Check Git user.name/user.email and any commit hook errors.' | Out-Null
    $script:CommitCreated = $true
    Write-Host 'Pushing main...'
    Invoke-Git @('push', 'origin', $script:Branch) 'The source commit was created locally, but pushing failed. It is retained; resolve Git access before publishing the release.' | Out-Null
    $notesFile = Join-Path $script:TempDirectory 'release-notes.md'
    $notes = "PulseStudio v$version production release.`r`n`r`nAutomated shared Mac/Windows release package: $zipName`r`n`r`nSHA-256: $sha256`r`n"
    [IO.File]::WriteAllText($notesFile, $notes, (New-Object Text.UTF8Encoding($false)))
    Write-Host 'Creating GitHub release and uploading the complete shared build...'
    $created = Invoke-GitHub @('release', 'create', $tag, $uploadZip, '-R', $script:GitHubRepository, '--target', $script:Branch, '--title', "PulseStudio v$version", '--notes-file', $notesFile, '--generate-notes', '--latest', '--fail-on-no-commits')
    if ($created.ExitCode -ne 0) { throw "Source was pushed successfully, but release creation/upload failed. The commit is safe on GitHub. Inspect $tag in GitHub before retrying so a partial release is not overwritten." }
    $published = Invoke-GitHub @('api', '--hostname', 'github.com', '--method', 'GET', "repos/$script:GitHubRepository/releases/tags/$tag")
    $latest = Invoke-GitHub @('api', '--hostname', 'github.com', '--method', 'GET', "repos/$script:GitHubRepository/releases/latest", '--jq', '.tag_name')
    if ($published.ExitCode -ne 0 -or $latest.ExitCode -ne 0) { throw 'The release was created, but final verification could not reach GitHub. Inspect the published release before retrying.' }
    $releaseData = $published.Text | ConvertFrom-Json
    $assets = @($releaseData.assets | Where-Object { $_.name -ceq $zipName })
    if ($releaseData.tag_name -cne $tag -or $releaseData.draft -or $releaseData.prerelease -or $latest.Text -cne $tag -or $assets.Count -ne 1 -or [long]$assets[0].size -ne [long](Get-Item -LiteralPath $uploadZip).Length) { throw 'The release was created, but its public Latest status or complete ZIP asset could not be verified. Inspect GitHub before retrying.' }
    if ($assets[0].PSObject.Properties.Name -contains 'digest' -and $assets[0].digest -and $assets[0].digest -cne "sha256:$sha256") { throw 'GitHub returned a different ZIP checksum. Inspect the release asset before allowing users to update.' }
    Write-Host ''
    Write-Host '============================================================'
    Write-Host '                 PUBLISH COMPLETE'
    Write-Host '============================================================'
    Write-Host "Version: $version"
    Write-Host "Tag: $tag"
    Write-Host 'Latest: true (verified)'
    Write-Host "Asset: $zipName"
    Write-Host "SHA-256: $sha256"
    Write-Host "Release: $($releaseData.html_url)"
    Write-Host 'Both Mac and Windows clients can discover this newer public release through their existing in-app update checks.'
}

$exitCode = 0
try { Invoke-Publisher @($args) }
catch { Write-Host ''; Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red; $exitCode = 1 }
finally {
    try { Restore-UncommittedSource }
    catch { Write-Host ('ERROR: Source rollback did not finish. Backup files are retained at ' + $script:TempDirectory) -ForegroundColor Red; $exitCode = 1; $script:TempDirectory = $null }
    if ($script:TempDirectory -and [IO.Directory]::Exists($script:TempDirectory)) { Remove-Item -LiteralPath $script:TempDirectory -Recurse -Force }
}
exit $exitCode
