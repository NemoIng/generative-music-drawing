import { DrawnStroke } from '../engine/types';
import { ScaleGuideline, ScaleQuantizer } from '../audio/scaleQuantizer';
import { Point2D, SplinePath } from '../math/types';
import { getHitJitter } from '../engine/strokeManager';
import { evaluateAtDistance } from '../math/arcLengthInverter';
import { resolveDrumZone } from '../audio/drumMapping';
import { LiveTrailPoint } from './inputHandler';

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export interface SparkParticle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  alpha: number;
  radius: number;
  life: number;
  maxLife: number;
}

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private dpr = 1;
  private readonly maxParticles = 140;
  private readonly particlePool: SparkParticle[] = Array.from({ length: 140 }, () => ({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    color: '#ffffff',
    alpha: 0,
    radius: 1,
    life: 0,
    maxLife: 1,
  }));
  private particleCursor = 0;
  private visibleGuidelinesScratch: Array<{ g: ScaleGuideline; y: number }> = [];

  // Cached Logical Dimensions & Gradients
  private logicalWidth = 800;
  private logicalHeight = 600;
  private cachedBgGradient: CanvasGradient | null = null;
  private cachedBgWidth = 0;
  private cachedBgHeight = 0;
  private cachedBgDarkMode: boolean | null = null;

  // Dual-Layer Offscreen Static-Layer Cache
  private staticCanvas: HTMLCanvasElement | null = null;
  private staticCtx: CanvasRenderingContext2D | null = null;
  private staticCacheKey = '';
  private _staticCacheHits = 0;
  private _staticCacheMisses = 0;

  private smoothedMasterEnergy = 0;
  private smoothedBands = { low: 0, mid: 0, high: 0 };
  private cachedVignetteGradient: CanvasGradient | null = null;
  private cachedWarmVignetteGradient: CanvasGradient | null = null;
  private cachedVignetteWidth = 0;
  private cachedVignetteHeight = 0;
  private cachedVignetteDarkMode: boolean | null = null;
  private dottedFluctuationCache = new WeakMap<
    SplinePath,
    { fluctuation: number; totalLength: number; dots: Array<{ dx: number; dy: number }> }
  >();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not get 2D canvas context');
    this.ctx = context;
    this.resize();
  }

  public get staticCacheHits(): number {
    return this._staticCacheHits;
  }

  public get staticCacheMisses(): number {
    return this._staticCacheMisses;
  }

  public invalidateStaticCache(): void {
    this.staticCacheKey = '';
  }

  private ensureStaticLayer(): boolean {
    if (this.staticCanvas && this.staticCtx) return true;
    try {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        return false;
      }
      const offscreen = document.createElement('canvas');
      if (!offscreen || typeof offscreen.getContext !== 'function') {
        return false;
      }
      const offCtx = offscreen.getContext('2d');
      if (!offCtx) {
        return false;
      }
      this.staticCanvas = offscreen;
      this.staticCtx = offCtx;
      return true;
    } catch {
      this.staticCanvas = null;
      this.staticCtx = null;
      return false;
    }
  }

  /**
   * Renders static canvas layers (background, guidelines, static beats/strokes) into a
   * cached offscreen canvas keyed by `cacheKey` and blits pixel-for-pixel onto the main canvas.
   */
  public renderStaticLayer(cacheKey: string, drawStatic: () => void): boolean {
    if (
      this.ensureStaticLayer() &&
      this.staticCanvas &&
      this.staticCtx &&
      typeof this.ctx.drawImage === 'function' &&
      this.logicalWidth > 0 &&
      this.logicalHeight > 0
    ) {
      if (cacheKey !== '' && this.staticCacheKey === cacheKey) {
        this._staticCacheHits++;
      } else {
        this._staticCacheMisses++;
        const targetW = Math.max(1, this.canvas.width);
        const targetH = Math.max(1, this.canvas.height);
        if (this.staticCanvas.width !== targetW) {
          this.staticCanvas.width = targetW;
        }
        if (this.staticCanvas.height !== targetH) {
          this.staticCanvas.height = targetH;
        }
        if (typeof this.staticCtx.setTransform === 'function') {
          this.staticCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        }
        if (typeof this.staticCtx.clearRect === 'function') {
          this.staticCtx.clearRect(0, 0, this.logicalWidth + 2, this.logicalHeight + 2);
        }

        const mainCtx = this.ctx;
        this.ctx = this.staticCtx;
        try {
          drawStatic();
        } finally {
          this.ctx = mainCtx;
        }
        this.staticCacheKey = cacheKey;
      }

      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.drawImage(this.staticCanvas, 0, 0);
      this.ctx.restore();
      return true;
    }

    drawStatic();
    return false;
  }

  public resize(): void {
    const rawDpr = window.devicePixelRatio || 1;
    // Cap DPR at 1.75 to balance ultra-sharp Retina rendering with 40% lower GPU fill-rate
    this.dpr = Math.min(rawDpr, 1.75);
    const rect = this.canvas.getBoundingClientRect();
    this.logicalWidth = rect.width;
    this.logicalHeight = rect.height;
    this.canvas.width = Math.floor(this.logicalWidth * this.dpr);
    this.canvas.height = Math.floor(this.logicalHeight * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cachedBgGradient = null;
    this.cachedVignetteGradient = null;
    this.cachedWarmVignetteGradient = null;
    this.invalidateStaticCache();
  }

  public get width(): number {
    return this.logicalWidth;
  }

  public get height(): number {
    return this.logicalHeight;
  }

  public isDarkMode = false;

  public setDarkMode(dark: boolean): void {
    if (this.isDarkMode !== dark) {
      this.isDarkMode = dark;
      this.cachedBgGradient = null;
      this.cachedVignetteGradient = null;
      this.cachedWarmVignetteGradient = null;
      this.invalidateStaticCache();
    }
  }

  public clear(): void {
    const w = this.logicalWidth;
    const h = this.logicalHeight;

    // Cache the full-screen radial background gradient instead of allocating every frame
    if (
      !this.cachedBgGradient ||
      this.cachedBgWidth !== w ||
      this.cachedBgHeight !== h ||
      this.cachedBgDarkMode !== this.isDarkMode
    ) {
      const radial = this.ctx.createRadialGradient(w * 0.5, h * 0.45, h * 0.15, w * 0.5, h * 0.5, w * 0.85);
      if (this.isDarkMode) {
        radial.addColorStop(0, '#18181c');
        radial.addColorStop(1, '#0b0b0e');
      } else {
        radial.addColorStop(0, '#ffffff');
        radial.addColorStop(1, '#f4f0e6');
      }
      this.cachedBgGradient = radial;
      this.cachedBgWidth = w;
      this.cachedBgHeight = h;
      this.cachedBgDarkMode = this.isDarkMode;
    }

    // 1. Solid opaque base fill guarantees 100% stable background with zero subpixel alpha bleed
    this.ctx.fillStyle = this.isDarkMode ? '#0f0f12' : '#faf8f5';
    this.ctx.fillRect(0, 0, w + 2, h + 2);

    // 2. Subtle warm paper radial gradient
    this.ctx.fillStyle = this.cachedBgGradient;
    this.ctx.fillRect(0, 0, w + 2, h + 2);
  }

  /**
   * Draws modal scale horizontal guidelines across the canvas.
   * Clearly highlights Root (Tonic) and 5th (Dominant) degrees for harmonic grounding.
   */
  public drawGuidelines(guidelines: ScaleGuideline[]): void {
    const w = this.width;
    const h = this.height;
    this.ctx.save();

    // Responsive blank background margins for scale names (left) and Hz (right)
    // 135px rightMargin ensures frequency labels sit to the left of the pitch navigator rail (width 54px + 12px margin + padding)
    const leftMargin = Math.min(88, Math.max(68, w * 0.06));
    const rightMargin = Math.min(150, Math.max(130, w * 0.09));

    // Filter visible guidelines into pre-allocated scratch buffer to avoid per-frame allocations
    const visible = this.visibleGuidelinesScratch;
    visible.length = 0;
    for (let i = 0; i < guidelines.length; i++) {
      const g = guidelines[i];
      const y = typeof g.screenY === 'number' ? g.screenY : g.y;
      if (y >= -30 && y <= h + 30) {
        visible.push({ g, y });
      }
    }
    visible.sort((a, b) => a.y - b.y);

    for (let i = 0; i < visible.length; i++) {
      const { g, y } = visible[i];
      const prevY = i > 0 ? visible[i - 1].y : -999;
      const nextY = i < visible.length - 1 ? visible[i + 1].y : 999;
      const nearestDist = Math.min(Math.abs(y - prevY), Math.abs(nextY - y));

      const isTopBoundary = Math.round(g.frequency) >= ScaleQuantizer.MAX_FREQ;
      const isBottomBoundary = Math.round(g.frequency) <= ScaleQuantizer.MIN_FREQ;
      const lineY = isTopBoundary ? Math.max(1, y) : y;

      this.ctx.beginPath();
      this.ctx.moveTo(leftMargin, lineY);
      this.ctx.lineTo(w - rightMargin, lineY);

      const isFifth = g.isFifth ?? ((((g.scaleDegree % 7) + 7) % 7) === 4); // Dominant 5th fallback
      const isChordTone = !!g.isChordTone && !g.isRoot;

      if (isTopBoundary || isBottomBoundary) {
        this.ctx.strokeStyle = this.isDarkMode ? 'rgba(255, 255, 255, 0.40)' : 'rgba(28, 25, 23, 0.35)';
        this.ctx.lineWidth = 1.2;
        this.ctx.setLineDash([]);
      } else if (g.isRoot) {
        this.ctx.strokeStyle = this.isDarkMode ? 'rgba(255, 255, 255, 0.55)' : 'rgba(28, 25, 23, 0.45)';
        this.ctx.lineWidth = 1.5;
        this.ctx.setLineDash([]);
      } else if (isChordTone) {
        this.ctx.strokeStyle = this.isDarkMode ? 'rgba(245, 158, 11, 0.45)' : 'rgba(217, 119, 6, 0.35)';
        this.ctx.lineWidth = 1.3;
        this.ctx.setLineDash([8, 6]);
      } else if (isFifth) {
        this.ctx.strokeStyle = this.isDarkMode ? 'rgba(96, 165, 250, 0.4)' : 'rgba(37, 99, 235, 0.22)';
        this.ctx.lineWidth = 1.2;
        this.ctx.setLineDash([6, 6]);
      } else {
        this.ctx.strokeStyle = this.isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(120, 113, 108, 0.09)';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([3, 5]);
      }
      this.ctx.stroke();

      // Only draw text labels if the line has enough vertical headroom (>= 15px) or is a primary harmonic landmark
      const hasRoom = nearestDist >= 15 || g.isRoot || isChordTone || isFifth || isTopBoundary || isBottomBoundary;
      if (!hasRoom) continue;

      // Note Name on margins
      this.ctx.setLineDash([]);
      this.ctx.font = isTopBoundary || isBottomBoundary || g.isRoot
        ? '700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        : isChordTone
        ? '600 10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        : isFifth
        ? '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        : '400 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

      this.ctx.fillStyle = isTopBoundary || isBottomBoundary || g.isRoot
        ? (this.isDarkMode ? '#ffffff' : '#1c1917')
        : isChordTone
        ? (this.isDarkMode ? '#fbbf24' : '#b45309')
        : isFifth
        ? (this.isDarkMode ? '#93c5fd' : '#2563eb')
        : (this.isDarkMode ? '#71717a' : '#a8a29e');
      this.ctx.textAlign = 'right';
      this.ctx.textBaseline = lineY <= 8 ? 'top' : 'middle';
      const textY = lineY <= 8 ? Math.max(3, lineY + 2) : lineY;

      const label = isTopBoundary
        ? g.noteName
        : isBottomBoundary
        ? g.noteName || 'A2'
        : g.isRoot
        ? `★ ${g.noteName}`
        : isChordTone
        ? `◆ ${g.noteName}`
        : isFifth
        ? `${g.noteName} (5th)`
        : g.noteName;
      if (label) {
        this.ctx.fillText(label, leftMargin - 10, textY);
      }

      this.ctx.textAlign = 'left';
      this.ctx.fillStyle = isTopBoundary
        ? (this.isDarkMode ? 'rgba(255, 255, 255, 0.75)' : 'rgba(28, 25, 23, 0.65)')
        : isChordTone
        ? (this.isDarkMode ? '#fbbf24' : '#b45309')
        : (this.isDarkMode ? '#71717a' : '#a8a29e');
      this.ctx.fillText(`${Math.round(g.frequency)}Hz`, w - rightMargin + 10, textY);
    }

    this.ctx.restore();
  }

  /**
   * Executes drawing callbacks within the scrolled world coordinate matrix.
   */
  public drawWorldLayer(scrollY: number, drawFn: () => void): void {
    this.ctx.save();
    this.ctx.translate(0, -scrollY);
    drawFn();
    this.ctx.restore();
  }

  /**
   * Draws subtle drum tier zone guides when the Onyx drum machine ink is active.
   */
  public drawDrumZones(isActive: boolean, quantizer?: ScaleQuantizer): void {
    if (!isActive) return;
    const w = this.width;
    const h = this.height;
    const ctx = this.ctx;
    ctx.save();

    const leftMargin = Math.min(84, Math.max(56, w * 0.04));
    const rightMargin = Math.min(150, Math.max(130, w * 0.09));

    let zones: { y: number; label: string }[];
    let kickScreenY = h - 14;
    if (quantizer) {
      const yFromFreq = (freq: number) => {
        const u = ScaleQuantizer.frequencyToNormalizedU(freq);
        if (!quantizer.isScrollEnabled) {
          return quantizer.normalizedUToCanvasY(u, h);
        }
        const worldY = quantizer.normalizedUToWorldY(u, h);
        return quantizer.worldToScreenY(worldY, h);
      };
      zones = [
        { y: yFromFreq(2200), label: 'Hi-Hats (2.2k+ Hz)' },
        { y: yFromFreq(650), label: 'Toms (650–2.2k Hz)' },
        { y: yFromFreq(260), label: 'Snare / Clap (260–650 Hz)' },
      ];
      kickScreenY = yFromFreq(140);
    } else {
      zones = [
        { y: h * 0.25, label: 'Hi-Hats' },
        { y: h * 0.48, label: 'Toms' },
        { y: h * 0.72, label: 'Snare / Clap' },
      ];
    }

    for (const z of zones) {
      if (z.y < -20 || z.y > h + 20) continue;
      ctx.beginPath();
      ctx.moveTo(leftMargin, z.y);
      ctx.lineTo(w - rightMargin, z.y);
      ctx.strokeStyle = this.isDarkMode ? 'rgba(255, 255, 255, 0.22)' : 'rgba(24, 24, 27, 0.22)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = this.isDarkMode ? 'rgba(255, 255, 255, 0.75)' : 'rgba(24, 24, 27, 0.65)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(z.label, w - rightMargin, z.y - 3);
    }

    // Bottom Kick label
    if (kickScreenY >= -20 && kickScreenY <= h + 20) {
      ctx.font = '700 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = this.isDarkMode ? 'rgba(255, 255, 255, 0.85)' : 'rgba(24, 24, 27, 0.75)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Kick Drum (110–260 Hz)', w - rightMargin, kickScreenY - 3);
    }

    ctx.restore();
  }

  /**
   * Draws a visual 4-beat measure bar tracker along the top canvas margin.
   */
  public drawBeatTracker(measureProgress: number, beatIndex: number): void {
    const w = this.width;
    const ctx = this.ctx;
    ctx.save();

    const barW = Math.min(240, w * 0.4);
    const startX = (w - barW) / 2;
    const y = 14;

    // Background track
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(startX + barW, y);
    ctx.strokeStyle = this.isDarkMode ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.08)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 4 Beat tick dots
    for (let b = 0; b < 4; b++) {
      const bx = startX + (b / 3) * barW;
      const isCurrent = b === beatIndex;
      ctx.beginPath();
      ctx.arc(bx, y, isCurrent ? 3.5 : 2, 0, Math.PI * 2);
      ctx.fillStyle = isCurrent
        ? (this.isDarkMode ? '#ffffff' : '#1c1917')
        : (this.isDarkMode ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.2)');
      ctx.fill();
    }

    // Moving playhead needle
    const needleX = startX + measureProgress * barW;
    ctx.beginPath();
    ctx.arc(needleX, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#2563eb';
    ctx.fill();

    ctx.restore();
  }

  /**
   * Draws subtle vertical beat guide lines across the playable canvas width plus a moving phase hairline.
   */
  public drawBeatGrid(measureProgress: number, enabled: boolean, beatsPerBar: number = 4): void {
    if (!enabled) return;
    const w = this.width;
    const h = this.height;
    const leftMargin = Math.min(84, Math.max(56, w * 0.04));
    const rightMargin = Math.min(150, Math.max(130, w * 0.09));
    const usableWidth = w - rightMargin - leftMargin;
    if (usableWidth <= 0 || h <= 0) return;

    const beats = Math.max(1, Math.round(beatsPerBar));
    const clampedProgress = Math.max(0, Math.min(1, measureProgress));
    const ctx = this.ctx;
    ctx.save();

    for (let b = 0; b < beats; b++) {
      const bx = leftMargin + (b / beats) * usableWidth;
      ctx.beginPath();
      ctx.moveTo(bx, 0);
      ctx.lineTo(bx, h);
      if (b === 0) {
        ctx.strokeStyle = this.isDarkMode ? 'rgba(255, 255, 255, 0.20)' : 'rgba(28, 25, 23, 0.16)';
        ctx.lineWidth = 1.25;
        ctx.setLineDash([6, 6]);
      } else {
        ctx.strokeStyle = this.isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(120, 113, 108, 0.08)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 6]);
      }
      ctx.stroke();
    }

    const phaseX = leftMargin + clampedProgress * usableWidth;
    ctx.beginPath();
    ctx.moveTo(phaseX, 0);
    ctx.lineTo(phaseX, h);
    ctx.setLineDash([]);
    ctx.strokeStyle = this.isDarkMode ? 'rgba(96, 165, 250, 0.28)' : 'rgba(37, 99, 235, 0.20)';
    ctx.lineWidth = 1.25;
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Renders a translucent marquee selection rectangle across dragged screen coordinates.
   */
  public drawMarqueeSelection(rect: { x1: number; y1: number; x2: number; y2: number } | null): void {
    if (!rect) return;
    const x = Math.min(rect.x1, rect.x2);
    const y = Math.min(rect.y1, rect.y2);
    const w = Math.abs(rect.x2 - rect.x1);
    const h = Math.abs(rect.y2 - rect.y1);
    if (w < 1 && h < 1) return;

    const ctx = this.ctx;
    ctx.save();
    drawRoundRect(ctx, x, y, w, h, 4);
    ctx.fillStyle = this.isDarkMode ? 'rgba(96, 165, 250, 0.14)' : 'rgba(37, 99, 235, 0.10)';
    ctx.fill();
    ctx.strokeStyle = this.isDarkMode ? 'rgba(147, 197, 253, 0.78)' : 'rgba(37, 99, 235, 0.68)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Renders a gentle breathing dashed curve silhouette and centered hint when the canvas is empty.
   */
  public drawEmptyCanvasGhostHint(nowMs: number, show: boolean): void {
    if (!show) return;
    const w = this.width;
    const h = this.height;
    if (w <= 0 || h <= 0) return;

    const breathe = (Math.sin(nowMs * 0.002) + 1) * 0.5;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const spanX = Math.min(260, w * 0.36);
    const spanY = Math.min(54, h * 0.1);

    const ctx = this.ctx;
    ctx.save();

    ctx.beginPath();
    ctx.moveTo(cx - spanX * 0.5, cy + spanY * 0.35);
    ctx.bezierCurveTo(
      cx - spanX * 0.16,
      cy - spanY * 0.85,
      cx + spanX * 0.16,
      cy + spanY * 0.85,
      cx + spanX * 0.5,
      cy - spanY * 0.35
    );
    ctx.strokeStyle = this.isDarkMode ? 'rgba(244, 244, 245, 0.55)' : 'rgba(28, 25, 23, 0.45)';
    ctx.globalAlpha = 0.22 + breathe * 0.14;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.setLineDash([6, 8]);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5 + breathe * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = this.isDarkMode ? '#93c5fd' : '#2563eb';
    ctx.globalAlpha = 0.35 + breathe * 0.25;
    ctx.fill();

    ctx.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = this.isDarkMode ? 'rgba(244, 244, 245, 0.72)' : 'rgba(28, 25, 23, 0.62)';
    ctx.globalAlpha = 0.52 + breathe * 0.18;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Draw a line anywhere to start • Hold Cmd/Ctrl+Drag to marquee-select', cx, cy + spanY + 28);

    ctx.restore();
  }


  /**
   * Resolves stroke color with awareness of dark mode (e.g. onyx drum machine becomes white/light grey).
   */
  public getStrokeColor(stroke: DrawnStroke): string {
    if (this.isDarkMode && (stroke.instrumentId === 'onyx' || stroke.color === '#18181b')) {
      return '#f4f4f5';
    }
    return stroke.color;
  }

  /**
   * Renders completed strokes with ink-on-paper aesthetics and mute/solo awareness.
   */
  public drawStroke(
    stroke: DrawnStroke,
    hasSolo: boolean = false,
    isMultiSelection: boolean = false,
    isBeingRedrawn: boolean = false
  ): void {
    const { path, style } = stroke;
    const ctx = this.ctx;
    ctx.save();

    const isGreyedOut = (hasSolo && !stroke.soloed) || !!stroke.muted;
    const baseColor = this.getStrokeColor(stroke);
    const effectiveColor = isGreyedOut ? '#a8a29e' : baseColor;
    const vol = typeof stroke.volume === 'number' ? stroke.volume : 1.0;
    const morphMultiplier = typeof stroke.morphGain === 'number' ? stroke.morphGain : 1.0;

    if (hasSolo && !stroke.soloed) {
      // Greyed out because another line is soloed
      ctx.globalAlpha = 0.20 * morphMultiplier;
    } else if (stroke.muted) {
      ctx.globalAlpha = 0.25 * morphMultiplier;
    } else if (isBeingRedrawn) {
      // Dim stroke being replaced while active redraw gesture is taking place
      ctx.globalAlpha = 0.25 * morphMultiplier;
    } else {
      ctx.globalAlpha = (0.35 + 0.65 * vol) * Math.max(0.04, morphMultiplier);
    }

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

    // Outer glow / selection depth - only use shadowBlur for active interactions (hover, select, solo)
    if (isGreyedOut) {
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    } else if (stroke.selected) {
      ctx.shadowColor = 'rgba(37, 99, 235, 0.4)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 0;
    } else if (stroke.soloed) {
      ctx.shadowColor = 'rgba(217, 119, 6, 0.45)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 0;
    } else if (stroke.hovered) {
      ctx.shadowColor = 'rgba(37, 99, 235, 0.2)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 0;
    } else {
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }

    ctx.strokeStyle = effectiveColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (stroke.isPoint && path.segments.length > 0) {
      // Point / Dot Note: Render stationary dot slightly wider than a line
      const pt = path.segments[0].p0;
      const baseRadius = stroke.selected ? 9 : 7;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, baseRadius, 0, Math.PI * 2);
      ctx.fillStyle = effectiveColor;
      ctx.fill();

      // Outer delicate ring
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, baseRadius + 3, 0, Math.PI * 2);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = stroke.selected ? '#2563eb' : effectiveColor;
      ctx.stroke();

      if (stroke.selected) {
        // Selection outer halo
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, baseRadius + 6, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(37, 99, 235, 0.6)';
        ctx.stroke();
      }
    } else if (style === 'solid') {
      ctx.lineWidth = stroke.selected ? 3.5 : 2.5;
      ctx.setLineDash([]);
      ctx.stroke();
    } else if (style === 'dotted') {
      const fluc = stroke.fluctuation ?? 0;
      if (fluc > 0 && stroke.lut && stroke.lut.totalLength > 0 && path.segments.length > 0) {
        // Draw subtle faint baseline path so the user sees the original trajectory
        ctx.save();
        ctx.globalAlpha = ctx.globalAlpha * 0.25;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 6]);
        ctx.stroke();
        ctx.restore();

        const origin = path.segments[0].p0;
        const totalL = stroke.lut.totalLength;
        let cached = this.dottedFluctuationCache.get(path);
        if (!cached || cached.fluctuation !== fluc || cached.totalLength !== totalL) {
          const dotSpacing = 16;
          const numDots = Math.floor(totalL / dotSpacing);
          const maxJitter = 18;
          const dots: Array<{ dx: number; dy: number }> = [];
          for (let i = 0; i <= numDots; i++) {
            const d = Math.min(totalL, i * dotSpacing + dotSpacing * 0.5);
            const evalPt = evaluateAtDistance(path, stroke.lut, d);
            const jitter = getHitJitter(stroke.id, i) * fluc * maxJitter;
            dots.push({
              dx: evalPt.point.x - origin.x,
              dy: evalPt.point.y + jitter - origin.y,
            });
          }
          cached = { fluctuation: fluc, totalLength: totalL, dots };
          this.dottedFluctuationCache.set(path, cached);
        }

        // Batch all scattered dots for this stroke into a single fill pass
        const radius = stroke.selected ? 3.0 : 2.2;
        ctx.fillStyle = effectiveColor;
        ctx.beginPath();
        for (let i = 0; i < cached.dots.length; i++) {
          const px = origin.x + cached.dots[i].dx;
          const py = origin.y + cached.dots[i].dy;
          ctx.moveTo(px + radius, py);
          ctx.arc(px, py, radius, 0, Math.PI * 2);
        }
        ctx.fill();
      } else {
        ctx.lineWidth = stroke.selected ? 4.5 : 3.5;
        ctx.setLineDash([2, 14]);
        ctx.stroke();
      }
    } else if (style === 'striped') {
      ctx.lineWidth = stroke.selected ? 4.0 : 3.0;
      // Multi-burst ratchet pattern (triplet micro-dash burst followed by rhythmic space)
      ctx.setLineDash([3, 4, 3, 4, 3, 14]);
      ctx.stroke();
    }

    // Selection Anchor Rings & Floating Volume Tag
    if (stroke.selected && path.segments.length > 0) {
      ctx.globalAlpha = 1.0;
      ctx.shadowBlur = 0;
      const startPt = path.segments[0].p0;
      const endPt = path.segments[path.segments.length - 1].p3;

      ctx.beginPath();
      ctx.arc(startPt.x, startPt.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#2563eb';
      ctx.stroke();

      if (!path.isClosed) {
        ctx.beginPath();
        ctx.arc(endPt.x, endPt.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#2563eb';
        ctx.stroke();
      }

      // Floating pill badge above start point with Volume, Texture, Speed Multiplier & Progress (suppressed during multi-selection)
      if (!isMultiSelection) {
        const volPercent = Math.round(vol * 100);
        const isTimerMode = stroke.timingMode === 'timer' || stroke.speedMode === 'timer';
        const speedMult = stroke.speedMultiplier ?? 1.0;
        const speedText = Number.isInteger(speedMult * 10) ? speedMult.toFixed(1) : speedMult.toFixed(2);
        const speedLabel = isTimerMode ? `${Math.round(stroke.duration ?? 30)}s` : `${speedText}x`;
        const progressPct = stroke.lut.totalLength > 0
          ? Math.min(100, Math.max(0, Math.round((stroke.playhead.currentDistance / stroke.lut.totalLength) * 100)))
          : 0;
        const travMode = (stroke.traversal === 'bounce' || (stroke.traversal as string) === 'pingpong') ? 'Bounce' : 'Loop';

        let tagText = stroke.isPoint
          ? (stroke.playhead.lastPitch
              ? `${volPercent}% vol • Dot (${stroke.playhead.lastPitch.noteName} · ${Math.round(stroke.playhead.lastPitch.frequency)}Hz)`
              : `${volPercent}% vol • Dot Note`)
          : `${volPercent}% vol • ${speedLabel} • ${progressPct}% • ${travMode}`;
        if (stroke.instrumentId === 'onyx') {
          const drumFreq = stroke.playhead.lastPitch?.frequency ?? 200;
          const drumName = resolveDrumZone(drumFreq, stroke.style === 'striped').label;
          const drumLabel = stroke.style === 'striped' ? `${drumName} Roll` : drumName;
          tagText = stroke.isPoint
            ? `${volPercent}% vol • ${drumLabel} Dot`
            : `${volPercent}% vol • ${drumLabel} • ${speedLabel} • ${progressPct}%`;
        } else if (stroke.waveParams && stroke.waveParams.amplitude > 0) {
          tagText = `${volPercent}% vol • Wave • ${speedLabel} • ${progressPct}%`;
        }

        ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        const textMetrics = ctx.measureText(tagText);
        const padX = 7;
        const tagW = textMetrics.width + padX * 2;
        const tagH = 17;
        const tagX = startPt.x - tagW / 2;
        const tagY = startPt.y - 22;

        ctx.fillStyle = '#1c1917';
        drawRoundRect(ctx, tagX, tagY, tagW, tagH, 8);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tagText, tagX + tagW / 2, tagY + tagH / 2);
      }
    }

    ctx.restore();
  }

  /**
   * Draws animated constant-velocity playhead with trail, acoustic pulse, and clean minimal HUD tag.
   */
  public drawPlayhead(
    stroke: DrawnStroke,
    nowMs: number,
    hasSolo: boolean = false,
    energyBoost: number = 0
  ): void {
    const ph = stroke.playhead;
    if (!ph.lastEval || ph.finished) return;

    const clampedEnergy = Math.max(0, Math.min(1, energyBoost));
    const { x, y } = ph.lastEval.point;
    const ctx = this.ctx;
    ctx.save();

    const isSoloGreyedOut = hasSolo && !stroke.soloed;
    const isGreyedOut = isSoloGreyedOut || !!stroke.muted;
    const baseColor = this.getStrokeColor(stroke);
    const effectiveColor = isGreyedOut ? '#a8a29e' : baseColor;
    const vol = typeof stroke.volume === 'number' ? stroke.volume : 1.0;
    const morphMultiplier = typeof stroke.morphGain === 'number' ? stroke.morphGain : 1.0;
    if (morphMultiplier <= 0.02) {
      ctx.restore();
      return;
    }

    if (isSoloGreyedOut) {
      ctx.globalAlpha = 0.16 * morphMultiplier;
    } else if (stroke.muted) {
      ctx.globalAlpha = 0.25 * morphMultiplier;
    } else {
      ctx.globalAlpha = (0.4 + 0.6 * vol) * morphMultiplier;
    }

    // 1. Motion Trail (for moving strokes only)
    if (!stroke.isPoint && ph.trail.length > 1) {
      for (let i = 0; i < ph.trail.length - 1; i++) {
        const ptA = ph.trail[i];
        const ptB = ph.trail[i + 1];
        const alpha = (1 - i / ph.trail.length) * 0.45;

        ctx.beginPath();
        ctx.moveTo(ptA.x, ptA.y);
        ctx.lineTo(ptB.x, ptB.y);
        ctx.strokeStyle = effectiveColor;
        ctx.globalAlpha = isSoloGreyedOut ? 0.16 * alpha : alpha;
        ctx.lineWidth = 2.5 * (1 - i / ph.trail.length);
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }
    ctx.globalAlpha = isSoloGreyedOut ? 0.16 : stroke.muted ? 0.25 : 1.0;

    // 2. Playhead Acoustic Pulse / Drone Breathing Halo
    if (!stroke.muted && !isSoloGreyedOut) {
      if (stroke.style === 'solid') {
        const swell = ph.currentSwell ?? 1.0;
        const breathePhase = (Math.sin(nowMs * 0.002) + 1) * 0.5;
        const breatheRadius = (8 + breathePhase * 8) * swell + clampedEnergy * 3;
        const breatheAlpha = Math.min(0.75, (0.2 + breathePhase * 0.25) * swell + clampedEnergy * 0.14);

        ctx.beginPath();
        ctx.arc(x, y, breatheRadius, 0, Math.PI * 2);
        ctx.strokeStyle = effectiveColor;
        ctx.globalAlpha = breatheAlpha;
        ctx.lineWidth = 1.6 + clampedEnergy * 0.4;
        ctx.stroke();
      } else {
        const speedMult = Math.max(0.1, stroke.speedMultiplier ?? 1.0);
        const pulsePeriod = stroke.isPoint ? Math.max(80, 1000 / speedMult) : 1400;
        const pulsePhase = (nowMs % pulsePeriod) / pulsePeriod;
        const pulseRadius = 6 + pulsePhase * 14 + clampedEnergy * 3;
        const pulseAlpha = Math.min(0.65, (1 - pulsePhase) * (0.45 + clampedEnergy * 0.18));

        ctx.beginPath();
        ctx.arc(x, y, pulseRadius, 0, Math.PI * 2);
        ctx.strokeStyle = effectiveColor;
        ctx.globalAlpha = pulseAlpha;
        ctx.lineWidth = 1.2 + clampedEnergy * 0.35;
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;
    }

    // 3. Playhead Center Bead
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = effectiveColor;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = isGreyedOut ? '#e7e5e4' : '#ffffff';
    ctx.fill();

    // 4. Clean Minimalist Note Tag with Pitch & Stereo Pan (only if not solo-greyed out)
    if (!isSoloGreyedOut && ph.lastPitch) {
      const normX = this.width > 0 ? Math.max(0, Math.min(1, x / this.width)) : 0.5;
      const panPercent = Math.round(Math.abs(normX - 0.5) * 200);
      const panText = normX < 0.46 ? `L${panPercent}%` : normX > 0.54 ? `R${panPercent}%` : 'C';

      let statusBadge = '';
      if (stroke.muted) statusBadge = ' [MUTE]';
      else if (stroke.soloed) statusBadge = ' [SOLO]';

      const badgeText = `${ph.lastPitch.noteName} · ${Math.round(ph.lastPitch.frequency)}Hz · ${panText}${statusBadge}`;
      const badgeX = x + 12;
      const badgeY = y - 16;

      ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      const textWidth = ctx.measureText(badgeText).width;
      const padding = 6;
      const boxW = textWidth + padding * 2;
      const boxH = 18;

      ctx.shadowColor = this.isDarkMode ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.08)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;

      ctx.fillStyle = this.isDarkMode ? 'rgba(15, 23, 42, 0.86)' : 'rgba(255, 255, 255, 0.94)';
      ctx.strokeStyle = stroke.selected
        ? (this.isDarkMode ? '#60a5fa' : '#2563eb')
        : stroke.soloed
        ? (this.isDarkMode ? '#fbbf24' : '#d97706')
        : ph.lastPitch.isSnapped
        ? baseColor
        : (this.isDarkMode ? 'rgba(255, 255, 255, 0.18)' : '#d6d3cd');
      ctx.lineWidth = 1;

      drawRoundRect(ctx, badgeX, badgeY - 12, boxW, boxH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = stroke.muted
        ? (this.isDarkMode ? '#94a3b8' : '#78716c')
        : (this.isDarkMode ? '#f8fafc' : '#1c1917');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, badgeX + padding, badgeY - 3);
    }

    ctx.restore();
  }

  /**
   * Draws active drawing gesture while user drags pointer.
   */
  public drawActiveGesture(points: Point2D[], color: string): void {
    if (points.length === 0) return;
    const ctx = this.ctx;
    ctx.save();

    if (points.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([4, 4]);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.restore();
  }

  /**
   * Draws dynamic disappearing ribbon trail for Live Play / Wand mode.
   * Features glowing halo, smooth tapering line width, head cursor bead,
   * and floating note badge with scale pitch and frequency.
   */
  public drawDisappearingTrail(
    trail: ReadonlyArray<LiveTrailPoint>,
    color: string,
    nowMs: number = performance.now(),
    isDarkMode: boolean = false,
    maxLifetimeMs: number = 1000
  ): void {
    if (!trail || trail.length === 0) return;

    const ctx = this.ctx;
    const head = trail[trail.length - 1];
    const headAge = nowMs - head.time;

    ctx.save();

    // 1. If multiple points, draw glowing tapering ribbons connecting them
    if (trail.length >= 2) {
      // Layered alpha passes avoid per-segment shadowBlur toggling at 60 FPS
      ctx.shadowBlur = 0;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;

      // Pass A1: Wide outer soft halo
      for (let i = 1; i < trail.length; i++) {
        const pPrev = trail[i - 1];
        const pCurr = trail[i];
        const age = nowMs - pCurr.time;
        if (age >= maxLifetimeMs) continue;

        const progress = Math.max(0, Math.min(1, age / maxLifetimeMs));
        const alpha = Math.pow(1 - progress, 1.4);
        if (alpha <= 0.01) continue;

        const trailRatio = i / (trail.length - 1);
        ctx.beginPath();
        ctx.moveTo(pPrev.screenX, pPrev.screenY);
        ctx.lineTo(pCurr.screenX, pCurr.screenY);
        ctx.globalAlpha = alpha * (isDarkMode ? 0.16 : 0.11);
        ctx.lineWidth = 7 + trailRatio * 13;
        ctx.stroke();
      }

      // Pass A2: Inner luminous glow
      for (let i = 1; i < trail.length; i++) {
        const pPrev = trail[i - 1];
        const pCurr = trail[i];
        const age = nowMs - pCurr.time;
        if (age >= maxLifetimeMs) continue;

        const progress = Math.max(0, Math.min(1, age / maxLifetimeMs));
        const alpha = Math.pow(1 - progress, 1.4);
        if (alpha <= 0.01) continue;

        const trailRatio = i / (trail.length - 1);
        ctx.beginPath();
        ctx.moveTo(pPrev.screenX, pPrev.screenY);
        ctx.lineTo(pCurr.screenX, pCurr.screenY);
        ctx.globalAlpha = alpha * (isDarkMode ? 0.34 : 0.28);
        ctx.lineWidth = 3 + trailRatio * 7;
        ctx.stroke();
      }

      // Pass B: Crisp core ribbon with smooth tapering
      ctx.strokeStyle = isDarkMode ? '#ffffff' : color;
      for (let i = 1; i < trail.length; i++) {
        const pPrev = trail[i - 1];
        const pCurr = trail[i];
        const age = nowMs - pCurr.time;
        if (age >= maxLifetimeMs) continue;

        const progress = Math.max(0, Math.min(1, age / maxLifetimeMs));
        const alpha = Math.pow(1 - progress, 1.2);
        if (alpha <= 0.01) continue;

        const trailRatio = i / (trail.length - 1);
        const coreWidth = 1.2 + trailRatio * 3.2;

        ctx.beginPath();
        ctx.moveTo(pPrev.screenX, pPrev.screenY);
        ctx.lineTo(pCurr.screenX, pCurr.screenY);

        ctx.globalAlpha = alpha * 0.95;
        ctx.lineWidth = coreWidth;
        ctx.stroke();
      }
    }

    // 2. Cursor head orb / pulsing bead
    if (head && headAge < maxLifetimeMs) {
      const headAlpha = Math.max(0, 1 - headAge / maxLifetimeMs);

      // Outer glowing ring
      ctx.beginPath();
      ctx.arc(head.screenX, head.screenY, 7, 0, Math.PI * 2);
      ctx.shadowColor = color;
      ctx.shadowBlur = isDarkMode ? 12 : 8;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = headAlpha * 0.8;
      ctx.stroke();

      // Inner bright bead
      ctx.beginPath();
      ctx.arc(head.screenX, head.screenY, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = isDarkMode ? '#ffffff' : color;
      ctx.globalAlpha = headAlpha;
      ctx.fill();

      // 3. Sleek Floating Note Pill Badge (shows scale pitch & Hz or drum zone name)
      if (head.noteName && headAge < 850) {
        const badgeAlpha = Math.max(0, 1 - headAge / 850);
        const freqText = head.frequency ? ` · ${Math.round(head.frequency)}Hz` : '';
        const badgeText = `${head.noteName}${freqText}`;
        const badgeX = head.screenX + 12;
        const badgeY = head.screenY - 18;

        ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const textWidth = ctx.measureText(badgeText).width;
        const padding = 7;
        const boxW = textWidth + padding * 2;
        const boxH = 20;

        ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 2;

        ctx.fillStyle = isDarkMode ? 'rgba(24, 24, 28, 0.92)' : 'rgba(255, 255, 255, 0.95)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.globalAlpha = badgeAlpha;

        drawRoundRect(ctx, badgeX, badgeY - 13, boxW, boxH, 5);
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.fillStyle = isDarkMode ? '#f4f4f5' : '#18181b';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, badgeX + padding, badgeY - 3);
      }
    }

    ctx.restore();
  }

  /**
   * Spawns radiant acoustic sparks at a given canvas coordinate (e.g. note strikes, drum beats, boundary bounces).
   */
  public spawnSparks(x: number, y: number, color: string, count: number = 7, speedMultiplier: number = 1.0): void {
    const effectiveColor = this.isDarkMode && (color === '#18181b' || color === 'black') ? '#f4f4f5' : color;
    const pool = this.particlePool;
    const poolLen = this.maxParticles;

    for (let i = 0; i < count; i++) {
      let slot = this.particleCursor;
      for (let scan = 0; scan < poolLen; scan++) {
        const idx = (this.particleCursor + scan) % poolLen;
        if (!pool[idx].active) {
          slot = idx;
          break;
        }
      }

      const angle = Math.random() * Math.PI * 2;
      const speed = (1.2 + Math.random() * 2.8) * speedMultiplier;
      const life = 0.28 + Math.random() * 0.25; // seconds
      const radius = 1.2 + Math.random() * 2.0;

      const p = pool[slot];
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.color = effectiveColor;
      p.alpha = 0.9;
      p.radius = radius;
      p.life = life;
      p.maxLife = life;

      this.particleCursor = (slot + 1) % poolLen;
    }
  }

  /**
   * Updates physics and draws all active spark particles.
   */
  public updateAndDrawParticles(dtSec: number): void {
    const ctx = this.ctx;
    const pool = this.particlePool;
    const step = Math.min(Math.max(0, dtSec) * 60, 3);
    const damping = Math.pow(0.94, step);
    let didSave = false;

    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (!p.active) continue;

      p.life -= dtSec;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }

      if (!didSave) {
        ctx.save();
        didSave = true;
      }

      p.x += p.vx * step;
      p.y += p.vy * step;
      p.vx *= damping;
      p.vy *= damping;

      const progress = p.life / p.maxLife; // 1 down to 0
      const currentAlpha = p.alpha * progress;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * progress, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, Math.min(1, currentAlpha));
      ctx.fill();
    }

    if (didSave) {
      ctx.restore();
    }
  }

  /**
   * Renders ambient audio-reactive spectrum along the bottom margin of the canvas.
   */
  public drawAudioReactiveSpectrum(
    freqData: Uint8Array | null,
    masterEnergy: number,
    bands?: { low: number; mid: number; high: number; master?: number }
  ): void {
    const hasFreqData = !!freqData && freqData.length > 0;
    if (!hasFreqData && !bands) return;

    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    const effectiveMaster = masterEnergy > 0 ? masterEnergy : (bands?.master ?? 0);
    // Exponentially smooth master energy so audio transients never strobe or flicker
    this.smoothedMasterEnergy = this.smoothedMasterEnergy * 0.90 + effectiveMaster * 0.10;

    let rawLow = 0;
    let rawMid = 0;
    let rawHigh = 0;
    if (bands) {
      rawLow = bands.low;
      rawMid = bands.mid;
      rawHigh = bands.high;
    } else if (freqData && freqData.length > 0) {
      const len = freqData.length;
      const lowEnd = Math.max(1, Math.floor(len * 0.18));
      const midEnd = Math.max(lowEnd + 1, Math.floor(len * 0.55));
      let lowSum = 0;
      let midSum = 0;
      let highSum = 0;
      for (let i = 0; i < len; i++) {
        const v = freqData[i] / 255;
        if (i < lowEnd) lowSum += v;
        else if (i < midEnd) midSum += v;
        else highSum += v;
      }
      rawLow = lowSum / lowEnd;
      rawMid = midSum / Math.max(1, midEnd - lowEnd);
      rawHigh = highSum / Math.max(1, len - midEnd);
    }

    this.smoothedBands.low = this.smoothedBands.low * 0.88 + rawLow * 0.12;
    this.smoothedBands.mid = this.smoothedBands.mid * 0.88 + rawMid * 0.12;
    this.smoothedBands.high = this.smoothedBands.high * 0.88 + rawHigh * 0.12;

    ctx.save();

    // 1. Subtle, ultra-soft perimeter edge vignette (100% transparent center, zero background flicker)
    const combinedEnergy = Math.max(
      this.smoothedMasterEnergy,
      this.smoothedBands.low * 0.5 + this.smoothedBands.mid * 0.35 + this.smoothedBands.high * 0.15
    );
    if (combinedEnergy > 0.08) {
      const glowAlpha = Math.min(0.06, (combinedEnergy - 0.08) * 0.12);
      if (glowAlpha > 0.005) {
        if (
          !this.cachedVignetteGradient ||
          !this.cachedWarmVignetteGradient ||
          this.cachedVignetteWidth !== w ||
          this.cachedVignetteHeight !== h ||
          this.cachedVignetteDarkMode !== this.isDarkMode
        ) {
          const coolGrad = ctx.createRadialGradient(w * 0.5, h * 0.5, h * 0.25, w * 0.5, h * 0.5, w * 0.85);
          coolGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
          coolGrad.addColorStop(1, this.isDarkMode ? 'rgba(59, 130, 246, 0.4)' : 'rgba(37, 99, 235, 0.25)');
          this.cachedVignetteGradient = coolGrad;

          const warmGrad = ctx.createRadialGradient(w * 0.5, h * 0.5, h * 0.25, w * 0.5, h * 0.5, w * 0.85);
          warmGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
          warmGrad.addColorStop(1, this.isDarkMode ? 'rgba(245, 158, 11, 0.36)' : 'rgba(217, 119, 6, 0.22)');
          this.cachedWarmVignetteGradient = warmGrad;

          this.cachedVignetteWidth = w;
          this.cachedVignetteHeight = h;
          this.cachedVignetteDarkMode = this.isDarkMode;
        }

        const totalBand = this.smoothedBands.low + this.smoothedBands.mid + this.smoothedBands.high;
        const warmWeight = totalBand > 0.001
          ? Math.max(0, Math.min(1, this.smoothedBands.low / totalBand))
          : 0;
        const coolAlpha = glowAlpha * (1 - warmWeight * 0.65);
        const warmAlpha = glowAlpha * warmWeight * 0.85;

        if (coolAlpha > 0.002) {
          ctx.globalAlpha = coolAlpha;
          ctx.fillStyle = this.cachedVignetteGradient;
          ctx.fillRect(0, 0, w, h);
        }
        if (warmAlpha > 0.002) {
          ctx.globalAlpha = warmAlpha;
          ctx.fillStyle = this.cachedWarmVignetteGradient;
          ctx.fillRect(0, 0, w, h);
        }
        ctx.globalAlpha = 1.0;
      }
    }

    // 2. Minimalist glowing waveform/spectrum floor along the bottom canvas
    if (freqData && freqData.length > 0) {
      const bins = Math.min(freqData.length, 32);
      const barWidth = w / bins;
      const intensityScale = 1 + Math.min(0.25, this.smoothedBands.mid * 0.2 + this.smoothedBands.high * 0.15);
      const maxHeight = Math.min(36, h * 0.08) * intensityScale;

      ctx.beginPath();
      ctx.moveTo(0, h);

      for (let i = 0; i < bins; i++) {
        const val = freqData[i] / 255;
        const barH = val * maxHeight;
        const x = i * barWidth + barWidth * 0.5;
        const y = h - barH;
        if (i === 0) {
          ctx.lineTo(0, y);
        }
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();

      const floorAlpha = this.isDarkMode
        ? Math.min(0.11, 0.06 + this.smoothedBands.high * 0.04)
        : Math.min(0.08, 0.04 + this.smoothedBands.high * 0.03);
      ctx.fillStyle = this.isDarkMode
        ? `rgba(96, 165, 250, ${floorAlpha.toFixed(4)})`
        : `rgba(37, 99, 235, ${floorAlpha.toFixed(4)})`;
      ctx.fill();
    }

    ctx.restore();
  }
}

