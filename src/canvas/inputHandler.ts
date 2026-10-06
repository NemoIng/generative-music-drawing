import { Point2D, SplinePath } from '../math/types';
import { fitSplineFromPoints } from '../math/curveFit';
import { soundEngine } from '../audio/audioContext';
import { StrokeManager } from '../engine/strokeManager';
import { ScaleQuantizer } from '../audio/scaleQuantizer';
import { DroneVoice, PulseVoice } from '../audio/synthVoice';
import { DrumSynth } from '../audio/drumSynth';
import { getInstrument } from '../audio/instruments';
import { StrokeStyle } from '../engine/types';

export type InteractionMode = 'draw' | 'edit';
export type AppMode = 'draw' | 'live';
export type DrawShape = 'curve' | 'straight';

export interface LiveTrailPoint {
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  time: number;
  noteName?: string;
  frequency?: number;
}

export interface InputHandlerOptions {
  onStrokeComplete: (path: SplinePath) => void;
  onDrawChange?: (points: Point2D[]) => void;
  onSelectStroke?: (strokeId: string | null) => void;
  strokeManager: StrokeManager;
  getQuantizer: () => ScaleQuantizer;
  getCurrentInstrument?: () => string;
  getCurrentStyle?: () => StrokeStyle;
  getXAxisModulation?: () => string;
}

export class InputHandler {
  private canvas: HTMLCanvasElement;
  private strokeManager: StrokeManager;
  private getQuantizer: () => ScaleQuantizer;
  private getCurrentInstrument?: () => string;
  private getCurrentStyle?: () => StrokeStyle;
  private getXAxisModulation?: () => string;
  private shape: DrawShape = 'curve';
  private snapPitch = false;
  private autoSmooth = true;
  private mode: AppMode = 'draw';

  // Live Play configurable parameters (Dynamic Reverb, Volume, Release, Snap, Trail)
  private liveReverb = 0.50;           // default standard 50%
  private liveVolume = 0.90;           // default 90%
  private liveReleaseTime = 0.40;      // default 0.40s
  private liveTrailLifetimeMs = 1000;  // default 1000ms
  private liveSnapToScale = false;     // scale lock toggle

  // Live Play runtime state
  private liveTrailPoints: LiveTrailPoint[] = [];
  private liveDroneVoice: DroneVoice | null = null;
  private isLivePointerDown = false;
  private lastLivePoint: Point2D | null = null;

  // Drawing state
  private isDrawing = false;
  private currentPoints: Point2D[] = [];
  private startPoint: Point2D | null = null;

  // Selected line dragging / repositioning state
  private isDragging = false;
  private draggedStrokeId: string | null = null;
  private dragStartPoint: Point2D | null = null;
  private lastDragPoint: Point2D | null = null;
  private dragAccumDx = 0;
  private dragAccumDy = 0;

  private onStrokeComplete: (path: SplinePath) => void;
  private onDrawChange?: (points: Point2D[]) => void;
  private onSelectStroke?: (strokeId: string | null) => void;

  constructor(canvas: HTMLCanvasElement, options: InputHandlerOptions) {
    this.canvas = canvas;
    this.strokeManager = options.strokeManager;
    this.getQuantizer = options.getQuantizer;
    this.getCurrentInstrument = options.getCurrentInstrument;
    this.getCurrentStyle = options.getCurrentStyle;
    this.getXAxisModulation = options.getXAxisModulation;
    this.onStrokeComplete = options.onStrokeComplete;
    this.onDrawChange = options.onDrawChange;
    this.onSelectStroke = options.onSelectStroke;

    this.initEvents();
  }

  public get currentMode(): InteractionMode {
    return this.strokeManager.selectedStrokeId ? 'edit' : 'draw';
  }

  public get appMode(): AppMode {
    return this.mode;
  }

