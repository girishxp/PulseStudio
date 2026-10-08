# PulseStudio v0.2.143

## v0.2.143 Mac Dock branding, deeper recording colour and Windows publishing

- Keeps the approved idle Pearl Screen icon unchanged and deepens the aqua
  recording artwork so the active recording state is easier to distinguish.
- Prepares the physical **Pulse Studio.app** host before Mac launch and retains
  an **Electron.app** compatibility link to the same executable and bundle ID.
  A running host is never moved; quit and reopen to finish preparing its name.
  Existing recording permissions and application data are retained.
- Adds **Publish PulseStudio - Windows.bat** and its companion PowerShell script
  beside the existing Mac publisher. Owners can publish the same complete shared
  Mac/Windows ZIP from either platform. Both scripts verify the active GitHub.com
  account and repository write access, then ask before committing, pushing or
  creating a public Latest release. Creating this package does not publish it.
- Windows publishing validates both platform payloads, keeps runtimes and local
  caches/recordings out of the Git source mirror, and restores publisher changes
  on cancellation. It uploads a verified copy of the complete original ZIP.
  See [PUBLISHING.md](PUBLISHING.md) for first-time owner setup and read-only checks.
- Help, About, documentation and launcher metadata report v0.2.143. Recording,
  audio processing, saved settings, analytics and update timing are retained.

## v0.2.142 calmer recording controls and clearer recording feedback

- Gives Full View recording controls a quieter layout and a moderately sized
  primary recording button. Recording modes, webcam, audio checks, save-folder
  access and recording shortcuts remain available. Mini keeps its 262 × 84 size.
- Removes the anonymous-analytics switch and its launch reminder from the
  interface. Existing anonymous analytics configuration, installation identity,
  saved backend preference and content exclusions are preserved; new installs
  continue to have product analytics enabled by default.
- Fixes completed-recording feedback so a saved file displays its actual path
  rather than the contradictory “Not saved yet” placeholder. Show in folder and
  Copy path continue to use that saved recording.
- Extends Playback's library resize divider throughout the panel. The media
  filter remains on one row, while **Sort & filter** opens a compact popover
  for all eight date/duration/name/size sorts and category choices. All library
  options remain available.
- Strengthens the approved Pearl Screen artwork slightly while idle, and gives
  recording a more distinct aqua symbol and lower tile shading, without changing
  its shape or adding a red dot or flashing. The application keeps the Pearl Screen design on both OSs.
- Updates current Help, About, documentation and launcher version metadata to
  v0.2.142. Existing recordings, exports, microphone processing, background
  transcription, recovery, shared launch folder and update behavior are retained.

## v0.2.141 Quiet Studio Playback, Pearl Screen icon and recording-save fix

- Refines Playback with **Quiet Studio**: a calmer recording library, a compact
  player toolbar, and grouped file, export and transcript actions. **Transcript**,
  **Insights**, **Trim & cuts**, and **Timeline** stay available in the inspector.
  Transcript text gets more room; speaker corrections are grouped with the
  speaker view. Existing playback tools and recording options remain available.
- Adds the approved **Pearl Screen** icon: a light pearl rounded tile with a
  monitor and waveform. On the Mac Dock, the symbol is sky blue when idle and
  aqua during recording, with the same shape and no red dot or flashing.
  Stopping or cancelling recording restores the idle icon. The Windows package
  uses the same Pearl Screen artwork for its application icon.
- Fixes an unnecessary delay after Stop: checking for an audio stream used to
  decode the entire recording and could run twice during saving. The check now
  reads media headers instead. Final encoding, microphone cleanup and mixing,
  recoverable source tracks, and cancellation safeguards remain in place.
  Saving still takes time when media needs encoding or audio processing;
  automatic transcription continues separately in the background.
- Checks actual audio stream descriptions rather than zero-byte output
  statistics, so video-only capture with a microphone does not incorrectly
  create a computer-audio reference. Record and Mini finish their Saving phase
  when the media is ready; a slow library refresh continues separately and a
  library metadata error cannot misreport a completed recording as a failed save.
- Ships **publisher 1.1.0**, which checks the active **GitHub.com** account and
  repository write access directly. A failed login check on another saved host
  no longer incorrectly reports that PulseStudio publishing is unauthenticated.
  Read-only `--check-only` and distinct account, connection and permission errors
  remain available. Publishing still requires the owner's separate action.
- Retains bookmark interval Clip/Audio/TXT/SRT exports, **Movies/PulseStudio**
  on Mac and **Videos/PulseStudio** on Windows, saved custom folders, all eight
  library sort choices, reusable background transcription, and **Pulse Studio**
  Dock naming. Analytics configuration, saved consent and update notifications
  are preserved.
- Keeps Record and the compact **262 × 84** Mini Controller, both icon recording
  modes, stable pastel-blue Start/Stop, **3-second** bookmark entry, native window
  controls, outside-window tooltips and Mini-only **0–75%** transparency.
  Help, About, documentation and launcher version metadata report v0.2.141.

## v0.2.140 bookmark interval exports, library sorting and faster background transcription

- In Playback → **Trim & cuts** → **Export between bookmarks**, choose two saved
  bookmarks and export **Clip · MP4**, **Audio · M4A**, **TXT transcript**, or
  **SRT transcript**. Only the interval between them is exported, as a new file.
  Start must precede end; missing or invalid bookmarks stop the export.
  Audio-only recordings offer Audio, TXT and SRT. The source stays selected.
- Transcript exports reuse sentences fully inside the interval. If a sentence
  crosses a bookmark or usable timings are missing, the app transcribes only
  the selected audio. It never substitutes the full recording's transcript.
  SRT timestamps start on the exported interval's timeline.
- New recordings, automatic transcripts, snapshots and default export locations
  use **Movies/PulseStudio** on Mac and **Videos/PulseStudio** on Windows.
  Existing custom recording folders are retained. Previous media directly in
  the native media folder remains available in Playback; unrelated files are
  not moved. Regenerated legacy transcripts are saved in PulseStudio.
- Sort the Playback library by date, duration, name or file size, in either
  direction. The choice is remembered; Previous/Next follow the displayed order.
- Background transcription reuses one local Whisper Small q8 model session,
  including a preloaded session. Model, precision, chunk overlap, speech-recovery
  checks and recording priority are preserved. Repeated local test transcriptions
  had identical text and timestamps and completed faster. First loading and
  long recordings can still take time; no recording or transcript is uploaded.
- The Mac Dock displays **Pulse Studio** on the prepared runtime. The launcher
  changes display strings only when the stock host's signing metadata permits
  that change, preserving its identifier, executable and code signature. A sealed
  or unknown host is left unchanged so naming cannot block launch.
- Recording-specific bookmarks, categories, highlights and insights use path
  identities, keeping old and new recordings with the same filename separate.
- Help, About, launchers and documentation report v0.2.140. Studio Desk, Record,
  Mini, analytics consent, update notifications and the shared launch folder are
  retained. GitHub publishing remains a separate owner-controlled action.

## v0.2.139 Studio Desk Playback and automatic speaker echo handling

- Organizes the existing Playback tools into the **Studio Desk** layout, with
  the recording library on the left, player in the center, and **Transcript**,
  **Insights**, **Trim & cuts**, and **Timeline** tabs in the tools inspector.
  Recording setup and the compact Mini Controller stay available.
- Automatically requests whole-system speaker echo cancellation whenever the
  microphone is enabled, only when that capability is advertised, then verifies
  that it was applied. Falls back to the available browser cancellation path
  when needed. This works independently of the Computer Audio toggle.
- Keeps available source microphone, cleaned microphone, and unmixed
  computer-audio reference tracks locally beside the saved recording, in the
  hidden `.pulsestudio-audio-sources` folder. The companion tracks follow rename,
  Trash, and recovery; microphone/system audio is not uploaded.
- Keeps the existing **Off**, **Standard**, **Enhanced voice**, and **Strong**
  microphone cleanup choices in Record. These are recording settings, rather
  than new Playback presets. Echo reduction depends on the microphone, output
  device, and room; headphones remain useful when recording meetings.
- Preserves the compact **262 × 84** Mini layout, icon-only recording modes,
  stable Start/Stop action, **3-second** bookmark entry, and Mini-only **0–75%**
  transparency bar. Full View remains opaque.
- Updates Help, About, documentation, and version metadata together. Saved
  settings, analytics and consent, update notifications, and the one shared
  Mac/Windows launch folder retain their established behavior. Publishing is
  still a separate owner-controlled step.

## v0.2.138 steady Mini actions and lighter Classic styling

- Keeps Mini's **Start/Stop** button the same size when hovered, so its label,
  icon, and neighboring controls remain steady.
