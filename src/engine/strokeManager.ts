import { SplinePath, Point2D } from '../math/types';
import { buildArcLengthLUT } from '../math/arcLengthTable';
import { evaluateAtDistance } from '../math/arcLengthInverter';
import { evaluateBezier } from '../math/bezier';
import { ScaleQuantizer } from '../audio/scaleQuantizer';
import { DroneVoice, PulseVoice, XAxisModulationMode } from '../audio/synthVoice';
import { getInstrument, DEFAULT_INSTRUMENT } from '../audio/instruments';
import { soundEngine } from '../audio/audioContext';
import { DrawnStroke, StrokeStyle, TraversalMode } from './types';

type UndoAction =
  | { type: 'add'; stroke: DrawnStroke }
  | { type: 'remove'; stroke: DrawnStroke; index: number }
  | { type: 'move'; strokeId: string; dx: number; dy: number }
  | { type: 'revoice'; strokeId: string; oldInstrumentId: string; newInstrumentId: string };

export class StrokeManager {
  private strokes: DrawnStroke[] = [];
  private isPaused = false;
  private bpm = 100;
  private traversalMode: TraversalMode = 'restart';
  private xModMode: XAxisModulationMode = 'panAndTone';
  private selectedId: string | null = null;
  private hoveredId: string | null = null;

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

  public get selectedStrokeId(): string | null {
    return this.selectedId;
  }

