import { MusicalScale, RootNote, SCALES, ROOT_NOTES, getNoteNameFromSemitones } from './scales';

export interface QuantizerConfig {
  scale: MusicalScale;
  root: RootNote;
  octaveSpan: number; // e.g., 4 octaves
  chordDegrees?: number[]; // active chord tone scale degrees (e.g., [0, 2, 4, 6])
}

export interface PitchResult {
  frequency: number; // in Hz (primary/dominant pitch)
  freq1?: number; // lower adjacent scale degree frequency (Hz)
  freq2?: number; // higher adjacent scale degree frequency (Hz)
  freqA?: number; // Bank A (even degrees) frequency (Hz)
  freqB?: number; // Bank B (odd degrees) frequency (Hz)
  gainA?: number; // Bank A equal-power gain [0, 1]
  gainB?: number; // Bank B equal-power gain [0, 1]
  blend?: number; // crossfade blend [0, 1] (0 = 100% freq1, 1 = 100% freq2)
  semitones: number; // total semitone offset from root
  scaleDegree: number; // continuous or rounded degree
  noteName: string;
  isSnapped: boolean; // whether on/near scale guideline
}

export interface ScaleGuideline {
  y: number;
  screenY?: number;
  scaleDegree: number;
  noteName: string;
  frequency: number;
  isRoot: boolean;
  isChordTone?: boolean;
}

export class ScaleQuantizer {
  private config: QuantizerConfig;

  /** Minimum supported frequency (100 Hz) */
  public static readonly MIN_FREQ = 100;
  /** Start of high-precision middle band (200 Hz) */
  public static readonly MID_FREQ_LOW = 200;
  /** End of high-precision middle band (2000 Hz) */
  public static readonly MID_FREQ_HIGH = 2000;
  /** Maximum supported frequency (8000 Hz) */
  public static readonly MAX_FREQ = 8000;

  /** Fraction of vertical coordinate space allocated to 100 Hz - 200 Hz (15%) */
  public static readonly U_LOW = 0.15;
  /** Fraction of vertical coordinate space allocated up to 2000 Hz (85%, so 200-2000 Hz takes 70%) */
  public static readonly U_HIGH = 0.85;

  /** Total number of octaves supported across the scrollable field (backward-compatibility) */
  public readonly totalFieldOctaves = 8;
  public readonly octavesBelowRoot = 2;
  public readonly octavesAboveRoot = 6;

  private _scrollY = 0;
  private _scrollEnabled = false;

  constructor(config?: Partial<QuantizerConfig>) {
    this.config = {
      scale: config?.scale ?? SCALES.dorian,
      root: config?.root ?? ROOT_NOTES.D2,
      octaveSpan: config?.octaveSpan ?? 4,
      chordDegrees: config?.chordDegrees,
    };
  }

  public get isScrollEnabled(): boolean {
    return this._scrollEnabled;
  }

  public setScrollEnabled(enabled: boolean): void {
    this._scrollEnabled = enabled;
  }

  public get scrollY(): number {
    return this._scrollY;
  }

  public set scrollY(y: number) {
    this._scrollY = y;
  }

  public setScrollY(y: number): void {
    this._scrollY = y;
  }

  public updateConfig(config: Partial<QuantizerConfig>): void {
    if (config.scale) this.config.scale = config.scale;
    if (config.root) this.config.root = config.root;
    if (config.octaveSpan !== undefined) this.config.octaveSpan = config.octaveSpan;
    if (config.chordDegrees !== undefined) {
      this.config.chordDegrees = config.chordDegrees;
    }
  }

  public getConfig(): Readonly<QuantizerConfig> {
    return this.config;
  }

  /**
   * Total number of addressable discrete pitches across the vertical axis.
   */
  public get totalNotes(): number {
    return this.config.octaveSpan * this.config.scale.intervals.length;
  }

