(() => {
  function estimateBytesPerHour({ recordingKind = 'video', videoBitrate = 0, codec = 'h264', microphone = true, computerAudio = true } = {}) {
    const audioStreams = recordingKind === 'audio' ? Math.max(1, Number(Boolean(microphone)) + Number(Boolean(computerAudio))) : 1;
    const audioBitrate = 192000 * audioStreams;
    const codecFactor = codec === 'h265' ? 0.68 : 1;
    const effectiveVideo = recordingKind === 'audio' ? 0 : Math.max(0, Number(videoBitrate) || 0) * codecFactor;
    const muxOverhead = 1.035;
    return Math.round(((effectiveVideo + audioBitrate) / 8) * 3600 * muxOverhead);
  }

  window.PulseStudioEstimate = { estimateBytesPerHour };
})();
