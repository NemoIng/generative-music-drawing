import { soundEngine, SoundEngine } from './audioContext';
import { InstrumentDefinition, DEFAULT_INSTRUMENT } from './instruments';
import { BreathingModulation } from './breathing';

export type XAxisModulationMode = 'panAndTone' | 'panOnly' | 'spaceDepth' | 'none';

/**
 * Continuous Drone Voice for Solid strokes.
 * Dual detuned/harmonic oscillators + sub-oscillator + resonant filter modulated by curvature & horizontal position.
 * Features native stereo panning and timbral brightness modulation.
 */
export class DroneVoice {
  private engine: SoundEngine;

  // Bank A
  private osc1A: OscillatorNode | null = null;
  private osc2A: OscillatorNode | null = null;
  private subOscA: OscillatorNode | null = null;
  private filterA: BiquadFilterNode | null = null;
  private bankGainA: GainNode | null = null;

  // Bank B (for dual-note transition overlap)
  private osc1B: OscillatorNode | null = null;
  private osc2B: OscillatorNode | null = null;
  private subOscB: OscillatorNode | null = null;
  private filterB: BiquadFilterNode | null = null;
  private bankGainB: GainNode | null = null;

  // Master voice nodes
  private masterGainNode: GainNode | null = null;
  private distortionNode: WaveShaperNode | null = null;
  private toneFilterNode: BiquadFilterNode | null = null;
  private pannerNode: StereoPannerNode | null = null;
  private reverbSendGain: GainNode | null = null;
  private harmonyVoices: Array<{ osc: OscillatorNode; gain: GainNode }> = [];

  private _isPlaying = false;
  private currentFreq = 220;
  private currentFreqA = 220;
  private currentFreqB = 220;
  private currentGainA = 1.0;
  private currentGainB = 0.0;
  private instrument: InstrumentDefinition = DEFAULT_INSTRUMENT;
  private volume: number = 1.0;
  private reverb: number = 0.4;
  private distortion: number = 0.0;
  private filterCutoff: number = 1.0;
  private currentMasterGain: number = 0.26;

  constructor(engine: SoundEngine = soundEngine) {
    this.engine = engine;
  }

  public get isPlaying(): boolean {
    return this._isPlaying;
  }

  public get frequency(): number {
    return this.currentFreq;
  }

  public get bankAFrequency(): number {
    return this.currentFreqA;
  }

  public get bankBFrequency(): number {
    return this.currentFreqB;
  }

  public get bankAGain(): number {
    return this.currentGainA;
  }

  public get bankBGain(): number {
    return this.currentGainB;
  }

  public get currentInstrument(): InstrumentDefinition {
    return this.instrument;
  }

  public get currentVolume(): number {
    return this.volume;
  }

  public get currentReverb(): number {
    return this.reverb;
  }

  private lofi: number = 0.0;

  public get currentDistortion(): number {
    return this.distortion;
  }

  public get currentFilterCutoff(): number {
    return this.filterCutoff;
  }

  public get currentLofi(): number {
    return this.lofi;
  }

  public setVolume(volume: number, scheduledTime?: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    const targetGain = Math.max(0.0001, 0.26 * this.volume);
    this.currentMasterGain = targetGain;
    if (this.masterGainNode && this._isPlaying) {
      const now = scheduledTime !== undefined ? scheduledTime : this.engine.context.currentTime;
      this.masterGainNode.gain.setTargetAtTime(targetGain, now, 0.03);
    }
  }

  public setReverb(reverb: number, scheduledTime?: number): void {
    this.reverb = Math.max(0, Math.min(1, reverb));
    if (this.reverbSendGain && this._isPlaying && this.engine.isReady) {
      const now = scheduledTime !== undefined ? scheduledTime : this.engine.context.currentTime;
      this.reverbSendGain.gain.setTargetAtTime(this.reverb, now, 0.05);
    }
  }

  public setDistortion(amount: number): void {
    this.distortion = Math.max(0, Math.min(1, amount));
    this.updateShaperCurve();
  }