- Makes the Mini **Video + Audio** and **Audio Only** selectors icon-only.
  Short tooltips identify each mode and whether it is selected; the active
  mode indicator remains visible during recording.
- Lightens Classic Mini View with neutral gray, pastel blue, and mint surfaces
  to match the selected reference. Keeps the compact **262 × 84** layout,
  native Mac controls, remembered appearance, and every recording action.
- Gives Mini recording bookmarks **3 seconds** to start entering optional text,
  increased from 1 second. Once typing starts, the entry stays open. Save,
  Enter, and skipping optional text keep their existing behavior.
- Retains the Mini-only **0–75%** transparency bar, tooltips outside Mini,
  and Full View's **Open Mini Controller** action. Full View remains opaque.
- Updates Help, About, documentation, and version metadata together. Saved
  settings, recording and audio processing, analytics and consent, updates,
  and the shared Mac/Windows package remain preserved.

## v0.2.137 balanced Mini spacing and pastel blue actions

- Keeps the compact **262 × 84** Mini content layout and its existing top and
  bottom spacing. Adds a small inset at each side and balances the icons to
  reduce unused gaps while keeping every recording control available.
- Uses native macOS Close and Minimize controls to match the Digital Marathon
  reference. The green Zoom control is hidden in Mini View and restored in Full
  View. Windows retains its platform controls.
- Uses light pastel blue for Full View's **Open Mini Controller** action and
  Mini View's **Start/Stop** action, with readable labels in both appearances.
  New installs start in Light appearance; an existing saved appearance is kept.
  The light/dark and Classic/Studio choices remain available.
- Retains the **Video + Audio** and **Audio Only** icons, Mini-only **0–75%**
  transparency bar, short tooltips outside Mini, and the Full View controls.
  During recording, a small mode icon beside the recording status confirms
  whether the current recording includes video or is audio-only.
- Updates Help, About, documentation, and version metadata together. Recording,
  audio processing, saved settings, analytics and consent, GitHub update
  notifications, the shared Mac/Windows launch folder, and publishing retain
  their existing behavior.

## v0.2.136 compact Mini Controller and clearer Full View action

- Restores Mini View's original compact **262 × 84** content layout rather than
  the enlarged v0.2.135 controller. Restrained spacing and toolbar styling match
  the selected Classic Mac design.
- Adds a prominent **Open Mini Controller** action in Full View, with a short
  explanation that it keeps the recording controls on screen while you work.
  Full recording setup, playback, AI, privacy, and diagnostics remain available.
- Keeps the **Video + Audio** and **Audio Only** icons before recording and the
  microphone, Pause, Bookmark, Stop, and Full View controls during recording.
- Retains the small **0–75%** transparency bar only in Mini View, saved settings,
  and short delayed tooltips outside the controller. Full View stays opaque
  and has no transparency control.
- Updates Help, About, version metadata, and documentation together. The shared
  Mac/Windows folder, recording and audio behavior, analytics configuration and
  consent, update notifications, and owner-controlled publishing are preserved.

## v0.2.135 Classic Mac interface and Mini controls

- Refines Full and Mini View with the **Classic Mac** layout: calmer surfaces,
  consistent spacing, clearer segmented choices, and compact toolbar controls.
  Existing recording, playback, AI, privacy, diagnostics, and update options
  remain available.
- Keeps **Video + Audio** and **Audio Only** icon choices in Mini View. Select
  the mode before starting a recording. Pause, bookmark, microphone, Stop, and
  Full View controls retain their existing behavior.
- Replaces the Mini transparency icon with a small **0–75%** slider. Drag the
  bar to change transparency continuously; 0% is opaque and 75% leaves 25%
  opacity. The saved setting applies only to Mini View. Full View has no
  transparency control and remains opaque.
- Uses shorter, natural tooltips with a deliberate hover delay. Mini tooltips
  appear outside the controller so they do not cover its recording information
  or buttons; tooltips disappear when the pointer leaves or an action begins.
- Updates Help, About, quick-start instructions, and version metadata together.
  Recording/audio processing, analytics settings and consent, GitHub update
  notifications, and publishing keep their established behavior.
- Retains one shared **PulseStudio** folder containing both the Mac `.app` and
  Windows `.bat`, including their prepared platform runtimes.

## v0.2.134 one ready-to-launch Mac and Windows folder

- Distributes one ZIP that extracts to **PulseStudio**, with **PulseStudio.app**
  and **Start PulseStudio - Windows.bat** next to the shared application files.
- Includes the Windows x64 desktop runtime, recording encoder, and native/AI
  dependencies. Windows launches the included application directly, without
  installing Node.js, fetching dependencies, or building an executable.
- Windows starts through a hidden launcher and reports launch errors in a
  graphical dialog with access to its log.
- Apple silicon Mac uses the prepared local runtime added in v0.2.133. First
  launch unpacks it; later launches reuse it. Both platform runtimes can coexist
  in this same folder.
- Preserves recording, recovery, saved settings, anonymous analytics/consent,
  and GitHub update notifications. The publisher uploads the complete shared
  release ZIP and keeps the bundled platform runtimes out of Git source commits.

## v0.2.133 first-launch setup recovery

- Includes a prepared **Apple silicon Mac** runtime and all desktop dependencies.
  First launch verifies and unpacks that payload locally, avoiding npm/network
  setup. Keep the complete shared folder together.
- Reuses compatible installed dependencies across version-only updates. Version
  changes alone no longer trigger npm installation.
- Intel Mac and Windows first setup checks cached packages before downloading,
  uses short request retries and a total time limit for each setup stage, and
  reports elapsed progress. Dependency setup can be cancelled on Mac.
- Adds **Open Setup Log** and **Cancel Setup** to the Mac launch window, plus
  a clear inactivity notice. Cancelling or timing out stops only the launcher's
  own setup processes.
- Preserves v0.2.129 recording/audio/AI behavior, analytics configuration/consent,
  saved settings, recovery data, and GitHub update notifications.
- The package remains one shared folder with `PulseStudio.app` and the Windows
  `.bat`. The prepared Mac payload makes this ZIP larger; Windows still prepares
  its own platform runtime on first launch.
- The publisher excludes the prepared payload from source commits while uploading
  the complete release ZIP as usual.

## v0.2.132 one shared folder with click-to-launch files

This launcher-only release is based on the supplied v0.2.129 source. The number
0.2.132 avoids reusing the separate 0.2.130/0.2.131 local builds; their playback
and application-identity changes are not included in this package.

- **Mac:** double-click `PulseStudio.app` beside the `app` folder. Setup runs in a
  small graphical window and then opens PulseStudio, without a Terminal window.
- **Windows:** double-click `Start PulseStudio - Windows.bat` in that same folder.
- Keep the entire **PulseStudio** folder together; the Mac launcher uses its
  sibling `app` folder, so moving only the `.app` will not work.
- On first launch, missing Node.js/npm and desktop dependencies are downloaded
  automatically. Private Node downloads are checked against the official SHA-256
  manifest. Internet access and a writable extracted folder are needed for setup.
- The Mac launcher supports Apple silicon and Intel. It continues to open the
  original Electron host, preserving v0.2.129's privacy-permission target
  and sleep/wake safeguards. macOS recording permissions still appear as Electron.
- The original macOS `.command` and Linux launcher remain available.
- Fixed Windows portable-update root discovery so the branded Windows runtime
  updates the shared package rather than its internal resources directory.
- Both update helpers preserve dependencies, logs, private Node runtimes, and
  the existing application-data folder; the complete shared launcher layout is
  copied during updates.
- GitHub feed, update popup timing, PostHog configuration/consent, recording,
  recovery, microphone/system audio, and AI processing retain v0.2.129 behavior.
- The release remains named `PulseStudio-cross-platform-v0.2.132.zip`, compatible
  with the existing `Publish PulseStudio.command`. Publishing is a separate step.

The bundled updated publisher also excludes generated private
Node/Windows runtimes from source uploads and installs the shipped app ignore
rules while retaining the repository's root ignore rules. It can select an
adjacent ZIP, then falls back to Downloads. The original publisher still accepts
this package's exact filename and layout.

For a Windows upgrade initiated from v0.2.129's earlier updater, the new launcher
repairs the old folder-location mistake using the cached update ZIP. If that ZIP
is unavailable, extract the complete new ZIP into the original PulseStudio folder
and launch its Windows `.bat`. Windows ARM uses the x64 build and requires
Windows 11 support for x64 applications; this is not a native ARM build.

See `QUICK_START.txt` for click-to-launch instructions.

## v0.2.129 macOS sleep/wake input responsiveness