  /**
   * Non-linear mapping from physical frequency (Hz) to normalized vertical coordinate u in [0, 1].
   * 100 Hz -> 0.0
   * 200 Hz -> 0.15 (15% height)
   * 2000 Hz -> 0.85 (70% height allocated for precision between 200 and 2000 Hz)
   * 8000 Hz -> 1.0 (15% height)
   */
  public static frequencyToNormalizedU(freq: number): number {
    const f = Math.max(ScaleQuantizer.MIN_FREQ, Math.min(ScaleQuantizer.MAX_FREQ, freq));
    if (f <= ScaleQuantizer.MIN_FREQ) return 0;
    if (f >= ScaleQuantizer.MAX_FREQ) return 1;

    if (f < ScaleQuantizer.MID_FREQ_LOW) {
      const t = Math.log2(f / ScaleQuantizer.MIN_FREQ) / Math.log2(ScaleQuantizer.MID_FREQ_LOW / ScaleQuantizer.MIN_FREQ);
      return t * ScaleQuantizer.U_LOW;
    } else if (f <= ScaleQuantizer.MID_FREQ_HIGH) {
      const t = Math.log2(f / ScaleQuantizer.MID_FREQ_LOW) / Math.log2(ScaleQuantizer.MID_FREQ_HIGH / ScaleQuantizer.MID_FREQ_LOW);
      return ScaleQuantizer.U_LOW + t * (ScaleQuantizer.U_HIGH - ScaleQuantizer.U_LOW);
    } else {
      const t = Math.log2(f / ScaleQuantizer.MID_FREQ_HIGH) / Math.log2(ScaleQuantizer.MAX_FREQ / ScaleQuantizer.MID_FREQ_HIGH);
      return ScaleQuantizer.U_HIGH + t * (1 - ScaleQuantizer.U_HIGH);
    }
  }

  /**
   * Inverse non-linear mapping from normalized vertical coordinate u in [0, 1] to physical frequency (Hz).
   */
  public static normalizedUToFrequency(u: number): number {
    const clampedU = Math.max(0, Math.min(1, u));
    if (clampedU <= 0) return ScaleQuantizer.MIN_FREQ;
    if (clampedU >= 1) return ScaleQuantizer.MAX_FREQ;

    if (clampedU < ScaleQuantizer.U_LOW) {
      const t = clampedU / ScaleQuantizer.U_LOW;
      return ScaleQuantizer.MIN_FREQ * Math.pow(ScaleQuantizer.MID_FREQ_LOW / ScaleQuantizer.MIN_FREQ, t);
    } else if (clampedU <= ScaleQuantizer.U_HIGH) {
      const t = (clampedU - ScaleQuantizer.U_LOW) / (ScaleQuantizer.U_HIGH - ScaleQuantizer.U_LOW);
      return ScaleQuantizer.MID_FREQ_LOW * Math.pow(ScaleQuantizer.MID_FREQ_HIGH / ScaleQuantizer.MID_FREQ_LOW, t);
    } else {
      const t = (clampedU - ScaleQuantizer.U_HIGH) / (1 - ScaleQuantizer.U_HIGH);
      return ScaleQuantizer.MID_FREQ_HIGH * Math.pow(ScaleQuantizer.MAX_FREQ / ScaleQuantizer.MID_FREQ_HIGH, t);
    }
  }

  /**
   * Virtual world height multiplier. The entire [100 Hz, 8000 Hz] range spans
   * WORLD_MULTIPLIER viewports, so the visible canvas displays an uncluttered ~2.5 octaves
   * and can be smoothly scrolled vertically across the full spectrum.
   */
  public static readonly WORLD_MULTIPLIER = 2.5;

  /**
   * Total virtual height in pixels of the frequency world.
   */
  public getWorldHeight(viewportHeight: number): number {
    const vh = viewportHeight > 0 ? viewportHeight : 800;
    return vh * ScaleQuantizer.WORLD_MULTIPLIER;
  }

  /**
   * Pixels per musical octave based on current viewport height and visible octave span.
   */
  public getPxPerOctave(viewportHeight: number): number {
    const visibleOctaves = Math.max(1, this.config.octaveSpan);
    return (viewportHeight > 0 ? viewportHeight : 800) / visibleOctaves;
  }

