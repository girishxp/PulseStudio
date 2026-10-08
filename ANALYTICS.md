# PulseStudio Analytics

PulseStudio v0.2.144 remains connected to the PulseStudio PostHog Cloud project (US region).
This release preserves the existing backend configuration, anonymous installation
identity, and saved analytics preference while updating the reported app version.

## Privacy

Anonymous product analytics are enabled by default when the configured PostHog backend is available. v0.2.142 removes the analytics switch and launch reminder from the interface. The existing backend preference remains stored and respected across upgrades; an installation with a previously stored disabled preference does not send product analytics. The backend configuration and event content limits are unchanged.

PulseStudio never includes recordings, screen contents, microphone/system audio, transcripts, filenames, bookmark text, names, email addresses, or exact location in analytics events. A random installation ID is used as the PostHog `distinct_id`. PostHog may derive coarse country/region information from the network request.

## Core analytics available

PulseStudio v0.2.144 retains the privacy-limited instrumentation from v0.2.129 for product usage, trends, reliability, and errors, with the same PostHog project token. Event properties use control IDs, categorical settings, counters, duration buckets, and sanitized error names/codes rather than user content.

- Active installations and sessions (`app_started`, `app_heartbeat`, `app_closed`), session IDs, launch counts and install-age trends
- App version, OS, architecture, Electron version and portable/installed mode
- Recording starts, stops, successful completions and failures
- Recording duration buckets and capture configuration
- Microphone mute use and microphone cleanup mode
- Recording health, capture interruptions, unexpected stops, writer/encoder failures
- RNNoise fallback occurrences
- Bookmarks saved
- My Voice highlight and voice-profile events remain intentionally inactive while the feature is disabled for audio-isolation testing
- Playback timeline, captions, transcript, snapshot, fullscreen, speed, recording-selection and shortcut usage
- Broad non-content UI control usage (`ui_control_used`) grouped by feature area
- Transcription, speaker detection and meeting-insight start/completion/failure trends
- Renderer crashes/unresponsiveness, recovery events, microphone/system-audio track interruptions, background-process failures and sanitized generic warnings/errors
- Classic/Studio theme and light/dark appearance changes
- Diagnostics exports
- Update checks, availability, download completion, install attempts and update errors

## Useful PostHog dashboard cards

1. Daily / weekly / monthly active installations: unique `distinct_id` on `app_heartbeat` or `app_started`.
2. Version adoption: `app_heartbeat` grouped by `app_version`.
3. Country distribution: `app_heartbeat` grouped by PostHog GeoIP country property.
4. OS mix: `app_heartbeat` grouped by `platform`.
5. Recording reliability: `recording_completed` vs `recording_started`, plus `recording_failed` and `recording_unexpected_stop`.
6. Update adoption: `app_heartbeat` grouped by `app_version`, with `update_available`, `update_downloaded`, and `update_install_started`.
7. Feature use: `bookmarks_saved`, `voice_highlights_completed`, `timeline_toggled`, `captions_toggled`, `transcript_opened`, `playback_snapshot`, and theme events.
