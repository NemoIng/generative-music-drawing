import { describe, it, expect } from 'vitest';
import { StrokeManager } from '../src/engine/strokeManager';
import { SplinePath } from '../src/math/types';
import { ScaleQuantizer } from '../src/audio/scaleQuantizer';
import { INSTRUMENTS } from '../src/audio/instruments';

describe('StrokeManager Features: Traversal Mode, Edit Translation, Revoicing, and Undo/Redo', () => {
  const dummyPath: SplinePath = {
    segments: [
      {
        p0: { x: 0, y: 100 },
        p1: { x: 50, y: 100 },
        p2: { x: 50, y: 100 },
        p3: { x: 100, y: 100 },
      },
    ],
    isClosed: false,
  };

  it('handles restart traversal mode (one-way journeys start to end then restarts)', () => {
    const sm = new StrokeManager();
    sm.setTraversalMode('restart');
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    const quantizer = new ScaleQuantizer();

    // With L = 100, dt = 1.5s at 100 BPM: speed = 133.33 px/s, distance advances past 100
    sm.update(1.5, 800, 600, quantizer);

    // In restart mode, playhead should wrap (modulo L) rather than bouncing negative
    expect(stroke.playhead.currentDistance).toBeLessThan(stroke.lut.totalLength);
    expect(stroke.playhead.direction).toBe(1); // Always moves forward
  });

  it('supports translating a stroke in edit mode', () => {
    const sm = new StrokeManager();
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);

    const initialX = stroke.path.segments[0].p0.x;
    const initialY = stroke.path.segments[0].p0.y;

    sm.translateStroke(stroke.id, 40, -30, true);

    expect(stroke.path.segments[0].p0.x).toBe(initialX + 40);
    expect(stroke.path.segments[0].p0.y).toBe(initialY - 30);

    // Test undoing the move
    sm.undo();
    expect(stroke.path.segments[0].p0.x).toBe(initialX);
    expect(stroke.path.segments[0].p0.y).toBe(initialY);
  });

  it('supports undoing and redoing newly added strokes', () => {
    const sm = new StrokeManager();
    expect(sm.activeStrokes.length).toBe(0);

    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    expect(sm.activeStrokes.length).toBe(1);

    sm.undo();
    expect(sm.activeStrokes.length).toBe(0);

    sm.redo();
    expect(sm.activeStrokes.length).toBe(1);
    expect(sm.activeStrokes[0].id).toBe(stroke.id);
  });

  it('supports re-voicing a stroke and undoing the re-voice', () => {
    const sm = new StrokeManager();
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);

    expect(stroke.instrumentId).toBe('indigo');
    expect(stroke.color).toBe(INSTRUMENTS.indigo.color);

    // Re-voice to amber
    sm.revoiceStroke(stroke.id, 'amber');
    expect(stroke.instrumentId).toBe('amber');
    expect(stroke.color).toBe(INSTRUMENTS.amber.color);

    // Undo should revert back to indigo
    sm.undo();
    expect(stroke.instrumentId).toBe('indigo');
    expect(stroke.color).toBe(INSTRUMENTS.indigo.color);

    // Redo should apply amber again
    sm.redo();
    expect(stroke.instrumentId).toBe('amber');
  });

  it('calculates stereo pan from horizontal coordinate', () => {
    const canvasWidth = 1000;
    const normXLeft = 0 / canvasWidth;
    const panLeft = Math.max(-1, Math.min(1, 2 * normXLeft - 1));
    expect(panLeft).toBe(-1.0);

    const normXCenter = 500 / canvasWidth;
    const panCenter = Math.max(-1, Math.min(1, 2 * normXCenter - 1));
    expect(panCenter).toBe(0.0);

    const normXRight = 1000 / canvasWidth;
    const panRight = Math.max(-1, Math.min(1, 2 * normXRight - 1));
    expect(panRight).toBe(1.0);
  });

  it('supports muting and soloing individual tracks', () => {
    const sm = new StrokeManager();
    const s1 = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    const s2 = sm.addStroke(dummyPath, 'dotted', 'amber', 100);

    expect(sm.isStrokeAudible(s1)).toBe(true);
    expect(sm.isStrokeAudible(s2)).toBe(true);

    // Mute s1
    sm.toggleMute(s1.id);
    expect(sm.isStrokeAudible(s1)).toBe(false);
    expect(sm.isStrokeAudible(s2)).toBe(true);

    // Unmute s1
    sm.toggleMute(s1.id);
    expect(sm.isStrokeAudible(s1)).toBe(true);

    // Solo s2
    sm.toggleSolo(s2.id);
    expect(sm.isStrokeAudible(s1)).toBe(false); // silenced because s2 is soloed
    expect(sm.isStrokeAudible(s2)).toBe(true);

    // Unsolo s2
    sm.toggleSolo(s2.id);
    expect(sm.isStrokeAudible(s1)).toBe(true);
    expect(sm.isStrokeAudible(s2)).toBe(true);
  });

  it('tracks musical measure progress and beat indices', () => {
    const sm = new StrokeManager();
    sm.setBpm(120); // 2 beats per second
    const quantizer = new ScaleQuantizer();

    // 0.5 seconds = 1.0 beat
    sm.update(0.5, 800, 600, quantizer);
    expect(sm.currentBeat).toBeCloseTo(1.0, 2);
    expect(sm.measureBeatIndex).toBe(1);
    expect(sm.measureProgress).toBeCloseTo(0.25, 2);

    // 1.5 seconds more = 3.0 beats elapsed total = 4 beats total (complete measure)
    sm.update(1.5, 800, 600, quantizer);
    expect(sm.currentBeat).toBeCloseTo(4.0, 2);
    expect(sm.measureBeatIndex).toBe(0);
    expect(sm.measureProgress).toBeCloseTo(0.0, 2);
  });

  it('supports controlling individual stroke volume with clamping and undo/redo', () => {
    const sm = new StrokeManager();
    const s1 = sm.addStroke(dummyPath, 'solid', 'indigo', 100);

    expect(s1.volume).toBe(1.0);

    // Set volume to 0.45
    sm.setStrokeVolume(s1.id, 0.45);
    expect(s1.volume).toBeCloseTo(0.45, 2);

    // Clamps within [0, 1]
    sm.setStrokeVolume(s1.id, 1.5);
    expect(s1.volume).toBe(1.0);

    sm.setStrokeVolume(s1.id, -0.2);
    expect(s1.volume).toBe(0.0);

    // Undo reverts to 1.0
    sm.undo();
    expect(s1.volume).toBe(1.0);

    // Redo restores 0.0
    sm.redo();
    expect(s1.volume).toBe(0.0);
  });

  it('supports restructuring a stroke into a smooth sine wave with amplitude, period, and undo/redo', () => {
    const sm = new StrokeManager();
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);

    const initialLength = stroke.lut.totalLength;
    expect(initialLength).toBeCloseTo(100, 1);

    // Restructure into sine wave with Amp=30, Periods=2
    sm.restructureStrokeWave(stroke.id, 30, 2);
    expect(stroke.waveParams).toBeDefined();
    expect(stroke.waveParams?.amplitude).toBe(30);
    expect(stroke.waveParams?.periods).toBe(2);
    // Arc length should increase due to sinusoidal undulations
    expect(stroke.lut.totalLength).toBeGreaterThan(initialLength);

    // Flatten back to straight line with Amp=0
    sm.restructureStrokeWave(stroke.id, 0, 2);
    expect(stroke.waveParams?.amplitude).toBe(0);
    expect(stroke.lut.totalLength).toBeCloseTo(100, 1);

    // Undo reverts back to Amp=30 wave
    sm.undo();
    expect(stroke.waveParams?.amplitude).toBe(30);

    // Undo again reverts back to initial dummyPath
    sm.undo();
    expect(stroke.waveParams).toBeUndefined();
    expect(stroke.lut.totalLength).toBeCloseTo(initialLength, 1);

    // Redo brings back the wave
    sm.redo();
    expect(stroke.waveParams?.amplitude).toBe(30);
  });
});
