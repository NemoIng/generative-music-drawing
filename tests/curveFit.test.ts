import { describe, it, expect } from 'vitest';
import { fitSplineFromPoints, decimatePoints, smoothPoints } from '../src/math/curveFit';
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

  it('smooths raw point jitter while preserving start and end coordinates', () => {
    // Shaky hand trajectory along y = 100 with tremors
    const jittery: Point2D[] = [
      { x: 0, y: 100 },
      { x: 20, y: 120 }, // jitter peak
      { x: 40, y: 80 },  // jitter trough
      { x: 60, y: 115 }, // jitter peak
      { x: 80, y: 90 },  // jitter trough
      { x: 100, y: 100 },
    ];

    const smoothed = smoothPoints(jittery, 3, 0.45);
    expect(smoothed.length).toBe(jittery.length);
    // Endpoints must remain exact
    expect(smoothed[0]).toEqual({ x: 0, y: 100 });
    expect(smoothed[smoothed.length - 1]).toEqual({ x: 100, y: 100 });

    // Interior jitter deviations should be dampened towards average (100)
    expect(Math.abs(smoothed[1].y - 100)).toBeLessThan(Math.abs(jittery[1].y - 100));
    expect(Math.abs(smoothed[2].y - 100)).toBeLessThan(Math.abs(jittery[2].y - 100));
  });

  it('fits smooth spline when auto-smoothing is enabled', () => {
    const points: Point2D[] = [
      { x: 0, y: 100 },
      { x: 30, y: 130 },
      { x: 60, y: 90 },
      { x: 90, y: 120 },
      { x: 120, y: 100 },
      { x: 150, y: 100 },
    ];

    const smoothSpline = fitSplineFromPoints(points, 45, true);
    expect(smoothSpline).not.toBeNull();
    expect(smoothSpline?.segments.length).toBeGreaterThan(0);
    // Start of first segment and end of last segment match start and end of path
    expect(smoothSpline?.segments[0].p0.x).toBeCloseTo(0, 1);
    expect(smoothSpline?.segments[0].p0.y).toBeCloseTo(100, 1);
  });

  it('aggressively suppresses high-frequency hand tremors with smoothSpline', () => {
    // Generate a horizontal gesture with rapid hand tremor noise (y oscillates around 200)
    const raw: Point2D[] = [];
    for (let x = 0; x <= 300; x += 4) {
      // 4px spacing like realistic high-rate pointer events
      // Tremor amplitude ±15px with fast wavelength (16px)
      const tremor = Math.sin((x / 16) * 2 * Math.PI) * 15;
      raw.push({ x, y: 200 + tremor });
    }

    const unsmoothed = fitSplineFromPoints(raw, 45, false);
    const smoothed = fitSplineFromPoints(raw, 45, true);

    expect(unsmoothed).not.toBeNull();
    expect(smoothed).not.toBeNull();

    // Smoothed spline should have fewer, cleaner segments due to decimation
    expect(smoothed!.segments.length).toBeLessThan(unsmoothed!.segments.length);

    // Endpoints must match raw points exactly
    expect(smoothed!.segments[0].p0.x).toBeCloseTo(raw[0].x, 1);
    expect(smoothed!.segments[0].p0.y).toBeCloseTo(raw[0].y, 1);
    const lastSeg = smoothed!.segments[smoothed!.segments.length - 1];
    expect(lastSeg.p3.x).toBeCloseTo(raw[raw.length - 1].x, 1);
    expect(lastSeg.p3.y).toBeCloseTo(raw[raw.length - 1].y, 1);

    // Measure maximum deviation from baseline (y = 200) across interior control points
    const interiorPoints = smoothed!.segments.slice(1, -1).map((seg) => seg.p0.y);
    const maxSmoothedDev = Math.max(...interiorPoints.map((y) => Math.abs(y - 200)));
    // Raw tremor amplitude was 15; aggressive smoothing should reduce interior tremor to < 4px (over 70% reduction)
    expect(maxSmoothedDev).toBeLessThan(4);
  });
});
