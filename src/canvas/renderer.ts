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

    // Elegant light off-white / beige paper background
    this.ctx.fillStyle = '#faf8f5';
    this.ctx.fillRect(0, 0, w, h);

    // Subtle warm paper grain / radial gradient
    const radial = this.ctx.createRadialGradient(w * 0.5, h * 0.45, h * 0.15, w * 0.5, h * 0.5, w * 0.85);
    radial.addColorStop(0, '#ffffff');
    radial.addColorStop(1, '#f4f0e6');
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
      this.ctx.moveTo(44, g.y);
      this.ctx.lineTo(w - 44, g.y);

      if (g.isRoot) {
        this.ctx.strokeStyle = 'rgba(68, 64, 60, 0.22)';
        this.ctx.lineWidth = 1.2;
        this.ctx.setLineDash([]);
      } else {
        this.ctx.strokeStyle = 'rgba(120, 113, 108, 0.1)';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([3, 5]);
      }
      this.ctx.stroke();

      // Note Name on margins
      this.ctx.setLineDash([]);
      this.ctx.font = g.isRoot
        ? '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        : '400 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      this.ctx.fillStyle = g.isRoot ? '#292524' : '#a8a29e';
      this.ctx.textAlign = 'right';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(g.noteName, 36, g.y);

      this.ctx.textAlign = 'left';
      this.ctx.fillText(`${Math.round(g.frequency)}Hz`, w - 36, g.y);
    }

    this.ctx.restore();
  }

  /**
   * Renders completed strokes with refined ink-on-paper aesthetics.
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

    // Outer glow / ink depth
    if (stroke.selected) {
      ctx.shadowColor = 'rgba(37, 99, 235, 0.35)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 0;
    } else if (stroke.hovered) {
      ctx.shadowColor = 'rgba(37, 99, 235, 0.2)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 0;
    } else {
      ctx.shadowColor = 'rgba(40, 35, 30, 0.08)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 2;
    }

    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (style === 'solid') {
      ctx.lineWidth = stroke.selected ? 4.5 : 3.5;
      ctx.setLineDash([]);
      ctx.stroke();

      // Subtle core depth
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = color;
      ctx.lineWidth = stroke.selected ? 2.5 : 2.0;
      ctx.stroke();
    } else if (style === 'dotted') {
      ctx.lineWidth = stroke.selected ? 4.5 : 3.5;
      ctx.setLineDash([2, 14]);
      ctx.stroke();
    } else if (style === 'striped') {
      ctx.lineWidth = stroke.selected ? 4.0 : 3.0;
      ctx.setLineDash([12, 8]);
      ctx.stroke();
    }

    // Selection Anchor Rings
    if (stroke.selected && path.segments.length > 0) {
      ctx.shadowBlur = 0;
      const startPt = path.segments[0].p0;
      const endPt = path.segments[path.segments.length - 1].p3;

      // Start Handle
      ctx.beginPath();
      ctx.arc(startPt.x, startPt.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#2563eb';
      ctx.stroke();

      // End Handle (if not closed)
      if (!path.isClosed) {
        ctx.beginPath();
        ctx.arc(endPt.x, endPt.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#2563eb';
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  /**
   * Draws animated constant-velocity playhead with trail, acoustic pulse, and clean minimal HUD tag.
   */
  public drawPlayhead(stroke: DrawnStroke, nowMs: number): void {
    const ph = stroke.playhead;
    if (!ph.lastEval) return;

    const { x, y } = ph.lastEval.point;
    const ctx = this.ctx;
    ctx.save();

    // 1. Motion Trail
    if (ph.trail.length > 1) {
      for (let i = 0; i < ph.trail.length - 1; i++) {
        const ptA = ph.trail[i];
        const ptB = ph.trail[i + 1];
        const alpha = (1 - i / ph.trail.length) * 0.45;

        ctx.beginPath();
        ctx.moveTo(ptA.x, ptA.y);
        ctx.lineTo(ptB.x, ptB.y);
        ctx.strokeStyle = stroke.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2.5 * (1 - i / ph.trail.length);
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1.0;

    // 2. Playhead Acoustic Pulse Ring
    const pulsePhase = (nowMs % 1400) / 1400;
    const pulseRadius = 6 + pulsePhase * 14;
    const pulseAlpha = (1 - pulsePhase) * 0.45;

    ctx.beginPath();
    ctx.arc(x, y, pulseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = stroke.color;
    ctx.globalAlpha = pulseAlpha;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    // 3. Playhead Center Bead
    ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 1;

    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = stroke.color;
    ctx.fill();

    // Clean white core dot
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // 4. Clean Minimalist Note Tag
    if (ph.lastPitch) {
      const badgeText = `${ph.lastPitch.noteName} · ${Math.round(ph.lastPitch.frequency)}Hz`;
      const badgeX = x + 12;
      const badgeY = y - 16;

      ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      const textWidth = ctx.measureText(badgeText).width;
      const padding = 6;
      const boxW = textWidth + padding * 2;
      const boxH = 18;

      // Paper card tag
      ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;

      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = ph.lastPitch.isSnapped ? stroke.color : '#d6d3cd';
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY - 12, boxW, boxH, 4);
      ctx.fill();
      ctx.stroke();

      // Clean typography
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = '#1c1917';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, badgeX + padding, badgeY - 3);
    }

    ctx.restore();
  }

  /**
   * Draws active drawing stroke while user drags pointer.
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
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([4, 4]);
    ctx.stroke();

    // Origin dot
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.restore();
  }
}