  public setFilterCutoff(amount: number, scheduledTime?: number): void {
    this.filterCutoff = Math.max(0, Math.min(1, amount));
    if (this.toneFilterNode && this._isPlaying) {
      const now = scheduledTime !== undefined ? scheduledTime : this.engine.context.currentTime;
      // 0.0 -> 350Hz (warm/dark), 1.0 -> 18000Hz (full open)
      const targetFreq = 350 * Math.pow(18000 / 350, this.filterCutoff);
      this.toneFilterNode.frequency.setTargetAtTime(targetFreq, now, 0.04);
    }
  }

  public setLofi(amount: number): void {
    this.lofi = Math.max(0, Math.min(1, amount));
    this.updateShaperCurve();
  }

  private updateShaperCurve(): void {
    if (this.distortionNode && this._isPlaying) {
      this.distortionNode.curve = DroneVoice.createDriveAndLofiCurve(this.distortion, this.lofi);
    }
  }

  /**
   * Generates a combined audio transfer curve supporting analog overdrive and lo-fi quantization grit.
   */
  public static createDriveAndLofiCurve(distortion: number, lofi: number, samples = 512): Float32Array<ArrayBuffer> {
    const buffer = new ArrayBuffer(samples * 4);
    const curve = new Float32Array(buffer);
    const half = samples / 2;

    const dist = Math.max(0, Math.min(1, distortion));
    const cr = Math.max(0, Math.min(1, lofi));

    if (dist <= 0.001 && cr <= 0.001) {
      for (let i = 0; i < samples; i++) {
        curve[i] = (i - half) / half;
      }
      return curve;
    }

    // 1. Warm hyperbolic drive saturation to hard clip
    const k = 1.0 + dist * 9.0;
    const norm = Math.tanh(k);

    // 2. Stepped quantization levels (lofi: 1.0 -> ~5 steps, 0.5 -> ~12 steps, 0.0 -> continuous)
    const steps = cr > 0.001 ? Math.max(4, Math.round(32 * (1.0 - cr * 0.85))) : 0;

    for (let i = 0; i < samples; i++) {
      const x = (i - half) / half;
      let y = Math.tanh(x * k) / norm;

      if (steps > 0) {
        // Bit-depth quantization emulation
        const quantized = Math.round(y * steps) / steps;
        // Blend quantized step with original driven signal based on crunch depth
        y = y * (1.0 - cr) + quantized * cr;
      }

      curve[i] = Math.max(-1, Math.min(1, y));
    }
    return curve;
  }

  public static createDistortionCurve(amount: number, samples = 512): Float32Array<ArrayBuffer> {
    return DroneVoice.createDriveAndLofiCurve(amount, 0.0, samples);
  }

  public static createLofiCurve(amount: number, samples = 512): Float32Array<ArrayBuffer> {
    return DroneVoice.createDriveAndLofiCurve(0.0, amount, samples);
  }

