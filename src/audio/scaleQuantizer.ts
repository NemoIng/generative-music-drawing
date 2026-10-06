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

  /** Total number of octaves supported across the scrollable field */
  public readonly totalFieldOctaves = 8;
  /** Octaves below the base root note (e.g. D0 and D1 below D2) */
  public readonly octavesBelowRoot = 2;
  /** Octaves above the base root note (up to D8, ~4.7 kHz) */
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
   * N_notes = O * K
   */
  public get totalNotes(): number {
    return this.config.octaveSpan * this.config.scale.intervals.length;
  }

  /**
   * Pixels per musical octave based on current viewport height and visible octave span.
   */
  public getPxPerOctave(viewportHeight: number): number {
    const visibleOctaves = Math.max(1, this.config.octaveSpan);
    return (viewportHeight > 0 ? viewportHeight : 800) / visibleOctaves;
  }

  /**
   * Total virtual height in pixels of the full 8-octave frequency world.
   */
  public getWorldHeight(viewportHeight: number): number {
    return this.totalFieldOctaves * this.getPxPerOctave(viewportHeight);
  }

  /**
   * World Y coordinate of the base root note (e.g. D2).
   */
  public getRootWorldY(viewportHeight: number): number {
    const pxPerOctave = this.getPxPerOctave(viewportHeight);
    return (this.totalFieldOctaves - this.octavesBelowRoot) * pxPerOctave;
  }

  /**
   * Default scroll offset that positions the base root note (D2) at the bottom of the viewport.
   */
  public getDefaultScrollY(viewportHeight: number): number {
    const rootWorldY = this.getRootWorldY(viewportHeight);
    return Math.max(0, rootWorldY - viewportHeight);
  }

  /**
   * Maximum scroll offset (lowest frequencies at the bottom of the world).
   */
  public getMaxScrollY(viewportHeight: number): number {
    const worldHeight = this.getWorldHeight(viewportHeight);
    return Math.max(0, worldHeight - viewportHeight);
  }

  /**
   * Clamps scroll offset within valid bounds [0, maxScrollY].
   */
  public clampScrollY(y: number, viewportHeight: number): number {
    const max = this.getMaxScrollY(viewportHeight);
    return Math.max(0, Math.min(max, y));
  }

  /**
   * Resets scroll offset to the default centered middle register (D2 to D6).
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
   */
  public quantizeDiscrete(y: number, canvasHeight: number): PitchResult {
    if (this._scrollEnabled) {
      return this.quantizeDiscreteWorld(y, canvasHeight);
    }
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
   * Continuous pitch mode (for solid drone strokes) smoothly interpolating across modal intervals.
   */
  public quantizeContinuous(y: number, canvasHeight: number): PitchResult {
    if (this._scrollEnabled) {
      return this.quantizeContinuousWorld(y, canvasHeight);
    }
    const u = this.normalizeY(y, canvasHeight);
    const dCont = this.getContinuousScaleDegree(u);

    // Interpolate semitones across modal intervals without deadband snapping
    const k1 = Math.floor(dCont);
    const k2 = k1 + 1;
    const gamma = dCont - k1;

    const semi1 = this.getSemitonesForDegree(k1);
    const semi2 = this.getSemitonesForDegree(k2);

    const freq1 = this.config.root.frequency * Math.pow(2, semi1 / 12);
    const freq2 = this.config.root.frequency * Math.pow(2, semi2 / 12);

    // Compute transition blend [0, 1] across interval:
    // When gamma <= 0.15: 100% note 1 (blend = 0)
    // When gamma >= 0.85: 100% note 2 (blend = 1)
    // In transition zone [0.15, 0.85]: smooth S-curve blend
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

  /**
   * Continuous pitch evaluation across the full 8-octave scrollable world.
   */
  public quantizeContinuousWorld(worldY: number, viewportHeight: number): PitchResult {
    const pxPerOctave = this.getPxPerOctave(viewportHeight);
    const rootWorldY = this.getRootWorldY(viewportHeight);
    const deltaOctaves = (rootWorldY - worldY) / pxPerOctave;
    const K = this.config.scale.intervals.length;
    const dCont = deltaOctaves * K;

    const k1 = Math.floor(dCont);
    const k2 = k1 + 1;
    const gamma = dCont - k1;

    const semi1 = this.getSemitonesForDegree(k1);
    const semi2 = this.getSemitonesForDegree(k2);

    const freq1 = this.config.root.frequency * Math.pow(2, semi1 / 12);
    const freq2 = this.config.root.frequency * Math.pow(2, semi2 / 12);

    // Compute transition blend [0, 1] across interval
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

  /**
   * Discrete pitch evaluation across the full 8-octave scrollable world.
   */
  public quantizeDiscreteWorld(worldY: number, viewportHeight: number): PitchResult {
    const pxPerOctave = this.getPxPerOctave(viewportHeight);
    const rootWorldY = this.getRootWorldY(viewportHeight);
    const deltaOctaves = (rootWorldY - worldY) / pxPerOctave;
    const K = this.config.scale.intervals.length;
    const dCont = deltaOctaves * K;
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
   * Generates all guidelines across the entire 8-octave world.
   */
  public getAllGuidelines(viewportHeight: number): ScaleGuideline[] {
    const pxPerOctave = this.getPxPerOctave(viewportHeight);
    const rootWorldY = this.getRootWorldY(viewportHeight);
    const K = this.config.scale.intervals.length;
    const minK = -this.octavesBelowRoot * K;
    const maxK = (this.totalFieldOctaves - this.octavesBelowRoot) * K;
    const chordDegs = this.config.chordDegrees;

    const guidelines: ScaleGuideline[] = [];
    for (let k = minK; k <= maxK; k++) {
      const deltaOctaves = k / K;
      const worldY = rootWorldY - deltaOctaves * pxPerOctave;
      const semitones = this.getSemitonesForDegree(k);
      const frequency = this.config.root.frequency * Math.pow(2, semitones / 12);
      const noteName = getNoteNameFromSemitones(this.config.root.baseMidi, semitones);
      const degInScale = ((k % K) + K) % K;
      const isRoot = degInScale === 0;
      const isChordTone = chordDegs !== undefined ? chordDegs.includes(degInScale) : isRoot;

      guidelines.push({
        y: worldY,
        screenY: worldY - this._scrollY,
        scaleDegree: k,
        noteName,
        frequency,
        isRoot,
        isChordTone,
      });
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
   * Generates canvas Y guidelines for all scale degrees to render musical grid overlay.
   */
  public getGuidelines(canvasHeight: number): ScaleGuideline[] {
    if (this._scrollEnabled) {
      return this.getVisibleGuidelines(canvasHeight, this._scrollY);
    }
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
      const degInScale = k % K;
      const isChordTone = this.config.chordDegrees !== undefined
        ? this.config.chordDegrees.includes(degInScale)
        : isRoot;

      guidelines.push({
        y,
        screenY: y,
        scaleDegree: k,
        noteName,
        frequency,
        isRoot,
        isChordTone,
      });
    }

    return guidelines;
  }

  /**
   * Retrieves summary frequency spectrum info for the interactive pitch navigator HUD.
   */
  public getFrequencyRangeInfo(viewportHeight: number, scrollY: number) {
    const worldHeight = this.getWorldHeight(viewportHeight);
    const maxScroll = this.getMaxScrollY(viewportHeight);

    // Bottom of world = lowest freq (D0)
    const minFreq = this.config.root.frequency * Math.pow(2, -this.octavesBelowRoot);
    // Top of world = highest freq (D8)
    const maxFreq = this.config.root.frequency * Math.pow(2, this.octavesAboveRoot);

    // Visible range
    const visibleWorldBottom = scrollY + viewportHeight;
    const visibleWorldTop = scrollY;
    const visibleWorldCenter = scrollY + viewportHeight / 2;

    const bottomPitch = this.quantizeContinuousWorld(visibleWorldBottom, viewportHeight);
    const topPitch = this.quantizeContinuousWorld(visibleWorldTop, viewportHeight);
    const centerPitch = this.quantizeContinuousWorld(visibleWorldCenter, viewportHeight);

    const scrollRatio = maxScroll > 0 ? scrollY / maxScroll : 0;
    const thumbHeightRatio = worldHeight > 0 ? Math.min(1, viewportHeight / worldHeight) : 1;

    return {
      minFreq,
      maxFreq,
      visibleMinFreq: bottomPitch.frequency,
      visibleMaxFreq: topPitch.frequency,
      bottomFreq: bottomPitch.frequency,
      topFreq: topPitch.frequency,
      bottomNote: bottomPitch.noteName,
      topNote: topPitch.noteName,
      centerFreq: centerPitch.frequency,
      centerNote: centerPitch.noteName,
      scrollRatio, // 0 = top (highest frequency), 1 = bottom (lowest frequency)
      thumbHeightRatio,
    };
  }
}