  public get hoveredStrokeId(): string | null {
    return this.hoveredId;
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

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
    if (this.isPaused) {
      for (const stroke of this.strokes) {
        if (stroke.droneVoice) {
          stroke.droneVoice.stop();
        }
      }
    } else {
      for (const stroke of this.strokes) {
        if (stroke.style === 'solid' && soundEngine.isReady && stroke.playhead.lastPitch) {
          const inst = getInstrument(stroke.instrumentId);
          stroke.droneVoice = new DroneVoice();
          stroke.droneVoice.start(stroke.playhead.lastPitch.frequency, inst);
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

  public addStroke(
    path: SplinePath,
    style: StrokeStyle,
    instrumentId: string = DEFAULT_INSTRUMENT.id,
    baseVelocity: number = 140,
    quantizer?: ScaleQuantizer,
    canvasHeight?: number
  ): DrawnStroke {
    const lut = buildArcLengthLUT(path, 64);
    const id = `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const instrument = getInstrument(instrumentId);

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
      droneVoice.start(initialPitch.frequency, instrument);
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
      },
      droneVoice,
      active: true,
      selected: false,
      hovered: false,
    };

    this.strokes.push(stroke);
    this.undoStack.push({ type: 'add', stroke });
    this.redoStack = [];
    return stroke;
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
   * Translates an existing stroke by (dx, dy).
   * Rigid translation preserves arc length identically, keeping LUT valid.
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

    if (recordUndo) {
      this.undoStack.push({ type: 'move', strokeId: id, dx, dy });
      this.redoStack = [];
    }

    return true;
  }

  /**
   * Hit tests canvas coordinates against all strokes.
   */
  public hitTest(point: Point2D, tolerance = 18): DrawnStroke | null {
    for (let sIdx = this.strokes.length - 1; sIdx >= 0; sIdx--) {
      const stroke = this.strokes[sIdx];
      const segments = stroke.path.segments;

      for (const seg of segments) {
        // Sample 10 points along cubic segment
        for (let i = 0; i <= 10; i++) {
          const t = i / 10;
          const pt = evaluateBezier(seg, t);
          if (Math.hypot(pt.x - point.x, pt.y - point.y) <= tolerance) {
            return stroke;
          }
        }
      }
    }
    return null;
  }

  /**
   * Activates audio voices once AudioContext unlocks.
   */
  public activateAudioVoices(): void {
    if (!soundEngine.isReady || this.isPaused) return;

    for (const stroke of this.strokes) {
      if (stroke.style === 'solid' && !stroke.droneVoice && stroke.playhead.lastPitch) {
        const inst = getInstrument(stroke.instrumentId);
        stroke.droneVoice = new DroneVoice();
        stroke.droneVoice.start(stroke.playhead.lastPitch.frequency, inst);
      }
    }
  }

  /**
   * Main per-frame update loop.
   * Handles constant-velocity traversal, Y pitch quantization, and X stereo/timbre modulation.
   */
  public update(dt: number, canvasWidth: number, canvasHeight: number, quantizer: ScaleQuantizer): void {
    if (this.isPaused || dt <= 0) return;

    const DOT_SPACING = 40;   // 1/8th note (2 triggers per beat)
    const STRIPE_SPACING = 20; // 1/16th note (4 triggers per beat)

    // Constant traversal velocity in pixels/second
    const speed = (this.bpm / 60) * StrokeManager.BEAT_DISTANCE;

    for (const stroke of this.strokes) {
      if (!stroke.active) continue;

      const L = stroke.lut.totalLength;
      if (L <= 1) continue;

      const ph = stroke.playhead;
      const deltaDist = ph.direction * speed * dt;
      const prevDist = ph.currentDistance;
      let nextDist = prevDist + deltaDist;

      // Handle curve boundary
      if (stroke.lut.isClosed) {
        nextDist = ((nextDist % L) + L) % L;
      } else {
        if (this.traversalMode === 'restart') {
          // One-way traversal: always journeys start -> end, then immediately restarts from start
          if (nextDist >= L) {
            nextDist = nextDist % L;
          } else if (nextDist < 0) {
            nextDist = 0;
          }
          ph.direction = 1;
        } else {
          // Ping-Pong bounce
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

      // 3. Audio & Pitch evaluation (Y -> Pitch, X -> Stereo Pan & Timbre)
      const instrument = getInstrument(stroke.instrumentId);

      if (stroke.style === 'solid') {
        const pitch = quantizer.quantizeContinuous(evalResult.point.y, canvasHeight);
        ph.lastPitch = pitch;

        if (!stroke.droneVoice && soundEngine.isReady) {
          stroke.droneVoice = new DroneVoice();
          stroke.droneVoice.start(pitch.frequency, instrument);
        } else if (stroke.droneVoice) {
          stroke.droneVoice.update(
            pitch.frequency,
            evalResult.curvature,
            evalResult.point.x,
            canvasWidth,
            this.xModMode
          );
        }
      } else if (stroke.style === 'dotted') {
        const pitch = quantizer.quantizeDiscrete(evalResult.point.y, canvasHeight);
        ph.lastPitch = pitch;

        const prevIndex = Math.floor(prevDist / DOT_SPACING);
        const nextIndex = Math.floor(nextDist / DOT_SPACING);

        if (prevIndex !== nextIndex) {
          PulseVoice.trigger(
            pitch.frequency,
            false,
            0.85,
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

        if (prevIndex !== nextIndex) {
          PulseVoice.trigger(
            pitch.frequency,
            true,
            0.7,
            instrument,
            evalResult.point.x,
            canvasWidth,
            this.xModMode
          );
        }
      }
    }
  }

  /**
   * Undo last action (draw, move, remove, revoice).
   */
  public undo(): boolean {
    const action = this.undoStack.pop();
    if (!action) return false;

    if (action.type === 'add') {
      const idx = this.strokes.findIndex((s) => s.id === action.stroke.id);
      if (idx !== -1) {
        const [removed] = this.strokes.splice(idx, 1);
        removed.droneVoice?.stop();
        if (this.selectedId === removed.id) this.selectedId = null;
        this.redoStack.push({ type: 'add', stroke: removed });
      }
    } else if (action.type === 'remove') {
      this.strokes.splice(action.index, 0, action.stroke);
      if (action.stroke.style === 'solid' && soundEngine.isReady && action.stroke.playhead.lastPitch) {
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
    }

    return true;
  }

  /**
   * Redo previously undone action.
   */
  public redo(): boolean {
    const action = this.redoStack.pop();
    if (!action) return false;

    if (action.type === 'add') {
      this.strokes.push(action.stroke);
      if (action.stroke.style === 'solid' && soundEngine.isReady && action.stroke.playhead.lastPitch) {
        const inst = getInstrument(action.stroke.instrumentId);
        action.stroke.droneVoice = new DroneVoice();
        action.stroke.droneVoice.start(action.stroke.playhead.lastPitch.frequency, inst);
      }
      this.undoStack.push(action);
    } else if (action.type === 'remove') {
      const idx = this.strokes.findIndex((s) => s.id === action.stroke.id);
      if (idx !== -1) {
        const [removed] = this.strokes.splice(idx, 1);
        removed.droneVoice?.stop();
        if (this.selectedId === removed.id) this.selectedId = null;
        this.undoStack.push(action);
      }
    } else if (action.type === 'move') {
      this.translateStroke(action.strokeId, action.dx, action.dy, false);
      this.undoStack.push(action);
    } else if (action.type === 'revoice') {
      this.revoiceStroke(action.strokeId, action.newInstrumentId, false);
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
      this.undoStack.push({ type: 'remove', stroke, index: idx });
      this.redoStack = [];
      if (this.selectedId === id) this.selectedId = null;
    }
  }

  public clearAll(): void {
    for (const stroke of this.strokes) {
      stroke.droneVoice?.stop();
    }
    this.strokes = [];
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    this.hoveredId = null;
  }
}