  public start(
    initialFreq: number,
    instrument?: InstrumentDefinition,
    volume: number = 1.0,
    reverb: number = 0.4,
    startTime?: number,
    distortion: number = 0.0,
    filterCutoff: number = 1.0,
    lofi: number = 0.0
  ): void {
    if (this._isPlaying || !this.engine.isReady) return;
    const ctx = this.engine.context;
    const now = startTime !== undefined ? startTime : ctx.currentTime;
    this.currentFreq = initialFreq;
    this.volume = Math.max(0, Math.min(1, volume));
    this.reverb = Math.max(0, Math.min(1, reverb));
    this.distortion = Math.max(0, Math.min(1, distortion));
    this.filterCutoff = Math.max(0, Math.min(1, filterCutoff));
    this.lofi = Math.max(0, Math.min(1, lofi));
    if (instrument) this.instrument = instrument;

    const p = this.instrument.drone;

    // --- Create Master Nodes ---
    this.masterGainNode = ctx.createGain();
    const initialGain = Math.max(0.0001, 0.26 * this.volume);
    this.currentMasterGain = initialGain;
    this.masterGainNode.gain.setValueAtTime(0.001, now);
    this.masterGainNode.gain.exponentialRampToValueAtTime(initialGain, now + 0.15);

    // Distortion WaveShaper (combines drive & lo-fi quantization grit)
    this.distortionNode = ctx.createWaveShaper();
    this.distortionNode.curve = DroneVoice.createDriveAndLofiCurve(this.distortion, this.lofi);

    // Tone Lowpass Filter
    this.toneFilterNode = ctx.createBiquadFilter();
    this.toneFilterNode.type = 'lowpass';
    const initialCutoffHz = 350 * Math.pow(18000 / 350, this.filterCutoff);
    this.toneFilterNode.frequency.setValueAtTime(initialCutoffHz, now);
    this.toneFilterNode.Q.setValueAtTime(0.707, now);

    this.pannerNode = ctx.createStereoPanner();
    this.pannerNode.pan.setValueAtTime(0, now);

    // Routing: masterGain -> distortionNode -> toneFilterNode -> pannerNode -> output sends
    this.masterGainNode.connect(this.distortionNode);
    this.distortionNode.connect(this.toneFilterNode);
    this.toneFilterNode.connect(this.pannerNode);
    const sends = this.engine.connectVoice(this.pannerNode, 0.35, this.reverb);
    this.reverbSendGain = sends.reverbSendGain ?? null;

    // --- Helper to build an oscillator bank ---
    const buildBank = (freq: number) => {
      const osc1 = ctx.createOscillator();
      osc1.type = p.osc1Type;
      osc1.frequency.setValueAtTime(freq, now);

      const osc2 = ctx.createOscillator();
      osc2.type = p.osc2Type;
      osc2.frequency.setValueAtTime(freq * p.osc2IntervalRatio, now);

      const subOsc = ctx.createOscillator();
      subOsc.type = p.subType;
      subOsc.frequency.setValueAtTime(freq * 0.5, now);

      const filter = ctx.createBiquadFilter();
      filter.type = p.filterType;
      filter.frequency.setValueAtTime(Math.min(p.maxCutoff, freq * p.baseCutoffMultiplier), now);
      filter.Q.setValueAtTime(p.baseQ, now);

      const bankGain = ctx.createGain();

      const oscGain1 = ctx.createGain();
      oscGain1.gain.setValueAtTime(0.35, now);
      osc1.connect(oscGain1);
      oscGain1.connect(filter);

      const oscGain2 = ctx.createGain();
      oscGain2.gain.setValueAtTime(0.35, now);
      osc2.connect(oscGain2);
      oscGain2.connect(filter);

      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.28, now);
      subOsc.connect(subGain);
      subGain.connect(filter);

      filter.connect(bankGain);
      bankGain.connect(this.masterGainNode!);

      osc1.start(now);
      osc2.start(now);
      subOsc.start(now);

      return { osc1, osc2, subOsc, filter, bankGain };
    };

    // Bank A initialized at initialFreq, gain = 1.0 (100%)
    const bankA = buildBank(initialFreq);
    bankA.bankGain.gain.setValueAtTime(1.0, now);
    this.osc1A = bankA.osc1;
    this.osc2A = bankA.osc2;
    this.subOscA = bankA.subOsc;
    this.filterA = bankA.filter;
    this.bankGainA = bankA.bankGain;

    // Bank B initialized at initialFreq, gain = 0.0 (muted until note transition)
    const bankB = buildBank(initialFreq);
    bankB.bankGain.gain.setValueAtTime(0.0, now);
    this.osc1B = bankB.osc1;
    this.osc2B = bankB.osc2;
    this.subOscB = bankB.subOsc;
    this.filterB = bankB.filter;
    this.bankGainB = bankB.bankGain;

