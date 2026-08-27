(() => {
  function snapToQuiet(samples, durationSeconds, targetSeconds, searchSeconds = 2.0) {
    const duration = Math.max(0, Number(durationSeconds) || 0);
    const target = Math.max(0, Math.min(duration, Number(targetSeconds) || 0));
    if (!duration || !Array.isArray(samples) || samples.length < 8) return target;
    const targetIndex = Math.round((target / duration) * (samples.length - 1));
    const radius = Math.max(2, Math.round((searchSeconds / duration) * samples.length));
    const start = Math.max(1, targetIndex - radius);
    const end = Math.min(samples.length - 2, targetIndex + radius);
    let bestIndex = targetIndex;
    let bestScore = Infinity;
    for (let i = start; i <= end; i += 1) {
      const local = (Number(samples[i - 1]) || 0) * 0.25 + (Number(samples[i]) || 0) * 0.5 + (Number(samples[i + 1]) || 0) * 0.25;
      const distancePenalty = Math.abs(i - targetIndex) / Math.max(1, radius) * 0.12;
      const score = local + distancePenalty;
      if (score < bestScore) { bestScore = score; bestIndex = i; }
    }
    return (bestIndex / Math.max(1, samples.length - 1)) * duration;
  }

  window.PulseStudioTrimTools = { snapToQuiet };
})();
