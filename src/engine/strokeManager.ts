import { SplinePath, Point2D, ArcLengthLUT } from '../math/types';
import { buildArcLengthLUT } from '../math/arcLengthTable';
import { evaluateAtDistance } from '../math/arcLengthInverter';
import { evaluateBezier } from '../math/bezier';
import { generateWaveSpline, WaveParams, WaveShapeType } from '../math/waveShape';
import { ScaleQuantizer } from '../audio/scaleQuantizer';
import { DroneVoice, PulseVoice, XAxisModulationMode } from '../audio/synthVoice';
import { DrumSynth } from '../audio/drumSynth';
import { getInstrument, DEFAULT_INSTRUMENT } from '../audio/instruments';
import { soundEngine } from '../audio/audioContext';
import { DrawnStroke, StrokeStyle, TraversalMode, TimingMode, LoopQuantizeMode, SpeedMode, HarmonizerMode, SavedComposition } from './types';
import { getHarmonizerFrequencies } from '../audio/harmony';
import { calculateBreathing, BreathingMode } from '../audio/breathing';


type UndoAction =
  | { type: 'add'; stroke: DrawnStroke }
  | { type: 'remove'; stroke: DrawnStroke; index: number }
  | { type: 'move'; strokeId: string; dx: number; dy: number }
  | { type: 'revoice'; strokeId: string; oldInstrumentId: string; newInstrumentId: string }
  | { type: 'volume'; strokeId: string; oldVolume: number; newVolume: number }
  | { type: 'duration'; strokeId: string; oldDuration: number; newDuration: number }
  | { type: 'speed'; strokeId: string; oldSpeed: number; newSpeed: number }
  | {
      type: 'timingMode';
      strokeId: string;
      oldTimingMode: TimingMode;
      newTimingMode: TimingMode;
      oldSpeed?: number;
      newSpeed?: number;
      oldDuration?: number;
      newDuration?: number;
    }
  | { type: 'speedMode'; strokeId: string; oldSpeedMode: SpeedMode; newSpeedMode: SpeedMode }
  | { type: 'style'; strokeId: string; oldStyle: StrokeStyle; newStyle: StrokeStyle }
  | { type: 'loopQuantize'; strokeId: string; oldLoopQuantize: LoopQuantizeMode; newLoopQuantize: LoopQuantizeMode }
  | { type: 'traversal'; strokeId: string; oldTraversal: TraversalMode; newTraversal: TraversalMode }
  | { type: 'harmonizer'; strokeId: string; oldHarmonizer: HarmonizerMode; newHarmonizer: HarmonizerMode }
  | { type: 'reverb'; strokeId: string; oldReverb: number; newReverb: number }
  | { type: 'fluctuation'; strokeId: string; oldFluctuation: number; newFluctuation: number }
  | {
      type: 'reshape';
      strokeId: string;
      oldPath: SplinePath;
      oldLut: ArcLengthLUT;
      oldWaveParams?: WaveParams;
      newPath: SplinePath;
      newLut: ArcLengthLUT;
      newWaveParams: WaveParams;
    };

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
}

export class StrokeManager {
  private strokes: DrawnStroke[] = [];
  private clipboard: StrokeClipboardData | null = null;
  private pasteCount = 0;
  private isPaused = false;
  private bpm = 100;
  private traversalMode: TraversalMode = 'restart';
  private xModMode: XAxisModulationMode = 'panAndTone';
  private quantizeMode: LoopQuantizeMode = '2bars';
  private defaultHarmonizer: HarmonizerMode = 'single';
  private breathingMode: BreathingMode = 'gentle';
  private selectedId: string | null = null;
  private hoveredId: string | null = null;
  private masterClockTime = 0;
  private lastCanvasWidth = 1200;

