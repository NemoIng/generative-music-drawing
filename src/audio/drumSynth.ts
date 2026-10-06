import { soundEngine, SoundEngine } from './audioContext';
import { XAxisModulationMode } from './synthVoice';

/**
 * Procedural Analog Drum Synthesizer (Roland TR-808 / TR-909 Modeling)
 *
 * All drums are 100% synthesized in real time via Web Audio API primitives:
 * - Kick: Fast exponential frequency sweep (160 Hz -> 48 Hz) + snappy click pop + soft clipping
 * - Snare: Tuned dual-oscillator body (220 Hz / 160 Hz) + bandpass-filtered noise snare rattle
 * - Hi-Hats: Metallic cluster / highpass filtered noise (8.5 kHz) with ultra-fast envelope (closed) or ringing tail (open)
 * - Clap: Multi-burst micro-transients (3 clicks spaced 12ms apart) + reverberant noise tail
 * - Toms: Resonant sine sweep with pitch modulated by vertical canvas coordinate
 */
export class DrumSynth {
  private static cachedNoiseBuffer: AudioBuffer | null = null;

  /**
   * Generates or retrieves a shared white noise buffer for snare, hi-hat, and clap synthesis.
   */
  private static getNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
    if (this.cachedNoiseBuffer && this.cachedNoiseBuffer.sampleRate === ctx.sampleRate) {
      return this.cachedNoiseBuffer;
    }
    const bufferSize = ctx.sampleRate * 1.5; // 1.5 seconds of noise
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    this.cachedNoiseBuffer = buffer;
    return buffer;
  }

  /**
   * Computes stereo pan value [-1, 1] from horizontal coordinate and mode.
   */
  private static getPan(x: number, canvasWidth: number, xModMode: XAxisModulationMode): number {
    if (xModMode === 'spaceDepth' || xModMode === 'none') return 0;
    const normX = Math.max(0, Math.min(1, canvasWidth > 0 ? x / canvasWidth : 0.5));
    return Math.max(-1, Math.min(1, 2 * normX - 1));
  }

  /**
   * Triggers a punchy 808-style analog bass drum.
   */
  public static triggerKick(
    velocity: number = 0.9,
    x: number = 0,
    canvasWidth: number = 1,
    xModMode: XAxisModulationMode = 'panAndTone',
    timeOffset: number = 0,
    reverb: number = 0.0,
    engine: SoundEngine = soundEngine,
    baseTime?: number
  ): void {
    if (!engine.isReady || velocity <= 0.001) return;
    const ctx = engine.context;
    const rawNow = (baseTime !== undefined ? baseTime : ctx.currentTime) + timeOffset;
    const now = Math.max(rawNow, ctx.currentTime + timeOffset);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();

    // Subtle stereo pan (kick drums are usually centered or slightly focused)
    const pan = this.getPan(x, canvasWidth, xModMode) * 0.4;
    panner.pan.setValueAtTime(pan, now);

    // 808 Pitch Envelope: 160 Hz -> 50 Hz in 55ms
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.055);

    // Amp Envelope: instant punch, decay over 0.38s
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.9 * velocity, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

    // Transient attack pop (click)
    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    clickOsc.type = 'triangle';
    clickOsc.frequency.setValueAtTime(450, now);
    clickGain.gain.setValueAtTime(0.35 * velocity, now);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);

    clickOsc.connect(clickGain);
    clickGain.connect(gain);

    osc.connect(gain);
    gain.connect(panner);

    // Kicks are routed primarily dry with optional subtle sub-reverb
    engine.connectVoice(panner, 0.0, Math.min(1, reverb * 0.25));

    osc.start(now);
    clickOsc.start(now);
    osc.stop(now + 0.4);
    clickOsc.stop(now + 0.02);
  }

  /**
   * Triggers an 808-style analog snare drum (dual oscillator body + noise rattle).
   */
  public static triggerSnare(
    velocity: number = 0.85,
    x: number = 0,
    canvasWidth: number = 1,
    xModMode: XAxisModulationMode = 'panAndTone',
    timeOffset: number = 0,
    reverb: number = 0.35,
    engine: SoundEngine = soundEngine,
    baseTime?: number
  ): void {
    if (!engine.isReady || velocity <= 0.001) return;
    const ctx = engine.context;
    const rawNow = (baseTime !== undefined ? baseTime : ctx.currentTime) + timeOffset;
    const now = Math.max(rawNow, ctx.currentTime + timeOffset);

    const pan = this.getPan(x, canvasWidth, xModMode);
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);

    // 1. Drum Body (Toned Shell)
    const bodyOsc = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    bodyOsc.type = 'triangle';
    bodyOsc.frequency.setValueAtTime(220, now);
    bodyOsc.frequency.exponentialRampToValueAtTime(155, now + 0.05);

    bodyGain.gain.setValueAtTime(0.001, now);
    bodyGain.gain.linearRampToValueAtTime(0.55 * velocity, now + 0.003);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

    bodyOsc.connect(bodyGain);

    // 2. Snare Rattle (Bandpass filtered white noise)
    const noiseBuffer = this.getNoiseBuffer(ctx);
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(1850, now);
    noiseFilter.Q.setValueAtTime(1.8, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.001, now);
    noiseGain.gain.linearRampToValueAtTime(0.48 * velocity, now + 0.004);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);

    // Mix body and rattle together
    const masterSnareGain = ctx.createGain();
    masterSnareGain.gain.setValueAtTime(1.0, now);
    bodyGain.connect(masterSnareGain);
    noiseGain.connect(masterSnareGain);
    masterSnareGain.connect(panner);

    // Snares have subtle reverb send for acoustic space
    engine.connectVoice(panner, 0.15, reverb);

    bodyOsc.start(now);
    noiseSource.start(now);
    bodyOsc.stop(now + 0.16);
    noiseSource.stop(now + 0.24);
  }

  /**
   * Triggers a crisp metallic analog hi-hat (closed or open).
   */
  public static triggerHiHat(
    isClosed: boolean = true,
    velocity: number = 0.75,
    x: number = 0,
    canvasWidth: number = 1,
    xModMode: XAxisModulationMode = 'panAndTone',
    timeOffset: number = 0,
    reverb: number = 0.25,
    engine: SoundEngine = soundEngine,
    baseTime?: number
  ): void {
    if (!engine.isReady || velocity <= 0.001) return;
    const ctx = engine.context;
    const rawNow = (baseTime !== undefined ? baseTime : ctx.currentTime) + timeOffset;
    const now = Math.max(rawNow, ctx.currentTime + timeOffset);

    const pan = this.getPan(x, canvasWidth, xModMode);
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);

    const noiseBuffer = this.getNoiseBuffer(ctx);
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    // Highpass filter for crisp metallic sizzle
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(8200, now);
    filter.Q.setValueAtTime(3.5, now);

    const gain = ctx.createGain();
    const decayTime = isClosed ? 0.048 : 0.32;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.42 * velocity, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decayTime);

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(panner);

    engine.connectVoice(panner, isClosed ? 0.08 : 0.25, isClosed ? Math.min(1, reverb * 0.6) : reverb);

    noiseSource.start(now);
    noiseSource.stop(now + decayTime + 0.02);
  }

  /**
   * Triggers an 808-style handclap with 3 rapid pre-bursts and a reverberant noise tail.
   */
  public static triggerClap(
    velocity: number = 0.8,
    x: number = 0,
    canvasWidth: number = 1,
    xModMode: XAxisModulationMode = 'panAndTone',
    timeOffset: number = 0,
    reverb: number = 0.55,
    engine: SoundEngine = soundEngine,
    baseTime?: number
  ): void {
    if (!engine.isReady || velocity <= 0.001) return;
    const ctx = engine.context;
    const rawNow = (baseTime !== undefined ? baseTime : ctx.currentTime) + timeOffset;
    const now = Math.max(rawNow, ctx.currentTime + timeOffset);

    const pan = this.getPan(x, canvasWidth, xModMode);
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);

    const noiseBuffer = this.getNoiseBuffer(ctx);
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1250, now);
    filter.Q.setValueAtTime(2.2, now);

    const gain = ctx.createGain();

    // 3 pre-bursts (11ms intervals) + main decay
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.setValueAtTime(0.55 * velocity, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.01);
    gain.gain.setValueAtTime(0.65 * velocity, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.022);
    gain.gain.setValueAtTime(0.75 * velocity, now + 0.024);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(panner);

    engine.connectVoice(panner, 0.2, reverb);

    noiseSource.start(now);
    noiseSource.stop(now + 0.26);
  }

  /**
   * Triggers an analog tom-tom whose pitch sweeps down, tuned by vertical canvas position.
   */
  public static triggerTom(
    baseFreq: number = 120,
    velocity: number = 0.85,
    x: number = 0,
    canvasWidth: number = 1,
    xModMode: XAxisModulationMode = 'panAndTone',
    timeOffset: number = 0,
    reverb: number = 0.3,
    engine: SoundEngine = soundEngine,
    baseTime?: number
  ): void {
    if (!engine.isReady || velocity <= 0.001) return;
    const ctx = engine.context;
    const rawNow = (baseTime !== undefined ? baseTime : ctx.currentTime) + timeOffset;
    const now = Math.max(rawNow, ctx.currentTime + timeOffset);

    const pan = this.getPan(x, canvasWidth, xModMode);
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const startFreq = Math.max(70, Math.min(320, baseFreq * 1.4));
    const endFreq = Math.max(50, Math.min(220, baseFreq * 0.85));

    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.12);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.7 * velocity, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

    osc.connect(gain);
    gain.connect(panner);

    engine.connectVoice(panner, 0.18, reverb);

    osc.start(now);
    osc.stop(now + 0.3);
  }

  /**
   * Triggers a rapid multi-hit ratchet / roll burst (e.g. 3 or 4 rapid 32nd-note micro-hits).
   */
  public static triggerRoll(
    drumType: 'kick' | 'snare' | 'hihat' | 'tom' | 'clap',
    velocity: number = 0.85,
    x: number = 0,
    canvasWidth: number = 1,
    xModMode: XAxisModulationMode = 'panAndTone',
    baseFreq: number = 120,
    reverb: number = 0.35,
    engine: SoundEngine = soundEngine,
    baseTime?: number
  ): void {
    if (!engine.isReady || velocity <= 0.001) return;
    const burstCount = drumType === 'hihat' ? 4 : 3;
    const intervalSec = drumType === 'hihat' ? 0.035 : 0.045;
    for (let i = 0; i < burstCount; i++) {
      const offset = i * intervalSec;
      const hitVel = velocity * (0.7 + 0.3 * (i / (burstCount - 1 || 1)));
      switch (drumType) {
        case 'kick':
          this.triggerKick(hitVel, x, canvasWidth, xModMode, offset, reverb, engine, baseTime);
          break;
        case 'snare':
          this.triggerSnare(hitVel, x, canvasWidth, xModMode, offset, reverb, engine, baseTime);
          break;
        case 'hihat':
          this.triggerHiHat(i === burstCount - 1 ? false : true, hitVel, x, canvasWidth, xModMode, offset, reverb, engine, baseTime);
          break;
        case 'tom':
          this.triggerTom(baseFreq, hitVel, x, canvasWidth, xModMode, offset, reverb, engine, baseTime);
          break;
        case 'clap':
          this.triggerClap(hitVel, x, canvasWidth, xModMode, offset, reverb, engine, baseTime);
          break;
      }
    }
  }
}
