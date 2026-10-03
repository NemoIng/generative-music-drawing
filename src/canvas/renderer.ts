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
   * Clearly highlights Root (Tonic) and 5th (Dominant) degrees for harmonic grounding.
   */
  public drawGuidelines(guidelines: ScaleGuideline[]): void {
    const w = this.width;
    this.ctx.save();

    for (const g of guidelines) {
      this.ctx.beginPath();
      this.ctx.moveTo(44, g.y);
      this.ctx.lineTo(w - 44, g.y);

      const isFifth = g.scaleDegree % 7 === 4; // Dominant 5th in heptatonic modes

      if (g.isRoot) {
        this.ctx.strokeStyle = 'rgba(28, 25, 23, 0.35)';
        this.ctx.lineWidth = 1.4;
        this.ctx.setLineDash([]);
      } else if (isFifth) {
        this.ctx.strokeStyle = 'rgba(37, 99, 235, 0.22)';
        this.ctx.lineWidth = 1.2;
        this.ctx.setLineDash([6, 6]);
      } else {
        this.ctx.strokeStyle = 'rgba(120, 113, 108, 0.09)';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([3, 5]);
      }
      this.ctx.stroke();

      // Note Name on margins
      this.ctx.setLineDash([]);
      this.ctx.font = g.isRoot
        ? '700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        : isFifth
        ? '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        : '400 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

      this.ctx.fillStyle = g.isRoot ? '#1c1917' : isFifth ? '#2563eb' : '#a8a29e';
      this.ctx.textAlign = 'right';
      this.ctx.textBaseline = 'middle';

      const label = g.isRoot ? `★ ${g.noteName}` : isFifth ? `${g.noteName} (5th)` : g.noteName;
      this.ctx.fillText(label, 36, g.y);

      this.ctx.textAlign = 'left';
      this.ctx.fillText(`${Math.round(g.frequency)}Hz`, w - 36, g.y);
    }

    this.ctx.restore();
  }

  /**
   * Draws subtle drum tier zone guides when the Onyx drum machine ink is active.
   */
  public drawDrumZones(isActive: boolean): void {
    if (!isActive) return;
    const w = this.width;
    const h = this.height;
    const ctx = this.ctx;
    ctx.save();

    const zones = [
      { y: h * 0.25, label: '🥢 Hi-Hats' },
      { y: h * 0.48, label: '🥁 Toms' },
      { y: h * 0.72, label: '🪘 Snare / Clap' },
    ];

    for (const z of zones) {
      ctx.beginPath();
      ctx.moveTo(44, z.y);
      ctx.lineTo(w - 44, z.y);
      ctx.strokeStyle = 'rgba(24, 24, 27, 0.22)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(24, 24, 27, 0.65)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(z.label, w - 48, z.y - 3);
    }

    // Bottom Kick label
    ctx.font = '700 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(24, 24, 27, 0.75)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('💥 Kick Drum', w - 48, h - 14);

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
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 4 Beat tick dots
    for (let b = 0; b < 4; b++) {
      const bx = startX + (b / 3) * barW;
      const isCurrent = b === beatIndex;
      ctx.beginPath();
      ctx.arc(bx, y, isCurrent ? 3.5 : 2, 0, Math.PI * 2);
      ctx.fillStyle = isCurrent ? '#1c1917' : 'rgba(0, 0, 0, 0.2)';
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
   * Renders completed strokes with ink-on-paper aesthetics and mute/solo awareness.
   */
  public drawStroke(stroke: DrawnStroke, hasSolo: boolean = false): void {
    const { path, color, style } = stroke;
    const ctx = this.ctx;
    ctx.save();

    const isGreyedOut = (hasSolo && !stroke.soloed) || !!stroke.muted;
    const effectiveColor = isGreyedOut ? '#a8a29e' : color;
    const vol = typeof stroke.volume === 'number' ? stroke.volume : 1.0;

    if (hasSolo && !stroke.soloed) {
      // Greyed out because another line is soloed
      ctx.globalAlpha = 0.20;
    } else if (stroke.muted) {
      ctx.globalAlpha = 0.25;
    } else {
      ctx.globalAlpha = 0.35 + 0.65 * vol;
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

    // Outer glow / selection depth
    if (isGreyedOut) {
      ctx.shadowBlur = 0;
    } else if (stroke.selected) {
      ctx.shadowColor = 'rgba(37, 99, 235, 0.4)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 0;
    } else if (stroke.soloed) {
      ctx.shadowColor = 'rgba(217, 119, 6, 0.45)';
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

    ctx.strokeStyle = effectiveColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (style === 'solid') {
      ctx.lineWidth = stroke.selected ? 4.5 : 3.5;
      ctx.setLineDash([]);
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = effectiveColor;
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

      // Floating pill badge above start point with Volume, Texture, Loop Sync & Traversal info
      const volPercent = Math.round(vol * 100);
      const styleName = stroke.style.charAt(0).toUpperCase() + stroke.style.slice(1);
      const syncLabel = (stroke.loopQuantize ?? '1bar') === '1bar' ? '1 Bar'
        : (stroke.loopQuantize === '2bars' ? '2 Bars'
        : (stroke.loopQuantize === '4bars' ? '4 Bars' : 'Free'));
      const travLabel = (stroke.traversal ?? 'restart') === 'pingpong' ? '⇄' : '↻';

      let tagText = `${volPercent}% vol • ${styleName} • ${syncLabel} • ${travLabel}`;
      if (stroke.instrumentId === 'onyx') {
        const normY = this.height > 0 ? startPt.y / this.height : 0.5;
        const drumName = normY >= 0.72 ? 'Kick 💥' : normY >= 0.48 ? 'Snare 🪘' : normY >= 0.25 ? 'Tom 🥁' : 'Hi-Hat 🥢';
        tagText = `${volPercent}% vol • ${drumName} • ${syncLabel} • ${travLabel}`;
      } else if (stroke.waveParams && stroke.waveParams.amplitude > 0) {
        tagText = `${volPercent}% vol • ~Sine • ${styleName} • ${syncLabel} • ${travLabel}`;
      }

      ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      const textMetrics = ctx.measureText(tagText);
      const padX = 7;
      const tagW = textMetrics.width + padX * 2;
      const tagH = 17;
      const tagX = startPt.x - tagW / 2;
      const tagY = startPt.y - 22;

      ctx.fillStyle = '#1c1917';
      ctx.beginPath();
      ctx.roundRect(tagX, tagY, tagW, tagH, 8);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tagText, tagX + tagW / 2, tagY + tagH / 2);
    }

    ctx.restore();
  }

  /**
   * Draws animated constant-velocity playhead with trail, acoustic pulse, and clean minimal HUD tag.
   */
  public drawPlayhead(stroke: DrawnStroke, nowMs: number, hasSolo: boolean = false): void {
    const ph = stroke.playhead;
    if (!ph.lastEval) return;

    const { x, y } = ph.lastEval.point;
    const ctx = this.ctx;
    ctx.save();

    const isSoloGreyedOut = hasSolo && !stroke.soloed;
    const isGreyedOut = isSoloGreyedOut || !!stroke.muted;
    const effectiveColor = isGreyedOut ? '#a8a29e' : stroke.color;
    const vol = typeof stroke.volume === 'number' ? stroke.volume : 1.0;

    if (isSoloGreyedOut) {
      ctx.globalAlpha = 0.16;
    } else if (stroke.muted) {
      ctx.globalAlpha = 0.25;
    } else {
      ctx.globalAlpha = 0.4 + 0.6 * vol;
    }

    // 1. Motion Trail
    if (ph.trail.length > 1) {
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

    // 2. Playhead Acoustic Pulse Ring (only if audible and not solo-greyed out)
    if (!stroke.muted && !isSoloGreyedOut) {
      const pulsePhase = (nowMs % 1400) / 1400;
      const pulseRadius = 6 + pulsePhase * 14;
      const pulseAlpha = (1 - pulsePhase) * 0.45;

      ctx.beginPath();
      ctx.arc(x, y, pulseRadius, 0, Math.PI * 2);
      ctx.strokeStyle = effectiveColor;
      ctx.globalAlpha = pulseAlpha;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    // 3. Playhead Center Bead
    ctx.shadowColor = isGreyedOut ? 'transparent' : 'rgba(0, 0, 0, 0.15)';
    ctx.shadowBlur = isGreyedOut ? 0 : 6;
    ctx.shadowOffsetY = isGreyedOut ? 0 : 1;

    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = effectiveColor;
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
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

      ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;

      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = stroke.selected ? '#2563eb' : stroke.soloed ? '#d97706' : ph.lastPitch.isSnapped ? stroke.color : '#d6d3cd';
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY - 12, boxW, boxH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = stroke.muted ? '#78716c' : '#1c1917';
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

    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.restore();
  }
}
