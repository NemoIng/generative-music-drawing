import { Point2D, SplinePath } from '../math/types';
import { fitSplineFromPoints } from '../math/curveFit';
import { soundEngine } from '../audio/audioContext';
import { StrokeManager } from '../engine/strokeManager';
import { ScaleQuantizer } from '../audio/scaleQuantizer';

export type InteractionMode = 'draw' | 'edit';
export type DrawShape = 'curve' | 'straight';

export interface InputHandlerOptions {
  onStrokeComplete: (path: SplinePath) => void;
  onDrawChange?: (points: Point2D[]) => void;
  onSelectStroke?: (strokeId: string | null) => void;
  strokeManager: StrokeManager;
  getQuantizer: () => ScaleQuantizer;
}

export class InputHandler {
  private canvas: HTMLCanvasElement;
  private strokeManager: StrokeManager;
  private getQuantizer: () => ScaleQuantizer;
  private mode: InteractionMode = 'draw';
  private shape: DrawShape = 'curve';
  private snapPitch = false;
  private autoSmooth = true;

  // Drawing state
  private isDrawing = false;
  private currentPoints: Point2D[] = [];
  private startPoint: Point2D | null = null;

  // Edit / Dragging state
  private isDragging = false;
  private lastDragPoint: Point2D | null = null;
  private dragAccumDx = 0;
  private dragAccumDy = 0;
  private draggedStrokeId: string | null = null;

  private onStrokeComplete: (path: SplinePath) => void;
  private onDrawChange?: (points: Point2D[]) => void;
  private onSelectStroke?: (strokeId: string | null) => void;

  constructor(canvas: HTMLCanvasElement, options: InputHandlerOptions) {
    this.canvas = canvas;
    this.strokeManager = options.strokeManager;
    this.getQuantizer = options.getQuantizer;
    this.onStrokeComplete = options.onStrokeComplete;
    this.onDrawChange = options.onDrawChange;
    this.onSelectStroke = options.onSelectStroke;

    this.initEvents();
  }

  public get currentMode(): InteractionMode {
    return this.mode;
  }

  public get drawShape(): DrawShape {
    return this.shape;
  }

  public get isPitchSnapped(): boolean {
    return this.snapPitch;
  }

  public setMode(mode: InteractionMode): void {
    this.mode = mode;
    this.canvas.style.cursor = mode === 'edit' ? 'default' : 'crosshair';

    if (mode === 'draw') {
      this.strokeManager.selectStroke(null);
      this.strokeManager.setHoveredStroke(null);
      this.onSelectStroke?.(null);
    }
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

    el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  public destroy(): void {
    const el = this.canvas;
    el.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerUp);
  }

  private getCanvasPoint(e: PointerEvent, applySnap: boolean = true): Point2D {
    const rect = this.canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    // Magnetic Pitch Snapping (only applied when drawing, never when selecting/editing)
    if (applySnap && this.snapPitch && this.mode === 'draw') {
      const quantizer = this.getQuantizer();
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

  private handlePointerDown = async (e: PointerEvent): Promise<void> => {
    if (!soundEngine.isReady) {
      await soundEngine.init();
      this.strokeManager.activateAudioVoices();
    }

    if (this.mode === 'edit') {
      const pt = this.getCanvasPoint(e, false);
      const hit = this.strokeManager.hitTest(pt, 24);
      if (hit) {
        this.strokeManager.selectStroke(hit.id);
        this.onSelectStroke?.(hit.id);
        this.isDragging = true;
        this.draggedStrokeId = hit.id;
        this.lastDragPoint = pt;
        this.dragAccumDx = 0;
        this.dragAccumDy = 0;
        this.canvas.style.cursor = 'grabbing';
      } else {
        this.strokeManager.selectStroke(null);
        this.onSelectStroke?.(null);
      }
      return;
    }

    const pt = this.getCanvasPoint(e, true);
    // Draw mode
    this.isDrawing = true;
    this.startPoint = pt;
    this.currentPoints = [pt];
    this.onDrawChange?.(this.currentPoints);
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (this.mode === 'edit') {
      const rawPt = this.getCanvasPoint(e, false);
      if (this.isDragging && this.draggedStrokeId && this.lastDragPoint) {
        const dx = rawPt.x - this.lastDragPoint.x;
        const dy = rawPt.y - this.lastDragPoint.y;

        this.strokeManager.translateStroke(this.draggedStrokeId, dx, dy, false);
        this.dragAccumDx += dx;
        this.dragAccumDy += dy;
        this.lastDragPoint = rawPt;
      } else {
        const hit = this.strokeManager.hitTest(rawPt, 22);
        this.strokeManager.setHoveredStroke(hit ? hit.id : null);
        this.canvas.style.cursor = hit ? 'grab' : 'default';
      }
      return;
    }

    const rawPt = this.getCanvasPoint(e, true);

    if (!this.isDrawing) return;

    // Straight note constraint: if drawShape is 'straight' or Shift key is held down
    const isStraight = this.shape === 'straight' || e.shiftKey;
    const pt: Point2D = isStraight && this.startPoint
      ? { x: rawPt.x, y: this.startPoint.y }
      : rawPt;

    const last = this.currentPoints[this.currentPoints.length - 1];

    if (Math.hypot(pt.x - last.x, pt.y - last.y) >= 4) {
      if (isStraight && this.startPoint) {
        // Keep simple 3-point horizontal line (start, mid, current)
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
  };

  private handlePointerUp = (): void => {
    if (this.mode === 'edit') {
      if (this.isDragging && this.draggedStrokeId) {
        if (Math.abs(this.dragAccumDx) > 0.5 || Math.abs(this.dragAccumDy) > 0.5) {
          this.strokeManager.translateStroke(this.draggedStrokeId, 0, 0, true);
        }
        this.isDragging = false;
        this.lastDragPoint = null;
        this.draggedStrokeId = null;
        this.canvas.style.cursor = 'grab';
      }
      return;
    }

    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.currentPoints.length >= 2) {
      const spline = fitSplineFromPoints(this.currentPoints, 45, this.autoSmooth);
      if (spline && spline.segments.length > 0) {
        this.onStrokeComplete(spline);
      }
    }

    this.currentPoints = [];
    this.startPoint = null;
    this.onDrawChange?.(this.currentPoints);
  };
}
