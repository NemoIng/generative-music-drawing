import { Point2D, SplinePath } from '../math/types';
import { fitSplineFromPoints } from '../math/curveFit';
import { soundEngine } from '../audio/audioContext';
import { StrokeManager } from '../engine/strokeManager';
import { ScaleQuantizer } from '../audio/scaleQuantizer';
import { DroneVoice, PulseVoice, XAxisModulationMode } from '../audio/synthVoice';
import { DrumSynth } from '../audio/drumSynth';
import { DrumZone, resolveDrumZone } from '../audio/drumMapping';
import { getInstrument } from '../audio/instruments';
import { StrokeStyle } from '../engine/types';

export type InteractionMode = 'draw' | 'edit';
export type AppMode = 'draw' | 'redraw' | 'live';
export type DrawShape = 'curve' | 'straight' | 'point';

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
  onStrokeComplete: (path: SplinePath, isPoint?: boolean) => void;
  onStrokeRedraw?: (strokeId: string, path: SplinePath) => void;
  onRedrawStart?: (strokeId: string) => void;
  onRedrawStateChange?: (isArmed: boolean) => void;
  onDrawChange?: (points: Point2D[]) => void;
  onSelectStroke?: (strokeId: string | null) => void;
  onStrokeTranslateEnd?: () => void;
  onPointerDown?: () => void;
  onMarqueeSelect?: (rect: { x1: number; y1: number; x2: number; y2: number }) => void;
  onDuplicateDragStart?: (strokeIds: string[]) => string[];
  onPinchOctaveZoom?: (scaleFactor: number) => void;
  onTwoFingerScrollY?: (deltaY: number) => void;
  strokeManager: StrokeManager;
  getQuantizer: () => ScaleQuantizer;
  getCurrentInstrument?: () => string;
  getCurrentStyle?: () => StrokeStyle;
  getXAxisModulation?: () => XAxisModulationMode;
}

export class InputHandler {
  private canvas: HTMLCanvasElement;
  private strokeManager: StrokeManager;
  private getQuantizer: () => ScaleQuantizer;
  private getCurrentInstrument?: () => string;
  private getCurrentStyle?: () => StrokeStyle;
  private getXAxisModulation?: () => XAxisModulationMode;
  private onPointerDownCallback?: () => void;
  private onStrokeTranslateEnd?: () => void;
  private onMarqueeSelect?: (rect: { x1: number; y1: number; x2: number; y2: number }) => void;
  private onDuplicateDragStart?: (strokeIds: string[]) => string[];
  private onPinchOctaveZoom?: (scaleFactor: number) => void;
  private onTwoFingerScrollY?: (deltaY: number) => void;
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
  private livePointerSessionId = 0;

  // Drawing state
  private isDrawing = false;
  private currentPoints: Point2D[] = [];
  private startPoint: Point2D | null = null;

  // Selected line dragging / repositioning state
  private isDragging = false;
  private isDuplicateDragging = false;
  private draggedStrokeId: string | null = null;
  private dragStartPoint: Point2D | null = null;
  private lastDragPoint: Point2D | null = null;
  private dragAccumDx = 0;
  private dragAccumDy = 0;

  // Marquee multi-selection state
  private isMarqueeSelecting = false;
  private marqueeStartScreen: Point2D | null = null;
  private marqueeCurrentScreen: Point2D | null = null;
  private marqueeStartWorld: Point2D | null = null;
  private marqueeCurrentWorld: Point2D | null = null;

  // Multi-touch pinch zoom & two-finger scroll state
  private activePinchDist: number | null = null;
  private activeTwoFingerMidY: number | null = null;

  private onStrokeComplete: (path: SplinePath, isPoint?: boolean) => void;
  private onStrokeRedraw?: (strokeId: string, path: SplinePath) => void;
  private onRedrawStart?: (strokeId: string) => void;
  private onRedrawStateChange?: (isArmed: boolean) => void;
  private onDrawChange?: (points: Point2D[]) => void;
  private onSelectStroke?: (strokeId: string | null) => void;
  public onLiveTrigger?: (x: number, y: number, color: string) => void;
  private isRedrawArmed = false;
  private redrawingStrokeId: string | null = null;

