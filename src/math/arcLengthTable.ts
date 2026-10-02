import { CubicBezierSegment, SplinePath, ArcLengthLUT } from './types';
import { evaluateBezierSpeed } from './bezier';

/**
 * Computes the arc length of a single Bezier segment from t=0 to t=tTarget
 * using adaptive/composite Simpson's 1/3 rule.
 */
export function integrateSegmentArcLength(
  seg: CubicBezierSegment,
  tTarget: number,
  steps: number = 16
): number {
  if (tTarget <= 0) return 0;
  if (tTarget > 1) tTarget = 1;

  const dt = tTarget / steps;
  let sum = 0;

  for (let i = 0; i < steps; i++) {
    const t0 = i * dt;
    const t1 = (i + 1) * dt;
    const tMid = (t0 + t1) * 0.5;

    const v0 = evaluateBezierSpeed(seg, t0);
    const vMid = evaluateBezierSpeed(seg, tMid);
    const v1 = evaluateBezierSpeed(seg, t1);

    sum += (dt / 6) * (v0 + 4 * vMid + v1);
  }

  return sum;
}

/**
 * Builds an arc-length parameterization lookup table for a multi-segment spline path.
 *
 * @param path The spline path containing M cubic Bezier segments
 * @param subdivisionsPerSegment Number of sub-intervals per segment (default 64)
 */
export function buildArcLengthLUT(
  path: SplinePath,
  subdivisionsPerSegment: number = 64
): ArcLengthLUT {
  const M = path.segments.length;
  if (M === 0) {
    return {
      totalLength: 0,
      isClosed: path.isClosed,
      sValues: new Float64Array(1),
      segmentIndices: new Int32Array(1),
      tValues: new Float64Array(1),
      segmentLengths: new Float64Array(0),
      segmentStartS: new Float64Array(0),
      subdivisions: subdivisionsPerSegment,
    };
  }

  const N = subdivisionsPerSegment;
  // Total sample points: each segment contributes N intervals, meaning M * N + 1 total points
  const totalSamples = M * N + 1;

  const sValues = new Float64Array(totalSamples);
  const segmentIndices = new Int32Array(totalSamples);
  const tValues = new Float64Array(totalSamples);
  const segmentLengths = new Float64Array(M);
  const segmentStartS = new Float64Array(M);

  let cumulativeDistance = 0;
  let sampleIndex = 0;

  sValues[0] = 0;
  segmentIndices[0] = 0;
  tValues[0] = 0;

  for (let k = 0; k < M; k++) {
    const seg = path.segments[k];
    segmentStartS[k] = cumulativeDistance;
    let segDistance = 0;

    const dt = 1.0 / N;

    for (let i = 1; i <= N; i++) {
      sampleIndex++;
      const tPrev = (i - 1) * dt;
      const tCurr = i * dt;
      const tMid = (tPrev + tCurr) * 0.5;

      const vPrev = evaluateBezierSpeed(seg, tPrev);
      const vMid = evaluateBezierSpeed(seg, tMid);
      const vCurr = evaluateBezierSpeed(seg, tCurr);

      // Composite Simpson's 1/3 quadrature
      const deltaS = (dt / 6) * (vPrev + 4 * vMid + vCurr);
      segDistance += deltaS;
      cumulativeDistance += deltaS;

      sValues[sampleIndex] = cumulativeDistance;
      segmentIndices[sampleIndex] = k;
      tValues[sampleIndex] = tCurr;
    }

    segmentLengths[k] = segDistance;
  }

  return {
    totalLength: cumulativeDistance,
    isClosed: path.isClosed,
    sValues,
    segmentIndices,
    tValues,
    segmentLengths,
    segmentStartS,
    subdivisions: N,
  };
}
