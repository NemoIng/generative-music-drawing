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

  it('demonstrates deadband hysteresis snapping for continuous solid strokes', () => {
    const deadbandWidth = 0.25;
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
      octaveSpan: 2,
      deadbandWidth,
    });

    const total = quantizer.totalNotes; // 14 notes, degrees 0 to 13
    // For scale degree 1 (E2, +2 semitones):
    // u corresponding to degree 1 is 1 / 13
    const uDegree1 = 1 / (total - 1);
    const yDegree1 = (1 - uDegree1) * canvasHeight;

    // Directly at degree 1
    const pCenter = quantizer.quantizeContinuous(yDegree1, canvasHeight);
    expect(pCenter.isSnapped).toBe(true);
    expect(pCenter.semitones).toBe(2);

    // Slightly above degree 1, within deadband delta = 0.15 < 0.25
    const uWithinDeadband = (1 + 0.15) / (total - 1);
    const yWithinDeadband = (1 - uWithinDeadband) * canvasHeight;
    const pDeadband = quantizer.quantizeContinuous(yWithinDeadband, canvasHeight);
    expect(pDeadband.isSnapped).toBe(true);
    expect(pDeadband.semitones).toBe(2); // Stays locked at degree 1!

    // In transition zone delta = 0.5 (halfway between degree 1 and degree 2)
    // Degree 1 = +2 semitones, Degree 2 = +3 semitones
    // With w = 0.25:
    // delta = 0.5 is exactly midway in [0.25, 0.75].
    // normalizedTransition = (0.5 - 0.25) / (1 - 0.5) = 0.5
    // semitones should be exactly midway: 2.5 semitones
    const uTransition = (1 + 0.5) / (total - 1);
    const yTransition = (1 - uTransition) * canvasHeight;
    const pTransition = quantizer.quantizeContinuous(yTransition, canvasHeight);
    expect(pTransition.isSnapped).toBe(false);
    expect(pTransition.semitones).toBeCloseTo(2.5, 3);

    // Near degree 2 (delta = 0.85 > 1 - 0.25 = 0.75)
    // Should snap to degree 2 (F2, +3 semitones)
    const uNearDeg2 = (1 + 0.85) / (total - 1);
    const yNearDeg2 = (1 - uNearDeg2) * canvasHeight;
    const pNearDeg2 = quantizer.quantizeContinuous(yNearDeg2, canvasHeight);
    expect(pNearDeg2.isSnapped).toBe(true);
    expect(pNearDeg2.semitones).toBe(3);
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