- Prioritizes immediate keyboard and mouse availability when a Mac wakes from lid sleep.
- Suspends PulseStudio global shortcuts before sleep/lock and restores them only after a short wake stabilization period.
- Defers Mini View position repair and update checks during that stabilization window so wake-time work does not compete with user input.
- Disables the optional native Show keystrokes overlay on macOS because its global input-hook dependency can produce system-wide keyboard/mouse lag. Windows and Linux keep the feature.
- Recording, microphone, system-audio, mixing, transcription, speaker processing, playback, recovery, analytics, and updater installation behavior are otherwise unchanged.


## v0.2.128 faster update prompt and compact transparency feedback

- The automatic GitHub Release check now starts about 2.5 seconds after launch instead of waiting 15 seconds, so available-update prompts appear substantially sooner when PulseStudio is idle.
- While PulseStudio remains open, automatic GitHub Release checks now run about every 15 minutes instead of every 6 hours, so a release published after launch is discovered much sooner.
- The update dialog retries opening every 250 ms after another modal closes, reducing visible lag without increasing GitHub request frequency.
- Update actions use an explicit three-column grid with identical height, alignment, margin reset, and no primary-button outer shadow, keeping Skip This Version, Remind Me Later, and Update Now on one clean row.
- Transparency changes no longer use stacked application toasts. Clicking the transparency control shows one small anchored tooltip for the newly selected Mini View level; hovering or merely focusing that control does not show the explanatory message.
- Full View remains opaque and the selected transparency still applies only to Mini View.
- Recording, microphone, audio cleanup/mixing, transcription, recovery, and unsigned macOS update installation behavior are unchanged from v0.2.127.

## v0.2.127 updater layout and unsigned macOS reopen

- The automatic update dialog keeps **Skip This Version**, **Remind Me Later**, and **Update Now** aligned on one row with equal heights and widths.
- A complete Electron update still requires a brief process restart because main-process JavaScript is already loaded in memory; PulseStudio does not attempt an unsafe live code replacement.
- On macOS, the portable updater no longer asks LaunchServices to open the newly downloaded `Start PulseStudio - macOS.command` after installation. That file can inherit macOS download quarantine and trigger the "Not Opened" Gatekeeper warning on unsigned distributions.
- Instead, after the update files are verified and copied, PulseStudio reopens the already-installed official signed Electron runtime directly and passes the updated `app` directory to it.
- The updater preserves `node_modules`; if the dependency manifest changes in a future release it refreshes dependencies before reopening. It also refreshes the launcher package hash so a later manual start does not unnecessarily reinstall unchanged dependencies.
- PulseStudio does **not** remove or bypass macOS quarantine attributes.

## v0.2.126 Mini View-only transparency

- Window transparency now applies **only to Mini View**. Full View is always forced to 100% opacity, including after switching back from a transparent Mini View and after Full View recording performance mode ends.
- The saved transparency preference remains selectable from Full View, but selecting it there does not visually fade the Full window. PulseStudio explicitly tells the user that the chosen level will appear only after switching to Mini View.
- Transparency tooltips/accessible labels now say **Mini View transparency** and explain that Full View stays opaque.
- The Help text now documents the Mini-only behavior.
- No recording, microphone, audio cleanup, speaker identification, transcription, recovery, update, or playback processing was changed in this build.


## v0.2.125 self-healing recovery and actionable update blockers

- Unpaused interrupted recordings now start **automatic recovery while PulseStudio is idle** instead of remaining protected indefinitely with no recovery attempt.
- Automatic recovery is bounded by a watchdog: if it reports no progress for **5 minutes**, or reaches a **1-hour maximum runtime**, PulseStudio stops that attempt, keeps the source protected, pauses recovery, and returns the app to idle.
- A protected recovery item that is merely waiting on disk **no longer blocks update checks, downloads, or installation**. Only real active work can defer an update: live recording, stopped-recording finalization, active recovery, local AI work, or active media processing.
- About & Diagnostics now shows the exact update blocker, for example **“Update check paused — recovery is currently running”**, rather than an indefinite generic “Waiting until the app is idle” state.
- About & Diagnostics adds **Recover recording** and **Discard recovery** actions whenever a protected recovery is idle. Discard requires confirmation and permanently removes only recovery-folder source data/manifests.
- About & Diagnostics adds **Stop background work** whenever no live recording is active but recovery, stopped-recording finalization, local AI, or cancellable media processing is running. Stopping a recording finalization preserves its source as a paused recovery item rather than deleting it.
- Starting a new recording still has priority over automatic recovery; recovery yields, keeps its protected source, and can resume later.
- Recovery failures no longer leave PulseStudio permanently busy. Failed or stale automatic attempts are paused so the updater and the rest of the app can proceed while the protected source remains available for manual Recover or Discard.
- No microphone capture, RNNoise, capture-time echo cancellation, microphone/system mixing, My Voice isolation behavior, speaker identification, transcription algorithms, or playback processing was changed in this build.

## v0.2.124 Automatic GitHub Release update popup for unsigned builds

- PulseStudio now checks the public GitHub Releases feed automatically after launch and every configured interval while the app is idle.
- When a newer `PulseStudio-cross-platform-v<version>.zip` release is found, users see an in-app update popup without opening About & Diagnostics.
- The popup offers **Update Now**, **Remind Me Later**, and **Skip This Version**. Remind Later postpones that version for 24 hours; Skip suppresses that version but never suppresses a newer release.
- **Update Now** downloads the exact release ZIP, validates its reported size and SHA-256 digest when GitHub provides one, then restarts through PulseStudio's existing portable update helper.
- This flow does not use Electron/Squirrel autoUpdater and therefore does not require an Apple Developer account or a signed/notarized PulseStudio `.app`. The macOS launcher continues to use Electron's stable signed host.
- Update checks and installation remain recovery-aware and never interrupt active recording, recovery, or local AI processing.
- The existing **About & Diagnostics → Check for updates** control remains available as a manual fallback.
- No recording, microphone, audio cleanup, transcription, speaker, or playback processing was changed in this build.

## v0.2.123 My Voice highlighting disabled for audio-isolation testing

This diagnostic release disables **My Voice highlighting end-to-end** so audio quality can be compared without that analysis path running at all.

- No live My Voice microphone analyser is started during recording.
- No My Voice candidate sections are calculated, checkpointed, refined, persisted, or loaded during playback.
- The My Voice playback icon/timeline overlay and live recording indicators are removed.
- My Voice enrollment controls are hidden for this build so the feature cannot be started accidentally.
- Automatic speaker identification/diarization, transcription, chapters, insights, bookmarks, RNNoise, capture-time echo cancellation, and the v0.2.122 audio-preservation changes remain enabled and otherwise unchanged.
- Existing My Voice metadata from older recordings is left on disk but is ignored by this build.

## v0.2.122 capture-audio preservation without feature removal

This release keeps **My Voice highlighting**, local **My Voice enrollment**, and **automatic speaker identification/diarization** fully enabled while changing only the post-recording audio stages implicated by the v0.2.120 logs.

- Enhanced/Strong recordings that already have an RNNoise sidecar no longer run a second denoise/gate/normalization chain after Stop.
- Removed the previous fixed **1.58-1.68x post-recording microphone boost**.
- Removed the second offline **adaptive NLMS echo-cancellation** pass. Capture-time WebRTC echo cancellation and RNNoise remain enabled.
- Final mixing preserves system/application audio as **stereo** and duplicates the mono microphone into left/right before mixing.
- The final limiter is attenuation-only and receives a small amount of pre-mix headroom; it cannot normalize quiet residual noise upward.
- Hidden `.microphone-*` / playback-repair files and output paths that are still finalizing are excluded from the Playback library, preventing transcription or speaker detection from racing an unfinished MP4.
- My Voice timestamps remain metadata-only and automatic speaker detection still runs after transcription on the completed recording.

## v0.2.120 analytics project configuration correction

This release corrects the PostHog US Cloud project token used by anonymous product analytics. No recording, microphone, audio cleanup, playback, capture, or UI behavior is changed.

- Uses PostHog batch ingestion for desktop analytics delivery.
- Prefers Electron Chromium networking so system/corporate proxy, DNS, and certificate settings are honored.
- Falls back to Node HTTPS if Electron networking is unavailable before a response is received.
- Records transport, endpoint, HTTP status, last send time, and connection error in diagnostics for troubleshooting.
- Recording, microphone, RNNoise, fan-noise suppression, echo handling, playback, and capture logic are unchanged.


- Aligned the two analytics reminder actions to equal width and height while preserving the existing dialog design.
- Expanded anonymous product analytics without collecting recording content, audio, transcripts, filenames, bookmark text, names, email addresses, or exact location.
- Added safe session/retention metadata, broad feature-control usage, shortcut usage, playback selection, transcription/speaker/insights lifecycle, recovery health, renderer/runtime failures, microphone/system-audio interruptions, and generic sanitized warning/error telemetry.
- Recording, microphone, RNNoise, fan suppression, echo cancellation, capture, encoding, and saved-media processing are unchanged.


