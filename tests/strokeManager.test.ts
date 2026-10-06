import { describe, it, expect, vi } from 'vitest';
import { StrokeManager, getNextVersionName } from '../src/engine/strokeManager';
import { SplinePath } from '../src/math/types';
import { ScaleQuantizer } from '../src/audio/scaleQuantizer';
import { INSTRUMENTS, DEFAULT_INSTRUMENT } from '../src/audio/instruments';
import { DroneVoice, PulseVoice } from '../src/audio/synthVoice';
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

  it('supports changing individual stroke loop sync (1bar, 2bars, 4bars, 8bars, freeform) with 2bars standard default', () => {
    const sm = new StrokeManager();
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    // 2bars is now the standard default
    expect(stroke.loopQuantize).toBe('2bars');

    // Change to 8bars
    sm.setStrokeLoopQuantize(stroke.id, '8bars');
    expect(stroke.loopQuantize).toBe('8bars');

    // Change to 4bars
    sm.setStrokeLoopQuantize(stroke.id, '4bars');
    expect(stroke.loopQuantize).toBe('4bars');

    // Change to 1bar
    sm.setStrokeLoopQuantize(stroke.id, '1bar');
    expect(stroke.loopQuantize).toBe('1bar');

    // Change to freeform
    sm.setStrokeLoopQuantize(stroke.id, 'freeform');
    expect(stroke.loopQuantize).toBe('freeform');

    // Undo reverts to 1bar
    sm.undo();
    expect(stroke.loopQuantize).toBe('1bar');

    // Undo reverts to 4bars
    sm.undo();
    expect(stroke.loopQuantize).toBe('4bars');

    // Undo reverts to 8bars
    sm.undo();
    expect(stroke.loopQuantize).toBe('8bars');

    // Undo reverts to initial 2bars
    sm.undo();
    expect(stroke.loopQuantize).toBe('2bars');

    // Redo restores 8bars
    sm.redo();
    expect(stroke.loopQuantize).toBe('8bars');
  });

  it('changing default loop quantize affects only future drawn strokes without modifying existing strokes', () => {
    const sm = new StrokeManager();
    expect(sm.defaultLoopQuantizeMode).toBe('2bars');

    // Draw stroke 1 with standard default (2bars)
    const s1 = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    expect(s1.loopQuantize).toBe('2bars');

    // Change general loop sync to 8bars
    sm.setLoopQuantizeMode('8bars');
    expect(sm.defaultLoopQuantizeMode).toBe('8bars');

    // Stroke 1 MUST remain untouched at 2bars!
    expect(s1.loopQuantize).toBe('2bars');

    // Draw stroke 2 - it inherits the new general default (8bars)
    const s2 = sm.addStroke(dummyPath, 'dotted', 'amber', 100);
    expect(s2.loopQuantize).toBe('8bars');
    expect(s1.loopQuantize).toBe('2bars');
  });

  it('supports changing individual stroke traversal mode (restart vs bounce) with undo/redo', () => {
    const sm = new StrokeManager();
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    expect(stroke.traversal).toBe('restart');

    // Change to bounce
    sm.setStrokeTraversal(stroke.id, 'bounce');
    expect(stroke.traversal).toBe('bounce');

    // Undo reverts to restart
    sm.undo();
    expect(stroke.traversal).toBe('restart');

    // Redo restores bounce
    sm.redo();
    expect(stroke.traversal).toBe('bounce');
  });

  it('runs multiple strokes simultaneously with independent per-line traversal and loop sync cycles', () => {
    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer();

    // Stroke 1: 1 Bar, Restart traversal
    const s1 = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    sm.setStrokeLoopQuantize(s1.id, '1bar');
    sm.setStrokeTraversal(s1.id, 'restart');

    // Stroke 2: 2 Bars, Bounce traversal
    const s2 = sm.addStroke(dummyPath, 'solid', 'amber', 100);
    sm.setStrokeLoopQuantize(s2.id, '2bars');
    sm.setStrokeTraversal(s2.id, 'bounce');

    expect(s1.traversal).toBe('restart');
    expect(s1.loopQuantize).toBe('1bar');
    expect(s2.traversal).toBe('bounce');
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

  it('resyncAllPlayheads resets all active stroke playheads to distance 0 and direction 1', () => {
    const sm = new StrokeManager();
    const s1 = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    const s2 = sm.addStroke(dummyPath, 'dotted', 'amber', 100);

    s1.playhead.currentDistance = 45;
    s1.playhead.direction = -1;
    s2.playhead.currentDistance = 80;
    s2.playhead.direction = 1;

    sm.resyncAllPlayheads();

    expect(s1.playhead.currentDistance).toBe(0);
    expect(s1.playhead.direction).toBe(1);
    expect(s2.playhead.currentDistance).toBe(0);
    expect(s2.playhead.direction).toBe(1);
  });

  it('randomizeAllPlayheads scatters moving dots across all drawn lines within valid length bounds', () => {
    const sm = new StrokeManager();
    const s1 = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    const s2 = sm.addStroke(dummyPath, 'dotted', 'amber', 100);
    const s3 = sm.addStroke(dummyPath, 'striped', 'ruby', 100);
    sm.setStrokeTraversal(s2.id, 'bounce');
    sm.setStrokeTraversal(s3.id, 'restart');

    s1.playhead.trail = [{ x: 10, y: 20 }, { x: 30, y: 40 }];
    s2.playhead.trail = [{ x: 50, y: 60 }];

    sm.randomizeAllPlayheads();

    // Verify all playheads are within [0, totalLength]
    expect(s1.playhead.currentDistance).toBeGreaterThanOrEqual(0);
    expect(s1.playhead.currentDistance).toBeLessThanOrEqual(s1.lut.totalLength);

    expect(s2.playhead.currentDistance).toBeGreaterThanOrEqual(0);
    expect(s2.playhead.currentDistance).toBeLessThanOrEqual(s2.lut.totalLength);

    expect(s3.playhead.currentDistance).toBeGreaterThanOrEqual(0);
    expect(s3.playhead.currentDistance).toBeLessThanOrEqual(s3.lut.totalLength);

    // Verify trails are reset to prevent visual jumping streaks
    expect(s1.playhead.trail.length).toBe(0);
    expect(s2.playhead.trail.length).toBe(0);
    expect(s3.playhead.trail.length).toBe(0);

    // Verify lastEval was recalculated for the new random distance
    expect(s1.playhead.lastEval).toBeDefined();
    expect(s2.playhead.lastEval).toBeDefined();
    expect(s3.playhead.lastEval).toBeDefined();

    // Restart mode stroke direction must be 1 (forward)
    expect(s3.playhead.direction).toBe(1);

    // Bounce mode direction must be either 1 or -1
    expect([1, -1]).toContain(s2.playhead.direction);

    // Playhead finished state is cleared
    expect(s1.playhead.finished).toBe(false);
  });

  it('exports and imports compositions losslessly preserving strokes, volumes, loop sync, and wave params', () => {
    const sm = new StrokeManager();
    const s = sm.addStroke(dummyPath, 'dotted', 'amber', 100);
    sm.setStrokeVolume(s.id, 0.75);
    sm.setStrokeLoopQuantize(s.id, '2bars');
    sm.setStrokeTraversal(s.id, 'bounce');
    sm.restructureStrokeWave(s.id, 35, 2.5, 'sine');

    const exported = sm.exportComposition('Groove Alpha', 'lydian', 'A2');
    expect(exported.name).toBe('Groove Alpha');
    expect(exported.scaleId).toBe('lydian');
    expect(exported.strokes.length).toBe(1);
    expect(exported.strokes[0].volume).toBe(0.75);
    expect(exported.strokes[0].loopQuantize).toBe('2bars');
    expect(exported.strokes[0].traversal).toBe('bounce');
    expect(exported.strokes[0].waveParams?.shapeType).toBe('sine');

    // Import into a new manager
    const sm2 = new StrokeManager();
    sm2.importComposition(exported);

    expect(sm2.activeStrokes.length).toBe(1);
    const restored = sm2.activeStrokes[0];
    expect(restored.instrumentId).toBe('amber');
    expect(restored.style).toBe('dotted');
    expect(restored.volume).toBe(0.75);
    expect(restored.loopQuantize).toBe('2bars');
    expect(restored.traversal).toBe('bounce');
    expect(restored.waveParams?.shapeType).toBe('sine');
  });

  it('initializes every new stroke playhead at distance 0 matching initial pitch and point', () => {
    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer();
    // Simulate time passing in the session
    sm.update(15.0, 800, 600, quantizer);

    // Add a stroke under 2bars loop sync
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 140, quantizer, 600);

    // Starting location MUST be at the start (distance 0)
    expect(stroke.playhead.currentDistance).toBe(0);
    expect(stroke.playhead.direction).toBe(1);
    expect(stroke.playhead.lastTriggerDistance).toBe(0);
    expect(stroke.playhead.lastPitch).toBeDefined();
    expect(stroke.playhead.lastEval?.point.x).toBe(dummyPath.segments[0].p0.x);
    expect(stroke.playhead.lastEval?.point.y).toBe(dummyPath.segments[0].p0.y);
  });

  it('clearAll resets masterClockTime and resyncAllPlayheads aligns all tracks to start', () => {
    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer();
    sm.update(10.0, 800, 600, quantizer);

    sm.clearAll();
    expect(sm.clockTime).toBe(0);

    const s1 = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    const s2 = sm.addStroke(dummyPath, 'dotted', 'amber', 100);
    s1.playhead.currentDistance = 40;
    s2.playhead.currentDistance = 80;

    sm.resyncAllPlayheads();
    expect(sm.clockTime).toBe(0);
    expect(s1.playhead.currentDistance).toBe(0);
    expect(s2.playhead.currentDistance).toBe(0);
  });

  it('supports master reverb depth modification on soundEngine', () => {
    expect(() => soundEngine.setReverbMix(0.5)).not.toThrow();
    expect(() => soundEngine.setReverbMix(0)).not.toThrow();
    expect(() => soundEngine.setReverbMix(1)).not.toThrow();
  });

  it('supports octave span modifications rescaling totalNotes dynamically', () => {
    const quantizer = new ScaleQuantizer();
    const initialNotes = quantizer.totalNotes; // 4 octaves * 7 notes = 28

    quantizer.updateConfig({ octaveSpan: 2 });
    expect(quantizer.totalNotes).toBe(2 * 7); // 14 notes

    quantizer.updateConfig({ octaveSpan: 5 });
    expect(quantizer.totalNotes).toBe(5 * 7); // 35 notes

    quantizer.updateConfig({ octaveSpan: 4 });
    expect(quantizer.totalNotes).toBe(initialNotes);
  });

  it('supports setting stroke speed multiplier with clamping and undo/redo', () => {
    const sm = new StrokeManager();
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    expect(stroke.speedMultiplier).toBe(1.0);
    expect(stroke.speedMode).toBe('speed');

    sm.setStrokeSpeed(stroke.id, 2.5, true);
    expect(stroke.speedMultiplier).toBe(2.5);

    // Clamps within [0.05, 5.0]
    sm.setStrokeSpeed(stroke.id, 10.0, false);
    expect(stroke.speedMultiplier).toBe(5.0);
    sm.setStrokeSpeed(stroke.id, 0.01, false);
    expect(stroke.speedMultiplier).toBe(0.05);

    // Undo should restore back to 2.5, then 1.0
    sm.setStrokeSpeed(stroke.id, 2.5, true);
    sm.setStrokeSpeed(stroke.id, 0.5, true);
    expect(stroke.speedMultiplier).toBe(0.5);

    sm.undo();
    expect(stroke.speedMultiplier).toBe(2.5);
    sm.redo();
    expect(stroke.speedMultiplier).toBe(0.5);
  });

  it('supports toggling stroke speed mode between speed and bars with undo/redo', () => {
    const sm = new StrokeManager();
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    expect(stroke.speedMode).toBe('speed');

    sm.setStrokeSpeedMode(stroke.id, 'bars', true);
    expect(stroke.speedMode).toBe('bars');

    sm.undo();
    expect(stroke.speedMode).toBe('speed');

    sm.redo();
    expect(stroke.speedMode).toBe('bars');
  });

  it('advances playhead proportionally to speed multiplier in speed mode', () => {
    const sm = new StrokeManager();
    const stroke1 = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    const stroke2 = sm.addStroke(dummyPath, 'solid', 'amber', 100);
    const quantizer = new ScaleQuantizer();

    sm.setStrokeSpeed(stroke1.id, 1.0, false);
    sm.setStrokeSpeed(stroke2.id, 2.0, false);

    // Initial distances are 0
    expect(stroke1.playhead.currentDistance).toBe(0);
    expect(stroke2.playhead.currentDistance).toBe(0);

    // Advance 0.1 seconds (both stay well within 100px total length without wrapping)
    sm.update(0.1, 800, 600, quantizer);

    // Stroke 2 (2x speed) should have covered twice the distance of stroke 1 (1x speed)
    expect(stroke2.playhead.currentDistance).toBeCloseTo(stroke1.playhead.currentDistance * 2, 2);
    expect(stroke1.playhead.currentDistance).toBeGreaterThan(0);
  });

  it('preserves speedMultiplier and speedMode during export and import', () => {
    const sm = new StrokeManager();
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    sm.setStrokeSpeed(stroke.id, 0.75, false);
    sm.setStrokeSpeedMode(stroke.id, 'speed', false);

    const strokeBars = sm.addStroke(dummyPath, 'dotted', 'onyx', 100);
    sm.setStrokeSpeed(strokeBars.id, 2.0, false);
    sm.setStrokeSpeedMode(strokeBars.id, 'bars', false);

    const json = sm.exportComposition();
    sm.clearAll();
    expect(sm.activeStrokes.length).toBe(0);

    sm.importComposition(json);
    expect(sm.activeStrokes.length).toBe(2);

    const imported1 = sm.activeStrokes.find((s) => s.instrumentId === 'indigo');
    expect(imported1).toBeDefined();
    expect(imported1?.speedMultiplier).toBe(0.75);
    expect(imported1?.speedMode).toBe('speed');

    const imported2 = sm.activeStrokes.find((s) => s.instrumentId === 'onyx');
    expect(imported2).toBeDefined();
    expect(imported2?.speedMultiplier).toBe(2.0);
    expect(imported2?.speedMode).toBe('bars');
  });

  it('supports adjusting individual stroke reverb send level with undo and redo', () => {
    const sm = new StrokeManager();
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    expect(stroke.reverb).toBe(0.4);

    sm.setStrokeReverb(stroke.id, 0.85, true);
    expect(stroke.reverb).toBe(0.85);

    // Clamps within [0, 1]
    sm.setStrokeReverb(stroke.id, 1.5, false);
    expect(stroke.reverb).toBe(1.0);
    sm.setStrokeReverb(stroke.id, -0.2, false);
    expect(stroke.reverb).toBe(0.0);

    // Undo should restore previous values
    sm.setStrokeReverb(stroke.id, 0.75, true);
    sm.setStrokeReverb(stroke.id, 0.20, true);
    expect(stroke.reverb).toBe(0.20);

    sm.undo();
    expect(stroke.reverb).toBe(0.75);

    sm.redo();
    expect(stroke.reverb).toBe(0.20);
  });

  it('preserves individual stroke reverb during export and import', () => {
    const sm = new StrokeManager();
    const stroke1 = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    sm.setStrokeReverb(stroke1.id, 0.90, false);

    const stroke2 = sm.addStroke(dummyPath, 'dotted', 'amber', 100);
    sm.setStrokeReverb(stroke2.id, 0.15, false);

    const json = sm.exportComposition();
    sm.clearAll();
    expect(sm.activeStrokes.length).toBe(0);

    sm.importComposition(json);
    expect(sm.activeStrokes.length).toBe(2);

    const imported1 = sm.activeStrokes.find((s) => s.instrumentId === 'indigo');
    expect(imported1?.reverb).toBe(0.90);

    const imported2 = sm.activeStrokes.find((s) => s.instrumentId === 'amber');
    expect(imported2?.reverb).toBe(0.15);
  });

  it('supports adjusting individual stroke tone fluctuation with clamping, undo, and redo', () => {
    const sm = new StrokeManager();
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    expect(stroke.fluctuation).toBe(0.0);

    sm.setStrokeFluctuation(stroke.id, 0.45, true);
    expect(stroke.fluctuation).toBe(0.45);

    // Clamps within [0, 1]
    sm.setStrokeFluctuation(stroke.id, 1.8, false);
    expect(stroke.fluctuation).toBe(1.0);
    sm.setStrokeFluctuation(stroke.id, -0.5, false);
    expect(stroke.fluctuation).toBe(0.0);

    // Undo should restore previous values
    sm.setStrokeFluctuation(stroke.id, 0.60, true);
    sm.setStrokeFluctuation(stroke.id, 0.25, true);
    expect(stroke.fluctuation).toBe(0.25);

    sm.undo();
    expect(stroke.fluctuation).toBe(0.60);

    sm.redo();
    expect(stroke.fluctuation).toBe(0.25);
  });

  it('preserves individual stroke tone fluctuation during export and import', () => {
    const sm = new StrokeManager();
    const stroke1 = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    sm.setStrokeFluctuation(stroke1.id, 0.75, false);

    const stroke2 = sm.addStroke(dummyPath, 'dotted', 'amber', 100);
    sm.setStrokeFluctuation(stroke2.id, 0.30, false);

    const json = sm.exportComposition();
    sm.clearAll();
    expect(sm.activeStrokes.length).toBe(0);

    sm.importComposition(json);
    expect(sm.activeStrokes.length).toBe(2);

    const imported1 = sm.activeStrokes.find((s) => s.instrumentId === 'indigo');
    expect(imported1?.fluctuation).toBe(0.75);

    const imported2 = sm.activeStrokes.find((s) => s.instrumentId === 'amber');
    expect(imported2?.fluctuation).toBe(0.30);
  });

  it('applies tone fluctuation wander during playback update', () => {
    const sm = new StrokeManager();
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    const quantizer = new ScaleQuantizer();

    // Baseline: fluctuation = 0
    sm.update(0.1, 800, 600, quantizer);
    expect(stroke.playhead.lastEval).toBeDefined();
    expect(stroke.playhead.lastEval?.point.y).toBeCloseTo(100, 4);

    // Enable fluctuation = 0.8
    sm.setStrokeFluctuation(stroke.id, 0.8, false);
    sm.update(0.5, 800, 600, quantizer);

    // Playhead point and pitch evaluation wander within +/- 18px of baseline y=100
    const wanderedY = stroke.playhead.lastEval?.point.y;
    expect(wanderedY).toBeDefined();
    expect(wanderedY).toBeGreaterThanOrEqual(100 - 18 * 0.8 - 0.01);
    expect(wanderedY).toBeLessThanOrEqual(100 + 18 * 0.8 + 0.01);
  });

  it('applies tone fluctuation visual wander and hit scatter to dotted strokes', () => {
    const sm = new StrokeManager();
    const dottedStroke = sm.addStroke(dummyPath, 'dotted', 'amber', 100, undefined, undefined, 0.8, '2bars', 'restart', 30, 1.0, 'speed', 0.5, 0.0);
    const quantizer = new ScaleQuantizer();

    // Baseline with fluctuation = 0
    sm.update(0.1, 800, 600, quantizer);
    expect(dottedStroke.playhead.lastEval?.point.y).toBeCloseTo(100, 4);

    // Set fluctuation = 0.9
    sm.setStrokeFluctuation(dottedStroke.id, 0.9, false);
    sm.update(0.15, 800, 600, quantizer);

    // The visual playhead point should now track the fluctuating dot position
    const playheadY = dottedStroke.playhead.lastEval?.point.y;
    expect(playheadY).toBeDefined();
    expect(typeof playheadY).toBe('number');
  });

  it('supports copying, pasting, and duplicating strokes with all individual settings preserved', () => {
    const sm = new StrokeManager();
    const original = sm.addStroke(
      dummyPath,
      'dotted',
      'amber',
      120,
      undefined,
      undefined,
      0.65, // volume
      '4bars', // loopQuantize
      'bounce', // traversal
      45, // duration
      1.75, // speedMultiplier
      'speed', // speedMode
      0.80, // reverb
      0.60 // fluctuation
    );

    sm.selectStroke(original.id);
    expect(sm.selectedStrokeId).toBe(original.id);

    // Copy selected
    const copied = sm.copySelected();
    expect(copied).toBe(true);
    expect(sm.hasClipboard()).toBe(true);

    const clip = sm.getClipboard();
    expect(clip).toBeDefined();
    expect(clip?.style).toBe('dotted');
    expect(clip?.instrumentId).toBe('amber');
    expect(clip?.volume).toBe(0.65);
    expect(clip?.loopQuantize).toBe('4bars');
    expect(clip?.traversal).toBe('bounce');
    expect(clip?.duration).toBe(45);
    expect(clip?.speedMultiplier).toBe(1.75);
    expect(clip?.speedMode).toBe('speed');
    expect(clip?.reverb).toBe(0.80);
    expect(clip?.fluctuation).toBe(0.60);

    // Paste
    const pasted = sm.paste(undefined, undefined, 24);
    expect(pasted).toBeDefined();
    expect(sm.activeStrokes.length).toBe(2);
    expect(pasted?.id).not.toBe(original.id);
    expect(sm.selectedStrokeId).toBe(pasted?.id); // auto-selects pasted stroke

    // Verify all settings copied accurately
    expect(pasted?.style).toBe('dotted');
    expect(pasted?.instrumentId).toBe('amber');
    expect(pasted?.volume).toBe(0.65);
    expect(pasted?.loopQuantize).toBe('4bars');
    expect(pasted?.traversal).toBe('bounce');
    expect(pasted?.duration).toBe(45);
    expect(pasted?.speedMultiplier).toBe(1.75);
    expect(pasted?.speedMode).toBe('speed');
    expect(pasted?.reverb).toBe(0.80);
    expect(pasted?.fluctuation).toBe(0.60);

    // Check position offset (+24px)
    expect(pasted?.path.segments[0].p0.x).toBe(original.path.segments[0].p0.x + 24);
    expect(pasted?.path.segments[0].p0.y).toBe(original.path.segments[0].p0.y + 24);

    // Verify Undo removes pasted stroke
    sm.undo();
    expect(sm.activeStrokes.length).toBe(1);
    expect(sm.activeStrokes[0].id).toBe(original.id);

    // Verify Redo restores pasted stroke
    sm.redo();
    expect(sm.activeStrokes.length).toBe(2);

    // Test duplicateSelected
    sm.selectStroke(original.id);
    const duplicated = sm.duplicateSelected();
    expect(duplicated).toBeDefined();
    expect(sm.activeStrokes.length).toBe(3);
    expect(duplicated?.speedMultiplier).toBe(1.75);
    expect(duplicated?.fluctuation).toBe(0.60);
  });

  it('supports smooth dual-voice note overlap transition on DroneVoice', () => {
    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer();
    // Path passing through a note transition zone
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);

    // Initial update starts DroneVoice
    sm.update(0.1, 800, 600, quantizer);
    expect(stroke.droneVoice).toBeDefined();

    // DroneVoice update should accept dual frequencies (freq1, freq2) and blend
    const droneVoice = stroke.droneVoice!;
    expect(() => {
      droneVoice.update(100, 0, 400, 800, 'panAndTone', 1.0, 120, 0.5);
    }).not.toThrow();

    // DroneVoice updateDual should accept freqA, freqB, gainA, and gainB
    expect(() => {
      droneVoice.updateDual(100, 120, 0.7071, 0.7071, 0, 400, 800, 'panAndTone', 1.0);
    }).not.toThrow();

    // Verify quantizeContinuous provides dual notes and blend
    const pitch = quantizer.quantizeContinuous(300, 600);
    expect(pitch.freq1).toBeDefined();
    expect(pitch.freq2).toBeDefined();
    expect(pitch.freqA).toBeDefined();
    expect(pitch.freqB).toBeDefined();
    expect(pitch.gainA).toBeGreaterThanOrEqual(0);
    expect(pitch.gainB).toBeGreaterThanOrEqual(0);
    expect(pitch.gainA! ** 2 + pitch.gainB! ** 2).toBeCloseTo(1.0, 2);
    expect(pitch.blend).toBeGreaterThanOrEqual(0);
    expect(pitch.blend).toBeLessThanOrEqual(1);
  });

  it('supports changing stroke timingMode (speed vs timer) with undo and redo', () => {
    const sm = new StrokeManager();
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    expect(stroke.timingMode).toBe('speed');

    // Switch to timer
    sm.setStrokeTimingMode(stroke.id, 'timer');
    expect(stroke.timingMode).toBe('timer');

    // Undo reverts to speed
    sm.undo();
    expect(stroke.timingMode).toBe('speed');

    // Redo restores timer
    sm.redo();
    expect(stroke.timingMode).toBe('timer');
  });

  it('converts speed to duration when switching to timer and duration to speed when switching to speed', () => {
    const sm = new StrokeManager();
    sm.setBpm(120); // (120/60) * 80 = 160 px/s base speed at 1200px width
    const longPath: SplinePath = {
      segments: [
        {
          p0: { x: 0, y: 100 },
          p1: { x: 300, y: 100 },
          p2: { x: 600, y: 100 },
          p3: { x: 800, y: 100 },
        },
      ],
      isClosed: false,
    };
    const stroke = sm.addStroke(longPath, 'solid', 'indigo', 100);
    expect(stroke.timingMode).toBe('speed');
    stroke.speedMultiplier = 1.0;
    // Length is 800px. Base speed at 1200px width = 160 px/s.
    // Traversing 800px at 160 px/s takes 800 / 160 = 5 seconds.

    // Switch to timer mode: duration should become 5s
    sm.setStrokeTimingMode(stroke.id, 'timer', 1200);
    expect(stroke.timingMode).toBe('timer');
    expect(stroke.duration).toBe(5);

    // Change duration to 20s (slower traversal: 800 / 20 = 40 px/s)
    stroke.duration = 20;

    // Switch back to speed mode: velocity 40 px/s / baseSpeed 160 px/s = 0.25x speed multiplier
    sm.setStrokeTimingMode(stroke.id, 'speed', 1200);
    expect(stroke.timingMode).toBe('speed');
    expect(stroke.speedMultiplier).toBe(0.25);

    // Undo reverts to timer with duration 20s
    sm.undo();
    expect(stroke.timingMode).toBe('timer');
    expect(stroke.duration).toBe(20);

    // Redo restores speed with multiplier 0.25x
    sm.redo();
    expect(stroke.timingMode).toBe('speed');
    expect(stroke.speedMultiplier).toBe(0.25);
  });

  it('preserves pitch, stereo panning, and geometry invariants across window resizing via scaleStrokes', () => {
    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer();
    const w1 = 1000;
    const h1 = 600;

    const testPath: SplinePath = {
      segments: [
        {
          p0: { x: 200, y: 150 },
          p1: { x: 300, y: 150 },
          p2: { x: 500, y: 300 },
          p3: { x: 600, y: 300 },
        },
      ],
      isClosed: false,
    };

    const stroke = sm.addStroke(testPath, 'solid', 'spruce', 140, quantizer, h1);
    const initialPitch = quantizer.quantizeContinuous(stroke.path.segments[0].p0.y, h1);
    const initialPanRatio = stroke.path.segments[0].p0.x / w1;

    // Window resizes: 1000x600 -> 1500x900 (scaleX = 1.5, scaleY = 1.5)
    const w2 = 1500;
    const h2 = 900;
    const scaleX = w2 / w1;
    const scaleY = h2 / h1;

    sm.scaleStrokes(scaleX, scaleY);

    // Segment coordinates scaled
    expect(stroke.path.segments[0].p0.x).toBeCloseTo(300, 2);
    expect(stroke.path.segments[0].p0.y).toBeCloseTo(225, 2);

    // Stereo panning is 100% invariant
    const scaledPanRatio = stroke.path.segments[0].p0.x / w2;
    expect(scaledPanRatio).toBeCloseTo(initialPanRatio, 4);

    // Continuous pitch is 100% invariant
    const scaledPitch = quantizer.quantizeContinuous(stroke.path.segments[0].p0.y, h2);
    expect(scaledPitch.frequency).toBeCloseTo(initialPitch.frequency, 2);
    expect(scaledPitch.noteName).toBe(initialPitch.noteName);
  });

  it('scaleMelodicStrokesY guarantees pitch frequency constancy when changing octave view', () => {
    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer({ octaveSpan: 4 });
    quantizer.setScrollEnabled(true);
    const viewportHeight = 800;

    const path: SplinePath = {
      segments: [
        {
          p0: { x: 100, y: 520 },
          p1: { x: 200, y: 520 },
          p2: { x: 300, y: 520 },
          p3: { x: 400, y: 520 },
        },
      ],
      isClosed: false,
    };
    const stroke = sm.addStroke(path, 'solid', 'indigo', 100);

    const initialPitch = quantizer.quantizeContinuous(stroke.path.segments[0].p0.y, viewportHeight);

    // 1. Rescale octaveSpan from 4 to 2 (scaleFactor = 4 / 2 = 2)
    sm.scaleMelodicStrokesY(4 / 2);
    quantizer.updateConfig({ octaveSpan: 2 });
    expect(stroke.path.segments[0].p0.y).toBeCloseTo(1040, 2);

    const pitchAfter2Oct = quantizer.quantizeContinuous(stroke.path.segments[0].p0.y, viewportHeight);
    expect(pitchAfter2Oct.frequency).toBeCloseTo(initialPitch.frequency, 4);
    expect(pitchAfter2Oct.scaleDegree).toBeCloseTo(initialPitch.scaleDegree, 4);
    expect(pitchAfter2Oct.noteName).toBe(initialPitch.noteName);

    // 2. Rescale octaveSpan from 2 to 6 (scaleFactor = 2 / 6 = 1/3)
    sm.scaleMelodicStrokesY(2 / 6);
    quantizer.updateConfig({ octaveSpan: 6 });
    expect(stroke.path.segments[0].p0.y).toBeCloseTo(1040 / 3, 2);

    const pitchAfter6Oct = quantizer.quantizeContinuous(stroke.path.segments[0].p0.y, viewportHeight);
    expect(pitchAfter6Oct.frequency).toBeCloseTo(initialPitch.frequency, 4);
    expect(pitchAfter6Oct.scaleDegree).toBeCloseTo(initialPitch.scaleDegree, 4);
    expect(pitchAfter6Oct.noteName).toBe(initialPitch.noteName);
  });

  it('scaleMelodicStrokesY preserves Onyx drum machine strokes without scaling Y', () => {
    const sm = new StrokeManager();
    const drumPath: SplinePath = {
      segments: [
        {
          p0: { x: 50, y: 600 },
          p1: { x: 100, y: 600 },
          p2: { x: 150, y: 600 },
          p3: { x: 200, y: 600 },
        },
      ],
      isClosed: false,
    };
    const drumStroke = sm.addStroke(drumPath, 'solid', 'onyx', 100);

    sm.scaleMelodicStrokesY(2.0);
    expect(drumStroke.path.segments[0].p0.y).toBe(600);
    expect(drumStroke.path.segments[0].p3.y).toBe(600);
  });

  it('getNextVersionName increments version numbers and handles collisions correctly', () => {
    expect(getNextVersionName('Zen Meadow')).toBe('Zen Meadow (v2)');
    expect(getNextVersionName('Zen Meadow (v2)')).toBe('Zen Meadow (v3)');
    expect(getNextVersionName('Zen Meadow (v9)')).toBe('Zen Meadow (v10)');

    const mockSaved: any = {
      'Ambient Dawn (v2)': {},
      'Ambient Dawn (v3)': {},
    };
    expect(getNextVersionName('Ambient Dawn', mockSaved)).toBe('Ambient Dawn (v4)');
    expect(getNextVersionName('Ambient Dawn (v2)', mockSaved)).toBe('Ambient Dawn (v4)');
  });

  it('exports canvas dimensions and proportionally scales strokes upon import on different viewport widths', () => {
    const sm = new StrokeManager();
    const widePath: SplinePath = {
      segments: [
        {
          p0: { x: 100, y: 200 },
          p1: { x: 500, y: 200 },
          p2: { x: 1000, y: 200 },
          p3: { x: 1500, y: 200 },
        },
      ],
      isClosed: false,
    };
    sm.addStroke(widePath, 'solid', 'indigo', 100);

    // Exported from a 1600px wide canvas
    const exported = sm.exportComposition('Wide Viewport Preset', 'dorian', 'D3', 1600, 900);
    expect(exported.canvasWidth).toBe(1600);
    expect(exported.canvasHeight).toBe(900);

    // Import into a 1200px wide canvas (scaleX = 1200 / 1600 = 0.75)
    const sm2 = new StrokeManager();
    sm2.importComposition(exported, undefined, 900, 1200);

    expect(sm2.activeStrokes.length).toBe(1);
    const stroke = sm2.activeStrokes[0];
    expect(stroke.path.segments[0].p0.x).toBeCloseTo(75, 1);
    expect(stroke.path.segments[0].p3.x).toBeCloseTo(1125, 1);
  });

  it('safely auto-fits legacy saved presets without canvasWidth that exceed screen width', () => {
    const sm = new StrokeManager();
    // Simulate legacy saved preset from a 1920px screen loaded on a 1000px screen
    const legacyComp = {
      version: 1 as const,
      name: 'Legacy Preset',
      timestamp: Date.now(),
      bpm: 80,
      strokes: [
        {
          id: 's1',
          instrumentId: 'indigo',
          style: 'solid' as const,
          path: {
            segments: [
              {
                p0: { x: 100, y: 200 },
                p1: { x: 500, y: 200 },
                p2: { x: 1000, y: 200 },
                p3: { x: 1400, y: 200 }, // 1400 > 1000 * 0.88 (880)
              },
            ],
            isClosed: false,
          },
        },
      ],
    };

    sm.importComposition(legacyComp, undefined, 700, 1000);
    expect(sm.activeStrokes.length).toBe(1);
    const stroke = sm.activeStrokes[0];
    // Max x should be scaled to canvasWidth * 0.86 = 860
    expect(stroke.path.segments[0].p3.x).toBeCloseTo(860, 1);
    expect(stroke.path.segments[0].p0.x).toBeLessThan(stroke.path.segments[0].p3.x);
  });

  it('triggers PulseVoice for dotted strokes in live playback without past timestamp scheduling', () => {
    const sm = new StrokeManager();
    sm.addStroke(dummyPath, 'dotted', 'amber', 100);
    const quantizer = new ScaleQuantizer();

    let triggerCalled = false;
    let receivedBaseTime: number | undefined = 999;
    const origTrigger = PulseVoice.trigger;
    PulseVoice.trigger = (
      _freq,
      _isStriped,
      _velocity,
      _instrument,
      _x,
      _canvasWidth,
      _xModMode,
      _timeOffset,
      _reverb,
      _filterMult,
      _volumeMult,
      _engine,
      baseTime
    ) => {
      triggerCalled = true;
      receivedBaseTime = baseTime;
    };

    try {
      // Advance by sufficient dt to cross a dot boundary
      sm.update(0.5, 800, 600, quantizer); // live play (scheduledTime is undefined)
      expect(triggerCalled).toBe(true);
      // In live play, baseTime passed to PulseVoice MUST be undefined so Web Audio uses live ctx.currentTime
      expect(receivedBaseTime).toBeUndefined();
    } finally {
      PulseVoice.trigger = origTrigger;
    }
  });

  it('clamps PulseVoice note scheduling to at least ctx.currentTime preventing past node termination', () => {
    let startedAt = 0;
    const mockCtx = {
      currentTime: 10.0,
      sampleRate: 44100,
      createOscillator: () => ({
        type: 'sine',
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: (t: number) => { startedAt = t; },
        stop: vi.fn(),
      }),
      createGain: () => ({
        gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      }),
      createBiquadFilter: () => ({
        type: 'lowpass',
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        Q: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
      }),
      createStereoPanner: () => ({
        pan: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
      }),
    };
    const mockEngine = {
      isReady: true,
      context: mockCtx as any,
      connectVoice: vi.fn(),
    } as any;

    PulseVoice.trigger(440, false, 0.8, DEFAULT_INSTRUMENT, 0, 800, 'panAndTone', 0, 0.4, 1.0, 1.0, mockEngine, 2.0);
    // Should be clamped to mockCtx.currentTime = 10.0, NOT scheduled in the past at 2.0
    expect(startedAt).toBeGreaterThanOrEqual(10.0);
  });

  it('restores xAxisModulationMode, defaultHarmonizer, and breathingMode across preset export and import', () => {
    const sm = new StrokeManager();
    sm.addStroke(dummyPath, 'solid', 'indigo', 100);

    // 1. Set X-Axis Modulation to spaceDepth (Reverb Space Depth)
    sm.setXAxisModulationMode('spaceDepth');
    sm.setBreathingMode('deep');
    sm.setDefaultStrokeHarmonizer('dualOctave');

    // 2. Export preset
    const preset = sm.exportComposition('Ethereal Horizon', 'lydian', 'D3');
    expect(preset.xAxisModulationMode).toBe('spaceDepth');
    expect(preset.breathingMode).toBe('deep');
    expect(preset.defaultHarmonizer).toBe('dualOctave');

    // 3. Change current setting to none / defaults
    sm.setXAxisModulationMode('none');
    sm.setBreathingMode('off');
    sm.setDefaultStrokeHarmonizer('single');
    expect(sm.xAxisModulationMode).toBe('none');
    expect(sm.currentBreathingMode).toBe('off');
    expect(sm.defaultStrokeHarmonizer).toBe('single');

    // 4. Reload saved preset into manager
    sm.importComposition(preset);

    // 5. Verify restored state
    expect(sm.xAxisModulationMode).toBe('spaceDepth');
    expect(sm.currentBreathingMode).toBe('deep');
    expect(sm.defaultStrokeHarmonizer).toBe('dualOctave');
  });

  it('supports setStrokeMuted to cleanly mute and unmute individual strokes', () => {
    const sm = new StrokeManager();
    const s1 = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    const s2 = sm.addStroke(dummyPath, 'dotted', 'amber', 100);

    sm.setStrokeMuted(s1.id, true);
    expect(s1.muted).toBe(true);
    expect(s2.muted).toBe(false);

    sm.setStrokeMuted(s1.id, false);
    expect(s1.muted).toBe(false);
  });
});


