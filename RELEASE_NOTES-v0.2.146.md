# PulseStudio v0.2.146

Transcripts start after saving and their progress reflects the audio processed.

- Keep newly saved unfinished transcription jobs in a small local journal;
  reopening PulseStudio restarts them without selecting a recording. Successful,
  cancelled or deleted jobs leave the pending queue. Failed jobs remain available
  through the existing Retry transcription action.
- Show preparation before decoding. Report completed audio windows and duration
  instead of the previous estimated 18–34% first-pass range. Optional quality
  recovery remains separate and does not display a premature 100% result.
- Scale the transcription deadline for longer recordings; retain cancellation,
  worker stall handling, strict transcript priority and recording priority.
- Preserve retryable audio extraction errors instead of saving an incorrect
  no-audio transcript.
- Retain the same local multilingual Whisper Small q8 model, timestamps, sparse
  transcript recovery, cached session, audio processing, Pearl Screen artwork,
  Quiet Studio controls, Mini size, update flow, analytics and owner publishers.

This remains one shared Mac/Windows folder. No recordings are sent to a remote
transcription service. Long recordings still take time on the local CPU.