## v0.2.117 feedback and analytics reminder

- Added **Send Feedback…** in App & AI tools and App Diagnostics. It opens a pre-filled PulseStudio GitHub feedback issue in the default browser.
- Anonymous product analytics remain opt-out by default. If a user explicitly disables analytics, PulseStudio keeps analytics off but shows a short reminder on every subsequent app launch until analytics are re-enabled.
- The reminder never changes recording, audio, microphone, playback, or saved-media processing.


## v0.2.116 desktop analytics preference

- Anonymous product analytics now follow an opt-out desktop model: analytics are enabled by default when the configured PostHog backend is available.
- Users can disable or re-enable analytics at any time under **App & AI tools → Privacy → Share anonymous usage analytics**.
- Existing explicit user choices are preserved across upgrades.
- Analytics remain privacy-limited and never include recordings, screen contents, microphone/system audio, transcripts, filenames, bookmark text, names, email addresses, or exact location.


## v0.2.111 PulseStudio rebrand

- Renamed the application, launchers, package identity, runtime folders, logs, diagnostics, icons, menus, dialogs, help text, and distribution folder from the previous product name to **PulseStudio**.
- Native package identity is now `com.girishxp.pulsestudio`, Windows and Linux executable names use PulseStudio branding, and runtime user data is stored under the OS-specific **PulseStudio** application-data folder.
- This release is a branding/path migration only; recording, microphone, RNNoise, fan suppression, echo cancellation, gain, encoding, playback behavior, transcription, and capture processing are unchanged.

## v0.2.110 playback polish

- Playback mute/unmute no longer turns white on hover.
- Previous/next bookmark icons use clearer, higher-contrast glyphs and remain legible while disabled.
- The bookmark marker-text editor renders above the waveform hover thumbnail.
- A newly added playback bookmark auto-saves with its default label after 2 seconds if no text is entered; typing cancels the timer so the editor stays open.
- Opening the Recording timeline keeps all playback controls in one compact line and prevents them from being pushed underneath the sidebar.

## v0.2.110 single-line playback controls

- Playback controls are now kept on one compact line with logical groups: navigation/bookmarks, -10/play/+10, timeline/tools, and audio/speed/fullscreen.
- The recording timeline is now an icon-only list control with a standard hover tooltip (`Show recording timeline` / `Hide recording timeline`) instead of a large text button.
- The former scattered second tools row is removed. At unusually narrow widths the one-line toolbar stays intact and can pan horizontally rather than breaking into disconnected rows.
- This release changes playback UI layout only; recording, microphone, RNNoise, fan suppression, echo cancellation, gain, encoding, and capture processing are unchanged.


## v0.2.110 playback control layout
- Reorganized Playback into three clearly separated zones: recording/bookmark navigation on the left, primary -10 / Play / +10 transport in the center, and volume/speed/fullscreen on the right.
- Moved Show/Hide Timeline, fine seek, My Voice, snapshot, and captions onto a dedicated secondary tools row so they never overlap the primary Play button.
- Added responsive two-row/stacked layouts for narrower windows while keeping every existing playback action and ID unchanged.
- No audio capture, RNNoise, echo cancellation, mic gain, recording, transcription, or export logic changed in this release.



## v0.2.110 recording health, local My Voice profile, timeline navigation, diagnostics, checkpoints, and mic level

- **Built-in Recording Health Monitor:** while a recording is active, PulseStudio silently checks the capture source, video track, microphone, requested system/application audio, MediaRecorder/encoder state, write-stream activity, and available recording storage. Mini View shows only a tiny status dot while healthy. If a problem is detected, the app reports the specific condition, such as `Display capture disconnected · reconnecting`, `Microphone temporarily unavailable`, `System audio temporarily unavailable`, `Recording writer delayed`, or `Disk write interrupted`, and includes that state in diagnostics.
- **Optional local My Voice enrollment:** App & AI tools now includes a 15-second My Voice enrollment. The temporary enrollment audio is used locally to create a speaker embedding and a lightweight live-analysis fingerprint, then the raw enrollment sample is deleted. The profile is used only for My Voice timestamp refinement and speaker identification/diarization; it never feeds back into or changes the recording audio path. A matching enrolled speaker can be labelled **You**, and non-overlapping fragments of the same enrolled speaker can be merged more reliably instead of appearing as two people.
- **Show/hide Playback timeline sidebar:** Playback can now show a right-side timeline combining editable bookmarks, detected **You spoke** sections, and generated chapters in time order. Clicking any entry jumps to that moment; bookmark text can still be edited afterward. The sidebar can be hidden at any time and stays out of fullscreen playback.
- **Export Diagnostics ZIP:** App Diagnostics now has one Export Diagnostics action. The package contains app/version information, recent app logs, recording/capture health, audio-processing mode, FFmpeg and RNNoise status, capture-device metadata, stop reason, timestamps, recovery/checkpoint metadata, and public My Voice profile status. The actual recording is excluded by default and is included only when the user explicitly enables the recording checkbox for the currently selected recording.
- **Background-processing status:** Playback shows a subtle live status for queued/running local AI work, including `Transcribing NN%`, `Identifying speakers NN%`, and `Ready`. Playback remains usable while this work continues, and recording still receives priority over local AI processing.
- **Recording metadata checkpoints:** active sessions write a metadata checkpoint roughly every 15 seconds and at important events such as bookmarks, bookmark edits, mic state changes, pause/resume, and stop. Checkpoints retain elapsed time, source/capture metadata, bookmarks, My Voice sections, and visible processing state so recovery can restore more context after an app/OS interruption.
- **Mic level raised without retuning the clean-up pipeline:** the supplied PulseStudio sample measured about **4.8 LUFS quieter** than the supplied Apple Recorder sample (and its peak was about 5.9 dB lower). v0.2.110 therefore adds about **+3 dB more mic-only level after RNNoise/voice cleanup** while retaining the existing limiter. System/Teams/Zoom audio level is unchanged, and the working RNNoise fan/air suppression and existing speaker-echo path are otherwise left intact.


## v0.2.104 RNNoise loading, fan/air cleanup, mic level, and speaker detection

- **RNNoise startup bug fixed on modern Chromium/Apple Silicon.** The RNNoise loader now supplies both the standard and SIMD WASM URLs. The previous build supplied only the standard URL even though the library selects SIMD on supported machines, which could produce the logged `Failed to fetch` fallback.
- **Upgrade-in-place dependency check fixed.** The macOS and Windows launchers now explicitly verify `@sapphi-red/web-noise-suppressor`; if an older `node_modules` folder is reused, npm installs the newly required RNNoise package instead of silently skipping it.
- **Fan/air suppression no longer gets dynamically pumped back up.** Enhanced/Strong keep RNNoise as the primary suppressor and use a lighter post-filter when RNNoise succeeds. The WebRTC fallback remains stronger, but the aggressive dynamic normalization that could raise residual air noise under speech has been removed.
- **Mic voice is slightly louder, system audio is not.** The microphone branch receives a small post-suppression lift (about +1.5 dB with RNNoise, about +1.2 dB in the fallback) before limiting.
- **Adaptive speaker-echo cancellation is compatible with the bundled FFmpeg 6.x.** v0.2.103 requested an `anlms` residual mode not supported by FFmpeg 6 and therefore fell back to direct mic mixing. v0.2.104 detects the FFmpeg major version and chooses the correct residual mode, preserving local speech while cancelling system-audio-correlated speaker leakage.
- **False two-speaker splits reduced.** The short-recording speaker-verification merge is slightly more tolerant of the same voice changing acoustically because of noise, while overlapping speaker segments are explicitly protected from being merged.

## v0.2.103 MacBook fan / air-noise suppression

- **Local neural fan/noise suppression is now active for Enhanced and Strong.** The app already included the bundled `@sapphi-red/web-noise-suppressor` / RNNoise assets, but the current recording path was not actually routing the preserved microphone through that local neural AudioWorklet. v0.2.103 records a separate RNNoise-cleaned microphone sidecar while retaining the original source-preserving mic sidecar for recovery and fallback.
- **No single-copy voice risk:** RNNoise never replaces or modifies the recoverable source microphone. If the local AudioWorklet/WASM cannot initialize, the app falls back to Chromium voice/noise processing; if that is also unavailable, the source microphone is still recorded and cleaned after Stop.
- **Residual fan/air cleanup is substantially stronger.** Enhanced now targets persistent low/low-mid fan turbulence and broadband air noise more firmly; Strong applies a more aggressive variant. The previous broadband +1 dB microphone lift remains removed, so noise is not raised together with speech.
- **Fallback cleanup was fixed too.** If the neural sidecar is unavailable, Enhanced/Strong no longer fall all the way back to an almost-raw 65 Hz high-pass path; the source microphone receives the fan/noise cleanup before it is mixed.
- **Reference sample:** the supplied 31.9-second MacBook clip showed a persistent fan bed especially below ~1 kHz. On a deterministic regression pass using the new Enhanced fallback filter, a quiet section around 10.7-13.2 s dropped by roughly 15 dB in the 65-250 Hz band and ~13.5 dB in the 250-1050 Hz band while active speech remained present. The live RNNoise sidecar is applied before this residual cleanup when available.
- Existing system-audio capture, adaptive speaker-echo cancellation, microphone recovery sidecar, My Voice analysis, bookmarks, Mini View UI, transcription, and recording-stop protection remain in place.

