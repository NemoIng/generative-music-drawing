import { describe, it, expect } from 'vitest';
import {
  buildArcLengthLUT,
  integrateSegmentArcLength,
} from '../src/math/arcLengthTable';
import { evaluateAtDistance } from '../src/math/arcLengthInverter';
import { CubicBezierSegment, SplinePath } from '../src/math/types';

describe('Bézier Curve and Arc-Length Parameterization', () => {
  it('correctly calculates arc-length for a straight linear segment', () => {
    // Horizontal straight line segment of length 200
    const seg: CubicBezierSegment = {
      p0: { x: 0, y: 100 },
      p1: { x: 66.6667, y: 100 },
      p2: { x: 133.3333, y: 100 },
      p3: { x: 200, y: 100 },
    };

    const length = integrateSegmentArcLength(seg, 1.0, 32);
    expect(length).toBeCloseTo(200, 2);

    const halfLength = integrateSegmentArcLength(seg, 0.5, 32);
    expect(halfLength).toBeCloseTo(100, 2);
  });

  it('builds a strictly monotonically increasing LUT', () => {
    // S-curve segment
    const seg: CubicBezierSegment = {
      p0: { x: 0, y: 0 },
      p1: { x: 0, y: 150 },
      p2: { x: 200, y: 50 },
      p3: { x: 200, y: 200 },
    };

    const path: SplinePath = {
      segments: [seg],
      isClosed: false,
    };

    const lut = buildArcLengthLUT(path, 64);
    expect(lut.totalLength).toBeGreaterThan(200);
    expect(lut.sValues[0]).toBe(0);
    expect(lut.sValues[lut.sValues.length - 1]).toBeCloseTo(lut.totalLength, 6);

    // Verify strict monotonicity
    for (let i = 1; i < lut.sValues.length; i++) {
      expect(lut.sValues[i]).toBeGreaterThan(lut.sValues[i - 1]);
    }
  });

  it('accurately inverts arc-length distance to (x, y) with Newton-Raphson refinement', () => {
    const seg: CubicBezierSegment = {
      p0: { x: 50, y: 50 },
      p1: { x: 100, y: 200 },
      p2: { x: 300, y: 200 },
      p3: { x: 350, y: 50 },
    };

    const path: SplinePath = {
      segments: [seg],
      isClosed: false,
    };

    const lut = buildArcLengthLUT(path, 64);
    const L = lut.totalLength;

    // Test quarter, half, three-quarters distance
    const testDistances = [0, L * 0.25, L * 0.5, L * 0.75, L];

    for (const targetS of testDistances) {
      const evalResult = evaluateAtDistance(path, lut, targetS, {
        useNewtonRaphson: true,
        newtonIterations: 2,
      });

      // Verify that segment arc length up to t matches targetS
      const computedS = integrateSegmentArcLength(seg, evalResult.t, 32);
      expect(computedS).toBeCloseTo(targetS, 1);
    }
  });

  it('handles closed loop phase wrapping', () => {
    // Simple square-like closed path with 4 segments
    const path: SplinePath = {
      segments: [
        { p0: { x: 0, y: 0 }, p1: { x: 50, y: 0 }, p2: { x: 50, y: 0 }, p3: { x: 100, y: 0 } },
        { p0: { x: 100, y: 0 }, p1: { x: 100, y: 50 }, p2: { x: 100, y: 50 }, p3: { x: 100, y: 100 } },
        { p0: { x: 100, y: 100 }, p1: { x: 50, y: 100 }, p2: { x: 50, y: 100 }, p3: { x: 0, y: 100 } },
        { p0: { x: 0, y: 100 }, p1: { x: 0, y: 50 }, p2: { x: 0, y: 50 }, p3: { x: 0, y: 0 } },
      ],
      isClosed: true,
    };

    const lut = buildArcLengthLUT(path, 32);
    const L = lut.totalLength;
    expect(L).toBeCloseTo(400, 1);

    // Position at s = 0 and s = L should yield start point (0, 0)
    const at0 = evaluateAtDistance(path, lut, 0);
    const atL = evaluateAtDistance(path, lut, L);
    const atWrapped = evaluateAtDistance(path, lut, L * 3.25); // should equal L * 0.25
    const atQuarter = evaluateAtDistance(path, lut, L * 0.25);

    expect(at0.point.x).toBeCloseTo(0, 1);
    expect(at0.point.y).toBeCloseTo(0, 1);
    expect(atL.point.x).toBeCloseTo(0, 1);
    expect(atL.point.y).toBeCloseTo(0, 1);

    expect(atWrapped.point.x).toBeCloseTo(atQuarter.point.x, 1);
    expect(atWrapped.point.y).toBeCloseTo(atQuarter.point.y, 1);
  });
});
