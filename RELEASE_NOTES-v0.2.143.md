# PulseStudio v0.2.143

- Keeps the approved idle Pearl Screen icon unchanged and deepens only the aqua
  recording artwork for a clearer recording state.
- Prepares the physical **Pulse Studio.app** host before Mac launch, keeping
  **Electron.app** as a compatibility link to the same executable, signature
  and bundle ID. A running host is not moved: quit and reopen the app to finish
  naming. Existing recording permissions and application data are retained.
- Adds **Publish PulseStudio - Windows.bat** and its companion **.ps1** in the
  same folder as **Publish PulseStudio.command**. Either owner's system can
  publish the complete shared Mac/Windows package. Existing Mac publishing is
  retained; source pushes alone do not notify client applications.
- The Windows publisher verifies the active GitHub.com account and repository
  write access, checks the complete package/version, and asks before commit,
  push and public Latest release creation. It preserves administration files,
  runtimes, local caches and recordings, and restores its changes on cancellation.
  The uploaded ZIP is a verified copy of the original complete package.
- Updates current documentation and adds **PUBLISHING.md** with owner setup,
  read-only access checks and the established in-app update behavior. Recording,
  audio cleanup, background transcription, analytics, saved settings, Playback,
  compact Mini dimensions and update timing remain unchanged.

This package is a local build. It has not been uploaded to GitHub automatically.