## v0.2.102 microphone mix correction and Mini text sizing

- **Critical microphone recording fix:** v0.2.100 introduced an adaptive NLMS speaker-echo stage with the correct reference/mic input order but the wrong FFmpeg output mode. It requested the adaptive filter output (`out_mode=o`), which is the estimated speaker-echo signal, instead of the residual microphone (`out_mode=e`). When system/application audio existed, this could remove the user's local microphone from the saved recording. v0.2.102 uses the residual/error output so local microphone speech is retained while the system-audio-correlated speaker leak is what gets cancelled.
- **Speech-safe fallback:** if the adaptive NLMS filter is unavailable or fails, the fallback now preserves the filtered microphone directly in the final mix instead of heavily ducking it under system audio. Echo rejection becomes best-effort in that exceptional path, but the user's microphone is not sacrificed.
- **No fan/noise retuning:** the existing Enhanced/Strong microphone cleanup, fan/air-noise filters, gain shaping, microphone acquisition, and system-audio capture settings are unchanged from v0.2.101.
- **Slightly larger Mini overlay text:** bottom status/tooltip text and the compact bookmark-entry text are increased only a small amount for readability, with the same translucent styling and layout.


## v0.2.101 Mini Controller bookmark prompt and translucent notifications

- **No opaque black Mini overlay:** bookmark text entry, Mini action confirmations, and Mini toast-style notifications now use a quiet translucent light surface so the Mic/My Voice strip remains visible underneath. Text stays simple and dark; the light theme uses a slightly brighter variant.
- **One-second bookmark text grace period in Mini View:** after adding a bookmark, the optional marker-text entry appears for one second. If no text is started, it closes automatically, keeps the normal default bookmark, and shows `Bookmark added · <time>` instead. If typing starts within that second, the editor stays open so the text can be finished and saved.
- **Full View and playback bookmark editing remain available:** the one-second auto-close applies only to Mini View. Bookmark text can still be added or edited later from Full View/Playback.
- **Audio processing is unchanged from v0.2.100:** this build changes only Mini bookmark/notification UI behavior and version metadata; microphone gain, denoise/fan handling, echo cancellation, system audio, mixing, encoding, and My Voice audio analysis logic are untouched.

## v0.2.100 audio cleanup, background transcription, bookmarks, recording resilience, and My Voice separation

- **Echo + fan/air noise:** Enhanced/Strong microphone cleanup now targets the low fan band more firmly and adds moderate adaptive spectral denoising. When system/application audio is present, the final microphone mix uses an adaptive NLMS acoustic echo canceller against the clean computer-audio reference, with the previous sidechain guard retained as an automatic fallback. This is designed to remove the delayed laptop-speaker copy without lowering the clean attendee track or suppressing unrelated local speech.
- **Transcription starts in the background:** automatic transcription is queued by the main process immediately after a recording is finalized. It no longer depends on switching from Mini to Full View, opening Playback, or selecting the clip. The existing recording-priority rule still pauses local AI whenever a new recording is active and resumes it afterward.
- **Mini bookmark feedback restored:** bookmark/status feedback is again visible during Mini recording and overlays the lower voice/mic strip instead of disappearing because that space is occupied.
- **Bookmark marker text restored:** adding a bookmark while recording opens a compact optional marker-text editor in both Full and Mini View. In Playback, clicking an existing bookmark opens its text editor; the add-bookmark controls also open marker text entry on a normal single click.
- **Unexpected screen-source interruptions:** macOS single-display capture now uses the existing stable canvas relay/reconnect path rather than exposing the native display track directly to MediaRecorder. If macOS ends or temporarily loses the source, the recorder keeps its encoded track alive while reconnecting the same display instead of immediately sealing the recording. Existing safe-stop handling remains for true encoder/write failures; in Mini View, that exceptional warning now stays compact while the exact reason remains visible in the status line.
- **My Voice separation:** the live detector now observes the read-only conferencing-processed microphone branch when available (AEC/noise suppression/voice isolation) while leaving the recording branch untouched. System/mic acoustic matching covers a wider delay range, and saved highlights are refined in 250 ms windows using delayed speech-envelope matching so laptop-speaker leakage can be rejected even when room acoustics make raw waveform correlation weak. Short local interjections during remote speech are retained where the mic no longer matches the system reference.
- The supplied regression audio was checked before this change: it contains a repeated delayed copy around roughly **90-110 ms** and persistent low-frequency fan/air energy in roughly the **60-150 Hz** region. Those findings drove the echo-reference and fan-band changes above.

## v0.2.99 My Voice detection fix on macOS

- Fixes a v0.2.98 wiring issue where the dedicated **My Voice** read-only microphone analyser was reset at normal recording start and was not reattached.
- The My Voice analyser now observes the **source-preserving microphone stream** directly, so a silent/over-filtered secondary conferencing stream cannot make highlights appear unavailable while the actual mic recording is healthy.
- This change is analysis/UI metadata only. It does **not** alter microphone gain, fan/noise cleanup, echo cancellation, noise suppression, speech processing, system-audio capture, recording mixing, or saved audio.


## v0.2.98 My Voice highlights (read-only audio analysis)

- Adds automatic **My Voice** timeline highlighting during recording and playback.
- Uses read-only microphone/system analyser data to suppress likely Zoom/Teams speaker leakage from highlights, including common laptop-speaker echo cases.
- The feature stores timestamp metadata only and does **not** change microphone gain, noise reduction, fan/air-noise handling, echo guard, system-audio mixing, codecs, or saved audio.
- Full View and Mini View show a subtle live voice strip; Playback can show/hide the detected green sections.

## v0.2.97 unified transparency button

- The window-transparency control is now explicitly non-selectable in both Full View and Mini View, so clicking or slightly dragging on the percentage can no longer leave the `0%`/`10%`/etc. text highlighted.
- The transparency icon and percentage remain one button and one click target; the icon/value children no longer intercept pointer targeting separately.
- No recording, microphone, audio-processing, capture, save-feedback, or Mini microphone behavior was changed in this build.


## v0.2.96 fan-noise cleanup, quiet Mini save feedback, and late mic enable

- The microphone final mix no longer applies the v0.2.93 broadband ~+1 dB gain, which raised fan/air noise together with speech. Enhanced/Strong modes now target the low fan band and use a gentle downward gate while retaining a small speech-presence lift.
- Mini View successful-save feedback is now only the small inline **Recording saved** message. The large global toast is suppressed while Mini View is active.
- The in-recording microphone button stays visible even when the recording started with Mic Off. Clicking it can start PulseStudio microphone capture mid-recording; the late microphone sidecar is time-aligned during final mixing, then normal mute/unmute continues without changing the saved pre-recording Mic preference.
- The cursor/capture performance path is intentionally unchanged from v0.2.95.


## v0.2.95 microphone preference + compact saved feedback

- Full View no longer keeps the microphone open before recording merely to animate the Audio check meter. The Mic control now only chooses whether PulseStudio will record the microphone; live microphone access begins when recording begins.
- Mini View now shows the same short, normal-weight inline feedback after a successful save that is used for the microphone mute/resume messages.

## v0.2.94 softer microphone recording feedback

- Mini View again uses the fuller **Microphone muted for this recording** / **Microphone recording resumed** feedback text when the in-recording mic button is toggled.
- The feedback is intentionally understated: normal-weight text, slightly softer color, and a short ~0.9-second display instead of a loud or lingering message.
- The recording/cursor performance path is intentionally unchanged from v0.2.93. No capture scheduling, cursor polling, recording chunk cadence, compositor, or Full View performance-mode code was modified.


## v0.2.93 app-only mic mute, quieter Mini feedback, and slight mic lift

