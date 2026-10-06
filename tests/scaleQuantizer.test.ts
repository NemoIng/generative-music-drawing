import { describe, it, expect } from 'vitest';
import { ScaleQuantizer } from '../src/audio/scaleQuantizer';
import { SCALES, ROOT_NOTES } from '../src/audio/scales';

describe('Coordinate-to-Pitch Scale Quantizer', () => {
  const canvasHeight = 600;

  it('inverts canvas Y coordinate: bottom is root, top is highest note', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
      octaveSpan: 4,
    });

    // Bottom of canvas (y = 600) -> u = 0 -> root note D2 (73.416 Hz)
    const bottomPitch = quantizer.quantizeDiscrete(600, canvasHeight);
    expect(bottomPitch.frequency).toBeCloseTo(ROOT_NOTES.D2.frequency, 2);
    expect(bottomPitch.noteName).toBe('D2');
    expect(bottomPitch.semitones).toBe(0);

    // Top of canvas (y = 0) -> u = 1 -> highest note
    const topPitch = quantizer.quantizeDiscrete(0, canvasHeight);
    // Dorian has 7 notes/octave. 4 octaves = 28 notes. Max degree = 27.
    // 27 = 3 * 7 + 6. intervals[6] is 10 semitones. Semitones = 3 * 12 + 10 = 46 semitones.
    expect(topPitch.semitones).toBe(46);
    expect(topPitch.frequency).toBeCloseTo(ROOT_NOTES.D2.frequency * Math.pow(2, 46 / 12), 2);
  });

  it('quantizes discrete notes correctly for Dorian mode', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian, // intervals: [0, 2, 3, 5, 7, 9, 10]
      root: ROOT_NOTES.D2,
      octaveSpan: 1, // 7 notes: degree 0..6
    });

    // degree 0: D2 (+0)
    // degree 1: E2 (+2)
    // degree 2: F2 (+3)
    // degree 3: G2 (+5)
    // degree 4: A2 (+7)
    // degree 5: B2 (+9)
    // degree 6: C3 (+10)

    expect(quantizer.getSemitonesForDegree(0)).toBe(0);
    expect(quantizer.getSemitonesForDegree(1)).toBe(2);
    expect(quantizer.getSemitonesForDegree(2)).toBe(3);
    expect(quantizer.getSemitonesForDegree(3)).toBe(5);
    expect(quantizer.getSemitonesForDegree(4)).toBe(7);
    expect(quantizer.getSemitonesForDegree(5)).toBe(9);
    expect(quantizer.getSemitonesForDegree(6)).toBe(10);
    expect(quantizer.getSemitonesForDegree(7)).toBe(12); // Next octave root
  });

  it('demonstrates smooth continuous modal pitch interpolation without deadband snapping', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
      octaveSpan: 2,
    });

    const total = quantizer.totalNotes; // 14 notes, degrees 0 to 13
    // For scale degree 1 (E2, +2 semitones):
    // u corresponding to degree 1 is 1 / 13
    const uDegree1 = 1 / (total - 1);
    const yDegree1 = (1 - uDegree1) * canvasHeight;

    // Directly at degree 1
    const pCenter = quantizer.quantizeContinuous(yDegree1, canvasHeight);
    expect(pCenter.isSnapped).toBe(true);
    expect(pCenter.semitones).toBeCloseTo(2, 4);

    // Slightly above degree 1, delta = 0.15 (smoothly interpolates without deadband clamping)
    const uDelta15 = (1 + 0.15) / (total - 1);
    const yDelta15 = (1 - uDelta15) * canvasHeight;
    const pDelta15 = quantizer.quantizeContinuous(yDelta15, canvasHeight);
    expect(pDelta15.semitones).toBeCloseTo(2.15, 3);
    expect(pDelta15.isSnapped).toBe(false);

    // Halfway between degree 1 and degree 2 (delta = 0.5)
    // Degree 1 = +2 semitones, Degree 2 = +3 semitones -> exactly 2.5 semitones
    const uTransition = (1 + 0.5) / (total - 1);
    const yTransition = (1 - uTransition) * canvasHeight;
    const pTransition = quantizer.quantizeContinuous(yTransition, canvasHeight);
    expect(pTransition.isSnapped).toBe(false);
    expect(pTransition.semitones).toBeCloseTo(2.5, 3);
    // Transition period properties for dual-voice overlap:
    expect(pTransition.freq1).toBeDefined();
    expect(pTransition.freq2).toBeDefined();
    expect(pTransition.freq1).toBeCloseTo(ROOT_NOTES.D2.frequency * Math.pow(2, 2 / 12), 2); // E2
    expect(pTransition.freq2).toBeCloseTo(ROOT_NOTES.D2.frequency * Math.pow(2, 3 / 12), 2); // F2
    // At gamma = 0.5, blend should be ~0.5 (equal power crossfade center)
    expect(pTransition.blend).toBeCloseTo(0.5, 1);

    // Even/odd bank equal-power properties: gA^2 + gB^2 = 1.0
    expect(pTransition.freqA).toBeDefined();
    expect(pTransition.freqB).toBeDefined();
    expect(pTransition.gainA! ** 2 + pTransition.gainB! ** 2).toBeCloseTo(1.0, 3);
    // At degree 1.5: both Bank A (degree 2) and Bank B (degree 1) sound at ~0.7071
    expect(pTransition.gainA).toBeCloseTo(Math.SQRT1_2, 2);
    expect(pTransition.gainB).toBeCloseTo(Math.SQRT1_2, 2);

    // Directly on Guideline 1 (degree 1.0, odd): Bank B has gain = 1.0, Bank A is silent (0.0)
    expect(pCenter.gainB).toBeCloseTo(1.0, 2);
    expect(pCenter.gainA).toBeCloseTo(0.0, 2);
    expect(pCenter.freqB).toBeCloseTo(ROOT_NOTES.D2.frequency * Math.pow(2, 2 / 12), 2); // E2

    // Near degree 2 (delta = 0.85 -> 2.85 semitones without premature deadband snap)
    const uNearDeg2 = (1 + 0.85) / (total - 1);
    const yNearDeg2 = (1 - uNearDeg2) * canvasHeight;
    const pNearDeg2 = quantizer.quantizeContinuous(yNearDeg2, canvasHeight);
    expect(pNearDeg2.isSnapped).toBe(false);
    expect(pNearDeg2.semitones).toBeCloseTo(2.85, 3);
    expect(pNearDeg2.blend).toBeCloseTo(1.0, 1);
    expect(pNearDeg2.gainA! ** 2 + pNearDeg2.gainB! ** 2).toBeCloseTo(1.0, 3);
  });

  it('clamps coordinates safely when pointer is outside canvas', () => {
    const quantizer = new ScaleQuantizer();
    const aboveCanvas = quantizer.quantizeContinuous(-100, canvasHeight);
    const belowCanvas = quantizer.quantizeContinuous(1000, canvasHeight);

    expect(aboveCanvas.frequency).toBeGreaterThan(belowCanvas.frequency);
    expect(belowCanvas.semitones).toBe(0);
  });

  it('supports Lydian mode (#4 interval) and Minor Pentatonic mode', () => {
    const lydianQuantizer = new ScaleQuantizer({
      scale: SCALES.lydian, // [0, 2, 4, 6, 7, 9, 11]
      root: ROOT_NOTES.D2,
      octaveSpan: 1,
    });
    // Scale degree 3 in Lydian is the augmented 4th (+6 semitones)
    expect(lydianQuantizer.getSemitonesForDegree(3)).toBe(6);

    const pentaQuantizer = new ScaleQuantizer({
      scale: SCALES.minorPentatonic, // [0, 3, 5, 7, 10]
      root: ROOT_NOTES.A2,
      octaveSpan: 2,
    });
    expect(pentaQuantizer.totalNotes).toBe(10);
    // Degree 1 is minor 3rd (+3 semitones)
    expect(pentaQuantizer.getSemitonesForDegree(1)).toBe(3);
    // Degree 5 is octave (+12 semitones)
    expect(pentaQuantizer.getSemitonesForDegree(5)).toBe(12);
  });
});

