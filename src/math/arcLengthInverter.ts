import { SplinePath, ArcLengthLUT, CurveEvaluation } from './types';
import {
  evaluateBezier,
  evaluateBezierDerivative,
  evaluateBezierSpeed,
  evaluateBezierCurvature,
} from './bezier';
import { integrateSegmentArcLength } from './arcLengthTable';

export interface InversionOptions {
  useNewtonRaphson?: boolean;
  newtonIterations?: number;
}

/**
 * Maps a given arc-length distance s* into a continuous position (x, y)
 * along the spline path using binary search, linear interpolation, and
 * Newton-Raphson refinement.
 */
export function evaluateAtDistance(
  path: SplinePath,
  lut: ArcLengthLUT,
  targetS: number,
  options: InversionOptions = {}
): CurveEvaluation {
  const { useNewtonRaphson = true, newtonIterations = 1 } = options;
  const L = lut.totalLength;

  if (L <= 1e-9 || path.segments.length === 0) {
    const fallbackPoint = path.segments[0]?.p0 ?? { x: 0, y: 0 };
    return {
      point: fallbackPoint,
      tangent: { x: 1, y: 0 },
      speed: 0,
      curvature: 0,
      segmentIndex: 0,
      t: 0,
      s: 0,
    };
  }

  // 1. Phase Wrapping / Clamping
  let sStar = targetS;
  if (lut.isClosed) {
    sStar = ((sStar % L) + L) % L;
  } else {
    // Open path: clamp to bounds [0, L]
    sStar = Math.max(0, Math.min(L, sStar));
  }

  const sArr = lut.sValues;
  const numSamples = sArr.length;

  // 2. Binary Search: Find index j such that S[j] <= sStar < S[j + 1]
  let low = 0;
  let high = numSamples - 1;
  let j = 0;

  // Edge check for the end of the curve
  if (sStar >= sArr[numSamples - 1]) {
    j = numSamples - 2;
  } else {
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (sArr[mid] <= sStar) {
        j = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
  }

  // Ensure j is within valid bounds
  j = Math.max(0, Math.min(numSamples - 2, j));

  const s_j = sArr[j];
  const s_next = sArr[j + 1];
  const deltaS = s_next - s_j;

  // 3. Normalized Fraction
  const alpha = deltaS > 1e-12 ? (sStar - s_j) / deltaS : 0;

  // 4. Parameter Interpolation
  const k_curr = lut.segmentIndices[j];
  const k_next = lut.segmentIndices[j + 1];
  const isBoundary = k_curr !== k_next;
  const k = isBoundary ? k_next : k_curr;
  const t_start = isBoundary ? 0.0 : lut.tValues[j];
  const t_end = lut.tValues[j + 1];
  let tStar = t_start + alpha * (t_end - t_start);
  tStar = Math.max(0, Math.min(1, tStar));

  const seg = path.segments[k];
  const segStartS = lut.segmentStartS[k];
  const targetSegArcLength = sStar - segStartS;

  // 5. Newton-Raphson Refinement
  if (useNewtonRaphson && seg) {
    for (let iter = 0; iter < newtonIterations; iter++) {
      const currentSegS = integrateSegmentArcLength(seg, tStar, 12);
      const f = currentSegS - targetSegArcLength;
      const speed = evaluateBezierSpeed(seg, tStar);

      if (speed > 1e-6) {
        const step = f / speed;
        tStar = Math.max(0, Math.min(1, tStar - step));
        if (Math.abs(step) < 1e-6) break;
      } else {
        break;
      }
    }
  }

  // 6. Coordinate Retrieval
  const point = evaluateBezier(seg, tStar);
  const deriv = evaluateBezierDerivative(seg, tStar);
  const speed = Math.hypot(deriv.x, deriv.y);
  const tangent = speed > 1e-9 ? { x: deriv.x / speed, y: deriv.y / speed } : { x: 1, y: 0 };
  const curvature = evaluateBezierCurvature(seg, tStar);

  return {
    point,
    tangent,
    speed,
    curvature,
    segmentIndex: k,
    t: tStar,
    s: sStar,
  };
}