- Full View microphone controls now use the exact same **PulseStudio-only runtime mute** as Mini View while a recording is active. They only enable/disable PulseStudio's microphone tracks; they do not change macOS/Windows system microphone mute or the saved microphone setting mid-recording.
- The Mini Controller no longer shows transcription/queued-transcription status. Transcription continues normally in the background and remains visible in Full View/Playback where there is room for it.
- Mini microphone feedback is intentionally quiet and short: **Mic off** / **Mic on** appears inline for about 0.7 seconds instead of a large multi-second toast. Full View feedback is also shortened.
- The recorded microphone branch gets a conservative **~+1 dB app-only gain** during final mixing, followed by a limiter. System/Zoom/Teams audio level and the physical/system microphone gain are not changed.
- The v0.2.91-v0.2.92 cursor/capture performance path is intentionally unchanged. No cursor polling, capture compositor, recording chunk cadence, Full View performance mode, or mouse movement code was modified.


## v0.2.92 transcription queue, durable recording bookmarks, Full View mic mute, and faster save

- The live microphone mute/unmute control is now available in **Full View** as the same small runtime control used in Mini View. It changes only the microphone track and does not affect system/Zoom/Teams audio.
- Bookmarks added while a recording is running are now part of the sealed recording metadata and are persisted by the main process before finalization is released. They therefore survive Mini/Full View changes, save completion, and recovery, and appear as playback timeline markers after the recording finishes.
- Normal Stop uses one microphone filtering/mixing pass instead of a separate microphone-master pass followed by another mix pass. This reduces save latency. If H.265 is selected but no hardware HEVC encoder is available, PulseStudio preserves the recording quickly as validated H.264 rather than blocking Stop on a slow software x265 conversion.
- Transcription has strict priority over speaker detection and optional AI work. A newly queued transcription can pause lower-priority local AI work, and a transcription worker that stops reporting progress for three minutes is restarted once automatically. If it stalls again, the worker is recycled so the next queued clip can continue instead of waiting indefinitely.
- A recording can now be moved to Trash while it is queued for transcription or actively being transcribed. PulseStudio immediately cancels that recording's AI job and associated FFmpeg extraction, removes its queued work, then advances the local worker to the next task. Batch deletion follows the same rule.
- The v0.2.91 cursor/capture performance path is intentionally unchanged in this build. No cursor polling, capture compositor, chunk cadence, Full View recording performance-mode, or mouse-movement code was modified.


## v0.2.91 call echo suppression, live Mini mic control, and Full View pointer smoothing

- The call-audio echo guard is stronger for MacBook-speaker use. The clean system/application audio is now a more sensitive sidechain reference with faster attack and a longer release, suppressing the delayed loudspeaker copy that leaks into the microphone between remote-speaker syllables. Headphone/earphone recordings are unaffected.
- Mini View now shows a small microphone button immediately before **REC** while a recording is active and a microphone stream exists. Click it to mute the microphone mid-recording; click again to resume. The microphone recorder stays running with silence while muted so timing remains continuous and synchronized.
- Full View meters now update at 1 Hz instead of 4 Hz, broad UI animations/transitions are suspended for the duration of recording, and main video chunks are flushed in smaller 500 ms pieces. This reduces large renderer/IPC allocation bursts that could cause intermittent pointer shakes or short stalls during long recordings.
- H.265/HEVC remains a post-stop output conversion; live capture still uses Chromium MediaRecorder/H.264 when available, so selecting HEVC is not what drives cursor load during the recording itself.


## v0.2.90 recording reliability, call-audio echo guard, resource priority, and diagnostics

- Normal **Stop recording** now has a save barrier: Start remains unavailable until the just-stopped capture is sealed, normalized, microphone/system audio is mixed, and the final file passes validation. This prevents a normal Stop/quick Start cycle from turning the previous file into a recovery job.
- Interrupted recordings are now **protected but not auto-recovered at launch**. Recovery is user-initiated with compact **Recover** and **Files** actions, never blocks a new recording, and does not consume CPU/GPU in the background unless you explicitly start it.
- During recording, local AI work is paused/deferred and resumed afterward. Previous-recording transcription/diarization/meeting-note jobs therefore cannot compete with live capture.
- Zoom/Teams-style call recordings now use a system-audio-referenced microphone echo guard during final mixing. Remote speech already present in system audio ducks the delayed loudspeaker copy that leaks back into the microphone, while the local microphone remains full level when the remote side is quiet.
- Full View recording does less renderer work: pre-recording readiness polling is suspended during capture, the source chooser is removed from active paint/layout work, the audio meters use a low-frequency timer instead of a 60/120 Hz animation-frame loop, the full-view duration refreshes once per second, and the existing opaque/non-vibrant performance mode remains enabled.
- Unexpected MediaRecorder/capture-source stops are logged and converted into a visible **Recording stopped early** save path instead of silently leaving an unfinished session.
- A rotating JSON-lines activity log is written to `app/logs/pulsestudio.log` (up to four rotated backups). It records app/runtime versions, capture settings and actual track settings, chunk heartbeats, CPU/memory/process snapshots, renderer event-loop drift, FFmpeg/encoder work, AI pause/resume, recovery, unexpected track/encoder stops, finalization, and renderer crashes. Use **About & Diagnostics → Open logs** to open the folder. Recording audio/video content is never written into the log.
- HEVC/H.265 remains a post-stop output choice rather than the live MediaRecorder capture codec. Hardware encoding is preferred; software fallback now uses a faster preset to reduce save time.

## v0.2.89 playback integrity and Full View pointer responsiveness

- MediaRecorder MP4 output is no longer copied directly into Movies. The stopped file is remuxed into a normal fast-start MP4 and a real video frame is decoded before the save is accepted. If remuxing is not possible, PulseStudio falls back to normal MP4 transcoding.
- A malformed video from v0.2.88 can be repaired automatically when playback first fails. The original is only replaced after the repaired copy successfully decodes.
- During an active recording in Full View, the large PulseStudio window temporarily becomes opaque/non-vibrant and disables expensive glass blur/animations. The user's transparency setting returns immediately after Stop or when switching to Mini View.
- Full View recording meters and timer UI update less aggressively to preserve pointer responsiveness.

## v0.2.88 Full View recording responsiveness

- Normal single-screen and single-window recordings now use a zero-copy/direct video path: the operating-system capture track is passed straight to MediaRecorder instead of copying every frame through a renderer canvas. Region, All Displays, webcam overlay, click highlighting, and keystroke overlay still use the compositor because they require drawing.
- The direct path keeps the operating-system cursor path and removes the largest per-frame renderer workload, specifically targeting the remaining pointer lag that was visible only while recording in Full View.
- During Full View recording, disabled source/settings UI no longer uses expensive CSS saturation filters or hover transitions. Non-selected source thumbnails are suppressed while capture is active, reducing GPU compositing work in the large window without changing the selected capture source.
- If a direct entire-screen OS track temporarily mutes, the recording stays open and resumes automatically when frames return. If the OS actually ends the track, PulseStudio stops and seals the recording safely rather than changing tracks mid-file and risking corruption. Composite/overlay recordings retain the stable relay/reconnect path from v0.2.87.



## v0.2.87 playback, cursor responsiveness, and entire-screen resilience

- Video playlist selections now use an atomic video-loading state with a reserved video viewport, so an audio-sized player is never shown before the first video frame.
- The recording compositor follows captured video frames instead of repainting at the monitor refresh rate. A low-frequency watchdog is used only if the source stalls. This removes the unnecessary 60/120 Hz full-canvas redraw load that could make the mouse feel sticky or shaky in Full View while recording.
- Ordinary single-display capture also requests the selected 1080p/1440p working size from the OS when possible, avoiding needless 4K/5K decode-and-downscale work. Native-quality capture is unchanged.
- Entire-screen capture keeps a stable canvas relay and now reconnects the same physical display after an OS-level screen-source interruption. If the display is still unavailable, it keeps the recording container alive on the last frame and retries automatically. The MediaRecorder output track itself is never swapped.
- If the recording file reports a chunk-write or encoder failure, PulseStudio stops and seals the data safely instead of allowing a rejected write queue to continue silently.
- The duplicate lower Recording strip is hidden in Full View while recording; the right-side Recording Controls panel remains the single place for duration, Stop, Pause, and Bookmark. Mini View behavior is unchanged.

## v0.2.86 recovery priority and playback loading

- Previous-session recovery no longer blocks **Start recording**. The interrupted capture is first detached into its own protected recovery manifest, leaving the active recording journal free for a new capture.
- Recovery runs as background work and exposes **Stop recovery**. Stopping it preserves the unfinished source, pauses automatic retry on later launches, and leaves **Recover recording** available when you want it.
- Starting a new recording automatically pauses/stops background recovery so live capture has priority over FFmpeg recovery work.
- Video selections now stay on a neutral **Loading video…** surface until the first video frame is ready, instead of briefly presenting the audio-only state before the video appears.
- Timeline preview decoding and waveform extraction are deferred until the main video has loaded (and the preview video itself is lazy-loaded on hover), reducing competing disk/decoder work when opening a recording.
- Audio-only files continue to use the dedicated audio player presentation immediately.