  // History stacks
  private undoStack: UndoAction[] = [];
  private redoStack: UndoAction[] = [];

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
    return this.selectedId;
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

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0;
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
        if (stroke.droneVoice) {
          stroke.droneVoice.stop();
          stroke.droneVoice = null;
        }
      }
    } else {
      for (const stroke of this.strokes) {
        if (stroke.style === 'solid' && soundEngine.isReady && stroke.playhead.lastPitch && this.isStrokeAudible(stroke)) {
          if (!stroke.droneVoice || !stroke.droneVoice.isPlaying) {
            const inst = getInstrument(stroke.instrumentId);
            stroke.droneVoice = new DroneVoice();
            stroke.droneVoice.start(stroke.playhead.lastPitch.frequency, inst, stroke.volume ?? 1.0, stroke.reverb ?? this.defaultReverb);
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
    this.selectedId = id;
    for (const stroke of this.strokes) {
      stroke.selected = stroke.id === id;
    }
  }

  public setHoveredStroke(id: string | null): void {
    this.hoveredId = id;
    for (const stroke of this.strokes) {
      stroke.hovered = stroke.id === id;
    }
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

    if (!this.isStrokeAudible(stroke) && stroke.droneVoice) {
      stroke.droneVoice.stop();
      stroke.droneVoice = null;
    } else if (this.isStrokeAudible(stroke) && stroke.style === 'solid' && soundEngine.isReady && stroke.playhead.lastPitch && !this.isPaused) {
      if (!stroke.droneVoice || !stroke.droneVoice.isPlaying) {
        const inst = getInstrument(stroke.instrumentId);
        stroke.droneVoice = new DroneVoice();
        stroke.droneVoice.start(stroke.playhead.lastPitch.frequency, inst, stroke.volume ?? 1.0, stroke.reverb ?? this.defaultReverb);
      }
    }
    return stroke.muted ?? false;
  }

  public toggleSolo(strokeId: string): boolean {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    if (!stroke) return false;
    stroke.soloed = !stroke.soloed;

    // Refresh audio voices for all strokes
    for (const s of this.strokes) {
      const audible = this.isStrokeAudible(s);
      if (!audible && s.droneVoice) {
        s.droneVoice.stop();
        s.droneVoice = null;
      } else if (audible && s.style === 'solid' && (!s.droneVoice || !s.droneVoice.isPlaying) && soundEngine.isReady && s.playhead.lastPitch && !this.isPaused) {
        const inst = getInstrument(s.instrumentId);
        s.droneVoice = new DroneVoice();
        s.droneVoice.start(s.playhead.lastPitch.frequency, inst, s.volume ?? 1.0, s.reverb ?? this.defaultReverb);
      }
    }
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
    harmonizer?: HarmonizerMode
  ): DrawnStroke {
    const lut = buildArcLengthLUT(path, 64);
    const id = `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const instrument = getInstrument(instrumentId);
    const strokeVolume = Math.max(0, Math.min(1, volume));
    const strokeReverb = typeof reverb === 'number' ? Math.max(0, Math.min(1, reverb)) : this.defaultReverb;
    const strokeFluctuation = typeof fluctuation === 'number' ? Math.max(0, Math.min(1, fluctuation)) : this.defaultFluctuation;
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

    let droneVoice: DroneVoice | null = null;
    if (style === 'solid' && soundEngine.isReady && initialPitch && !this.isPaused) {
      droneVoice = new DroneVoice();
      droneVoice.start(initialPitch.frequency, instrument, strokeVolume, strokeReverb);
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
        lastEval: initialEval,
        lastPitch: initialPitch,
        trail: [],
        finished: false,
      },
      droneVoice,
      active: true,
      selected: false,
      hovered: false,
      muted: false,
      soloed: false,
      volume: strokeVolume,
      reverb: strokeReverb,
      fluctuation: strokeFluctuation,
      duration: effectiveDuration,
      speedMultiplier: effectiveSpeedMult,
      timingMode: effectiveTimingMode,
      speedMode: effectiveSpeedMode,
      loopQuantize: effectiveLoopQuantize,
      traversal: effectiveTraversal,
      harmonizer: effectiveHarmonizer,
    };

    this.strokes.push(stroke);
    this.undoStack.push({ type: 'add', stroke });
    this.redoStack = [];
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

    if (recordUndo) {
      this.undoStack.push({
        type: 'volume',
        strokeId,
        oldVolume: oldVol,
        newVolume: clampedVol,
      });
      this.redoStack = [];
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

    if (recordUndo) {
      this.undoStack.push({
        type: 'reverb',
        strokeId,
        oldReverb,
        newReverb: clampedReverb,
      });
      this.redoStack = [];
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

    if (recordUndo) {
      this.undoStack.push({
        type: 'fluctuation',
        strokeId,
        oldFluctuation,
        newFluctuation: clampedFluctuation,
      });
      this.redoStack = [];
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

    if (stroke.droneVoice) {
      stroke.droneVoice.setInstrument(newInstrument);
    }

    if (recordUndo) {
      this.undoStack.push({ type: 'revoice', strokeId, oldInstrumentId, newInstrumentId });
      this.redoStack = [];
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
    } else if (newStyle === 'solid' && oldStyle !== 'solid') {
      if (soundEngine.isReady && stroke.playhead.lastPitch && this.isStrokeAudible(stroke) && !this.isPaused) {
        const inst = getInstrument(stroke.instrumentId);
        stroke.droneVoice = new DroneVoice();
        stroke.droneVoice.start(stroke.playhead.lastPitch.frequency, inst, stroke.volume ?? 1.0);
      }
    }

    if (recordUndo) {
      this.undoStack.push({ type: 'style', strokeId, oldStyle, newStyle });
      this.redoStack = [];
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
      const beatsPerBar = StrokeManager.getBeatsForQuantize(newLoopQuantize);
      const cycleDuration = beatsPerBar * (60 / this.bpm);
      const cycleDistance = strokeTraversal === 'pingpong' ? 2 * stroke.lut.totalLength : stroke.lut.totalLength;
      const strokeSpeed = stroke.lut.totalLength / cycleDuration;
      const currentCycleDist = (this.masterClockTime * strokeSpeed) % cycleDistance;

      if (strokeTraversal === 'pingpong') {
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
      this.undoStack.push({ type: 'loopQuantize', strokeId, oldLoopQuantize, newLoopQuantize });
      this.redoStack = [];
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
      this.undoStack.push({ type: 'traversal', strokeId, oldTraversal, newTraversal: normalizedNew });
      this.redoStack = [];
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
      this.undoStack.push({
        type: 'timingMode',
        strokeId,
        oldTimingMode,
        newTimingMode,
        oldSpeed,
        newSpeed,
        oldDuration,
        newDuration,
      });
      this.redoStack = [];
    }

    return true;
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
      this.undoStack.push({ type: 'harmonizer', strokeId, oldHarmonizer, newHarmonizer });
      this.redoStack = [];
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
      this.undoStack.push({ type: 'duration', strokeId, oldDuration, newDuration: clamped });
      this.redoStack = [];
    }

    return true;
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
      this.undoStack.push({ type: 'speed', strokeId, oldSpeed, newSpeed: clamped });
      this.redoStack = [];
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
      this.undoStack.push({ type: 'speedMode', strokeId, oldSpeedMode: oldMode, newSpeedMode: mode });
      this.redoStack = [];
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

    if (stroke.playhead.lastEval) {
      stroke.playhead.lastEval.point.x += dx;
      stroke.playhead.lastEval.point.y += dy;
    }

    if (stroke.waveParams) {
      stroke.waveParams.baseP0.x += dx;
      stroke.waveParams.baseP0.y += dy;
      stroke.waveParams.baseP1.x += dx;
      stroke.waveParams.baseP1.y += dy;
    }

    if (recordUndo) {
      this.undoStack.push({ type: 'move', strokeId: id, dx, dy });
      this.redoStack = [];
    }

    return true;
  }

  /**
   * Rescales melodic stroke Y coordinates proportionally when octave view zoom changes,
   * guaranteeing that musical pitch (frequency and scale degree) remains identical.
   * Onyx drum machine strokes remain locked to their fixed screen zones.
   */
  public scaleMelodicStrokesY(scaleFactor: number): void {
    if (scaleFactor === 1 || !isFinite(scaleFactor) || scaleFactor <= 0) return;

    const scaledStrokes = new Set<DrawnStroke>();
    const scaledPaths = new Set<SplinePath>();

    const scalePathSegments = (p: SplinePath) => {
      if (scaledPaths.has(p)) return;
      scaledPaths.add(p);
      for (const seg of p.segments) {
        seg.p0.y *= scaleFactor;
        seg.p1.y *= scaleFactor;
        seg.p2.y *= scaleFactor;
        seg.p3.y *= scaleFactor;
      }
    };

    for (const stroke of this.strokes) {
      if (stroke.instrumentId === 'onyx') continue; // Drum zones are fixed to screen coordinates
      scaledStrokes.add(stroke);
      scalePathSegments(stroke.path);

      const oldLength = stroke.lut.totalLength;
      stroke.lut = buildArcLengthLUT(stroke.path);

      if (oldLength > 0 && stroke.lut.totalLength > 0) {
        stroke.playhead.currentDistance = (stroke.playhead.currentDistance / oldLength) * stroke.lut.totalLength;
      }

      stroke.playhead.trail = [];

      if (stroke.playhead.lastEval) {
        stroke.playhead.lastEval.point.y *= scaleFactor;
      }

      if (stroke.waveParams) {
        stroke.waveParams.baseP0.y *= scaleFactor;
        stroke.waveParams.baseP1.y *= scaleFactor;
        stroke.waveParams.amplitude *= scaleFactor;
      }
    }

    if (this.clipboard && this.clipboard.instrumentId !== 'onyx') {
      scalePathSegments(this.clipboard.path);
      if (this.clipboard.waveParams) {
        this.clipboard.waveParams.baseP0.y *= scaleFactor;
        this.clipboard.waveParams.baseP1.y *= scaleFactor;
        this.clipboard.waveParams.amplitude *= scaleFactor;
      }
    }

    const scaleUndoAction = (action: UndoAction) => {
      if (action.type === 'move') {
        action.dy *= scaleFactor;
      } else if (action.type === 'add' || action.type === 'remove') {
        if (action.stroke.instrumentId !== 'onyx' && !scaledStrokes.has(action.stroke)) {
          scaledStrokes.add(action.stroke);
          scalePathSegments(action.stroke.path);
          action.stroke.lut = buildArcLengthLUT(action.stroke.path);
          if (action.stroke.waveParams) {
            action.stroke.waveParams.baseP0.y *= scaleFactor;
            action.stroke.waveParams.baseP1.y *= scaleFactor;
            action.stroke.waveParams.amplitude *= scaleFactor;
          }
        }
      } else if (action.type === 'reshape') {
        if (!scaledPaths.has(action.oldPath)) {
          scalePathSegments(action.oldPath);
          action.oldLut = buildArcLengthLUT(action.oldPath);
          if (action.oldWaveParams) {
            action.oldWaveParams.baseP0.y *= scaleFactor;
            action.oldWaveParams.baseP1.y *= scaleFactor;
            action.oldWaveParams.amplitude *= scaleFactor;
          }
        }
        if (!scaledPaths.has(action.newPath)) {
          scalePathSegments(action.newPath);
          action.newLut = buildArcLengthLUT(action.newPath);
          if (action.newWaveParams) {
            action.newWaveParams.baseP0.y *= scaleFactor;
            action.newWaveParams.baseP1.y *= scaleFactor;
            action.newWaveParams.amplitude *= scaleFactor;
          }
        }
      }
    };

    for (const a of this.undoStack) scaleUndoAction(a);
    for (const a of this.redoStack) scaleUndoAction(a);
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
      this.clipboard.harmonizer
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

    if (recordUndo) {
      this.undoStack.push({
        type: 'reshape',
        strokeId,
        oldPath,
        oldLut,
        oldWaveParams,
        newPath,
        newLut,
        newWaveParams,
      });
      this.redoStack = [];
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
      const testPt = (stroke.instrumentId === 'onyx' || !worldPoint) ? point : worldPoint;
      const segments = stroke.path.segments;

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
    if (!soundEngine.isReady || this.isPaused) return;

    for (const stroke of this.strokes) {
      if (stroke.style === 'solid' && !stroke.droneVoice && stroke.playhead.lastPitch && this.isStrokeAudible(stroke)) {
        const inst = getInstrument(stroke.instrumentId);
        stroke.droneVoice = new DroneVoice();
        stroke.droneVoice.start(stroke.playhead.lastPitch.frequency, inst, stroke.volume ?? 1.0, stroke.reverb ?? this.defaultReverb);
      }
    }
  }

  /**
   * Main per-frame update loop.
   */
  public update(dt: number, canvasWidth: number, canvasHeight: number, quantizer: ScaleQuantizer): void {
    if (canvasWidth > 0) {
      this.lastCanvasWidth = canvasWidth;
    }
    if (this.isPaused || dt <= 0) return;

    this.masterClockTime += dt;

    const DOT_SPACING = 40;   // 1/8th note (2 triggers per beat)
    const ROLL_SPACING = 40;  // 1/8th note roll burst interval (rapid multi-hit bursts)

    for (const stroke of this.strokes) {
      if (!stroke.active) continue;

      const L = stroke.lut.totalLength;
      if (L <= 1) continue;

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

      // Handle curve boundary according to traversal mode (restart vs bounce)
      if (stroke.lut.isClosed) {
        nextDist = ((nextDist % L) + L) % L;
      } else if (strokeTraversal === 'bounce') {
        if (nextDist >= L) {
          nextDist = L - (nextDist - L);
          ph.direction = -1;
        } else if (nextDist <= 0) {
          nextDist = -nextDist;
          ph.direction = 1;
        }
      } else {
        // 'restart'
        if (nextDist >= L) {
          nextDist = nextDist % L;
        } else if (nextDist < 0) {
          nextDist = 0;
        }
        ph.direction = 1;
      }

      ph.currentDistance = nextDist;

      // 1. Evaluate position with Newton-Raphson refinement
      const evalResult = evaluateAtDistance(stroke.path, stroke.lut, nextDist, {
        useNewtonRaphson: true,
        newtonIterations: 1,
      });

      const strokeFluctuation = stroke.fluctuation ?? this.defaultFluctuation;
      const MAX_FLUCTUATION_OFFSET = 18; // Max pixel drift (~1 semitone / microtonal wander)
      const maxY = quantizer?.isScrollEnabled ? quantizer.getWorldHeight(canvasHeight) : canvasHeight;

      // Continuous organic wander for solid drone lines
      const wander = (stroke.style === 'solid' && strokeFluctuation > 0)
        ? getStrokeWander(stroke.id, this.masterClockTime, nextDist) * strokeFluctuation * MAX_FLUCTUATION_OFFSET
        : 0;
      const solidEffectiveY = Math.max(0, Math.min(maxY, evalResult.point.y + wander));

      // Visual playhead tracks the wander & dot scatter when fluctuation is active
      let effectiveVisualY = evalResult.point.y;
      if (strokeFluctuation > 0) {
        if (stroke.style === 'solid') {
          effectiveVisualY = solidEffectiveY;
        } else if (stroke.style === 'dotted') {
          const dotIdx = Math.floor(nextDist / DOT_SPACING);
          const dotJitter = getHitJitter(stroke.id, dotIdx) * strokeFluctuation * 18;
          effectiveVisualY = Math.max(0, Math.min(maxY, evalResult.point.y + dotJitter));
        } else if (stroke.style === 'striped') {
          const rollIdx = Math.floor(nextDist / ROLL_SPACING);
          const rollJitter = getHitJitter(stroke.id, rollIdx) * strokeFluctuation * 14;
          effectiveVisualY = Math.max(0, Math.min(maxY, evalResult.point.y + rollJitter));
        }
      }

      const visualPt: Point2D = { x: evalResult.point.x, y: effectiveVisualY };

      ph.lastEval = { ...evalResult, point: visualPt };

      // 2. Motion Trail
      ph.trail.unshift(visualPt);
      if (ph.trail.length > 14) {
        ph.trail.pop();
      }

      // 3. Audio & Pitch evaluation (Respecting Volume, Mute, Solo, and Loop Boundary Crossfade)
      const audible = this.isStrokeAudible(stroke);
      const instrument = getInstrument(stroke.instrumentId);
      const strokeVol = stroke.volume ?? 1.0;

      // Smooth crossfade near loop boundaries for restart mode
      let crossfadeMultiplier = 1.0;
      if (stroke.style === 'solid' && strokeTraversal === 'restart' && !stroke.lut.isClosed) {
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

      // Update playhead swell for visual halo breathing
      ph.currentSwell = breathing.volumeMultiplier;

      if (stroke.style === 'solid') {
        const pitch = quantizer.quantizeContinuous(solidEffectiveY, canvasHeight);
        ph.lastPitch = pitch;

        if (audible) {
          const chord = getHarmonizerFrequencies(stroke.harmonizer, pitch.frequency, pitch.scaleDegree, quantizer);
          if ((!stroke.droneVoice || !stroke.droneVoice.isPlaying) && soundEngine.isReady) {
            stroke.droneVoice = new DroneVoice();
            stroke.droneVoice.start(pitch.frequency, instrument, effectiveVol, strokeReverb);
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
              breathing
            );
          }
        } else if (stroke.droneVoice) {
          stroke.droneVoice.stop();
          stroke.droneVoice = null;
        }
      } else if (stroke.style === 'dotted') {
        const prevIndex = Math.floor(prevDist / DOT_SPACING);
        const nextIndex = Math.floor(nextDist / DOT_SPACING);
        const isTriggerHit = prevIndex !== nextIndex && audible;

        const PITCH_FLUCTUATION_OFFSET = 52;
        const jitter = (isTriggerHit && strokeFluctuation > 0)
          ? getHitJitter(stroke.id, nextIndex) * strokeFluctuation * PITCH_FLUCTUATION_OFFSET
          : 0;
        const triggerY = Math.max(0, Math.min(maxY, evalResult.point.y + jitter));
        const pitch = quantizer.quantizeDiscrete(triggerY, canvasHeight);
        ph.lastPitch = pitch;

        if (isTriggerHit) {
          if (stroke.instrumentId === 'onyx') {
            const normY = canvasHeight > 0 ? triggerY / canvasHeight : 0.5;
            if (normY >= 0.72) {
              DrumSynth.triggerKick(0.95 * strokeVol, evalResult.point.x, canvasWidth, this.xModMode, 0, strokeReverb);
            } else if (normY >= 0.48) {
              DrumSynth.triggerSnare(0.9 * strokeVol, evalResult.point.x, canvasWidth, this.xModMode, 0, strokeReverb);
            } else if (normY >= 0.25) {
              const tomFreq = 100 + (1 - (normY - 0.25) / 0.23) * 120;
              DrumSynth.triggerTom(tomFreq, 0.85 * strokeVol, evalResult.point.x, canvasWidth, this.xModMode, 0, strokeReverb);
            } else {
              DrumSynth.triggerHiHat(true, 0.85 * strokeVol, evalResult.point.x, canvasWidth, this.xModMode, 0, strokeReverb);
            }
          } else {
            // Apply subtle organic microtonal detune (+/- 35 cents) for vintage acoustic tone flutter
            const microCents = strokeFluctuation > 0
              ? getHitJitter(stroke.id, nextIndex + 47) * strokeFluctuation * 35
              : 0;
            const finalFreq = pitch.frequency * Math.pow(2, microCents / 1200);

            const chord = getHarmonizerFrequencies(stroke.harmonizer, finalFreq, pitch.scaleDegree, quantizer);
            chord.frequencies.forEach((f, idx) => {
              const strumDelay = idx * 0.016; // 16ms acoustic strum spread
              const noteVol = 0.85 * strokeVol * (chord.gains[idx] ?? 0.8);
              PulseVoice.trigger(
                f,
                false,
                noteVol,
                instrument,
                evalResult.point.x,
                canvasWidth,
                this.xModMode,
                strumDelay,
                strokeReverb,
                breathing.filterMultiplier,
                breathing.volumeMultiplier
              );
            });
          }
        }
      } else if (stroke.style === 'striped') {
        const prevIndex = Math.floor(prevDist / ROLL_SPACING);
        const nextIndex = Math.floor(nextDist / ROLL_SPACING);
        const isTriggerHit = prevIndex !== nextIndex && audible;

        const PITCH_FLUCTUATION_OFFSET = 44;
        const jitter = (isTriggerHit && strokeFluctuation > 0)
          ? getHitJitter(stroke.id, nextIndex) * strokeFluctuation * PITCH_FLUCTUATION_OFFSET
          : 0;
        const triggerY = Math.max(0, Math.min(maxY, evalResult.point.y + jitter));
        const pitch = quantizer.quantizeDiscrete(triggerY, canvasHeight);
        ph.lastPitch = pitch;

        if (isTriggerHit) {
          if (stroke.instrumentId === 'onyx') {
            const normY = canvasHeight > 0 ? triggerY / canvasHeight : 0.5;
            if (normY >= 0.72) {
              DrumSynth.triggerRoll('kick', 0.95 * strokeVol, evalResult.point.x, canvasWidth, this.xModMode, 120, strokeReverb);
            } else if (normY >= 0.58) {
              DrumSynth.triggerRoll('snare', 0.9 * strokeVol, evalResult.point.x, canvasWidth, this.xModMode, 120, strokeReverb);
            } else if (normY >= 0.48) {
              DrumSynth.triggerRoll('clap', 0.85 * strokeVol, evalResult.point.x, canvasWidth, this.xModMode, 120, strokeReverb);
            } else if (normY >= 0.25) {
              const tomFreq = 100 + (1 - (normY - 0.25) / 0.23) * 120;
              DrumSynth.triggerRoll('tom', 0.85 * strokeVol, evalResult.point.x, canvasWidth, this.xModMode, tomFreq, strokeReverb);
            } else {
              DrumSynth.triggerRoll('hihat', 0.85 * strokeVol, evalResult.point.x, canvasWidth, this.xModMode, 120, strokeReverb);
            }
          } else {
            const microCents = strokeFluctuation > 0
              ? getHitJitter(stroke.id, nextIndex + 59) * strokeFluctuation * 30
              : 0;
            const finalFreq = pitch.frequency * Math.pow(2, microCents / 1200);

            const chord = getHarmonizerFrequencies(stroke.harmonizer, finalFreq, pitch.scaleDegree, quantizer);
            chord.frequencies.forEach((f, idx) => {
              const noteVol = 0.8 * strokeVol * (chord.gains[idx] ?? 0.8);
              PulseVoice.triggerRatchet(
                f,
                noteVol,
                instrument,
                evalResult.point.x,
                canvasWidth,
                this.xModMode,
                strokeReverb,
                breathing.filterMultiplier,
                breathing.volumeMultiplier
              );
            });
          }
        }
      }
    }
  }

  public undo(): boolean {
    const action = this.undoStack.pop();
    if (!action) return false;

    if (action.type === 'add') {
      const idx = this.strokes.findIndex((s) => s.id === action.stroke.id);
      if (idx !== -1) {
        const [removed] = this.strokes.splice(idx, 1);
        removed.droneVoice?.stop();
        removed.droneVoice = null;
        if (this.selectedId === removed.id) this.selectedId = null;
        this.redoStack.push({ type: 'add', stroke: removed });
      }
    } else if (action.type === 'remove') {
      this.strokes.splice(action.index, 0, action.stroke);
      if (action.stroke.style === 'solid' && soundEngine.isReady && action.stroke.playhead.lastPitch && this.isStrokeAudible(action.stroke)) {
        const inst = getInstrument(action.stroke.instrumentId);
        action.stroke.droneVoice = new DroneVoice();
        action.stroke.droneVoice.start(action.stroke.playhead.lastPitch.frequency, inst, action.stroke.volume ?? 1.0, action.stroke.reverb ?? this.defaultReverb);
      }
      this.redoStack.push({ type: 'remove', stroke: action.stroke, index: action.index });
    } else if (action.type === 'move') {
      this.translateStroke(action.strokeId, -action.dx, -action.dy, false);
      this.redoStack.push(action);
    } else if (action.type === 'revoice') {
      this.revoiceStroke(action.strokeId, action.oldInstrumentId, false);
      this.redoStack.push(action);
    } else if (action.type === 'volume') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.volume = action.oldVolume;
        stroke.droneVoice?.setVolume(action.oldVolume);
      }
      this.redoStack.push(action);
    } else if (action.type === 'reverb') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.reverb = action.oldReverb;
        stroke.droneVoice?.setReverb(action.oldReverb);
      }
      this.redoStack.push(action);
    } else if (action.type === 'fluctuation') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.fluctuation = action.oldFluctuation;
      }
      this.redoStack.push(action);
    } else if (action.type === 'style') {
      this.setStrokeStyle(action.strokeId, action.oldStyle, false);
      this.redoStack.push(action);
    } else if (action.type === 'loopQuantize') {
      this.setStrokeLoopQuantize(action.strokeId, action.oldLoopQuantize, false);
      this.redoStack.push(action);
    } else if (action.type === 'traversal') {
      this.setStrokeTraversal(action.strokeId, action.oldTraversal, false);
      this.redoStack.push(action);
    } else if (action.type === 'timingMode') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.timingMode = action.oldTimingMode;
        stroke.speedMode = action.oldTimingMode;
        if (action.oldSpeed !== undefined) stroke.speedMultiplier = action.oldSpeed;
        if (action.oldDuration !== undefined) stroke.duration = action.oldDuration;
      }
      this.redoStack.push(action);
    } else if (action.type === 'duration') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) stroke.duration = action.oldDuration;
      this.redoStack.push(action);
    } else if (action.type === 'speed') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) stroke.speedMultiplier = action.oldSpeed;
      this.redoStack.push(action);
    } else if (action.type === 'speedMode') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) stroke.speedMode = action.oldSpeedMode;
      this.redoStack.push(action);
    } else if (action.type === 'harmonizer') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) stroke.harmonizer = action.oldHarmonizer;
      this.redoStack.push(action);
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
      this.redoStack.push(action);
    }

    return true;
  }

  public redo(): boolean {
    const action = this.redoStack.pop();
    if (!action) return false;

    if (action.type === 'add') {
      this.strokes.push(action.stroke);
      if (action.stroke.style === 'solid' && soundEngine.isReady && action.stroke.playhead.lastPitch && this.isStrokeAudible(action.stroke)) {
        const inst = getInstrument(action.stroke.instrumentId);
        action.stroke.droneVoice = new DroneVoice();
        action.stroke.droneVoice.start(action.stroke.playhead.lastPitch.frequency, inst, action.stroke.volume ?? 1.0, action.stroke.reverb ?? this.defaultReverb);
      }
      this.undoStack.push(action);
    } else if (action.type === 'remove') {
      const idx = this.strokes.findIndex((s) => s.id === action.stroke.id);
      if (idx !== -1) {
        const [removed] = this.strokes.splice(idx, 1);
        removed.droneVoice?.stop();
        removed.droneVoice = null;
        if (this.selectedId === removed.id) this.selectedId = null;
        this.undoStack.push(action);
      }
    } else if (action.type === 'move') {
      this.translateStroke(action.strokeId, action.dx, action.dy, false);
      this.undoStack.push(action);
    } else if (action.type === 'revoice') {
      this.revoiceStroke(action.strokeId, action.newInstrumentId, false);
      this.undoStack.push(action);
    } else if (action.type === 'volume') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.volume = action.newVolume;
        stroke.droneVoice?.setVolume(action.newVolume);
      }
      this.undoStack.push(action);
    } else if (action.type === 'reverb') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.reverb = action.newReverb;
        stroke.droneVoice?.setReverb(action.newReverb);
      }
      this.undoStack.push(action);
    } else if (action.type === 'fluctuation') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.fluctuation = action.newFluctuation;
      }
      this.undoStack.push(action);
    } else if (action.type === 'style') {
      this.setStrokeStyle(action.strokeId, action.newStyle, false);
      this.undoStack.push(action);
    } else if (action.type === 'loopQuantize') {
      this.setStrokeLoopQuantize(action.strokeId, action.newLoopQuantize, false);
      this.undoStack.push(action);
    } else if (action.type === 'traversal') {
      this.setStrokeTraversal(action.strokeId, action.newTraversal, false);
      this.undoStack.push(action);
    } else if (action.type === 'timingMode') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) {
        stroke.timingMode = action.newTimingMode;
        stroke.speedMode = action.newTimingMode;
        if (action.newSpeed !== undefined) stroke.speedMultiplier = action.newSpeed;
        if (action.newDuration !== undefined) stroke.duration = action.newDuration;
      }
      this.undoStack.push(action);
    } else if (action.type === 'duration') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) stroke.duration = action.newDuration;
      this.undoStack.push(action);
    } else if (action.type === 'speed') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) stroke.speedMultiplier = action.newSpeed;
      this.undoStack.push(action);
    } else if (action.type === 'speedMode') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) stroke.speedMode = action.newSpeedMode;
      this.undoStack.push(action);
    } else if (action.type === 'harmonizer') {
      const stroke = this.strokes.find((s) => s.id === action.strokeId);
      if (stroke) stroke.harmonizer = action.newHarmonizer;
      this.undoStack.push(action);
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
      this.undoStack.push(action);
    }

    return true;
  }

  public deleteSelected(): boolean {
    if (!this.selectedId) return false;
    const idx = this.strokes.findIndex((s) => s.id === this.selectedId);
    if (idx !== -1) {
      const [removed] = this.strokes.splice(idx, 1);
      removed.droneVoice?.stop();
      removed.droneVoice = null;
      this.undoStack.push({ type: 'remove', stroke: removed, index: idx });
      this.redoStack = [];
      this.selectedId = null;
      return true;
    }
    return false;
  }

  public removeStroke(id: string): void {
    const idx = this.strokes.findIndex((s) => s.id === id);
    if (idx !== -1) {
      const [stroke] = this.strokes.splice(idx, 1);
      stroke.droneVoice?.stop();
      stroke.droneVoice = null;
      this.undoStack.push({ type: 'remove', stroke, index: idx });
      this.redoStack = [];
      if (this.selectedId === id) this.selectedId = null;
    }
  }

  public clearAll(): void {
    for (const stroke of this.strokes) {
      stroke.droneVoice?.stop();
      stroke.droneVoice = null;
    }
    this.strokes = [];
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    this.hoveredId = null;
    this.masterClockTime = 0;
  }

  /**
   * Resynchronizes all active playheads to distance 0 simultaneously in locked phase.
   */
  public resyncAllPlayheads(): void {
    this.masterClockTime = 0;
    for (const stroke of this.strokes) {
      stroke.playhead.currentDistance = 0;
      stroke.playhead.direction = 1;
      stroke.playhead.lastTriggerDistance = 0;
      stroke.playhead.finished = false;
      stroke.playhead.trail = [];
      if (stroke.style === 'solid' && !stroke.droneVoice && soundEngine.isReady && stroke.playhead.lastPitch && this.isStrokeAudible(stroke) && !this.isPaused) {
        const inst = getInstrument(stroke.instrumentId);
        stroke.droneVoice = new DroneVoice();
        stroke.droneVoice.start(stroke.playhead.lastPitch.frequency, inst, stroke.volume ?? 1.0, stroke.reverb ?? this.defaultReverb);
      }
    }
  }

  /**
   * Randomizes the playhead positions (moving dots) of all drawn lines across their lengths,
   * creating generative polyrhythmic textures and desynchronized phase patterns.
   */
  public randomizeAllPlayheads(): void {
    for (const stroke of this.strokes) {
      const L = stroke.lut.totalLength;
      if (L > 1) {
        stroke.playhead.currentDistance = Math.random() * L;
        stroke.playhead.lastTriggerDistance = stroke.playhead.currentDistance;
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

        if (stroke.style === 'solid' && !stroke.droneVoice && soundEngine.isReady && stroke.playhead.lastPitch && this.isStrokeAudible(stroke) && !this.isPaused) {
          const inst = getInstrument(stroke.instrumentId);
          stroke.droneVoice = new DroneVoice();
          stroke.droneVoice.start(stroke.playhead.lastPitch.frequency, inst, stroke.volume ?? 1.0, stroke.reverb ?? this.defaultReverb);
        }
      }
    }
  }

  /**
   * Exports the current composition as a portable JSON-serializable object.
   */
  public exportComposition(name = 'My Custom Groove', scaleId = 'dorian', rootId = 'D2'): SavedComposition {
    return {
      version: 1,
      name,
      timestamp: Date.now(),
      bpm: this.bpm,
      scaleId,
      rootId,
      xAxisModulationMode: this.xModMode,
      breathingMode: this.breathingMode,
      strokes: this.strokes.map((s) => ({
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
   */
  public importComposition(
    data: SavedComposition,
    quantizer?: ScaleQuantizer,
    canvasHeight?: number
  ): void {
    this.clearAll();
    this.setBpm(data.bpm);
    if (data.xAxisModulationMode) {
      this.setXAxisModulationMode(data.xAxisModulationMode);
    }
    if (data.breathingMode) {
      this.setBreathingMode(data.breathingMode);
    }

    for (const s of data.strokes) {
      const stroke = this.addStroke(
        s.path,
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
        s.harmonizer
      );
      if (s.muted) stroke.muted = true;
      if (s.waveParams) stroke.waveParams = s.waveParams;
    }
    this.resyncAllPlayheads();
  }
}

export const getNextVersionName = StrokeManager.getNextVersionName;
