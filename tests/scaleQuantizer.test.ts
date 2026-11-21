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

  it('supports Major (Ionian) and Mixolydian modal scales and updates quantizer configuration correctly', () => {
    // 1. Verify SCALES has both major and mixolydian definitions
    expect(SCALES.major).toBeDefined();
    expect(SCALES.major.intervals).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(SCALES.major.name).toBe('Major (Ionian)');

    expect(SCALES.mixolydian).toBeDefined();
    expect(SCALES.mixolydian.intervals).toEqual([0, 2, 4, 5, 7, 9, 10]);
    expect(SCALES.mixolydian.name).toBe('Mixolydian');

    // 2. Test quantizer with Major scale
    const quantizer = new ScaleQuantizer({
      scale: SCALES.major,
      root: ROOT_NOTES.C2,
    });
    expect(quantizer.getConfig().scale.id).toBe('major');

    // Root note is C2 (baseMidi 36)
    // Major 3rd (interval 4) should be E, Perfect 4th (interval 5) should be F, Major 7th (interval 11) should be B
    const guidelinesMajor = quantizer.getAllGuidelines(600);
    const noteNamesMajor = guidelinesMajor.map((p) => p.noteName);
    expect(noteNamesMajor).toContain('C3');
    expect(noteNamesMajor).toContain('E3');
    expect(noteNamesMajor).toContain('F3');
    expect(noteNamesMajor).toContain('B3');

    // 3. Switch to Mixolydian scale
    quantizer.updateConfig({ scale: SCALES.mixolydian });
    expect(quantizer.getConfig().scale.id).toBe('mixolydian');

    const guidelinesMixo = quantizer.getAllGuidelines(600);
    const noteNamesMixo = guidelinesMixo.map((p) => p.noteName);
    // Mixolydian has minor 7th (interval 10, Bb/A#) instead of Major 7th (B)
    expect(noteNamesMixo).toContain('C3');
    expect(noteNamesMixo).toContain('E3');
    expect(noteNamesMixo).toContain('F3');
    expect(noteNamesMixo).toContain('A#3'); // or Bb
    expect(noteNamesMixo).not.toContain('B3');
  });

  it('identifies perfect fifths (7 semitones) accurately via isFifth on pentatonic scales and negative scale degrees', () => {
    for (const scale of [SCALES.minorPentatonic, SCALES.majorPentatonic]) {
      const quantizer = new ScaleQuantizer({
        scale,
        root: ROOT_NOTES.A3, // 220 Hz -> negative degree -2 (E3 ≈ 164.81 Hz) stays above 110 Hz
      });

      const guidelines = quantizer.getAllGuidelines(canvasHeight);

      // Degree -2 is -5 semitones from A3 = E3 (perfect fifth mod 12: (-5 % 12 + 12) % 12 === 7)
      const negFifth = guidelines.find((g) => g.scaleDegree === -2);
      expect(negFifth).toBeDefined();
      expect(negFifth?.noteName).toBe('E3');
      expect(negFifth?.isRoot).toBe(false);
      expect(negFifth?.isFifth).toBe(true);

      // Degree +3 on both minor [0,3,5,7,10] and major [0,2,4,7,9] pentatonic is +7 semitones = E4
      const posFifth = guidelines.find((g) => g.scaleDegree === 3);
      expect(posFifth).toBeDefined();
      expect(posFifth?.noteName).toBe('E4');
      expect(posFifth?.isRoot).toBe(false);
      expect(posFifth?.isFifth).toBe(true);

      // Non-fifth degrees must not be flagged as fifths
      const degNeg1 = guidelines.find((g) => g.scaleDegree === -1);
      const deg4 = guidelines.find((g) => g.scaleDegree === 4);
      expect(degNeg1?.isFifth).toBe(false);
      expect(deg4?.isFifth).toBe(false);

      // Every fifth guideline must be non-root and exactly 7 semitones above root mod 12
      const fifths = guidelines.filter((g) => g.isFifth);
      expect(fifths.length).toBeGreaterThanOrEqual(3);
      for (const g of fifths) {
        expect(g.isRoot).toBe(false);
        const semitones = quantizer.getSemitonesForDegree(g.scaleDegree);
        expect(((semitones % 12) + 12) % 12).toBe(7);
      }
    }
  });

  it('getRootWorldY honors MARGIN_Y via normalizedUToWorldY', () => {
    const quantizerA2 = new ScaleQuantizer({ root: ROOT_NOTES.A2 }); // 110 Hz -> u = 0
    const worldH = quantizerA2.getWorldHeight(canvasHeight);
    expect(quantizerA2.getRootWorldY(canvasHeight)).toBe(worldH - ScaleQuantizer.MARGIN_Y);
    expect(quantizerA2.getRootWorldY(canvasHeight)).toBe(quantizerA2.normalizedUToWorldY(0, canvasHeight));

    for (const root of [ROOT_NOTES.D3, ROOT_NOTES.A3]) {
      const q = new ScaleQuantizer({ root });
      const u = ScaleQuantizer.frequencyToNormalizedU(root.frequency);
      const rootY = q.getRootWorldY(canvasHeight);
      expect(rootY).toBe(q.normalizedUToWorldY(u, canvasHeight));
      expect(q.quantizeContinuousWorld(rootY, canvasHeight).frequency).toBeCloseTo(root.frequency, 2);
    }
  });

  it('getAllGuidelines memoizes identical inputs and invalidates cache on updateConfig()', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
      octaveSpan: 4,
    });

    const first = quantizer.getAllGuidelines(canvasHeight);
    const second = quantizer.getAllGuidelines(canvasHeight);
    expect(second).toBe(first);

    // Changing config clears the memoization cache
    quantizer.updateConfig({ scale: SCALES.lydian });
    const third = quantizer.getAllGuidelines(canvasHeight);
    expect(third).not.toBe(first);
    expect(quantizer.getAllGuidelines(canvasHeight)).toBe(third);

    // Restoring original config produces a freshly computed array rather than stale cached object
    quantizer.updateConfig({ scale: SCALES.dorian });
    const fourth = quantizer.getAllGuidelines(canvasHeight);
    expect(fourth).not.toBe(first);
  });

  it('getGuidelines remaps to [0, canvasHeight] canvas coordinates when isScrollEnabled is false', () => {
    const quantizer = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
      octaveSpan: 4,
    });
    expect(quantizer.isScrollEnabled).toBe(false);

    const worldBefore = quantizer.getAllGuidelines(canvasHeight).map((g) => g.y);
    const guidelines = quantizer.getGuidelines(canvasHeight);
    expect(guidelines.length).toBeGreaterThan(20);

    for (const g of guidelines) {
      expect(g.y).toBeGreaterThanOrEqual(0);
      expect(g.y).toBeLessThanOrEqual(canvasHeight);
      expect(g.screenY).toBe(g.y);
      const expectedY = quantizer.normalizedUToCanvasY(
        ScaleQuantizer.frequencyToNormalizedU(g.frequency),
        canvasHeight
      );
      expect(g.y).toBeCloseTo(expectedY, 6);
    }

    const bottomLine = guidelines.find((g) => Math.abs(g.frequency - ScaleQuantizer.MIN_FREQ) < 0.5);
    const topLine = guidelines.find((g) => Math.abs(g.frequency - ScaleQuantizer.MAX_FREQ) < 0.5);
    expect(bottomLine?.y).toBe(canvasHeight - ScaleQuantizer.MARGIN_Y);
    expect(topLine?.y).toBe(ScaleQuantizer.MARGIN_Y);

    // Remapping must not mutate cached world guidelines
    const worldAfter = quantizer.getAllGuidelines(canvasHeight).map((g) => g.y);
    expect(worldAfter).toEqual(worldBefore);
  });
});