## v0.2.85 recording Full View usability

During an active recording, the Full View right rail now scrolls normally with the page instead of staying pinned, so **Recording setup**, **Recording options**, and **App & AI tools** remain reachable. Pre-recording-only blocks in Recording Controls collapse while capture is active; the live audio check, duration, Stop, Pause, and Bookmark controls remain visible.

Full View recording also no longer renders the captured display back into the recorder as a live self-preview. Single-screen/window capture uses the operating-system cursor directly where possible, cursor polling is reserved for region/multi-display mapping or pointer highlighting, and the live audio meters are limited to 20 FPS. These changes reduce recursive cursor feedback and renderer load that could make the mouse feel sticky, doubled, or flickery over the PulseStudio window while recording. The saved recording path and encoding pipeline are unchanged.


## v0.2.84 Mini transparency tooltip

The Window Transparency help in Mini View is now deliberately less intrusive. It uses a compact **Window transparency: N%** message, waits one full second before appearing, only opens from a deliberate pointer hover (not keyboard/window focus), and is immediately dismissed/suppressed when the window is clicked, dragged, activated from the Dock, blurred, or refocused. The transparency button no longer relies on a native browser title bubble, preventing the large sticky tooltip from covering the Mini Controller.

## v0.2.83 icon refresh

The PulseStudio application icon now uses the **Screen Wave** concept from option C with the **teal, dark-teal, white, and coral-red palette** from option D. The same artwork is used for the in-app Full View brand mark and the packaged macOS, Windows, and Linux application icons. The macOS privacy identity remains the signed **Electron** host; this build does not change the stable permission/runtime architecture.

## v0.2.82 window restore

PulseStudio now remembers whether it was last closed in **Full View** or **Mini View** and restores that mode before the window becomes visible. Full-window bounds and the existing Mini position are also persisted. This prevents the brief Full View flash when launching an app that was last closed in Mini View.

This build retains the stable macOS capture runtime and adds a Mini-window position guard for macOS. The Mini Controller now treats its last deliberate drag position as the user's anchor and restores that exact position if macOS moves the floating window after display sleep/wake, unlock, Spaces/display geometry changes, or a transient work-area recalculation. Manual dragging still updates and saves the Mini position normally.

The playback **CC** control remains compact, subtitles use normal-weight text, named bookmark markers remain available, and the screen-sharing privacy indicator remains visible in both Full and Mini views.

Meeting transcription remains the primary local-AI job. Meeting-note enhancement stays optional and must not block recording or transcription.

## Start here

Choose the launcher for your computer:

- **macOS:** double-click `PulseStudio.app`
- **Windows:** double-click `Start PulseStudio - Windows.bat`

Keep the complete **PulseStudio** folder together. Both launchers use its shared
application files; do not move only the `.app` or `.bat`.

## Full View and Mini View

Full View contains the complete recording setup, Quiet Studio Playback library,
audio and AI options, Help, and About & Diagnostics. Its window remains opaque
and does not show a transparency control. The existing Classic/Studio themes
and light/dark appearance choices remain available. New installs use Light
appearance; saved appearance preferences are preserved on upgrade.

Choose the pastel blue **Open Mini Controller** action in Full View to keep the
recording controls on screen while you work. Mini View uses the original compact
262 × 84 content layout, with balanced icons, small side insets, and the updated
Classic Mac styling.

Mini View keeps the recording controller compact. Before recording, choose the
**Video + Audio** or **Audio Only** icon-only selector, then choose **Start**.
Hover briefly to see the mode name and selection state. During recording,
the small mode icon beside the recording status confirms the active mode. Use
the microphone, Pause, Bookmark, and Stop controls as before. Choose the Full
View control whenever you need the full setup or playback library.

When adding a bookmark during Mini recording, you have **3 seconds** to start
typing optional marker text. Once you start typing, the entry stays open until
you save or dismiss it. Use **Save** or **Enter** to save the text, or skip the
text to keep the default bookmark.

The small Mini transparency bar runs from **0% to 75%**. Drag it to set any whole
percentage, or focus it and use the arrow keys. A higher value makes Mini View
more transparent; **75% transparency means 25% opacity**. The value is remembered
between launches and applies only to Mini View. Moving the bar changes the
setting instead of dragging the window.

Hover briefly over an unfamiliar icon to see a short tooltip. Mini tooltips are
placed outside the controller so the recording information stays visible.

## Playback in Quiet Studio

Open **Playback** and choose a recording in the library. Quiet Studio keeps the
recording library on the left, player in the center, and tools inspector on the
right. In a narrower window, the inspector stacks below the player.

- **Library:** search, All/Video/Audio/Favorites filters, categories, selection,
  and batch Trash stay with the recording list. Each recording keeps its
  favorite, rename, Trash, and category actions.
- **Player:** waveform, transport, bookmarks, snapshots, CC, volume, speed,
  and fullscreen remain together. Related file and export actions are grouped
  beside the player. Open an action group for less-frequent controls.
- **Transcript:** Raw, Speakers, and Timecoded views, transcript search,
  and transcript exports. Speaker corrections are grouped with the speaker view.
- **Insights:** chapters, meeting notes, and action items with their existing
  copy, regenerate, and collapse controls.
- **Trim & cuts:** export Clip, Audio, TXT or SRT between two saved bookmarks,
  precision trimming and multiple cuts, all saved as new files.
- **Timeline:** bookmark and chapter navigation.

Recording setup stays in **Record**; the Mini Controller continues to provide
the compact recording controls.

The media filter keeps All/Video/Audio/Favorites on one compact row. Open
**Sort & filter** for all eight date, duration, name and size sort choices and
category filtering. Your sort choice is remembered, and Previous/Next follow
the displayed order. Drag the divider between the library and player to resize
them; its handle spans the panel.

## Saving and background transcription

After Stop, the protected recording is saved in the background. v0.2.141 removes
an unnecessary full-recording decode used to detect an audio stream; the check
now reads actual stream headers. Record and Mini leave the Saving phase once
the media is ready, while library metadata refreshes separately. An unrelated
library refresh failure does not turn a completed save into a recovery error.
Encoding, microphone cleanup and mixing can still
take time, particularly for long recordings or a codec that needs conversion.
Interrupted saves retain their recoverable source and recovery controls.

Automatic transcription runs separately after the media is ready, without
delaying the saved-media result. One reusable local Whisper Small q8 session
avoids reloading the model for each recording; initial model loading and long
transcriptions can still take time. Recording keeps priority over AI work.

New recordings, transcripts, snapshots and default exports use
**Movies/PulseStudio** on Mac or **Videos/PulseStudio** on Windows. Your custom
folder is retained. Older media directly in Movies/Videos remains readable in
Playback without moving unrelated files. Regenerated legacy transcripts are
saved in the PulseStudio folder.

## Recording microphone and meeting audio

For a meeting, select the computer or application audio you want to record and
turn on the microphone if you also want your own voice. Whenever the microphone
is enabled, PulseStudio automatically requests whole-system speaker echo
cancellation only when that capability is advertised, then verifies that it was
applied. If unavailable, it uses the available browser cancellation path.
Echo handling is independent of the Computer Audio toggle; no separate echo
setting is needed.

Choose **Off**, **Standard**, **Enhanced voice**, or **Strong** under
**Record → Recording setup → Noise removal**. Enhanced voice remains recommended
for normal rooms; use Strong for unusually loud fan or air noise. These choices
affect capture and microphone cleanup; Playback does not add a new noise-preset
selector. Results depend on the microphone, speaker volume, output device, and
room. Headphones help prevent speaker sound from reaching the microphone.
If you only need the meeting audio and not your own voice,
leave PulseStudio's microphone off; this does not mute your meeting app.

When available, separate source microphone, cleaned microphone, and unmixed
computer-audio reference tracks are retained locally in the hidden
`.pulsestudio-audio-sources` folder beside the saved recording. Only sources
that were captured are retained. These companion tracks follow the recording
when it is renamed, moved to Trash, or recovered. Microphone/system audio is
not uploaded.

## First launch

The shared package includes prepared runtimes for **Apple silicon Mac** and
**Windows x64**. Apple silicon Mac unpacks its local payload on first launch;
Windows opens its included application directly. Neither requires a separate
Node.js installation or a setup download for these prepared platforms.

Before the first launch:

1. Extract the ZIP completely into a writable location. Do not run from the ZIP preview.
2. Open the extracted **PulseStudio** folder and use your platform's launcher.
3. Allow access to the folder containing PulseStudio if macOS asks.

