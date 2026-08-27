const fs = require('fs');
const path = require('path');

async function moveFileToTrash(shell, filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  await shell.trashItem(filePath);
  return true;
}

async function moveRecordingFamilyToTrash({ shell, recordingPath, transcriptPaths }) {
  const moved = [];
  for (const target of [recordingPath, transcriptPaths?.txt, transcriptPaths?.srt].filter(Boolean)) {
    try {
      if (await moveFileToTrash(shell, target)) moved.push(target);
    } catch (error) {
      // If the primary media cannot be moved, surface the failure. Sidecar failures
      // are reported but do not risk deleting the original recording.
      if (target === recordingPath) throw error;
    }
  }
  return moved;
}

module.exports = { moveRecordingFamilyToTrash };
