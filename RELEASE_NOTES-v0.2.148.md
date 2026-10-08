# PulseStudio v0.2.148

- Adds bundled, local WebRTC AEC3 microphone cancellation using an explicit
  captured-system-audio reference, before noise suppression. Computer audio
  stays stereo and is mixed once; no microphone loudness boost is added.
- Fixes raw microphone packet-clock corruption on Bluetooth/speaker changes
  by using a silent fixed 48 kHz clock and stable raw/processed recorder tracks.
- Refreshes the selected microphone and acoustic estimator after device changes,
  preserving pause/mute state. Cancelled setup cannot reopen capture after Stop.
- Keeps microphone audio available when a processing stage fails. New AEC3
  latency is compensated during the existing single-pass save operation.
- Restores direct Open folder / Show in folder actions and all five bookmark
  icons plus interval export, without a bookmark dropdown. Fixes the sticky
  player position after narrow-window resizing.
- Preserves the Mini dimensions/tab, themes, Dock identity/artwork, background
  transcription, recovery, analytics, update review and both owner publishers.

Source replay measured about 11.8 dB median reduction in reference-correlated
speaker leakage in the supplied clip; clean headphone speech was preserved
within about 0.4 dB. These are measured replay results, not a zero-echo guarantee
or an end-to-end live Windows/headset certification.
