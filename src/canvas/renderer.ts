import { DrawnStroke } from '../engine/types';
import { ScaleGuideline } from '../audio/scaleQuantizer';
import { Point2D } from '../math/types';
import { getHitJitter } from '../engine/strokeManager';
import { evaluateAtDistance } from '../math/arcLengthInverter';
import { LiveTrailPoint } from './inputHandler';

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

  public isDarkMode = false;

  public setDarkMode(dark: boolean): void {
    this.isDarkMode = dark;
  }

  public clear(): void {
    const w = this.width;
    const h = this.height;

    if (this.isDarkMode) {
      this.ctx.fillStyle = '#0f0f12';
      this.ctx.fillRect(0, 0, w, h);

      const radial = this.ctx.createRadialGradient(w * 0.5, h * 0.45, h * 0.15, w * 0.5, h * 0.5, w * 0.85);
      radial.addColorStop(0, '#18181c');
      radial.addColorStop(1, '#0b0b0e');
      this.ctx.fillStyle = radial;
      this.ctx.fillRect(0, 0, w, h);
    } else {
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
    const leftMargin = Math.min(84, Math.max(56, w * 0.04));
    const rightMargin = Math.min(80, Math.max(56, w * 0.04));

    for (const g of guidelines) {
      const y = typeof g.screenY === 'number' ? g.screenY : g.y;
      if (y < -30 || y > h + 30) continue;

      this.ctx.beginPath();
      this.ctx.moveTo(leftMargin, y);
      this.ctx.lineTo(w - rightMargin, y);

      const isFifth = g.scaleDegree % 7 === 4; // Dominant 5th in heptatonic modes
      const isChordTone = !!g.isChordTone && !g.isRoot;

      if (g.isRoot) {
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

      // Note Name on margins
      this.ctx.setLineDash([]);
      this.ctx.font = g.isRoot
        ? '700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        : isChordTone
        ? '600 10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        : isFifth
        ? '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        : '400 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

      this.ctx.fillStyle = g.isRoot
        ? (this.isDarkMode ? '#ffffff' : '#1c1917')
        : isChordTone
        ? (this.isDarkMode ? '#fbbf24' : '#b45309')
        : isFifth
        ? (this.isDarkMode ? '#93c5fd' : '#2563eb')
        : (this.isDarkMode ? '#71717a' : '#a8a29e');
      this.ctx.textAlign = 'right';
      this.ctx.textBaseline = 'middle';

      const label = g.isRoot
        ? `★ ${g.noteName}`
        : isChordTone
        ? `◆ ${g.noteName}`
        : isFifth
        ? `${g.noteName} (5th)`
        : g.noteName;
      this.ctx.fillText(label, leftMargin - 14, y);

      this.ctx.textAlign = 'left';
      this.ctx.fillStyle = isChordTone
        ? (this.isDarkMode ? '#fbbf24' : '#b45309')
        : (this.isDarkMode ? '#71717a' : '#a8a29e');
      this.ctx.fillText(`${Math.round(g.frequency)}Hz`, w - rightMargin + 14, y);
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
  public drawDrumZones(isActive: boolean): void {
    if (!isActive) return;
    const w = this.width;
    const h = this.height;
    const ctx = this.ctx;
    ctx.save();

    const leftMargin = Math.min(84, Math.max(56, w * 0.08));
    const rightMargin = Math.min(80, Math.max(56, w * 0.08));

    const zones = [
      { y: h * 0.25, label: '🥢 Hi-Hats' },
      { y: h * 0.48, label: '🥁 Toms' },
      { y: h * 0.72, label: '🪘 Snare / Clap' },
    ];

    for (const z of zones) {
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
    ctx.font = '700 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = this.isDarkMode ? 'rgba(255, 255, 255, 0.85)' : 'rgba(24, 24, 27, 0.75)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('💥 Kick Drum', w - rightMargin, h - 14);

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
  public drawStroke(stroke: DrawnStroke, hasSolo: boolean = false): void {
    const { path, style } = stroke;
    const ctx = this.ctx;
    ctx.save();

    const isGreyedOut = (hasSolo && !stroke.soloed) || !!stroke.muted;
    const baseColor = this.getStrokeColor(stroke);
    const effectiveColor = isGreyedOut ? '#a8a29e' : baseColor;
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
      const fluc = stroke.fluctuation ?? 0;
      if (fluc > 0 && stroke.lut && stroke.lut.totalLength > 0) {
        // Draw subtle faint baseline path so the user sees the original trajectory
        ctx.save();
        ctx.globalAlpha = ctx.globalAlpha * 0.25;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 6]);
        ctx.stroke();
        ctx.restore();

        // Draw individual scattered fluctuating dots
        const dotSpacing = 16;
        const totalL = stroke.lut.totalLength;
        const numDots = Math.floor(totalL / dotSpacing);
        const radius = stroke.selected ? 3.0 : 2.2;
        const maxJitter = 18;

        ctx.fillStyle = effectiveColor;
        for (let i = 0; i <= numDots; i++) {
          const d = Math.min(totalL, i * dotSpacing + dotSpacing * 0.5);
          const evalPt = evaluateAtDistance(stroke.path, stroke.lut, d);
          const jitter = getHitJitter(stroke.id, i) * fluc * maxJitter;
          ctx.beginPath();
          ctx.arc(evalPt.point.x, evalPt.point.y + jitter, radius, 0, Math.PI * 2);
          ctx.fill();
        }
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

      // Floating pill badge above start point with Volume, Texture, Loop Duration & Progress
      const volPercent = Math.round(vol * 100);
      const totalSec = (stroke.timingMode === 'timer' || stroke.speedMode === 'timer')
        ? (stroke.duration ?? 30)
        : (stroke.lut.totalLength / Math.max(1, stroke.playhead.velocity || 100));
      const progressPct = stroke.lut.totalLength > 0
        ? Math.min(100, Math.max(0, Math.round((stroke.playhead.currentDistance / stroke.lut.totalLength) * 100)))
        : 0;
      const syncLabel = `${totalSec.toFixed(1)}s`;
      const travMode = (stroke.traversal === 'bounce' || (stroke.traversal as string) === 'pingpong') ? 'Bounce' : 'Loop';

      let tagText = `${volPercent}% vol • ${syncLabel} • ${progressPct}% • ${travMode}`;
      if (stroke.instrumentId === 'onyx') {
        const normY = this.height > 0 ? startPt.y / this.height : 0.5;
        const drumName = normY >= 0.72 ? 'Kick' : normY >= 0.48 ? 'Snare' : normY >= 0.25 ? 'Tom' : 'Hi-Hat';
        const drumLabel = stroke.style === 'striped' ? `${drumName} Roll` : drumName;
        tagText = `${volPercent}% vol • ${drumLabel} • ${syncLabel} • ${progressPct}%`;
      } else if (stroke.waveParams && stroke.waveParams.amplitude > 0) {
        tagText = `${volPercent}% vol • Wave • ${syncLabel} • ${progressPct}%`;
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
    if (!ph.lastEval || ph.finished) return;

    const { x, y } = ph.lastEval.point;
    const ctx = this.ctx;
    ctx.save();

    const isSoloGreyedOut = hasSolo && !stroke.soloed;
    const isGreyedOut = isSoloGreyedOut || !!stroke.muted;
    const baseColor = this.getStrokeColor(stroke);
    const effectiveColor = isGreyedOut ? '#a8a29e' : baseColor;
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

    // 2. Playhead Acoustic Pulse / Drone Breathing Halo
    if (!stroke.muted && !isSoloGreyedOut) {
      if (stroke.style === 'solid') {
        const swell = ph.currentSwell ?? 1.0;
        const breathePhase = (Math.sin(nowMs * 0.002) + 1) * 0.5;
        const breatheRadius = (8 + breathePhase * 8) * swell;
        const breatheAlpha = Math.min(0.65, (0.2 + breathePhase * 0.25) * swell);

        ctx.beginPath();
        ctx.arc(x, y, breatheRadius, 0, Math.PI * 2);
        ctx.strokeStyle = effectiveColor;
        ctx.globalAlpha = breatheAlpha;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      } else {
        const pulsePhase = (nowMs % 1400) / 1400;
        const pulseRadius = 6 + pulsePhase * 14;
        const pulseAlpha = (1 - pulsePhase) * 0.45;

        ctx.beginPath();
        ctx.arc(x, y, pulseRadius, 0, Math.PI * 2);
        ctx.strokeStyle = effectiveColor;
        ctx.globalAlpha = pulseAlpha;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
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
      // Pass A: Soft luminous outer glow
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 1; i < trail.length; i++) {
        const pPrev = trail[i - 1];
        const pCurr = trail[i];
        const age = nowMs - pCurr.time;
        if (age >= maxLifetimeMs) continue;

        const progress = Math.max(0, Math.min(1, age / maxLifetimeMs));
        const alpha = Math.pow(1 - progress, 1.4);
        if (alpha <= 0.01) continue;

        // Position along the trail (0 at start, 1 at head)
        const trailRatio = i / (trail.length - 1);
        const glowWidth = 3 + trailRatio * 7;

        ctx.beginPath();
        ctx.moveTo(pPrev.screenX, pPrev.screenY);
        ctx.lineTo(pCurr.screenX, pCurr.screenY);

        ctx.shadowColor = color;
        ctx.shadowBlur = isDarkMode ? 14 : 8;
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha * 0.45;
        ctx.lineWidth = glowWidth;
        ctx.stroke();
      }

      // Pass B: Crisp core ribbon with smooth tapering
      ctx.shadowBlur = 0;
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

        ctx.strokeStyle = isDarkMode ? '#ffffff' : color;
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

        ctx.beginPath();
        if (typeof (ctx as any).roundRect === 'function') {
          (ctx as any).roundRect(badgeX, badgeY - 13, boxW, boxH, 5);
        } else {
          ctx.rect(badgeX, badgeY - 13, boxW, boxH);
        }
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
}

