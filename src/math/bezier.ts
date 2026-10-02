import { Point2D, CubicBezierSegment } from './types';

/**
 * Evaluates cubic Bezier curve at parameter t in [0, 1].
 * B(t) = (1 - t)^3 P0 + 3(1 - t)^2 t P1 + 3(1 - t) t^2 P2 + t^3 P3
 */
export function evaluateBezier(seg: CubicBezierSegment, t: number): Point2D {
  const oneMinusT = 1 - t;
  const mt2 = oneMinusT * oneMinusT;
  const mt3 = mt2 * oneMinusT;
  const t2 = t * t;
  const t3 = t2 * t;

  const c0 = mt3;
  const c1 = 3 * mt2 * t;
  const c2 = 3 * oneMinusT * t2;
  const c3 = t3;

  return {
    x: c0 * seg.p0.x + c1 * seg.p1.x + c2 * seg.p2.x + c3 * seg.p3.x,
    y: c0 * seg.p0.y + c1 * seg.p1.y + c2 * seg.p2.y + c3 * seg.p3.y,
  };
}

/**
 * Computes first derivative (velocity vector) B'(t).
 * B'(t) = 3(1 - t)^2 (P1 - P0) + 6(1 - t)t (P2 - P1) + 3t^2 (P3 - P2)
 */
export function evaluateBezierDerivative(seg: CubicBezierSegment, t: number): Point2D {
  const oneMinusT = 1 - t;
  const c0 = 3 * oneMinusT * oneMinusT;
  const c1 = 6 * oneMinusT * t;
  const c2 = 3 * t * t;

  const d10x = seg.p1.x - seg.p0.x;
  const d10y = seg.p1.y - seg.p0.y;
  const d21x = seg.p2.x - seg.p1.x;
  const d21y = seg.p2.y - seg.p1.y;
  const d32x = seg.p3.x - seg.p2.x;
  const d32y = seg.p3.y - seg.p2.y;

  return {
    x: c0 * d10x + c1 * d21x + c2 * d32x,
    y: c0 * d10y + c1 * d21y + c2 * d32y,
  };
}

/**
 * Computes second derivative (acceleration vector) B''(t).
 * B''(t) = 6(1 - t)(P2 - 2P1 + P0) + 6t(P3 - 2P2 + P1)
 */
export function evaluateBezierSecondDerivative(seg: CubicBezierSegment, t: number): Point2D {
  const oneMinusT = 1 - t;
  const c0 = 6 * oneMinusT;
  const c1 = 6 * t;

  const a0x = seg.p2.x - 2 * seg.p1.x + seg.p0.x;
  const a0y = seg.p2.y - 2 * seg.p1.y + seg.p0.y;
  const a1x = seg.p3.x - 2 * seg.p2.x + seg.p1.x;
  const a1y = seg.p3.y - 2 * seg.p2.y + seg.p1.y;

  return {
    x: c0 * a0x + c1 * a1x,
    y: c0 * a0y + c1 * a1y,
  };
}

/**
 * Computes the speed (physical magnitude of the first derivative) ||B'(t)||.
 */
export function evaluateBezierSpeed(seg: CubicBezierSegment, t: number): number {
  const d = evaluateBezierDerivative(seg, t);
  return Math.hypot(d.x, d.y);
}

/**
 * Computes curvature kappa(t) = |x' y'' - y' x''| / (x'^2 + y'^2)^(3/2).
 * Returns 0 if speed is negligible.
 */
export function evaluateBezierCurvature(seg: CubicBezierSegment, t: number): number {
  const d1 = evaluateBezierDerivative(seg, t);
  const d2 = evaluateBezierSecondDerivative(seg, t);

  const speedSq = d1.x * d1.x + d1.y * d1.y;
  if (speedSq < 1e-10) return 0;

  const numerator = Math.abs(d1.x * d2.y - d1.y * d2.x);
  const denominator = Math.pow(speedSq, 1.5);
  return numerator / denominator;
}
