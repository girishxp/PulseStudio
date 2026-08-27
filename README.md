# PulseStudio v0.2.111

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

- **macOS:** double-click `Start PulseStudio - macOS.command`
- **Windows:** double-click `Start PulseStudio - Windows.bat`

That is all most users need to do.

## First launch

PulseStudio installs its required Node.js packages on first launch when they are not already present.

Before the first launch:

1. Install the current **Node.js LTS** release if Node.js is not already installed.
2. Keep an internet connection available for the initial dependency download.
3. Extract the ZIP completely before starting the app. Do not run the launcher from inside the ZIP preview.

The first launch can take a few minutes while dependencies are prepared. Later launches reuse those dependencies and are much faster.

If npm installs the Electron package but skips its binary download, the macOS launcher now repairs the missing signed `Electron.app` automatically by running Electron's own downloader directly. This avoids the v0.2.74 failure that said the stable Electron runtime was missing after a successful npm install.

### macOS runtime identity

For this local cross-platform ZIP, the macOS launcher intentionally starts PulseStudio through the signed **Electron.app** runtime instead of creating a newly ad-hoc-signed PulseStudio.app for every version.

This is deliberate: macOS Screen Recording permission is tied to code-signing identity. A rebuilt ad-hoc app can leave an old **PulseStudio** row visibly switched on while the new binary is still rejected by macOS. The signed Electron host keeps the permission identity stable while PulseStudio itself continues to use the **PulseStudio** name and Dock icon in its UI.

Therefore, in **System Settings → Privacy & Security → Screen & System Audio Recording**, the permission entry that matters for this local v0.2.111 package is **Electron**. Any obsolete app permission entry left by much older local builds can be ignored.

## macOS permissions

macOS may ask for permissions depending on the features you use, including:

- Screen & System Audio Recording
- Microphone
- Camera
- Accessibility/Input Monitoring for related controls

For screen capture in this local ZIP:

1. Open **System Settings → Privacy & Security → Screen & System Audio Recording**.
2. Make sure **Electron** is enabled.
3. Quit any older PulseStudio build that is still running.
4. Start v0.2.111 using `Start PulseStudio - macOS.command`.
5. Choose **Refresh** only if the source thumbnails have not appeared automatically.

If both **PulseStudio** and **Electron** are present, v0.2.111 uses **Electron** for the macOS privacy identity. You do not need to delete the old PulseStudio row.

PulseStudio checks the real desktop-capture capability and also retries screen and window enumeration independently if macOS fails a combined source query. A failure to enumerate windows therefore no longer blocks display recording when display sources are still available.

For local Electron-host mode, PulseStudio also uses macOS's Screen & System Audio Recording path for system audio so it does not depend on modifying Electron.app's signed Info.plist.

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
- `Start PulseStudio - macOS.command` — macOS launcher
- `Start PulseStudio - Windows.bat` — Windows launcher
- `THIRD_PARTY_NOTICES.txt` — required third-party notices
- `app/` — PulseStudio application, support, build, runtime files, and rotating diagnostics in `app/logs/`; normal users do not need to open or edit this folder

## If the app does not open

1. Make sure the ZIP was fully extracted.
2. Make sure the current Node.js LTS release is installed.
3. Quit any older PulseStudio instance before starting the new version.
4. Run the launcher for your operating system again and read any message shown in the Terminal/Command Prompt window.
5. On macOS, confirm **Electron** is enabled in Screen & System Audio Recording.
6. Check the macOS launcher log at `~/Library/Logs/PulseStudio/launcher.log` if startup preparation fails.

Do not delete recovery files if a recording was interrupted; PulseStudio protects them and lets you choose **Recover** when convenient.