  constructor(canvas: HTMLCanvasElement, options: InputHandlerOptions) {
    this.canvas = canvas;
    this.strokeManager = options.strokeManager;
    this.getQuantizer = options.getQuantizer;
    this.getCurrentInstrument = options.getCurrentInstrument;
    this.getCurrentStyle = options.getCurrentStyle;
    this.getXAxisModulation = options.getXAxisModulation;
    this.onStrokeComplete = options.onStrokeComplete;
    this.onStrokeRedraw = options.onStrokeRedraw;
    this.onRedrawStart = options.onRedrawStart;
    this.onRedrawStateChange = options.onRedrawStateChange;
    this.onDrawChange = options.onDrawChange;
    this.onSelectStroke = options.onSelectStroke;
    this.onStrokeTranslateEnd = options.onStrokeTranslateEnd;
    this.onPointerDownCallback = options.onPointerDown;
    this.onMarqueeSelect = options.onMarqueeSelect;
    this.onDuplicateDragStart = options.onDuplicateDragStart;
    this.onPinchOctaveZoom = options.onPinchOctaveZoom;
    this.onTwoFingerScrollY = options.onTwoFingerScrollY;

    this.initEvents();
  }

  public get marqueeRect(): { x1: number; y1: number; x2: number; y2: number } | null {
    if (!this.isMarqueeSelecting || !this.marqueeStartScreen || !this.marqueeCurrentScreen) {
      return null;
    }
    return {
      x1: this.marqueeStartScreen.x,
      y1: this.marqueeStartScreen.y,
      x2: this.marqueeCurrentScreen.x,
      y2: this.marqueeCurrentScreen.y,
    };
  }

  private resetMarqueeState(): void {
    this.isMarqueeSelecting = false;
    this.marqueeStartScreen = null;
    this.marqueeCurrentScreen = null;
    this.marqueeStartWorld = null;
    this.marqueeCurrentWorld = null;
  }

  public get isRedrawing(): boolean {
    return this.mode === 'redraw' || this.isRedrawArmed || this.redrawingStrokeId !== null;
  }

  public get activeRedrawStrokeId(): string | null {
    return this.redrawingStrokeId;
  }

  public armRedraw(strokeId?: string): void {
    if (strokeId) {
      this.strokeManager.selectStroke(strokeId);
    }
    if (!this.strokeManager.selectedStrokeId && this.strokeManager.activeStrokes.length > 0) {
      const last = this.strokeManager.activeStrokes[this.strokeManager.activeStrokes.length - 1];
      this.strokeManager.selectStroke(last.id);
      this.onSelectStroke?.(last.id);
    }
    if (!this.strokeManager.selectedStrokeId) return;
    this.isRedrawArmed = true;
    this.onRedrawStateChange?.(true);
  }

  public cancelRedraw(): void {
    const wasRedrawing = this.isRedrawArmed || this.redrawingStrokeId !== null || this.mode === 'redraw';
    if (!wasRedrawing) return;
    this.isRedrawArmed = false;
    this.redrawingStrokeId = null;
    if (this.mode === 'redraw') {
      this.mode = 'draw';
    }
    this.onRedrawStateChange?.(false);
  }

