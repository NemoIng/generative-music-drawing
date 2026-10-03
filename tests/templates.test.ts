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
    expect(strokes.length).toBe(3);

    for (const stroke of strokes) {
      expect(stroke.path.segments.length).toBeGreaterThan(0);
      const lut = buildArcLengthLUT(stroke.path, 32);
      expect(lut.totalLength).toBeGreaterThan(100);
      expect(['indigo', 'amber', 'violet']).toContain(stroke.instrumentId);
    }
  });

  it('builds valid splines for Minimal Groove', () => {
    const strokes = buildTemplateStrokes('minimalGroove', width, height, quantizer);
    expect(strokes.length).toBe(3);

    for (const stroke of strokes) {
      const lut = buildArcLengthLUT(stroke.path, 32);
      expect(lut.totalLength).toBeGreaterThan(100);
    }
  });
});
