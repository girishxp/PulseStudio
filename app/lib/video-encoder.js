const os = require('os');

class VideoEncoderManager {
  constructor({ ffmpegPath, runProcess, platform = process.platform }) {
    this.ffmpegPath = ffmpegPath;
    this.runProcess = runProcess;
    this.platform = platform;
    this.available = new Set();
    this.probed = false;
    this.failed = new Set();
  }

  async probe() {
    if (this.probed) return this.capabilities();
    this.probed = true;
    if (!this.ffmpegPath) return this.capabilities();
    try {
      const result = await this.runProcess(this.ffmpegPath, ['-hide_banner', '-encoders']);
      const text = `${result?.stdout || ''}\n${result?.stderr || ''}`;
      const compiled = new Set();
      for (const name of ['h264_videotoolbox', 'hevc_videotoolbox', 'h264_nvenc', 'hevc_nvenc', 'h264_qsv', 'hevc_qsv', 'h264_amf', 'hevc_amf']) {
        if (new RegExp(`\\b${name}\\b`).test(text)) compiled.add(name);
      }
      const relevant = [...new Set([...this.candidates('h264'), ...this.candidates('h265')])].filter((name) => compiled.has(name));
      for (const name of relevant) {
        try {
          await this.runProcess(this.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=64x64:d=0.08', '-frames:v', '1', '-c:v', name, '-f', 'null', '-']);
          this.available.add(name);
        } catch (error) {
          if (error?.code === 'RECOVERY_CANCELLED') {
            this.probed = false;
            throw error;
          }
        }
      }
    } catch (error) {
      if (error?.code === 'RECOVERY_CANCELLED') {
        this.probed = false;
        throw error;
      }
    }
    return this.capabilities();
  }

  candidates(codec) {
    const hevc = codec === 'h265';
    if (this.platform === 'darwin') return [hevc ? 'hevc_videotoolbox' : 'h264_videotoolbox'];
    if (this.platform === 'win32') return hevc
      ? ['hevc_nvenc', 'hevc_qsv', 'hevc_amf']
      : ['h264_nvenc', 'h264_qsv', 'h264_amf'];
    return [];
  }

  preferred(codec) {
    return this.candidates(codec).find((name) => this.available.has(name) && !this.failed.has(name)) || null;
  }

  markFailed(name) { if (name) this.failed.add(name); }

  software(codec) {
    return codec === 'h265'
      ? ['-c:v', 'libx265', '-preset', 'veryfast', '-crf', '27', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
  }

  hardware(name, codec) {
    if (!name) return this.software(codec);
    if (name.includes('videotoolbox')) {
      return codec === 'h265'
        ? ['-c:v', name, '-q:v', '58', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p']
        : ['-c:v', name, '-q:v', '65', '-pix_fmt', 'yuv420p'];
    }
    if (name.includes('nvenc')) return codec === 'h265'
      ? ['-c:v', name, '-preset', 'p5', '-cq', '27', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p']
      : ['-c:v', name, '-preset', 'p5', '-cq', '21', '-pix_fmt', 'yuv420p'];
    if (name.includes('qsv')) return codec === 'h265'
      ? ['-c:v', name, '-global_quality', '27', '-tag:v', 'hvc1', '-pix_fmt', 'nv12']
      : ['-c:v', name, '-global_quality', '21', '-pix_fmt', 'nv12'];
    if (name.includes('amf')) return codec === 'h265'
      ? ['-c:v', name, '-quality', 'quality', '-qp_i', '27', '-qp_p', '27', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p']
      : ['-c:v', name, '-quality', 'quality', '-qp_i', '21', '-qp_p', '21', '-pix_fmt', 'yuv420p'];
    return this.software(codec);
  }

  args(codec, preferHardware = true) {
    const encoder = preferHardware ? this.preferred(codec) : null;
    return { encoder: encoder || (codec === 'h265' ? 'libx265' : 'libx264'), hardware: Boolean(encoder), args: this.hardware(encoder, codec) };
  }

  capabilities() {
    return {
      probed: this.probed,
      platform: this.platform,
      arch: os.arch(),
      available: [...this.available],
      failed: [...this.failed],
      h264: this.preferred('h264'),
      h265: this.preferred('h265')
    };
  }
}

module.exports = { VideoEncoderManager };