  /**
   * World Y coordinate of the base root note.
   */
  public getRootWorldY(viewportHeight: number): number {
    const worldH = this.getWorldHeight(viewportHeight);
    const u = ScaleQuantizer.frequencyToNormalizedU(this.config.root.frequency);
    return (1 - u) * worldH;
  }

  /**
   * Default scroll offset that positions the viewport centered around the musical mid-band (~200 to 2000 Hz).
   */
  public getDefaultScrollY(viewportHeight: number): number {
    const worldH = this.getWorldHeight(viewportHeight);
    const maxScroll = this.getMaxScrollY(viewportHeight);
    // Center around u = 0.50 (where 632 Hz is located)
    const midWorldY = 0.50 * worldH;
    return Math.max(0, Math.min(maxScroll, midWorldY - viewportHeight * 0.5));
  }

  /**
   * Maximum scroll offset.
   */
  public getMaxScrollY(viewportHeight: number): number {
    const worldH = this.getWorldHeight(viewportHeight);
    return Math.max(0, worldH - viewportHeight);
  }

  /**
   * Clamps scroll offset within valid bounds [0, maxScrollY].
   */
  public clampScrollY(y: number, viewportHeight: number): number {
    const max = this.getMaxScrollY(viewportHeight);
    return Math.max(0, Math.min(max, y));
  }

  /**
   * Resets scroll offset to the default centered middle register.
   */
  public resetScrollToDefault(viewportHeight: number): number {
    this._scrollY = this.getDefaultScrollY(viewportHeight);
    return this._scrollY;
  }

  /**
   * Increments scroll offset by deltaY and clamps within bounds.
   */
  public scrollBy(deltaY: number, viewportHeight: number): number {
    this._scrollY = this.clampScrollY(this._scrollY + deltaY, viewportHeight);
    return this._scrollY;
  }

  /**
   * Converts a screen coordinate into world pitch coordinate.
   */
  public screenToWorldY(screenY: number, _viewportHeight?: number): number {
    if (!this._scrollEnabled) return screenY;
    return screenY + this._scrollY;
  }

