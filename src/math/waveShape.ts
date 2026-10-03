import { Point2D, SplinePath } from './types';
import { fitSplineFromPoints } from './curveFit';

export type WaveShapeType = 'sine' | 'tangent' | 'triangle' | 'square' | 'sawtooth' | 'arch';

export interface WaveParams {
  shapeType?: WaveShapeType;
  amplitude: number; // in pixels (e.g. 0 to 100)
  periods: number;   // number of full cycles (e.g. 0.5 to 8)
  phase?: number;    // phase offset in radians (default 0)
  baseP0: Point2D;
  baseP1: Point2D;
}

/**
 * Computes normalized mathematical wave displacement [-1, 1] for a given shape type.
 */
export function evaluateWaveShape(shapeType: WaveShapeType, s: number, periods: number, phase: number = 0): number {
  const angle = 2 * Math.PI * periods * s + phase;
  const rawPhase = (periods * s + phase / (2 * Math.PI)) % 1;
  const u = rawPhase < 0 ? rawPhase + 1 : rawPhase;

  switch (shapeType) {
    case 'tangent': {
      // Bounded, smooth tangent sweep with steep crescendo inflection
      const w = (u - 0.5) * 0.92;
      const rawTan = Math.tan(Math.PI * w) * 0.5;
      const maxTan = Math.tanh(Math.tan(Math.PI * 0.46) * 0.5);
      return Math.tanh(rawTan) / (maxTan || 1);
    }
    case 'triangle': {
      // Continuous linear triangle wave with arpeggio slopes
      return Math.asin(Math.sin(angle)) * (2 / Math.PI);
    }
    case 'square': {
      // Smooth rounded square wave with alternating high/low pitch plates
      return Math.tanh(3.5 * Math.sin(angle));
    }
    case 'sawtooth': {
      // Ramped bandlimited saw wave
      return Math.atan(2.5 * Math.tan(angle * 0.5)) * (2 / Math.PI);
    }
    case 'arch': {
      // Melodic arch / rainbow parabola across phrase or periods
      return periods <= 1.2 ? Math.sin(Math.PI * s) : Math.sin(Math.PI * u);
    }
    case 'sine':
    default:
      return Math.sin(angle);
  }
}

/**
 * Generates an exact, smooth mathematical cubic Bézier spline (sine, tangent, triangle, square, saw, arch)
 * between two baseline endpoints.
 *
 * For a baseline from pStart to pEnd:
 * - Along baseline axis: progression from 0 to 1
 * - Perpendicular axis: displacement A * evaluateWaveShape(shape, s, periods, phase)
 *
 * When amplitude is 0, produces an exact straight line.
 */
export function generateWaveSpline(
  pStart: Point2D,
  pEnd: Point2D,
  amplitude: number,
  periods: number,
  shapeType: WaveShapeType = 'sine',
  phase: number = 0
): SplinePath {
  const dx = pEnd.x - pStart.x;
  const dy = pEnd.y - pStart.y;
  const dist = Math.hypot(dx, dy);

  // If endpoints are nearly identical, create a default horizontal span
  const effectiveDx = dist < 5 ? 200 : dx;
  const effectiveDy = dist < 5 ? 0 : dy;
  const effectiveDist = dist < 5 ? 200 : dist;

  // Normalized direction along baseline
  const ux = effectiveDx / effectiveDist;
  const uy = effectiveDy / effectiveDist;

  // Normal vector: for primarily horizontal strokes, enforce purely vertical displacement
  // so the wave modulates musical pitch (the Y-axis) directly.
  let nx = -uy;
  let ny = ux;
  if (Math.abs(ux) >= 0.6) {
    nx = 0;
    ny = 1;
  }

  // If amplitude is 0, return an exact straight line
  if (Math.abs(amplitude) < 0.5) {
    return {
      segments: [
        {
          p0: { x: pStart.x, y: pStart.y },
          p1: { x: pStart.x + effectiveDx * (1 / 3), y: pStart.y + effectiveDy * (1 / 3) },
          p2: { x: pStart.x + effectiveDx * (2 / 3), y: pStart.y + effectiveDy * (2 / 3) },
          p3: { x: pStart.x + effectiveDx, y: pStart.y + effectiveDy },
        },
      ],
      isClosed: false,
    };
  }

  // Sample points along the wave curve (28 samples per cycle, minimum 42)
  const safePeriods = Math.max(0.5, Math.min(12, periods));
  const numSamples = Math.max(42, Math.round(28 * safePeriods));
  const rawPoints: Point2D[] = [];

  for (let i = 0; i <= numSamples; i++) {
    const s = i / numSamples;
    const wave = amplitude * evaluateWaveShape(shapeType, s, safePeriods, phase);

    const bx = pStart.x + s * effectiveDx;
    const by = pStart.y + s * effectiveDy;

    rawPoints.push({
      x: bx + wave * nx,
      y: by + wave * ny,
    });
  }

  const fitted = fitSplineFromPoints(rawPoints, -1);
  if (fitted && fitted.segments.length > 0) {
    // Ensure start and end snap exactly to baseline endpoints
    fitted.segments[0].p0 = { x: pStart.x, y: pStart.y };
    const lastSeg = fitted.segments[fitted.segments.length - 1];
    lastSeg.p3 = { x: pStart.x + effectiveDx, y: pStart.y + effectiveDy };
    return fitted;
  }

  // Fallback single-segment Bézier
  return {
    segments: [
      {
        p0: { ...pStart },
        p1: { x: pStart.x + effectiveDx * 0.33, y: pStart.y + amplitude * ny },
        p2: { x: pStart.x + effectiveDx * 0.66, y: pStart.y - amplitude * ny },
        p3: { x: pStart.x + effectiveDx, y: pStart.y + effectiveDy },
      },
    ],
    isClosed: false,
  };
}

/**
 * Backward compatibility alias for generating sinusoidal splines.
 */
export function generateSineSpline(
  pStart: Point2D,
  pEnd: Point2D,
  amplitude: number,
  periods: number,
  phase: number = 0
): SplinePath {
  return generateWaveSpline(pStart, pEnd, amplitude, periods, 'sine', phase);
}