  public setAppMode(mode: AppMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === 'live') {
      this.strokeManager.selectStroke(null);
      this.strokeManager.setHoveredStroke(null);
      this.onSelectStroke?.(null);
      this.isDrawing = false;
      this.currentPoints = [];
      this.onDrawChange?.(this.currentPoints);
      this.canvas.style.cursor = 'crosshair';
    } else {
      if (this.liveDroneVoice) {
        try { this.liveDroneVoice.stop(0.2); } catch {}
        this.liveDroneVoice = null;
      }
      this.isLivePointerDown = false;
      this.lastLivePoint = null;
      this.canvas.style.cursor = 'crosshair';
    }
  }

  public get liveTrail(): ReadonlyArray<LiveTrailPoint> {
    return this.liveTrailPoints;
  }

  public get liveReverbSend(): number {
    return this.liveReverb;
  }

  public setLiveReverb(val: number): void {
    this.liveReverb = Math.max(0, Math.min(1, val));
  }

  public get liveVolumeLevel(): number {
    return this.liveVolume;
  }

  public setLiveVolume(val: number): void {
    this.liveVolume = Math.max(0, Math.min(1, val));
  }

  public get liveRelease(): number {
    return this.liveReleaseTime;
  }

  public setLiveReleaseTime(seconds: number): void {
    this.liveReleaseTime = Math.max(0.05, Math.min(3.0, seconds));
  }

  public get liveTrailLifetime(): number {
    return this.liveTrailLifetimeMs;
  }

  public setLiveTrailLifetime(ms: number): void {
    this.liveTrailLifetimeMs = Math.max(200, Math.min(4000, ms));
  }

  public get isLiveSnapToScale(): boolean {
    return this.liveSnapToScale;
  }

  public setLiveSnapToScale(snap: boolean): void {
    this.liveSnapToScale = snap;
  }

  public pruneLiveTrail(nowMs: number, maxLifetimeMs = this.liveTrailLifetimeMs): void {
    this.liveTrailPoints = this.liveTrailPoints.filter((p) => nowMs - p.time <= maxLifetimeMs);
  }

  public clearLiveTrail(): void {
    this.liveTrailPoints = [];
  }

  /**
   * Compatibility setter: allows resetting selection if 'draw' is passed.
   */
  public setMode(mode: InteractionMode): void {
    if (mode === 'draw') {
      this.strokeManager.selectStroke(null);
      this.strokeManager.setHoveredStroke(null);
      this.onSelectStroke?.(null);
      this.canvas.style.cursor = 'crosshair';
    }
  }

  public get drawShape(): DrawShape {
    return this.shape;
  }

  public get isPitchSnapped(): boolean {
    return this.snapPitch;
  }

  public setDrawShape(shape: DrawShape): void {
    this.shape = shape;
  }

  public setSnapPitch(snap: boolean): void {
    this.snapPitch = snap;
  }

  public get isAutoSmooth(): boolean {
    return this.autoSmooth;
  }

  public setAutoSmooth(smooth: boolean): void {
    this.autoSmooth = smooth;
  }

  public get points(): ReadonlyArray<Point2D> {
    return this.currentPoints;
  }

  private initEvents(): void {
    const el = this.canvas;
    el.style.cursor = 'crosshair';

    el.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);
    el.addEventListener('pointerleave', this.handlePointerLeave);

    el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  public destroy(): void {
    const el = this.canvas;
    el.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerUp);
    el.removeEventListener('pointerleave', this.handlePointerLeave);
  }

  private getCanvasPoint(e: PointerEvent, applySnap: boolean = true): Point2D {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const isOnyx = this.getCurrentInstrument?.() === 'onyx';

    let y: number;
    if (isOnyx) {
      // Drum boundaries and drum strokes are fixed to the screen
      y = screenY;
      if (applySnap && this.snapPitch) {
        // Snap to center of fixed drum boundaries: Hi-Hat, Tom, Snare/Clap, Kick
        const drumSnapYs = [rect.height * 0.16, rect.height * 0.36, rect.height * 0.60, rect.height * 0.84];
        let closestY = y;
        let minDiff = 30;
        for (const snapY of drumSnapYs) {
          const diff = Math.abs(snapY - y);
          if (diff < minDiff) {
            minDiff = diff;
            closestY = snapY;
          }
        }
        y = closestY;
      }
    } else {
      const quantizer = this.getQuantizer();
      y = quantizer.screenToWorldY(screenY, rect.height);

      // Magnetic Pitch Snapping (only applied when drawing a new line)
      if (applySnap && this.snapPitch) {
        const guidelines = quantizer.getAllGuidelines(rect.height);
        let closestY = y;
        let minDiff = 20;

        for (const g of guidelines) {
          const diff = Math.abs(g.y - y);
          if (diff < minDiff) {
            minDiff = diff;
            closestY = g.y;
          }
        }
        y = closestY;
      }
    }

    return { x, y };
  }

  private handlePointerDown = (e: PointerEvent): void => {
    // Only respond to primary (left) mouse clicks / touches
    if (e.button !== undefined && e.button !== 0) return;

    if (!soundEngine.isReady) {
      soundEngine.init().then(() => {
        this.strokeManager.activateAudioVoices();
      }).catch(() => {});
    }

    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const quantizer = this.getQuantizer();
    const screenPt: Point2D = { x: screenX, y: screenY };
    const worldPt: Point2D = { x: screenX, y: quantizer.screenToWorldY(screenY, rect.height) };

    // ========================================================
    // A. LIVE PLAY MODE: Click to play note, drag disappearing trail
    // ========================================================
    if (this.mode === 'live') {
      this.isLivePointerDown = true;
      const instId = this.getCurrentInstrument?.() || 'indigo';
      const instrument = getInstrument(instId);
      const style = this.getCurrentStyle?.() || 'solid';
      const LIVE_REVERB = this.liveReverb;
      const LIVE_VOLUME = this.liveVolume;
      const isScaleSnapped = this.snapPitch || this.liveSnapToScale;
      const xAxisMod = (this.getXAxisModulation?.() as any) || 'panAndTone';

      let noteName = '';
      let frequency = 0;

      if (instId === 'onyx') {
        const normY = rect.height > 0 ? screenY / rect.height : 0.5;
        if (normY >= 0.72) {
          DrumSynth.triggerKick(LIVE_VOLUME, screenX, rect.width, xAxisMod, 0, LIVE_REVERB);
          noteName = 'Kick';
          frequency = 55;
        } else if (normY >= 0.48) {
          DrumSynth.triggerSnare(LIVE_VOLUME * 0.95, screenX, rect.width, xAxisMod, 0, LIVE_REVERB);
          noteName = 'Snare';
          frequency = 180;
        } else if (normY >= 0.25) {
          const tomFreq = 100 + (1 - (normY - 0.25) / 0.23) * 120;
          DrumSynth.triggerTom(tomFreq, LIVE_VOLUME * 0.9, screenX, rect.width, xAxisMod, 0, LIVE_REVERB);
          noteName = 'Tom';
          frequency = tomFreq;
        } else {
          DrumSynth.triggerHiHat(true, LIVE_VOLUME * 0.9, screenX, rect.width, xAxisMod, 0, LIVE_REVERB);
          noteName = 'HiHat';
          frequency = 8000;
        }
      } else {
        const pitch = isScaleSnapped
          ? quantizer.quantizeDiscrete(worldPt.y, rect.height)
          : quantizer.quantizeContinuous(worldPt.y, rect.height);
        noteName = pitch.noteName;
        frequency = pitch.frequency;

        if (style === 'dotted') {
          PulseVoice.trigger(pitch.frequency, false, LIVE_VOLUME, instrument, screenX, rect.width, xAxisMod, 0, LIVE_REVERB);
        } else if (style === 'striped') {
          PulseVoice.triggerRatchet(pitch.frequency, LIVE_VOLUME * 0.95, instrument, screenX, rect.width, xAxisMod, LIVE_REVERB);
        } else {
          // Solid legato live voice
          if (this.liveDroneVoice) {
            try { this.liveDroneVoice.stop(0.05); } catch {}
          }
          try {
            this.liveDroneVoice = new DroneVoice();
            this.liveDroneVoice.start(pitch.frequency, instrument, LIVE_VOLUME, LIVE_REVERB);
          } catch {
            this.liveDroneVoice = null;
          }
        }
      }

      this.lastLivePoint = { x: screenX, y: screenY };
      this.liveTrailPoints.push({
        x: screenX,
        y: screenY,
        screenX,
        screenY,
        time: performance.now(),
        noteName,
        frequency,
      });

      this.canvas.style.cursor = 'crosshair';
      return;
    }

    // ========================================================
    // B. DRAW MODE: Normal score drawing and line selection
    // ========================================================
    // Hit test lines: Onyx lines against screen coordinates, melodic lines against world coordinates
    const hit = this.strokeManager.hitTest(screenPt, 22, worldPt);

    if (hit) {
      // Direct click on a line: immediately select it for modifications!
      this.strokeManager.selectStroke(hit.id);
      this.onSelectStroke?.(hit.id);

      // Prepare for potential reposition dragging
      const hitPt = hit.instrumentId === 'onyx' ? screenPt : worldPt;
      this.draggedStrokeId = hit.id;
      this.dragStartPoint = hitPt;
      this.lastDragPoint = hitPt;
      this.isDragging = false;
      this.dragAccumDx = 0;
      this.dragAccumDy = 0;
      this.isDrawing = false;
      this.canvas.style.cursor = 'grab';
      return;
    }

    // Clicked on empty canvas: initialize drawing gesture
    const drawPt = this.getCanvasPoint(e, true);
    this.isDrawing = true;
    this.startPoint = drawPt;
    this.currentPoints = [drawPt];
    this.draggedStrokeId = null;
    this.isDragging = false;
    this.onDrawChange?.(this.currentPoints);
    this.canvas.style.cursor = 'crosshair';
  };

  private handlePointerMove = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const quantizer = this.getQuantizer();
    const screenPt: Point2D = { x: screenX, y: screenY };
    const worldPt: Point2D = { x: screenX, y: quantizer.screenToWorldY(screenY, rect.height) };

    // ========================================================
    // A. LIVE PLAY MODE: Dragging leaves disappearing line & updates note
    // ========================================================
    if (this.mode === 'live') {
      if (!this.isLivePointerDown) {
        this.canvas.style.cursor = 'crosshair';
        return;
      }

      const instId = this.getCurrentInstrument?.() || 'indigo';
      const instrument = getInstrument(instId);
      const style = this.getCurrentStyle?.() || 'solid';

      const LIVE_REVERB = this.liveReverb;
      const LIVE_VOLUME = this.liveVolume;
      const isScaleSnapped = this.snapPitch || this.liveSnapToScale;
      const xAxisMod = (this.getXAxisModulation?.() as any) || 'panAndTone';
      const dist = this.lastLivePoint
        ? Math.hypot(screenX - this.lastLivePoint.x, screenY - this.lastLivePoint.y)
        : 0;

      let noteName = '';
      let frequency = 0;

      if (instId === 'onyx') {
        const normY = rect.height > 0 ? screenY / rect.height : 0.5;
        if (normY >= 0.72) noteName = 'Kick';
        else if (normY >= 0.48) noteName = 'Snare';
        else if (normY >= 0.25) noteName = 'Tom';
        else noteName = 'HiHat';

        if (dist >= 35) {
          if (normY >= 0.72) DrumSynth.triggerKick(LIVE_VOLUME, screenX, rect.width, xAxisMod, 0, LIVE_REVERB);
          else if (normY >= 0.48) DrumSynth.triggerSnare(LIVE_VOLUME * 0.95, screenX, rect.width, xAxisMod, 0, LIVE_REVERB);
          else if (normY >= 0.25) {
            const tomFreq = 100 + (1 - (normY - 0.25) / 0.23) * 120;
            DrumSynth.triggerTom(tomFreq, LIVE_VOLUME * 0.9, screenX, rect.width, xAxisMod, 0, LIVE_REVERB);
          } else DrumSynth.triggerHiHat(true, LIVE_VOLUME * 0.9, screenX, rect.width, xAxisMod, 0, LIVE_REVERB);
          this.lastLivePoint = { x: screenX, y: screenY };
        }
      } else {
        const pitch = isScaleSnapped
          ? quantizer.quantizeDiscrete(worldPt.y, rect.height)
          : quantizer.quantizeContinuous(worldPt.y, rect.height);
        noteName = pitch.noteName;
        frequency = pitch.frequency;

        if (style === 'dotted') {
          if (dist >= 35) {
            PulseVoice.trigger(pitch.frequency, false, LIVE_VOLUME, instrument, screenX, rect.width, xAxisMod, 0, LIVE_REVERB);
            this.lastLivePoint = { x: screenX, y: screenY };
          }
        } else if (style === 'striped') {
          if (dist >= 35) {
            PulseVoice.triggerRatchet(pitch.frequency, LIVE_VOLUME * 0.95, instrument, screenX, rect.width, xAxisMod, LIVE_REVERB);
            this.lastLivePoint = { x: screenX, y: screenY };
          }
        } else {
          // Solid legato update
          if (this.liveDroneVoice && this.liveDroneVoice.isPlaying) {
            // Calculate curvature from recent points
            let curvature = 0;
            const len = this.liveTrailPoints.length;
            if (len >= 3) {
              const p1 = this.liveTrailPoints[len - 2];
              const p0 = this.liveTrailPoints[len - 3];
              const dx1 = screenX - p1.x;
              const dy1 = screenY - p1.y;
              const dx0 = p1.x - p0.x;
              const dy0 = p1.y - p0.y;
              const angle1 = Math.atan2(dy1, dx1);
              const angle0 = Math.atan2(dy0, dx0);
              let dAngle = Math.abs(angle1 - angle0);
              if (dAngle > Math.PI) dAngle = 2 * Math.PI - dAngle;
              curvature = Math.min(1, dAngle / Math.PI);
            }

            try {
              this.liveDroneVoice.updateDual(
                pitch.freqA ?? pitch.freq1 ?? pitch.frequency,
                pitch.freqB ?? pitch.freq2 ?? pitch.frequency,
                pitch.gainA ?? 1.0,
                pitch.gainB ?? 0.0,
                curvature,
                screenX,
                rect.width,
                xAxisMod,
                LIVE_VOLUME
              );
            } catch {}
          }
          if (dist >= 4) {
            this.lastLivePoint = { x: screenX, y: screenY };
          }
        }
      }

      if (dist >= 3 || this.liveTrailPoints.length === 0) {
        this.liveTrailPoints.push({
          x: screenX,
          y: screenY,
          screenX,
          screenY,
          time: performance.now(),
          noteName,
          frequency,
        });
      }

      this.canvas.style.cursor = 'crosshair';
      return;
    }

    // ========================================================
    // B. DRAW MODE: Normal pointer move
    // ========================================================
    // 1. If dragging an existing selected stroke to reposition it
    if (this.draggedStrokeId) {
      const draggedStroke = this.strokeManager.activeStrokes.find((s) => s.id === this.draggedStrokeId);
      const isOnyx = draggedStroke?.instrumentId === 'onyx';
      const rawPt = isOnyx ? screenPt : worldPt;
      const dist = this.dragStartPoint
        ? Math.hypot(rawPt.x - this.dragStartPoint.x, rawPt.y - this.dragStartPoint.y)
        : 0;

      if (dist >= 5 || this.isDragging) {
        this.isDragging = true;
        if (this.lastDragPoint) {
          const dx = rawPt.x - this.lastDragPoint.x;
          const dy = rawPt.y - this.lastDragPoint.y;
          this.strokeManager.translateStroke(this.draggedStrokeId, dx, dy, false);
          this.dragAccumDx += dx;
          this.dragAccumDy += dy;
          this.lastDragPoint = rawPt;
          this.canvas.style.cursor = 'grabbing';
        }
      }
      return;
    }

    // 2. If actively drawing a new stroke
    if (this.isDrawing) {
      // If a previous stroke was selected, deselect it as the user starts drawing
      if (this.strokeManager.selectedStrokeId) {
        this.strokeManager.selectStroke(null);
        this.onSelectStroke?.(null);
      }

      const rawPt = this.getCanvasPoint(e, true);
      const isStraight = this.shape === 'straight' || e.shiftKey;
      const pt: Point2D = isStraight && this.startPoint
        ? { x: rawPt.x, y: this.startPoint.y }
        : rawPt;

      const last = this.currentPoints[this.currentPoints.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) >= 4) {
        if (isStraight && this.startPoint) {
          this.currentPoints = [
            { ...this.startPoint },
            { x: (this.startPoint.x + pt.x) / 2, y: this.startPoint.y },
            { ...pt },
          ];
        } else {
          this.currentPoints.push(pt);
        }
        this.onDrawChange?.(this.currentPoints);
      }
      return;
    }

    // 3. Hover state over canvas (no pointer buttons pressed)
    const hit = this.strokeManager.hitTest(screenPt, 22, worldPt);
    this.strokeManager.setHoveredStroke(hit ? hit.id : null);
    this.canvas.style.cursor = hit ? 'pointer' : 'crosshair';
  };

  private handlePointerLeave = (): void => {
    if (this.mode === 'live') {
      this.isLivePointerDown = false;
      this.lastLivePoint = null;
      if (this.liveDroneVoice) {
        try { this.liveDroneVoice.stop(this.liveReleaseTime); } catch {}
        this.liveDroneVoice = null;
      }
      return;
    }

    if (!this.isDrawing && !this.isDragging) {
      this.strokeManager.setHoveredStroke(null);
    }
  };

  private handlePointerUp = (): void => {
    // Live Play mode: release live voice
    if (this.mode === 'live') {
      this.isLivePointerDown = false;
      this.lastLivePoint = null;
      if (this.liveDroneVoice) {
        try { this.liveDroneVoice.stop(this.liveReleaseTime); } catch {}
        this.liveDroneVoice = null;
      }
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    // 1. If dragging an existing stroke, finalize translation with undo entry
    if (this.isDragging && this.draggedStrokeId) {
      if (Math.abs(this.dragAccumDx) > 0.5 || Math.abs(this.dragAccumDy) > 0.5) {
        this.strokeManager.translateStroke(this.draggedStrokeId, 0, 0, true);
      }
      this.isDragging = false;
      this.draggedStrokeId = null;
      this.lastDragPoint = null;
      this.dragStartPoint = null;
      this.canvas.style.cursor = 'pointer';
      return;
    }

    // 2. If clicked a stroke without dragging, it remains selected
    if (this.draggedStrokeId) {
      this.draggedStrokeId = null;
      this.lastDragPoint = null;
      this.dragStartPoint = null;
      this.canvas.style.cursor = 'pointer';
      return;
    }

    // 3. If drawing
    if (this.isDrawing) {
      this.isDrawing = false;
      const last = this.currentPoints[this.currentPoints.length - 1];
      const dist = this.startPoint && last ? Math.hypot(last.x - this.startPoint.x, last.y - this.startPoint.y) : 0;

      if (this.currentPoints.length >= 2 && dist >= 8) {
        // Real stroke was drawn!
        const spline = fitSplineFromPoints(this.currentPoints, 45, this.autoSmooth);
        if (spline && spline.segments.length > 0) {
          this.onStrokeComplete(spline);
        }
      } else {
        // Tap on empty canvas without dragging: deselect any active stroke
        if (this.strokeManager.selectedStrokeId) {
          this.strokeManager.selectStroke(null);
          this.onSelectStroke?.(null);
        }
      }

      this.currentPoints = [];
      this.startPoint = null;
      this.onDrawChange?.(this.currentPoints);
      this.canvas.style.cursor = 'crosshair';
    }
  };
}