    this._isPlaying = true;
  }

  public setInstrument(instrument: InstrumentDefinition): void {
    this.instrument = instrument;
    if (this._isPlaying) {
      const now = this.engine.context.currentTime;
      const p = instrument.drone;
      const updateBankTypes = (
        osc1: OscillatorNode | null,
        osc2: OscillatorNode | null,
        sub: OscillatorNode | null,
        filter: BiquadFilterNode | null
      ) => {
        if (osc1) osc1.type = p.osc1Type;
        if (osc2) osc2.type = p.osc2Type;
        if (sub) sub.type = p.subType;
        if (filter) {
          filter.type = p.filterType;
          filter.Q.setTargetAtTime(p.baseQ, now, 0.05);
        }
      };
      updateBankTypes(this.osc1A, this.osc2A, this.subOscA, this.filterA);
      updateBankTypes(this.osc1B, this.osc2B, this.subOscB, this.filterB);
      this.update(this.currentFreq, 0, 0, 100);
    }
  }

  /**
   * Continuous dual-voice legato parameter update with independent even/odd banks:
   * Both notes sound simultaneously in the transition zone with equal perceived loudness.
   * Banks retune silently when gain is at or near 0 to avoid microtonal frequency slides.
   */
  public updateDual(
    freqA: number,
    freqB: number,
    gainA: number,
    gainB: number,
    curvature: number = 0,
    x: number = 0,
    canvasWidth: number = 1,
    xModMode: XAxisModulationMode = 'panAndTone',
    volume?: number,
    chordFrequencies?: number[],
    chordGains?: number[],
    breathingMod?: BreathingModulation,
    scheduledTime?: number
  ): void {
    if (
      !this._isPlaying ||
      !this.filterA ||
      !this.osc1A ||
      !this.osc2A ||
      !this.subOscA ||
      !this.bankGainA ||
      !this.pannerNode
    ) {
      return;
    }

    if (volume !== undefined && Math.abs(this.volume - volume) > 0.005) {
      this.setVolume(volume, scheduledTime);
    }
    const ctx = this.engine.context;
    const now = scheduledTime !== undefined ? scheduledTime : ctx.currentTime;
    const timeConstant = 0.035;
    const p = this.instrument.drone;

    // Organic Breathing Volume Swell
    const baseVol = volume !== undefined ? volume : this.volume;
    const effVol = baseVol * (breathingMod ? breathingMod.volumeMultiplier : 1.0);
    if (this.masterGainNode) {
      const targetGain = Math.max(0.0001, 0.26 * effVol);
      this.currentMasterGain = targetGain;
      this.masterGainNode.gain.setTargetAtTime(targetGain, now, 0.05);
    }

    // Organic Pitch Detune Drift (cents)
    const detuneCents = breathingMod ? breathingMod.detuneCents : 0;
    this.osc1A.detune.setTargetAtTime(detuneCents, now, 0.05);
    this.osc2A.detune.setTargetAtTime(detuneCents, now, 0.05);
    this.subOscA.detune.setTargetAtTime(detuneCents, now, 0.05);

    if (this.osc1B) this.osc1B.detune.setTargetAtTime(detuneCents, now, 0.05);
    if (this.osc2B) this.osc2B.detune.setTargetAtTime(detuneCents, now, 0.05);
    if (this.subOscB) this.subOscB.detune.setTargetAtTime(detuneCents, now, 0.05);

    // --- 1. Bank A (Even Degrees) Pitch & Gain ---
    const targetGainA = Math.max(0, Math.min(1, gainA));
    if (this.currentGainA < 0.02 && targetGainA < 0.02) {
      // Retune Bank A silently with immediate value when inactive
      this.osc1A.frequency.setValueAtTime(freqA, now);
      this.osc2A.frequency.setValueAtTime(freqA * p.osc2IntervalRatio, now);
      this.subOscA.frequency.setValueAtTime(freqA * 0.5, now);
    } else {
      this.osc1A.frequency.setTargetAtTime(freqA, now, timeConstant);
      this.osc2A.frequency.setTargetAtTime(freqA * p.osc2IntervalRatio, now, timeConstant);
      this.subOscA.frequency.setTargetAtTime(freqA * 0.5, now, timeConstant);
    }
    this.bankGainA.gain.setTargetAtTime(targetGainA, now, 0.03);
    this.currentGainA = targetGainA;
    this.currentFreqA = freqA;

    // --- 2. Bank B (Odd Degrees) Pitch & Gain ---
    const targetGainB = Math.max(0, Math.min(1, gainB));
    if (this.osc1B && this.osc2B && this.subOscB && this.bankGainB) {
      if (this.currentGainB < 0.02 && targetGainB < 0.02) {
        // Retune Bank B silently with immediate value when inactive
        this.osc1B.frequency.setValueAtTime(freqB, now);
        this.osc2B.frequency.setValueAtTime(freqB * p.osc2IntervalRatio, now);
        this.subOscB.frequency.setValueAtTime(freqB * 0.5, now);
      } else {
        this.osc1B.frequency.setTargetAtTime(freqB, now, timeConstant);
        this.osc2B.frequency.setTargetAtTime(freqB * p.osc2IntervalRatio, now, timeConstant);
        this.subOscB.frequency.setTargetAtTime(freqB * 0.5, now, timeConstant);
      }
      this.bankGainB.gain.setTargetAtTime(targetGainB, now, 0.03);
      this.currentGainB = targetGainB;
      this.currentFreqB = freqB;
    }

    this.currentFreq = targetGainA >= targetGainB ? freqA : freqB;

    // --- 3. Spatial & Timbral Modulations (with Macro Filter Breathing) ---
    const filterMultiplier = breathingMod ? breathingMod.filterMultiplier : 1.0;
    this.applyModulations(x, canvasWidth, xModMode, curvature, freqA, freqB, filterMultiplier, scheduledTime);

    // --- 4. Chord Harmony Voicing (Octave, Sub-Octave, Dual Octave) ---
    if (this.masterGainNode && chordFrequencies && chordFrequencies.length > 1) {
      const extraFreqs = chordFrequencies.slice(1);
      const extraGains = chordGains ? chordGains.slice(1) : extraFreqs.map(() => 0.5);

      if (this.harmonyVoices.length !== extraFreqs.length) {
        for (const h of this.harmonyVoices) {
          try { h.osc.stop(); h.osc.disconnect(); h.gain.disconnect(); } catch {}
        }
        this.harmonyVoices = [];

        for (let i = 0; i < extraFreqs.length; i++) {
          const osc = ctx.createOscillator();
          osc.type = p.osc1Type;
          osc.frequency.setValueAtTime(extraFreqs[i], now);
          osc.detune.setValueAtTime(detuneCents, now);
          const g = ctx.createGain();
          const targetVoiceGain = 0.3 * (extraGains[i] ?? 0.5);
          g.gain.setValueAtTime(targetVoiceGain, now);
          osc.connect(g);
          g.connect(this.masterGainNode);
          osc.start(now);
          this.harmonyVoices.push({ osc, gain: g });
        }
      } else {
        for (let i = 0; i < extraFreqs.length; i++) {
          const h = this.harmonyVoices[i];
          h.osc.frequency.setTargetAtTime(extraFreqs[i], now, timeConstant);
          h.osc.detune.setTargetAtTime(detuneCents, now, 0.05);
          const targetVoiceGain = 0.3 * (extraGains[i] ?? 0.5);
          h.gain.gain.setTargetAtTime(targetVoiceGain, now, 0.05);
        }
      }
    } else if (this.harmonyVoices.length > 0) {
      for (const h of this.harmonyVoices) {
        try { h.osc.stop(); h.osc.disconnect(); h.gain.disconnect(); } catch {}
      }
      this.harmonyVoices = [];
    }
  }

  /**
   * Continuous parameter update with dual-voice polyphonic crossfading:
   * When transitioning between notes, both Note 1 and Note 2 sound simultaneously.
   */
  public update(
    freq: number,
    curvature: number = 0,
    x: number = 0,
    canvasWidth: number = 1,
    xModMode: XAxisModulationMode = 'panAndTone',
    volume?: number,
    secondFreq?: number,
    blend: number = 0,
    scheduledTime?: number
  ): void {
    if (secondFreq !== undefined && secondFreq > 0) {
      const clampedBlend = Math.max(0, Math.min(1, blend));
      const gA = Math.cos(clampedBlend * 0.5 * Math.PI);
      const gB = Math.sin(clampedBlend * 0.5 * Math.PI);
      this.updateDual(freq, secondFreq, gA, gB, curvature, x, canvasWidth, xModMode, volume, undefined, undefined, undefined, scheduledTime);
    } else {
      this.updateDual(freq, freq, 1.0, 0.0, curvature, x, canvasWidth, xModMode, volume, undefined, undefined, undefined, scheduledTime);
    }
  }

  private applyModulations(
    x: number,
    canvasWidth: number,
    xModMode: XAxisModulationMode,
    curvature: number,
    freqA: number,
    freqB: number,
    filterMultiplier: number = 1.0,
    scheduledTime?: number
  ): void {
    if (!this.pannerNode || !this.filterA) return;
    const now = scheduledTime !== undefined ? scheduledTime : this.engine.context.currentTime;
    const p = this.instrument.drone;

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
      toneMultiplier = 0.75 + 0.6 * normX;
    }

    // 3. Curvature Modulation on Filters
    const normalizedCurvature = Math.min(1, curvature * 200);
    const targetQ = p.baseQ + normalizedCurvature * 2.5;

    // Filter A
    const baseCutoffA = Math.max(120, Math.min(p.maxCutoff, freqA * p.baseCutoffMultiplier * toneMultiplier * filterMultiplier));
    const targetCutoffA = Math.min(p.maxCutoff, baseCutoffA + normalizedCurvature * p.curvatureBrightness);
    this.filterA.frequency.setTargetAtTime(targetCutoffA, now, 0.06);
    this.filterA.Q.setTargetAtTime(targetQ, now, 0.06);

    // Filter B
    if (this.filterB) {
      const baseCutoffB = Math.max(120, Math.min(p.maxCutoff, freqB * p.baseCutoffMultiplier * toneMultiplier * filterMultiplier));
      const targetCutoffB = Math.min(p.maxCutoff, baseCutoffB + normalizedCurvature * p.curvatureBrightness);
      this.filterB.frequency.setTargetAtTime(targetCutoffB, now, 0.06);
      this.filterB.Q.setTargetAtTime(targetQ, now, 0.06);
    }
  }

  public stop(releaseTime: number = 0.2, stopTime?: number): void {
    if (!this._isPlaying || !this.masterGainNode) return;
    const ctx = this.engine.context;
    const now = stopTime !== undefined ? stopTime : ctx.currentTime;
    const actualRelease = Math.max(0.12, releaseTime);

    const startGain = Math.max(0.0001, this.currentMasterGain);
    this.masterGainNode.gain.cancelScheduledValues(now);
    this.masterGainNode.gain.setValueAtTime(startGain, now);
    this.masterGainNode.gain.exponentialRampToValueAtTime(0.0001, now + actualRelease);

    const oldOsc1A = this.osc1A;
    const oldOsc2A = this.osc2A;
    const oldSubA = this.subOscA;
    const oldOsc1B = this.osc1B;
    const oldOsc2B = this.osc2B;
    const oldSubB = this.subOscB;

    const oldHarmony = this.harmonyVoices;
    this.harmonyVoices = [];

    // Schedule exact stop time on oscillators
    try {
      oldOsc1A?.stop(now + actualRelease + 0.05);
      oldOsc2A?.stop(now + actualRelease + 0.05);
      oldSubA?.stop(now + actualRelease + 0.05);
      oldOsc1B?.stop(now + actualRelease + 0.05);
      oldOsc2B?.stop(now + actualRelease + 0.05);
      oldSubB?.stop(now + actualRelease + 0.05);
      for (const h of oldHarmony) {
        h.osc.stop(now + actualRelease + 0.05);
      }
    } catch {
      // Ignored if already stopped
    }

    setTimeout(() => {
      try {
        oldOsc1A?.stop();
        oldOsc2A?.stop();
        oldSubA?.stop();
        oldOsc1B?.stop();
        oldOsc2B?.stop();
        oldSubB?.stop();
        for (const h of oldHarmony) {
          h.osc.stop();
          h.osc.disconnect();
          h.gain.disconnect();
        }
      } catch {
        // already stopped
      }
    }, Math.ceil(actualRelease * 1000) + 50);

    this._isPlaying = false;
    this.osc1A = null;
    this.osc2A = null;
    this.subOscA = null;
    this.filterA = null;
    this.bankGainA = null;
    this.osc1B = null;
    this.osc2B = null;
    this.subOscB = null;
    this.filterB = null;
    this.bankGainB = null;
    this.pannerNode = null;
    this.distortionNode = null;
    this.toneFilterNode = null;
    this.masterGainNode = null;
    this.reverbSendGain = null;
  }
}

