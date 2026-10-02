/**
 * Web Audio Context Manager with Master Bus, Reverb, and Delay FX
 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private delayNode: DelayNode | null = null;
  private delayFeedbackGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private dryGain: GainNode | null = null;
  private wetDelayGain: GainNode | null = null;
  private wetReverbGain: GainNode | null = null;
  private isInitialized = false;

  public async init(): Promise<void> {
    if (this.isInitialized && this.ctx) {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return;
    }

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioContextClass();

    // Master Output & Limiter
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.65, this.ctx.currentTime);

    // Soft limiter using WaveShaper to prevent clipping
    const limiter = this.ctx.createWaveShaper();
    limiter.curve = this.createSoftClipperCurve();
    limiter.oversample = '2x';

    // Delay Bus (Stereo Ping-Pong / Feedback delay)
    this.delayNode = this.ctx.createDelay(2.0);
    this.delayNode.delayTime.setValueAtTime(0.35, this.ctx.currentTime);
    this.delayFeedbackGain = this.ctx.createGain();
    this.delayFeedbackGain.gain.setValueAtTime(0.38, this.ctx.currentTime);

    this.delayNode.connect(this.delayFeedbackGain);
    this.delayFeedbackGain.connect(this.delayNode);

    // Reverb Bus (Algorithmic Impulse Response)
    this.reverbNode = this.ctx.createConvolver();
    this.reverbNode.buffer = this.createSyntheticImpulse(this.ctx, 2.8, 2.2);

    // Mix Gains
    this.dryGain = this.ctx.createGain();
    this.dryGain.gain.setValueAtTime(0.85, this.ctx.currentTime);

    this.wetDelayGain = this.ctx.createGain();
    this.wetDelayGain.gain.setValueAtTime(0.28, this.ctx.currentTime);

    this.wetReverbGain = this.ctx.createGain();
    this.wetReverbGain.gain.setValueAtTime(0.32, this.ctx.currentTime);

    // Routing
    this.delayNode.connect(this.wetDelayGain);
    this.reverbNode.connect(this.wetReverbGain);

    this.dryGain.connect(limiter);
    this.wetDelayGain.connect(limiter);
    this.wetReverbGain.connect(limiter);

    limiter.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    this.isInitialized = true;
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  public get context(): AudioContext {
    if (!this.ctx) {
      throw new Error('AudioContext not initialized. Call soundEngine.init() on user interaction first.');
    }
    return this.ctx;
  }

  public get isReady(): boolean {
    return this.isInitialized && this.ctx !== null && this.ctx.state === 'running';
  }

  /**
   * Connects a voice node to Dry, Delay, and Reverb send buses.
   */
  public connectVoice(sourceNode: AudioNode, delaySend: number = 0.3, reverbSend: number = 0.35): void {
    if (!this.ctx || !this.dryGain || !this.delayNode || !this.reverbNode) return;

    sourceNode.connect(this.dryGain);

    if (delaySend > 0) {
      const dSend = this.ctx.createGain();
      dSend.gain.setValueAtTime(delaySend, this.ctx.currentTime);
      sourceNode.connect(dSend);
      dSend.connect(this.delayNode);
    }

    if (reverbSend > 0) {
      const rSend = this.ctx.createGain();
      rSend.gain.setValueAtTime(reverbSend, this.ctx.currentTime);
      sourceNode.connect(rSend);
      rSend.connect(this.reverbNode);
    }
  }

  public setMasterVolume(val: number): void {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(Math.max(0, Math.min(1, val)), this.ctx.currentTime, 0.05);
    }
  }

  /**
   * Generates a lush algorithmic stereo impulse response for the convolver reverb.
   */
  private createSyntheticImpulse(ctx: AudioContext, duration: number, decay: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = Math.exp(-t * decay);
      left[i] = (Math.random() * 2 - 1) * env;
      right[i] = (Math.random() * 2 - 1) * env;
    }

    return impulse;
  }

  private createSoftClipperCurve(samples: number = 1024): Float32Array<ArrayBuffer> {
    const buffer = new ArrayBuffer(samples * 4);
    const curve = new Float32Array(buffer);
    const half = samples / 2;
    for (let i = 0; i < samples; i++) {
      const x = (i - half) / half;
      curve[i] = Math.tanh(x * 1.5) / 1.5;
    }
    return curve;
  }
}

export const soundEngine = new SoundEngine();