  public toggleRedraw(strokeId?: string): boolean {
    if (this.mode === 'redraw' || this.isRedrawArmed) {
      this.cancelRedraw();
      return false;
    } else {
      this.armRedraw(strokeId);
      return this.isRedrawArmed;
    }
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
    this.resetMarqueeState();
    this.isDuplicateDragging = false;
    if (mode === 'live') {
      this.strokeManager.selectStroke(null);
      this.strokeManager.setHoveredStroke(null);
      this.onSelectStroke?.(null);
      this.isDrawing = false;
      this.currentPoints = [];
      this.onDrawChange?.(this.currentPoints);
      this.canvas.style.cursor = 'crosshair';
      this.isRedrawArmed = false;
      this.redrawingStrokeId = null;
      this.onRedrawStateChange?.(false);
    } else if (mode === 'redraw') {
      this.livePointerSessionId++;
      if (this.liveDroneVoice) {
        try { this.liveDroneVoice.stop(0.2); } catch {}
        this.liveDroneVoice = null;
      }
      this.isLivePointerDown = false;
      this.lastLivePoint = null;
      this.canvas.style.cursor = 'crosshair';
      if (!this.strokeManager.selectedStrokeId && this.strokeManager.activeStrokes.length > 0) {
        const last = this.strokeManager.activeStrokes[this.strokeManager.activeStrokes.length - 1];
        this.strokeManager.selectStroke(last.id);
        this.onSelectStroke?.(last.id);
      }
      this.isRedrawArmed = true;
      this.onRedrawStateChange?.(true);
    } else {
      this.livePointerSessionId++;
      if (this.liveDroneVoice) {
        try { this.liveDroneVoice.stop(0.2); } catch {}
        this.liveDroneVoice = null;
      }
      this.isLivePointerDown = false;
      this.lastLivePoint = null;
      this.canvas.style.cursor = 'crosshair';
      this.isRedrawArmed = false;
      this.redrawingStrokeId = null;
      this.onRedrawStateChange?.(false);
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

  private handleTouchStart(e: TouchEvent): void {
    if (!e.touches || e.touches.length <= 1) {
      e.preventDefault?.();
      this.activePinchDist = null;
      this.activeTwoFingerMidY = null;
      return;
    }

    if (e.touches.length === 2) {
      e.preventDefault?.();
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      this.activePinchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      this.activeTwoFingerMidY = (t0.clientY + t1.clientY) * 0.5;
      return;
    }

    this.activePinchDist = null;
    this.activeTwoFingerMidY = null;
  }

  private handleTouchMove(e: TouchEvent): void {
    if (!e.touches || e.touches.length <= 1) {
      e.preventDefault?.();
      this.activePinchDist = null;
      this.activeTwoFingerMidY = null;
      return;
    }

    if (e.touches.length === 2) {
      e.preventDefault?.();
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const currDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const currMidY = (t0.clientY + t1.clientY) * 0.5;

      if (this.activePinchDist !== null && this.activePinchDist > 0) {
        const scaleFactor = currDist / this.activePinchDist;
        if (Math.abs(scaleFactor - 1) > 0.03) {
          this.onPinchOctaveZoom?.(scaleFactor);
          this.activePinchDist = currDist;
        }
      } else {
        this.activePinchDist = currDist;
      }

      if (this.activeTwoFingerMidY !== null) {
        const deltaMidY = this.activeTwoFingerMidY - currMidY;
        if (Math.abs(deltaMidY) > 1.5) {
          this.onTwoFingerScrollY?.(deltaMidY);
          this.activeTwoFingerMidY = currMidY;
        }
      } else {
        this.activeTwoFingerMidY = currMidY;
      }
      return;
    }

    this.activePinchDist = null;
    this.activeTwoFingerMidY = null;
  }

  private handleTouchEnd(e: TouchEvent): void {
    if (!e.touches || e.touches.length < 2) {
      this.activePinchDist = null;
      this.activeTwoFingerMidY = null;
    }
  }

  private handleTouchEvent = (e: TouchEvent): void => {
    if (e.type === 'touchstart') {
      this.handleTouchStart(e);
    } else if (e.type === 'touchmove') {
      this.handleTouchMove(e);
    } else if (e.type === 'touchend' || e.type === 'touchcancel') {
      this.handleTouchEnd(e);
    } else if (!e.touches || e.touches.length === 0) {
      this.handleTouchEnd(e);
    } else if (e.touches.length === 2 && (this.activePinchDist !== null || this.activeTwoFingerMidY !== null)) {
      this.handleTouchMove(e);
    } else {
      this.handleTouchStart(e);
    }
  };

  private initEvents(): void {
    const el = this.canvas;
    el.style.cursor = 'crosshair';

    el.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);
    el.addEventListener('pointerleave', this.handlePointerLeave);

    el.addEventListener('touchstart', this.handleTouchEvent, { passive: false });
    el.addEventListener('touchmove', this.handleTouchEvent, { passive: false });
    el.addEventListener('touchend', this.handleTouchEvent, { passive: false });
    el.addEventListener('touchcancel', this.handleTouchEvent, { passive: false });
  }

  public destroy(): void {
    this.livePointerSessionId++;
    if (this.liveDroneVoice) {
      try { this.liveDroneVoice.stop(0.05); } catch {}
      this.liveDroneVoice = null;
    }
    this.resetMarqueeState();
    this.isDuplicateDragging = false;
    this.activePinchDist = null;
    this.activeTwoFingerMidY = null;
    const el = this.canvas;
    el.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerUp);
    el.removeEventListener('pointerleave', this.handlePointerLeave);
    el.removeEventListener('touchstart', this.handleTouchEvent);
    el.removeEventListener('touchmove', this.handleTouchEvent);
    el.removeEventListener('touchend', this.handleTouchEvent);
    el.removeEventListener('touchcancel', this.handleTouchEvent);
  }

