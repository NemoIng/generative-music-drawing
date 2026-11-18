import { describe, it, expect } from 'vitest';
import { StrokeManager } from '../src/engine/strokeManager';
import { ScaleQuantizer } from '../src/audio/scaleQuantizer';
import { SCALES, ROOT_NOTES } from '../src/audio/scales';
import { SplinePath } from '../src/math/types';
import { generateAssistedStrokes, AssistedLineCount } from '../src/engine/assistedDrawing';

describe('Assisted Drawing Generator & Batch Undo/Redo', () => {
  const makeCurvePath = (y: number): SplinePath => ({
    segments: [
      {
        p0: { x: 100, y },
        p1: { x: 220, y: y - 40 },
        p2: { x: 360, y: y + 30 },
        p3: { x: 500, y: y - 20 },
      },
    ],
    isClosed: false,
  });

  const makeDotPath = (x: number, y: number): SplinePath => ({
    segments: [
      {
        p0: { x, y },
        p1: { x: x + 0.1, y },
        p2: { x: x + 0.2, y },
        p3: { x: x + 0.3, y },
      },
    ],
    isClosed: false,
  });

  it('generates count - 1 companions for counts 2, 3, 4, 5 while preserving instrument and style', () => {
    const quantizer = new ScaleQuantizer({ scale: SCALES.dorian, root: ROOT_NOTES.D3, octaveSpan: 4 });
    const canvasH = 800;
    const canvasW = 1200;
    const counts: AssistedLineCount[] = [2, 3, 4, 5];

    for (const totalLines of counts) {
      const sm = new StrokeManager();
      const primary = sm.addStroke(makeCurvePath(450), 'dotted', 'rose', 120, quantizer, canvasH);
      const companions = generateAssistedStrokes(primary, totalLines, quantizer, canvasH, canvasW);

      expect(companions).toHaveLength(totalLines - 1);
      for (const spec of companions) {
        expect(spec.instrumentId).toBe('rose');
        expect(spec.style).toBe('dotted');
        expect(spec.isPoint).toBe(false);
        expect(spec.path.segments).toHaveLength(primary.path.segments.length);
        for (const seg of spec.path.segments) {
          for (const pt of [seg.p0, seg.p1, seg.p2, seg.p3]) {
            expect(Number.isFinite(pt.x)).toBe(true);
            expect(Number.isFinite(pt.y)).toBe(true);
            expect(pt.x).toBeGreaterThanOrEqual(12);
            expect(pt.x).toBeLessThanOrEqual(canvasW - 12);
            expect(pt.y).toBeGreaterThanOrEqual(0);
            expect(pt.y).toBeLessThanOrEqual(canvasH);
          }
        }
      }
    }
  });

  it('places diatonic fifth, octave foundation, and contrary-motion third companions in scale', () => {
    const quantizer = new ScaleQuantizer({ scale: SCALES.major, root: ROOT_NOTES.D3, octaveSpan: 4 });
    const canvasH = 800;
    const sm = new StrokeManager();

    // Flat line tuned near ~350 Hz (middle register)
    const uMid = ScaleQuantizer.frequencyToNormalizedU(350);
    const midY = quantizer.normalizedUToCanvasY(uMid, canvasH);
    const primaryPitch = quantizer.quantizeDiscrete(midY, canvasH);

    const primary = sm.addStroke(
      {
        segments: [{ p0: { x: 100, y: midY }, p1: { x: 200, y: midY }, p2: { x: 300, y: midY }, p3: { x: 400, y: midY } }],
        isClosed: false,
      },
      'dotted',
      'indigo',
      120,
      quantizer,
      canvasH
    );

    const companions = generateAssistedStrokes(primary, 4, quantizer, canvasH, 1200);
    expect(companions).toHaveLength(3);

    const comp1Pitch = quantizer.quantizeDiscrete(companions[0].path.segments[0].p0.y, canvasH);
    const comp2Pitch = quantizer.quantizeDiscrete(companions[1].path.segments[0].p0.y, canvasH);
    const comp3Pitch = quantizer.quantizeDiscrete(companions[2].path.segments[0].p0.y, canvasH);

    // Companion 1 is a diatonic fifth (+4 steps in 7-note scale)
    expect(comp1Pitch.scaleDegree - primaryPitch.scaleDegree).toBe(4);
    // Companion 2 is an octave anchor (-7 steps below when >= 260 Hz)
    expect(comp2Pitch.scaleDegree - primaryPitch.scaleDegree).toBe(-7);
    // Companion 3 is a diatonic third (+2 steps)
    expect(comp3Pitch.scaleDegree - primaryPitch.scaleDegree).toBe(2);

    // Verify contrary motion on curved contour for companion 3 (4th line overall)
    const curvedPrimary = sm.addStroke(makeCurvePath(midY), 'solid', 'indigo', 120, quantizer, canvasH);
    const curvedCompanions = generateAssistedStrokes(curvedPrimary, 4, quantizer, canvasH, 1200);
    const p0PrimaryY = curvedPrimary.path.segments[0].p0.y;
    const p1PrimaryY = curvedPrimary.path.segments[0].p1.y; // moves UP on canvas (lower Y)
    const p0Comp3Y = curvedCompanions[2].path.segments[0].p0.y;
    const p1Comp3Y = curvedCompanions[2].path.segments[0].p1.y; // should move DOWN (higher Y) in contrary motion
    expect(p1PrimaryY).toBeLessThan(p0PrimaryY);
    expect(p1Comp3Y).toBeGreaterThan(p0Comp3Y);
  });

  it('works cleanly when scroll mode is enabled in world coordinates', () => {
    const quantizer = new ScaleQuantizer({ scale: SCALES.dorian, root: ROOT_NOTES.D3, octaveSpan: 4 });
    quantizer.setScrollEnabled(true);
    const viewportH = 700;
    const worldH = quantizer.getWorldHeight(viewportH);
    const midWorldY = worldH * 0.5;

    const sm = new StrokeManager();
    const primary = sm.addStroke(makeCurvePath(midWorldY), 'solid', 'spruce', 120, quantizer, viewportH);
    const companions = generateAssistedStrokes(primary, 3, quantizer, viewportH, 1200);

    expect(companions).toHaveLength(2);
    for (const spec of companions) {
      const y = spec.path.segments[0].p0.y;
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(worldH);
    }
  });

  it('preserves stationary dot micro-segments when primary stroke is a dot', () => {
    const quantizer = new ScaleQuantizer({ scale: SCALES.minorPentatonic, root: ROOT_NOTES.D3, octaveSpan: 4 });
    const canvasH = 700;
    const sm = new StrokeManager();
    const primary = sm.addStroke(makeDotPath(300, 420), 'dotted', 'violet', 120, quantizer, canvasH, 1.0, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, true);

    const companions = generateAssistedStrokes(primary, 5, quantizer, canvasH, 1200);
    expect(companions).toHaveLength(4);
    companions.forEach((spec) => {
      expect(spec.isPoint).toBe(true);
      const seg = spec.path.segments[0];
      expect(seg.p1.x - seg.p0.x).toBeCloseTo(0.1, 4);
      expect(seg.p2.x - seg.p0.x).toBeCloseTo(0.2, 4);
      expect(seg.p3.x - seg.p0.x).toBeCloseTo(0.3, 4);
      expect(seg.p1.y).toBe(seg.p0.y);
    });
  });

  it('places Onyx 808 companions into complementary drum zones', () => {
    const quantizer = new ScaleQuantizer({ scale: SCALES.dorian, root: ROOT_NOTES.D3, octaveSpan: 4 });
    const canvasH = 800;

    // Draw in Kick zone (< 260 Hz)
    const kickY = quantizer.normalizedUToCanvasY(ScaleQuantizer.frequencyToNormalizedU(175), canvasH);
    const sm = new StrokeManager();
    const primary = sm.addStroke(
      {
        segments: [{ p0: { x: 120, y: kickY }, p1: { x: 220, y: kickY }, p2: { x: 320, y: kickY }, p3: { x: 420, y: kickY } }],
        isClosed: false,
      },
      'dotted',
      'onyx',
      120,
      quantizer,
      canvasH
    );

    const companions = generateAssistedStrokes(primary, 4, quantizer, canvasH, 1200);
    expect(companions).toHaveLength(3);
    companions.forEach((c) => expect(c.instrumentId).toBe('onyx'));

    const freqs = companions.map((c) => quantizer.quantizeDiscrete(c.path.segments[0].p0.y, canvasH).frequency);
    // Priority for Kick: Hi-Hat (>=2200), Snare (260-650), Tom (650-2200)
    expect(freqs[0]).toBeGreaterThanOrEqual(2200);
    expect(freqs[1]).toBeGreaterThanOrEqual(260);
    expect(freqs[1]).toBeLessThan(650);
    expect(freqs[2]).toBeGreaterThanOrEqual(650);
    expect(freqs[2]).toBeLessThan(2200);
  });

  it('supports atomic single-step batchAdd Undo and Redo in StrokeManager', () => {
    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer({ scale: SCALES.dorian, root: ROOT_NOTES.D3, octaveSpan: 4 });
    const canvasH = 800;

    const primary = sm.addStroke(makeCurvePath(420), 'solid', 'amber', 120, quantizer, canvasH, 0.58, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, false);
    const specs = generateAssistedStrokes(primary, 3, quantizer, canvasH, 1200);
    const companions = specs.map((spec) =>
      sm.addStroke(spec.path, spec.style, spec.instrumentId, 120, quantizer, canvasH, 0.5, undefined, spec.traversal, undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, spec.isPoint ?? false)
    );

    sm.recordBatchAddUndo([primary, ...companions]);
    expect(sm.activeStrokes).toHaveLength(3);
    expect(sm.canUndo).toBe(true);

    // One undo removes all 3 strokes simultaneously
    sm.undo();
    expect(sm.activeStrokes).toHaveLength(0);
    expect(sm.canRedo).toBe(true);

    // One redo restores all 3 strokes simultaneously
    sm.redo();
    expect(sm.activeStrokes).toHaveLength(3);
  });

  it('staggers initial playhead phase ratios and spreads companion lines horizontally without starting at distance 0', () => {
    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer({ scale: SCALES.dorian, root: ROOT_NOTES.D3, octaveSpan: 4 });
    const canvasH = 800;

    const primary = sm.addStroke(makeCurvePath(400), 'dotted', 'indigo', 120, quantizer, canvasH, 0.5, undefined, 'bounce');
    const specs = generateAssistedStrokes(primary, 4, quantizer, canvasH, 1200);
    expect(specs).toHaveLength(3);

    // Phase ratios are evenly distributed (1/4, 2/4, 3/4)
    expect(specs.map((s) => s.initialPhaseRatio)).toEqual([0.25, 0.5, 0.75]);

    const companions = specs.map((spec) => {
      const comp = sm.addStroke(spec.path, spec.style, spec.instrumentId, 120, quantizer, canvasH, 0.4, undefined, spec.traversal);
      sm.setStrokePlayheadPhase(comp.id, spec.initialPhaseRatio, spec.initialDirection, quantizer, canvasH);
      return comp;
    });

    // Primary starts at distance 0, while each companion starts cleanly staggered along its curve
    expect(primary.playhead.currentDistance).toBe(0);
    expect(companions[0].playhead.currentDistance).toBeCloseTo(companions[0].lut.totalLength * 0.25, 1);
    expect(companions[1].playhead.currentDistance).toBeCloseTo(companions[1].lut.totalLength * 0.5, 1);
    expect(companions[2].playhead.currentDistance).toBeCloseTo(companions[2].lut.totalLength * 0.75, 1);

    // Meaningful rigid X separation from primary starting point
    expect(Math.abs(companions[0].path.segments[0].p0.x - primary.path.segments[0].p0.x)).toBeGreaterThanOrEqual(40);
    expect(Math.abs(companions[1].path.segments[0].p0.x - primary.path.segments[0].p0.x)).toBeGreaterThanOrEqual(40);
  });

  it('assigns complementary instruments when instrumentMode is mixed', () => {
    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer({ scale: SCALES.dorian, root: ROOT_NOTES.D3, octaveSpan: 4 });
    const primary = sm.addStroke(makeCurvePath(420), 'solid', 'indigo', 120, quantizer, 800);

    const specs = generateAssistedStrokes(primary, 5, quantizer, 800, 1200, { instrumentMode: 'mixed' });
    expect(specs).toHaveLength(4);
    expect(specs.map((s) => s.instrumentId)).toEqual(['rose', 'spruce', 'amber', 'violet']);
  });

  it('selects multiple strokes and adjusts tempo & volume for all selected lines at once with undo/redo', () => {
    const sm = new StrokeManager();
    const s1 = sm.addStroke(makeCurvePath(200), 'solid', 'indigo', 120);
    const s2 = sm.addStroke(makeCurvePath(320), 'dotted', 'rose', 120);
    const s3 = sm.addStroke(makeCurvePath(440), 'solid', 'spruce', 120);
    sm.setStrokeSpeed(s2.id, 1.5, false);

    sm.selectStrokes([s1.id, s2.id, s3.id]);
    expect(sm.selectedStrokeIds).toEqual([s1.id, s2.id, s3.id]);
    expect(sm.selectedStrokeId).toBeNull();

    // Adjust speed across all 3 selected lines (+0.2x)
    const updatedTiming = sm.adjustStrokesTiming(sm.selectedStrokeIds, 0.2, 10, true);
    expect(updatedTiming).toHaveLength(3);
    expect(s1.speedMultiplier).toBe(1.2);
    expect(s2.speedMultiplier).toBe(1.7);
    expect(s3.speedMultiplier).toBe(1.2);

    // Undo restores all 3 speeds atomically
    sm.undo();
    expect(s1.speedMultiplier).toBe(1.0);
    expect(s2.speedMultiplier).toBe(1.5);
    expect(s3.speedMultiplier).toBe(1.0);

    // Redo re-applies all 3 speeds atomically
    sm.redo();
    expect(s1.speedMultiplier).toBe(1.2);
    expect(s2.speedMultiplier).toBe(1.7);
    expect(s3.speedMultiplier).toBe(1.2);

    // Adjust volume across all 3 selected lines (-0.15)
    const updatedVol = sm.adjustStrokesVolume(sm.selectedStrokeIds, -0.15, true);
    expect(updatedVol).toHaveLength(3);
    expect(s1.volume).toBeCloseTo(0.85, 2);
    expect(s2.volume).toBeCloseTo(0.85, 2);
    sm.undo();
    expect(s1.volume).toBeCloseTo(1.0, 2);
    sm.redo();
    expect(s1.volume).toBeCloseTo(0.85, 2);
  });
});