Apple silicon Mac's first launch can take a few minutes to unpack locally. Later
launches reuse the prepared files. Intel Mac uses the launcher's bounded setup
and may need an internet connection to obtain its compatible runtime. Windows
ARM requires Windows 11 support for x64 application emulation.

Setup progress, cancellation, and access to the setup log are shown in the Mac
launch window. Launch failures show a graphical message with access to the log.
The original macOS `.command` remains available for troubleshooting.

### macOS runtime identity

**PulseStudio.app** is the clickable launcher. Before it opens the recording
host, v0.2.143 prepares the physical host folder as **Pulse Studio.app** and
keeps **Electron.app** as a compatibility link to that same host. The existing
executable bytes, bundle identifier, signing requirements and established
PulseStudio data folder are preserved. The Apple silicon runtime in this ZIP
is linker/ad-hoc signed, not Developer-ID signed or notarized.

Earlier display-name metadata and registration changes did not reliably change
the Dock's Electron label. The current launcher now uses the physical branded
host path. It never moves a running host: **quit PulseStudio completely before
opening this version**. A runtime currently in use is left in place, and the
launcher asks you to quit and reopen so naming can finish safely.

Display-name metadata is changed only after verifying that the stock host's
Info.plist and resources are unsealed; sealed or unfamiliar hosts are left
unchanged. Folder preparation checks that the executable, signature and bundle
metadata stay identical. No re-signing or permission reset is performed for
naming. Quit the existing instance and reopen the updated app to use the
prepared host.

The **Pearl Screen** icon uses a light pearl tile with a monitor and waveform.
In the Mac Dock, its symbol changes from sky blue while idle to aqua during
recording, then returns to sky blue on Stop or Cancel. The shape stays the same
and there is no red indicator dot or flashing. Windows uses the same Pearl
Screen application design.

macOS privacy settings may show **Electron** or **Pulse Studio** for this same
host. Keep the existing permission enabled and follow macOS's permission prompt
when needed. Saved application data remains in the established PulseStudio folder.

## macOS permissions

macOS may ask for permissions depending on the features you use, including:

- Screen & System Audio Recording
- Microphone
- Camera
- Accessibility/Input Monitoring for related controls

For screen capture in this local ZIP:

1. Open **System Settings → Privacy & Security → Screen & System Audio Recording**.
2. Enable the current recording host, shown as **Electron** or **Pulse Studio**.
3. Quit any older PulseStudio build that is still running.
4. Start v0.2.143 using `PulseStudio.app`.
5. Choose **Refresh** only if the source thumbnails have not appeared automatically.

The stock host retains its Electron bundle identity even when the Dock name is Pulse Studio. There is no need to delete an existing permission row for this update.

PulseStudio checks the real desktop-capture capability and also retries screen and window enumeration independently if macOS fails a combined source query. A failure to enumerate windows therefore no longer blocks display recording when display sources are still available.

For local Electron-host mode, PulseStudio also uses macOS's Screen & System Audio Recording path for system audio while preserving the host's permission identity.

Allow only the permissions needed for the features you want to use.

## Windows permissions

Windows may ask for microphone, camera, screen-capture, or security permissions depending on the features you use and your system policy.

## Screen sharing privacy

In **Full View → App & AI tools**, use **Hide PulseStudio from screen sharing & screenshots** to choose whether this app should be hidden from compatible screenshots and screen-sharing tools.

- Leave it **On** during calls when you do not want other people to see the PulseStudio window.
- Turn it **Off** when you intentionally want to record, screenshot, or share PulseStudio itself.
- The choice is remembered between launches and applies to both Full and Mini views.

This is a best-effort operating-system privacy control, not an absolute guarantee. Support varies by operating system and sharing/capture application.

## Folder layout

The extracted folder is intentionally simple:

- `README.md` — this guide
- `QUICK_START.txt` — launch and Mini View instructions
- `RELEASE_NOTES-v0.2.143.md` — changes and retained features in this release
- `PulseStudio.app` — clickable macOS launcher
- `Start PulseStudio - macOS.command` — macOS troubleshooting launcher
- `Start PulseStudio - Windows.bat` — Windows launcher
- `Publish PulseStudio.command` — owner-controlled GitHub publisher for Mac
- `Publish PulseStudio - Windows.bat` — owner-controlled GitHub publisher for Windows
- `Publish PulseStudio - Windows.ps1` — companion script for the Windows publisher
- `PUBLISHING.md` — first-time owner publishing setup and read-only checks
- `THIRD_PARTY_NOTICES.txt` — required third-party notices
- `app/` — PulseStudio application, support, build, runtime files, and rotating diagnostics in `app/logs/`; normal users do not need to open or edit this folder

## If the app does not open

1. Make sure the ZIP was fully extracted.
2. Keep the complete extracted folder together and confirm it is writable.
3. Quit any older PulseStudio instance before starting the new version.
4. Open the launcher for your operating system again and read its graphical error message.
5. On macOS, confirm **Electron** is enabled in Screen & System Audio Recording.
6. Open the setup/launcher log from the error dialog. On Mac it is at `~/Library/Logs/PulseStudio/launcher.log`; on Windows it is at `%LOCALAPPDATA%\PulseStudio\logs\launcher.log`.

Do not delete recovery files if a recording was interrupted; PulseStudio protects them and lets you choose **Recover** when convenient.


## Automatic updates

Both Mac and Windows PulseStudio clients check the public
[`girishxp/PulseStudio` GitHub Releases feed](https://github.com/girishxp/PulseStudio/releases)
automatically: about 2.5 seconds after launch, then about every 15 minutes while
open. When a newer `PulseStudio-cross-platform-v<version>.zip` is available and
PulseStudio is idle, an in-app popup offers **Update Now**, **Remind Me Later**
(24 hours), and **Skip This Version**. Checks and installation wait for active
recording, saving, recovery, local AI and media processing to finish. Manual
**Check for updates** remains in About & Diagnostics.

**Update Now** downloads the same shared ZIP on either OS, checks its GitHub
asset size and SHA-256 digest when GitHub provides one, and then installs and
reopens when safe. If activity blocks a downloaded update, **Install & Reopen**
remains available once that activity finishes. The app exits before files are
replaced. Saved application data, recovery data, local dependencies and logs
are retained. Internet access, a writable extracted folder and a newer public
Latest release with the matching ZIP asset are required. Users do not need a
GitHub account or GitHub CLI to receive or install updates.

Owners can publish from either OS using the files in this same folder:

- **Mac:** double-click **Publish PulseStudio.command**.
- **Windows:** double-click **Publish PulseStudio - Windows.bat**; keep its
  companion **Publish PulseStudio - Windows.ps1** beside it.

Both are owner publishing tools. Ordinary users keep launching PulseStudio.app
on Mac or Start PulseStudio - Windows.bat on Windows. One publisher run uploads
one complete shared ZIP for both systems. Merely pushing source changes does not
trigger updates: a newer semantic version and matching downloadable ZIP must be
published as a public **Latest** release. Both publishers ask before commit,
push and release creation; this delivery has not been published automatically.

This release uses tag `v0.2.143` and asset
`PulseStudio-cross-platform-v0.2.143.zip`. Bundled platform runtimes remain in
that downloadable ZIP and are excluded from Git source commits. The portable
ZIP updater preserves its established update behavior; no AWS server is needed.

The Mac and Windows **publisher 1.1.0** helpers verify the active GitHub.com
account and repository write access directly. An unrelated saved enterprise
account does not affect these checks. Existing environment tokens remain in use;
a rejected token has a separate message from connection and permission errors.

For a read-only check, run the appropriate publisher with `--check-only`. It
checks the account and repository access without extracting a build, changing
source files, committing, pushing or creating a release. Helper revision numbers
are independent of the app version. See [PUBLISHING.md](PUBLISHING.md) for setup,
full-path examples and the Windows PowerShell companion requirements.

## Anonymous product analytics

PulseStudio's anonymous product analytics are **on by default** when the
configured PostHog backend is available. v0.2.142 removes the analytics switch
and reminder from the interface; existing stored backend preferences remain
preserved across upgrades. The client reports an anonymous installation ID,
app version, operating system/architecture, session activity, recording
success/reliability metadata, feature usage and update adoption. It never sends
recordings, screen contents, microphone/system audio, transcripts, filenames,
bookmark text, names, email addresses or exact location. Country-level reporting
can be derived by PostHog from the request network location.

Owner setup: create a PostHog Cloud project, copy its **Project API Key** (the client-side `phc_...` key), then place it in `app/analytics-config.json` as `apiKey`. You may also set `PULSESTUDIO_ANALYTICS_KEY` while testing. Publish the next PulseStudio release after adding the project key. Do not place PostHog personal API keys or other secrets in the application.
