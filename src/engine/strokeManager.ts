import { SplinePath, Point2D, ArcLengthLUT } from '../math/types';
import { buildArcLengthLUT } from '../math/arcLengthTable';
import { evaluateAtDistance } from '../math/arcLengthInverter';
import { evaluateBezier } from '../math/bezier';
import { generateWaveSpline, WaveParams, WaveShapeType } from '../math/waveShape';
import { ScaleQuantizer } from '../audio/scaleQuantizer';
import { DroneVoice, PulseVoice, XAxisModulationMode } from '../audio/synthVoice';
import { getInstrument, DEFAULT_INSTRUMENT } from '../audio/instruments';
import { soundEngine } from '../audio/audioContext';
import { DrawnStroke, StrokeStyle, TraversalMode, LoopQuantizeMode } from './types';

type UndoAction =
  | { type: 'add'; stroke: DrawnStroke }
  | { type: 'remove'; stroke: DrawnStroke; index: number }
  | { type: 'move'; strokeId: string; dx: number; dy: number }
  | { type: 'revoice'; strokeId: string; oldInstrumentId: string; newInstrumentId: string }
  | { type: 'volume'; strokeId: string; oldVolume: number; newVolume: number }
  | { type: 'style'; strokeId: string; oldStyle: StrokeStyle; newStyle: StrokeStyle }
  | { type: 'loopQuantize'; strokeId: string; oldLoopQuantize: LoopQuantizeMode; newLoopQuantize: LoopQuantizeMode }
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

export class StrokeManager {
  private strokes: DrawnStroke[] = [];
  private isPaused = false;
  private bpm = 100;
  private traversalMode: TraversalMode = 'restart';
  private xModMode: XAxisModulationMode = 'panAndTone';
  private quantizeMode: LoopQuantizeMode = '1bar';
  private selectedId: string | null = null;
  private hoveredId: string | null = null;
  private masterClockTime = 0;

  // History stacks
  private undoStack: UndoAction[] = [];
  private redoStack: UndoAction[] = [];

