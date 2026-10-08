/*
 * PulseStudio speaker-reference echo cancellation.
 *
 * Input 0: the microphone only. Input 1: captured computer audio only.
 * The reference is never played through the speakers and never added to output.
 * WebRTC AEC3 learns the acoustic speaker/room path and preserves independent
 * near-end speech, including double talk. Noise suppression belongs after this
 * node, once; it is not used as a substitute for a playback reference.
 */
import createWebRtcAec3 from './vendor/aec3/webrtcaec3-0.3.0.mjs';

class SpeakerEchoProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frameSize = 480;
    this.microphoneFrame = new Float32Array(this.frameSize);
    this.referenceFrame = new Float32Array(this.frameSize);
    this.cleanFrame = new Float32Array(this.frameSize);
    this.microphoneChannels = [this.microphoneFrame];
    this.referenceChannels = [this.referenceFrame];
    this.cleanChannels = [this.cleanFrame];
    this.framePosition = 0;
    this.outputRing = new Float32Array(2048);
    this.outputRead = 0;
    this.outputWrite = this.frameSize;
    this.module = null;
    this.engine = null;
    this.failed = false;
    this.disposed = false;
    this.framesProcessed = 0;
    this.delayMs = Math.max(0, Math.min(500, Number(options?.processorOptions?.referenceDelayMs) || 0));
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'dispose') {
        this.disposed = true;
        this.engine?.free();
        this.engine = null;
      } else if (data?.type === 'reset' && this.module && !this.failed && !this.disposed) {
        // Device/route replacement changes the acoustic path. Free the old
        // estimator, retaining the fixed output clock and buffered microphone.
        try { this.replaceEngine(); } catch (error) { this.fail(error); }
      }
    };
    this.initialize(options?.processorOptions?.wasmBinary);
  }

  async initialize(wasmBinary) {
    try {
      if (sampleRate !== 48000) throw new Error('Speaker cancellation requires a 48 kHz audio context.');
      if (!wasmBinary?.byteLength) throw new Error('The bundled echo cancellation binary is unavailable.');
      // AudioWorkletGlobalScope has no fetch/atob. The main renderer supplies
      // local pinned bytes before connecting this node to the recording path.
      this.module = await createWebRtcAec3({ wasmBinary, print() {}, printErr() {} });
      if (this.disposed) return;
      this.replaceEngine();
      // At 48 kHz, AEC3's split/merge filterbank adds approximately 9 ms to
      // the 10 ms adapter buffering. Whole-graph tests against RNNoise alone
      // measure 19.04 ms. Save removes the nominal 19 ms in its existing pass.
      this.port.postMessage({ type: 'ready', method: 'webrtc-aec3-system-reference', latencySamples: 912, bufferingLatencySamples: this.frameSize, sampleRate: 48000 });
    } catch (error) { this.fail(error); }
  }

  replaceEngine() {
    this.engine?.free();
    this.engine = new this.module.AEC3(48000, 1, 1);
    this.engine.setAudioBufferDelay(this.delayMs);
  }

  fail(error) {
    if (this.failed || this.disposed) return;
    this.failed = true;
    try { this.engine?.free(); } catch {}
    this.engine = null;
    this.port.postMessage({ type: 'error', message: String(error?.message || error || 'Speaker echo cancellation failed.').slice(0, 200) });
  }

  processFrame() {
    if (this.engine && !this.failed) {
      try {
        // Analyze and process matched 10 ms blocks in the same audio clock.
        // AEC3's own delay estimator handles system-capture/room-path latency.
        this.engine.analyze(this.referenceChannels);
        this.engine.process(this.cleanChannels, this.microphoneChannels);
        for (let i = 0; i < this.frameSize; i += 1) {
          if (!Number.isFinite(this.cleanFrame[i])) throw new Error('Echo cancellation returned invalid audio.');
        }
        this.framesProcessed += 1;
      } catch (error) {
        this.fail(error);
        this.cleanFrame.set(this.microphoneFrame);
      }
    } else {
      // Keep the microphone audible and the same timing on init/failure. A
      // stopped or missing reference is simply silence, never a mute gate.
      this.cleanFrame.set(this.microphoneFrame);
    }
    for (let i = 0; i < this.frameSize; i += 1) {
      this.outputRing[this.outputWrite] = this.cleanFrame[i];
      this.outputWrite = (this.outputWrite + 1) % this.outputRing.length;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return !this.disposed;
    const microphone = inputs[0]?.[0];
    const reference = inputs[1];
    const referenceChannels = reference?.length || 0;
    for (let i = 0; i < output.length; i += 1) {
      this.microphoneFrame[this.framePosition] = microphone?.[i] || 0;
      let render = 0;
      for (let channel = 0; channel < referenceChannels; channel += 1) render += reference[channel]?.[i] || 0;
      this.referenceFrame[this.framePosition] = referenceChannels ? render / referenceChannels : 0;
      this.framePosition += 1;
      if (this.framePosition === this.frameSize) {
        this.processFrame();
        this.framePosition = 0;
      }
      output[i] = this.outputRing[this.outputRead];
      this.outputRead = (this.outputRead + 1) % this.outputRing.length;
    }
    // Output is mono; mirror it if a host nevertheless supplies extra channels.
    for (let channel = 1; channel < (outputs[0]?.length || 0); channel += 1) outputs[0][channel].set(output);
    return !this.disposed;
  }
}

registerProcessor('pulse-speaker-echo', SpeakerEchoProcessor);
