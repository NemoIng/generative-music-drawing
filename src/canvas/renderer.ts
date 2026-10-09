import { DrawnStroke } from '../engine/types';
import { ScaleGuideline, ScaleQuantizer } from '../audio/scaleQuantizer';
import { Point2D } from '../math/types';
import { getHitJitter } from '../engine/strokeManager';
import { evaluateAtDistance } from '../math/arcLengthInverter';
import { LiveTrailPoint } from './inputHandler';

export interface SparkParticle {
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
  private particles: SparkParticle[] = [];
  private maxParticles = 140;

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
    // 135px rightMargin ensures frequency labels sit to the left of the pitch navigator rail (width 54px + 12px margin + padding)
    const leftMargin = Math.min(84, Math.max(56, w * 0.04));
    const rightMargin = Math.min(150, Math.max(130, w * 0.09));

    // Filter visible guidelines and calculate vertical distances to avoid text overlapping
    const visible = guidelines
      .map((g) => ({ g, y: typeof g.screenY === 'number' ? g.screenY : g.y }))
      .filter(({ y }) => y >= -30 && y <= h + 30)
      .sort((a, b) => a.y - b.y);

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

      const isFifth = g.scaleDegree % 7 === 4; // Dominant 5th in heptatonic modes
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
        this.ctx.fillText(label, leftMargin - 14, textY);
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

    const leftMargin = Math.min(84, Math.max(56, w * 0.08));
    const rightMargin = Math.min(150, Math.max(130, w * 0.09));

    let zones: { y: number; label: string }[];
    if (quantizer) {
      const yFromFreq = (freq: number) => {
        const u = ScaleQuantizer.frequencyToNormalizedU(freq);
        const worldY = quantizer.normalizedUToWorldY(u, h);
        return quantizer.worldToScreenY(worldY, h);
      };
      zones = [
        { y: yFromFreq(2200), label: 'Hi-Hats (2.2k+ Hz)' },
        { y: yFromFreq(650), label: 'Toms (650–2.2k Hz)' },
        { y: yFromFreq(260), label: 'Snare / Clap (260–650 Hz)' },
      ];
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
    let kickScreenY = h - 14;
    if (quantizer) {
      const uKick = ScaleQuantizer.frequencyToNormalizedU(140);
      const worldY = quantizer.normalizedUToWorldY(uKick, h);
      kickScreenY = quantizer.worldToScreenY(worldY, h);
    }
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
    const morphMultiplier = typeof stroke.morphGain === 'number' ? stroke.morphGain : 1.0;

    if (hasSolo && !stroke.soloed) {
      // Greyed out because another line is soloed
      ctx.globalAlpha = 0.20 * morphMultiplier;
    } else if (stroke.muted) {
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

      // Floating pill badge above start point with Volume, Texture, Speed Multiplier & Progress
      const volPercent = Math.round(vol * 100);
      const speedMult = stroke.speedMultiplier ?? 1.0;
      const speedText = Number.isInteger(speedMult * 10) ? speedMult.toFixed(1) : speedMult.toFixed(2);
      const speedLabel = `${speedText}x`;
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
        const drumName = drumFreq < 260 ? 'Kick' : drumFreq < 650 ? 'Snare' : drumFreq < 2200 ? 'Tom' : 'Hi-Hat';
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
        const breatheRadius = (8 + breathePhase * 8) * swell;
        const breatheAlpha = Math.min(0.65, (0.2 + breathePhase * 0.25) * swell);

        ctx.beginPath();
        ctx.arc(x, y, breatheRadius, 0, Math.PI * 2);
        ctx.strokeStyle = effectiveColor;
        ctx.globalAlpha = breatheAlpha;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      } else {
        const speedMult = Math.max(0.1, stroke.speedMultiplier ?? 1.0);
        const pulsePeriod = stroke.isPoint ? Math.max(80, 1000 / speedMult) : 1400;
        const pulsePhase = (nowMs % pulsePeriod) / pulsePeriod;
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

  /**
   * Spawns radiant acoustic sparks at a given canvas coordinate (e.g. note strikes, drum beats, boundary bounces).
   */
  public spawnSparks(x: number, y: number, color: string, count: number = 7, speedMultiplier: number = 1.0): void {
    const effectiveColor = this.isDarkMode && (color === '#18181b' || color === 'black') ? '#f4f4f5' : color;
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) {
        this.particles.shift(); // Evict oldest
      }
      const angle = Math.random() * Math.PI * 2;
      const speed = (1.2 + Math.random() * 2.8) * speedMultiplier;
      const life = 0.28 + Math.random() * 0.25; // seconds
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: effectiveColor,
        alpha: 0.9,
        radius: 1.2 + Math.random() * 2.0,
        life,
        maxLife: life,
      });
    }
  }

  /**
   * Updates physics and draws all active spark particles.
   */
  public updateAndDrawParticles(dtSec: number): void {
    if (this.particles.length === 0) return;
    const ctx = this.ctx;
    ctx.save();

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dtSec;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.94; // slight drag
      p.vy *= 0.94;

      const progress = p.life / p.maxLife; // 1 down to 0
      const currentAlpha = p.alpha * progress;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * progress, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, Math.min(1, currentAlpha));
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Renders ambient audio-reactive spectrum along the bottom margin of the canvas.
   */
  public drawAudioReactiveSpectrum(freqData: Uint8Array | null, masterEnergy: number): void {
    if (!freqData || freqData.length === 0 || masterEnergy <= 0.01) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.save();

    // 1. Subtle ambient vignette pulse based on master energy
    if (masterEnergy > 0.05) {
      const glowAlpha = Math.min(0.12, (masterEnergy - 0.05) * 0.18);
      const grad = ctx.createRadialGradient(w * 0.5, h * 0.5, h * 0.2, w * 0.5, h * 0.5, w * 0.75);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(1, this.isDarkMode ? `rgba(59, 130, 246, ${glowAlpha})` : `rgba(37, 99, 235, ${glowAlpha * 0.7})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    // 2. Minimalist glowing waveform/spectrum floor along the bottom canvas
    const bins = Math.min(freqData.length, 32);
    const barWidth = w / bins;
    const maxHeight = Math.min(36, h * 0.08);

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

    ctx.fillStyle = this.isDarkMode ? 'rgba(96, 165, 250, 0.06)' : 'rgba(37, 99, 235, 0.04)';
    ctx.fill();

    ctx.restore();
  }
}

