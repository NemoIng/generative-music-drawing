import { describe, it, expect } from 'vitest';
import { TEMPLATES, buildTemplateStrokes } from '../src/audio/templates';
import { StrokeManager } from '../src/engine/strokeManager';
import { ScaleQuantizer } from '../src/audio/scaleQuantizer';
import { buildArcLengthLUT } from '../src/math/arcLengthTable';

describe('Starter Musical Groove Templates', () => {
  const quantizer = new ScaleQuantizer();
  const width = 1200;
  const height = 800;

  it('provides valid starter templates', () => {
    expect(TEMPLATES.deepCosmicDrone).toBeDefined();
    expect(TEMPLATES.cathedralSolitude).toBeDefined();
    expect(TEMPLATES.warmTapeDrift).toBeDefined();
    expect(TEMPLATES.zenGarden).toBeDefined();
    expect(TEMPLATES.midnightPulse).toBeDefined();
  });

  it('builds valid splines with positive arc length for Deep Cosmic Drone', () => {
    const strokes = buildTemplateStrokes('deepCosmicDrone', width, height, quantizer);
    expect(strokes.length).toBe(4);

    for (const stroke of strokes) {
      expect(stroke.path.segments.length).toBeGreaterThan(0);
      const lut = buildArcLengthLUT(stroke.path, 32);
      expect(lut.totalLength).toBeGreaterThan(100);
      expect(['slate', 'indigo', 'spruce', 'amber']).toContain(stroke.instrumentId);
      expect(typeof stroke.reverb).toBe('number');
      expect(stroke.reverb).toBeGreaterThanOrEqual(0);
      expect(stroke.reverb).toBeLessThanOrEqual(1);
    }
  });

  it('builds valid splines for Midnight Pulse including 808 drum strokes', () => {
    const strokes = buildTemplateStrokes('midnightPulse', width, height, quantizer);
    expect(strokes.length).toBe(5);

    const onyxStrokes = strokes.filter((s) => s.instrumentId === 'onyx');
    expect(onyxStrokes.length).toBe(2);

    for (const stroke of strokes) {
      const lut = buildArcLengthLUT(stroke.path, 32);
      expect(lut.totalLength).toBeGreaterThan(100);
      expect(typeof stroke.reverb).toBe('number');
    }
  });

  it('ensures all 5 templates generate stroke points within visible screen height bounds [0, height]', () => {
    const allTemplateIds = Object.keys(TEMPLATES);
    expect(allTemplateIds.length).toBe(5);

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

  it('randomizes playhead positions across strokes when applied to a template', () => {
    const sm = new StrokeManager();
    const strokes = buildTemplateStrokes('deepCosmicDrone', width, height, quantizer);
    for (const s of strokes) {
      sm.addStroke(s.path, s.style, s.instrumentId, 140, quantizer, height);
    }

    sm.randomizeAllPlayheads(quantizer, height);

    // Playheads should be distributed across strokes, not all clustered at distance 0
    const distances = sm.activeStrokes.map((s) => s.playhead.currentDistance);
    const nonZeroCount = distances.filter((d) => d > 0).length;
    expect(nonZeroCount).toBe(sm.activeStrokes.length);
    for (const stroke of sm.activeStrokes) {
      expect(stroke.playhead.lastEval).toBeDefined();
      expect(stroke.playhead.lastEval?.point.x).toBeGreaterThan(0);
    }
  });
});

