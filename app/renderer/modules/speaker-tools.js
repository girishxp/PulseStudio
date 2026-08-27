(() => {
  const palette = [
    'rgba(95,175,255,.82)', 'rgba(151,117,250,.82)', 'rgba(65,196,150,.82)',
    'rgba(245,166,70,.82)', 'rgba(239,105,142,.82)', 'rgba(71,194,214,.82)',
    'rgba(190,151,76,.82)', 'rgba(129,176,95,.82)'
  ];

  function hashSpeaker(value) {
    let hash = 0;
    for (const char of String(value || 'Speaker')) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return Math.abs(hash);
  }

  function colorIndex(speaker) { return hashSpeaker(speaker) % palette.length; }
  function color(speaker, alpha = null) {
    const base = palette[colorIndex(speaker)];
    if (alpha == null) return base;
    return base.replace(/,\.[0-9]+\)$/, `,${Math.max(0, Math.min(1, alpha))})`);
  }
  function className(speaker) { return `speaker-color-${colorIndex(speaker)}`; }

  window.PulseStudioSpeakerTools = { palette, colorIndex, color, className };
})();
