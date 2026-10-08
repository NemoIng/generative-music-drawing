/**
 * Web Audio Context Manager with Master Bus, Reverb, and Delay FX
 */
/**
 * Web Audio Context Manager with Master Bus, Reverb, and Delay FX
 */
export type ReverbType = 'cathedral' | 'shimmer' | 'hall' | 'plate' | 'chamber';

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
  private _reverbType: ReverbType = 'cathedral';

  // Sound Dynamics: Stereo Width, Tape Warmth, and Ducking Pump
  private _stereoWidth = 1.0; // 0.0 (mono) to 2.0 (ultra-wide)
  private _tapeWarmth = 0.0;  // 0.0 (clean digital) to 1.0 (warm analog saturation & tape flutter)
  private _duckingDepth = 0.0; // 0.0 (off) to 1.0 (deep rhythmic pump)

  // Dynamics Audio Nodes
  private tapeFilterNode: BiquadFilterNode | null = null;
  private tapeShaperNode: WaveShaperNode | null = null;
  private duckingGainNode: GainNode | null = null;
  private widthMidGain: GainNode | null = null;
  private widthSideGain: GainNode | null = null;
  private widthSplitter: ChannelSplitterNode | null = null;
  private widthMerger: ChannelMergerNode | null = null;

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

  private analyserNode: AnalyserNode | null = null;
  private analyserDataArray: Uint8Array | null = null;

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
    this.reverbNode.buffer = this.generateImpulseForType(ctx, this._reverbType);

    // Mix Gains
    this.dryGain = ctx.createGain();
    this.dryGain.gain.setValueAtTime(0.85, 0);

    this.wetDelayGain = ctx.createGain();
    this.wetDelayGain.gain.setValueAtTime(this._delayMix, 0);

    this.wetReverbGain = ctx.createGain();
    this.wetReverbGain.gain.setValueAtTime(this._reverbMix, 0);

    // Master Bus Summing Node
    const busSum = ctx.createGain();
    busSum.gain.setValueAtTime(1.0, 0);

    // Connect dry + delay + reverb to summing node
    this.delayNode.connect(this.wetDelayGain);
    this.reverbNode.connect(this.wetReverbGain);

    this.dryGain.connect(busSum);
    this.wetDelayGain.connect(busSum);
    this.wetReverbGain.connect(busSum);

    // Dynamic Chain 1: Tape Warmth (Analog saturation & subtle high-shelf gentle roll-off)
    this.tapeShaperNode = ctx.createWaveShaper();
    this.tapeShaperNode.curve = this.createTapeWarmthCurve(this._tapeWarmth);
    this.tapeFilterNode = ctx.createBiquadFilter();
    this.tapeFilterNode.type = 'lowshelf';
    this.tapeFilterNode.frequency.setValueAtTime(180, 0);
    this.tapeFilterNode.gain.setValueAtTime(this._tapeWarmth * 3.5, 0); // +0 to +3.5dB low-end warmth

    // Dynamic Chain 2: Sidechain Ducking Gain Node
    this.duckingGainNode = ctx.createGain();
    this.duckingGainNode.gain.setValueAtTime(1.0, 0);

    // Dynamic Chain 3: Stereo Field Imager
    // Mid/Side matrixing with stereo splitter & merger
    this.widthSplitter = ctx.createChannelSplitter(2);
    this.widthMerger = ctx.createChannelMerger(2);
    this.widthMidGain = ctx.createGain();
    this.widthSideGain = ctx.createGain();
    this.widthMidGain.gain.setValueAtTime(1.0, 0);
    this.widthSideGain.gain.setValueAtTime(this._stereoWidth, 0);

    // Wire dynamics processing
    busSum.connect(this.tapeShaperNode);
    this.tapeShaperNode.connect(this.tapeFilterNode);
    this.tapeFilterNode.connect(this.duckingGainNode);

    // Wire stereo width matrix: Left & Right -> Splitter
    this.duckingGainNode.connect(this.widthSplitter);

    // Mid = (L + R) * 0.5, Side = (L - R) * 0.5
    const midSum = ctx.createGain();
    midSum.gain.setValueAtTime(0.5, 0);
    const sideDiff = ctx.createGain();
    sideDiff.gain.setValueAtTime(0.5, 0);
    const sideInvert = ctx.createGain();
    sideInvert.gain.setValueAtTime(-0.5, 0);

    this.widthSplitter.connect(midSum, 0);
    this.widthSplitter.connect(midSum, 1);
    this.widthSplitter.connect(sideDiff, 0);
    this.widthSplitter.connect(sideInvert, 1);

    midSum.connect(this.widthMidGain);
    sideDiff.connect(this.widthSideGain);

    // Reconstruct Left = Mid + Side, Right = Mid - Side
    const sideRightInvert = ctx.createGain();
    sideRightInvert.gain.setValueAtTime(-1.0, 0);
    this.widthSideGain.connect(sideRightInvert);

    this.widthMidGain.connect(this.widthMerger, 0, 0); // Mid -> Left
    this.widthMidGain.connect(this.widthMerger, 0, 1); // Mid -> Right
    this.widthSideGain.connect(this.widthMerger, 0, 0); // +Side -> Left
    sideRightInvert.connect(this.widthMerger, 0, 1); // -Side -> Right

    // Master FFT Analyser (for live audio-reactive visuals)
    try {
      this.analyserNode = ctx.createAnalyser();
      this.analyserNode.fftSize = 64; // 32 frequency bins for high performance
      this.analyserNode.smoothingTimeConstant = 0.8;
      this.analyserDataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    } catch {
      this.analyserNode = null;
      this.analyserDataArray = null;
    }

    // Routing from widthMerger through limiter to analyser & master gain
    this.widthMerger.connect(limiter);

    if (this.analyserNode) {
      limiter.connect(this.analyserNode);
      this.analyserNode.connect(this.masterGain);
    } else {
      limiter.connect(this.masterGain);
    }
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
    engine._reverbType = this._reverbType;
    engine._stereoWidth = this._stereoWidth;
    engine._tapeWarmth = this._tapeWarmth;
    engine._duckingDepth = this._duckingDepth;
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

  public getFrequencyData(): Uint8Array | null {
    if (!this.analyserNode || !this.analyserDataArray) return null;
    this.analyserNode.getByteFrequencyData(this.analyserDataArray as unknown as Uint8Array<ArrayBuffer>);
    return this.analyserDataArray;
  }

  public getMasterEnergy(): number {
    const data = this.getFrequencyData();
    if (!data || data.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    return sum / (data.length * 255);
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

  public get reverbType(): ReverbType {
    return this._reverbType;
  }

  public setReverbType(type: ReverbType): void {
    this._reverbType = type;
    if (this.reverbNode && this.ctx) {
      try {
        this.reverbNode.buffer = this.generateImpulseForType(this.ctx, type);
      } catch (err) {
        console.warn('Could not update convolver buffer:', err);
      }
    }
  }

  public setDelayMix(val: number): void {
    this._delayMix = Math.max(0, Math.min(1, val));
    if (this.wetDelayGain && this.ctx) {
      this.wetDelayGain.gain.setTargetAtTime(this._delayMix, this.ctx.currentTime || 0, 0.05);
    }
  }

  // --- Sound Dynamics Getters & Setters ---

  public get stereoWidth(): number {
    return this._stereoWidth;
  }

  public setStereoWidth(val: number): void {
    this._stereoWidth = Math.max(0, Math.min(2.0, val));
    if (this.widthSideGain && this.ctx) {
      this.widthSideGain.gain.setTargetAtTime(this._stereoWidth, this.ctx.currentTime || 0, 0.05);
    }
  }

  public get tapeWarmth(): number {
    return this._tapeWarmth;
  }

  public setTapeWarmth(val: number): void {
    this._tapeWarmth = Math.max(0, Math.min(1.0, val));
    if (this.tapeShaperNode) {
      this.tapeShaperNode.curve = this.createTapeWarmthCurve(this._tapeWarmth);
    }
    if (this.tapeFilterNode && this.ctx) {
      this.tapeFilterNode.gain.setTargetAtTime(this._tapeWarmth * 3.5, this.ctx.currentTime || 0, 0.05);
    }
  }

  public get duckingDepth(): number {
    return this._duckingDepth;
  }

  public setDuckingDepth(val: number): void {
    this._duckingDepth = Math.max(0, Math.min(1.0, val));
  }

  /**
   * Triggers a momentary sidechain ducking envelope (e.g. on kick drum or beat accent),
   * smoothly dipping the master bus by duckingDepth and releasing over releaseSec.
   */
  public triggerDucking(strength = 1.0, releaseSec = 0.28, time?: number): void {
    if (!this.duckingGainNode || !this.ctx || this._duckingDepth <= 0.01) return;
    const now = time !== undefined ? time : this.ctx.currentTime;
    const duckAmount = this._duckingDepth * Math.min(1.0, strength);
    const targetGain = Math.max(0.15, 1.0 - duckAmount * 0.75);

    this.duckingGainNode.gain.cancelScheduledValues(now);
    this.duckingGainNode.gain.setValueAtTime(this.duckingGainNode.gain.value, now);
    this.duckingGainNode.gain.linearRampToValueAtTime(targetGain, now + 0.012);
    this.duckingGainNode.gain.exponentialRampToValueAtTime(1.0, now + releaseSec);
  }

  /**
   * Generates tailored impulse responses for the 5 acoustic spaces:
   * 1. Cathedral: Long 4.2s lush decay with broad stereo dispersion.
   * 2. Shimmer: Pitch-stepped octave sparkles with ethereal harmonic resonances.
   * 3. Ambient Hall: Natural 2.4s warm concert hall balance.
   * 4. Warm Plate: Dense, rapid early reflections with silky analog damping (1.8s).
   * 5. Intimate Chamber: Tight, dry 0.9s acoustic chamber for delicate detail.
   */
  private generateImpulseForType(ctx: BaseAudioContext, type: ReverbType): AudioBuffer {
    switch (type) {
      case 'shimmer':
        return this.createShimmerImpulse(ctx, 3.8, 1.8);
      case 'hall':
        return this.createSyntheticImpulse(ctx, 2.4, 2.6, 2048);
      case 'plate':
        return this.createPlateImpulse(ctx, 1.8, 3.4);
      case 'chamber':
        return this.createSyntheticImpulse(ctx, 0.9, 4.8, 4096);
      case 'cathedral':
      default:
        return this.createSyntheticImpulse(ctx, 4.2, 1.9, 1337);
    }
  }

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

  /**
   * Shimmer Reverb: Algorithmic impulse with upper-octave sparkle harmonics and frequency-dependent decay.
   */
  private createShimmerImpulse(ctx: BaseAudioContext, duration: number, decay: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    let s = 9999;
    const nextRandom = (): number => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    // Shimmer frequencies for high ethereal resonance
    const f1 = 880;
    const f2 = 1760;
    const f3 = 3520;

    for (let i = 0; i < length; i++) {
      const t = i / length;
      const timeSec = i / rate;
      const env = Math.exp(-t * decay);
      const noiseL = (nextRandom() * 2 - 1);
      const noiseR = (nextRandom() * 2 - 1);

      // Pitch-shifted harmonic shimmer overtone trail
      const shimmer = (Math.sin(2 * Math.PI * f1 * timeSec) * 0.25 +
                       Math.sin(2 * Math.PI * f2 * timeSec) * 0.18 +
                       Math.sin(2 * Math.PI * f3 * timeSec) * 0.12) * Math.min(1.0, timeSec * 2.5);

      left[i] = (noiseL * 0.75 + shimmer * 0.4) * env;
      right[i] = (noiseR * 0.75 + shimmer * 0.4) * env;
    }

    return impulse;
  }

  /**
   * Plate Reverb: High initial reflection density with smooth metallic dispersion.
   */
  private createPlateImpulse(ctx: BaseAudioContext, duration: number, decay: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    let s = 7777;
    const nextRandom = (): number => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Faster early diffusion curve characteristic of steel plates
      const env = Math.exp(-Math.pow(t, 0.85) * decay);
      left[i] = (nextRandom() * 2 - 1) * env;
      right[i] = (nextRandom() * 2 - 1) * env;
    }

    return impulse;
  }

  /**
   * Tape Warmth Waveshaper curve: gently rounds transient peaks and introduces pleasant 2nd/3rd order harmonics.
   */
  private createTapeWarmthCurve(warmth: number, samples = 1024): Float32Array<ArrayBuffer> {
    const buffer = new ArrayBuffer(samples * 4);
    const curve = new Float32Array(buffer);
    const half = samples / 2;
    const k = 1.0 + warmth * 1.8;

    for (let i = 0; i < samples; i++) {
      const x = (i - half) / half;
      if (warmth <= 0.001) {
        curve[i] = x;
      } else {
        // Asymmetric warm tape saturation
        curve[i] = Math.tanh(x * k) / Math.tanh(k);
      }
    }
    return curve;
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
