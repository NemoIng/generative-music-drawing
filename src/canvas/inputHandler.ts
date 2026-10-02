import { Point2D, SplinePath } from '../math/types';
import { fitSplineFromPoints } from '../math/curveFit';
import { soundEngine } from '../audio/audioContext';
import { StrokeManager } from '../engine/strokeManager';

export type InteractionMode = 'draw' | 'edit';

export interface InputHandlerOptions {
  onStrokeComplete: (path: SplinePath) => void;
  onDrawChange?: (points: Point2D[]) => void;
  strokeManager: StrokeManager;
}

export class InputHandler {
  private canvas: HTMLCanvasElement;
  private strokeManager: StrokeManager;
  private mode: InteractionMode = 'draw';

  // Drawing state
  private isDrawing = false;
  private currentPoints: Point2D[] = [];

  // Edit / Dragging state
  private isDragging = false;
  private lastDragPoint: Point2D | null = null;
  private dragAccumDx = 0;
  private dragAccumDy = 0;
  private draggedStrokeId: string | null = null;

  private onStrokeComplete: (path: SplinePath) => void;
  private onDrawChange?: (points: Point2D[]) => void;

  constructor(canvas: HTMLCanvasElement, options: InputHandlerOptions) {
    this.canvas = canvas;
    this.strokeManager = options.strokeManager;
    this.onStrokeComplete = options.onStrokeComplete;
    this.onDrawChange = options.onDrawChange;

    this.initEvents();
  }

  public get currentMode(): InteractionMode {
    return this.mode;
  }

  public setMode(mode: InteractionMode): void {
    this.mode = mode;
    this.canvas.style.cursor = mode === 'edit' ? 'default' : 'crosshair';

    if (mode === 'draw') {
      this.strokeManager.selectStroke(null);
      this.strokeManager.setHoveredStroke(null);
    }
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

  private getCanvasPoint(e: PointerEvent): Point2D {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private handlePointerDown = async (e: PointerEvent): Promise<void> => {
    // Unlock Audio Context
    if (!soundEngine.isReady) {
      await soundEngine.init();
      this.strokeManager.activateAudioVoices();
    }

    const pt = this.getCanvasPoint(e);

    if (this.mode === 'edit') {
      const hit = this.strokeManager.hitTest(pt, 20);
      if (hit) {
        this.strokeManager.selectStroke(hit.id);
        this.isDragging = true;
        this.draggedStrokeId = hit.id;
        this.lastDragPoint = pt;
        this.dragAccumDx = 0;
        this.dragAccumDy = 0;
        this.canvas.style.cursor = 'grabbing';
      } else {
        // Clicked outside -> deselect
        this.strokeManager.selectStroke(null);
      }
      return;
    }

    // Draw mode
    this.isDrawing = true;
    this.currentPoints = [pt];
    this.onDrawChange?.(this.currentPoints);
  };

  private handlePointerMove = (e: PointerEvent): void => {
    const pt = this.getCanvasPoint(e);

    if (this.mode === 'edit') {
      if (this.isDragging && this.draggedStrokeId && this.lastDragPoint) {
        const dx = pt.x - this.lastDragPoint.x;
        const dy = pt.y - this.lastDragPoint.y;

        this.strokeManager.translateStroke(this.draggedStrokeId, dx, dy, false);
        this.dragAccumDx += dx;
        this.dragAccumDy += dy;
        this.lastDragPoint = pt;
      } else {
        // Hover inspection
        const hit = this.strokeManager.hitTest(pt, 18);
        this.strokeManager.setHoveredStroke(hit ? hit.id : null);
        this.canvas.style.cursor = hit ? 'grab' : 'default';
      }
      return;
    }

    // Draw mode
    if (!this.isDrawing) return;
    const last = this.currentPoints[this.currentPoints.length - 1];

    if (Math.hypot(pt.x - last.x, pt.y - last.y) >= 4) {
      this.currentPoints.push(pt);
      this.onDrawChange?.(this.currentPoints);
    }
  };

  private handlePointerUp = (): void => {
    if (this.mode === 'edit') {
      if (this.isDragging && this.draggedStrokeId) {
        // Record undo for cumulative move
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

    // Draw mode
    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.currentPoints.length >= 2) {
      const spline = fitSplineFromPoints(this.currentPoints, 45);
      if (spline && spline.segments.length > 0) {
        this.onStrokeComplete(spline);
      }
    }

    this.currentPoints = [];
    this.onDrawChange?.(this.currentPoints);
  };
}