  /** Constant pixel distance representing one quarter-note beat */
  public static readonly BEAT_DISTANCE = 80;

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
            stroke.droneVoice.start(stroke.playhead.lastPitch.frequency, inst, stroke.volume ?? 1.0);
          }
        }
      }
    }
  }

  public setBpm(bpm: number): void {
    this.bpm = Math.max(30, Math.min(240, bpm));
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
        stroke.droneVoice.start(stroke.playhead.lastPitch.frequency, inst, stroke.volume ?? 1.0);
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
        s.droneVoice.start(s.playhead.lastPitch.frequency, inst, s.volume ?? 1.0);
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
    loopQuantize?: LoopQuantizeMode
  ): DrawnStroke {
    const lut = buildArcLengthLUT(path, 64);
    const id = `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const instrument = getInstrument(instrumentId);
    const strokeVolume = Math.max(0, Math.min(1, volume));
    const effectiveLoopQuantize = loopQuantize ?? this.quantizeMode;

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
      droneVoice.start(initialPitch.frequency, instrument, strokeVolume);
    }

    // Align initial playhead distance to measure downbeat if quantizing
    let initialDist = 0;
    if (effectiveLoopQuantize !== 'freeform' && lut.totalLength > 1) {
      const beatsPerBar = effectiveLoopQuantize === '1bar' ? 4 : effectiveLoopQuantize === '2bars' ? 8 : 16;
      const cycleDuration = beatsPerBar * (60 / this.bpm);
      const cycleDistance = this.traversalMode === 'pingpong' ? 2 * lut.totalLength : lut.totalLength;
      const strokeSpeed = cycleDistance / cycleDuration;
      const currentCycleDist = (this.masterClockTime * strokeSpeed) % cycleDistance;
      if (this.traversalMode === 'pingpong') {
        initialDist = currentCycleDist <= lut.totalLength ? currentCycleDist : 2 * lut.totalLength - currentCycleDist;
      } else {
        initialDist = (currentCycleDist % lut.totalLength + lut.totalLength) % lut.totalLength;
      }
    }

    const stroke: DrawnStroke = {
      id,
      color: instrument.color,
      instrumentId: instrument.id,
      style,
      path,
      lut,
      playhead: {
        currentDistance: initialDist,
        velocity: baseVelocity,
        direction: 1,
        lastTriggerDistance: initialDist,
        lastEval: initialEval,
        lastPitch: initialPitch,
        trail: [],
      },
      droneVoice,
      active: true,
      selected: false,
      hovered: false,
      muted: false,
      soloed: false,
      volume: strokeVolume,
      loopQuantize: effectiveLoopQuantize,
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

    // Immediately phase-align to musical downbeat if setting to quantized mode
    if (newLoopQuantize !== 'freeform' && stroke.lut.totalLength > 1) {
      const beatsPerBar = newLoopQuantize === '1bar' ? 4 : newLoopQuantize === '2bars' ? 8 : 16;
      const cycleDuration = beatsPerBar * (60 / this.bpm);
      const cycleDistance = this.traversalMode === 'pingpong' ? 2 * stroke.lut.totalLength : stroke.lut.totalLength;
      const strokeSpeed = cycleDistance / cycleDuration;
      const currentCycleDist = (this.masterClockTime * strokeSpeed) % cycleDistance;

      if (this.traversalMode === 'pingpong') {
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
  public hitTest(point: Point2D, tolerance = 24): DrawnStroke | null {
    let bestStroke: DrawnStroke | null = null;
    let bestDist = tolerance;

    for (let sIdx = this.strokes.length - 1; sIdx >= 0; sIdx--) {
      const stroke = this.strokes[sIdx];
      const segments = stroke.path.segments;

      for (const seg of segments) {
        let prevPt = evaluateBezier(seg, 0);
        for (let i = 1; i <= 20; i++) {
          const currPt = evaluateBezier(seg, i / 20);
          const d = distToSegment(point, prevPt, currPt);
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
        stroke.droneVoice.start(stroke.playhead.lastPitch.frequency, inst, stroke.volume ?? 1.0);
      }
    }
  }

  /**
   * Main per-frame update loop.
   */
  public update(dt: number, canvasWidth: number, canvasHeight: number, quantizer: ScaleQuantizer): void {
    if (this.isPaused || dt <= 0) return;

    this.masterClockTime += dt;

    const DOT_SPACING = 40;   // 1/8th note (2 triggers per beat)
    const STRIPE_SPACING = 20; // 1/16th note (4 triggers per beat)

    // Constant traversal velocity in pixels/second for freeform
    const freeformSpeed = (this.bpm / 60) * StrokeManager.BEAT_DISTANCE;

    for (const stroke of this.strokes) {
      if (!stroke.active) continue;

      const L = stroke.lut.totalLength;
      if (L <= 1) continue;

      const strokeQuantize = stroke.loopQuantize ?? this.quantizeMode;
      let strokeSpeed = freeformSpeed;

      if (strokeQuantize !== 'freeform') {
        const beatsPerCycle = strokeQuantize === '1bar' ? 4 : strokeQuantize === '2bars' ? 8 : 16;
        const cycleDuration = beatsPerCycle * (60 / this.bpm);
        const cycleDistance = this.traversalMode === 'pingpong' ? 2 * L : L;
        strokeSpeed = cycleDistance / cycleDuration;
      }

      const ph = stroke.playhead;
      ph.velocity = strokeSpeed;
      const deltaDist = ph.direction * strokeSpeed * dt;
      const prevDist = ph.currentDistance;
      let nextDist = prevDist + deltaDist;

      // Handle curve boundary
      if (stroke.lut.isClosed) {
        nextDist = ((nextDist % L) + L) % L;
      } else {
        if (this.traversalMode === 'restart') {
          if (nextDist >= L) {
            nextDist = nextDist % L;
          } else if (nextDist < 0) {
            nextDist = 0;
          }
          ph.direction = 1;
        } else {
          if (nextDist >= L) {
            nextDist = L - (nextDist - L);
            ph.direction = -1;
          } else if (nextDist <= 0) {
            nextDist = -nextDist;
            ph.direction = 1;
          }
        }
      }

      ph.currentDistance = nextDist;

      // 1. Evaluate position with Newton-Raphson refinement
      const evalResult = evaluateAtDistance(stroke.path, stroke.lut, nextDist, {
        useNewtonRaphson: true,
        newtonIterations: 1,
      });
      ph.lastEval = evalResult;

      // 2. Motion Trail
      ph.trail.unshift({ ...evalResult.point });
      if (ph.trail.length > 14) {
        ph.trail.pop();
      }

      // 3. Audio & Pitch evaluation (Respecting Volume, Mute & Solo)
      const audible = this.isStrokeAudible(stroke);
      const instrument = getInstrument(stroke.instrumentId);
      const strokeVol = stroke.volume ?? 1.0;

      if (stroke.style === 'solid') {
        const pitch = quantizer.quantizeContinuous(evalResult.point.y, canvasHeight);
        ph.lastPitch = pitch;

        if (audible) {
          if ((!stroke.droneVoice || !stroke.droneVoice.isPlaying) && soundEngine.isReady) {
            stroke.droneVoice = new DroneVoice();
            stroke.droneVoice.start(pitch.frequency, instrument, strokeVol);
          } else if (stroke.droneVoice) {
            stroke.droneVoice.update(
              pitch.frequency,
              evalResult.curvature,
              evalResult.point.x,
              canvasWidth,
              this.xModMode,
              strokeVol
            );
          }
        } else if (stroke.droneVoice) {
          stroke.droneVoice.stop();
          stroke.droneVoice = null;
        }
      } else if (stroke.style === 'dotted') {
        const pitch = quantizer.quantizeDiscrete(evalResult.point.y, canvasHeight);
        ph.lastPitch = pitch;

        const prevIndex = Math.floor(prevDist / DOT_SPACING);
        const nextIndex = Math.floor(nextDist / DOT_SPACING);

        if (prevIndex !== nextIndex && audible) {
          PulseVoice.trigger(
            pitch.frequency,
            false,
            0.85 * strokeVol,
            instrument,
            evalResult.point.x,
            canvasWidth,
            this.xModMode
          );
        }
      } else if (stroke.style === 'striped') {
        const pitch = quantizer.quantizeDiscrete(evalResult.point.y, canvasHeight);
        ph.lastPitch = pitch;

        const prevIndex = Math.floor(prevDist / STRIPE_SPACING);
        const nextIndex = Math.floor(nextDist / STRIPE_SPACING);

        if (prevIndex !== nextIndex && audible) {
          PulseVoice.trigger(
            pitch.frequency,
            true,
            0.7 * strokeVol,
            instrument,
            evalResult.point.x,
            canvasWidth,
            this.xModMode
          );
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
        action.stroke.droneVoice.start(action.stroke.playhead.lastPitch.frequency, inst);
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
    } else if (action.type === 'style') {
      this.setStrokeStyle(action.strokeId, action.oldStyle, false);
      this.redoStack.push(action);
    } else if (action.type === 'loopQuantize') {
      this.setStrokeLoopQuantize(action.strokeId, action.oldLoopQuantize, false);
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
        action.stroke.droneVoice.start(action.stroke.playhead.lastPitch.frequency, inst, action.stroke.volume ?? 1.0);
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
    } else if (action.type === 'style') {
      this.setStrokeStyle(action.strokeId, action.newStyle, false);
      this.undoStack.push(action);
    } else if (action.type === 'loopQuantize') {
      this.setStrokeLoopQuantize(action.strokeId, action.newLoopQuantize, false);
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
  }
}
