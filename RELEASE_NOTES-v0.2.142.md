# PulseStudio v0.2.142

This release refines recording controls and Playback library spacing, corrects
saved-recording feedback and makes Pearl Screen's recording state more visible.

## Changes

- **Recording controls:** quieter Full View controls and a moderately sized
  recording button. Video + Audio, Audio Only, webcam, audio checks, recording
  settings, save-folder access and shortcuts remain available. Mini keeps its
  compact 262 × 84 dimensions and established controls.
- **Analytics interface:** removes the anonymous-analytics switch and launch
  reminder. Product analytics remain enabled by default for new installations.
  Existing backend configuration, anonymous identity, stored preference and
  content exclusions are retained.
- **Saved recording:** completion feedback displays the saved file path rather
  than “Not saved yet.” Show in folder and Copy path use the actual saved file. Mini-to-Full
  transitions restore the card; successful deletion of that recording clears it.
- **Playback library:** a full-height resize divider, one media-filter row and
  a compact **Sort & filter** popover for all eight date/duration/name/size sorts
  and category options. All library choices remain available.
- **Pearl Screen:** slightly stronger sky-blue idle artwork and a more distinct
  aqua symbol and lower tile during recording, with the same geometry, no red
  dot and no flashing.
- **Mac app name:** refreshes the exact host registration for normal launch and
  direct updater reopening, including already-branded runtimes. The visible name
  is Pulse Studio; existing settings, recovery, model caches and host code identity
  remain in place.
- **Version and documentation:** current Help, About, documentation and launcher
  metadata report v0.2.142; historical entries retain their original versions.

## Publishing and updates

Publish PulseStudio.command is the owner's Mac publishing helper. It publishes
one complete Mac/Windows ZIP; it does not run as a Windows double-click publisher.
Both app clients check the public Latest release about 2.5 seconds after launch
and every 15 minutes while open. In-app notification offers Update Now, Remind
Me Later (24 hours) and Skip This Version. Checks and installation defer until
recording, saving, recovery and active processing are safe. Update Now downloads,
verifies and installs the shared ZIP, then reopens. A ready update blocked by
work offers Install & Reopen. Internet and a writable shared folder are needed;
users do not need GitHub login. A newer public Latest release with the matching
ZIP is required; source pushes alone do not trigger client notifications.

This package does not publish itself to GitHub. The owner can publish
PulseStudio-cross-platform-v0.2.142.zip using the included publisher 1.1.0.

## Retained behavior

One shared launch folder, Mac .app and Windows .bat launchers, the 262 × 84 Mini
Controller, recording modes, stable Mini Start/Stop, 3-second bookmark entry,
Mini-only 0–75% transparency, all Playback tools and interval exports, saved
custom folders, Movies/PulseStudio or Videos/PulseStudio default media folders,
background local transcription, microphone cleanup and echo handling, source
tracks, recovery data and existing analytics/update configuration are retained.
