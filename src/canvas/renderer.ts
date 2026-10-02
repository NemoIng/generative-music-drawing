import { DrawnStroke } from '../engine/types';
import { ScaleGuideline } from '../audio/scaleQuantizer';
import { Point2D } from '../math/types';

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not get 2D canvas context');
    this.ctx = context;
    this.resize();
  }

  public resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.floor(rect.width * this.dpr);
    this.canvas.height = Math.floor(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  public get width(): number {
    return this.canvas.getBoundingClientRect().width;
  }

  public get height(): number {
    return this.canvas.getBoundingClientRect().height;
  }

  public clear(): void {
    const w = this.width;
    const h = this.height;

    // Deep modern dark background
    this.ctx.fillStyle = '#0b0d14';
    this.ctx.fillRect(0, 0, w, h);

    // Subtle background ambient vignette
    const radial = this.ctx.createRadialGradient(w * 0.5, h * 0.5, h * 0.1, w * 0.5, h * 0.5, w * 0.8);
    radial.addColorStop(0, 'rgba(28, 33, 52, 0.45)');
    radial.addColorStop(1, 'rgba(11, 13, 20, 0.95)');
    this.ctx.fillStyle = radial;
    this.ctx.fillRect(0, 0, w, h);
  }

  /**
   * Draws modal scale horizontal guidelines across the canvas.
   */
  public drawGuidelines(guidelines: ScaleGuideline[]): void {
    const w = this.width;
    this.ctx.save();

    for (const g of guidelines) {
      this.ctx.beginPath();
      this.ctx.moveTo(48, g.y);
      this.ctx.lineTo(w - 48, g.y);

      if (g.isRoot) {
        this.ctx.strokeStyle = 'rgba(120, 160, 255, 0.28)';
        this.ctx.lineWidth = 1.5;
        this.ctx.setLineDash([]);
      } else {
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([4, 6]);
      }
      this.ctx.stroke();

      // Note Name on margins
      this.ctx.setLineDash([]);
      this.ctx.font = g.isRoot ? '600 11px system-ui, sans-serif' : '400 10px system-ui, sans-serif';
      this.ctx.fillStyle = g.isRoot ? 'rgba(140, 180, 255, 0.9)' : 'rgba(180, 190, 215, 0.4)';
      this.ctx.textAlign = 'right';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(g.noteName, 40, g.y);

      this.ctx.textAlign = 'left';
      this.ctx.fillText(`${Math.round(g.frequency)}Hz`, w - 40, g.y);
    }

    this.ctx.restore();
  }

  /**
   * Renders completed strokes with neon glow and specialized stroke styles.
   */
  public drawStroke(stroke: DrawnStroke): void {
    const { path, color, style } = stroke;
    const ctx = this.ctx;
    ctx.save();

    ctx.beginPath();
    for (let i = 0; i < path.segments.length; i++) {
      const seg = path.segments[i];
      if (i === 0) {
        ctx.moveTo(seg.p0.x, seg.p0.y);
      }
      ctx.bezierCurveTo(seg.p1.x, seg.p1.y, seg.p2.x, seg.p2.y, seg.p3.x, seg.p3.y);
    }
    if (path.isClosed) {
      ctx.closePath();
    }

    // Outer glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (style === 'solid') {
      ctx.lineWidth = 3.5;
      ctx.setLineDash([]);
      ctx.stroke();

      // Bright inner core
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else if (style === 'dotted') {
      ctx.lineWidth = 4;
      ctx.setLineDash([3, 16]);
      ctx.stroke();
    } else if (style === 'striped') {
      ctx.lineWidth = 3.5;
      ctx.setLineDash([14, 10]);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Draws animated constant-velocity playhead with trail, acoustic glow ring, and HUD badge.
   */
  public drawPlayhead(stroke: DrawnStroke, nowMs: number): void {
    const ph = stroke.playhead;
    if (!ph.lastEval) return;

    const { x, y } = ph.lastEval.point;
    const ctx = this.ctx;
    ctx.save();

    // 1. Motion Trail (Comet tail)
    if (ph.trail.length > 1) {
      for (let i = 0; i < ph.trail.length - 1; i++) {
        const ptA = ph.trail[i];
        const ptB = ph.trail[i + 1];
        const alpha = (1 - i / ph.trail.length) * 0.55;

        ctx.beginPath();
        ctx.moveTo(ptA.x, ptA.y);
        ctx.lineTo(ptB.x, ptB.y);
        ctx.strokeStyle = stroke.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 3 * (1 - i / ph.trail.length);
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1.0;

    // 2. Playhead Acoustic Pulse Halo
    const pulsePhase = (nowMs % 1200) / 1200;
    const pulseRadius = 7 + pulsePhase * 16;
    const pulseAlpha = (1 - pulsePhase) * 0.6;

    ctx.beginPath();
    ctx.arc(x, y, pulseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = stroke.color;
    ctx.globalAlpha = pulseAlpha;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    // 3. Playhead Center Core
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = stroke.color;
    ctx.fill();

    // 4. Floating HUD Badge (Pitch & Frequency)
    if (ph.lastPitch) {
      const badgeText = `${ph.lastPitch.noteName} • ${Math.round(ph.lastPitch.frequency)}Hz`;
      const badgeX = x + 14;
      const badgeY = y - 18;

      ctx.font = '500 11px system-ui, -apple-system, sans-serif';
      const textWidth = ctx.measureText(badgeText).width;
      const padding = 6;
      const boxW = textWidth + padding * 2;
      const boxH = 18;

      // Badge Background
      ctx.fillStyle = 'rgba(15, 20, 30, 0.85)';
      ctx.strokeStyle = ph.lastPitch.isSnapped ? stroke.color : 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY - 12, boxW, boxH, 4);
      ctx.fill();
      ctx.stroke();

      // Badge Text
      ctx.fillStyle = '#f0f4ff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, badgeX + padding, badgeY - 3);
    }

    ctx.restore();
  }

  /**
   * Draws active drawing stroke while user holds down pointer.
   */
  public drawActiveGesture(points: Point2D[], color: string): void {
    if (points.length < 2) return;
    const ctx = this.ctx;
    ctx.save();

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.setLineDash([4, 4]);
    ctx.stroke();

    // Start anchor indicator
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.restore();
  }
}
