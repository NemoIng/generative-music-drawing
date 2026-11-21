import { SplinePath, Point2D } from '../math/types';
import { buildArcLengthLUT } from '../math/arcLengthTable';
import { evaluateAtDistance } from '../math/arcLengthInverter';
import { evaluateBezier } from '../math/bezier';
import { generateWaveSpline, WaveParams, WaveShapeType } from '../math/waveShape';
import { ScaleQuantizer } from '../audio/scaleQuantizer';
import { SCALES, ROOT_NOTES } from '../audio/scales';
import { DroneVoice, PulseVoice, XAxisModulationMode } from '../audio/synthVoice';
import { DrumSynth } from '../audio/drumSynth';
import { resolveDrumZone, type DrumZone } from '../audio/drumMapping';
import { getInstrument, DEFAULT_INSTRUMENT } from '../audio/instruments';
import { soundEngine, SoundEngine } from '../audio/audioContext';
import { DrawnStroke, StrokeStyle, TraversalMode, TimingMode, LoopQuantizeMode, SpeedMode, HarmonizerMode, SavedComposition, MorphCurveMode, SavedStroke } from './types';
import { getHarmonizerFrequencies } from '../audio/harmony';
import { calculateBreathing, BreathingMode } from '../audio/breathing';
import { BoundedHistory, UndoAction, describeUndoAction } from './history';

export type { UndoAction } from './history';

export interface ImportCompositionOptions {
  preserveIds?: boolean;
  randomizePlayheads?: boolean;
  releaseOldVoicesTime?: number;
}

function distToSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return hash;
}

export function getStrokeWander(strokeId: string, time: number, distance: number): number {
  const h = Math.abs(hashString(strokeId));
  const phase = ((h % 1000) / 1000) * Math.PI * 2;
  const w1 = Math.sin(time * 1.6 + distance * 0.02 + phase);
  const w2 = Math.sin(time * 3.1 + distance * 0.045 + phase * 2.3);
  const w3 = Math.sin(time * 0.7 - distance * 0.01 + phase * 0.5);
  return w1 * 0.5 + w2 * 0.3 + w3 * 0.2; // [-1.0, 1.0]
}

