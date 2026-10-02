import { Point2D, SplinePath } from '../math/types';
import { fitSplineFromPoints } from '../math/curveFit';
import { soundEngine } from '../audio/audioContext';

export interface InputHandlerOptions {
  onStrokeComplete: (path: SplinePath) => void;
  onDrawChange?: (points: Point2D[]) => void;
}

export class InputHandler {
  private canvas: HTMLCanvasElement;
  private isDrawing = false;
  private currentPoints: Point2D[] = [];
  private onStrokeComplete: (path: SplinePath) => void;
  private onDrawChange?: (points: Point2D[]) => void;

  constructor(canvas: HTMLCanvasElement, options: InputHandlerOptions) {
    this.canvas = canvas;
    this.onStrokeComplete = options.onStrokeComplete;
    this.onDrawChange = options.onDrawChange;

    this.initEvents();
  }

  public get points(): ReadonlyArray<Point2D> {
    return this.currentPoints;
  }

  private initEvents(): void {
    const el = this.canvas;

    el.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);

    // Prevent default touch scrolling when drawing on canvas
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
    // Unlock Audio Context on first interaction
    if (!soundEngine.isReady) {
      await soundEngine.init();
    }

    this.isDrawing = true;
    const pt = this.getCanvasPoint(e);
    this.currentPoints = [pt];
    this.onDrawChange?.(this.currentPoints);
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (!this.isDrawing) return;

    const pt = this.getCanvasPoint(e);
    const last = this.currentPoints[this.currentPoints.length - 1];

    // Only record if moved at least 4 pixels to reduce redundant events
    if (Math.hypot(pt.x - last.x, pt.y - last.y) >= 4) {
      this.currentPoints.push(pt);
      this.onDrawChange?.(this.currentPoints);
    }
  };

  private handlePointerUp = (): void => {
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