  private getCanvasPoint(e: PointerEvent, applySnap: boolean = true): Point2D {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const quantizer = this.getQuantizer();
    let y = quantizer.screenToWorldY(screenY, rect.height);

    // Magnetic Pitch Snapping (only applied when drawing a new line)
    if (applySnap && this.snapPitch) {
      const guidelines = quantizer.getGuidelines(rect.height);
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

    return { x, y };
  }

  private getDrumDisplayFrequency(zone: DrumZone, tomFreq: number): number {
    switch (zone) {
      case 'kick':
        return 55;
      case 'snare':
        return 180;
      case 'clap':
        return 1250;
      case 'tom':
        return tomFreq;
      case 'hihat':
        return 8000;
    }
  }

  private triggerLiveDrum(
    zone: DrumZone,
    tomFreq: number,
    volume: number,
    screenX: number,
    canvasWidth: number,
    xAxisMod: XAxisModulationMode,
    reverb: number
  ): void {
    switch (zone) {
      case 'kick':
        DrumSynth.triggerKick(volume, screenX, canvasWidth, xAxisMod, 0, reverb);
        break;
      case 'snare':
        DrumSynth.triggerSnare(volume * 0.95, screenX, canvasWidth, xAxisMod, 0, reverb);
        break;
      case 'clap':
        DrumSynth.triggerClap(volume * 0.9, screenX, canvasWidth, xAxisMod, 0, reverb);
        break;
      case 'tom':
        DrumSynth.triggerTom(tomFreq, volume * 0.9, screenX, canvasWidth, xAxisMod, 0, reverb);
        break;
      case 'hihat':
        DrumSynth.triggerHiHat(true, volume * 0.9, screenX, canvasWidth, xAxisMod, 0, reverb);
        break;
    }
  }

  private handlePointerDown = (e: PointerEvent): void => {
    // Only respond to primary (left) mouse clicks / touches
    if (e.button !== undefined && e.button !== 0) return;

    this.onPointerDownCallback?.();

    let initPromise: Promise<void> | null = null;
    if (!soundEngine.isReady) {
      initPromise = soundEngine.init().then(() => {
        this.strokeManager.activateAudioVoices();
      });
      initPromise.catch(() => {});
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
      const sessionId = ++this.livePointerSessionId;
      const instId = this.getCurrentInstrument?.() || 'indigo';
      const instrument = getInstrument(instId);
      const style = this.getCurrentStyle?.() || 'solid';
      const LIVE_REVERB = this.liveReverb;
      const LIVE_VOLUME = this.liveVolume;
      const isScaleSnapped = this.snapPitch || this.liveSnapToScale;
      const xAxisMod: XAxisModulationMode = this.getXAxisModulation?.() ?? 'panAndTone';

      let noteName = '';
      let frequency = 0;

      const drum = instId === 'onyx'
        ? resolveDrumZone(quantizer.quantizeContinuous(worldPt.y, rect.height).frequency, false)
        : null;
      const melodicPitch = instId !== 'onyx'
        ? (isScaleSnapped
            ? quantizer.quantizeDiscrete(worldPt.y, rect.height)
            : quantizer.quantizeContinuous(worldPt.y, rect.height))
        : null;

      if (drum) {
        noteName = drum.label;
        frequency = this.getDrumDisplayFrequency(drum.zone, drum.tomFreq);
      } else if (melodicPitch) {
        noteName = melodicPitch.noteName;
        frequency = melodicPitch.frequency;
      }

      const triggerInitialLive = (isAsync: boolean) => {
        if (drum) {
          this.triggerLiveDrum(drum.zone, drum.tomFreq, LIVE_VOLUME, screenX, rect.width, xAxisMod, LIVE_REVERB);
        } else if (melodicPitch) {
          let targetPitch = melodicPitch;
          if (isAsync && style === 'solid' && this.lastLivePoint) {
            const latestY = quantizer.screenToWorldY(this.lastLivePoint.y, rect.height);
            targetPitch = isScaleSnapped
              ? quantizer.quantizeDiscrete(latestY, rect.height)
              : quantizer.quantizeContinuous(latestY, rect.height);
          }

          if (style === 'dotted') {
            PulseVoice.trigger(targetPitch.frequency, false, LIVE_VOLUME, instrument, screenX, rect.width, xAxisMod, 0, LIVE_REVERB);
          } else if (style === 'striped') {
            PulseVoice.triggerRatchet(targetPitch.frequency, LIVE_VOLUME * 0.95, instrument, screenX, rect.width, xAxisMod, LIVE_REVERB);
          } else {
            // Solid legato live voice
            if (this.liveDroneVoice) {
              try { this.liveDroneVoice.stop(0.05); } catch {}
            }
            try {
              this.liveDroneVoice = new DroneVoice();
              this.liveDroneVoice.start(targetPitch.frequency, instrument, LIVE_VOLUME, LIVE_REVERB);
            } catch {
              this.liveDroneVoice = null;
            }
          }
        }
        this.onLiveTrigger?.(screenX, screenY, instrument.color);
      };

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

      if (!initPromise) {
        triggerInitialLive(false);
      } else {
        initPromise.then(() => {
          if (this.mode !== 'live' || this.livePointerSessionId !== sessionId) return;
          if (instId !== 'onyx' && style === 'solid' && !this.isLivePointerDown) return;
          triggerInitialLive(true);
        }).catch(() => {});
      }

      this.canvas.style.cursor = 'crosshair';
      return;
    }

    // ========================================================
    // B. DRAW & RE-DRAW MODE: Score drawing and line selection
    // ========================================================
    const directHit = this.strokeManager.hitTest(screenPt, 22, worldPt);
    const isCmdOrCtrl = e.metaKey || e.ctrlKey;

    // Alt/Option + Drag ON a stroke: duplicate and drag immediately
    if (e.altKey && !this.isRedrawArmed && this.mode !== 'redraw' && directHit && this.onDuplicateDragStart) {
      const sourceIds = this.strokeManager.isStrokeSelected(directHit.id)
        ? this.strokeManager.selectedStrokeIds
        : [directHit.id];
      const newIds = this.onDuplicateDragStart(sourceIds);
      if (newIds.length > 0) {
        this.draggedStrokeId = newIds[0];
        this.dragStartPoint = worldPt;
        this.lastDragPoint = worldPt;
        this.isDragging = true;
        this.isDuplicateDragging = true;
        this.dragAccumDx = 0;
        this.dragAccumDy = 0;
        this.isDrawing = false;
        this.canvas.style.cursor = 'copy';
        return;
      }
    }

    // In Re-draw mode, clicking directly on a stroke moves/selects it (unless Alt forces redraw);
    // Cmd/Ctrl+Drag on empty space still marquee-selects instead of redrawing.
    const shouldMoveInRedraw = this.mode === 'redraw' && !e.altKey && Boolean(directHit);
    const shouldMarqueeInRedraw =
      this.mode === 'redraw' && !e.altKey && !directHit && isCmdOrCtrl && Boolean(this.onMarqueeSelect);
    const isRedrawAttempt = !shouldMoveInRedraw && !shouldMarqueeInRedraw && (this.mode === 'redraw' || this.isRedrawArmed || e.altKey);
    if (isRedrawAttempt) {
      let targetId = this.strokeManager.selectedStrokeId;
      if (!targetId && this.strokeManager.activeStrokes.length > 0) {
        const hit = this.strokeManager.hitTest(screenPt, 80, worldPt);
        const target = hit || this.strokeManager.activeStrokes[this.strokeManager.activeStrokes.length - 1];
        this.strokeManager.selectStroke(target.id);
        this.onSelectStroke?.(target.id);
        targetId = target.id;
      }
      if (targetId) {
        this.redrawingStrokeId = targetId;
        this.onRedrawStart?.(targetId);
        const drawPt = this.getCanvasPoint(e, true);
        this.isDrawing = true;
        this.startPoint = drawPt;
        this.currentPoints = [drawPt];
        this.draggedStrokeId = null;
        this.isDragging = false;
        this.isDuplicateDragging = false;
        this.onDrawChange?.(this.currentPoints);
        this.canvas.style.cursor = 'crosshair';
        return;
      }
    }

    // Hit test lines across world score coordinates (both melodic and drum strokes)
    const hit = directHit;

    if (hit) {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl) {
        // Command + Click: toggle selection of clicked stroke
        this.strokeManager.toggleSelectStroke(hit.id);
        const selectedIds = this.strokeManager.selectedStrokeIds;
        this.onSelectStroke?.(selectedIds.length === 1 ? selectedIds[0] : null);

        if (this.strokeManager.isStrokeSelected(hit.id)) {
          this.draggedStrokeId = hit.id;
          this.dragStartPoint = worldPt;
          this.lastDragPoint = worldPt;
          this.isDragging = false;
          this.isDuplicateDragging = false;
          this.dragAccumDx = 0;
          this.dragAccumDy = 0;
          this.isDrawing = false;
          this.canvas.style.cursor = 'grab';
        } else {
          this.draggedStrokeId = null;
          this.isDragging = false;
          this.isDuplicateDragging = false;
          this.canvas.style.cursor = 'default';
        }
        return;
      }

      // Normal click without Command/Ctrl:
      // If clicked stroke is not already in the selection, select only this stroke
      if (!this.strokeManager.isStrokeSelected(hit.id)) {
        this.strokeManager.selectStroke(hit.id);
        this.onSelectStroke?.(hit.id);
      } else if (this.strokeManager.selectedStrokeIds.length === 1) {
        this.onSelectStroke?.(hit.id);
      }

      // Prepare for potential reposition dragging (moves all selected strokes together if multiple)
      const hitPt = worldPt;
      this.draggedStrokeId = hit.id;
      this.dragStartPoint = hitPt;
      this.lastDragPoint = hitPt;
      this.isDragging = false;
      this.isDuplicateDragging = false;
      this.dragAccumDx = 0;
      this.dragAccumDy = 0;
      this.isDrawing = false;
      this.canvas.style.cursor = 'grab';
      return;
    }

    // Clicked on empty canvas: deselect active selection if not holding Command/Ctrl
    if (!e.metaKey && !e.ctrlKey) {
      if (this.strokeManager.selectedStrokeIds.length > 0) {
        this.strokeManager.selectStroke(null);
        this.onSelectStroke?.(null);
      }
    } else if (this.onMarqueeSelect) {
      // Cmd/Ctrl + Drag on empty canvas: marquee multi-selection
      this.isMarqueeSelecting = true;
      this.marqueeStartScreen = screenPt;
      this.marqueeCurrentScreen = screenPt;
      this.marqueeStartWorld = worldPt;
      this.marqueeCurrentWorld = worldPt;
      this.isDrawing = false;
      this.draggedStrokeId = null;
      this.isDragging = false;
      this.isDuplicateDragging = false;
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    // Clicked on empty canvas: initialize drawing gesture
    const drawPt = this.getCanvasPoint(e, true);
    this.isDrawing = true;
    this.startPoint = drawPt;
    this.currentPoints = [drawPt];
    this.draggedStrokeId = null;
    this.isDragging = false;
    this.isDuplicateDragging = false;
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
      const xAxisMod: XAxisModulationMode = this.getXAxisModulation?.() ?? 'panAndTone';
      const dist = this.lastLivePoint
        ? Math.hypot(screenX - this.lastLivePoint.x, screenY - this.lastLivePoint.y)
        : 0;

      let noteName = '';
      let frequency = 0;

      if (instId === 'onyx') {
        const pitch = quantizer.quantizeContinuous(worldPt.y, rect.height);
        const drum = resolveDrumZone(pitch.frequency, false);
        noteName = drum.label;
        frequency = this.getDrumDisplayFrequency(drum.zone, drum.tomFreq);

        if (dist >= 35) {
          this.triggerLiveDrum(drum.zone, drum.tomFreq, LIVE_VOLUME, screenX, rect.width, xAxisMod, LIVE_REVERB);
          this.lastLivePoint = { x: screenX, y: screenY };
          this.onLiveTrigger?.(screenX, screenY, instrument.color);
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
            this.onLiveTrigger?.(screenX, screenY, instrument.color);
          }
        } else if (style === 'striped') {
          if (dist >= 35) {
            PulseVoice.triggerRatchet(pitch.frequency, LIVE_VOLUME * 0.95, instrument, screenX, rect.width, xAxisMod, LIVE_REVERB);
            this.lastLivePoint = { x: screenX, y: screenY };
            this.onLiveTrigger?.(screenX, screenY, instrument.color);
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
    if (this.isMarqueeSelecting) {
      this.marqueeCurrentScreen = screenPt;
      this.marqueeCurrentWorld = worldPt;
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    // 1. If dragging an existing selected stroke to reposition it (moves all selected strokes together)
    if (this.draggedStrokeId) {
      const rawPt = worldPt;
      const dist = this.dragStartPoint
        ? Math.hypot(rawPt.x - this.dragStartPoint.x, rawPt.y - this.dragStartPoint.y)
        : 0;

      if (dist >= 5 || this.isDragging) {
        this.isDragging = true;
        if (this.lastDragPoint) {
          const dx = rawPt.x - this.lastDragPoint.x;
          const dy = rawPt.y - this.lastDragPoint.y;
          const targetIds = this.strokeManager.isStrokeSelected(this.draggedStrokeId)
            ? this.strokeManager.selectedStrokeIds
            : [this.draggedStrokeId];

          for (const id of targetIds) {
            this.strokeManager.translateStroke(id, dx, dy, false);
          }
          this.dragAccumDx += dx;
          this.dragAccumDy += dy;
          this.lastDragPoint = rawPt;
          this.canvas.style.cursor = this.isDuplicateDragging ? 'copy' : 'grabbing';
        }
      }
      return;
    }

    // 2. If actively drawing a new stroke
    if (this.isDrawing) {
      if (this.shape === 'point') {
        // Point / Dot mode is stationary on canvas, don't accumulate drag line
        return;
      }

      // If a previous stroke was selected, deselect it as the user starts drawing (only in normal draw mode, never during redraw)
      if (!this.redrawingStrokeId && !this.isRedrawArmed && this.mode !== 'redraw' && this.strokeManager.selectedStrokeId) {
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
    const isOffCanvasTarget = e.target !== undefined && e.target !== this.canvas;
    const isOutsideCanvas =
      screenX < 0 || screenX > rect.width || screenY < 0 || screenY > rect.height;
    if (isOffCanvasTarget || isOutsideCanvas) {
      this.strokeManager.setHoveredStroke(null);
      return;
    }

    const hit = this.strokeManager.hitTest(screenPt, 22, worldPt);
    this.strokeManager.setHoveredStroke(hit ? hit.id : null);
    this.canvas.style.cursor = hit ? (this.mode === 'redraw' ? 'grab' : 'pointer') : 'crosshair';
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

    if (!this.isDrawing && !this.isDragging && !this.isMarqueeSelecting) {
      this.strokeManager.setHoveredStroke(null);
    }
  };

  private handlePointerUp = (e?: PointerEvent): void => {
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

    // 0. Finalize marquee multi-selection
    if (this.isMarqueeSelecting) {
      const startWorld = this.marqueeStartWorld;
      let endWorld = this.marqueeCurrentWorld;
      if (e && typeof e.clientX === 'number' && typeof e.clientY === 'number') {
        const rect = this.canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const quantizer = this.getQuantizer();
        endWorld = { x: screenX, y: quantizer.screenToWorldY(screenY, rect.height) };
      }

      this.resetMarqueeState();
      this.canvas.style.cursor = 'crosshair';

      if (startWorld && endWorld) {
        this.onMarqueeSelect?.({
          x1: startWorld.x,
          y1: startWorld.y,
          x2: endWorld.x,
          y2: endWorld.y,
        });
      }
      return;
    }

    // 1. If dragging an existing stroke, finalize translation with undo entry
    if (this.isDragging && this.draggedStrokeId) {
      if (Math.abs(this.dragAccumDx) > 0.5 || Math.abs(this.dragAccumDy) > 0.5) {
        const targetIds = this.strokeManager.isStrokeSelected(this.draggedStrokeId)
          ? this.strokeManager.selectedStrokeIds
          : [this.draggedStrokeId];

        if (targetIds.length === 1) {
          this.strokeManager.recordTranslateUndo(targetIds[0], this.dragAccumDx, this.dragAccumDy);
        } else if (targetIds.length > 1) {
          this.strokeManager.recordMultiTranslateUndo(targetIds, this.dragAccumDx, this.dragAccumDy);
        }
        this.onStrokeTranslateEnd?.();
      }
      this.isDragging = false;
      this.isDuplicateDragging = false;
      this.draggedStrokeId = null;
      this.lastDragPoint = null;
      this.dragStartPoint = null;
      this.canvas.style.cursor = 'pointer';
      return;
    }

    // 2. If clicked a stroke without dragging:
    if (this.draggedStrokeId) {
      // If user clicked an already selected stroke in a multi-selection without dragging and without Command/Ctrl,
      // narrow selection to just that clicked stroke
      if (!this.isDragging && e && !e.metaKey && !e.ctrlKey && this.strokeManager.selectedStrokeIds.length > 1) {
        this.strokeManager.selectStroke(this.draggedStrokeId);
        this.onSelectStroke?.(this.draggedStrokeId);
      }
      this.isDuplicateDragging = false;
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

      const redrawTargetId = this.redrawingStrokeId;
      this.redrawingStrokeId = null;
      if (this.isRedrawArmed && this.mode !== 'redraw') {
        this.cancelRedraw();
      }

      if (this.shape === 'point' && this.startPoint) {
        // Point / Dot mode: place a single stationary note dot
        const pt = this.startPoint;
        const microSeg: SplinePath = {
          segments: [
            {
              p0: { x: pt.x, y: pt.y },
              p1: { x: pt.x + 0.1, y: pt.y },
              p2: { x: pt.x + 0.2, y: pt.y },
              p3: { x: pt.x + 0.3, y: pt.y },
            },
          ],
          isClosed: false,
        };
        if (redrawTargetId) {
          this.onStrokeRedraw?.(redrawTargetId, microSeg);
        } else {
          this.onStrokeComplete(microSeg, true);
        }
      } else if (this.currentPoints.length >= 2 && dist >= 8) {
        // Real stroke was drawn!
        const spline = fitSplineFromPoints(this.currentPoints, 45, this.autoSmooth);
        if (spline && spline.segments.length > 0) {
          if (redrawTargetId) {
            this.onStrokeRedraw?.(redrawTargetId, spline);
          } else {
            this.onStrokeComplete(spline, false);
          }
        }
      } else {
        // Tap on canvas without dragging:
        if (redrawTargetId) {
          const rect = this.canvas.getBoundingClientRect();
          const screenX = e ? e.clientX - rect.left : (this.startPoint ? this.startPoint.x : 0);
          const screenY = e ? e.clientY - rect.top : (this.startPoint ? this.startPoint.y : 0);
          const quantizer = this.getQuantizer();
          const screenPt: Point2D = { x: screenX, y: screenY };
          const worldPt: Point2D = { x: screenX, y: quantizer.screenToWorldY(screenY, rect.height) };
          const hit = this.strokeManager.hitTest(screenPt, 22, worldPt);
          if (hit) {
            this.strokeManager.selectStroke(hit.id);
            this.onSelectStroke?.(hit.id);
          }
        } else if (this.strokeManager.selectedStrokeId) {
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