  /**
   * Converts a world pitch coordinate into screen coordinate.
   */
  public worldToScreenY(worldY: number, _viewportHeight?: number): number {
    if (!this._scrollEnabled) return worldY;
    return worldY - this._scrollY;
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
   */
  public getContinuousScaleDegree(u: number): number {
    const targetFreq = ScaleQuantizer.normalizedUToFrequency(u);
    return this.frequencyToContinuousDegree(targetFreq);
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
   * Computes frequency in Hz for an exact whole scale degree index k.
   */
  public getFrequencyForDegree(k: number): number {
    const semitones = this.getSemitonesForDegree(k);
    return this.config.root.frequency * Math.pow(2, semitones / 12);
  }

  /**
   * Converts any frequency into a continuous scale degree in the active musical scale.
   */
  public frequencyToContinuousDegree(freq: number): number {
    const rootFreq = this.config.root.frequency;
    const intervals = this.config.scale.intervals;
    const K = intervals.length;

    const semi = 12 * Math.log2(Math.max(1, freq) / rootFreq);
    const m = Math.floor(semi / 12);
    const remSemi = semi - 12 * m;

    for (let i = 0; i < K; i++) {
      const curr = intervals[i];
      const next = i + 1 < K ? intervals[i + 1] : 12;
      if (remSemi >= curr && remSemi <= next) {
        const frac = next > curr ? (remSemi - curr) / (next - curr) : 0;
        return m * K + i + frac;
      }
    }
    return m * K;
  }

  /**
   * Discrete note snapping (for dotted/striped strokes).
   */
  public quantizeDiscrete(y: number, canvasHeight: number): PitchResult {
    if (this._scrollEnabled) {
      return this.quantizeDiscreteWorld(this.screenToWorldY(y, canvasHeight), canvasHeight);
    }
    const u = this.normalizeY(y, canvasHeight);
    const targetFreq = ScaleQuantizer.normalizedUToFrequency(u);
    const dCont = this.frequencyToContinuousDegree(targetFreq);
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
   * Continuous pitch mode (for solid drone strokes) smoothly interpolating across modal intervals.
   */
  public quantizeContinuous(y: number, canvasHeight: number): PitchResult {
    if (this._scrollEnabled) {
      return this.quantizeContinuousWorld(this.screenToWorldY(y, canvasHeight), canvasHeight);
    }
    const u = this.normalizeY(y, canvasHeight);
    const targetFreq = ScaleQuantizer.normalizedUToFrequency(u);
    const dCont = this.frequencyToContinuousDegree(targetFreq);

    const k1 = Math.floor(dCont);
    const k2 = k1 + 1;
    const gamma = dCont - k1;

    const semi1 = this.getSemitonesForDegree(k1);
    const semi2 = this.getSemitonesForDegree(k2);

    const freq1 = this.config.root.frequency * Math.pow(2, semi1 / 12);
    const freq2 = this.config.root.frequency * Math.pow(2, semi2 / 12);

    // Compute transition blend [0, 1] across interval:
    const t = Math.max(0, Math.min(1, (gamma - 0.15) / 0.70));
    const blend = t * t * (3 - 2 * t);

    // Equal-power gains for Note 1 and Note 2:
    const g1 = Math.cos(blend * 0.5 * Math.PI);
    const g2 = Math.sin(blend * 0.5 * Math.PI);

    // Bank A is for even degrees, Bank B is for odd degrees
    const isK1Even = ((k1 % 2) + 2) % 2 === 0;
    const freqA = isK1Even ? freq1 : freq2;
    const freqB = isK1Even ? freq2 : freq1;
    const gainA = isK1Even ? g1 : g2;
    const gainB = isK1Even ? g2 : g1;

    const semitones = (1 - gamma) * semi1 + gamma * semi2;
    const frequency = this.config.root.frequency * Math.pow(2, semitones / 12);
    const noteName = getNoteNameFromSemitones(this.config.root.baseMidi, semitones);

    return {
      frequency,
      freq1,
      freq2,
      freqA,
      freqB,
      gainA,
      gainB,
      blend,
      semitones,
      scaleDegree: dCont,
      noteName,
      isSnapped: Math.abs(dCont - Math.round(dCont)) < 0.05,
    };
  }

  public quantizeContinuousWorld(worldY: number, viewportHeight: number): PitchResult {
    const worldH = this.getWorldHeight(viewportHeight);
    const u = this.normalizeY(worldY, worldH);
    const targetFreq = ScaleQuantizer.normalizedUToFrequency(u);
    const dCont = this.frequencyToContinuousDegree(targetFreq);

    const k1 = Math.floor(dCont);
    const k2 = k1 + 1;
    const gamma = dCont - k1;

    const semi1 = this.getSemitonesForDegree(k1);
    const semi2 = this.getSemitonesForDegree(k2);

    const freq1 = this.config.root.frequency * Math.pow(2, semi1 / 12);
    const freq2 = this.config.root.frequency * Math.pow(2, semi2 / 12);

    const t = Math.max(0, Math.min(1, (gamma - 0.15) / 0.70));
    const blend = t * t * (3 - 2 * t);

    const g1 = Math.cos(blend * 0.5 * Math.PI);
    const g2 = Math.sin(blend * 0.5 * Math.PI);

    const isK1Even = ((k1 % 2) + 2) % 2 === 0;
    const freqA = isK1Even ? freq1 : freq2;
    const freqB = isK1Even ? freq2 : freq1;
    const gainA = isK1Even ? g1 : g2;
    const gainB = isK1Even ? g2 : g1;

    const semitones = (1 - gamma) * semi1 + gamma * semi2;
    const frequency = this.config.root.frequency * Math.pow(2, semitones / 12);
    const noteName = getNoteNameFromSemitones(this.config.root.baseMidi, semitones);

    return {
      frequency,
      freq1,
      freq2,
      freqA,
      freqB,
      gainA,
      gainB,
      blend,
      semitones,
      scaleDegree: dCont,
      noteName,
      isSnapped: Math.abs(dCont - Math.round(dCont)) < 0.05,
    };
  }

  public quantizeDiscreteWorld(worldY: number, viewportHeight: number): PitchResult {
    const worldH = this.getWorldHeight(viewportHeight);
    const u = this.normalizeY(worldY, worldH);
    const targetFreq = ScaleQuantizer.normalizedUToFrequency(u);
    const dCont = this.frequencyToContinuousDegree(targetFreq);
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
   * Generates all guidelines across the entire [100 Hz, 8000 Hz] non-linear world spectrum.
   */
  public getAllGuidelines(viewportHeight: number): ScaleGuideline[] {
    const worldH = this.getWorldHeight(viewportHeight);
    const guidelines: ScaleGuideline[] = [];
    const K = this.config.scale.intervals.length;
    const chordDegs = this.config.chordDegrees;

    let k = -20;
    while (this.getFrequencyForDegree(k) < ScaleQuantizer.MAX_FREQ * 1.5) {
      const frequency = this.getFrequencyForDegree(k);
      if (frequency >= ScaleQuantizer.MIN_FREQ && frequency <= ScaleQuantizer.MAX_FREQ) {
        const u = ScaleQuantizer.frequencyToNormalizedU(frequency);
        const y = (1 - u) * worldH;
        const semitones = this.getSemitonesForDegree(k);
        const noteName = getNoteNameFromSemitones(this.config.root.baseMidi, semitones);
        const degInScale = ((k % K) + K) % K;
        const isRoot = degInScale === 0;
        const isChordTone = chordDegs !== undefined ? chordDegs.includes(degInScale) : isRoot;

        guidelines.push({
          y,
          screenY: y - this._scrollY,
          scaleDegree: k,
          noteName,
          frequency,
          isRoot,
          isChordTone,
        });
      }
      k++;
    }

    return guidelines;
  }

  /**
   * Generates guidelines that are visible within the current viewport window.
   */
  public getVisibleGuidelines(viewportHeight: number, scrollY: number): ScaleGuideline[] {
    const all = this.getAllGuidelines(viewportHeight);
    return all
      .filter((g) => {
        const screenY = g.y - scrollY;
        return screenY >= -30 && screenY <= viewportHeight + 30;
      })
      .map((g) => ({
        ...g,
        screenY: g.y - scrollY,
      }));
  }

  /**
   * Generates canvas Y guidelines for the musical grid overlay.
   */
  public getGuidelines(canvasHeight: number): ScaleGuideline[] {
    if (this._scrollEnabled) {
      return this.getVisibleGuidelines(canvasHeight, this._scrollY);
    }
    return this.getAllGuidelines(canvasHeight);
  }

  /**
   * Retrieves summary frequency spectrum info for the interactive pitch navigator HUD.
   */
  public getFrequencyRangeInfo(viewportHeight: number, scrollY: number) {
    const worldHeight = this.getWorldHeight(viewportHeight);
    const maxScroll = this.getMaxScrollY(viewportHeight);

    const visibleWorldBottom = scrollY + viewportHeight;
    const visibleWorldTop = scrollY;
    const visibleWorldCenter = scrollY + viewportHeight / 2;

    const bottomPitch = this.quantizeContinuousWorld(visibleWorldBottom, viewportHeight);
    const topPitch = this.quantizeContinuousWorld(visibleWorldTop, viewportHeight);
    const centerPitch = this.quantizeContinuousWorld(visibleWorldCenter, viewportHeight);

    const scrollRatio = maxScroll > 0 ? scrollY / maxScroll : 0;
    const thumbHeightRatio = worldHeight > 0 ? Math.min(1, viewportHeight / worldHeight) : 1;

    return {
      minFreq: ScaleQuantizer.MIN_FREQ,
      maxFreq: ScaleQuantizer.MAX_FREQ,
      visibleMinFreq: bottomPitch.frequency,
      visibleMaxFreq: topPitch.frequency,
      bottomFreq: bottomPitch.frequency,
      topFreq: topPitch.frequency,
      bottomNote: bottomPitch.noteName,
      topNote: topPitch.noteName,
      centerFreq: centerPitch.frequency,
      centerNote: centerPitch.noteName,
      scrollRatio,
      thumbHeightRatio,
    };
  }
}
