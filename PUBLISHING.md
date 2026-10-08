# Publishing PulseStudio v0.2.143

The Mac and Windows publishers are in the same PulseStudio folder:

| Owner's system | Double-click this file |
| --- | --- |
| Mac | **Publish PulseStudio.command** |
| Windows | **Publish PulseStudio - Windows.bat** |

Keep **Publish PulseStudio - Windows.ps1** beside the Windows `.bat`. It is the
companion implementation, using Windows PowerShell 5.1 included with Windows
10/11. The `.bat` starts only this process with its execution-policy argument;
it does not change saved policy settings or request administrator access.
An organization's enforced PowerShell policy can still prevent execution.

These are publishing tools for the repository owner. People using PulseStudio
do not need Git, GitHub CLI, PowerShell setup, or a GitHub account for in-app
updates. They use the ordinary Mac `.app` or Windows launch `.bat`.

## First-time owner setup

Install **Git** and **GitHub CLI** on the computer that will publish. On Windows,
use the official [Git for Windows installer](https://git-scm.com/download/win)
and [GitHub CLI installer](https://cli.github.com/), then reopen the publisher
so it sees the installed tools. The Mac publisher reports missing tools with
its existing setup instructions.

Sign in to GitHub.com once:

```text
gh auth login --hostname github.com
```

Use an account with write access to **girishxp/PulseStudio**. The publishers
check the active GitHub.com account and repository push permission directly;
an expired account on another saved enterprise host does not affect that check.
If `GH_TOKEN` or `GITHUB_TOKEN` is set, GitHub CLI uses that token. A rejected
environment token must be removed or refreshed; the publisher does not switch
silently to another account or print the token.

Keep a local Git checkout at **Developer/PulseStudio** in the owner's home
folder, on a clean **main** branch with its **origin** pointing to this GitHub.com
repository. If the checkout is elsewhere, set `PULSESTUDIO_REPO` to its full
path. For another authorized repository, `PULSESTUDIO_GITHUB_REPO` accepts an
`owner/repository` name; the Windows publisher requires its origin to match
exactly. The Mac publisher retains its established PulseStudio origin safeguard.

For example, first-time Windows setup in PowerShell can use:

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\Developer" | Out-Null
gh repo clone girishxp/PulseStudio "$env:USERPROFILE\Developer\PulseStudio"
```

The publisher refuses uncommitted source changes or a different branch. It
fast-forwards main before preparing the release; resolve divergence yourself
so the publisher cannot discard local work.

## Publish the complete shared package

Put **PulseStudio-cross-platform-v0.2.143.zip** beside the publisher or in
**Downloads**, then double-click the appropriate file. The publisher chooses
the newest matching ZIP by modification time. You can supply an exact ZIP path
instead when more than one build is present.

Review the version, repository, ZIP checksum, and list of prepared source changes.
The final confirmation defaults to **No**. Choosing **Yes** commits source,
pushes main, creates **v0.2.143**, uploads the complete shared ZIP and marks the
public release **Latest**. Existing release tags are never overwritten.

One upload serves both Mac and Windows clients. Bundled runtimes, dependency
caches, diagnostics and recording/recovery folders are kept out of the Git
source mirror; they stay in the original downloadable ZIP when part of the
release. Repository administration files and local ignored data are preserved.
Cancelling before the commit restores publisher changes. If push or release
creation fails after a commit, that commit is retained and the error says which
step needs attention. Inspect any partially created GitHub release before retrying.

The Windows publisher validates both platform payloads and their release
version, verifies the prepared Mac runtime checksum, and publishes a temporary
verified copy of the exact ZIP. It checks the final public Latest tag and asset
size, and matches GitHub's SHA-256 asset digest when supplied. Preparing the
package here never uploads it automatically.

## Check access without publishing

These checks do not unpack a build or change repository files:

Mac Terminal:

```sh
"/path/to/PulseStudio/Publish PulseStudio.command" --check-only
```

Windows Command Prompt:

```bat
"C:\path\to\PulseStudio\Publish PulseStudio - Windows.bat" --check-only
```

Windows PowerShell, using the companion directly:

```powershell
& "C:\path\to\PulseStudio\Publish PulseStudio - Windows.ps1" --check-only
```

Both also accept `--check` and `--help`. A command-line ZIP argument must be
quoted if its path contains spaces. The Windows `.bat` pauses so its result is
visible when launched by double-click.

## When users receive the update

Both systems check the public Latest release about **2.5 seconds after launch**
and every **15 minutes while open**. A newer release with the matching shared
ZIP prompts the user in the app. **Update Now** downloads and installs it when
recording, saving, recovery and other active work have finished, then reopens
PulseStudio. **Remind Me Later** postpones the prompt for 24 hours; **Skip This
Version** suppresses only that version. Internet access and a writable extracted
folder are required. A source push without the newer public Latest ZIP does
not produce an update notification.
