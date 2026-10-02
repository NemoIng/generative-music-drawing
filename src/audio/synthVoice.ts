import { soundEngine } from './audioContext';

/**
 * Continuous Drone Voice for Solid strokes.
 * Uses dual detuned oscillators and a resonant low-pass filter modulated by path curvature.
 */
export class DroneVoice {
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private subOsc: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private gainNode: GainNode | null = null;
  private isPlaying = false;
  private currentFreq = 220;

  public get frequency(): number {
    return this.currentFreq;
  }

  public start(initialFreq: number): void {
    if (this.isPlaying || !soundEngine.isReady) return;
    const ctx = soundEngine.context;
    const now = ctx.currentTime;
    this.currentFreq = initialFreq;

    // Oscillators
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc1.frequency.setValueAtTime(initialFreq, now);

    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'triangle';
    this.osc2.frequency.setValueAtTime(initialFreq * 1.003, now); // subtle 5 cent detune

    this.subOsc = ctx.createOscillator();
    this.subOsc.type = 'sine';
    this.subOsc.frequency.setValueAtTime(initialFreq * 0.5, now); // sub-octave warmth

    // Low-pass resonant filter
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.setValueAtTime(450, now);
    this.filter.Q.setValueAtTime(3.5, now);

    // Gain node with soft fade-in
    this.gainNode = ctx.createGain();
    this.gainNode.gain.setValueAtTime(0.001, now);
    this.gainNode.gain.exponentialRampToValueAtTime(0.28, now + 0.12);

    // Connections
    const oscGain1 = ctx.createGain();
    oscGain1.gain.setValueAtTime(0.35, now);
    this.osc1.connect(oscGain1);
    oscGain1.connect(this.filter);

    const oscGain2 = ctx.createGain();
    oscGain2.gain.setValueAtTime(0.45, now);
    this.osc2.connect(oscGain2);
    oscGain2.connect(this.filter);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.3, now);
    this.subOsc.connect(subGain);
    subGain.connect(this.filter);

    this.filter.connect(this.gainNode);
    soundEngine.connectVoice(this.gainNode, 0.35, 0.4);

    this.osc1.start(now);
    this.osc2.start(now);
    this.subOsc.start(now);
    this.isPlaying = true;
  }

  /**
   * Continuous frequency glide with hysteresis and curvature-modulated filter cutoff.
   *
   * @param freq Target frequency in Hz
   * @param curvature Curvature magnitude kappa (higher = sharper turn)
   */
  public update(freq: number, curvature: number = 0): void {
    if (!this.isPlaying || !this.filter || !this.osc1 || !this.osc2 || !this.subOsc) return;
    const ctx = soundEngine.context;
    const now = ctx.currentTime;
    const timeConstant = 0.035; // 35ms portamento time constant

    this.currentFreq = freq;
    this.osc1.frequency.setTargetAtTime(freq, now, timeConstant);
    this.osc2.frequency.setTargetAtTime(freq * 1.003, now, timeConstant);
    this.subOsc.frequency.setTargetAtTime(freq * 0.5, now, timeConstant);

    // Map curvature to filter cutoff (tighter curves = brighter harmonic opening)
    const normalizedCurvature = Math.min(1, curvature * 200);
    const baseCutoff = Math.max(250, Math.min(3200, freq * 2.2));
    const targetCutoff = baseCutoff + normalizedCurvature * 1800;
    this.filter.frequency.setTargetAtTime(targetCutoff, now, 0.06);

    const targetQ = 2.5 + normalizedCurvature * 4.0;
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
   * Triggers a staccato note pulse at a quantized frequency.
   */
  public static trigger(freq: number, isStriped: boolean = false, velocity: number = 0.8): void {
    if (!soundEngine.isReady) return;
    const ctx = soundEngine.context;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    if (isStriped) {
      // Crisp rhythmic pulse / Marimba pluck
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(freq * 1.5, now);
      filter.Q.setValueAtTime(3.0, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.35 * velocity, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

      osc.connect(filter);
      filter.connect(gain);
      soundEngine.connectVoice(gain, 0.25, 0.2);

      osc.start(now);
      osc.stop(now + 0.16);
    } else {
      // Dotted mode: Resonant bell / chime pluck
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      // Subtle pitch envelope for acoustic punch
      osc.frequency.exponentialRampToValueAtTime(freq * 0.995, now + 0.1);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(freq * 3.5, now);
      filter.frequency.exponentialRampToValueAtTime(freq * 0.8, now + 0.35);
      filter.Q.setValueAtTime(4.0, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.4 * velocity, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);

      osc.connect(filter);
      filter.connect(gain);
      soundEngine.connectVoice(gain, 0.4, 0.45);

      osc.start(now);
      osc.stop(now + 0.45);
    }
  }
}
