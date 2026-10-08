# PulseStudio v0.2.145

- Fixes startup rejection on Macs without developer tools. The launcher reads
  Mac binary headers itself instead of requiring lipo from Xcode/Command Line
  Tools, and reports exact component problems when preparation cannot finish.
- Checks complete-looking dependency folders and restores a matching bundled
  runtime before attempting downloads when their platform/architecture is wrong.
- Routes newly generated Mac update reopens through PulseStudio.app and its
  bounded startup checks, rather than opening the cached Electron host directly.
- Moves update details and download/install choices out of the 262 × 84 Mini
  window. Mini shows a small Review update notice; Full View displays the complete
  update sheet and offers Back to Mini without stopping or pausing recording.
- Keeps existing options, playback layout fixes, audio processing, transcription,
  exports, recording folders, saved settings, analytics and owner publishers.
  Updates Help, About, launcher version and current documentation to v0.2.145.

This package is a local build. It is not uploaded to GitHub automatically.
