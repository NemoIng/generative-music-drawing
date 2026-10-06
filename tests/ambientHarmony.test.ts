import { describe, it, expect } from 'vitest';
import { StrokeManager } from '../src/engine/strokeManager';
import { getHarmonizerFrequencies } from '../src/audio/harmony';
import { calculateBreathing } from '../src/audio/breathing';
import { ScaleQuantizer } from '../src/audio/scaleQuantizer';
import { SCALES, ROOT_NOTES } from '../src/audio/scales';
import { TEMPLATES, buildTemplateStrokes } from '../src/audio/templates';
import { fitSplineFromPoints } from '../src/math/curveFit';

describe('Ambient Music Workflow: Ultra-Slow Tempos, Traversal Modes, & Harmonic Engine', () => {
  const quantizer = new ScaleQuantizer();
  const width = 1200;
  const height = 800;

  it('supports ultra-slow tempos down to 10 BPM', () => {
    const sm = new StrokeManager();
    sm.setBpm(10);
    expect(sm.currentBpm).toBe(10);

    sm.setBpm(5); // Below minimum
    expect(sm.currentBpm).toBe(10);

    sm.setBpm(35);
    expect(sm.currentBpm).toBe(35);
  });

  it('supports setting stroke duration with clamping and undo/redo', () => {
    const sm = new StrokeManager();
    const spline = fitSplineFromPoints([
      { x: 100, y: 300 },
      { x: 600, y: 300 },
      { x: 1100, y: 300 },
    ], 20)!;

    const stroke = sm.addStroke(spline, 'solid', 'indigo', 140, quantizer, height, 1.0, '2bars', 'bounce', 45, 1.0, 'timer');
    expect(stroke.duration).toBe(45);

    // Modify duration
    const ok = sm.setStrokeDuration(stroke.id, 60);
    expect(ok).toBe(true);
    expect(stroke.duration).toBe(60);

    // Undo duration change
    sm.undo();
    expect(stroke.duration).toBe(45);

    // Redo duration change
    sm.redo();
    expect(stroke.duration).toBe(60);

    // Clamping limits (1s to 300s)
    sm.setStrokeDuration(stroke.id, 0);
    expect(stroke.duration).toBe(1);

    sm.setStrokeDuration(stroke.id, 500);
    expect(stroke.duration).toBe(300);
  });

  it('handles Timer mode with speed governed by stroke duration independent of BPM', () => {
    const sm = new StrokeManager();
    sm.setBpm(120); // High BPM shouldn't affect timer mode duration
    const spline = fitSplineFromPoints([
      { x: 100, y: 400 },
      { x: 600, y: 400 },
      { x: 1100, y: 400 },
    ], 20)!;

    const duration = 20; // 20 seconds
    const stroke = sm.addStroke(spline, 'solid', 'indigo', 140, quantizer, height, 1.0, 'freeform', 'bounce', duration, 1.0, 'timer');
    const L = stroke.lut.totalLength;
    const expectedSpeed = L / duration;

    // Simulate 1.0 second
    sm.update(1.0, width, height, quantizer);
    expect(stroke.playhead.velocity).toBeCloseTo(expectedSpeed, 1);
    expect(stroke.playhead.currentDistance).toBeCloseTo(expectedSpeed, 1);
  });

  it('handles Bounce mode with continuous turnaround back and forth', () => {
    const sm = new StrokeManager();
    const spline = fitSplineFromPoints([
      { x: 100, y: 400 },
      { x: 500, y: 400 },
      { x: 900, y: 400 },
    ], 20)!;

    const stroke = sm.addStroke(spline, 'solid', 'spruce', 140, quantizer, height, 1.0, 'freeform', 'bounce', 30, 1.0, 'timer');
    const L = stroke.lut.totalLength;

    // Fast-forward playhead to near the end
    stroke.playhead.currentDistance = L - 1;
    stroke.playhead.direction = 1;

    // Step forward past L
    sm.update(1.0, width, height, quantizer);

    // Direction should reverse to -1 and distance bounce back from L
    expect(stroke.playhead.direction).toBe(-1);
    expect(stroke.playhead.currentDistance).toBeLessThanOrEqual(L);
  });

  it('handles Restart mode which loops from line beginning', () => {
    const sm = new StrokeManager();
    const spline = fitSplineFromPoints([
      { x: 100, y: 200 },
      { x: 400, y: 200 },
      { x: 700, y: 200 },
    ], 20)!;

    const stroke = sm.addStroke(spline, 'dotted', 'violet', 140, quantizer, height, 1.0, 'freeform', 'restart', 10);
    const L = stroke.lut.totalLength;

    // Move playhead almost to the end
    stroke.playhead.currentDistance = L - 2;

    // Advance 1 second (which overshoots L)
    sm.update(1.0, width, height, quantizer);

    // Playhead wraps around to start and continues forward
    expect(stroke.playhead.direction).toBe(1);
    expect(stroke.playhead.currentDistance).toBeLessThan(L);

    // Resyncing playheads resets distance
    sm.resyncAllPlayheads();
    expect(stroke.playhead.finished).toBe(false);
    expect(stroke.playhead.currentDistance).toBe(0);
  });

  it('computes modal harmonizer chord frequencies dynamically (octaves, fifths, triads, 7ths)', () => {
    const q = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
      octaveSpan: 3,
    });
    const baseFreq = 146.83; // D3
    const baseDegree = 7; // Root of octave 2

    // Single mode: 1 voice
    const singleRes = getHarmonizerFrequencies('single', baseFreq, baseDegree, q);
    expect(singleRes.frequencies).toEqual([baseFreq]);
    expect(singleRes.gains).toEqual([1.0]);

    // Octave mode: 2 voices (baseFreq and baseFreq * 2)
    const octRes = getHarmonizerFrequencies('octave', baseFreq, baseDegree, q);
    expect(octRes.frequencies.length).toBe(2);
    expect(octRes.frequencies[0]).toBe(baseFreq);
    expect(octRes.frequencies[1]).toBeCloseTo(baseFreq * 2, 2);
    expect(octRes.gains.length).toBe(2);

    // Sub-octave mode: 2 voices (baseFreq and baseFreq * 0.5)
    const subRes = getHarmonizerFrequencies('subOctave', baseFreq, baseDegree, q);
    expect(subRes.frequencies.length).toBe(2);
    expect(subRes.frequencies[0]).toBe(baseFreq);
    expect(subRes.frequencies[1]).toBeCloseTo(baseFreq * 0.5, 2);
    expect(subRes.gains.length).toBe(2);

    // Dual-octave mode: 3 voices (baseFreq, baseFreq * 0.5, baseFreq * 2)
    const dualRes = getHarmonizerFrequencies('dualOctave', baseFreq, baseDegree, q);
    expect(dualRes.frequencies.length).toBe(3);
    expect(dualRes.frequencies[0]).toBe(baseFreq);
    expect(dualRes.frequencies[1]).toBeCloseTo(baseFreq * 0.5, 2);
    expect(dualRes.frequencies[2]).toBeCloseTo(baseFreq * 2, 2);
    expect(dualRes.gains.length).toBe(3);

    // Fifth mode: 2 voices (diatonic 5th)
    const fifthRes = getHarmonizerFrequencies('fifth', baseFreq, baseDegree, q);
    expect(fifthRes.frequencies.length).toBe(2);
    expect(fifthRes.frequencies[0]).toBe(baseFreq);
    // In D Dorian, 5th degree is A3 (~220 Hz, ratio ~ 1.498)
    expect(fifthRes.frequencies[1]).toBeGreaterThan(baseFreq);
    expect(fifthRes.frequencies[1] / baseFreq).toBeCloseTo(1.498, 1);

    // Triad mode: 3 voices (Root, diatonic 3rd, diatonic 5th)
    const triadRes = getHarmonizerFrequencies('triad', baseFreq, baseDegree, q);
    expect(triadRes.frequencies.length).toBe(3);
    expect(triadRes.frequencies[0]).toBe(baseFreq);
    expect(triadRes.frequencies[1]).toBeGreaterThan(baseFreq); // Minor 3rd (F3)
    expect(triadRes.frequencies[2]).toBeGreaterThan(triadRes.frequencies[1]); // 5th (A3)
    // Minor 3rd ratio in 12-TET is 2^(3/12) ≈ 1.189
    expect(triadRes.frequencies[1] / baseFreq).toBeCloseTo(1.189, 2);

    // Seventh mode: 4 voices (Root, 3rd, 5th, 7th)
    const sevRes = getHarmonizerFrequencies('seventh', baseFreq, baseDegree, q);
    expect(sevRes.frequencies.length).toBe(4);
    expect(sevRes.frequencies[0]).toBe(baseFreq);
    expect(sevRes.frequencies[3]).toBeGreaterThan(sevRes.frequencies[2]);
    // In D Dorian, 7th degree is C4, minor 7th ratio is 2^(10/12) ≈ 1.782
    expect(sevRes.frequencies[3] / baseFreq).toBeCloseTo(1.782, 2);
  });

  it('ScaleQuantizer highlights chord tones on guidelines when chordDegrees are configured', () => {
    const q = new ScaleQuantizer({
      scale: SCALES.dorian,
      root: ROOT_NOTES.D2,
      octaveSpan: 2,
      chordDegrees: [0, 2, 4, 6], // Root, 3rd, 5th, 7th
    });

    const guidelines = q.getGuidelines(800);
    expect(guidelines.length).toBe(14); // 2 octaves * 7 notes

    // Root guidelines (k % 7 === 0)
    expect(guidelines[0].isRoot).toBe(true);
    expect(guidelines[7].isRoot).toBe(true);

    // Chord degree guidelines
    // Degree 2 (3rd) should have isChordTone = true
    const thirdNote = guidelines.find((g) => g.scaleDegree % 7 === 2);
    expect(thirdNote?.isChordTone).toBe(true);

    // Degree 3 (4th) should NOT be in [0, 2, 4, 6]
    const fourthNote = guidelines.find((g) => g.scaleDegree % 7 === 3);
    expect(fourthNote?.isChordTone).toBe(false);
  });

  it('provides new rich ambient templates with full acoustic settings', () => {
    const cosmic = TEMPLATES.deepCosmicDrone;
    expect(cosmic).toBeDefined();
    expect(cosmic.bpm).toBe(24);
    expect(cosmic.spaceReverb).toBe(0.75);
    expect(cosmic.breathingMode).toBe('deep');

    const cathedral = TEMPLATES.cathedralSolitude;
    expect(cathedral).toBeDefined();
    expect(cathedral.bpm).toBe(32);
    expect(cathedral.spaceReverb).toBe(0.85);
    expect(cathedral.breathingMode).toBe('deep');

    const tapeDrift = TEMPLATES.warmTapeDrift;
    expect(tapeDrift).toBeDefined();
    expect(tapeDrift.bpm).toBe(40);
    expect(tapeDrift.breathingMode).toBe('drift');

    const meadow = TEMPLATES.zenMeadow;
    expect(meadow).toBeDefined();
    expect(meadow.bpm).toBe(48);
    expect(meadow.breathingMode).toBe('gentle');

    // Check buildTemplateStrokes returns traversal, duration, and reverb
    const cosmicStrokes = buildTemplateStrokes('deepCosmicDrone', width, height, quantizer);
    expect(cosmicStrokes.length).toBe(4);
    expect(cosmicStrokes[0].traversal).toBe('bounce');
    expect(cosmicStrokes[0].timingMode).toBe('timer');
    expect(cosmicStrokes[0].reverb).toBe(0.35);
    expect(cosmicStrokes[2].traversal).toBe('restart');
    expect(cosmicStrokes[2].duration).toBe(38);
    expect(cosmicStrokes[2].reverb).toBe(0.55);
  });

  it('supports stroke harmonizer mode with undo/redo and preserves on export/import', () => {
    const sm = new StrokeManager();
    sm.setBpm(28);

    const spline = fitSplineFromPoints([
      { x: 100, y: 500 },
      { x: 500, y: 500 },
      { x: 900, y: 500 },
    ], 20)!;

    // Add stroke with default harmonizer
    const stroke = sm.addStroke(spline, 'solid', 'spruce', 140, quantizer, height, 0.8, '2bars', 'bounce', 50, 1.0, 'timer');
    expect(stroke.harmonizer).toBe('single');

    // Change harmonizer to triad
    sm.setStrokeHarmonizer(stroke.id, 'triad', true);
    expect(stroke.harmonizer).toBe('triad');

    // Undo change
    sm.undo();
    expect(stroke.harmonizer).toBe('single');

    // Redo change
    sm.redo();
    expect(stroke.harmonizer).toBe('triad');

    // Export and verify
    const exported = sm.exportComposition('Ethereal Haven', 'lydian', 'F2');
    expect(exported.bpm).toBe(28);
    expect(exported.strokes[0].traversal).toBe('bounce');
    expect(exported.strokes[0].duration).toBe(50);
    expect(exported.strokes[0].timingMode).toBe('timer');
    expect(exported.strokes[0].harmonizer).toBe('triad');

    // Import and verify persistence
    const sm2 = new StrokeManager();
    sm2.importComposition(exported, quantizer, height);
    expect(sm2.currentBpm).toBe(28);
    expect(sm2.activeStrokes[0].traversal).toBe('bounce');
    expect(sm2.activeStrokes[0].duration).toBe(50);
    expect(sm2.activeStrokes[0].timingMode).toBe('timer');
    expect(sm2.activeStrokes[0].harmonizer).toBe('triad');
  });

  it('calculates organic timbral breathing with macro filter sweeps, volume swells, and tape drift', () => {
    // 1. Off mode: unity multipliers and 0 detune
    const offRes = calculateBreathing('off', 10, 'stroke-1');
    expect(offRes.filterMultiplier).toBe(1.0);
    expect(offRes.volumeMultiplier).toBe(1.0);
    expect(offRes.detuneCents).toBe(0.0);

    // 2. Gentle mode: oscillating within smooth acoustic bounds
    const gentleRes1 = calculateBreathing('gentle', 0, 'stroke-1');
    expect(gentleRes1.filterMultiplier).toBeGreaterThanOrEqual(0.6);
    expect(gentleRes1.filterMultiplier).toBeLessThanOrEqual(1.4);
    expect(gentleRes1.volumeMultiplier).toBeGreaterThanOrEqual(0.8);
    expect(gentleRes1.volumeMultiplier).toBeLessThanOrEqual(1.2);
    expect(Math.abs(gentleRes1.detuneCents)).toBeLessThanOrEqual(2.5);

    // 3. Deep mode: wider overtone sweeps and dynamic swells
    const deepRes = calculateBreathing('deep', 12, 'stroke-1');
    expect(deepRes.filterMultiplier).toBeGreaterThanOrEqual(0.35);
    expect(deepRes.filterMultiplier).toBeLessThanOrEqual(1.65);
    expect(deepRes.volumeMultiplier).toBeGreaterThanOrEqual(0.7);
    expect(deepRes.volumeMultiplier).toBeLessThanOrEqual(1.3);

    // 4. Staggered phase: verify two different strokes have different phases at the exact same time
    const resA = calculateBreathing('gentle', 5.0, 'stroke-alpha-cello');
    const resB = calculateBreathing('gentle', 5.0, 'stroke-beta-flute');
    // Different stroke IDs must yield different filter/volume modulations
    expect(resA.filterMultiplier !== resB.filterMultiplier || resA.volumeMultiplier !== resB.volumeMultiplier).toBe(true);
  });

  it('manages strokeManager breathing mode with export/import persistence', () => {
    const sm = new StrokeManager();
    expect(sm.currentBreathingMode).toBe('gentle');

    sm.setBreathingMode('deep');
    expect(sm.currentBreathingMode).toBe('deep');

    const spline = fitSplineFromPoints([
      { x: 100, y: 300 },
      { x: 500, y: 300 },
      { x: 900, y: 300 },
    ], 20)!;
    sm.addStroke(spline, 'solid', 'slate', 140, quantizer, height);

    const exported = sm.exportComposition('Breathing Meditation', 'dorian', 'D3');
    expect(exported.breathingMode).toBe('deep');

    const sm2 = new StrokeManager();
    sm2.importComposition(exported, quantizer, height);
    expect(sm2.currentBreathingMode).toBe('deep');
  });
});
