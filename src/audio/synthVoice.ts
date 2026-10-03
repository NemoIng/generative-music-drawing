import { soundEngine } from './audioContext';
import { InstrumentDefinition, DEFAULT_INSTRUMENT } from './instruments';

export type XAxisModulationMode = 'panAndTone' | 'panOnly' | 'spaceDepth' | 'none';

/**
 * Continuous Drone Voice for Solid strokes.
 * Dual detuned/harmonic oscillators + sub-oscillator + resonant filter modulated by curvature & horizontal position.
 * Features native stereo panning and timbral brightness modulation.
 */
export class DroneVoice {
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private subOsc: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private gainNode: GainNode | null = null;
  private pannerNode: StereoPannerNode | null = null;
  private _isPlaying = false;
  private currentFreq = 220;
  private instrument: InstrumentDefinition = DEFAULT_INSTRUMENT;
  private volume: number = 1.0;

  public get isPlaying(): boolean {
    return this._isPlaying;
  }

  public get frequency(): number {
    return this.currentFreq;
  }

  public get currentInstrument(): InstrumentDefinition {
    return this.instrument;
  }

  public get currentVolume(): number {
    return this.volume;
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gainNode && this._isPlaying) {
      const now = soundEngine.context.currentTime;
      const targetGain = Math.max(0.0001, 0.26 * this.volume);
      this.gainNode.gain.setTargetAtTime(targetGain, now, 0.03);
    }
  }

  public start(initialFreq: number, instrument?: InstrumentDefinition, volume: number = 1.0): void {
    if (this._isPlaying || !soundEngine.isReady) return;
    const ctx = soundEngine.context;
    const now = ctx.currentTime;
    this.currentFreq = initialFreq;
    this.volume = Math.max(0, Math.min(1, volume));
    if (instrument) this.instrument = instrument;

    const p = this.instrument.drone;

    // Oscillators
    this.osc1 = ctx.createOscillator();
    this.osc1.type = p.osc1Type;
    this.osc1.frequency.setValueAtTime(initialFreq, now);

    this.osc2 = ctx.createOscillator();
    this.osc2.type = p.osc2Type;
    this.osc2.frequency.setValueAtTime(initialFreq * p.osc2IntervalRatio, now);

    this.subOsc = ctx.createOscillator();
    this.subOsc.type = p.subType;
    this.subOsc.frequency.setValueAtTime(initialFreq * 0.5, now);

    // Resonant Filter
    this.filter = ctx.createBiquadFilter();
    this.filter.type = p.filterType;
    this.filter.frequency.setValueAtTime(Math.min(p.maxCutoff, initialFreq * p.baseCutoffMultiplier), now);
    this.filter.Q.setValueAtTime(p.baseQ, now);

    // Gain node with soft fade-in
    this.gainNode = ctx.createGain();
    const initialGain = Math.max(0.0001, 0.26 * this.volume);
    this.gainNode.gain.setValueAtTime(0.001, now);
    this.gainNode.gain.exponentialRampToValueAtTime(initialGain, now + 0.15);

    // Stereo Panner Node for Horizontal Spatial Positioning
    this.pannerNode = ctx.createStereoPanner();
    this.pannerNode.pan.setValueAtTime(0, now);

    // Internal Mix
    const oscGain1 = ctx.createGain();
    oscGain1.gain.setValueAtTime(0.35, now);
    this.osc1.connect(oscGain1);
    oscGain1.connect(this.filter);

    const oscGain2 = ctx.createGain();
    oscGain2.gain.setValueAtTime(0.35, now);
    this.osc2.connect(oscGain2);
    oscGain2.connect(this.filter);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.28, now);
    this.subOsc.connect(subGain);
    subGain.connect(this.filter);

    this.filter.connect(this.gainNode);
    this.gainNode.connect(this.pannerNode);

    soundEngine.connectVoice(this.pannerNode, 0.35, 0.4);

    this.osc1.start(now);
    this.osc2.start(now);
    this.subOsc.start(now);
    this._isPlaying = true;
  }

  public setInstrument(instrument: InstrumentDefinition): void {
    this.instrument = instrument;
    if (this._isPlaying && this.osc1 && this.osc2 && this.subOsc && this.filter) {
      this.osc1.type = instrument.drone.osc1Type;
      this.osc2.type = instrument.drone.osc2Type;
      this.subOsc.type = instrument.drone.subType;
      this.filter.type = instrument.drone.filterType;
      this.filter.Q.setTargetAtTime(instrument.drone.baseQ, soundEngine.context.currentTime, 0.05);
      this.update(this.currentFreq, 0, 0, 100);
    }
  }

  /**
   * Continuous parameter update:
   * - Vertical (freq): smooth portamento pitch glide
   * - Curvature: dynamic filter opening on sharp turns
   * - Horizontal (x): spatial stereo panning and timbral brightness modulation
   */
  public update(
    freq: number,
    curvature: number = 0,
    x: number = 0,
    canvasWidth: number = 1,
    xModMode: XAxisModulationMode = 'panAndTone',
    volume?: number
  ): void {
    if (!this._isPlaying || !this.filter || !this.osc1 || !this.osc2 || !this.subOsc || !this.pannerNode) return;
    if (volume !== undefined && Math.abs(this.volume - volume) > 0.005) {
      this.setVolume(volume);
    }
    const ctx = soundEngine.context;
    const now = ctx.currentTime;
    const timeConstant = 0.035;

    this.currentFreq = freq;
    const p = this.instrument.drone;

    this.osc1.frequency.setTargetAtTime(freq, now, timeConstant);
    this.osc2.frequency.setTargetAtTime(freq * p.osc2IntervalRatio, now, timeConstant);
    this.subOsc.frequency.setTargetAtTime(freq * 0.5, now, timeConstant);

    // 1. Horizontal Stereo Panning
    const normX = Math.max(0, Math.min(1, canvasWidth > 0 ? x / canvasWidth : 0.5));
    const targetPan = Math.max(-1, Math.min(1, 2 * normX - 1));

    if (xModMode === 'panAndTone' || xModMode === 'panOnly') {
      this.pannerNode.pan.setTargetAtTime(targetPan, now, 0.04);
    } else {
      this.pannerNode.pan.setTargetAtTime(0, now, 0.04);
    }

    // 2. Timbral Brightness Modulation from X-axis
    let toneMultiplier = 1.0;
    if (xModMode === 'panAndTone') {
      // Left edge is warmer/subtle (0.75x), right edge opens up to 1.35x
      toneMultiplier = 0.75 + 0.6 * normX;
    }

    // 3. Curvature Modulation
    const normalizedCurvature = Math.min(1, curvature * 200);
    const baseCutoff = Math.max(200, Math.min(p.maxCutoff, freq * p.baseCutoffMultiplier * toneMultiplier));
    const targetCutoff = Math.min(p.maxCutoff, baseCutoff + normalizedCurvature * p.curvatureBrightness);
    this.filter.frequency.setTargetAtTime(targetCutoff, now, 0.06);

    const targetQ = p.baseQ + normalizedCurvature * 2.5;
    this.filter.Q.setTargetAtTime(targetQ, now, 0.06);
  }

  public stop(): void {
    if (!this._isPlaying || !this.gainNode) return;
    const ctx = soundEngine.context;
    const now = ctx.currentTime;

    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
    this.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);

    const oldOsc1 = this.osc1;
    const oldOsc2 = this.osc2;
    const oldSub = this.subOsc;

    setTimeout(() => {
      try {
        oldOsc1?.stop();
        oldOsc2?.stop();
        oldSub?.stop();
      } catch {
        // already stopped
      }
    }, 200);

    this._isPlaying = false;
    this.osc1 = null;
    this.osc2 = null;
    this.subOsc = null;
    this.filter = null;
    this.pannerNode = null;
    this.gainNode = null;
  }
}

