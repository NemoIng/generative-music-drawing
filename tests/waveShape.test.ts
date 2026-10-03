import { describe, it, expect } from 'vitest';
import { generateSineSpline, generateWaveSpline, WaveShapeType } from '../src/math/waveShape';
import { evaluateAtDistance } from '../src/math/arcLengthInverter';
import { buildArcLengthLUT } from '../src/math/arcLengthTable';

describe('Wave Shape Restructuring - Sine Spline Generator', () => {
  it('generates a straight line when amplitude is 0', () => {
    const pStart = { x: 100, y: 300 };
    const pEnd = { x: 500, y: 300 };
    const spline = generateSineSpline(pStart, pEnd, 0, 2);

    expect(spline.segments.length).toBe(1);
    expect(spline.segments[0].p0.x).toBe(100);
    expect(spline.segments[0].p0.y).toBe(300);
    expect(spline.segments[0].p3.x).toBe(500);
    expect(spline.segments[0].p3.y).toBe(300);
  });

  it('generates a smooth undulating sine wave with correct amplitude and endpoints', () => {
    const pStart = { x: 100, y: 300 };
    const pEnd = { x: 500, y: 300 };
    const amplitude = 40;
    const periods = 2;

    const spline = generateSineSpline(pStart, pEnd, amplitude, periods);
    expect(spline.segments.length).toBeGreaterThan(1);

    // Endpoints must match start and end
    expect(spline.segments[0].p0.x).toBeCloseTo(100, 1);
    expect(spline.segments[0].p0.y).toBeCloseTo(300, 1);

    const lastSeg = spline.segments[spline.segments.length - 1];
    expect(lastSeg.p3.x).toBeCloseTo(500, 1);
    expect(lastSeg.p3.y).toBeCloseTo(300, 1);

    // Build LUT and sample along the curve to verify sine oscillation
    const lut = buildArcLengthLUT(spline, 64);
    expect(lut.totalLength).toBeGreaterThan(400); // arc length > direct horizontal distance

    // Check that peak Y values oscillate around Y=300 by roughly ±amplitude
    let minY = Infinity;
    let maxY = -Infinity;

    for (let d = 0; d <= lut.totalLength; d += 10) {
      const ev = evaluateAtDistance(spline, lut, d);
      if (ev.point.y < minY) minY = ev.point.y;
      if (ev.point.y > maxY) maxY = ev.point.y;
    }

    // Minimum should be around 300 - 40 = 260, Maximum around 300 + 40 = 340
    expect(minY).toBeLessThan(275);
    expect(maxY).toBeGreaterThan(325);
  });

  it('handles vertical and arbitrary angled baselines', () => {
    const pStart = { x: 200, y: 100 };
    const pEnd = { x: 200, y: 500 };
    const spline = generateSineSpline(pStart, pEnd, 30, 1);

    expect(spline.segments[0].p0.x).toBeCloseTo(200, 1);
    expect(spline.segments[0].p0.y).toBeCloseTo(100, 1);

    const lastSeg = spline.segments[spline.segments.length - 1];
    expect(lastSeg.p3.x).toBeCloseTo(200, 1);
    expect(lastSeg.p3.y).toBeCloseTo(500, 1);
  });

  it('generates tangent, triangle, square, sawtooth, and arch wave shapes with exact endpoints', () => {
    const pStart = { x: 100, y: 250 };
    const pEnd = { x: 600, y: 250 };
    const shapes: WaveShapeType[] = ['tangent', 'triangle', 'square', 'sawtooth', 'arch'];

    for (const shape of shapes) {
      const spline = generateWaveSpline(pStart, pEnd, 35, 2, shape);
      expect(spline.segments.length).toBeGreaterThan(0);

      // Start must match pStart
      expect(spline.segments[0].p0.x).toBeCloseTo(100, 1);
      expect(spline.segments[0].p0.y).toBeCloseTo(250, 1);

      // End must match pEnd
      const lastSeg = spline.segments[spline.segments.length - 1];
      expect(lastSeg.p3.x).toBeCloseTo(600, 1);
      expect(lastSeg.p3.y).toBeCloseTo(250, 1);

      // Wave should oscillate and have arc length greater than flat distance (500)
      const lut = buildArcLengthLUT(spline, 64);
      expect(lut.totalLength).toBeGreaterThan(500);
    }
  });
});
