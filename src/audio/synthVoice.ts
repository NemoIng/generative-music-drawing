import { soundEngine } from './audioContext';
import { SoundPalette, SOUND_PALETTES } from './soundPalettes';

/**
 * Continuous Drone Voice for Solid strokes.
 * Dual detuned/harmonic oscillators + sub-oscillator + resonant filter modulated by curvature.
 */
export class DroneVoice {
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private subOsc: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private gainNode: GainNode | null = null;
  private isPlaying = false;
  private currentFreq = 220;
  private palette: SoundPalette = SOUND_PALETTES.celestial;

  public get frequency(): number {
    return this.currentFreq;
  }

  public start(initialFreq: number, palette?: SoundPalette): void {
    if (this.isPlaying || !soundEngine.isReady) return;
    const ctx = soundEngine.context;
    const now = ctx.currentTime;
    this.currentFreq = initialFreq;
    if (palette) this.palette = palette;

    const p = this.palette.drone;

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
    this.gainNode.gain.setValueAtTime(0.001, now);
    this.gainNode.gain.exponentialRampToValueAtTime(0.26, now + 0.15);

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
    soundEngine.connectVoice(this.gainNode, 0.35, 0.4);

    this.osc1.start(now);
    this.osc2.start(now);
    this.subOsc.start(now);
    this.isPlaying = true;
  }

  public setPalette(palette: SoundPalette): void {
    this.palette = palette;
    if (this.isPlaying && this.osc1 && this.osc2 && this.subOsc && this.filter) {
      this.osc1.type = palette.drone.osc1Type;
      this.osc2.type = palette.drone.osc2Type;
      this.subOsc.type = palette.drone.subType;
      this.filter.type = palette.drone.filterType;
      this.filter.Q.setTargetAtTime(palette.drone.baseQ, soundEngine.context.currentTime, 0.05);
      this.update(this.currentFreq, 0);
    }
  }

  /**
   * Continuous frequency glide with hysteresis and curvature-modulated filter cutoff.
   */
  public update(freq: number, curvature: number = 0): void {
    if (!this.isPlaying || !this.filter || !this.osc1 || !this.osc2 || !this.subOsc) return;
    const ctx = soundEngine.context;
    const now = ctx.currentTime;
    const timeConstant = 0.035;

    this.currentFreq = freq;
    const p = this.palette.drone;

    this.osc1.frequency.setTargetAtTime(freq, now, timeConstant);
    this.osc2.frequency.setTargetAtTime(freq * p.osc2IntervalRatio, now, timeConstant);
    this.subOsc.frequency.setTargetAtTime(freq * 0.5, now, timeConstant);

    // Curvature modulates filter cutoff
    const normalizedCurvature = Math.min(1, curvature * 200);
    const baseCutoff = Math.max(250, Math.min(p.maxCutoff, freq * p.baseCutoffMultiplier));
    const targetCutoff = Math.min(p.maxCutoff, baseCutoff + normalizedCurvature * p.curvatureBrightness);
    this.filter.frequency.setTargetAtTime(targetCutoff, now, 0.06);

    const targetQ = p.baseQ + normalizedCurvature * 3.0;
    this.filter.Q.setTargetAtTime(targetQ, now, 0.06);
  }

  public stop(): void {
    if (!this.isPlaying || !this.gainNode) return;
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

    this.isPlaying = false;
    this.osc1 = null;
    this.osc2 = null;
    this.subOsc = null;
    this.filter = null;
    this.gainNode = null;
  }
}

/**
 * Staccato / Pulsed Voice for Dotted and Striped strokes.
 */
export class PulseVoice {
  /**
   * Triggers a staccato note pulse using active SoundPalette parameters.
   */
  public static trigger(
    freq: number,
    isStriped: boolean = false,
    velocity: number = 0.8,
    palette: SoundPalette = SOUND_PALETTES.celestial
  ): void {
    if (!soundEngine.isReady) return;
    const ctx = soundEngine.context;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const p = palette.pulse;

    if (isStriped) {
      // Striped mode: Rhythmic percussive burst
      osc.type = p.stripedOscType;
      osc.frequency.setValueAtTime(freq, now);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(freq * 1.6, now);
      filter.Q.setValueAtTime(p.stripedBandpassQ, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.35 * velocity, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + p.stripedDecay);

      osc.connect(filter);
      filter.connect(gain);
      soundEngine.connectVoice(gain, 0.25, 0.25);

      osc.start(now);
      osc.stop(now + p.stripedDecay + 0.02);
    } else {
      // Dotted mode: Resonant melodic chime / pluck
      osc.type = p.dottedOscType;
      osc.frequency.setValueAtTime(freq, now);
      // Subtle pitch envelope for acoustic punch
      osc.frequency.exponentialRampToValueAtTime(freq * 0.996, now + 0.1);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(freq * 3.5, now);
      filter.frequency.exponentialRampToValueAtTime(freq * 0.9, now + p.dottedDecay * 0.8);
      filter.Q.setValueAtTime(p.dottedFilterQ, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.38 * velocity, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + p.dottedDecay);

      osc.connect(filter);
      filter.connect(gain);
      soundEngine.connectVoice(gain, 0.35, 0.45);

      osc.start(now);
      osc.stop(now + p.dottedDecay + 0.03);
    }
  }
}
