/**
 * Web Audio Context Manager with Master Bus, Reverb, and Delay FX
 */
/**
 * Web Audio Context Manager with Master Bus, Reverb, and Delay FX
 */
export class SoundEngine {
  private ctx: BaseAudioContext | null = null;
  private masterGain: GainNode | null = null;
  private delayNode: DelayNode | null = null;
  private delayFeedbackGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private dryGain: GainNode | null = null;
  private wetDelayGain: GainNode | null = null;
  private wetReverbGain: GainNode | null = null;
  private isInitialized = false;

  private _masterVolume = 0.65;
  private _reverbMix = 0.32;
  private _delayMix = 0.28;

  public async init(existingCtx?: BaseAudioContext): Promise<void> {
    if (this.isInitialized && this.ctx && !existingCtx) {
      if (this.ctx instanceof AudioContext && this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return;
    }

    if (existingCtx) {
      this.ctx = existingCtx;
    } else {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioContextClass();
    }

    this.setupAudioGraph(this.ctx);
    this.isInitialized = true;
    if (this.ctx instanceof AudioContext && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  public setupAudioGraph(ctx: BaseAudioContext): void {
    // Master Output & Limiter
    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(this._masterVolume, 0);

    // Soft limiter using WaveShaper to prevent clipping
    const limiter = ctx.createWaveShaper();
    limiter.curve = this.createSoftClipperCurve();
    limiter.oversample = '2x';

    // Delay Bus (Stereo Ping-Pong / Feedback delay)
    this.delayNode = ctx.createDelay(2.0);
    this.delayNode.delayTime.setValueAtTime(0.35, 0);
    this.delayFeedbackGain = ctx.createGain();
    this.delayFeedbackGain.gain.setValueAtTime(0.38, 0);

    this.delayNode.connect(this.delayFeedbackGain);
    this.delayFeedbackGain.connect(this.delayNode);

    // Reverb Bus (Algorithmic Impulse Response)
    this.reverbNode = ctx.createConvolver();
    this.reverbNode.buffer = this.createSyntheticImpulse(ctx, 2.8, 2.2);

    // Mix Gains
    this.dryGain = ctx.createGain();
    this.dryGain.gain.setValueAtTime(0.85, 0);

    this.wetDelayGain = ctx.createGain();
    this.wetDelayGain.gain.setValueAtTime(this._delayMix, 0);

    this.wetReverbGain = ctx.createGain();
    this.wetReverbGain.gain.setValueAtTime(this._reverbMix, 0);

    // Routing
    this.delayNode.connect(this.wetDelayGain);
    this.reverbNode.connect(this.wetReverbGain);

    this.dryGain.connect(limiter);
    this.wetDelayGain.connect(limiter);
    this.wetReverbGain.connect(limiter);

    limiter.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);
  }

  /**
   * Spawns an isolated offline SoundEngine configured for faster-than-realtime rendering.
   */
  public createOfflineEngine(offlineCtx: OfflineAudioContext): SoundEngine {
    const engine = new SoundEngine();
    engine.ctx = offlineCtx;
    engine._masterVolume = this._masterVolume;
    engine._reverbMix = this._reverbMix;
    engine._delayMix = this._delayMix;
    engine.setupAudioGraph(offlineCtx);
    engine.isInitialized = true;
    return engine;
  }

  public get context(): BaseAudioContext {
    if (!this.ctx) {
      throw new Error('AudioContext not initialized. Call soundEngine.init() on user interaction first.');
    }
    return this.ctx;
  }

  public get masterOutputNode(): GainNode | null {
    return this.masterGain;
  }

  public get isReady(): boolean {
    if (!this.isInitialized || !this.ctx) return false;
    if (this.ctx instanceof AudioContext) {
      return this.ctx.state === 'running';
    }
    return true;
  }

  /**
   * Connects a voice node to Dry, Delay, and Reverb send buses.
   */
  public connectVoice(
    sourceNode: AudioNode,
    delaySend: number = 0.3,
    reverbSend: number = 0.35
  ): { reverbSendGain?: GainNode; delaySendGain?: GainNode } {
    if (!this.ctx || !this.dryGain || !this.delayNode || !this.reverbNode) return {};

    sourceNode.connect(this.dryGain);

    let dSend: GainNode | undefined;
    if (delaySend > 0) {
      dSend = this.ctx.createGain();
      dSend.gain.setValueAtTime(delaySend, this.ctx.currentTime || 0);
      sourceNode.connect(dSend);
      dSend.connect(this.delayNode);
    }

    let rSend: GainNode | undefined;
    if (reverbSend >= 0) {
      rSend = this.ctx.createGain();
      rSend.gain.setValueAtTime(reverbSend, this.ctx.currentTime || 0);
      sourceNode.connect(rSend);
      rSend.connect(this.reverbNode);
    }

    return { reverbSendGain: rSend, delaySendGain: dSend };
  }

  public setMasterVolume(val: number): void {
    this._masterVolume = Math.max(0, Math.min(1, val));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this._masterVolume, this.ctx.currentTime || 0, 0.05);
    }
  }

  public get reverbMix(): number {
    return this._reverbMix;
  }

  public setReverbMix(val: number): void {
    this._reverbMix = Math.max(0, Math.min(1, val));
    if (this.wetReverbGain && this.ctx) {
      this.wetReverbGain.gain.setTargetAtTime(this._reverbMix, this.ctx.currentTime || 0, 0.05);
    }
  }

  public setDelayMix(val: number): void {
    this._delayMix = Math.max(0, Math.min(1, val));
    if (this.wetDelayGain && this.ctx) {
      this.wetDelayGain.gain.setTargetAtTime(this._delayMix, this.ctx.currentTime || 0, 0.05);
    }
  }

  /**
   * Generates a lush algorithmic stereo impulse response for the convolver reverb.
   * Uses a deterministic seeded PRNG so that real-time audio and exported renderings
   * have mathematically identical, reproducible acoustic spaces.
   */
  private createSyntheticImpulse(ctx: BaseAudioContext, duration: number, decay: number, seed = 1337): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    // Mulberry32 deterministic 32-bit generator
    let s = (seed >>> 0) || 1;
    const nextRandom = (): number => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = Math.exp(-t * decay);
      left[i] = (nextRandom() * 2 - 1) * env;
      right[i] = (nextRandom() * 2 - 1) * env;
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
