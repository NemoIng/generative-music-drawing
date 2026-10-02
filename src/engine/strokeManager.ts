import { SplinePath } from '../math/types';
import { buildArcLengthLUT } from '../math/arcLengthTable';
import { evaluateAtDistance } from '../math/arcLengthInverter';
import { ScaleQuantizer } from '../audio/scaleQuantizer';
import { DroneVoice, PulseVoice } from '../audio/synthVoice';
import { soundEngine } from '../audio/audioContext';
import { DrawnStroke, StrokeStyle } from './types';

export class StrokeManager {
  private strokes: DrawnStroke[] = [];
  private isPaused = false;
  private bpm = 100;
  /** Pixel distance representing one quarter note beat */
  public static readonly BEAT_DISTANCE = 80;

  public get activeStrokes(): ReadonlyArray<DrawnStroke> {
    return this.strokes;
  }

  public get currentBpm(): number {
    return this.bpm;
  }

  public get paused(): boolean {
    return this.isPaused;
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
      // Resume drone voices if audio is ready
      for (const stroke of this.strokes) {
        if (stroke.style === 'solid' && soundEngine.isReady && stroke.playhead.lastPitch) {
          stroke.droneVoice = new DroneVoice();
          stroke.droneVoice.start(stroke.playhead.lastPitch.frequency);
        }
      }
    }
  }

  public setBpm(bpm: number): void {
    this.bpm = Math.max(30, Math.min(240, bpm));
  }

  public setVelocityMultiplier(mult: number): void {
    this.bpm = Math.round(100 * mult);
  }

  public addStroke(
    path: SplinePath,
    style: StrokeStyle,
    color: string,
    baseVelocity: number = 140,
    quantizer?: ScaleQuantizer,
    canvasHeight?: number
  ): DrawnStroke {
    const lut = buildArcLengthLUT(path, 64);
    const id = `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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
      droneVoice.start(initialPitch.frequency);
    }

    const stroke: DrawnStroke = {
      id,
      color,
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
    };

    this.strokes.push(stroke);
    return stroke;
  }

  /**
   * Initializes audio on any existing solid strokes once the audio engine unlocks.
   */
  public activateAudioVoices(): void {
    if (!soundEngine.isReady || this.isPaused) return;

    for (const stroke of this.strokes) {
      if (stroke.style === 'solid' && !stroke.droneVoice && stroke.playhead.lastPitch) {
        stroke.droneVoice = new DroneVoice();
        stroke.droneVoice.start(stroke.playhead.lastPitch.frequency);
      }
    }
  }

  /**
   * Main per-frame update loop.
   */
  public update(dt: number, canvasHeight: number, quantizer: ScaleQuantizer): void {
    if (this.isPaused || dt <= 0) return;

    // Synchronized rhythmic subdivisions (80px = quarter note)
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

      // Handle curve boundary (closed loop wrap vs open ping-pong)
      if (stroke.lut.isClosed) {
        nextDist = ((nextDist % L) + L) % L;
      } else {
        if (nextDist >= L) {
          nextDist = L - (nextDist - L);
          ph.direction = -1;
        } else if (nextDist <= 0) {
          nextDist = -nextDist;
          ph.direction = 1;
        }
      }

      ph.currentDistance = nextDist;

      // 1. Evaluate position with Newton-Raphson refinement
      const evalResult = evaluateAtDistance(stroke.path, stroke.lut, nextDist, {
        useNewtonRaphson: true,
        newtonIterations: 1,
      });
      ph.lastEval = evalResult;

      // 2. Motion Trail update
      ph.trail.unshift({ ...evalResult.point });
      if (ph.trail.length > 14) {
        ph.trail.pop();
      }

      // 3. Audio & Pitch evaluation
      if (stroke.style === 'solid') {
        const pitch = quantizer.quantizeContinuous(evalResult.point.y, canvasHeight);
        ph.lastPitch = pitch;

        if (!stroke.droneVoice && soundEngine.isReady) {
          stroke.droneVoice = new DroneVoice();
          stroke.droneVoice.start(pitch.frequency);
        } else if (stroke.droneVoice) {
          stroke.droneVoice.update(pitch.frequency, evalResult.curvature);
        }
      } else if (stroke.style === 'dotted') {
        const pitch = quantizer.quantizeDiscrete(evalResult.point.y, canvasHeight);
        ph.lastPitch = pitch;

        // Check if playhead crossed dot boundary
        const prevIndex = Math.floor(prevDist / DOT_SPACING);
        const nextIndex = Math.floor(nextDist / DOT_SPACING);

        if (prevIndex !== nextIndex) {
          PulseVoice.trigger(pitch.frequency, false, 0.85);
        }
      } else if (stroke.style === 'striped') {
        const pitch = quantizer.quantizeDiscrete(evalResult.point.y, canvasHeight);
        ph.lastPitch = pitch;

        // Check if playhead crossed stripe boundary
        const prevIndex = Math.floor(prevDist / STRIPE_SPACING);
        const nextIndex = Math.floor(nextDist / STRIPE_SPACING);

        if (prevIndex !== nextIndex) {
          PulseVoice.trigger(pitch.frequency, true, 0.7);
        }
      }
    }
  }

  public removeStroke(id: string): void {
    const idx = this.strokes.findIndex((s) => s.id === id);
    if (idx !== -1) {
      const stroke = this.strokes[idx];
      if (stroke.droneVoice) {
        stroke.droneVoice.stop();
      }
      this.strokes.splice(idx, 1);
    }
  }

  public clearAll(): void {
    for (const stroke of this.strokes) {
      if (stroke.droneVoice) {
        stroke.droneVoice.stop();
      }
    }
    this.strokes = [];
  }
}
