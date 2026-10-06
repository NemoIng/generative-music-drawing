import { describe, it, expect } from 'vitest';
import { TEMPLATES, buildTemplateStrokes } from '../src/audio/templates';
import { ScaleQuantizer } from '../src/audio/scaleQuantizer';
import { buildArcLengthLUT } from '../src/math/arcLengthTable';

describe('Starter Musical Groove Templates', () => {
  const quantizer = new ScaleQuantizer();
  const width = 1200;
  const height = 800;

  it('provides valid starter templates', () => {
    expect(TEMPLATES.ambientDawn).toBeDefined();
    expect(TEMPLATES.minimalGroove).toBeDefined();
    expect(TEMPLATES.zenMeditation).toBeDefined();
  });

  it('builds valid splines with positive arc length for Ambient Dawn', () => {
    const strokes = buildTemplateStrokes('ambientDawn', width, height, quantizer);
    expect(strokes.length).toBe(4);

    for (const stroke of strokes) {
      expect(stroke.path.segments.length).toBeGreaterThan(0);
      const lut = buildArcLengthLUT(stroke.path, 32);
      expect(lut.totalLength).toBeGreaterThan(100);
      expect(['indigo', 'amber', 'spruce', 'violet']).toContain(stroke.instrumentId);
      expect(typeof stroke.reverb).toBe('number');
      expect(stroke.reverb).toBeGreaterThanOrEqual(0);
      expect(stroke.reverb).toBeLessThanOrEqual(1);
    }
  });

  it('builds valid splines for Minimal Groove', () => {
    const strokes = buildTemplateStrokes('minimalGroove', width, height, quantizer);
    expect(strokes.length).toBe(4);

    for (const stroke of strokes) {
      const lut = buildArcLengthLUT(stroke.path, 32);
      expect(lut.totalLength).toBeGreaterThan(100);
      expect(typeof stroke.reverb).toBe('number');
    }
  });

  it('ensures all 7 templates generate stroke points within visible screen height bounds [0, height]', () => {
    const allTemplateIds = Object.keys(TEMPLATES);
    expect(allTemplateIds.length).toBe(7);

    for (const id of allTemplateIds) {
      const strokes = buildTemplateStrokes(id, width, height, quantizer);
      expect(strokes.length).toBeGreaterThan(0);

      for (const stroke of strokes) {
        for (const seg of stroke.path.segments) {
          // Points should start comfortably within visible screen bounds (not subterranean D0 world coordinates)
          expect(seg.p0.y).toBeGreaterThanOrEqual(0);
          expect(seg.p0.y).toBeLessThanOrEqual(height);
          expect(seg.p3.y).toBeGreaterThanOrEqual(0);
          expect(seg.p3.y).toBeLessThanOrEqual(height);

          // Horizontal margins: lines must remain comfortably inside canvas and not fall off the right side
          expect(seg.p0.x).toBeGreaterThanOrEqual(width * 0.05);
          expect(seg.p0.x).toBeLessThanOrEqual(width * 0.88);
          expect(seg.p3.x).toBeGreaterThanOrEqual(width * 0.05);
          expect(seg.p3.x).toBeLessThanOrEqual(width * 0.88);
        }
      }
    }
  });
});

