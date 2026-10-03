import { describe, it, expect, vi } from 'vitest';
import { StrokeManager } from '../src/engine/strokeManager';
import { SplinePath } from '../src/math/types';
import { ScaleQuantizer } from '../src/audio/scaleQuantizer';
import { INSTRUMENTS } from '../src/audio/instruments';
import { DroneVoice } from '../src/audio/synthVoice';
import { soundEngine } from '../src/audio/audioContext';

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

    expect(sm.hasSoloedStrokes).toBe(false);
    // Solo s2
    sm.toggleSolo(s2.id);
    expect(sm.hasSoloedStrokes).toBe(true);
    expect(sm.isStrokeAudible(s1)).toBe(false); // silenced because s2 is soloed
    expect(sm.isStrokeAudible(s2)).toBe(true);

    // Unsolo s2
    sm.toggleSolo(s2.id);
    expect(sm.hasSoloedStrokes).toBe(false);
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

  it('supports changing individual stroke texture/style with undo/redo', () => {
    const sm = new StrokeManager();
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    expect(stroke.style).toBe('solid');

    // Change to dotted
    sm.setStrokeStyle(stroke.id, 'dotted');
    expect(stroke.style).toBe('dotted');
    expect(stroke.droneVoice).toBeNull();

    // Change to striped
    sm.setStrokeStyle(stroke.id, 'striped');
    expect(stroke.style).toBe('striped');

    // Undo reverts to dotted
    sm.undo();
    expect(stroke.style).toBe('dotted');

    // Undo reverts to solid
    sm.undo();
    expect(stroke.style).toBe('solid');

    // Redo restores dotted
    sm.redo();
    expect(stroke.style).toBe('dotted');
  });

  it('supports changing individual stroke loop sync (1bar, 2bars, 4bars, freeform) with undo/redo', () => {
    const sm = new StrokeManager();
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    expect(stroke.loopQuantize).toBe('1bar');

    // Change to 2bars
    sm.setStrokeLoopQuantize(stroke.id, '2bars');
    expect(stroke.loopQuantize).toBe('2bars');

    // Change to freeform
    sm.setStrokeLoopQuantize(stroke.id, 'freeform');
    expect(stroke.loopQuantize).toBe('freeform');

    // Undo reverts to 2bars
    sm.undo();
    expect(stroke.loopQuantize).toBe('2bars');

    // Undo reverts to 1bar
    sm.undo();
    expect(stroke.loopQuantize).toBe('1bar');

    // Redo restores 2bars
    sm.redo();
    expect(stroke.loopQuantize).toBe('2bars');
  });

  it('supports changing individual stroke traversal mode (restart vs pingpong) with undo/redo', () => {
    const sm = new StrokeManager();
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    expect(stroke.traversal).toBe('restart');

    // Change to pingpong
    sm.setStrokeTraversal(stroke.id, 'pingpong');
    expect(stroke.traversal).toBe('pingpong');

    // Undo reverts to restart
    sm.undo();
    expect(stroke.traversal).toBe('restart');

    // Redo restores pingpong
    sm.redo();
    expect(stroke.traversal).toBe('pingpong');
  });

  it('runs multiple strokes simultaneously with independent per-line traversal and loop sync cycles', () => {
    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer();

    // Stroke 1: 1 Bar, Restart traversal
    const s1 = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    sm.setStrokeLoopQuantize(s1.id, '1bar');
    sm.setStrokeTraversal(s1.id, 'restart');

    // Stroke 2: 2 Bars, Ping-Pong traversal
    const s2 = sm.addStroke(dummyPath, 'solid', 'amber', 100);
    sm.setStrokeLoopQuantize(s2.id, '2bars');
    sm.setStrokeTraversal(s2.id, 'pingpong');

    expect(s1.traversal).toBe('restart');
    expect(s1.loopQuantize).toBe('1bar');
    expect(s2.traversal).toBe('pingpong');
    expect(s2.loopQuantize).toBe('2bars');

    // With L = 100, dt = 1.8s at 100 BPM:
    // beatDuration = 60 / 100 = 0.6s
    // s1 (1bar Restart): cycleDist = 100, cycleDuration = 2.4s -> speed = 100 / 2.4 = 41.67 px/s
    // s2 (2bars PingPong): cycleDist = 200, cycleDuration = 4.8s -> speed = 200 / 4.8 = 41.67 px/s
    // Now let's test a larger dt so playhead reaches boundary and crosses it
    s1.playhead.currentDistance = 90;
    s1.playhead.direction = 1;

    s2.playhead.currentDistance = 90;
    s2.playhead.direction = 1;

    // dt = 0.5s: deltaDist = 41.67 * 0.5 = ~20.8px
    // nextDist before wrap = 110.8px (> 100)
    sm.update(0.5, 800, 600, quantizer);

    // Stroke 1 (Restart) wraps forward around 0 and stays direction = 1
    expect(s1.playhead.currentDistance).toBeLessThan(100);
    expect(s1.playhead.direction).toBe(1);

    // Stroke 2 (Ping-Pong) bounces backward at 100 and reverses direction to -1
    expect(s2.playhead.currentDistance).toBeLessThan(100);
    expect(s2.playhead.direction).toBe(-1);
  });

  it('correctly stops and restores drone voices when toggling solo on and off without permanent silencing', () => {
    vi.spyOn(soundEngine, 'isReady', 'get').mockReturnValue(true);

    vi.spyOn(DroneVoice.prototype, 'start').mockImplementation(function (this: any) {
      (this as any)._isPlaying = true;
    });
    vi.spyOn(DroneVoice.prototype, 'stop').mockImplementation(function (this: any) {
      (this as any)._isPlaying = false;
    });
    vi.spyOn(DroneVoice.prototype, 'update').mockImplementation(function () {});

    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer();
    const s1 = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    const s2 = sm.addStroke(dummyPath, 'solid', 'amber', 100);

    // Initial update starts drone voices for audible strokes
    sm.update(0.016, 800, 600, quantizer);
    expect(s1.droneVoice).not.toBeNull();
    expect(s2.droneVoice).not.toBeNull();
    expect(s1.droneVoice?.isPlaying).toBe(true);
    expect(s2.droneVoice?.isPlaying).toBe(true);

    // Solo stroke 1: stroke 2 must be stopped and nulled
    sm.toggleSolo(s1.id);
    expect(sm.isStrokeAudible(s1)).toBe(true);
    expect(sm.isStrokeAudible(s2)).toBe(false);
    expect(s2.droneVoice).toBeNull();

    // Run update loop while stroke 1 is soloed
    sm.update(0.016, 800, 600, quantizer);
    expect(s2.droneVoice).toBeNull();

    // Now unsolo stroke 1: stroke 2 MUST resume playing
    sm.toggleSolo(s1.id);
    expect(sm.isStrokeAudible(s1)).toBe(true);
    expect(sm.isStrokeAudible(s2)).toBe(true);
    expect(s2.droneVoice).not.toBeNull();
    expect(s2.droneVoice?.isPlaying).toBe(true);

    // Run update loop frame after unsolo
    sm.update(0.016, 800, 600, quantizer);
    expect(s1.droneVoice?.isPlaying).toBe(true);
    expect(s2.droneVoice?.isPlaying).toBe(true);
  });

  it('accurately hit-tests the closest stroke with continuous segment projection', () => {
    const sm = new StrokeManager();
    const s1 = sm.addStroke(dummyPath, 'solid', 'indigo', 100); // dummyPath at y = 100 from x=0 to 100

    const path2: SplinePath = {
      segments: [
        {
          p0: { x: 0, y: 130 },
          p1: { x: 50, y: 130 },
          p2: { x: 50, y: 130 },
          p3: { x: 100, y: 130 },
        },
      ],
      isClosed: false,
    };
    const s2 = sm.addStroke(path2, 'solid', 'amber', 100);

    // Clicking at (50, 105) is 5px from s1 and 25px from s2 -> hits s1
    const hit1 = sm.hitTest({ x: 50, y: 105 }, 24);
    expect(hit1?.id).toBe(s1.id);

    // Clicking at (50, 125) is 5px from s2 and 25px from s1 -> hits s2
    const hit2 = sm.hitTest({ x: 50, y: 125 }, 24);
    expect(hit2?.id).toBe(s2.id);

    // Clicking far away at (50, 200) -> misses both
    const hitMiss = sm.hitTest({ x: 50, y: 200 }, 24);
    expect(hitMiss).toBeNull();
  });

  it('supports restructuring a stroke into tangent and other wave shapes with undo/redo', () => {
    const sm = new StrokeManager();
    const s = sm.addStroke(dummyPath, 'solid', 'indigo', 100);

    sm.restructureStrokeWave(s.id, 40, 2, 'tangent');
    expect(s.waveParams?.shapeType).toBe('tangent');
    expect(s.waveParams?.amplitude).toBe(40);

    sm.restructureStrokeWave(s.id, 30, 3, 'triangle');
    expect(s.waveParams?.shapeType).toBe('triangle');
    expect(s.waveParams?.amplitude).toBe(30);

    sm.undo();
    expect(s.waveParams?.shapeType).toBe('tangent');
    expect(s.waveParams?.amplitude).toBe(40);

    sm.redo();
    expect(s.waveParams?.shapeType).toBe('triangle');
    expect(s.waveParams?.amplitude).toBe(30);
  });

  it('supports setting xAxisModulationMode to none for centered, neutral sound without effects', () => {
    const sm = new StrokeManager();
    expect(sm.xAxisModulationMode).toBe('panAndTone');

    sm.setXAxisModulationMode('none');
    expect(sm.xAxisModulationMode).toBe('none');
  });
});

