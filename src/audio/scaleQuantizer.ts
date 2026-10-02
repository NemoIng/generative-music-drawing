import { MusicalScale, RootNote, SCALES, ROOT_NOTES, getNoteNameFromSemitones } from './scales';

export interface QuantizerConfig {
  scale: MusicalScale;
  root: RootNote;
  octaveSpan: number; // e.g., 4 octaves
  deadbandWidth: number; // w in [0, 0.5], default 0.25
}

export interface PitchResult {
  frequency: number; // in Hz
  semitones: number; // total semitone offset from root
  scaleDegree: number; // continuous or rounded degree
  noteName: string;
  isSnapped: boolean; // whether currently inside deadband
}

export interface ScaleGuideline {
  y: number;
  scaleDegree: number;
  noteName: string;
  frequency: number;
  isRoot: boolean;
}

export class ScaleQuantizer {
  private config: QuantizerConfig;

  constructor(config?: Partial<QuantizerConfig>) {
    this.config = {
      scale: config?.scale ?? SCALES.dorian,
      root: config?.root ?? ROOT_NOTES.D2,
      octaveSpan: config?.octaveSpan ?? 4,
      deadbandWidth: config?.deadbandWidth ?? 0.25,
    };
  }

  public updateConfig(config: Partial<QuantizerConfig>): void {
    if (config.scale) this.config.scale = config.scale;
    if (config.root) this.config.root = config.root;
    if (config.octaveSpan !== undefined) this.config.octaveSpan = config.octaveSpan;
    if (config.deadbandWidth !== undefined) {
      this.config.deadbandWidth = Math.max(0, Math.min(0.49, config.deadbandWidth));
    }
  }

  public getConfig(): Readonly<QuantizerConfig> {
    return this.config;
  }

  /**
   * Total number of addressable discrete pitches across the vertical axis.
   * N_notes = O * K
   */
  public get totalNotes(): number {
    return this.config.octaveSpan * this.config.scale.intervals.length;
  }

  /**
   * Converts vertical canvas Y coordinate into normalized pitch coordinate u in [0, 1].
   * Computer graphics places (0, 0) at top-left; pitch increases upwards.
   * u = clamp(1 - y / H, 0, 1)
   */
  public normalizeY(y: number, canvasHeight: number): number {
    if (canvasHeight <= 0) return 0;
    const ratio = y / canvasHeight;
    return Math.max(0, Math.min(1, 1 - ratio));
  }

  /**
   * Converts normalized pitch coordinate u into continuous scale degree.
   * d_cont = u * (N_notes - 1)
   */
  public getContinuousScaleDegree(u: number): number {
    return u * (this.totalNotes - 1);
  }

  /**
   * Computes discrete semitone offset for a specific whole scale degree index k.
   */
  public getSemitonesForDegree(k: number): number {
    const intervals = this.config.scale.intervals;
    const K = intervals.length;
    const m = Math.floor(k / K);
    const r = ((k % K) + K) % K;
    return 12 * m + intervals[r];
  }

  /**
   * Discrete note snapping (for dotted/striped strokes).
   * k = round(d_cont)
   * f(k) = f_root * 2^(semitones / 12)
   */
  public quantizeDiscrete(y: number, canvasHeight: number): PitchResult {
    const u = this.normalizeY(y, canvasHeight);
    const dCont = this.getContinuousScaleDegree(u);
    const k = Math.round(dCont);

    const semitones = this.getSemitonesForDegree(k);
    const frequency = this.config.root.frequency * Math.pow(2, semitones / 12);
    const noteName = getNoteNameFromSemitones(this.config.root.baseMidi, semitones);

    return {
      frequency,
      semitones,
      scaleDegree: k,
      noteName,
      isSnapped: true,
    };
  }

  /**
   * Continuous pitch mode with deadband hysteresis (for solid drone strokes).
   *
   * delta = d_cont - floor(d_cont)
   * d_smoothed =
   *   floor(d_cont)               if delta < w
   *   floor(d_cont) + 1           if delta > 1 - w
   *   floor(d_cont) + (delta - w)/(1 - 2w)   otherwise
   *
   * Delta_semitones = (1 - gamma) * semi1 + gamma * semi2
   * f = f_root * 2^(Delta_semitones / 12)
   */
  public quantizeContinuous(y: number, canvasHeight: number): PitchResult {
    const u = this.normalizeY(y, canvasHeight);
    const dCont = this.getContinuousScaleDegree(u);

    const w = this.config.deadbandWidth;
    const baseDegree = Math.floor(dCont);
    const delta = dCont - baseDegree;

    let dSmoothed: number;
    let isSnapped = false;

    if (delta < w) {
      dSmoothed = baseDegree;
      isSnapped = true;
    } else if (delta > 1 - w) {
      dSmoothed = baseDegree + 1;
      isSnapped = true;
    } else {
      const normalizedTransition = (delta - w) / (1 - 2 * w);
      dSmoothed = baseDegree + normalizedTransition;
      isSnapped = false;
    }

    // Interpolate semitones across modal intervals
    const k1 = Math.floor(dSmoothed);
    const k2 = k1 + 1;
    const gamma = dSmoothed - k1;

    const semi1 = this.getSemitonesForDegree(k1);
    const semi2 = this.getSemitonesForDegree(k2);

    const semitones = (1 - gamma) * semi1 + gamma * semi2;
    const frequency = this.config.root.frequency * Math.pow(2, semitones / 12);
    const noteName = getNoteNameFromSemitones(this.config.root.baseMidi, semitones);

    return {
      frequency,
      semitones,
      scaleDegree: dSmoothed,
      noteName,
      isSnapped,
    };
  }

  /**
   * Generates canvas Y guidelines for all scale degrees to render musical grid overlay.
   */
  public getGuidelines(canvasHeight: number): ScaleGuideline[] {
    const total = this.totalNotes;
    const guidelines: ScaleGuideline[] = [];
    const K = this.config.scale.intervals.length;

    for (let k = 0; k < total; k++) {
      const u = total > 1 ? k / (total - 1) : 0;
      const y = (1 - u) * canvasHeight;
      const semitones = this.getSemitonesForDegree(k);
      const frequency = this.config.root.frequency * Math.pow(2, semitones / 12);
      const noteName = getNoteNameFromSemitones(this.config.root.baseMidi, semitones);
      const isRoot = k % K === 0;

      guidelines.push({
        y,
        scaleDegree: k,
        noteName,
        frequency,
        isRoot,
      });
    }

    return guidelines;
  }
}
