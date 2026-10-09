import { describe, it, expect } from 'vitest';
import { ScaleQuantizer } from '../src/audio/scaleQuantizer';
import { SCALES, ROOT_NOTES } from '../src/audio/scales';

describe('Coordinate-to-Pitch Scale Quantizer (Non-linear 110 Hz to 8000 Hz)', () => {
  const canvasHeight = 600;

  it('inverts canvas Y coordinate: bottom is 110 Hz, top is 8000 Hz', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
    });

    // Bottom of canvas (y = 600) -> u = 0 -> 110 Hz
    const bottomPitch = quantizer.quantizeContinuous(600, canvasHeight);
    expect(bottomPitch.frequency).toBeCloseTo(110, 1);

    // Top of canvas (y = 0) -> u = 1 -> 8000 Hz
    const topPitch = quantizer.quantizeContinuous(0, canvasHeight);
    expect(topPitch.frequency).toBeCloseTo(8000, 1);
  });

  it('allocates 70% of vertical space for high precision between 300 Hz and 2500 Hz, giving 100-300 Hz 22% and top shelf 8%', () => {
    // 300 Hz is at u = 0.22 (22% from bottom, generous bass foundation)
    const u300 = ScaleQuantizer.frequencyToNormalizedU(300);
    expect(u300).toBeCloseTo(0.22, 3);

    // 2500 Hz is at u = 0.92 (92% from bottom)
    const u2500 = ScaleQuantizer.frequencyToNormalizedU(2500);
    expect(u2500).toBeCloseTo(0.92, 3);

    // The span is exactly 70% of the canvas height
    expect(u2500 - u300).toBeCloseTo(0.70, 3);

    // High shelf 2500-8000 Hz occupies only 8%
    const u8000 = ScaleQuantizer.frequencyToNormalizedU(8000);
    expect(u8000 - u2500).toBeCloseTo(0.08, 3);
  });

  it('guarantees pitch invariance during scrolling for world coordinates', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
    });
    quantizer.setScrollEnabled(true);

    const worldY = 850;
    const initialContinuous = quantizer.quantizeContinuous(worldY, canvasHeight);
    const initialDiscrete = quantizer.quantizeDiscrete(worldY, canvasHeight);

    // Scroll up and down by significant distances
    quantizer.scrollBy(200, canvasHeight);
    const scrolledContinuous1 = quantizer.quantizeContinuous(worldY, canvasHeight);
    const scrolledDiscrete1 = quantizer.quantizeDiscrete(worldY, canvasHeight);
    expect(scrolledContinuous1.frequency).toBe(initialContinuous.frequency);
    expect(scrolledDiscrete1.frequency).toBe(initialDiscrete.frequency);

    quantizer.scrollBy(-350, canvasHeight);
    const scrolledContinuous2 = quantizer.quantizeContinuous(worldY, canvasHeight);
    const scrolledDiscrete2 = quantizer.quantizeDiscrete(worldY, canvasHeight);
    expect(scrolledContinuous2.frequency).toBe(initialContinuous.frequency);
    expect(scrolledDiscrete2.frequency).toBe(initialDiscrete.frequency);
  });

  it('inverts normalized U and frequency accurately and losslessly', () => {
    const testFreqs = [110, 150, 200, 440, 1000, 2000, 5000, 8000];
    for (const f of testFreqs) {
      const u = ScaleQuantizer.frequencyToNormalizedU(f);
      const recovered = ScaleQuantizer.normalizedUToFrequency(u);
      expect(recovered).toBeCloseTo(f, 2);
    }
  });

  it('quantizes discrete notes correctly within 110 Hz - 8000 Hz bounds', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
    });

    // Root D2 (73.4 Hz) is below 110 Hz, lowest degree at bottom is A2 (110 Hz)
    const pBottom = quantizer.quantizeDiscrete(600, canvasHeight);
    expect(pBottom.frequency).toBeGreaterThanOrEqual(105);

    // Middle A4 (440 Hz) should be accurately identified
    const u440 = ScaleQuantizer.frequencyToNormalizedU(440);
    const y440 = quantizer.normalizedUToCanvasY(u440, canvasHeight);
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
    const yA4 = quantizer.normalizedUToCanvasY(uA4, canvasHeight);

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
    expect(belowCanvas.frequency).toBeCloseTo(110, 1);
  });

  it('generates guidelines covering full 110 Hz to 8000 Hz range with root and chord tones', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
    });

    const guidelines = quantizer.getAllGuidelines(canvasHeight);
    expect(guidelines.length).toBeGreaterThan(30);

    // All guidelines must fall within [110 Hz, 8000 Hz]
    const worldH = quantizer.getWorldHeight(canvasHeight);
    for (const g of guidelines) {
      expect(g.frequency).toBeGreaterThanOrEqual(110);
      expect(g.frequency).toBeLessThanOrEqual(8000);
      expect(g.y).toBeGreaterThanOrEqual(0);
      expect(g.y).toBeLessThanOrEqual(worldH);
    }

    // Must include roots (e.g. D3, D4, D5)
    const roots = guidelines.filter((g) => g.isRoot);
    expect(roots.length).toBeGreaterThanOrEqual(5);
  });

  it('cleans up high-frequency guidelines above 3136 Hz to only have 4186 Hz and the top 8000 Hz line', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
    });

    const guidelines = quantizer.getAllGuidelines(canvasHeight);
    const highGuidelines = guidelines.filter((g) => g.frequency > ScaleQuantizer.HIGH_GUIDELINE_CUTOFF);

    // Above 3140 Hz, there must be exactly 2 guidelines: 4186 Hz (C8) and 8000 Hz (top line)
    expect(highGuidelines.length).toBe(2);

    const c8 = highGuidelines[0];
    const top = highGuidelines[1];

    expect(Math.round(c8.frequency)).toBe(4186);
    expect(c8.noteName).toBe('C8');

    expect(Math.round(top.frequency)).toBe(8000);
    expect(top.y).toBe(ScaleQuantizer.MARGIN_Y);
  });

  it('supports smooth scrolling across the full virtual world', () => {
    const quantizer = new ScaleQuantizer();
    quantizer.setScrollEnabled(true);
    expect(quantizer.getMaxScrollY(canvasHeight)).toBeGreaterThan(0);

    quantizer.resetScrollToDefault(canvasHeight);
    expect(quantizer.scrollY).toBeGreaterThan(0);
    expect(quantizer.scrollY).toBeLessThanOrEqual(quantizer.getMaxScrollY(canvasHeight));

    const before = quantizer.scrollY;
    quantizer.scrollBy(100, canvasHeight);
    expect(quantizer.scrollY).toBe(before + 100);
  });

  it('provides frequency spectrum info with exact 110 Hz and 8000 Hz boundaries', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
    });

    const maxScroll = quantizer.getMaxScrollY(canvasHeight);
    const bottomInfo = quantizer.getFrequencyRangeInfo(canvasHeight, maxScroll);
    expect(bottomInfo.minFreq).toBe(110);
    expect(bottomInfo.maxFreq).toBe(8000);
    expect(bottomInfo.bottomFreq).toBeCloseTo(110, 1);

    const topInfo = quantizer.getFrequencyRangeInfo(canvasHeight, 0);
    expect(topInfo.topFreq).toBeCloseTo(8000, 1);
  });

  it('guarantees pitch invariance during scrolling for world coordinates in both continuous and discrete mode', () => {
    const quantizer = new ScaleQuantizer();
    quantizer.setScrollEnabled(true);
    const canvasH = 600;
    quantizer.resetScrollToDefault(canvasH);

    const fixedWorldY = 550; // Fixed note coordinate in the world score

    const initialContinuous = quantizer.quantizeContinuous(fixedWorldY, canvasH);
    const initialDiscrete = quantizer.quantizeDiscrete(fixedWorldY, canvasH);

    // Scroll by +300 px
    quantizer.scrollBy(300, canvasH);
    const scrolledContinuous = quantizer.quantizeContinuous(fixedWorldY, canvasH);
    const scrolledDiscrete = quantizer.quantizeDiscrete(fixedWorldY, canvasH);

    expect(scrolledContinuous.frequency).toBe(initialContinuous.frequency);
    expect(scrolledContinuous.semitones).toBe(initialContinuous.semitones);
    expect(scrolledDiscrete.frequency).toBe(initialDiscrete.frequency);
    expect(scrolledDiscrete.semitones).toBe(initialDiscrete.semitones);

    // Scroll by -450 px
    quantizer.scrollBy(-450, canvasH);
    const scrolledBackContinuous = quantizer.quantizeContinuous(fixedWorldY, canvasH);
    const scrolledBackDiscrete = quantizer.quantizeDiscrete(fixedWorldY, canvasH);

    expect(scrolledBackContinuous.frequency).toBe(initialContinuous.frequency);
    expect(scrolledBackDiscrete.frequency).toBe(initialDiscrete.frequency);
  });

  it('allocates 22% vertical space to 100 Hz - 300 Hz, 70% to 300 Hz - 2500 Hz, and 8% to 2500 Hz - 8000 Hz', () => {
    const u100 = ScaleQuantizer.frequencyToNormalizedU(100);
    const u300 = ScaleQuantizer.frequencyToNormalizedU(300);
    const u2500 = ScaleQuantizer.frequencyToNormalizedU(2500);
    const u8000 = ScaleQuantizer.frequencyToNormalizedU(8000);

    expect(u100).toBe(0);
    expect(u300).toBeCloseTo(0.22, 3); // 22% for 100-300 Hz
    expect(u2500).toBeCloseTo(0.92, 3); // 92% - 22% = 70% for 300-2500 Hz precision band
    expect(u8000).toBe(1);

    // Test roundtrip inversion
    expect(ScaleQuantizer.normalizedUToFrequency(0.22)).toBeCloseTo(300, 1);
    expect(ScaleQuantizer.normalizedUToFrequency(0.92)).toBeCloseTo(2500, 1);
  });
});

