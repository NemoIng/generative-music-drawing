import { Point2D, SplinePath } from './types';
import { fitSplineFromPoints } from './curveFit';

export interface WaveParams {
  amplitude: number; // in pixels (e.g. 0 to 100)
  periods: number;   // number of full sine cycles (e.g. 0.5 to 8)
  phase?: number;    // phase offset in radians (default 0)
  baseP0: Point2D;
  baseP1: Point2D;
}

/**
 * Generates an exact, smooth sinusoidal cubic Bézier spline between two baseline endpoints.
 *
 * For a baseline from pStart to pEnd:
 * - Along baseline axis: progression from 0 to 1
 * - Perpendicular axis: sinusoidal displacement A * sin(2π * periods * s + phase)
 *
 * When amplitude is 0, produces an exact straight line.
 */
export function generateSineSpline(
  pStart: Point2D,
  pEnd: Point2D,
  amplitude: number,
  periods: number,
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

  // Sample points along the sine wave (24 samples per cycle, minimum 36)
  const safePeriods = Math.max(0.5, Math.min(12, periods));
  const numSamples = Math.max(36, Math.round(24 * safePeriods));
  const rawPoints: Point2D[] = [];

  for (let i = 0; i <= numSamples; i++) {
    const s = i / numSamples;
    const angle = 2 * Math.PI * safePeriods * s + phase;
    const wave = amplitude * Math.sin(angle);

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