/**
 * Staccato / Pulsed Voice for Dotted and Striped strokes.
 * Dispatches spatially panned pulses based on the stroke's assigned InstrumentDefinition.
 */
export class PulseVoice {
  /**
   * Triggers a staccato note pulse using the assigned InstrumentDefinition and stereo position.
   */
  public static trigger(
    freq: number,
    isStriped: boolean = false,
    velocity: number = 0.8,
    instrument: InstrumentDefinition = DEFAULT_INSTRUMENT,
    x: number = 0,
    canvasWidth: number = 1,
    xModMode: XAxisModulationMode = 'panAndTone'
  ): void {
    if (!soundEngine.isReady || velocity <= 0.001) return;
    const ctx = soundEngine.context;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const panner = ctx.createStereoPanner();

    // Stereo Panning from horizontal position
    const normX = Math.max(0, Math.min(1, canvasWidth > 0 ? x / canvasWidth : 0.5));
    const pan = (xModMode === 'spaceDepth' || xModMode === 'none') ? 0 : Math.max(-1, Math.min(1, 2 * normX - 1));
    panner.pan.setValueAtTime(pan, now);

    const p = instrument.pulse;
    const toneMultiplier = xModMode === 'panAndTone' ? 0.8 + 0.4 * normX : 1.0;

    if (isStriped) {
      // Striped mode: Rhythmic percussive burst
      osc.type = p.stripedOscType;
      osc.frequency.setValueAtTime(freq, now);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(freq * 1.6 * toneMultiplier, now);
      filter.Q.setValueAtTime(p.stripedBandpassQ, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.35 * velocity, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + p.stripedDecay);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(panner);
      soundEngine.connectVoice(panner, 0.25, 0.25);

      osc.start(now);
      osc.stop(now + p.stripedDecay + 0.02);
    } else {
      // Dotted mode: Resonant melodic chime / pluck
      osc.type = p.dottedOscType;
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.996, now + 0.1);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(freq * 3.5 * toneMultiplier, now);
      filter.frequency.exponentialRampToValueAtTime(freq * 0.9, now + p.dottedDecay * 0.8);
      filter.Q.setValueAtTime(p.dottedFilterQ, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.38 * velocity, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + p.dottedDecay);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(panner);
      soundEngine.connectVoice(panner, 0.35, 0.45);

      osc.start(now);
      osc.stop(now + p.dottedDecay + 0.03);
    }
  }
}
