import { describe, it, expect } from 'vitest';
import { ScaleQuantizer } from '../src/audio/scaleQuantizer';
import { SCALES, ROOT_NOTES } from '../src/audio/scales';

describe('Coordinate-to-Pitch Scale Quantizer (Non-linear 100 Hz to 8000 Hz)', () => {
  const canvasHeight = 600;

  it('inverts canvas Y coordinate: bottom is 100 Hz, top is 8000 Hz', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
    });

    // Bottom of canvas (y = 600) -> u = 0 -> 100 Hz
    const bottomPitch = quantizer.quantizeContinuous(600, canvasHeight);
    expect(bottomPitch.frequency).toBeCloseTo(100, 1);

    // Top of canvas (y = 0) -> u = 1 -> 8000 Hz
    const topPitch = quantizer.quantizeContinuous(0, canvasHeight);
    expect(topPitch.frequency).toBeCloseTo(8000, 1);
  });

  it('allocates 70% of vertical space for high precision between 200 Hz and 2000 Hz', () => {
    // 200 Hz is at u = 0.15 (15% from bottom, y = 0.85 * H)
    const u200 = ScaleQuantizer.frequencyToNormalizedU(200);
    expect(u200).toBeCloseTo(0.15, 3);

    // 2000 Hz is at u = 0.85 (85% from bottom, y = 0.15 * H)
    const u2000 = ScaleQuantizer.frequencyToNormalizedU(2000);
    expect(u2000).toBeCloseTo(0.85, 3);

    // The span is exactly 70% of the canvas height
    expect(u2000 - u200).toBeCloseTo(0.70, 3);

    // Midpoint between u = 0.15 and u = 0.85 is u = 0.50 (exact canvas center)
    // 200 * (2000/200)^0.5 = 200 * sqrt(10) = 632.45 Hz
    const fCenter = ScaleQuantizer.normalizedUToFrequency(0.50);
    expect(fCenter).toBeCloseTo(200 * Math.sqrt(10), 1);
  });

  it('inverts normalized U and frequency accurately and losslessly', () => {
    const testFreqs = [100, 150, 200, 440, 1000, 2000, 5000, 8000];
    for (const f of testFreqs) {
      const u = ScaleQuantizer.frequencyToNormalizedU(f);
      const recovered = ScaleQuantizer.normalizedUToFrequency(u);
      expect(recovered).toBeCloseTo(f, 2);
    }
  });

  it('quantizes discrete notes correctly within 100 Hz - 8000 Hz bounds', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
    });

    // Root D2 (73.4 Hz) is below 100 Hz, so lowest degree is G2 (98 Hz) / A2 (110 Hz)
    const pBottom = quantizer.quantizeDiscrete(600, canvasHeight);
    expect(pBottom.frequency).toBeGreaterThanOrEqual(95);

    // Middle A4 (440 Hz) should be accurately identified
    const u440 = ScaleQuantizer.frequencyToNormalizedU(440);
    const y440 = (1 - u440) * canvasHeight;
    const p440 = quantizer.quantizeDiscrete(y440, canvasHeight);
    expect(p440.frequency).toBeCloseTo(440, 1);
    expect(p440.noteName).toBe('A4');
  });

  it('demonstrates smooth continuous modal pitch interpolation without deadband snapping', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
    });

    // Degree 18 in Dorian D2 is A4 (440 Hz)
    const uA4 = ScaleQuantizer.frequencyToNormalizedU(440);
    const yA4 = (1 - uA4) * canvasHeight;

    const pCenter = quantizer.quantizeContinuous(yA4, canvasHeight);
    expect(pCenter.isSnapped).toBe(true);
    expect(pCenter.frequency).toBeCloseTo(440, 1);
    expect(pCenter.noteName).toBe('A4');

    // Dual-voice overlap gains sum to unity power: gainA^2 + gainB^2 = 1.0
    expect(pCenter.gainA! ** 2 + pCenter.gainB! ** 2).toBeCloseTo(1.0, 3);
  });

  it('clamps coordinates safely when pointer is outside canvas', () => {
    const quantizer = new ScaleQuantizer();
    const aboveCanvas = quantizer.quantizeContinuous(-100, canvasHeight);
    const belowCanvas = quantizer.quantizeContinuous(1000, canvasHeight);

    expect(aboveCanvas.frequency).toBeCloseTo(8000, 1);
    expect(belowCanvas.frequency).toBeCloseTo(100, 1);
  });

  it('generates guidelines covering full 100 Hz to 8000 Hz range with root and chord tones', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
    });

    const guidelines = quantizer.getGuidelines(canvasHeight);
    expect(guidelines.length).toBeGreaterThan(30);

    // All guidelines must fall within [100 Hz, 8000 Hz]
    for (const g of guidelines) {
      expect(g.frequency).toBeGreaterThanOrEqual(100);
      expect(g.frequency).toBeLessThanOrEqual(8000);
      expect(g.y).toBeGreaterThanOrEqual(0);
      expect(g.y).toBeLessThanOrEqual(canvasHeight);
    }

    // Must include roots (e.g. D3, D4, D5)
    const roots = guidelines.filter((g) => g.isRoot);
    expect(roots.length).toBeGreaterThanOrEqual(5);
  });

  it('provides frequency spectrum info with exact 100 Hz and 8000 Hz boundaries', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
    });

    const info = quantizer.getFrequencyRangeInfo(canvasHeight, 0);
    expect(info.minFreq).toBe(100);
    expect(info.maxFreq).toBe(8000);
    expect(info.bottomFreq).toBeCloseTo(100, 1);
    expect(info.topFreq).toBeCloseTo(8000, 1);
  });
});
