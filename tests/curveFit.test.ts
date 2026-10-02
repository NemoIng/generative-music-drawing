import { describe, it, expect } from 'vitest';
import { fitSplineFromPoints, decimatePoints } from '../src/math/curveFit';
import { Point2D } from '../src/math/types';

describe('Curve Fitting & Auto-closure', () => {
  it('decimates clustered points to avoid jitter', () => {
    const points: Point2D[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 }, // very close (< 10)
      { x: 2, y: 2 }, // very close (< 10)
      { x: 20, y: 20 },
      { x: 40, y: 40 },
    ];

    const decimated = decimatePoints(points, 10);
    expect(decimated.length).toBeLessThan(points.length);
    expect(decimated[0]).toEqual({ x: 0, y: 0 });
    expect(decimated[decimated.length - 1]).toEqual({ x: 40, y: 40 });
  });

  it('detects and closes loops when end point is near start point', () => {
    // Circle-like polygon points closing near start
    const points: Point2D[] = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 100, y: 200 },
      { x: 105, y: 102 }, // Close to start (100, 100) within 45px
    ];

    const spline = fitSplineFromPoints(points, 45);
    expect(spline).not.toBeNull();
    expect(spline?.isClosed).toBe(true);
    expect(spline?.segments.length).toBe(4);

    // End point of last segment should coincide with start point of first segment
    const firstSeg = spline!.segments[0];
    const lastSeg = spline!.segments[spline!.segments.length - 1];
    expect(lastSeg.p3.x).toBeCloseTo(firstSeg.p0.x, 3);
    expect(lastSeg.p3.y).toBeCloseTo(firstSeg.p0.y, 3);
  });

  it('creates open spline when end point is far from start point', () => {
    const points: Point2D[] = [
      { x: 100, y: 100 },
      { x: 200, y: 150 },
      { x: 300, y: 250 },
      { x: 450, y: 300 },
    ];

    const spline = fitSplineFromPoints(points, 45);
    expect(spline).not.toBeNull();
    expect(spline?.isClosed).toBe(false);
    expect(spline?.segments.length).toBe(3);
  });
});