describe('Scrollable 8-Octave Frequency Field', () => {
  const viewportHeight = 800;

  it('calculates 8-octave world geometry and centers default scroll on D2–D6 register', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
      octaveSpan: 4,
    });
    quantizer.setScrollEnabled(true);

    expect(quantizer.totalFieldOctaves).toBe(8);
    expect(quantizer.octavesBelowRoot).toBe(2);
    expect(quantizer.octavesAboveRoot).toBe(6);

    // With 4 visible octaves on an 800px viewport, each octave is 200px
    const pxPerOct = quantizer.getPxPerOctave(viewportHeight);
    expect(pxPerOct).toBe(200);

    // Total world height = 8 * 200 = 1600px
    const worldHeight = quantizer.getWorldHeight(viewportHeight);
    expect(worldHeight).toBe(1600);

    // Root D2 is at (8 - 2) * 200 = 1200px in world space
    const rootWorldY = quantizer.getRootWorldY(viewportHeight);
    expect(rootWorldY).toBe(1200);

    // Default scroll places D2 at the bottom of the viewport: 1200 - 800 = 400px
    const defaultScroll = quantizer.getDefaultScrollY(viewportHeight);
    expect(defaultScroll).toBe(400);

    quantizer.resetScrollToDefault(viewportHeight);
    expect(quantizer.scrollY).toBe(400);

    // When scrolled to default (400px):
    // Screen bottom (y=800) -> world Y = 800 + 400 = 1200 -> Root D2 (73.42 Hz)
    const worldAtScreenBottom = quantizer.screenToWorldY(viewportHeight, viewportHeight);
    const bottomPitch = quantizer.quantizeContinuousWorld(worldAtScreenBottom, viewportHeight);
    expect(bottomPitch.noteName).toBe('D2');
    expect(bottomPitch.frequency).toBeCloseTo(ROOT_NOTES.D2.frequency, 1);

    // Screen top (y=0) -> world Y = 0 + 400 = 400 -> D6 (4 octaves above D2 = 73.42 * 16 = 1174.66 Hz)
    const worldAtScreenTop = quantizer.screenToWorldY(0, viewportHeight);
    const topPitch = quantizer.quantizeContinuousWorld(worldAtScreenTop, viewportHeight);
    expect(topPitch.noteName).toBe('D6');
    expect(topPitch.frequency).toBeCloseTo(ROOT_NOTES.D2.frequency * 16, 1);
  });

  it('scrolls UP towards highest frequencies (D8 ~4698 Hz)', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
      octaveSpan: 4,
    });
    quantizer.setScrollEnabled(true);

    // Scroll all the way to top: scrollY = 0
    quantizer.scrollY = 0;
    expect(quantizer.scrollY).toBe(0);

    // Top of world (worldY = 0) is 6 octaves above D2: 73.416 * 64 = 4698.6 Hz (D8)
    const pitchAtWorldTop = quantizer.quantizeContinuousWorld(0, viewportHeight);
    expect(pitchAtWorldTop.noteName).toBe('D8');
    expect(pitchAtWorldTop.frequency).toBeCloseTo(ROOT_NOTES.D2.frequency * 64, 1);

    const info = quantizer.getFrequencyRangeInfo(viewportHeight, 0);
    expect(info.maxFreq).toBeCloseTo(ROOT_NOTES.D2.frequency * 64, 1);
    expect(info.topNote).toBe('D8');
  });

  it('scrolls DOWN towards lowest sub-bass frequencies (D0 ~18.35 Hz)', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
      octaveSpan: 4,
    });
    quantizer.setScrollEnabled(true);

    const maxScroll = quantizer.getMaxScrollY(viewportHeight);
    expect(maxScroll).toBe(800);

    // Scroll all the way to bottom
    quantizer.scrollY = maxScroll;
    expect(quantizer.scrollY).toBe(800);

    // Bottom of world (worldY = 1600) is 2 octaves below D2: 73.416 / 4 = 18.35 Hz (D0)
    const pitchAtWorldBottom = quantizer.quantizeContinuousWorld(1600, viewportHeight);
    expect(pitchAtWorldBottom.noteName).toBe('D0');
    expect(pitchAtWorldBottom.frequency).toBeCloseTo(ROOT_NOTES.D2.frequency / 4, 1);

    const info = quantizer.getFrequencyRangeInfo(viewportHeight, maxScroll);
    expect(info.minFreq).toBeCloseTo(ROOT_NOTES.D2.frequency / 4, 1);
    expect(info.bottomNote).toBe('D0');
  });

  it('ensures sounded stroke pitch is invariant to camera scroll', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
      octaveSpan: 4,
    });
    quantizer.setScrollEnabled(true);

    // A stroke recorded at world coordinate Y = 1000
    const fixedWorldY = 1000;
    const pitchAtDefault = quantizer.quantizeContinuousWorld(fixedWorldY, viewportHeight);

    // User scrolls camera up
    quantizer.scrollBy(-200, viewportHeight);
    const pitchScrolledUp = quantizer.quantizeContinuousWorld(fixedWorldY, viewportHeight);

    // User scrolls camera down
    quantizer.scrollBy(400, viewportHeight);
    const pitchScrolledDown = quantizer.quantizeContinuousWorld(fixedWorldY, viewportHeight);

    // Pitch does NOT change when view scrolls!
    expect(pitchScrolledUp.frequency).toBe(pitchAtDefault.frequency);
    expect(pitchScrolledDown.frequency).toBe(pitchAtDefault.frequency);
    expect(pitchScrolledUp.semitones).toBe(pitchAtDefault.semitones);
  });

  it('filters guidelines to only visible window with computed screen coordinates', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
      octaveSpan: 4,
    });
    quantizer.setScrollEnabled(true);
    quantizer.resetScrollToDefault(viewportHeight);

    const allGuidelines = quantizer.getAllGuidelines(viewportHeight);
    const visibleGuidelines = quantizer.getVisibleGuidelines(viewportHeight, quantizer.scrollY);

    expect(allGuidelines.length).toBeGreaterThan(visibleGuidelines.length);

    // All visible guidelines must have screenY within viewport margins [-30, 830]
    for (const g of visibleGuidelines) {
      expect(g.screenY).toBeDefined();
      expect(g.screenY!).toBeGreaterThanOrEqual(-30);
      expect(g.screenY!).toBeLessThanOrEqual(viewportHeight + 30);
    }
  });

  it('provides frequency spectrum info with exact boundaries and notes', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
      octaveSpan: 4,
    });
    quantizer.setScrollEnabled(true);
    quantizer.resetScrollToDefault(viewportHeight);

    const info = quantizer.getFrequencyRangeInfo(viewportHeight, quantizer.scrollY);
    expect(info.minFreq).toBeCloseTo(18.35, 1);
    expect(info.maxFreq).toBeCloseTo(4698.6, 1);
    expect(info.bottomNote).toBe('D2');
    expect(info.topNote).toBe('D6');
    expect(info.thumbHeightRatio).toBe(0.5); // 4 octaves visible out of 8 = 50%
  });
});
