/*
 * Adaptive microphone denoiser for PulseStudio Utility.
 *
 * This is intentionally different from a simple noise gate.  It maintains a
 * frequency-domain estimate of the background-noise profile and applies a
 * smoothed Wiener/spectral-subtraction gain to each band, so steady fan/air
 * noise is reduced even while speech is present.  Processing stays fully
 * local inside AudioWorklet and only touches the microphone path.
 */
class VoiceCleanupProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.mode = options?.processorOptions?.mode === 'strong' ? 'strong' : 'enhanced';
    this.frameSize = 512;
    this.hopSize = 256;
    this.binCount = this.frameSize / 2 + 1;
    this.history = new Float32Array(this.frameSize);
    this.pendingHop = new Float32Array(this.hopSize);
    this.pendingCount = 0;
    this.outputRing = new Float32Array(4096);
    this.outputRead = 0;
    this.outputWrite = 0;
    this.ola = new Float32Array(this.frameSize);
    this.frameIndex = 0;
    this.noisePower = new Float32Array(this.binCount);
    this.smoothedGain = new Float32Array(this.binCount);
    this.smoothedGain.fill(1);
    this.window = new Float32Array(this.frameSize);
    this.real = new Float64Array(this.frameSize);
    this.imag = new Float64Array(this.frameSize);
    this.power = new Float64Array(this.binCount);
    this.previousPower = new Float64Array(this.binCount);
    this.gain = new Float64Array(this.binCount);
    this.bitReverse = new Uint16Array(this.frameSize);

    // sqrt(periodic Hann): analysis * synthesis becomes Hann and 50% overlap
    // sums to approximately unity, avoiding block-edge pumping.
    for (let i = 0; i < this.frameSize; i += 1) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.frameSize);
      this.window[i] = Math.sqrt(Math.max(0, hann));
    }
    const bits = Math.log2(this.frameSize);
    for (let i = 0; i < this.frameSize; i += 1) {
      let x = i;
      let r = 0;
      for (let b = 0; b < bits; b += 1) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      this.bitReverse[i] = r;
    }
  }

  fft(inverse = false) {
    const n = this.frameSize;
    for (let i = 0; i < n; i += 1) {
      const j = this.bitReverse[i];
      if (j > i) {
        let t = this.real[i]; this.real[i] = this.real[j]; this.real[j] = t;
        t = this.imag[i]; this.imag[i] = this.imag[j]; this.imag[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const angle = (inverse ? 2 : -2) * Math.PI / len;
      const wLenR = Math.cos(angle);
      const wLenI = Math.sin(angle);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let wr = 1;
        let wi = 0;
        for (let j = 0; j < half; j += 1) {
          const uR = this.real[i + j];
          const uI = this.imag[i + j];
          const vR = this.real[i + j + half] * wr - this.imag[i + j + half] * wi;
          const vI = this.real[i + j + half] * wi + this.imag[i + j + half] * wr;
          this.real[i + j] = uR + vR;
          this.imag[i + j] = uI + vI;
          this.real[i + j + half] = uR - vR;
          this.imag[i + j + half] = uI - vI;
          const nextWr = wr * wLenR - wi * wLenI;
          wi = wr * wLenI + wi * wLenR;
          wr = nextWr;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i += 1) {
        this.real[i] /= n;
        this.imag[i] /= n;
      }
    }
  }

  processFrame() {
    const n = this.frameSize;
    const sr = typeof sampleRate === 'number' ? sampleRate : 48000;
    let totalPower = 0;
    let voicePower = 0;
    let lowPower = 0;
    let logSum = 0;
    let positiveFlux = 0;

    for (let i = 0; i < n; i += 1) {
      this.real[i] = this.history[i] * this.window[i];
      this.imag[i] = 0;
    }
    this.fft(false);

    for (let k = 0; k < this.binCount; k += 1) {
      const p = this.real[k] * this.real[k] + this.imag[k] * this.imag[k] + 1e-12;
      this.power[k] = p;
      if (this.frameIndex > 0 && p > this.previousPower[k]) positiveFlux += p - this.previousPower[k];
      totalPower += p;
      logSum += Math.log(p);
      const hz = (k * sr) / n;
      if (hz >= 180 && hz <= 5000) voicePower += p;
      if (hz < 260) lowPower += p;
    }

    // Spectral flatness helps distinguish broadband fan/air noise from voiced
    // speech.  SNR against the learned profile supplies the stronger cue once
    // the profile has warmed up.
    const arithmetic = totalPower / this.binCount + 1e-12;
    const geometric = Math.exp(logSum / this.binCount);
    const flatness = Math.min(1, geometric / arithmetic);
    const voiceRatio = voicePower / Math.max(totalPower, 1e-12);
    const spectralFlux = positiveFlux / Math.max(totalPower, 1e-12);

    let noiseTotal = 0;
    for (let k = 0; k < this.binCount; k += 1) noiseTotal += this.noisePower[k] || 0;
    const snrDb = this.frameIndex < 8 || noiseTotal <= 1e-10
      ? 0
      : 10 * Math.log10((totalPower + 1e-12) / (noiseTotal + 1e-12));
    this.lastSnrDb = snrDb; this.lastFlatness = flatness; this.lastFlux = spectralFlux; this.lastVoiceRatio = voiceRatio;
    const speechLikely = (snrDb > 5.0 && voiceRatio > 0.43) || (snrDb > 8.5) || (flatness < 0.30 && voiceRatio > 0.52 && spectralFlux > 0.055);
    this.lastSpeechLikely = speechLikely;

    // Learn a frequency-specific fan/room profile.  The first ~0.65 s is a
    // fast calibration period so a nearby fan is captured before the speech
    // model starts protecting voice-dominant bins.  Afterwards the profile
    // tracks downward quickly and upward only when a bin still resembles the
    // established noise spectrum.
    const calibrating = this.frameIndex < 120;
    for (let k = 0; k < this.binCount; k += 1) {
      const p = this.power[k];
      let np = this.noisePower[k];
      if (np <= 0) {
        np = p;
      } else if (calibrating) {
        const a = this.frameIndex < 24 ? 0.12 : 0.045;
        np = np * (1 - a) + p * a;
      } else if (p < np) {
        np = np * 0.82 + p * 0.18;
      } else {
        const ratio = p / Math.max(np, 1e-12);
        if (ratio < 3.0) {
          // Bin-local stationarity is more reliable than whole-frame VAD for
          // fans: even while someone speaks, many fan-dominated bins stay near
          // their established power and can safely follow a louder fan.
          const up = this.mode === 'strong' ? 0.040 : 0.030;
          np = np * (1 - up) + p * up;
        } else if (!speechLikely && ratio < 5.0) {
          const up = this.mode === 'strong' ? 0.018 : 0.012;
          np = np * (1 - up) + p * up;
        }
      }
      this.noisePower[k] = Math.max(1e-12, np);
    }

    const baseBeta = this.mode === 'strong' ? 2.20 : 1.90;
    // Safety floor: never let the adaptive spectral stage erase a frequency bin.
    // Even if speech/noise classification is wrong, keep at least -18 dB (Strong)
    // or -15 dB (Enhanced) of the original signal in every bin.
    const minGain = this.mode === 'strong' ? 0.12 : 0.18;
    const lowRatio = lowPower / Math.max(totalPower, 1e-12);
    const windLikely = lowRatio > 0.32 && flatness > 0.22;

    for (let k = 0; k < this.binCount; k += 1) {
      const hz = (k * sr) / n;
      const p = this.power[k];
      const np = this.noisePower[k];
      let beta = baseBeta;

      // Protect intelligibility when speech is confidently present while still
      // suppressing noise-dominated bins around it.
      if (speechLikely && hz >= 260 && hz <= 4300) beta *= this.mode === 'strong' ? 0.58 : 0.50;
      if (hz < 180) beta *= 1.55;
      else if (hz < 320) beta *= 1.25;
      if (hz > 8500) beta *= 1.35;

      const residual = Math.max(0, p - beta * np);
      let g = Math.sqrt(residual / Math.max(p, 1e-12));
      g = Math.max(minGain, Math.min(1, g));

      // Direct air hitting a microphone capsule creates strong low-frequency
      // turbulence.  Apply extra attenuation only to those bands.
      if (windLikely && hz < 260) g *= this.mode === 'strong' ? 0.16 : 0.28;

      // Preserve a little more consonant energy in the 1.2-5.5 kHz region.
      if (speechLikely && hz >= 1200 && hz <= 5500) g = Math.max(g, this.mode === 'strong' ? 0.42 : 0.50);
      this.gain[k] = g;
    }

    for (let k = 0; k < this.binCount; k += 1) this.previousPower[k] = this.power[k];

    // Frequency smoothing prevents isolated musical-noise holes.
    for (let k = 1; k < this.binCount - 1; k += 1) {
      this.gain[k] = 0.2 * this.gain[k - 1] + 0.6 * this.gain[k] + 0.2 * this.gain[k + 1];
    }

    // Temporal smoothing: open faster than we close, preserving speech attacks.
    for (let k = 0; k < this.binCount; k += 1) {
      const previous = this.smoothedGain[k];
      const target = this.gain[k];
      const a = target > previous ? 0.52 : (this.mode === 'strong' ? 0.28 : 0.24);
      const g = previous + (target - previous) * a;
      this.smoothedGain[k] = g;
      this.real[k] *= g;
      this.imag[k] *= g;
      if (k > 0 && k < n / 2) {
        this.real[n - k] *= g;
        this.imag[n - k] *= g;
      }
    }

    this.fft(true);
    for (let i = 0; i < n; i += 1) this.ola[i] += this.real[i] * this.window[i];
    for (let i = 0; i < this.hopSize; i += 1) {
      this.outputRing[this.outputWrite] = this.ola[i];
      this.outputWrite = (this.outputWrite + 1) % this.outputRing.length;
      // In the unlikely event the consumer falls behind, drop the oldest sample
      // instead of allocating or blocking the real-time audio thread.
      if (this.outputWrite === this.outputRead) this.outputRead = (this.outputRead + 1) % this.outputRing.length;
    }
    this.ola.copyWithin(0, this.hopSize);
    this.ola.fill(0, n - this.hopSize);
    this.frameIndex += 1;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const channel = input && input[0] ? input[0] : null;

    if (channel) {
      for (let i = 0; i < channel.length; i += 1) {
        this.pendingHop[this.pendingCount] = channel[i] || 0;
        this.pendingCount += 1;
        if (this.pendingCount === this.hopSize) {
          this.history.copyWithin(0, this.hopSize);
          this.history.set(this.pendingHop, this.frameSize - this.hopSize);
          this.pendingCount = 0;
          this.processFrame();
        }
      }
    }

    for (let c = 0; c < output.length; c += 1) {
      const dst = output[c];
      for (let i = 0; i < dst.length; i += 1) {
        if (this.outputRead !== this.outputWrite) {
          dst[i] = this.outputRing[this.outputRead];
          this.outputRead = (this.outputRead + 1) % this.outputRing.length;
        } else {
          // Fail open, not closed. If the processor ever falls behind, pass the
          // current microphone sample through instead of emitting digital silence.
          // A noisy syllable is recoverable; a zeroed syllable is not.
          dst[i] = channel && i < channel.length ? channel[i] : 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('voice-cleanup-processor', VoiceCleanupProcessor);