export function getHitJitter(strokeId: string, hitIndex: number): number {
  const h = Math.abs(hashString(strokeId));
  const x = Math.sin(hitIndex * 127.1 + (h % 100) * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1; // [-1.0, 1.0]
}

export interface StrokeClipboardData {
  path: SplinePath;
  style: StrokeStyle;
  instrumentId: string;
  volume: number;
  reverb?: number;
  fluctuation?: number;
  duration?: number;
  speedMultiplier?: number;
  timingMode?: TimingMode;
  speedMode?: SpeedMode;
  loopQuantize?: LoopQuantizeMode;
  traversal?: TraversalMode;
  harmonizer?: HarmonizerMode;
  waveParams?: WaveParams;
  isPoint?: boolean;
  distortion?: number;
  filterCutoff?: number;
  lofi?: number;
  articulation?: number;
}

export class StrokeManager {
  private engine: SoundEngine;
  private strokes: DrawnStroke[] = [];
  private clipboard: StrokeClipboardData | null = null;
  private pasteCount = 0;
  private isPaused = false;
  private bpm = 100;
  private traversalMode: TraversalMode = 'restart';

  /** Optional callback fired when a stroke playhead hits a note, drum trigger, or bounces */
  public onTriggerSpark?: (x: number, y: number, color: string, count?: number, instrumentId?: string) => void;
  /** Optional callback fired when the master clock crosses a 4-beat bar boundary */
  public onBarBoundary?: () => void;
  /** Optional MIDI hooks */
  public onMidiPulse?: (event: {
    strokeId: string;
    instrumentId: string;
    frequency: number;
    velocity: number;
    articulation: number;
    isDrum: boolean;
    drumZone?: DrumZone;
    tomFreq?: number;
    isStriped: boolean;
  }) => void;
  public onMidiDroneUpdate?: (event: {
    strokeId: string;
    instrumentId: string;
    frequency: number;
    velocity: number;
    normX: number;
    curvature: number;
    filterCutoff: number;
  }) => void;
  public onMidiDroneStop?: (strokeId: string) => void;

  private _sceneVersion = 0;
  private _swing = 0.0;
  private strokeSwingParity = new Map<string, number>();
  private _quantizedTriggering = false;
  private pendingMuteIds = new Set<string>();
  private xModMode: XAxisModulationMode = 'panAndTone';
  private quantizeMode: LoopQuantizeMode = '2bars';
  private defaultHarmonizer: HarmonizerMode = 'single';
  private breathingMode: BreathingMode = 'gentle';
  private selectedId: string | null = null;
  private selectedIds: Set<string> = new Set();
  private hoveredId: string | null = null;
  private masterClockTime = 0;
  private lastCanvasWidth = 1200;

  // History stacks
  private history = new BoundedHistory<UndoAction>(150);

  constructor(engine: SoundEngine = soundEngine) {
    this.engine = engine;
  }

  /** Constant pixel distance representing one quarter-note beat */
  public static readonly BEAT_DISTANCE = 80;

  /** Calculates total beats per cycle for loop quantization (1bar = 4, 2bars = 8, 4bars = 16, 8bars = 32) */
  public static getBeatsForQuantize(mode: LoopQuantizeMode): number {
    switch (mode) {
      case '1bar': return 4;
      case '2bars': return 8;
      case '4bars': return 16;
      case '8bars': return 32;
      default: return 8;
    }
  }

  private defaultSpeedMultiplier = 1.0;
  private defaultSpeedMode: SpeedMode = 'speed';
  private defaultDuration = 30;
  private defaultReverb = 0.4;
  private defaultFluctuation = 0.0;
  private sceneMorphGain = 1.0;
  public isCrossfadingMorph = false;
  private morphOutgoingGain = 1.0;
  private morphIncomingGain = 0.0;
  private morphCurveMode: MorphCurveMode = 'equalPower';
  private morphTargetSceneId: string | null = null;
  private morphIncomingQuantizer: ScaleQuantizer | null = null;

  public get morphGains(): { outgoing: number; incoming: number } {
    return { outgoing: this.morphOutgoingGain, incoming: this.morphIncomingGain };
  }

  public get defaultStrokeHarmonizer(): HarmonizerMode {
    return this.defaultHarmonizer;
  }

  public setDefaultStrokeHarmonizer(h: HarmonizerMode): void {
    this.defaultHarmonizer = h;
  }

  public get currentBreathingMode(): BreathingMode {
    return this.breathingMode;
  }

  public setBreathingMode(mode: BreathingMode): void {
    this.breathingMode = mode;
  }

  public get defaultStrokeDuration(): number {
    return this.defaultDuration;
  }

  public setDefaultDuration(d: number): void {
    this.defaultDuration = Math.max(1, Math.min(300, Math.round(d)));
  }

  public get defaultStrokeReverb(): number {
    return this.defaultReverb;
  }

  public setDefaultStrokeReverb(r: number): void {
    this.defaultReverb = Math.max(0, Math.min(1, r));
  }

  public get defaultStrokeFluctuation(): number {
    return this.defaultFluctuation;
  }

  public setDefaultStrokeFluctuation(f: number): void {
    this.defaultFluctuation = Math.max(0, Math.min(1, f));
  }

  public get defaultLoopQuantizeMode(): LoopQuantizeMode {
    return this.quantizeMode;
  }

  public get defaultSpeed(): number {
    return this.defaultSpeedMultiplier;
  }

  public setDefaultSpeedMultiplier(mult: number): void {
    this.defaultSpeedMultiplier = Math.max(0.05, Math.min(5.0, mult));
  }

  public get defaultSpeedModeSetting(): SpeedMode {
    return this.defaultSpeedMode;
  }

  public setDefaultSpeedMode(mode: SpeedMode): void {
    this.defaultSpeedMode = mode;
  }

  public get activeStrokes(): ReadonlyArray<DrawnStroke> {
    return this.strokes;
  }

  public getStroke(id: string): DrawnStroke | undefined {
    return this.strokes.find((s) => s.id === id);
  }

  /**
   * Returns active strokes sorted from up to down (ascending Y coordinate),
   * matching their physical vertical positions in the canvas field.
   * Top-most lines appear first, bottom-most lines appear last.
   */
  public getStrokesSortedByFieldY(): DrawnStroke[] {
    return [...this.strokes].sort((a, b) => {
      const yA = getStrokeVerticalCenter(a);
      const yB = getStrokeVerticalCenter(b);
      if (Math.abs(yA - yB) > 0.001) {
        return yA - yB;
      }
      return this.strokes.indexOf(a) - this.strokes.indexOf(b);
    });
  }

  public get currentBpm(): number {
    return this.bpm;
  }

  public get mode(): TraversalMode {
    return this.traversalMode;
  }

  public get xAxisModulationMode(): XAxisModulationMode {
    return this.xModMode;
  }

  public get loopQuantize(): LoopQuantizeMode {
    return this.quantizeMode;
  }

  public get selectedStrokeId(): string | null {
    return this.selectedIds.size === 1 ? Array.from(this.selectedIds)[0] : (this.selectedIds.size === 0 ? this.selectedId : null);
  }

  public get selectedStrokeIds(): string[] {
    if (this.selectedIds.size > 0) {
      return Array.from(this.selectedIds);
    }
    return this.selectedId ? [this.selectedId] : [];
  }

  public isStrokeSelected(id: string): boolean {
    return this.selectedIds.has(id) || this.selectedId === id;
  }

  public get hoveredStrokeId(): string | null {
    return this.hoveredId;
  }

  public get hasSoloedStrokes(): boolean {
    return this.strokes.some((s) => s.soloed);
  }

  public get paused(): boolean {
    return this.isPaused;
  }

  public get sceneVersion(): number {
    return this._sceneVersion;
  }

  public bumpSceneVersion(): void {
    this._sceneVersion++;
  }

  public get swing(): number {
    return this._swing;
  }

  public setSwing(val: number): void {
    this._swing = Math.max(0, Math.min(0.75, val));
  }

  public get quantizedTriggering(): boolean {
    return this._quantizedTriggering;
  }

  public setQuantizedTriggering(enabled: boolean): void {
    this._quantizedTriggering = enabled;
  }

  public getPendingMuteIds(): ReadonlySet<string> {
    return this.pendingMuteIds;
  }

  public queueToggleMute(strokeId: string): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;
    if (this._quantizedTriggering && !this.isPaused) {
      if (this.pendingMuteIds.has(strokeId)) {
        this.pendingMuteIds.delete(strokeId);
      } else {
        this.pendingMuteIds.add(strokeId);
      }
      this.bumpSceneVersion();
      return true;
    }
    this.toggleMute(strokeId);
    return false;
  }

  public get canUndo(): boolean {
    return this.history.canUndo();
  }

  public get canRedo(): boolean {
    return this.history.canRedo();
  }

  public get undoCount(): number {
    return this.history.undoSize;
  }

  public get redoCount(): number {
    return this.history.redoSize;
  }

  public get lastUndoLabel(): string | null {
    const top = this.history.peekUndo();
    return top ? describeUndoAction(top) : null;
  }

  public get lastRedoLabel(): string | null {
    const top = this.history.peekRedo();
    return top ? describeUndoAction(top) : null;
  }

  public clearHistory(): void {
    this.history.clear();
  }

  public get sceneMorphVolumeGain(): number {
    return this.sceneMorphGain;
  }

  public setSceneMorphVolumeGain(val: number): void {
    this.sceneMorphGain = Math.max(0, Math.min(1, val));
  }

  /** Elapsed clock time in seconds */
  public get clockTime(): number {
    return this.masterClockTime;
  }

  /** Current musical beat in elapsed time */
  public get currentBeat(): number {
    return this.masterClockTime * (this.bpm / 60);
  }

  /** Current progress through 4-beat measure [0.0, 1.0) */
  public get measureProgress(): number {
    return (this.currentBeat % 4) / 4;
  }

  /** Current integer beat index (0, 1, 2, 3) */
  public get measureBeatIndex(): number {
    return Math.floor(this.currentBeat % 4);
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
    if (this.isPaused) {
      for (const stroke of this.strokes) {
        const hadVoice = !!stroke.droneVoice;
        if (stroke.droneVoice) {
          stroke.droneVoice.stop();
          stroke.droneVoice = null;
        }
        if (hadVoice || (stroke.style === 'solid' && stroke.instrumentId !== 'onyx')) {
          this.onMidiDroneStop?.(stroke.id);
        }
      }
    } else {
      for (const stroke of this.strokes) {
        if (stroke.style === 'solid' && stroke.playhead.lastPitch) {
          if (!stroke.droneVoice || !stroke.droneVoice.isPlaying) {
            this.startStrokeDroneVoice(stroke, stroke.playhead.lastPitch.frequency);
          }
        }
      }
    }
  }

  public setBpm(bpm: number): void {
    this.bpm = Math.max(10, Math.min(240, bpm));
  }

  public setTraversalMode(mode: TraversalMode): void {
    this.traversalMode = mode;
  }

  public setXAxisModulationMode(mode: XAxisModulationMode): void {
    this.xModMode = mode;
  }

  public setLoopQuantizeMode(mode: LoopQuantizeMode): void {
    this.quantizeMode = mode;
  }

  public selectStroke(id: string | null): void {
    this.selectedIds.clear();
    if (id) {
      this.selectedIds.add(id);
      this.selectedId = id;
    } else {
      this.selectedId = null;
    }
    for (const stroke of this.strokes) {
      stroke.selected = stroke.id === id;
    }
    this._sceneVersion++;
  }

  public toggleSelectStroke(id: string): void {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this.selectedId = this.selectedIds.size === 1 ? Array.from(this.selectedIds)[0] : null;
    for (const stroke of this.strokes) {
      stroke.selected = this.selectedIds.has(stroke.id);
    }
    this._sceneVersion++;
  }

  public selectAllStrokes(): void {
    this.selectedIds.clear();
    for (const stroke of this.strokes) {
      this.selectedIds.add(stroke.id);
      stroke.selected = true;
    }
    this.selectedId = this.selectedIds.size === 1 ? Array.from(this.selectedIds)[0] : null;
    this._sceneVersion++;
  }

  public selectMultipleStrokes(ids: string[]): void {
    this.selectedIds = new Set(ids);
    this.selectedId = this.selectedIds.size === 1 ? ids[0] : null;
    for (const stroke of this.strokes) {
      stroke.selected = this.selectedIds.has(stroke.id);
    }
    this._sceneVersion++;
  }

  /**
   * Selects multiple active stroke IDs simultaneously while validating existence.
   */
  public selectStrokes(ids: string[]): void {
    const validIds = ids.filter((id) => this.strokes.some((s) => s.id === id));
    this.selectMultipleStrokes(validIds);
  }

  public setHoveredStroke(id: string | null): void {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    for (const stroke of this.strokes) {
      stroke.hovered = stroke.id === id;
    }
    this._sceneVersion++;
  }

  private removeFromSelection(id: string): void {
    this.selectedIds.delete(id);
    if (this.selectedId === id) {
      this.selectedId = this.selectedIds.size === 1 ? Array.from(this.selectedIds)[0] : null;
    }
  }

  private startStrokeDroneVoice(
    stroke: DrawnStroke,
    freq: number,
    audioTime?: number,
    volumeOverride?: number
  ): void {
    if (
      this.isPaused ||
      !this.engine.isReady ||
      !this.isStrokeAudible(stroke) ||
      stroke.style !== 'solid' ||
      stroke.instrumentId === 'onyx'
    ) {
      return;
    }
    if (stroke.droneVoice) {
      stroke.droneVoice.stop();
      stroke.droneVoice = null;
    }
    const instrument = getInstrument(stroke.instrumentId);
    const effectiveVol =
      volumeOverride !== undefined
        ? volumeOverride
        : (stroke.volume ?? 1.0) * (stroke.morphGain ?? 1.0);
    const voice = new DroneVoice(this.engine);
    voice.start(
      freq,
      instrument,
      effectiveVol,
      stroke.reverb ?? this.defaultReverb,
      audioTime,
      stroke.distortion ?? 0,
      stroke.filterCutoff ?? 1.0,
      stroke.lofi ?? 0
    );
    const voiceWithHarmonizer = voice as DroneVoice & { setHarmonizer?: (mode: HarmonizerMode) => void };
    if (typeof voiceWithHarmonizer.setHarmonizer === 'function') {
      voiceWithHarmonizer.setHarmonizer(stroke.harmonizer ?? 'single');
    }
    (voice as DroneVoice & { setArticulation?: (v: number) => void }).setArticulation?.(stroke.articulation ?? 1.0);
    stroke.droneVoice = voice;
  }

  public isStrokeAudible(stroke: DrawnStroke): boolean {
    if (stroke.muted) return false;
    const hasSolo = this.strokes.some((s) => s.soloed);
    if (hasSolo && !stroke.soloed) return false;
    return true;
  }

  public toggleMute(strokeId: string): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;
    stroke.muted = !stroke.muted;

    if (!this.isStrokeAudible(stroke)) {
      const hadVoice = !!stroke.droneVoice;
      if (stroke.droneVoice) {
        stroke.droneVoice.stop();
        stroke.droneVoice = null;
      }
      if (hadVoice || stroke.style === 'solid') {
        this.onMidiDroneStop?.(stroke.id);
      }
    } else if (this.isStrokeAudible(stroke) && stroke.style === 'solid' && stroke.playhead.lastPitch) {
      if (!stroke.droneVoice || !stroke.droneVoice.isPlaying) {
        this.startStrokeDroneVoice(stroke, stroke.playhead.lastPitch.frequency);
      }
    }
    this._sceneVersion++;
    return stroke.muted ?? false;
  }

  public setStrokeMuted(strokeId: string, muted: boolean): void {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return;
    stroke.muted = muted;

    if (!this.isStrokeAudible(stroke)) {
      const hadVoice = !!stroke.droneVoice;
      if (stroke.droneVoice) {
        stroke.droneVoice.stop();
        stroke.droneVoice = null;
      }
      if (hadVoice || stroke.style === 'solid') {
        this.onMidiDroneStop?.(stroke.id);
      }
    } else if (this.isStrokeAudible(stroke) && stroke.style === 'solid' && stroke.playhead.lastPitch) {
      if (!stroke.droneVoice || !stroke.droneVoice.isPlaying) {
        this.startStrokeDroneVoice(stroke, stroke.playhead.lastPitch.frequency);
      }
    }
    this._sceneVersion++;
  }

  public toggleSolo(strokeId: string): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;
    stroke.soloed = !stroke.soloed;

    // Refresh audio voices for all strokes
    for (const s of this.strokes) {
      const audible = this.isStrokeAudible(s);
      if (!audible) {
        const hadVoice = !!s.droneVoice;
        if (s.droneVoice) {
          s.droneVoice.stop();
          s.droneVoice = null;
        }
        if (hadVoice || s.style === 'solid') {
          this.onMidiDroneStop?.(s.id);
        }
      } else if (audible && s.style === 'solid' && (!s.droneVoice || !s.droneVoice.isPlaying) && s.playhead.lastPitch) {
        this.startStrokeDroneVoice(s, s.playhead.lastPitch.frequency);
      }
    }
    this._sceneVersion++;
    return stroke.soloed ?? false;
  }

  public addStroke(
    path: SplinePath,
    style: StrokeStyle,
    instrumentId: string = DEFAULT_INSTRUMENT.id,
    baseVelocity: number = 140,
    quantizer?: ScaleQuantizer,
    canvasHeight?: number,
    volume: number = 1.0,
    loopQuantize?: LoopQuantizeMode,
    traversal?: TraversalMode,
    duration?: number,
    speedMultiplier?: number,
    speedMode?: SpeedMode,
    reverb?: number,
    fluctuation?: number,
    timingMode?: TimingMode,
    harmonizer?: HarmonizerMode,
    recordUndo = true,
    isPoint = false,
    distortion = 0.0,
    filterCutoff = 1.0,
    lofi = 0.0,
    muted: boolean = false,
    fixedId?: string,
    startVolumeOverride?: number,
    articulation: number = 1.0
  ): DrawnStroke {
    const lut = buildArcLengthLUT(path, 64);
    const id = fixedId ?? `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const instrument = getInstrument(instrumentId);
    const strokeVolume = Math.max(0, Math.min(1, volume));
    const strokeReverb = typeof reverb === 'number' ? Math.max(0, Math.min(1, reverb)) : this.defaultReverb;
    const strokeFluctuation = typeof fluctuation === 'number' ? Math.max(0, Math.min(1, fluctuation)) : this.defaultFluctuation;
    const strokeDistortion = typeof distortion === 'number' ? Math.max(0, Math.min(1, distortion)) : 0.0;
    const strokeFilterCutoff = typeof filterCutoff === 'number' ? Math.max(0, Math.min(1, filterCutoff)) : 1.0;
    const strokeLofi = typeof lofi === 'number' ? Math.max(0, Math.min(1, lofi)) : 0.0;
    const strokeArticulation = typeof articulation === 'number' ? Math.max(0.2, Math.min(2.5, articulation)) : 1.0;
    const effectiveLoopQuantize = loopQuantize ?? this.quantizeMode;
    const effectiveTraversal: TraversalMode = (traversal === 'bounce' || (traversal as string) === 'pingpong') ? 'bounce' : 'restart';
    const effectiveDuration = duration ?? this.defaultDuration;
    const effectiveSpeedMult = speedMultiplier ?? this.defaultSpeedMultiplier;
    const effectiveTimingMode: TimingMode = timingMode ?? (speedMode === 'timer' ? 'timer' : (this.defaultSpeedMode === 'timer' ? 'timer' : 'speed'));
    const effectiveSpeedMode: SpeedMode = speedMode ?? effectiveTimingMode;
    const effectiveHarmonizer: HarmonizerMode = harmonizer ?? this.defaultHarmonizer;

    let initialPitch = null;
    let initialEval = null;

    if (quantizer && canvasHeight) {
      initialEval = evaluateAtDistance(path, lut, 0, { useNewtonRaphson: true });
      initialPitch = style === 'solid'
        ? quantizer.quantizeContinuous(initialEval.point.y, canvasHeight)
        : quantizer.quantizeDiscrete(initialEval.point.y, canvasHeight);
    }

    const stroke: DrawnStroke = {
      id,
      color: instrument.color,
      instrumentId: instrument.id,
      style,
      path,
      lut,
      playhead: {
        currentDistance: 0,
        velocity: baseVelocity,
        direction: 1,
        lastTriggerDistance: 0,
        triggerDistanceAccum: 0,
        lastEval: initialEval,
        lastPitch: initialPitch,
        trail: [],
        finished: false,
      },
      droneVoice: null,
      active: true,
      selected: false,
      hovered: false,
      muted,
      soloed: false,
      volume: strokeVolume,
      reverb: strokeReverb,
      fluctuation: strokeFluctuation,
      distortion: strokeDistortion,
      filterCutoff: strokeFilterCutoff,
      lofi: strokeLofi,
      articulation: strokeArticulation,
      isPoint,
      duration: effectiveDuration,
      speedMultiplier: effectiveSpeedMult,
      timingMode: effectiveTimingMode,
      speedMode: effectiveSpeedMode,
      loopQuantize: effectiveLoopQuantize,
      traversal: effectiveTraversal,
      harmonizer: effectiveHarmonizer,
    };

    this.strokes.push(stroke);
    if (initialPitch) {
      this.startStrokeDroneVoice(stroke, initialPitch.frequency, undefined, startVolumeOverride);
    }
    this._sceneVersion++;
    if (recordUndo) {
      this.history.push({ type: 'add', stroke });
    }
    return stroke;
  }

  /**
   * Sets the volume (gain multiplier) of an individual stroke with undo support.
   */
  public setStrokeVolume(strokeId: string, volume: number, recordUndo = true): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;
    const clampedVol = Math.max(0, Math.min(1, volume));
    const oldVol = stroke.volume ?? 1.0;
    if (Math.abs(oldVol - clampedVol) < 0.001) return false;

    stroke.volume = clampedVol;
    if (stroke.droneVoice) {
      stroke.droneVoice.setVolume(clampedVol);
    }
    this._sceneVersion++;

    if (recordUndo) {
      this.history.push({
        type: 'volume',
        strokeId,
        oldVolume: oldVol,
        newVolume: clampedVol,
      });
    }
    return true;
  }

  /**
   * Sets the reverb send level (0.0 to 1.0) of an individual stroke with undo support.
   */
  public setStrokeReverb(strokeId: string, reverb: number, recordUndo = true): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;
    const clampedReverb = Math.max(0, Math.min(1, Math.round(reverb * 100) / 100));
    const oldReverb = stroke.reverb ?? this.defaultReverb;
    if (Math.abs(oldReverb - clampedReverb) < 0.001) return false;

    stroke.reverb = clampedReverb;
    if (stroke.droneVoice) {
      stroke.droneVoice.setReverb(clampedReverb);
    }
    this._sceneVersion++;

    if (recordUndo) {
      this.history.push({
        type: 'reverb',
        strokeId,
        oldReverb,
        newReverb: clampedReverb,
      });
    }
    return true;
  }

  /**
   * Sets the tone fluctuation level (0.0 to 1.0) of an individual stroke with undo support.
   */
  public setStrokeFluctuation(strokeId: string, fluctuation: number, recordUndo = true): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;
    const clampedFluctuation = Math.max(0, Math.min(1, Math.round(fluctuation * 100) / 100));
    const oldFluctuation = stroke.fluctuation ?? this.defaultFluctuation;
    if (Math.abs(oldFluctuation - clampedFluctuation) < 0.001) return false;

    stroke.fluctuation = clampedFluctuation;
    this._sceneVersion++;

    if (recordUndo) {
      this.history.push({
        type: 'fluctuation',
        strokeId,
        oldFluctuation,
        newFluctuation: clampedFluctuation,
      });
    }
    return true;
  }

  /**
   * Sets the distortion overdrive level (0.0 to 1.0) of an individual stroke with undo support.
   */
  public setStrokeDistortion(strokeId: string, distortion: number, recordUndo = true): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;
    const clampedDistortion = Math.max(0, Math.min(1, Math.round(distortion * 100) / 100));
    const oldDistortion = stroke.distortion ?? 0.0;
    if (Math.abs(oldDistortion - clampedDistortion) < 0.001) return false;

    stroke.distortion = clampedDistortion;
    if (stroke.droneVoice) {
      stroke.droneVoice.setDistortion(clampedDistortion);
    }
    this._sceneVersion++;

    if (recordUndo) {
      this.history.push({
        type: 'distortion',
        strokeId,
        oldDistortion,
        newDistortion: clampedDistortion,
      });
    }
    return true;
  }

  /**
   * Sets the tone filter cutoff (0.0 warm/dark to 1.0 open/bright) of an individual stroke with undo support.
   */
  public setStrokeFilterCutoff(strokeId: string, cutoff: number, recordUndo = true): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;
    const clampedCutoff = Math.max(0, Math.min(1, Math.round(cutoff * 100) / 100));
    const oldCutoff = stroke.filterCutoff ?? 1.0;
    if (Math.abs(oldCutoff - clampedCutoff) < 0.001) return false;

    stroke.filterCutoff = clampedCutoff;
    if (stroke.droneVoice) {
      stroke.droneVoice.setFilterCutoff(clampedCutoff);
    }
    this._sceneVersion++;

    if (recordUndo) {
      this.history.push({
        type: 'filterCutoff',
        strokeId,
        oldFilterCutoff: oldCutoff,
        newFilterCutoff: clampedCutoff,
      });
    }
    return true;
  }

  /**
   * Sets the lo-fi bit-depth quantization crunch (0.0 clean to 1.0 lo-fi grit) of an individual stroke with undo support.
   */
  public setStrokeLofi(strokeId: string, lofi: number, recordUndo = true): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;
    const clampedLofi = Math.max(0, Math.min(1, Math.round(lofi * 100) / 100));
    const oldLofi = stroke.lofi ?? 0.0;
    if (Math.abs(oldLofi - clampedLofi) < 0.001) return false;

    stroke.lofi = clampedLofi;
    if (stroke.droneVoice) {
      stroke.droneVoice.setLofi(clampedLofi);
    }
    this._sceneVersion++;

    if (recordUndo) {
      this.history.push({
        type: 'lofi',
        strokeId,
        oldLofi,
        newLofi: clampedLofi,
      });
    }
    return true;
  }

  /**
   * Sets the articulation / gate decay multiplier (0.2 staccato to 2.5 legato) of an individual stroke with undo support.
   */
  public setStrokeArticulation(strokeId: string, articulation: number, recordUndo = true): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;
    const clamped = Math.max(0.2, Math.min(2.5, articulation));
    const oldArticulation = stroke.articulation ?? 1.0;
    if (Math.abs(oldArticulation - clamped) < 0.001) return false;

    stroke.articulation = clamped;
    (stroke.droneVoice as (DroneVoice & { setArticulation?: (v: number) => void }) | null)?.setArticulation?.(clamped);
    this._sceneVersion++;

    if (recordUndo) {
      this.history.push({
        type: 'articulation',
        strokeId,
        oldArticulation,
        newArticulation: clamped,
      });
    }
    return true;
  }

  /**
   * Re-voices an existing stroke with a new instrument/color.
   */
  public revoiceStroke(strokeId: string, newInstrumentId: string, recordUndo = true): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;

    const oldInstrumentId = stroke.instrumentId;
    if (oldInstrumentId === newInstrumentId) return false;

    const newInstrument = getInstrument(newInstrumentId);
    stroke.instrumentId = newInstrument.id;
    stroke.color = newInstrument.color;

    if (newInstrument.id === 'onyx') {
      const hadVoice = !!stroke.droneVoice;
      if (stroke.droneVoice) {
        stroke.droneVoice.stop();
        stroke.droneVoice = null;
      }
      if (hadVoice || stroke.style === 'solid') {
        this.onMidiDroneStop?.(stroke.id);
      }
    } else if (stroke.droneVoice) {
      stroke.droneVoice.setInstrument(newInstrument);
    }

    this._sceneVersion++;

    if (recordUndo) {
      this.history.push({ type: 'revoice', strokeId, oldInstrumentId, newInstrumentId });
    }

    return true;
  }

  /**
   * Sets the texture / stroke style (solid, dotted, striped) of an individual stroke.
   */
  public setStrokeStyle(strokeId: string, newStyle: StrokeStyle, recordUndo = true): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke || stroke.style === newStyle) return false;

    const oldStyle = stroke.style;
    stroke.style = newStyle;

    // Manage drone voice lifecycle when toggling between continuous drone and staccato pulses
    if (oldStyle === 'solid' && newStyle !== 'solid') {
      stroke.droneVoice?.stop();
      stroke.droneVoice = null;
      this.onMidiDroneStop?.(stroke.id);
    } else if (newStyle === 'solid' && oldStyle !== 'solid') {
      if (stroke.playhead.lastPitch) {
        this.startStrokeDroneVoice(stroke, stroke.playhead.lastPitch.frequency);
      }
    }

    this._sceneVersion++;

    if (recordUndo) {
      this.history.push({ type: 'style', strokeId, oldStyle, newStyle });
    }

    return true;
  }

  /**
   * Sets the loop sync mode (1bar, 2bars, 4bars, freeform) of an individual stroke.
   */
  public setStrokeLoopQuantize(strokeId: string, newLoopQuantize: LoopQuantizeMode, recordUndo = true): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;

    const oldLoopQuantize = stroke.loopQuantize ?? this.quantizeMode;
    if (oldLoopQuantize === newLoopQuantize) return false;

    stroke.loopQuantize = newLoopQuantize;
    stroke.speedMode = newLoopQuantize === 'freeform' ? 'speed' : 'bars';

    // Immediately phase-align to musical downbeat if setting to quantized mode
    if (newLoopQuantize !== 'freeform' && stroke.lut.totalLength > 1) {
      const strokeTraversal = stroke.traversal ?? 'restart';
      const isBounce = strokeTraversal === 'bounce' || strokeTraversal === 'pingpong';
      const beatsPerBar = StrokeManager.getBeatsForQuantize(newLoopQuantize);
      const cycleDuration = beatsPerBar * (60 / this.bpm);
      const cycleDistance = isBounce ? 2 * stroke.lut.totalLength : stroke.lut.totalLength;
      const strokeSpeed = stroke.lut.totalLength / cycleDuration;
      const currentCycleDist = (this.masterClockTime * strokeSpeed) % cycleDistance;

      if (isBounce) {
        if (currentCycleDist <= stroke.lut.totalLength) {
          stroke.playhead.currentDistance = currentCycleDist;
          stroke.playhead.direction = 1;
        } else {
          stroke.playhead.currentDistance = 2 * stroke.lut.totalLength - currentCycleDist;
          stroke.playhead.direction = -1;
        }
      } else {
        stroke.playhead.currentDistance = (currentCycleDist % stroke.lut.totalLength + stroke.lut.totalLength) % stroke.lut.totalLength;
        stroke.playhead.direction = 1;
      }
    }

    if (recordUndo) {
      this.history.push({ type: 'loopQuantize', strokeId, oldLoopQuantize, newLoopQuantize });
    }

    return true;
  }

  /**
   * Sets the traversal mode (restart or bounce) of an individual stroke.
   */
  public setStrokeTraversal(strokeId: string, newTraversal: TraversalMode, recordUndo = true): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;

    const normalizedNew: TraversalMode = (newTraversal === 'bounce' || (newTraversal as string) === 'pingpong') ? 'bounce' : 'restart';
    const oldTraversal: TraversalMode = (stroke.traversal === 'bounce' || (stroke.traversal as string) === 'pingpong') ? 'bounce' : 'restart';
    if (oldTraversal === normalizedNew) return false;

    stroke.traversal = normalizedNew;

    if (normalizedNew === 'restart') {
      stroke.playhead.direction = 1;
    }

    if (recordUndo) {
      this.history.push({ type: 'traversal', strokeId, oldTraversal, newTraversal: normalizedNew });
    }

    return true;
  }

  /**
   * Sets the timing mode ('speed' or 'timer') for an individual stroke.
   * Seamlessly converts speed to duration (or duration to speed) so that the playhead velocity
   * and musical traversal pace remain identical across mode switches.
   */
  public setStrokeTimingMode(
    strokeId: string,
    newTimingMode: TimingMode,
    canvasWidthOrRecordUndo?: number | boolean,
    recordUndo: boolean = true
  ): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;

    let canvasWidth: number | undefined;
    let shouldRecord = recordUndo;
    if (typeof canvasWidthOrRecordUndo === 'boolean') {
      shouldRecord = canvasWidthOrRecordUndo;
    } else if (typeof canvasWidthOrRecordUndo === 'number') {
      canvasWidth = canvasWidthOrRecordUndo;
    }

    const oldTimingMode: TimingMode = stroke.timingMode ?? (stroke.speedMode === 'timer' ? 'timer' : 'speed');
    if (oldTimingMode === newTimingMode) return false;

    const oldSpeed = stroke.speedMultiplier ?? 1.0;
    const oldDuration = stroke.duration ?? 30;

    let newSpeed = oldSpeed;
    let newDuration = oldDuration;

    const L = stroke.lut.totalLength;
    const effWidth = canvasWidth && canvasWidth > 0 ? canvasWidth : this.lastCanvasWidth;
    const normRatio = effWidth > 0 ? effWidth / 1200 : 1;
    const baseSpeed = (this.bpm / 60) * StrokeManager.BEAT_DISTANCE * normRatio;

    if (newTimingMode === 'timer' && oldTimingMode === 'speed') {
      // Speed -> Timer:
      // In Speed mode, velocity was: v = baseSpeed * oldSpeed
      // In Timer mode, velocity is: v = L / duration
      // To match velocities: duration = L / (baseSpeed * oldSpeed)
      if (L > 1 && baseSpeed > 0 && oldSpeed > 0) {
        const rawDur = L / (baseSpeed * oldSpeed);
        newDuration = Math.max(1, Math.min(300, Math.round(rawDur)));
        stroke.duration = newDuration;
      }
    } else if (newTimingMode === 'speed' && oldTimingMode === 'timer') {
      // Timer -> Speed:
      // In Timer mode, velocity was: v = L / oldDuration
      // In Speed mode, velocity is: v = baseSpeed * speedMultiplier
      // To match velocities: speedMultiplier = L / (oldDuration * baseSpeed)
      if (L > 1 && oldDuration > 0 && baseSpeed > 0) {
        const rawSpeed = L / (oldDuration * baseSpeed);
        newSpeed = Math.max(0.05, Math.min(5.0, Math.round(rawSpeed * 100) / 100));
        stroke.speedMultiplier = newSpeed;
      }
    }

    stroke.timingMode = newTimingMode;
    stroke.speedMode = newTimingMode;

    if (shouldRecord) {
      this.history.push({
        type: 'timingMode',
        strokeId,
        oldTimingMode,
        newTimingMode,
        oldSpeed,
        newSpeed,
        oldDuration,
        newDuration,
      });
    }

    return true;
  }

  /**
   * Converts all active strokes in the score to speed timing mode (BPM-synced velocity).
   * For lines previously in fixed-duration timer mode, their velocity is mapped
   * to an equivalent speed multiplier, ensuring seamless playback without abrupt jumps.
   * Returns the count of strokes converted.
   */
  public convertAllStrokesToSpeedTiming(canvasWidth?: number): number {
    const records: {
      strokeId: string;
      oldTimingMode: TimingMode;
      newTimingMode: TimingMode;
      oldSpeed?: number;
      newSpeed?: number;
      oldDuration?: number;
      newDuration?: number;
    }[] = [];

    const effWidth = canvasWidth && canvasWidth > 0 ? canvasWidth : this.lastCanvasWidth;
    const normRatio = effWidth > 0 ? effWidth / 1200 : 1;
    const baseSpeed = (this.bpm / 60) * StrokeManager.BEAT_DISTANCE * normRatio;

    for (const stroke of this.strokes) {
      const oldTimingMode: TimingMode = stroke.timingMode ?? (stroke.speedMode === 'timer' ? 'timer' : 'speed');
      const oldSpeed = stroke.speedMultiplier ?? 1.0;
      const oldDuration = stroke.duration ?? 30;

      let newSpeed = oldSpeed;
      const L = stroke.lut.totalLength;

      if (oldTimingMode === 'timer') {
        if (L > 1 && oldDuration > 0 && baseSpeed > 0) {
          const rawSpeed = L / (oldDuration * baseSpeed);
          newSpeed = Math.max(0.05, Math.min(5.0, Math.round(rawSpeed * 100) / 100));
        } else {
          newSpeed = 1.0;
        }
      }

      stroke.timingMode = 'speed';
      stroke.speedMode = 'speed';
      stroke.speedMultiplier = newSpeed;

      records.push({
        strokeId: stroke.id,
        oldTimingMode,
        newTimingMode: 'speed',
        oldSpeed,
        newSpeed,
        oldDuration,
        newDuration: stroke.duration,
      });
    }

    if (records.length > 0) {
      this.history.push({ type: 'batchTimingMode', records });
    }

    this.defaultSpeedMode = 'speed';
    return records.length;
  }

  /**
   * Sets the harmonic voicing mode ('single', 'octave', 'fifth', 'triad', 'seventh') for an individual stroke.
   */
  public setStrokeHarmonizer(strokeId: string, newHarmonizer: HarmonizerMode, recordUndo = true): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;

    const oldHarmonizer: HarmonizerMode = stroke.harmonizer ?? 'single';
    if (oldHarmonizer === newHarmonizer) return false;

    stroke.harmonizer = newHarmonizer;

    if (recordUndo) {
      this.history.push({ type: 'harmonizer', strokeId, oldHarmonizer, newHarmonizer });
    }

    return true;
  }

  /**
   * Sets the duration in seconds for timer traversal mode (1s to 300s).
   * For long drones, users can set the timer really high.
   */
  public setStrokeDuration(strokeId: string, duration: number, recordUndo = true): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;
    const clamped = Math.max(1, Math.min(300, Math.round(duration)));
    const oldDuration = stroke.duration ?? 30;
    if (Math.abs(oldDuration - clamped) < 0.1) return false;

    stroke.duration = clamped;

    if (recordUndo) {
      this.history.push({ type: 'duration', strokeId, oldDuration, newDuration: clamped });
    }

    return true;
  }

  /**
   * Positions a stroke's playhead at a normalized phase ratio [0, 1) and direction along its curve,
   * updating initial curve evaluation and pitch so staggered lines do not start in lockstep.
   */
  public setStrokePlayheadPhase(
    strokeId: string,
    phaseRatio: number,
    direction: 1 | -1 = 1,
    quantizer?: ScaleQuantizer,
    canvasHeight?: number
  ): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;
    const clampedRatio = Math.max(0, Math.min(0.999, phaseRatio));
    const L = stroke.lut.totalLength;
    const dist = L > 1 ? clampedRatio * L : 0;

    stroke.playhead.currentDistance = dist;
    stroke.playhead.lastTriggerDistance = dist;
    stroke.playhead.triggerDistanceAccum = (clampedRatio * 40) % 40;
    stroke.playhead.direction = direction;
    stroke.playhead.trail = [];

    const evalResult = evaluateAtDistance(stroke.path, stroke.lut, dist, { useNewtonRaphson: true });
    stroke.playhead.lastEval = evalResult;

    if (quantizer && canvasHeight && canvasHeight > 0) {
      const maxY = quantizer.isScrollEnabled ? quantizer.getWorldHeight(canvasHeight) : canvasHeight;
      const clampedY = Math.max(0, Math.min(maxY, evalResult.point.y));
      stroke.playhead.lastPitch = stroke.style === 'solid'
        ? quantizer.quantizeContinuous(clampedY, canvasHeight)
        : quantizer.quantizeDiscrete(clampedY, canvasHeight);
    }
    return true;
  }

  /**
   * Adjusts speed multiplier (or timer duration) for multiple strokes simultaneously with atomic undo/redo.
   * Note: for timer-mode strokes, playhead velocity is `L / duration`, so speeding up requires a negative
   * `durationDelta` and slowing down requires a positive `durationDelta`.
   */
  public adjustStrokesTiming(
    strokeIds: string[],
    speedDelta: number,
    durationDelta: number,
    recordUndo = true
  ): DrawnStroke[] {
    const records: {
      strokeId: string;
      oldSpeed: number;
      newSpeed: number;
      oldDuration: number;
      newDuration: number;
    }[] = [];
    const updated: DrawnStroke[] = [];

    for (const id of strokeIds) {
      const stroke = this.strokes.find((s) => s.id === id);
      if (!stroke) continue;
      const oldSpeed = stroke.speedMultiplier ?? 1.0;
      const oldDuration = Math.round(stroke.duration ?? 30);
      const isTimer = stroke.timingMode === 'timer' || stroke.speedMode === 'timer';

      let newSpeed = oldSpeed;
      let newDuration = oldDuration;
      if (isTimer) {
        newDuration = Math.max(1, Math.min(300, oldDuration + durationDelta));
        if (newDuration === oldDuration) continue;
        stroke.duration = newDuration;
      } else {
        newSpeed = Math.max(0.05, Math.min(5.0, Math.round((oldSpeed + speedDelta) * 100) / 100));
        if (Math.abs(newSpeed - oldSpeed) < 0.001) continue;
        stroke.speedMultiplier = newSpeed;
      }
      records.push({ strokeId: id, oldSpeed, newSpeed, oldDuration, newDuration });
      updated.push(stroke);
    }

    if (recordUndo && records.length > 0) {
      this.history.push({ type: 'batchSpeed', records });
    }
    return updated;
  }

  /**
   * Adjusts playback tempo uniformly in the same direction for all specified strokes,
   * regardless of whether each stroke uses Speed mode or Timer mode.
   * direction = +1 speeds up every line (+speedMultiplier / -duration);
   * direction = -1 slows down every line (-speedMultiplier / +duration).
   */
  public adjustStrokesTempo(
    strokeIds: string[],
    direction: 1 | -1,
    stepMultiplier = 1,
    recordUndo = true
  ): DrawnStroke[] {
    const speedDelta = direction * 0.1 * stepMultiplier;
    const durationDelta = -direction * 5 * stepMultiplier;
    return this.adjustStrokesTiming(strokeIds, speedDelta, durationDelta, recordUndo);
  }

  /**
   * Synchronizes all specified strokes to Speed mode at the exact same speed multiplier,
   * recording a single atomic batchTimingMode undo entry.
   */
  public syncStrokesToSameSpeed(
    strokeIds: string[],
    targetSpeed: number,
    recordUndo = true
  ): DrawnStroke[] {
    const clampedSpeed = Math.max(0.05, Math.min(5.0, Math.round(targetSpeed * 100) / 100));
    const records: {
      strokeId: string;
      oldTimingMode: TimingMode;
      newTimingMode: TimingMode;
      oldSpeed?: number;
      newSpeed?: number;
      oldDuration?: number;
      newDuration?: number;
    }[] = [];
    const updated: DrawnStroke[] = [];

    for (const id of strokeIds) {
      const stroke = this.strokes.find((s) => s.id === id);
      if (!stroke) continue;
      const oldTimingMode: TimingMode = stroke.timingMode ?? (stroke.speedMode === 'timer' ? 'timer' : 'speed');
      const oldSpeed = stroke.speedMultiplier ?? 1.0;
      const oldDuration = stroke.duration ?? 30;
      if (oldTimingMode === 'speed' && Math.abs(oldSpeed - clampedSpeed) < 0.001) {
        continue;
      }
      stroke.timingMode = 'speed';
      stroke.speedMode = 'speed';
      stroke.speedMultiplier = clampedSpeed;
      records.push({
        strokeId: stroke.id,
        oldTimingMode,
        newTimingMode: 'speed',
        oldSpeed,
        newSpeed: clampedSpeed,
        oldDuration,
        newDuration: stroke.duration,
      });
      updated.push(stroke);
    }

    if (updated.length > 0) {
      this._sceneVersion++;
    }
    if (recordUndo && records.length > 0) {
      this.history.push({ type: 'batchTimingMode', records });
    }
    return updated;
  }

  /**
   * Synchronizes all specified strokes to Timer mode at the exact same duration (seconds),
   * recording a single atomic batchTimingMode undo entry.
   */
  public syncStrokesToSameDuration(
    strokeIds: string[],
    targetDuration: number,
    recordUndo = true
  ): DrawnStroke[] {
    const clampedDur = Math.max(1, Math.min(300, Math.round(targetDuration)));
    const records: {
      strokeId: string;
      oldTimingMode: TimingMode;
      newTimingMode: TimingMode;
      oldSpeed?: number;
      newSpeed?: number;
      oldDuration?: number;
      newDuration?: number;
    }[] = [];
    const updated: DrawnStroke[] = [];

    for (const id of strokeIds) {
      const stroke = this.strokes.find((s) => s.id === id);
      if (!stroke) continue;
      const oldTimingMode: TimingMode = stroke.timingMode ?? (stroke.speedMode === 'timer' ? 'timer' : 'speed');
      const oldSpeed = stroke.speedMultiplier ?? 1.0;
      const oldDuration = Math.round(stroke.duration ?? 30);
      if (oldTimingMode === 'timer' && oldDuration === clampedDur) {
        continue;
      }
      stroke.timingMode = 'timer';
      stroke.speedMode = 'timer';
      stroke.duration = clampedDur;
      records.push({
        strokeId: stroke.id,
        oldTimingMode,
        newTimingMode: 'timer',
        oldSpeed,
        newSpeed: stroke.speedMultiplier,
        oldDuration,
        newDuration: clampedDur,
      });
      updated.push(stroke);
    }

    if (updated.length > 0) {
      this._sceneVersion++;
    }
    if (recordUndo && records.length > 0) {
      this.history.push({ type: 'batchTimingMode', records });
    }
    return updated;
  }

  /**
   * Commits a pre-captured atomic batch timing change (used after live slider scrubs).
   */
  public commitBatchTimingUndo(
    records: {
      strokeId: string;
      oldTimingMode: TimingMode;
      newTimingMode: TimingMode;
      oldSpeed?: number;
      newSpeed?: number;
      oldDuration?: number;
      newDuration?: number;
    }[]
  ): void {
    const changed = records.filter(
      (r) =>
        r.oldTimingMode !== r.newTimingMode ||
        r.oldSpeed !== r.newSpeed ||
        r.oldDuration !== r.newDuration
    );
    if (changed.length > 0) {
      this.history.push({ type: 'batchTimingMode', records: changed });
    }
  }

  /**
   * Adjusts gain volume for multiple strokes simultaneously with atomic undo/redo.
   */
  public adjustStrokesVolume(
    strokeIds: string[],
    volumeDelta: number,
    recordUndo = true
  ): DrawnStroke[] {
    const records: { strokeId: string; oldVolume: number; newVolume: number }[] = [];
    const updated: DrawnStroke[] = [];

    for (const id of strokeIds) {
      const stroke = this.strokes.find((s) => s.id === id);
      if (!stroke) continue;
      const oldVolume = stroke.volume ?? 1.0;
      const newVolume = Math.max(0, Math.min(1, Math.round((oldVolume + volumeDelta) * 100) / 100));
      if (Math.abs(newVolume - oldVolume) < 0.001) continue;
      stroke.volume = newVolume;
      stroke.droneVoice?.setVolume(newVolume);
      records.push({ strokeId: id, oldVolume, newVolume });
      updated.push(stroke);
    }

    if (updated.length > 0) {
      this._sceneVersion++;
    }
    if (recordUndo && records.length > 0) {
      this.history.push({ type: 'batchVolume', records });
    }
    return updated;
  }

  /**
   * Scales all stroke coordinate points by scaleX and scaleY.
   * This is called on window/canvas resize to ensure that note pitches, panning,
   * drum triggers, and relative geometry remain 100% invariant across window sizes.
   */
  public scaleStrokes(scaleX: number, scaleY: number): void {
    if (scaleX <= 0 || scaleY <= 0 || !isFinite(scaleX) || !isFinite(scaleY)) return;
    if (Math.abs(scaleX - 1) < 0.0001 && Math.abs(scaleY - 1) < 0.0001) return;

    for (const stroke of this.strokes) {
      for (const seg of stroke.path.segments) {
        seg.p0.x *= scaleX; seg.p0.y *= scaleY;
        seg.p1.x *= scaleX; seg.p1.y *= scaleY;
        seg.p2.x *= scaleX; seg.p2.y *= scaleY;
        seg.p3.x *= scaleX; seg.p3.y *= scaleY;
      }

      if (stroke.waveParams) {
        stroke.waveParams.baseP0.x *= scaleX;
        stroke.waveParams.baseP0.y *= scaleY;
        stroke.waveParams.baseP1.x *= scaleX;
        stroke.waveParams.baseP1.y *= scaleY;
        stroke.waveParams.amplitude *= scaleY;
      }

      const oldLength = stroke.lut.totalLength;
      stroke.lut = buildArcLengthLUT(stroke.path, 64);
      const newLength = stroke.lut.totalLength;

      if (oldLength > 0 && newLength > 0) {
        stroke.playhead.currentDistance *= (newLength / oldLength);
      }
    }
    this._sceneVersion++;
  }

  /**
   * Sets the speed multiplier (0.1x to 4.0x) for an individual stroke.
   */
  public setStrokeSpeed(strokeId: string, speedMultiplier: number, recordUndo = true): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;
    const clamped = Math.max(0.05, Math.min(5.0, Math.round(speedMultiplier * 100) / 100));
    const oldSpeed = stroke.speedMultiplier ?? 1.0;
    if (Math.abs(oldSpeed - clamped) < 0.001) return false;

    stroke.speedMultiplier = clamped;
    stroke.speedMode = 'speed';

    if (recordUndo) {
      this.history.push({ type: 'speed', strokeId, oldSpeed, newSpeed: clamped });
    }
    return true;
  }

  /**
   * Toggles an individual stroke between 'speed' (constant velocity) and 'bars' (measure-locked) timing modes.
   */
  public setStrokeSpeedMode(strokeId: string, mode: SpeedMode, recordUndo = true): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;
    const oldMode = stroke.speedMode ?? 'speed';
    if (oldMode === mode) return false;

    stroke.speedMode = mode;

    if (recordUndo) {
      this.history.push({ type: 'speedMode', strokeId, oldSpeedMode: oldMode, newSpeedMode: mode });
    }
    return true;
  }

  /**
   * Translates an existing stroke by (dx, dy).
   */
  public translateStroke(id: string, dx: number, dy: number, recordUndo = false): boolean {
    const stroke = this.strokes.find((s) => s.id === id);
    if (!stroke) return false;

    for (const seg of stroke.path.segments) {
      seg.p0.x += dx;
      seg.p0.y += dy;
      seg.p1.x += dx;
      seg.p1.y += dy;
      seg.p2.x += dx;
      seg.p2.y += dy;
      seg.p3.x += dx;
      seg.p3.y += dy;
    }

    for (const pt of stroke.playhead.trail) {
      pt.x += dx;
      pt.y += dy;
    }

    if (stroke.isPoint && stroke.path.segments.length > 0) {
      stroke.playhead.lastEval = {
        point: { x: stroke.path.segments[0].p0.x, y: stroke.path.segments[0].p0.y },
        tangent: { x: 1, y: 0 },
        curvature: 0,
        segmentIndex: 0,
        t: 0,
        speed: 0,
        s: 0,
      };
    } else if (stroke.playhead.lastEval) {
      stroke.playhead.lastEval.point.x += dx;
      stroke.playhead.lastEval.point.y += dy;
    }

    if (stroke.waveParams) {
      stroke.waveParams.baseP0.x += dx;
      stroke.waveParams.baseP0.y += dy;
      stroke.waveParams.baseP1.x += dx;
      stroke.waveParams.baseP1.y += dy;
    }

    this._sceneVersion++;

    if (recordUndo) {
      this.history.push({ type: 'move', strokeId: id, dx, dy });
    }

    return true;
  }

  public recordTranslateUndo(strokeId: string, dx: number, dy: number): void {
    this.history.push({ type: 'move', strokeId, dx, dy });
  }

  public recordMultiTranslateUndo(strokeIds: string[], dx: number, dy: number): void {
    this.history.push({
      type: 'multiMove',
      moves: strokeIds.map((id) => ({ strokeId: id, dx, dy })),
    });
  }

  /**
   * Records an atomic multi-stroke addition entry (used by Assisted Drawing) so a single Undo/Redo toggles all lines together.
   */
  public recordBatchAddUndo(strokes: DrawnStroke[]): void {
    if (strokes.length === 0) return;
    this.history.push({ type: 'batchAdd', strokes: [...strokes] });
  }

  /**
   * Commits a deferred property slider change to the undo history.
   */
  public commitStrokePropertyUndo(
    id: string,
    prop:
      | 'volume'
      | 'reverb'
      | 'fluctuation'
      | 'distortion'
      | 'filterCutoff'
      | 'lofi'
      | 'articulation'
      | 'speedMultiplier'
      | 'duration',
    oldValue: number,
    newValue: number
  ): void {
    const stroke = this.strokes.find((s) => s.id === id);
    if (!stroke || Math.abs(oldValue - newValue) < 0.0001) return;

    switch (prop) {
      case 'volume':
        this.history.push({ type: 'volume', strokeId: id, oldVolume: oldValue, newVolume: newValue });
        break;
      case 'reverb':
        this.history.push({ type: 'reverb', strokeId: id, oldReverb: oldValue, newReverb: newValue });
        break;
      case 'fluctuation':
        this.history.push({ type: 'fluctuation', strokeId: id, oldFluctuation: oldValue, newFluctuation: newValue });
        break;
      case 'distortion':
        this.history.push({ type: 'distortion', strokeId: id, oldDistortion: oldValue, newDistortion: newValue });
        break;
      case 'filterCutoff':
        this.history.push({ type: 'filterCutoff', strokeId: id, oldFilterCutoff: oldValue, newFilterCutoff: newValue });
        break;
      case 'lofi':
        this.history.push({ type: 'lofi', strokeId: id, oldLofi: oldValue, newLofi: newValue });
        break;
      case 'articulation':
        this.history.push({ type: 'articulation', strokeId: id, oldArticulation: oldValue, newArticulation: newValue });
        break;
      case 'speedMultiplier':
        this.history.push({ type: 'speed', strokeId: id, oldSpeed: oldValue, newSpeed: newValue });
        break;
      case 'duration':
        this.history.push({ type: 'duration', strokeId: id, oldDuration: oldValue, newDuration: newValue });
        break;
    }
  }

  /**
   * Commits a deferred wave-reshape operation to the undo history.
   */
  public commitStrokeReshapeUndo(
    id: string,
    oldPath: SplinePath,
    newPath: SplinePath,
    oldWaveParams?: WaveParams,
    newWaveParams?: WaveParams
  ): void {
    const stroke = this.strokes.find((s) => s.id === id);
    if (!stroke) return;
    const oldLut = buildArcLengthLUT(oldPath, 64);
    const newLut = stroke.path === newPath ? stroke.lut : buildArcLengthLUT(newPath, 64);
    this.history.push({
      type: 'reshape',
      strokeId: id,
      oldPath,
      oldLut,
      oldWaveParams,
      newPath,
      newLut,
      newWaveParams,
    });
  }

  /**
   * Rescales stroke Y coordinates proportionally when octave view zoom changes,
   * guaranteeing that musical pitch / vertical position remains invariant.
   */
  public scaleMelodicStrokesY(scaleFactor: number, originY: number = 0): void {
    if (scaleFactor === 1 || !isFinite(scaleFactor) || scaleFactor <= 0) return;

    const scaledStrokes = new Set<DrawnStroke>();
    const scaledPaths = new Set<SplinePath>();
    const scaledWaveParams = new Set<WaveParams>();

    const scaleY = (y: number) => originY + (y - originY) * scaleFactor;

    const scalePathSegments = (p: SplinePath) => {
      if (scaledPaths.has(p)) return;
      scaledPaths.add(p);
      for (const seg of p.segments) {
        seg.p0.y = scaleY(seg.p0.y);
        seg.p1.y = scaleY(seg.p1.y);
        seg.p2.y = scaleY(seg.p2.y);
        seg.p3.y = scaleY(seg.p3.y);
      }
    };

    const scaleWaveParams = (wp?: WaveParams) => {
      if (!wp || scaledWaveParams.has(wp)) return;
      scaledWaveParams.add(wp);
      wp.baseP0.y = scaleY(wp.baseP0.y);
      wp.baseP1.y = scaleY(wp.baseP1.y);
      wp.amplitude *= scaleFactor;
    };

    for (const stroke of this.strokes) {
      scaledStrokes.add(stroke);
      scalePathSegments(stroke.path);

      const oldLength = stroke.lut.totalLength;
      stroke.lut = buildArcLengthLUT(stroke.path);

      if (oldLength > 0 && stroke.lut.totalLength > 0) {
        stroke.playhead.currentDistance = (stroke.playhead.currentDistance / oldLength) * stroke.lut.totalLength;
      }

      stroke.playhead.trail = [];

      if (stroke.isPoint && stroke.path.segments.length > 0) {
        stroke.playhead.lastEval = {
          point: { x: stroke.path.segments[0].p0.x, y: stroke.path.segments[0].p0.y },
          tangent: { x: 1, y: 0 },
          curvature: 0,
          segmentIndex: 0,
          t: 0,
          speed: 0,
          s: 0,
        };
      } else if (stroke.playhead.lastEval) {
        stroke.playhead.lastEval.point.y = scaleY(stroke.playhead.lastEval.point.y);
      }

      scaleWaveParams(stroke.waveParams);
    }

    if (this.clipboard) {
      scalePathSegments(this.clipboard.path);
      scaleWaveParams(this.clipboard.waveParams);
    }

    const scaleUndoAction = (action: UndoAction) => {
      if (action.type === 'move') {
        action.dy *= scaleFactor;
      } else if (action.type === 'multiMove') {
        for (const m of action.moves) {
          m.dy *= scaleFactor;
        }
      } else if (action.type === 'add' || action.type === 'remove') {
        if (!scaledStrokes.has(action.stroke)) {
          scaledStrokes.add(action.stroke);
          scalePathSegments(action.stroke.path);
          action.stroke.lut = buildArcLengthLUT(action.stroke.path);
          scaleWaveParams(action.stroke.waveParams);
        }
      } else if (action.type === 'reshape') {
        if (!scaledPaths.has(action.oldPath)) {
          scalePathSegments(action.oldPath);
          action.oldLut = buildArcLengthLUT(action.oldPath);
          scaleWaveParams(action.oldWaveParams);
        }
        if (!scaledPaths.has(action.newPath)) {
          scalePathSegments(action.newPath);
          action.newLut = buildArcLengthLUT(action.newPath);
          scaleWaveParams(action.newWaveParams);
        }
      } else if (action.type === 'redraw') {
        if (!scaledPaths.has(action.oldPath)) {
          scalePathSegments(action.oldPath);
          action.oldLut = buildArcLengthLUT(action.oldPath);
        }
        if (!scaledPaths.has(action.newPath)) {
          scalePathSegments(action.newPath);
          action.newLut = buildArcLengthLUT(action.newPath);
        }
      } else if (action.type === 'batchAdd' || action.type === 'batchRemove') {
        for (const s of action.strokes) {
          if (!scaledStrokes.has(s)) {
            scaledStrokes.add(s);
            scalePathSegments(s.path);
            s.lut = buildArcLengthLUT(s.path);
            scaleWaveParams(s.waveParams);
          }
        }
      }
    };

    this.history.forEachAction(scaleUndoAction);
    this._sceneVersion++;
  }

  /**
   * Copies the currently selected stroke (or specified stroke ID) and all its settings into the clipboard.
   */
  public copySelected(): boolean {
    if (!this.selectedId) return false;
    return this.copyStroke(this.selectedId);
  }

  public copyStroke(strokeId: string): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;

    // Deep-clone the spline path
    const clonedPath: SplinePath = {
      segments: stroke.path.segments.map((seg) => ({
        p0: { ...seg.p0 },
        p1: { ...seg.p1 },
        p2: { ...seg.p2 },
        p3: { ...seg.p3 },
      })),
      isClosed: stroke.path.isClosed,
    };

    this.clipboard = {
      path: clonedPath,
      style: stroke.style,
      instrumentId: stroke.instrumentId,
      volume: stroke.volume ?? 1.0,
      reverb: stroke.reverb ?? this.defaultReverb,
      fluctuation: stroke.fluctuation ?? this.defaultFluctuation,
      duration: stroke.duration ?? 30,
      speedMultiplier: stroke.speedMultiplier ?? this.defaultSpeedMultiplier,
      timingMode: stroke.timingMode ?? (stroke.speedMode === 'timer' ? 'timer' : 'speed'),
      speedMode: stroke.speedMode ?? this.defaultSpeedMode,
      loopQuantize: stroke.loopQuantize ?? this.quantizeMode,
      traversal: stroke.traversal ?? this.traversalMode,
      harmonizer: stroke.harmonizer ?? 'single',
      isPoint: stroke.isPoint,
      distortion: stroke.distortion ?? 0.0,
      filterCutoff: stroke.filterCutoff ?? 1.0,
      lofi: stroke.lofi ?? 0.0,
      articulation: stroke.articulation ?? 1.0,
      waveParams: stroke.waveParams
        ? {
            ...stroke.waveParams,
            baseP0: { ...stroke.waveParams.baseP0 },
            baseP1: { ...stroke.waveParams.baseP1 },
          }
        : undefined,
    };

    this.pasteCount = 0;
    return true;
  }

  public hasClipboard(): boolean {
    return this.clipboard !== null;
  }

  public getClipboard(): Readonly<StrokeClipboardData> | null {
    return this.clipboard;
  }

  /**
   * Pastes the stroke from the clipboard, translating it slightly (+24px) so it is immediately visible and distinct.
   */
  public paste(quantizer?: ScaleQuantizer, canvasHeight?: number, offsetStep: number = 24): DrawnStroke | null {
    if (!this.clipboard) return null;

    this.pasteCount++;
    const dx = offsetStep * this.pasteCount;
    const dy = offsetStep * this.pasteCount;

    const newPath: SplinePath = {
      segments: this.clipboard.path.segments.map((seg) => ({
        p0: { x: seg.p0.x + dx, y: seg.p0.y + dy },
        p1: { x: seg.p1.x + dx, y: seg.p1.y + dy },
        p2: { x: seg.p2.x + dx, y: seg.p2.y + dy },
        p3: { x: seg.p3.x + dx, y: seg.p3.y + dy },
      })),
      isClosed: this.clipboard.path.isClosed,
    };

    const newStroke = this.addStroke(
      newPath,
      this.clipboard.style,
      this.clipboard.instrumentId,
      140,
      quantizer,
      canvasHeight,
      this.clipboard.volume,
      this.clipboard.loopQuantize,
      this.clipboard.traversal,
      this.clipboard.duration,
      this.clipboard.speedMultiplier,
      this.clipboard.speedMode,
      this.clipboard.reverb,
      this.clipboard.fluctuation,
      this.clipboard.timingMode,
      this.clipboard.harmonizer,
      true,
      this.clipboard.isPoint ?? false,
      this.clipboard.distortion ?? 0.0,
      this.clipboard.filterCutoff ?? 1.0,
      this.clipboard.lofi ?? 0.0,
      false,
      undefined,
      undefined,
      this.clipboard.articulation ?? 1.0
    );

    if (this.clipboard.waveParams) {
      newStroke.waveParams = {
        ...this.clipboard.waveParams,
        baseP0: { x: this.clipboard.waveParams.baseP0.x + dx, y: this.clipboard.waveParams.baseP0.y + dy },
        baseP1: { x: this.clipboard.waveParams.baseP1.x + dx, y: this.clipboard.waveParams.baseP1.y + dy },
      };
    }

    this.selectStroke(newStroke.id);
    return newStroke;
  }

  /**
   * One-step duplicate of the selected stroke (or specified stroke ID) with all its settings.
   */
  public duplicateSelected(quantizer?: ScaleQuantizer, canvasHeight?: number, offsetStep: number = 24): DrawnStroke | null {
    if (!this.selectedId) return null;
    return this.duplicateStroke(this.selectedId, quantizer, canvasHeight, offsetStep);
  }

  public duplicateStroke(strokeId: string, quantizer?: ScaleQuantizer, canvasHeight?: number, offsetStep: number = 24): DrawnStroke | null {
    const copied = this.copyStroke(strokeId);
    if (!copied) return null;
    return this.paste(quantizer, canvasHeight, offsetStep);
  }

  /**
   * Returns all active strokes whose control points or sampled curve lie within the given rectangle.
   */
  public getStrokesInRect(rect: { x1: number; y1: number; x2: number; y2: number }): DrawnStroke[] {
    const minX = Math.min(rect.x1, rect.x2);
    const maxX = Math.max(rect.x1, rect.x2);
    const minY = Math.min(rect.y1, rect.y2);
    const maxY = Math.max(rect.y1, rect.y2);
    const inRect = (pt: Point2D): boolean =>
      pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY;

    const matched: DrawnStroke[] = [];
    for (const stroke of this.strokes) {
      if (!stroke.active) continue;
      if (stroke.isPoint) {
        if (stroke.path.segments.length > 0 && inRect(stroke.path.segments[0].p0)) {
          matched.push(stroke);
        }
        continue;
      }

      let hit = false;
      for (const seg of stroke.path.segments) {
        if (inRect(seg.p0) || inRect(seg.p1) || inRect(seg.p2) || inRect(seg.p3)) {
          hit = true;
          break;
        }
      }

      if (!hit && stroke.lut.totalLength > 0) {
        for (let i = 1; i <= 8; i++) {
          const d = (i / 9) * stroke.lut.totalLength;
          const pt = evaluateAtDistance(stroke.path, stroke.lut, d).point;
          if (inRect(pt)) {
            hit = true;
            break;
          }
        }
      }

      if (hit) {
        matched.push(stroke);
      }
    }
    return matched;
  }

  /**
   * Atomically duplicates multiple strokes shifted by (dx, dy), preserving all FX and recording a single batchAdd undo action.
   */
  public duplicateStrokes(
    strokeIds: string[],
    dx = 0,
    dy = 0,
    quantizer?: ScaleQuantizer,
    canvasHeight?: number
  ): DrawnStroke[] {
    const seen = new Set<string>();
    const sources: DrawnStroke[] = [];
    for (const id of strokeIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const found = this.strokes.find((s) => s.id === id);
      if (found) sources.push(found);
    }
    if (sources.length === 0) return [];

    const created: DrawnStroke[] = [];
    for (const src of sources) {
      const shiftedPath: SplinePath = {
        segments: src.path.segments.map((seg) => ({
          p0: { x: seg.p0.x + dx, y: seg.p0.y + dy },
          p1: { x: seg.p1.x + dx, y: seg.p1.y + dy },
          p2: { x: seg.p2.x + dx, y: seg.p2.y + dy },
          p3: { x: seg.p3.x + dx, y: seg.p3.y + dy },
        })),
        isClosed: src.path.isClosed,
      };

      const dup = this.addStroke(
        shiftedPath,
        src.style,
        src.instrumentId,
        src.playhead.velocity,
        quantizer,
        canvasHeight,
        src.volume ?? 1.0,
        src.loopQuantize,
        src.traversal,
        src.duration,
        src.speedMultiplier,
        src.speedMode,
        src.reverb,
        src.fluctuation,
        src.timingMode,
        src.harmonizer,
        false,
        src.isPoint ?? false,
        src.distortion ?? 0.0,
        src.filterCutoff ?? 1.0,
        src.lofi ?? 0.0,
        !!src.muted,
        undefined,
        undefined,
        src.articulation ?? 1.0
      );

      if (src.waveParams) {
        dup.waveParams = {
          ...src.waveParams,
          baseP0: { x: src.waveParams.baseP0.x + dx, y: src.waveParams.baseP0.y + dy },
          baseP1: { x: src.waveParams.baseP1.x + dx, y: src.waveParams.baseP1.y + dy },
        };
      }

      created.push(dup);
    }

    this.history.push({ type: 'batchAdd', strokes: [...created] });
    this.selectMultipleStrokes(created.map((s) => s.id));
    this.bumpSceneVersion();
    return created;
  }

  /**
   * Restructures an existing stroke into a smooth, mathematically exact wave curve (sine, tangent, triangle, square, sawtooth, arch).
   *
   * @param strokeId ID of the stroke to restructure
   * @param amplitude Peak wave displacement in pixels (0 = straight line)
   * @param periods Number of full wave cycles along baseline
   * @param shapeType Wave type: 'sine' | 'tangent' | 'triangle' | 'square' | 'sawtooth' | 'arch'
   * @param recordUndo Whether to record an entry in the undo stack
   */
  public restructureStrokeWave(
    strokeId: string,
    amplitude: number,
    periods: number,
    shapeType?: WaveShapeType,
    recordUndo = true
  ): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke || stroke.path.segments.length === 0) return false;

    const oldPath = stroke.path;
    const oldLut = stroke.lut;
    const oldWaveParams = stroke.waveParams;

    // Retain baseline endpoints across continuous slider adjustments
    const baseP0 = stroke.waveParams
      ? { ...stroke.waveParams.baseP0 }
      : { ...stroke.path.segments[0].p0 };
    const lastSeg = stroke.path.segments[stroke.path.segments.length - 1];
    const baseP1 = stroke.waveParams
      ? { ...stroke.waveParams.baseP1 }
      : { ...lastSeg.p3 };

    const effectiveShapeType: WaveShapeType = shapeType ?? stroke.waveParams?.shapeType ?? 'sine';

    const newWaveParams: WaveParams = {
      shapeType: effectiveShapeType,
      amplitude: Math.max(0, Math.min(150, amplitude)),
      periods: Math.max(0.5, Math.min(12, periods)),
      baseP0,
      baseP1,
    };

    const newPath = generateWaveSpline(
      baseP0,
      baseP1,
      newWaveParams.amplitude,
      newWaveParams.periods,
      effectiveShapeType
    );
    const newLut = buildArcLengthLUT(newPath, 64);

    stroke.path = newPath;
    stroke.lut = newLut;
    stroke.waveParams = newWaveParams;

    // Phase wrap current playhead distance to new total length
    if (stroke.playhead.currentDistance >= newLut.totalLength) {
      stroke.playhead.currentDistance = newLut.totalLength > 1 ? stroke.playhead.currentDistance % newLut.totalLength : 0;
    }

    this._sceneVersion++;

    if (recordUndo) {
      this.history.push({
        type: 'reshape',
        strokeId,
        oldPath,
        oldLut,
        oldWaveParams,
        newPath,
        newLut,
        newWaveParams,
      });
    }

    return true;
  }

  /**
   * Redraws an existing stroke by replacing its geometric trajectory and arc-length LUT,
   * while completely preserving its musical instrument, style, volumes, traversal, and effects.
   */
  public redrawStroke(strokeId: string, newPath: SplinePath, recordUndo = true): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;

    const oldPath = stroke.path;
    const oldLut = stroke.lut;
    const newLut = buildArcLengthLUT(newPath, 64);

    stroke.path = newPath;
    stroke.lut = newLut;
    stroke.waveParams = undefined;

    // Safely wrap/clamp playhead position
    if (stroke.playhead.currentDistance >= newLut.totalLength) {
      stroke.playhead.currentDistance = newLut.totalLength > 1 ? stroke.playhead.currentDistance % newLut.totalLength : 0;
    }

    this._sceneVersion++;

    if (recordUndo) {
      this.history.push({
        type: 'redraw',
        strokeId,
        oldPath,
        oldLut,
        newPath,
        newLut,
      });
    }

    return true;
  }

  /**
   * Continuous high-precision hit tests canvas coordinates against all strokes,
   * finding the closest stroke within tolerance across all segments.
   */
  public hitTest(point: Point2D, tolerance = 24, worldPoint?: Point2D): DrawnStroke | null {
    let bestStroke: DrawnStroke | null = null;
    let bestDist = tolerance;

    for (let sIdx = this.strokes.length - 1; sIdx >= 0; sIdx--) {
      const stroke = this.strokes[sIdx];
      const testPt = worldPoint ?? point;

      if (stroke.isPoint && stroke.path.segments.length > 0) {
        const origin = stroke.path.segments[0].p0;
        const d = Math.hypot(testPt.x - origin.x, testPt.y - origin.y);
        if (d < Math.max(bestDist, 20)) {
          bestDist = d;
          bestStroke = stroke;
        }
        continue;
      }

      const segments = stroke.path.segments;
      if (segments.length === 0) continue;

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const seg of segments) {
        if (seg.p0.x < minX) minX = seg.p0.x;
        if (seg.p0.x > maxX) maxX = seg.p0.x;
        if (seg.p0.y < minY) minY = seg.p0.y;
        if (seg.p0.y > maxY) maxY = seg.p0.y;
        if (seg.p1.x < minX) minX = seg.p1.x;
        if (seg.p1.x > maxX) maxX = seg.p1.x;
        if (seg.p1.y < minY) minY = seg.p1.y;
        if (seg.p1.y > maxY) maxY = seg.p1.y;
        if (seg.p2.x < minX) minX = seg.p2.x;
        if (seg.p2.x > maxX) maxX = seg.p2.x;
        if (seg.p2.y < minY) minY = seg.p2.y;
        if (seg.p2.y > maxY) maxY = seg.p2.y;
        if (seg.p3.x < minX) minX = seg.p3.x;
        if (seg.p3.x > maxX) maxX = seg.p3.x;
        if (seg.p3.y < minY) minY = seg.p3.y;
        if (seg.p3.y > maxY) maxY = seg.p3.y;
      }
      if (
        testPt.x < minX - bestDist ||
        testPt.x > maxX + bestDist ||
        testPt.y < minY - bestDist ||
        testPt.y > maxY + bestDist
      ) {
        continue;
      }

      for (const seg of segments) {
        let prevPt = evaluateBezier(seg, 0);
        for (let i = 1; i <= 20; i++) {
          const currPt = evaluateBezier(seg, i / 20);
          const d = distToSegment(testPt, prevPt, currPt);
          if (d < bestDist) {
            bestDist = d;
            bestStroke = stroke;
          }
          prevPt = currPt;
        }
      }
    }
    return bestStroke;
  }

  /**
   * Activates audio voices once AudioContext unlocks.
   */
  public activateAudioVoices(): void {
    if (!this.engine.isReady || this.isPaused) return;

    for (const stroke of this.strokes) {
      if (stroke.style === 'solid' && !stroke.droneVoice && stroke.playhead.lastPitch && this.isStrokeAudible(stroke)) {
        const morphMultiplier = stroke.morphRole === 'outgoing'
          ? this.morphOutgoingGain
          : stroke.morphRole === 'incoming'
          ? this.morphIncomingGain
          : this.sceneMorphGain;
        const effVol = (stroke.volume ?? 1.0) * morphMultiplier;
        this.startStrokeDroneVoice(stroke, stroke.playhead.lastPitch.frequency, undefined, effVol);
        const startedVoice = stroke.droneVoice as DroneVoice | null;
        if (startedVoice && stroke.playhead.lastEval) {
          const cWidth = this.lastCanvasWidth > 0 ? this.lastCanvasWidth : 1200;
          startedVoice.updateDual(
            stroke.playhead.lastPitch.freqA ?? stroke.playhead.lastPitch.freq1 ?? stroke.playhead.lastPitch.frequency,
            stroke.playhead.lastPitch.freqB ?? stroke.playhead.lastPitch.freq2 ?? stroke.playhead.lastPitch.frequency,
            stroke.playhead.lastPitch.gainA ?? 1.0,
            stroke.playhead.lastPitch.gainB ?? 0.0,
            stroke.playhead.lastEval.curvature,
            stroke.playhead.lastEval.point.x,
            cWidth,
            this.xModMode,
            effVol
          );
        }
      }
    }
  }

  private triggerPulse(
    freq: number,
    isStriped: boolean,
    velocity: number,
    instrument: ReturnType<typeof getInstrument>,
    x: number,
    canvasWidth: number,
    xModMode: XAxisModulationMode,
    timeOffset: number,
    reverb: number,
    filterMultiplier: number,
    volumeMultiplier: number,
    baseTime: number | undefined,
    distortion: number,
    toneCutoff: number,
    lofi: number,
    articulation: number
  ): void {
    (PulseVoice as unknown as {
      trigger: (
        freq: number,
        isStriped: boolean,
        velocity: number,
        instrument: ReturnType<typeof getInstrument>,
        x: number,
        canvasWidth: number,
        xModMode: XAxisModulationMode,
        timeOffset: number,
        reverb: number,
        filterMultiplier: number,
        volumeMultiplier: number,
        engine: SoundEngine,
        baseTime: number | undefined,
        distortion: number,
        toneCutoff: number,
        lofi: number,
        articulation: number
      ) => void;
    }).trigger(
      freq,
      isStriped,
      velocity,
      instrument,
      x,
      canvasWidth,
      xModMode,
      timeOffset,
      reverb,
      filterMultiplier,
      volumeMultiplier,
      this.engine,
      baseTime,
      distortion,
      toneCutoff,
      lofi,
      articulation
    );
  }

  private triggerRatchet(
    freq: number,
    velocity: number,
    instrument: ReturnType<typeof getInstrument>,
    x: number,
    canvasWidth: number,
    xModMode: XAxisModulationMode,
    reverb: number,
    filterMultiplier: number,
    volumeMultiplier: number,
    baseTime: number | undefined,
    distortion: number,
    toneCutoff: number,
    lofi: number,
    articulation: number
  ): void {
    (PulseVoice as unknown as {
      triggerRatchet: (
        freq: number,
        velocity: number,
        instrument: ReturnType<typeof getInstrument>,
        x: number,
        canvasWidth: number,
        xModMode: XAxisModulationMode,
        reverb: number,
        filterMultiplier: number,
        volumeMultiplier: number,
        engine: SoundEngine,
        baseTime: number | undefined,
        distortion: number,
        toneCutoff: number,
        lofi: number,
        articulation: number
      ) => void;
    }).triggerRatchet(
      freq,
      velocity,
      instrument,
      x,
      canvasWidth,
      xModMode,
      reverb,
      filterMultiplier,
      volumeMultiplier,
      this.engine,
      baseTime,
      distortion,
      toneCutoff,
      lofi,
      articulation
    );
  }

  private computeSwingDelay(strokeId: string): number {
    const parity = this.strokeSwingParity.get(strokeId) ?? 0;
    this.strokeSwingParity.set(strokeId, parity === 0 ? 1 : 0);
    if (parity === 1 && this._swing > 0.001) {
      return this._swing * Math.min(0.18, (60 / Math.max(10, this.bpm)) * 0.25);
    }
    return 0;
  }

  /**
   * Main per-frame update loop.
   */
  public update(dt: number, canvasWidth: number, canvasHeight: number, quantizer: ScaleQuantizer, scheduledTime?: number): void {
    if (canvasWidth > 0) {
      this.lastCanvasWidth = canvasWidth;
    }
    if (this.isPaused || dt <= 0) return;

    const prevClock = this.masterClockTime;
    if (scheduledTime !== undefined) {
      this.masterClockTime = scheduledTime;
    } else {
      this.masterClockTime += dt;
    }

    const barSec = (60 / Math.max(10, this.bpm)) * 4;
    const wrappedBar = Math.floor(prevClock / barSec) !== Math.floor(this.masterClockTime / barSec);
    if (wrappedBar) {
      if (this.pendingMuteIds.size > 0) {
        const pending = Array.from(this.pendingMuteIds);
        this.pendingMuteIds.clear();
        for (const id of pending) {
          this.toggleMute(id);
        }
      }
      this.onBarBoundary?.();
    }

    // Explicit audio timestamp ONLY during offline simulation; undefined in live play so Web Audio uses live currentTime
    const audioTime = scheduledTime;

    const DOT_SPACING = 40;   // 1/8th note (2 triggers per beat)
    const ROLL_SPACING = 40;  // 1/8th note roll burst interval (rapid multi-hit bursts)

    for (const stroke of this.strokes) {
      if (!stroke.active) continue;

      const L = stroke.lut.totalLength;
      if (!stroke.isPoint && L <= 1) continue;

      const ph = stroke.playhead;
      if (ph.finished) continue;

      const strokeTraversal: TraversalMode = (stroke.traversal === 'bounce' || (stroke.traversal as string) === 'pingpong') ? 'bounce' : 'restart';
      const strokeTimingMode: TimingMode = stroke.timingMode ?? (stroke.speedMode === 'timer' ? 'timer' : 'speed');
      const strokeDuration = Math.max(1, stroke.duration ?? 30);
      const strokeSpeedMult = stroke.speedMultiplier ?? 1.0;

      let strokeSpeed: number;
      if (strokeTimingMode === 'timer') {
        // Free timing controlled by timer (duration in seconds)
        // For long drones, users set the timer really high (e.g. 60s, 120s, 300s)
        strokeSpeed = L / strokeDuration;
      } else {
        // Free timing controlled by continuous velocity multiplier:
        // Proportional to canvas width normalized by 1200px reference so window size doesn't alter speed
        const normRatio = canvasWidth > 0 ? canvasWidth / 1200 : 1;
        const baseSpeed = (this.bpm / 60) * StrokeManager.BEAT_DISTANCE * normRatio;
        strokeSpeed = baseSpeed * strokeSpeedMult;
      }

      ph.velocity = strokeSpeed;
      const deltaDist = ph.direction * strokeSpeed * dt;
      const prevDist = ph.currentDistance;
      let nextDist = prevDist + deltaDist;

      // Accumulate continuous physical travel distance along the curve for rhythmic triggers
      if (!stroke.isPoint) {
        ph.triggerDistanceAccum = (ph.triggerDistanceAccum ?? 0) + strokeSpeed * dt;
      }

      // Handle curve boundary according to traversal mode (restart vs bounce)
      let didWrapOrBounce = false;
      if (stroke.isPoint) {
        // Stationary Dot / Point note: fixed on canvas, zero traversal distance
        nextDist = 0;
      } else if (stroke.lut.isClosed) {
        if (nextDist >= L || nextDist < 0) didWrapOrBounce = true;
        nextDist = ((nextDist % L) + L) % L;
      } else if (strokeTraversal === 'bounce') {
        if (nextDist >= L) {
          nextDist = Math.max(0, L - (nextDist - L));
          ph.direction = -1;
          didWrapOrBounce = true;
        } else if (nextDist <= 0) {
          nextDist = Math.min(L, -nextDist);
          ph.direction = 1;
          didWrapOrBounce = true;
        }
      } else {
        // 'restart'
        if (nextDist >= L) {
          nextDist = nextDist % L;
          didWrapOrBounce = true;
        } else if (nextDist < 0) {
          nextDist = 0;
          didWrapOrBounce = true;
        }
        ph.direction = 1;
      }

      ph.currentDistance = nextDist;

      // 1. Evaluate position with Newton-Raphson refinement (2 iterations for sub-pixel accuracy)
      const evalResult = stroke.isPoint && stroke.path.segments.length > 0
        ? {
            point: { x: stroke.path.segments[0].p0.x, y: stroke.path.segments[0].p0.y },
            tangent: { x: 1, y: 0 },
            curvature: 0,
            segmentIndex: 0,
            t: 0,
            speed: 0,
            s: 0,
          }
        : evaluateAtDistance(stroke.path, stroke.lut, nextDist, {
            useNewtonRaphson: true,
            newtonIterations: 2,
          });

      // Visual playhead dot glides directly along the geometric curve with 100% precision
      const visualPt: Point2D = evalResult.point;
      ph.lastEval = evalResult;

      // 2. Motion Trail (reset immediately on loop boundary wrap/bounce to avoid cross-screen streaks)
      if (didWrapOrBounce || stroke.isPoint) {
        ph.trail = [visualPt];
        if (strokeTraversal === 'bounce' && !stroke.isPoint && this.onTriggerSpark) {
          this.onTriggerSpark(visualPt.x, visualPt.y, stroke.color, 8, stroke.instrumentId);
        }
      } else {
        ph.trail.unshift(visualPt);
        if (ph.trail.length > 14) {
          ph.trail.pop();
        }
      }

      const strokeFluctuation = stroke.fluctuation ?? this.defaultFluctuation;
      const MAX_FLUCTUATION_OFFSET = 18; // Max pixel drift (~1 semitone / microtonal wander)
      const maxY = quantizer?.isScrollEnabled ? quantizer.getWorldHeight(canvasHeight) : canvasHeight;

      // Continuous organic wander for solid drone acoustic pitch
      const wander = (stroke.style === 'solid' && strokeFluctuation > 0)
        ? getStrokeWander(stroke.id, this.masterClockTime, nextDist) * strokeFluctuation * MAX_FLUCTUATION_OFFSET
        : 0;
      const solidEffectiveY = Math.max(0, Math.min(maxY, evalResult.point.y + wander));

      // 3. Audio & Pitch evaluation (Respecting Volume, Mute, Solo, and Loop Boundary Crossfade)
      const instrument = getInstrument(stroke.instrumentId);
      const audible = this.isStrokeAudible(stroke);
      const strokeMorphMult = stroke.morphRole === 'outgoing'
        ? this.morphOutgoingGain
        : stroke.morphRole === 'incoming'
        ? this.morphIncomingGain
        : this.sceneMorphGain;
      const strokeVol = (stroke.volume ?? 1.0) * strokeMorphMult;

      // Smooth crossfade near loop boundaries for restart mode (bypassed for stationary dots)
      let crossfadeMultiplier = 1.0;
      if (stroke.style === 'solid' && strokeTraversal === 'restart' && !stroke.lut.isClosed && !stroke.isPoint) {
        const seamMargin = Math.min(30, 0.08 * L);
        const distFromBoundary = Math.min(nextDist, L - nextDist);
        if (distFromBoundary < seamMargin) {
          crossfadeMultiplier = 0.2 + 0.8 * (distFromBoundary / seamMargin);
        }
      }
      const effectiveVol = strokeVol * crossfadeMultiplier;

      const strokeReverb = stroke.reverb ?? this.defaultReverb;

      // Option 3: Organic Timbral Breathing (Macro Filter Swells & Async Volume Ebb/Flow)
      const isTonal = stroke.instrumentId !== 'onyx';
      const breathing = isTonal
        ? calculateBreathing(this.breathingMode, this.masterClockTime, stroke.id)
        : { filterMultiplier: 1.0, volumeMultiplier: 1.0, detuneCents: 0.0 };

      // Approach 1: If stroke is a stationary solid dot, speed drives rhythmic LFO tremolo & filter breathing
      let effBreathing = breathing;
      if (stroke.isPoint && stroke.style === 'solid') {
        const effectiveMult = Math.max(0.05, strokeSpeedMult);
        const f_lfo = strokeTimingMode === 'timer'
          ? (4 / strokeDuration)
          : (this.bpm / 60) * effectiveMult;

        let dotHash = 0;
        for (let i = 0; i < stroke.id.length; i++) {
          dotHash = (dotHash * 31 + stroke.id.charCodeAt(i)) & 0x7fffffff;
        }
        const dotPhi = ((dotHash % 1000) / 1000) * Math.PI * 2;
        const tremoloWave = 0.5 * (1 + Math.sin(2 * Math.PI * f_lfo * this.masterClockTime + dotPhi));
        // Tremolo centered around unity gain (0.85x to 1.15x, average 1.0x) so dots have full volume equal to lines
        const tremoloVol = 0.85 + 0.3 * tremoloWave;
        const tremoloFilter = 0.9 + 0.25 * tremoloWave;

        effBreathing = {
          volumeMultiplier: breathing.volumeMultiplier * tremoloVol,
          filterMultiplier: breathing.filterMultiplier * tremoloFilter,
          detuneCents: breathing.detuneCents,
        };
      }

      // Determine active quantizer: incoming strokes use their scene's quantizer during crossfade
      const strokeQuantizer = (stroke.morphRole === 'incoming' && this.morphIncomingQuantizer)
        ? this.morphIncomingQuantizer
        : quantizer;

      // Update playhead swell for visual halo breathing
      ph.currentSwell = effBreathing.volumeMultiplier;

      if (stroke.style === 'solid') {
        const pitch = strokeQuantizer.quantizeContinuous(solidEffectiveY, canvasHeight);
        ph.lastPitch = pitch;

        if (audible) {
          const chord = getHarmonizerFrequencies(stroke.harmonizer, pitch.frequency, pitch.scaleDegree, strokeQuantizer);
          if ((!stroke.droneVoice || !stroke.droneVoice.isPlaying) && this.engine.isReady) {
            this.startStrokeDroneVoice(stroke, pitch.frequency, audioTime, effectiveVol);
          } else if (stroke.droneVoice) {
            stroke.droneVoice.updateDual(
              pitch.freqA ?? pitch.freq1 ?? pitch.frequency,
              pitch.freqB ?? pitch.freq2 ?? pitch.frequency,
              pitch.gainA ?? 1.0,
              pitch.gainB ?? 0.0,
              evalResult.curvature,
              evalResult.point.x,
              canvasWidth,
              this.xModMode,
              effectiveVol,
              chord.frequencies,
              chord.gains,
              effBreathing,
              audioTime
            );
          }
          if (stroke.instrumentId !== 'onyx' && this.onMidiDroneUpdate) {
            const normX = Math.max(0, Math.min(1, canvasWidth > 0 ? evalResult.point.x / canvasWidth : 0.5));
            this.onMidiDroneUpdate({
              strokeId: stroke.id,
              instrumentId: stroke.instrumentId,
              frequency: pitch.frequency,
              velocity: effectiveVol * effBreathing.volumeMultiplier,
              normX,
              curvature: evalResult.curvature,
              filterCutoff: stroke.filterCutoff ?? 1.0,
            });
          }
        } else if (stroke.droneVoice) {
          stroke.droneVoice.stop();
          stroke.droneVoice = null;
          this.onMidiDroneStop?.(stroke.id);
        }
      } else if (stroke.style === 'dotted') {
        let isTriggerHit = false;
        let hitScreenX = evalResult.point.x;
        let hitY = evalResult.point.y;

        if (stroke.isPoint) {
          // Stationary Point / Dot note: rhythmically triggered on measure beats scaled by speed
          const effectiveMult = Math.max(0.05, strokeSpeedMult);
          const beatDuration = strokeTimingMode === 'timer'
            ? Math.max(0.05, strokeDuration / 8)
            : (60 / this.bpm) / effectiveMult;
          const prevBeat = Math.floor((this.masterClockTime - dt) / beatDuration);
          const currBeat = Math.floor(this.masterClockTime / beatDuration);
          isTriggerHit = prevBeat !== currBeat && audible;
        } else {
          const dotSpacing = Math.min(DOT_SPACING, Math.max(12, L / 2));
          if ((ph.triggerDistanceAccum ?? 0) >= dotSpacing) {
            isTriggerHit = audible;
            ph.triggerDistanceAccum = (ph.triggerDistanceAccum ?? 0) % dotSpacing;
          }
        }

        const PITCH_FLUCTUATION_OFFSET = 52;
        const jitter = (isTriggerHit && strokeFluctuation > 0)
          ? getHitJitter(stroke.id, Math.floor(this.masterClockTime * 10)) * strokeFluctuation * PITCH_FLUCTUATION_OFFSET
          : 0;
        const triggerY = Math.max(0, Math.min(maxY, hitY + jitter));
        const pitch = strokeQuantizer.quantizeDiscrete(triggerY, canvasHeight);
        ph.lastPitch = pitch;

        if (isTriggerHit) {
          const swingDelaySec = this.computeSwingDelay(stroke.id);
          const strokeArticulation = stroke.articulation ?? 1.0;

          if (this.onTriggerSpark) {
            this.onTriggerSpark(hitScreenX, triggerY, stroke.color, 6, stroke.instrumentId);
          }
          if (stroke.instrumentId === 'onyx') {
            const drumGain = stroke.isPoint ? 1.05 * strokeVol : strokeVol;
            const { zone, tomFreq } = resolveDrumZone(pitch.frequency, false);
            const zoneVel = zone === 'kick' ? 0.95 : zone === 'snare' ? 0.9 : 0.85;
            switch (zone) {
              case 'kick':
                DrumSynth.triggerKick(0.95 * drumGain, hitScreenX, canvasWidth, this.xModMode, swingDelaySec, strokeReverb, this.engine, audioTime);
                break;
              case 'snare':
                DrumSynth.triggerSnare(0.9 * drumGain, hitScreenX, canvasWidth, this.xModMode, swingDelaySec, strokeReverb, this.engine, audioTime);
                break;
              case 'clap':
                DrumSynth.triggerClap(0.85 * drumGain, hitScreenX, canvasWidth, this.xModMode, swingDelaySec, strokeReverb, this.engine, audioTime);
                break;
              case 'tom':
                DrumSynth.triggerTom(tomFreq, 0.85 * drumGain, hitScreenX, canvasWidth, this.xModMode, swingDelaySec, strokeReverb, this.engine, audioTime);
                break;
              case 'hihat':
                DrumSynth.triggerHiHat(true, 0.85 * drumGain, hitScreenX, canvasWidth, this.xModMode, swingDelaySec, strokeReverb, this.engine, audioTime);
                break;
            }
            this.onMidiPulse?.({
              strokeId: stroke.id,
              instrumentId: stroke.instrumentId,
              frequency: pitch.frequency,
              velocity: zoneVel * drumGain,
              articulation: strokeArticulation,
              isDrum: true,
              drumZone: zone,
              tomFreq,
              isStriped: false,
            });
          } else {
            // Apply subtle organic microtonal detune (+/- 35 cents) for vintage acoustic tone flutter
            const microCents = strokeFluctuation > 0
              ? getHitJitter(stroke.id, Math.floor(this.masterClockTime * 10) + 47) * strokeFluctuation * 35
              : 0;
            const finalFreq = pitch.frequency * Math.pow(2, microCents / 1200);

            const chord = getHarmonizerFrequencies(stroke.harmonizer, finalFreq, pitch.scaleDegree, strokeQuantizer);
            chord.frequencies.forEach((f, idx) => {
              const strumDelay = idx * 0.016; // 16ms acoustic strum spread
              const noteVol = (stroke.isPoint ? 1.0 : 0.85) * strokeVol * (chord.gains[idx] ?? 0.8);
              this.triggerPulse(
                f,
                false,
                noteVol,
                instrument,
                hitScreenX,
                canvasWidth,
                this.xModMode,
                strumDelay + swingDelaySec,
                strokeReverb,
                effBreathing.filterMultiplier,
                effBreathing.volumeMultiplier,
                audioTime,
                stroke.distortion ?? 0.0,
                stroke.filterCutoff ?? 1.0,
                stroke.lofi ?? 0.0,
                strokeArticulation
              );
              this.onMidiPulse?.({
                strokeId: stroke.id,
                instrumentId: stroke.instrumentId,
                frequency: f,
                velocity: noteVol,
                articulation: strokeArticulation,
                isDrum: false,
                isStriped: false,
              });
            });
          }
        }
      } else if (stroke.style === 'striped') {
        let isTriggerHit = false;
        let hitScreenX = evalResult.point.x;
        let hitY = evalResult.point.y;

        if (stroke.isPoint) {
          // Stationary Point / Dot note: rhythmically triggered on quarter-beat / rolls scaled by speed
          const effectiveMult = Math.max(0.05, strokeSpeedMult);
          const rollDuration = strokeTimingMode === 'timer'
            ? Math.max(0.025, strokeDuration / 16)
            : ((60 / this.bpm) * 0.5) / effectiveMult;
          const prevBeat = Math.floor((this.masterClockTime - dt) / rollDuration);
          const currBeat = Math.floor(this.masterClockTime / rollDuration);
          isTriggerHit = prevBeat !== currBeat && audible;
        } else {
          const rollSpacing = Math.min(ROLL_SPACING, Math.max(12, L / 2));
          if ((ph.triggerDistanceAccum ?? 0) >= rollSpacing) {
            isTriggerHit = audible;
            ph.triggerDistanceAccum = (ph.triggerDistanceAccum ?? 0) % rollSpacing;
          }
        }

        const PITCH_FLUCTUATION_OFFSET = 44;
        const jitter = (isTriggerHit && strokeFluctuation > 0)
          ? getHitJitter(stroke.id, Math.floor(this.masterClockTime * 10)) * strokeFluctuation * PITCH_FLUCTUATION_OFFSET
          : 0;
        const triggerY = Math.max(0, Math.min(maxY, hitY + jitter));
        const pitch = strokeQuantizer.quantizeDiscrete(triggerY, canvasHeight);
        ph.lastPitch = pitch;

        if (isTriggerHit) {
          const swingDelaySec = this.computeSwingDelay(stroke.id);
          const strokeArticulation = stroke.articulation ?? 1.0;
          const swungBaseTime = swingDelaySec > 0
            ? (audioTime !== undefined
                ? audioTime + swingDelaySec
                : (this.engine.isReady && this.engine.context ? this.engine.context.currentTime + swingDelaySec : undefined))
            : audioTime;

          if (this.onTriggerSpark) {
            this.onTriggerSpark(hitScreenX, triggerY, stroke.color, 4, stroke.instrumentId);
          }
          if (stroke.instrumentId === 'onyx') {
            const drumGain = stroke.isPoint ? 1.05 * strokeVol : strokeVol;
            const { zone, tomFreq } = resolveDrumZone(pitch.frequency, true);
            const zoneVel = zone === 'kick' ? 0.95 : zone === 'snare' ? 0.9 : 0.85;
            DrumSynth.triggerRoll(
              zone,
              zoneVel * drumGain,
              hitScreenX,
              canvasWidth,
              this.xModMode,
              zone === 'tom' ? tomFreq : 120,
              strokeReverb,
              this.engine,
              swungBaseTime
            );
            this.onMidiPulse?.({
              strokeId: stroke.id,
              instrumentId: stroke.instrumentId,
              frequency: pitch.frequency,
              velocity: zoneVel * drumGain,
              articulation: strokeArticulation,
              isDrum: true,
              drumZone: zone,
              tomFreq: zone === 'tom' ? tomFreq : 120,
              isStriped: true,
            });
          } else {
            const microCents = strokeFluctuation > 0
              ? getHitJitter(stroke.id, Math.floor(this.masterClockTime * 10) + 59) * strokeFluctuation * 30
              : 0;
            const finalFreq = pitch.frequency * Math.pow(2, microCents / 1200);

            const chord = getHarmonizerFrequencies(stroke.harmonizer, finalFreq, pitch.scaleDegree, strokeQuantizer);
            chord.frequencies.forEach((f, idx) => {
              const noteVol = (stroke.isPoint ? 1.0 : 0.8) * strokeVol * (chord.gains[idx] ?? 0.8);
              this.triggerRatchet(
                f,
                noteVol,
                instrument,
                hitScreenX,
                canvasWidth,
                this.xModMode,
                strokeReverb,
                effBreathing.filterMultiplier,
                effBreathing.volumeMultiplier,
                swungBaseTime,
                stroke.distortion ?? 0.0,
                stroke.filterCutoff ?? 1.0,
                stroke.lofi ?? 0.0,
                strokeArticulation
              );
              this.onMidiPulse?.({
                strokeId: stroke.id,
                instrumentId: stroke.instrumentId,
                frequency: f,
                velocity: noteVol,
                articulation: strokeArticulation,
                isDrum: false,
                isStriped: true,
              });
            });
          }
        }
      }
    }
  }

  private cleanupRemovedStroke(stroke: DrawnStroke, releaseTime?: number): void {
    const hadVoice = !!stroke.droneVoice;
    if (stroke.droneVoice) {
      if (releaseTime !== undefined) {
        stroke.droneVoice.stop(releaseTime);
      } else {
        stroke.droneVoice.stop();
      }
      stroke.droneVoice = null;
    }
    if (hadVoice || stroke.style === 'solid') {
      this.onMidiDroneStop?.(stroke.id);
    }
    this.strokeSwingParity.delete(stroke.id);
    this.pendingMuteIds.delete(stroke.id);
    if (this.hoveredId === stroke.id) {
      this.hoveredId = null;
    }
  }

  public undo(): boolean {
    const action = this.history.undo();
    if (!action) return false;

    if (action.type === 'add') {
      const idx = this.strokes.findIndex((s) => s.id === action.stroke.id);
      if (idx !== -1) {
        const [removed] = this.strokes.splice(idx, 1);
        removed.selected = false;
        this.cleanupRemovedStroke(removed);
        this.removeFromSelection(removed.id);
      }
    } else if (action.type === 'batchAdd') {
      for (const s of action.strokes) {
        const idx = this.strokes.findIndex((st) => st.id === s.id);
        if (idx !== -1) {
          const [removed] = this.strokes.splice(idx, 1);
          removed.selected = false;
          this.cleanupRemovedStroke(removed);
          this.removeFromSelection(removed.id);
        }
      }
    } else if (action.type === 'remove') {
      const idx = Math.max(0, Math.min(this.strokes.length, action.index));
      this.strokes.splice(idx, 0, action.stroke);
      if (action.stroke.playhead.lastPitch) {
        this.startStrokeDroneVoice(action.stroke, action.stroke.playhead.lastPitch.frequency);
      }
    } else if (action.type === 'batchRemove') {
      for (const s of action.strokes) {
        if (!this.strokes.some((existing) => existing.id === s.id)) {
          this.strokes.push(s);
          if (s.playhead.lastPitch) {
            this.startStrokeDroneVoice(s, s.playhead.lastPitch.frequency);
          }
        }
      }
    } else if (action.type === 'move') {
      this.translateStroke(action.strokeId, -action.dx, -action.dy, false);
    } else if (action.type === 'multiMove') {
      for (const m of action.moves) {
        this.translateStroke(m.strokeId, -m.dx, -m.dy, false);
      }
    } else if (action.type === 'revoice') {
      this.revoiceStroke(action.strokeId, action.oldInstrumentId, false);
    } else if (action.type === 'volume') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.volume = action.oldVolume;
        stroke.droneVoice?.setVolume(action.oldVolume);
      }
    } else if (action.type === 'reverb') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.reverb = action.oldReverb;
        stroke.droneVoice?.setReverb(action.oldReverb);
      }
    } else if (action.type === 'fluctuation') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.fluctuation = action.oldFluctuation;
      }
    } else if (action.type === 'distortion') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.distortion = action.oldDistortion;
        stroke.droneVoice?.setDistortion(action.oldDistortion);
      }
    } else if (action.type === 'filterCutoff') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.filterCutoff = action.oldFilterCutoff;
        stroke.droneVoice?.setFilterCutoff(action.oldFilterCutoff);
      }
    } else if (action.type === 'lofi') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.lofi = action.oldLofi;
        stroke.droneVoice?.setLofi(action.oldLofi);
      }
    } else if (action.type === 'articulation') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.articulation = action.oldArticulation;
        (stroke.droneVoice as (DroneVoice & { setArticulation?: (v: number) => void }) | null)?.setArticulation?.(action.oldArticulation);
      }
    } else if (action.type === 'style') {
      this.setStrokeStyle(action.strokeId, action.oldStyle, false);
    } else if (action.type === 'loopQuantize') {
      this.setStrokeLoopQuantize(action.strokeId, action.oldLoopQuantize, false);
    } else if (action.type === 'traversal') {
      this.setStrokeTraversal(action.strokeId, action.oldTraversal, false);
    } else if (action.type === 'timingMode') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.timingMode = action.oldTimingMode;
        stroke.speedMode = action.oldTimingMode;
        if (action.oldSpeed !== undefined) stroke.speedMultiplier = action.oldSpeed;
        if (action.oldDuration !== undefined) stroke.duration = action.oldDuration;
      }
    } else if (action.type === 'batchTimingMode') {
      for (const r of action.records) {
        const stroke = this.strokes.find((s) => s.id === r.strokeId);
        if (stroke) {
          stroke.timingMode = r.oldTimingMode;
          stroke.speedMode = r.oldTimingMode;
          if (r.oldSpeed !== undefined) stroke.speedMultiplier = r.oldSpeed;
          if (r.oldDuration !== undefined) stroke.duration = r.oldDuration;
        }
      }
    } else if (action.type === 'duration') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) stroke.duration = action.oldDuration;
    } else if (action.type === 'speed') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) stroke.speedMultiplier = action.oldSpeed;
    } else if (action.type === 'speedMode') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) stroke.speedMode = action.oldSpeedMode;
    } else if (action.type === 'harmonizer') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) stroke.harmonizer = action.oldHarmonizer;
    } else if (action.type === 'reshape') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.path = action.oldPath;
        stroke.lut = action.oldLut;
        stroke.waveParams = action.oldWaveParams;
        if (stroke.playhead.currentDistance >= stroke.lut.totalLength) {
          stroke.playhead.currentDistance = stroke.lut.totalLength > 1 ? stroke.playhead.currentDistance % stroke.lut.totalLength : 0;
        }
      }
    } else if (action.type === 'redraw') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.path = action.oldPath;
        stroke.lut = action.oldLut;
        stroke.waveParams = undefined;
        if (stroke.playhead.currentDistance >= stroke.lut.totalLength) {
          stroke.playhead.currentDistance = stroke.lut.totalLength > 1 ? stroke.playhead.currentDistance % stroke.lut.totalLength : 0;
        }
      }
    } else if (action.type === 'batchSpeed') {
      for (const r of action.records) {
        const stroke = this.strokes.find((s) => s.id === r.strokeId);
        if (stroke) {
          stroke.speedMultiplier = r.oldSpeed;
          stroke.duration = r.oldDuration;
        }
      }
    } else if (action.type === 'batchVolume') {
      for (const r of action.records) {
        const stroke = this.strokes.find((s) => s.id === r.strokeId);
        if (stroke) {
          stroke.volume = r.oldVolume;
          stroke.droneVoice?.setVolume(r.oldVolume);
        }
      }
    }

    this._sceneVersion++;
    return true;
  }

  public redo(): boolean {
    const action = this.history.redo();
    if (!action) return false;

    if (action.type === 'add') {
      this.strokes.push(action.stroke);
      if (action.stroke.playhead.lastPitch) {
        this.startStrokeDroneVoice(action.stroke, action.stroke.playhead.lastPitch.frequency);
      }
    } else if (action.type === 'batchAdd') {
      for (const s of action.strokes) {
        this.strokes.push(s);
        if (s.playhead.lastPitch) {
          this.startStrokeDroneVoice(s, s.playhead.lastPitch.frequency);
        }
      }
    } else if (action.type === 'remove') {
      const idx = this.strokes.findIndex((s) => s.id === action.stroke.id);
      if (idx !== -1) {
        const [removed] = this.strokes.splice(idx, 1);
        removed.selected = false;
        this.cleanupRemovedStroke(removed);
        this.removeFromSelection(removed.id);
      }
    } else if (action.type === 'batchRemove') {
      for (const s of action.strokes) {
        const idx = this.strokes.findIndex((st) => st.id === s.id);
        if (idx !== -1) {
          const [removed] = this.strokes.splice(idx, 1);
          removed.selected = false;
          this.cleanupRemovedStroke(removed);
          this.removeFromSelection(removed.id);
        }
      }
    } else if (action.type === 'move') {
      this.translateStroke(action.strokeId, action.dx, action.dy, false);
    } else if (action.type === 'multiMove') {
      for (const m of action.moves) {
        this.translateStroke(m.strokeId, m.dx, m.dy, false);
      }
    } else if (action.type === 'revoice') {
      this.revoiceStroke(action.strokeId, action.newInstrumentId, false);
    } else if (action.type === 'volume') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.volume = action.newVolume;
        stroke.droneVoice?.setVolume(action.newVolume);
      }
    } else if (action.type === 'reverb') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.reverb = action.newReverb;
        stroke.droneVoice?.setReverb(action.newReverb);
      }
    } else if (action.type === 'fluctuation') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.fluctuation = action.newFluctuation;
      }
    } else if (action.type === 'distortion') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.distortion = action.newDistortion;
        stroke.droneVoice?.setDistortion(action.newDistortion);
      }
    } else if (action.type === 'filterCutoff') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.filterCutoff = action.newFilterCutoff;
        stroke.droneVoice?.setFilterCutoff(action.newFilterCutoff);
      }
    } else if (action.type === 'lofi') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.lofi = action.newLofi;
        stroke.droneVoice?.setLofi(action.newLofi);
      }
    } else if (action.type === 'articulation') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.articulation = action.newArticulation;
        (stroke.droneVoice as (DroneVoice & { setArticulation?: (v: number) => void }) | null)?.setArticulation?.(action.newArticulation);
      }
    } else if (action.type === 'style') {
      this.setStrokeStyle(action.strokeId, action.newStyle, false);
    } else if (action.type === 'loopQuantize') {
      this.setStrokeLoopQuantize(action.strokeId, action.newLoopQuantize, false);
    } else if (action.type === 'traversal') {
      this.setStrokeTraversal(action.strokeId, action.newTraversal, false);
    } else if (action.type === 'timingMode') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.timingMode = action.newTimingMode;
        stroke.speedMode = action.newTimingMode;
        if (action.newSpeed !== undefined) stroke.speedMultiplier = action.newSpeed;
        if (action.newDuration !== undefined) stroke.duration = action.newDuration;
      }
    } else if (action.type === 'batchTimingMode') {
      for (const r of action.records) {
        const stroke = this.strokes.find((s) => s.id === r.strokeId);
        if (stroke) {
          stroke.timingMode = r.newTimingMode;
          stroke.speedMode = r.newTimingMode;
          if (r.newSpeed !== undefined) stroke.speedMultiplier = r.newSpeed;
          if (r.newDuration !== undefined) stroke.duration = r.newDuration;
        }
      }
    } else if (action.type === 'duration') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) stroke.duration = action.newDuration;
    } else if (action.type === 'speed') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) stroke.speedMultiplier = action.newSpeed;
    } else if (action.type === 'speedMode') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) stroke.speedMode = action.newSpeedMode;
    } else if (action.type === 'harmonizer') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) stroke.harmonizer = action.newHarmonizer;
    } else if (action.type === 'reshape') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.path = action.newPath;
        stroke.lut = action.newLut;
        stroke.waveParams = action.newWaveParams;
        if (stroke.playhead.currentDistance >= stroke.lut.totalLength) {
          stroke.playhead.currentDistance = stroke.lut.totalLength > 1 ? stroke.playhead.currentDistance % stroke.lut.totalLength : 0;
        }
      }
    } else if (action.type === 'redraw') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.path = action.newPath;
        stroke.lut = action.newLut;
        stroke.waveParams = undefined;
        if (stroke.playhead.currentDistance >= stroke.lut.totalLength) {
          stroke.playhead.currentDistance = stroke.lut.totalLength > 1 ? stroke.playhead.currentDistance % stroke.lut.totalLength : 0;
        }
      }
    } else if (action.type === 'batchSpeed') {
      for (const r of action.records) {
        const stroke = this.strokes.find((s) => s.id === r.strokeId);
        if (stroke) {
          stroke.speedMultiplier = r.newSpeed;
          stroke.duration = r.newDuration;
        }
      }
    } else if (action.type === 'batchVolume') {
      for (const r of action.records) {
        const stroke = this.strokes.find((s) => s.id === r.strokeId);
        if (stroke) {
          stroke.volume = r.newVolume;
          stroke.droneVoice?.setVolume(r.newVolume);
        }
      }
    }

    this._sceneVersion++;
    return true;
  }

  public deleteSelected(): boolean {
    const ids = this.selectedIds.size > 0 ? Array.from(this.selectedIds) : (this.selectedId ? [this.selectedId] : []);
    if (ids.length === 0) return false;
    const idSet = new Set(ids);
    const removedStrokes: DrawnStroke[] = [];
    const remainingStrokes: DrawnStroke[] = [];
    for (const stroke of this.strokes) {
      if (idSet.has(stroke.id)) {
        stroke.selected = false;
        this.cleanupRemovedStroke(stroke);
        removedStrokes.push(stroke);
      } else {
        remainingStrokes.push(stroke);
      }
    }
    if (removedStrokes.length === 0) return false;
    this.strokes = remainingStrokes;
    this.history.push({ type: 'batchRemove', strokes: removedStrokes });
    this.selectedIds.clear();
    this.selectedId = null;
    this._sceneVersion++;
    return true;
  }

  public removeStroke(id: string): void {
    const idx = this.strokes.findIndex((s) => s.id === id);
    if (idx !== -1) {
      const [stroke] = this.strokes.splice(idx, 1);
      stroke.selected = false;
      this.cleanupRemovedStroke(stroke);
      this.history.push({ type: 'remove', stroke, index: idx });
      this.removeFromSelection(id);
      this._sceneVersion++;
    }
  }

  public clearAll(releaseTime: number = 0.2): void {
    for (const stroke of this.strokes) {
      this.cleanupRemovedStroke(stroke, releaseTime);
    }
    this.strokes = [];
    this.history.clear();
    this.selectedIds.clear();
    this.selectedId = null;
    this.hoveredId = null;
    this.strokeSwingParity.clear();
    this.pendingMuteIds.clear();
    this.masterClockTime = 0;
    this.isCrossfadingMorph = false;
    this.morphTargetSceneId = null;
    this.morphIncomingQuantizer = null;
    this.morphOutgoingGain = 1.0;
    this.morphIncomingGain = 0.0;
    this.sceneMorphGain = 1.0;
    this._sceneVersion++;
  }

  /**
   * Resynchronizes all active playheads to distance 0 simultaneously in locked phase.
   */
  public resyncAllPlayheads(): void {
    this.masterClockTime = 0;
    this.strokeSwingParity.clear();
    for (const stroke of this.strokes) {
      stroke.playhead.currentDistance = 0;
      stroke.playhead.direction = 1;
      stroke.playhead.lastTriggerDistance = 0;
      stroke.playhead.triggerDistanceAccum = 0;
      stroke.playhead.finished = false;
      stroke.playhead.trail = [];
      if (stroke.style === 'solid' && !stroke.droneVoice && stroke.playhead.lastPitch) {
        const strokeMorphMult = stroke.morphRole === 'outgoing'
          ? this.morphOutgoingGain
          : stroke.morphRole === 'incoming'
          ? this.morphIncomingGain
          : this.sceneMorphGain;
        this.startStrokeDroneVoice(
          stroke,
          stroke.playhead.lastPitch.frequency,
          undefined,
          (stroke.volume ?? 1.0) * strokeMorphMult
        );
      }
    }
  }

  /**
   * Randomizes the playhead positions (moving dots) of all drawn lines across their lengths,
   * creating generative polyrhythmic textures and desynchronized phase patterns.
   */
  public randomizeAllPlayheads(quantizer?: ScaleQuantizer, canvasHeight?: number): void {
    for (const stroke of this.strokes) {
      const L = stroke.lut.totalLength;
      if (L > 1) {
        stroke.playhead.currentDistance = Math.random() * L;
        stroke.playhead.lastTriggerDistance = stroke.playhead.currentDistance;
        stroke.playhead.triggerDistanceAccum = Math.random() * 40;
        stroke.playhead.finished = false;
        stroke.playhead.trail = [];

        const traversal = (stroke.traversal === 'bounce' || (stroke.traversal as string) === 'pingpong') ? 'bounce' : 'restart';
        if (traversal === 'bounce') {
          stroke.playhead.direction = Math.random() < 0.5 ? -1 : 1;
        } else {
          stroke.playhead.direction = 1;
        }

        const evalResult = evaluateAtDistance(stroke.path, stroke.lut, stroke.playhead.currentDistance, {
          useNewtonRaphson: true,
          newtonIterations: 1,
        });
        stroke.playhead.lastEval = evalResult;

        if (quantizer && canvasHeight && canvasHeight > 0) {
          const strokeQuantizer = (stroke.morphRole === 'incoming' && this.morphIncomingQuantizer)
            ? this.morphIncomingQuantizer
            : quantizer;
          const maxY = strokeQuantizer.isScrollEnabled ? strokeQuantizer.getWorldHeight(canvasHeight) : canvasHeight;
          const strokeY = Math.max(0, Math.min(maxY, evalResult.point.y));
          if (stroke.style === 'solid') {
            stroke.playhead.lastPitch = strokeQuantizer.quantizeContinuous(strokeY, canvasHeight);
          } else {
            stroke.playhead.lastPitch = strokeQuantizer.quantizeDiscrete(strokeY, canvasHeight);
          }
        }

        const strokeMorphMult = stroke.morphRole === 'outgoing'
          ? this.morphOutgoingGain
          : stroke.morphRole === 'incoming'
          ? this.morphIncomingGain
          : this.sceneMorphGain;

        if (stroke.style === 'solid' && !stroke.droneVoice && stroke.playhead.lastPitch) {
          this.startStrokeDroneVoice(
            stroke,
            stroke.playhead.lastPitch.frequency,
            undefined,
            (stroke.volume ?? 1.0) * strokeMorphMult
          );
        }

        if (stroke.droneVoice && stroke.playhead.lastPitch) {
          const cWidth = this.lastCanvasWidth > 0 ? this.lastCanvasWidth : 1200;
          stroke.droneVoice.updateDual(
            stroke.playhead.lastPitch.freqA ?? stroke.playhead.lastPitch.freq1 ?? stroke.playhead.lastPitch.frequency,
            stroke.playhead.lastPitch.freqB ?? stroke.playhead.lastPitch.freq2 ?? stroke.playhead.lastPitch.frequency,
            stroke.playhead.lastPitch.gainA ?? 1.0,
            stroke.playhead.lastPitch.gainB ?? 0.0,
            evalResult.curvature,
            evalResult.point.x,
            cWidth,
            this.xModMode,
            (stroke.volume ?? 1.0) * strokeMorphMult
          );
        }
      }
    }
  }

  /**
   * Fast forwards (+multiplier) or rewinds (-multiplier) target stroke(s) playhead distance,
   * updating geometric position, motion trail, continuous pitch, and synthesizer audio voice.
   */
  public scrubStroke(
    targetStrokeId: string | null,
    rateMultiplier: number,
    dt: number,
    canvasWidth: number,
    canvasHeight: number,
    quantizer: ScaleQuantizer
  ): void {
    if (dt <= 0 || rateMultiplier === 0) return;

    const targets = targetStrokeId
      ? this.strokes.filter((s) => s.id === targetStrokeId && s.active)
      : this.strokes.filter((s) => s.active);

    if (targets.length === 0) return;

    for (const stroke of targets) {
      const L = stroke.lut.totalLength;
      if (L <= 1) continue;

      const ph = stroke.playhead;
      const strokeTraversal: TraversalMode = (stroke.traversal === 'bounce' || (stroke.traversal as string) === 'pingpong') ? 'bounce' : 'restart';
      const strokeTimingMode: TimingMode = stroke.timingMode ?? (stroke.speedMode === 'timer' ? 'timer' : 'speed');
      const strokeDuration = Math.max(1, stroke.duration ?? 30);
      const strokeSpeedMult = stroke.speedMultiplier ?? 1.0;

      let strokeSpeed: number;
      if (strokeTimingMode === 'timer') {
        strokeSpeed = L / strokeDuration;
      } else {
        const normRatio = canvasWidth > 0 ? canvasWidth / 1200 : 1;
        const baseSpeed = (this.bpm / 60) * StrokeManager.BEAT_DISTANCE * normRatio;
        strokeSpeed = baseSpeed * strokeSpeedMult;
      }

      // Compute scrub displacement:
      const scrubDist = ph.direction * strokeSpeed * rateMultiplier * dt;
      let nextDist = ph.currentDistance + scrubDist;

      let didWrapOrBounce = false;
      if (stroke.lut.isClosed) {
        if (nextDist >= L || nextDist < 0) didWrapOrBounce = true;
        nextDist = ((nextDist % L) + L) % L;
      } else if (strokeTraversal === 'bounce') {
        if (nextDist >= L) {
          nextDist = Math.max(0, L - (nextDist - L));
          ph.direction = -1;
          didWrapOrBounce = true;
        } else if (nextDist <= 0) {
          nextDist = Math.min(L, -nextDist);
          ph.direction = 1;
          didWrapOrBounce = true;
        }
      } else {
        // 'restart'
        if (nextDist >= L) {
          nextDist = nextDist % L;
          didWrapOrBounce = true;
        } else if (nextDist < 0) {
          nextDist = ((nextDist % L) + L) % L;
          didWrapOrBounce = true;
        }
      }

      ph.currentDistance = nextDist;

      // Evaluate position with Newton-Raphson refinement
      const evalResult = evaluateAtDistance(stroke.path, stroke.lut, nextDist, {
        useNewtonRaphson: true,
        newtonIterations: 2,
      });
      ph.lastEval = evalResult;

      // Update motion trail
      if (didWrapOrBounce) {
        ph.trail = [evalResult.point];
      } else {
        ph.trail.unshift(evalResult.point);
        if (ph.trail.length > 14) {
          ph.trail.pop();
        }
      }

      // Audio & Pitch update
      const strokeQuantizer = (stroke.morphRole === 'incoming' && this.morphIncomingQuantizer)
        ? this.morphIncomingQuantizer
        : quantizer;
      const maxY = strokeQuantizer?.isScrollEnabled ? strokeQuantizer.getWorldHeight(canvasHeight) : canvasHeight;
      const strokeFluctuation = stroke.fluctuation ?? this.defaultFluctuation;
      const wander = (stroke.style === 'solid' && strokeFluctuation > 0)
        ? getStrokeWander(stroke.id, this.masterClockTime, nextDist) * strokeFluctuation * 18
        : 0;
      const solidEffectiveY = Math.max(0, Math.min(maxY, evalResult.point.y + wander));

      const instrument = getInstrument(stroke.instrumentId);
      const audible = !this.isPaused && this.isStrokeAudible(stroke);
      const strokeMorphMult = stroke.morphRole === 'outgoing'
        ? this.morphOutgoingGain
        : stroke.morphRole === 'incoming'
        ? this.morphIncomingGain
        : this.sceneMorphGain;
      const strokeVol = (stroke.volume ?? 1.0) * strokeMorphMult;
      const strokeReverb = stroke.reverb ?? this.defaultReverb;
      const isTonal = stroke.instrumentId !== 'onyx';
      const breathing = isTonal
        ? calculateBreathing(this.breathingMode, this.masterClockTime, stroke.id)
        : { filterMultiplier: 1.0, volumeMultiplier: 1.0, detuneCents: 0.0 };

      if (stroke.style === 'solid') {
        const pitch = strokeQuantizer.quantizeContinuous(solidEffectiveY, canvasHeight);
        ph.lastPitch = pitch;

        if (audible) {
          const chord = getHarmonizerFrequencies(stroke.harmonizer, pitch.frequency, pitch.scaleDegree, strokeQuantizer);
          if ((!stroke.droneVoice || !stroke.droneVoice.isPlaying) && this.engine.isReady) {
            this.startStrokeDroneVoice(stroke, pitch.frequency, undefined, strokeVol);
          } else if (stroke.droneVoice) {
            stroke.droneVoice.updateDual(
              pitch.freqA ?? pitch.freq1 ?? pitch.frequency,
              pitch.freqB ?? pitch.freq2 ?? pitch.frequency,
              pitch.gainA ?? 1.0,
              pitch.gainB ?? 0.0,
              evalResult.curvature,
              evalResult.point.x,
              canvasWidth,
              this.xModMode,
              strokeVol,
              chord.frequencies,
              chord.gains,
              breathing
            );
          }
        }
      } else if (stroke.style === 'dotted') {
        const triggerY = Math.max(0, Math.min(maxY, evalResult.point.y));
        const pitch = strokeQuantizer.quantizeDiscrete(triggerY, canvasHeight);
        ph.lastPitch = pitch;
      } else if (stroke.style === 'striped') {
        ph.triggerDistanceAccum = (ph.triggerDistanceAccum ?? 0) + Math.abs(scrubDist);
        const triggerY = Math.max(0, Math.min(maxY, evalResult.point.y));
        const pitch = strokeQuantizer.quantizeDiscrete(triggerY, canvasHeight);
        ph.lastPitch = pitch;

        const rollSpacing = Math.min(40, Math.max(12, L / 2));
        if ((ph.triggerDistanceAccum ?? 0) >= rollSpacing) {
          ph.triggerDistanceAccum = (ph.triggerDistanceAccum ?? 0) % rollSpacing;
          ph.lastTriggerDistance = nextDist;
          if (audible) {
            if (stroke.instrumentId === 'onyx') {
              const drumGain = stroke.isPoint ? 1.05 * strokeVol : strokeVol;
              const { zone, tomFreq } = resolveDrumZone(pitch.frequency, true);
              const zoneVel = zone === 'kick' ? 0.95 : zone === 'snare' ? 0.9 : 0.85;
              DrumSynth.triggerRoll(
                zone,
                zoneVel * drumGain,
                evalResult.point.x,
                canvasWidth,
                this.xModMode,
                zone === 'tom' ? tomFreq : 120,
                strokeReverb,
                this.engine
              );
            } else {
              const chord = getHarmonizerFrequencies(stroke.harmonizer, pitch.frequency, pitch.scaleDegree, strokeQuantizer);
              chord.frequencies.forEach((f, idx) => {
                const noteVol = (stroke.isPoint ? 1.0 : 0.8) * strokeVol * (chord.gains[idx] ?? 0.8);
                this.triggerRatchet(
                  f,
                  noteVol,
                  instrument,
                  evalResult.point.x,
                  canvasWidth,
                  this.xModMode,
                  strokeReverb,
                  breathing.filterMultiplier,
                  breathing.volumeMultiplier,
                  undefined,
                  stroke.distortion ?? 0.0,
                  stroke.filterCutoff ?? 1.0,
                  stroke.lofi ?? 0.0,
                  stroke.articulation ?? 1.0
                );
              });
            }
          }
        }
      }
    }
  }

  /**
   * Exports the current composition as a portable JSON-serializable object.
   */
  public exportComposition(
    name = 'My Ambient Preset',
    scaleId = 'dorian',
    rootId = 'D2',
    canvasWidth?: number,
    canvasHeight?: number
  ): SavedComposition {
    return {
      version: 1,
      name,
      timestamp: Date.now(),
      bpm: this.bpm,
      canvasWidth,
      canvasHeight,
      scaleId,
      rootId,
      xAxisModulationMode: this.xModMode,
      breathingMode: this.breathingMode,
      defaultHarmonizer: this.defaultHarmonizer,
      swing: this._swing,
      quantizedTriggering: this._quantizedTriggering,
      strokes: this.strokes.filter((s) => s.morphRole !== 'incoming').map((s) => ({
        id: s.id,
        instrumentId: s.instrumentId,
        style: s.style,
        loopQuantize: s.loopQuantize,
        traversal: s.traversal,
        harmonizer: s.harmonizer ?? 'single',
        duration: s.duration,
        speedMultiplier: s.speedMultiplier,
        timingMode: s.timingMode ?? (s.speedMode === 'timer' ? 'timer' : 'speed'),
        speedMode: s.speedMode,
        volume: s.volume ?? 1.0,
        reverb: s.reverb ?? this.defaultReverb,
        fluctuation: s.fluctuation ?? this.defaultFluctuation,
        distortion: s.distortion ?? 0.0,
        filterCutoff: s.filterCutoff ?? 1.0,
        lofi: s.lofi ?? 0.0,
        articulation: s.articulation ?? 1.0,
        isPoint: s.isPoint,
        muted: !!s.muted,
        path: JSON.parse(JSON.stringify(s.path)),
        waveParams: s.waveParams ? JSON.parse(JSON.stringify(s.waveParams)) : undefined,
      })),
    };
  }

  /**
   * Computes the next version name for a preset (e.g. "Zen Meadow" -> "Zen Meadow (v2)",
   * "Zen Meadow (v2)" -> "Zen Meadow (v3)"), incrementing until an unused name is found.
   */
  public static getNextVersionName(name: string, saved: Record<string, SavedComposition> = {}): string {
    const match = name.match(/^(.*?)(?:\s*\(v(\d+)\))?$/i);
    const baseName = (match ? match[1] : name).trim();
    let v = match && match[2] ? parseInt(match[2], 10) + 1 : 2;
    let candidate = `${baseName} (v${v})`;
    while (saved[candidate]) {
      v++;
      candidate = `${baseName} (v${v})`;
    }
    return candidate;
  }

  /**
   * Imports a saved composition, restoring all lines, volumes, loop syncs, wave parameters, and tempo.
   * Proportionally scales coordinates when loading across different window resolutions or if lines fall off screen.
   */
  public importComposition(
    data: SavedComposition,
    quantizer?: ScaleQuantizer,
    canvasHeight?: number,
    canvasWidth?: number,
    releaseOldVoicesTimeOrOptions: number | ImportCompositionOptions = 0.2,
    options?: ImportCompositionOptions
  ): void {
    const resolvedOptions: ImportCompositionOptions =
      typeof releaseOldVoicesTimeOrOptions === 'object' && releaseOldVoicesTimeOrOptions !== null
        ? releaseOldVoicesTimeOrOptions
        : (options ?? {});
    const releaseOldVoicesTime =
      typeof releaseOldVoicesTimeOrOptions === 'number'
        ? releaseOldVoicesTimeOrOptions
        : (resolvedOptions.releaseOldVoicesTime ?? 0.2);

    this.clearAll(releaseOldVoicesTime);
    this.setBpm(data.bpm);
    if (data.xAxisModulationMode) {
      this.setXAxisModulationMode(data.xAxisModulationMode);
    }
    if (data.breathingMode) {
      this.setBreathingMode(data.breathingMode);
    }
    if (data.defaultHarmonizer) {
      this.setDefaultStrokeHarmonizer(data.defaultHarmonizer);
    }
    if (typeof data.swing === 'number') {
      this.setSwing(data.swing);
    }
    if (typeof data.quantizedTriggering === 'boolean') {
      this.setQuantizedTriggering(data.quantizedTriggering);
    }

    // Determine horizontal scale factor to prevent lines falling off the right window margin
    let scaleX = 1.0;
    if (canvasWidth && canvasWidth > 0) {
      if (typeof data.canvasWidth === 'number' && data.canvasWidth > 0) {
        scaleX = canvasWidth / data.canvasWidth;
      } else {
        // Older file without canvasWidth: detect if points extend past or crowd the right edge
        let maxStrokeX = 0;
        for (const s of data.strokes) {
          for (const seg of s.path.segments) {
            maxStrokeX = Math.max(maxStrokeX, seg.p0.x, seg.p1.x, seg.p2.x, seg.p3.x);
          }
        }
        if (maxStrokeX > canvasWidth * 0.88) {
          scaleX = (canvasWidth * 0.86) / maxStrokeX;
        }
      }
    }

    let scaleY = 1.0;
    if (canvasHeight && canvasHeight > 0 && typeof data.canvasHeight === 'number' && data.canvasHeight > 0 && data.canvasHeight !== canvasHeight) {
      scaleY = canvasHeight / data.canvasHeight;
    }

    for (const s of data.strokes) {
      const fixedId = resolvedOptions.preserveIds ? s.id : undefined;
      this.createStrokeFromSaved(s, scaleX, quantizer, canvasHeight, scaleY, fixedId);
    }
    if (resolvedOptions.randomizePlayheads !== false) {
      this.randomizeAllPlayheads(quantizer, canvasHeight);
    }
    this._sceneVersion++;
  }

  /**
   * Helper to instantiate a DrawnStroke from a SavedStroke.
   */
  public createStrokeFromSaved(
    s: SavedStroke,
    scaleX: number = 1.0,
    quantizer?: ScaleQuantizer,
    canvasHeight?: number,
    scaleY: number = 1.0,
    fixedId?: string,
    startVolumeOverride?: number
  ): DrawnStroke {
    const maxWorldY = quantizer && canvasHeight && canvasHeight > 0
      ? (quantizer.isScrollEnabled ? quantizer.getWorldHeight(canvasHeight) : canvasHeight)
      : undefined;
    const scaleYCoord = (y: number): number => {
      if (scaleY === 1.0) return y;
      const scaled = y * scaleY;
      if (maxWorldY !== undefined) {
        return Math.max(0, Math.min(maxWorldY, scaled));
      }
      return Math.max(0, scaled);
    };

    const clonedPath: SplinePath = {
      isClosed: s.path.isClosed,
      segments: s.path.segments.map((seg) => ({
        p0: { x: seg.p0.x * scaleX, y: scaleYCoord(seg.p0.y) },
        p1: { x: seg.p1.x * scaleX, y: scaleYCoord(seg.p1.y) },
        p2: { x: seg.p2.x * scaleX, y: scaleYCoord(seg.p2.y) },
        p3: { x: seg.p3.x * scaleX, y: scaleYCoord(seg.p3.y) },
      })),
    };

    const clonedWave = s.waveParams ? {
      ...s.waveParams,
      amplitude: s.waveParams.amplitude * scaleY,
      baseP0: { x: s.waveParams.baseP0.x * scaleX, y: scaleYCoord(s.waveParams.baseP0.y) },
      baseP1: { x: s.waveParams.baseP1.x * scaleX, y: scaleYCoord(s.waveParams.baseP1.y) },
    } : undefined;

    const stroke = this.addStroke(
      clonedPath,
      s.style,
      s.instrumentId,
      140,
      quantizer,
      canvasHeight,
      s.volume ?? 1.0,
      s.loopQuantize,
      s.traversal,
      s.duration,
      s.speedMultiplier,
      s.speedMode,
      s.reverb,
      s.fluctuation,
      s.timingMode,
      s.harmonizer,
      false,
      s.isPoint ?? false,
      s.distortion ?? 0.0,
      s.filterCutoff ?? 1.0,
      s.lofi ?? 0.0,
      !!s.muted,
      fixedId,
      startVolumeOverride,
      s.articulation ?? 1.0
    );
    if (clonedWave) stroke.waveParams = clonedWave;
    return stroke;
  }

  /**
   * Begins a smooth overlapping crossfade towards an incoming scene.
   * Existing strokes are marked 'outgoing', and the incoming scene's strokes
   * are instantiated, marked 'incoming', and start playing simultaneously!
   */
  public startSceneCrossfade(
    incomingComp: SavedComposition,
    quantizer?: ScaleQuantizer,
    canvasHeight?: number,
    canvasWidth?: number,
    curveMode: MorphCurveMode = 'equalPower',
    targetSceneId?: string
  ): void {
    if (this.isCrossfadingMorph && this.morphTargetSceneId === targetSceneId) {
      return;
    }
    if (this.isCrossfadingMorph) {
      this.cancelSceneCrossfade();
    }

    this.isCrossfadingMorph = true;
    this.morphCurveMode = curveMode;
    this.morphTargetSceneId = targetSceneId || null;
    this.morphOutgoingGain = 1.0;
    this.morphIncomingGain = 0.0;

    // 1. Tag all existing strokes as outgoing
    for (const s of this.strokes) {
      s.morphRole = 'outgoing';
      s.morphGain = 1.0;
    }

    // 2. Compute scale factors for incoming strokes if needed
    let scaleX = 1.0;
    if (canvasWidth && canvasWidth > 0 && typeof incomingComp.canvasWidth === 'number' && incomingComp.canvasWidth > 0) {
      scaleX = canvasWidth / incomingComp.canvasWidth;
    }
    let scaleY = 1.0;
    if (canvasHeight && canvasHeight > 0 && typeof incomingComp.canvasHeight === 'number' && incomingComp.canvasHeight > 0 && incomingComp.canvasHeight !== canvasHeight) {
      scaleY = canvasHeight / incomingComp.canvasHeight;
    }

    // Initialize quantizer dedicated to incoming scene scale/root
    const targetScale = (incomingComp.scaleId && SCALES[incomingComp.scaleId]) ? SCALES[incomingComp.scaleId] : (quantizer ? quantizer.getConfig().scale : SCALES.dorian);
    const targetRoot = (incomingComp.rootId && ROOT_NOTES[incomingComp.rootId]) ? ROOT_NOTES[incomingComp.rootId] : (quantizer ? quantizer.getConfig().root : ROOT_NOTES.D2);
    this.morphIncomingQuantizer = new ScaleQuantizer({
      scale: targetScale,
      root: targetRoot,
      octaveSpan: quantizer ? quantizer.getConfig().octaveSpan : 4,
    });
    if (quantizer) {
      this.morphIncomingQuantizer.setScrollEnabled(quantizer.isScrollEnabled);
      this.morphIncomingQuantizer.setScrollY(quantizer.scrollY);
    }

    // 3. Instantiate incoming strokes, mark as incoming, and start at 0 gain
    for (const s of incomingComp.strokes) {
      const stroke = this.createStrokeFromSaved(s, scaleX, this.morphIncomingQuantizer, canvasHeight, scaleY, undefined, 0);
      stroke.morphRole = 'incoming';
      stroke.morphGain = 0.0;
      if (stroke.droneVoice) {
        stroke.droneVoice.setVolume(0.0);
      }
    }

    // Activate voices for incoming strokes so their audio is live
    this.activateAudioVoices();
    this._sceneVersion++;
  }

  /**
   * Updates crossfade gains for all active strokes based on the current morph ratio (0.0 to 1.0).
   */
  public updateSceneCrossfade(ratio: number): { outgoingGain: number; incomingGain: number; reverbBoost: number } {
    const r = Math.max(0, Math.min(1, ratio));

    let outGain = 1.0;
    let inGain = 0.0;
    let reverbBoost = 0.0;

    if (this.morphCurveMode === 'linear') {
      outGain = 1.0 - r;
      inGain = r;
    } else if (this.morphCurveMode === 'reverbWash') {
      outGain = Math.cos(r * (Math.PI / 2));
      inGain = Math.sin(r * (Math.PI / 2));
      reverbBoost = Math.sin(r * Math.PI) * 0.22;
    } else {
      // 'equalPower' (default): constant acoustic power
      outGain = Math.cos(r * (Math.PI / 2));
      inGain = Math.sin(r * (Math.PI / 2));
    }

    this.morphOutgoingGain = outGain;
    this.morphIncomingGain = inGain;

    for (const s of this.strokes) {
      if (s.morphRole === 'outgoing') {
        s.morphGain = outGain;
      } else if (s.morphRole === 'incoming') {
        s.morphGain = inGain;
      }
    }

    this._sceneVersion++;
    return { outgoingGain: outGain, incomingGain: inGain, reverbBoost };
  }

  /**
   * Completes the crossfade: releases and removes outgoing strokes, promotes incoming strokes
   * to full active status.
   */
  public completeSceneCrossfade(): void {
    if (!this.isCrossfadingMorph) return;

    // Release outgoing drone voices with gentle release
    for (const s of this.strokes) {
      if (s.morphRole === 'outgoing') {
        this.cleanupRemovedStroke(s, 0.35);
      }
    }

    // Retain only incoming strokes
    this.strokes = this.strokes.filter((s) => s.morphRole !== 'outgoing');

    // Remove morph tags from surviving strokes
    for (const s of this.strokes) {
      delete s.morphRole;
      delete s.morphGain;
    }

    // Deselect any removed strokes
    const survivingIds = new Set(this.strokes.map((s) => s.id));
    for (const id of Array.from(this.selectedIds)) {
      if (!survivingIds.has(id)) {
        this.selectedIds.delete(id);
      }
    }
    if (this.selectedId && !survivingIds.has(this.selectedId)) {
      this.selectedId = this.selectedIds.size === 1 ? Array.from(this.selectedIds)[0] : null;
    }

    this.isCrossfadingMorph = false;
    this.morphTargetSceneId = null;
    this.morphIncomingQuantizer = null;
    this.morphOutgoingGain = 1.0;
    this.morphIncomingGain = 1.0;
    this.sceneMorphGain = 1.0;
    this._sceneVersion++;
  }

  /**
   * Cancels active crossfade: releases incoming strokes and restores outgoing strokes.
   */
  public cancelSceneCrossfade(): void {
    if (!this.isCrossfadingMorph) return;

    for (const s of this.strokes) {
      if (s.morphRole === 'incoming') {
        this.cleanupRemovedStroke(s, 0.2);
      }
    }

    this.strokes = this.strokes.filter((s) => s.morphRole !== 'incoming');

    for (const s of this.strokes) {
      delete s.morphRole;
      delete s.morphGain;
    }

    const survivingIds = new Set(this.strokes.map((s) => s.id));
    for (const id of Array.from(this.selectedIds)) {
      if (!survivingIds.has(id)) {
        this.selectedIds.delete(id);
      }
    }
    if (this.selectedId && !survivingIds.has(this.selectedId)) {
      this.selectedId = this.selectedIds.size === 1 ? Array.from(this.selectedIds)[0] : null;
    }

    this.isCrossfadingMorph = false;
    this.morphTargetSceneId = null;
    this.morphIncomingQuantizer = null;
    this.morphOutgoingGain = 1.0;
    this.morphIncomingGain = 0.0;
    this.sceneMorphGain = 1.0;
    this._sceneVersion++;
  }
}

export const getNextVersionName = StrokeManager.getNextVersionName;

/**
 * Calculates the vertical center (midpoint between lowest and highest Y)
 * of a stroke in canvas field coordinates.
 */
export function getStrokeVerticalCenter(stroke: DrawnStroke): number {
  if (!stroke.path?.segments?.length) return 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const seg of stroke.path.segments) {
    if (seg.p0.y < minY) minY = seg.p0.y;
    if (seg.p0.y > maxY) maxY = seg.p0.y;
    if (seg.p1.y < minY) minY = seg.p1.y;
    if (seg.p1.y > maxY) maxY = seg.p1.y;
    if (seg.p2.y < minY) minY = seg.p2.y;
    if (seg.p2.y > maxY) maxY = seg.p2.y;
    if (seg.p3.y < minY) minY = seg.p3.y;
    if (seg.p3.y > maxY) maxY = seg.p3.y;
  }
  return isFinite(minY) && isFinite(maxY) ? (minY + maxY) / 2 : 0;
}