/**
 * Staccato / Pulsed Voice for Dotted and Striped strokes.
 * Dispatches spatially panned pulses based on the stroke's assigned InstrumentDefinition and individual reverb level.
 */
export class PulseVoice {
  /**
   * Triggers a staccato note pulse using the assigned InstrumentDefinition, stereo position, and per-line reverb.
   */
  public static trigger(
    freq: number,
    isStriped: boolean = false,
    velocity: number = 0.8,
    instrument: InstrumentDefinition = DEFAULT_INSTRUMENT,
    x: number = 0,
    canvasWidth: number = 1,
    xModMode: XAxisModulationMode = 'panAndTone',
    timeOffset: number = 0,
    reverb: number = 0.45,
    filterMultiplier: number = 1.0,
    volumeMultiplier: number = 1.0,
    engine: SoundEngine = soundEngine,
    baseTime?: number,
    distortion: number = 0.0,
    toneCutoff: number = 1.0,
    lofi: number = 0.0
  ): void {
    if (!engine.isReady || velocity <= 0.001) return;
    const ctx = engine.context;
    const rawNow = (baseTime !== undefined ? baseTime : ctx.currentTime) + timeOffset;
    const now = Math.max(rawNow, ctx.currentTime + timeOffset);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const panner = ctx.createStereoPanner();

    // Stereo Panning from horizontal position
    const normX = Math.max(0, Math.min(1, canvasWidth > 0 ? x / canvasWidth : 0.5));
    const pan = (xModMode === 'spaceDepth' || xModMode === 'none') ? 0 : Math.max(-1, Math.min(1, 2 * normX - 1));
    panner.pan.setValueAtTime(pan, now);

    const p = instrument.pulse;
    const toneMultX = xModMode === 'panAndTone' ? 0.8 + 0.4 * normX : 1.0;
    const toneMultiplier = toneMultX * Math.max(0.2, toneCutoff);
    const effVel = Math.max(0.001, velocity * volumeMultiplier);

    if (distortion > 0.01 || lofi > 0.01) {
      const distNode = ctx.createWaveShaper();
      distNode.curve = DroneVoice.createDriveAndLofiCurve(distortion, lofi);
      gain.connect(distNode);
      distNode.connect(panner);
    } else {
      gain.connect(panner);
    }

    if (isStriped) {
      // Striped / Ratchet mode: Rhythmic percussive burst
      osc.type = p.stripedOscType;
      osc.frequency.setValueAtTime(freq, now);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(freq * 1.6 * toneMultiplier * filterMultiplier, now);
      filter.Q.setValueAtTime(p.stripedBandpassQ, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.35 * effVel, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + p.stripedDecay);

      osc.connect(filter);
      filter.connect(gain);
      engine.connectVoice(panner, 0.25, Math.min(1, reverb * 0.7));

      osc.start(now);
      osc.stop(now + p.stripedDecay + 0.02);
    } else {
      // Dotted mode: Resonant melodic chime / pluck
      osc.type = p.dottedOscType;
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.996, now + 0.1);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(freq * 3.5 * toneMultiplier * filterMultiplier, now);
      filter.frequency.exponentialRampToValueAtTime(freq * 0.9, now + p.dottedDecay * 0.8);
      filter.Q.setValueAtTime(p.dottedFilterQ, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.38 * effVel, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + p.dottedDecay);

      osc.connect(filter);
      filter.connect(gain);
      engine.connectVoice(panner, 0.35, reverb);

      osc.start(now);
      osc.stop(now + p.dottedDecay + 0.03);
    }
  }

  /**
   * Triggers a rapid modular synth ratchet burst (3 scheduled micro-triggers) for roll texture.
   */
  public static triggerRatchet(
    freq: number,
    velocity: number = 0.8,
    instrument: InstrumentDefinition = DEFAULT_INSTRUMENT,
    x: number = 0,
    canvasWidth: number = 1,
    xModMode: XAxisModulationMode = 'panAndTone',
    reverb: number = 0.45,
    filterMultiplier: number = 1.0,
    volumeMultiplier: number = 1.0,
    engine: SoundEngine = soundEngine,
    baseTime?: number,
    distortion: number = 0.0,
    toneCutoff: number = 1.0,
    lofi: number = 0.0
  ): void {
    if (!engine.isReady || velocity <= 0.001) return;
    const count = 3;
    const intervalSec = 0.045;
    for (let i = 0; i < count; i++) {
      const offset = i * intervalSec;
      const hitVel = velocity * (0.7 + 0.3 * (i / (count - 1)));
      this.trigger(
        freq,
        true,
        hitVel,
        instrument,
        x,
        canvasWidth,
        xModMode,
        offset,
        reverb,
        filterMultiplier,
        volumeMultiplier,
        engine,
        baseTime,
        distortion,
        toneCutoff,
        lofi
      );
    }
  }
}
