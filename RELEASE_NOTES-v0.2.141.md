# PulseStudio v0.2.141

Playback now uses the quieter **Quiet Studio** organization, the app has the
approved **Pearl Screen** artwork, and saving no longer decodes the entire
recording just to check whether an audio stream exists.

## Changes

- **Playback:** a calmer library, compact player toolbar and grouped file,
  export and transcript actions give the recording and transcript more room.
  Transcript, Insights, Trim & cuts and Timeline remain available, along with
  the existing playback controls, search, categories, favorites, selection,
  rename, Trash, snapshots, captions, speed, fullscreen and export options.
  Speaker corrections are grouped with the speaker view.
- **Icon:** Pearl Screen uses a light pearl rounded tile, a monitor and a
  waveform. On the Mac Dock, the same symbol changes from sky blue while idle
  to aqua while recording, and returns to sky blue after Stop or Cancel.
  There is no red indicator dot or flashing. Windows uses the Pearl Screen
  application artwork.
- **Saving:** the audio-stream check reads headers instead of fully decoding
  the recording, removing unnecessary work from the save path. Encoding,
  microphone cleanup/mixing, source retention and recovery remain protected.
  Video-only capture with a microphone no longer creates a false computer-audio
  reference from zero-byte output statistics. Record/Mini release their Saving
  phase when the media is ready, while library refresh continues separately;
  a library metadata error cannot misreport a completed recording as failed.
  Long recordings and codec conversion can still take time. Transcription runs
  separately in the background after media is ready.
- **Publisher:** includes helper 1.1.0 with direct GitHub.com authentication and
  repository write-access checks, clearer account/connection/permission errors,
  and read-only `--check-only`. A timeout on another saved GitHub host no longer
  causes a false unauthenticated error for PulseStudio.
- **Version and help:** current documentation, Help, About and launcher metadata
  report v0.2.141. Prior release history keeps its original version numbers.

## Retained behavior

- One shared PulseStudio folder with the Mac `.app` and Windows `.bat` launchers.
- Record and the **262 × 84** Mini Controller, Audio Only/Video + Audio icons,
  stable pastel-blue Start/Stop, native window controls, natural tooltips,
  **3-second** bookmark text entry and Mini-only **0–75%** transparency.
- Clip, Audio, TXT and SRT exports between two saved bookmark IDs. Interval
  transcript exports use only bounded cues or transcribe the selected audio;
  SRT times are relative to the exported interval.
- New recordings, transcripts and default exports in **Movies/PulseStudio** on
  Mac or **Videos/PulseStudio** on Windows, with saved custom folders and access
  to legacy recordings preserved.
- Date, duration, name and size sorting in both directions, remembered ordering
  and matching Previous/Next navigation.
- Automatic background transcription and reusable local Whisper Small q8
  sessions, with recording priority and established quality settings retained.
- Automatic supported speaker echo cancellation, existing microphone cleanup
  modes and available raw/cleaned microphone and unmixed computer-audio tracks.
- Existing analytics configuration and consent, installation identity, update
  notifications, recovery data and prepared platform runtimes.

This package does not publish itself to GitHub. The owner can publish the
complete `PulseStudio-cross-platform-v0.2.141.zip` using the included publisher.
