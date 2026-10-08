import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InputHandler } from '../src/canvas/inputHandler';
import { StrokeManager } from '../src/engine/strokeManager';
import { ScaleQuantizer } from '../src/audio/scaleQuantizer';
import { soundEngine } from '../src/audio/audioContext';
import { SplinePath } from '../src/math/types';
import { PulseVoice } from '../src/audio/synthVoice';
import { DrumSynth } from '../src/audio/drumSynth';

describe('Unified InputHandler Interaction Model', () => {
  let listeners: Record<string, Function[]> = {};
  let windowListeners: Record<string, Function[]> = {};
  let mockCanvas: any;

  beforeEach(() => {
    listeners = {};
    windowListeners = {};

    mockCanvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      addEventListener: (type: string, fn: Function) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      removeEventListener: (type: string, fn: Function) => {
        if (listeners[type]) {
          listeners[type] = listeners[type].filter((f) => f !== fn);
        }
      },
      style: { cursor: 'default' },
    };

    (globalThis as any).window = {
      addEventListener: (type: string, fn: Function) => {
        windowListeners[type] = windowListeners[type] || [];
        windowListeners[type].push(fn);
      },
      removeEventListener: (type: string, fn: Function) => {
        if (windowListeners[type]) {
          windowListeners[type] = windowListeners[type].filter((f) => f !== fn);
        }
      },
    };

    vi.spyOn(soundEngine, 'isReady', 'get').mockReturnValue(true);
  });

  const dummyPath: SplinePath = {
    segments: [
      {
        p0: { x: 50, y: 100 },
        p1: { x: 100, y: 100 },
        p2: { x: 150, y: 100 },
        p3: { x: 200, y: 100 },
      },
    ],
    isClosed: false,
  };

  it('selects stroke immediately upon clicking it without needing edit mode', async () => {
    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer();
    const stroke1 = sm.addStroke(dummyPath, 'solid', 'indigo', 100);

    const onSelectStroke = vi.fn();
    const handler = new InputHandler(mockCanvas, {
      strokeManager: sm,
      getQuantizer: () => quantizer,
      onStrokeComplete: vi.fn(),
      onSelectStroke,
    });

    // Pointer down directly on stroke (x: 100, y: 100 is on the line)
    const pointerDown = listeners['pointerdown'][0];
    await pointerDown({ clientX: 100, clientY: 100, button: 0 } as any);

    expect(sm.selectedStrokeId).toBe(stroke1.id);
    expect(onSelectStroke).toHaveBeenCalledWith(stroke1.id);
    expect(mockCanvas.style.cursor).toBe('grab');
    expect(handler.currentMode).toBe('edit');

    // Pointer up keeps the line selected
    const pointerUp = windowListeners['pointerup'][0];
    pointerUp();
    expect(sm.selectedStrokeId).toBe(stroke1.id);
    expect(mockCanvas.style.cursor).toBe('pointer');

    handler.destroy();
  });

  it('switches selection directly to another stroke in a single click', async () => {
    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer();
    const stroke1 = sm.addStroke(dummyPath, 'solid', 'indigo', 100);

    const path2: SplinePath = {
      segments: [
        {
          p0: { x: 50, y: 250 },
          p1: { x: 100, y: 250 },
          p2: { x: 150, y: 250 },
          p3: { x: 200, y: 250 },
        },
      ],
      isClosed: false,
    };
    const stroke2 = sm.addStroke(path2, 'solid', 'amber', 100);

    // Initial state: stroke1 is selected
    sm.selectStroke(stroke1.id);

    const onSelectStroke = vi.fn();
    const handler = new InputHandler(mockCanvas, {
      strokeManager: sm,
      getQuantizer: () => quantizer,
      onStrokeComplete: vi.fn(),
      onSelectStroke,
    });

    const pointerDown = listeners['pointerdown'][0];
    const pointerUp = windowListeners['pointerup'][0];

    // Single click on stroke2 (x: 100, y: 250)
    await pointerDown({ clientX: 100, clientY: 250, button: 0 } as any);
    pointerUp();

    expect(sm.selectedStrokeId).toBe(stroke2.id);
    expect(onSelectStroke).toHaveBeenCalledWith(stroke2.id);

    handler.destroy();
  });

  it('deselects selected stroke on tapping empty canvas', async () => {
    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer();
    const stroke1 = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    sm.selectStroke(stroke1.id);

    const onSelectStroke = vi.fn();
    const handler = new InputHandler(mockCanvas, {
      strokeManager: sm,
      getQuantizer: () => quantizer,
      onStrokeComplete: vi.fn(),
      onSelectStroke,
    });

    const pointerDown = listeners['pointerdown'][0];
    const pointerUp = windowListeners['pointerup'][0];

    // Tap on empty space (x: 400, y: 400)
    await pointerDown({ clientX: 400, clientY: 400, button: 0 } as any);
    pointerUp();

    expect(sm.selectedStrokeId).toBeNull();
    expect(onSelectStroke).toHaveBeenCalledWith(null);
    expect(handler.currentMode).toBe('draw');

    handler.destroy();
  });

  it('translates a stroke when dragging it beyond threshold', async () => {
    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer();
    const stroke1 = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    const initialX = stroke1.path.segments[0].p0.x;

    const handler = new InputHandler(mockCanvas, {
      strokeManager: sm,
      getQuantizer: () => quantizer,
      onStrokeComplete: vi.fn(),
    });

    const pointerDown = listeners['pointerdown'][0];
    const pointerMove = windowListeners['pointermove'][0];
    const pointerUp = windowListeners['pointerup'][0];

    // Click on stroke
    await pointerDown({ clientX: 100, clientY: 100, button: 0 } as any);

    // Drag by 20px horizontally
    pointerMove({ clientX: 120, clientY: 100 } as any);
    expect(mockCanvas.style.cursor).toBe('grabbing');

    // Release
    pointerUp();
    expect(stroke1.path.segments[0].p0.x).toBe(initialX + 20);

    handler.destroy();
  });

  it('updates cursor to pointer when hovering over a stroke and crosshair when hovering empty space', () => {
    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer();
    sm.addStroke(dummyPath, 'solid', 'indigo', 100);

    const handler = new InputHandler(mockCanvas, {
      strokeManager: sm,
      getQuantizer: () => quantizer,
      onStrokeComplete: vi.fn(),
    });

    const pointerMove = windowListeners['pointermove'][0];

    // Hover over stroke (x: 100, y: 100)
    pointerMove({ clientX: 100, clientY: 100 } as any);
    expect(mockCanvas.style.cursor).toBe('pointer');

    // Hover over empty canvas (x: 400, y: 400)
    pointerMove({ clientX: 400, clientY: 400 } as any);
    expect(mockCanvas.style.cursor).toBe('crosshair');

    handler.destroy();
  });

  it('draws a new stroke when dragging on empty canvas and completes spline', async () => {
    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer();
    const onStrokeComplete = vi.fn();

    const handler = new InputHandler(mockCanvas, {
      strokeManager: sm,
      getQuantizer: () => quantizer,
      onStrokeComplete,
    });

    const pointerDown = listeners['pointerdown'][0];
    const pointerMove = windowListeners['pointermove'][0];
    const pointerUp = windowListeners['pointerup'][0];

    // Start drawing at empty canvas
    await pointerDown({ clientX: 300, clientY: 300, button: 0 } as any);
    pointerMove({ clientX: 350, clientY: 310 } as any);
    pointerMove({ clientX: 400, clientY: 320 } as any);
    pointerUp();

    expect(onStrokeComplete).toHaveBeenCalled();
    handler.destroy();
  });

  describe('Live Play Mode (Instant Note Playback & Disappearing Trail)', () => {
    it('initializes in draw mode and switches to live mode cleanly', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const onSelectStroke = vi.fn();

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        onStrokeComplete: vi.fn(),
        onSelectStroke,
      });

      expect(handler.appMode).toBe('draw');

      handler.setAppMode('live');
      expect(handler.appMode).toBe('live');
      expect(onSelectStroke).toHaveBeenCalledWith(null);

      handler.destroy();
    });

    it('in live mode, pointer down and drag record trail points and do not create permanent strokes', async () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const onStrokeComplete = vi.fn();

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        getCurrentInstrument: () => 'indigo',
        getCurrentStyle: () => 'solid',
        onStrokeComplete,
      });

      handler.setAppMode('live');

      const pointerDown = listeners['pointerdown'][0];
      const pointerMove = windowListeners['pointermove'][0];
      const pointerUp = windowListeners['pointerup'][0];

      // Pointer down at (200, 300)
      await pointerDown({ clientX: 200, clientY: 300, button: 0 } as any);
      expect(handler.liveTrail.length).toBe(1);
      expect(handler.liveTrail[0].screenX).toBe(200);
      expect(handler.liveTrail[0].screenY).toBe(300);
      expect(handler.liveTrail[0].noteName).toBeDefined();

      // Drag to (250, 320)
      pointerMove({ clientX: 250, clientY: 320 } as any);
      expect(handler.liveTrail.length).toBe(2);

      // Drag to (300, 340)
      pointerMove({ clientX: 300, clientY: 340 } as any);
      expect(handler.liveTrail.length).toBe(3);

      // Pointer up
      pointerUp();

      // Crucial: no permanent stroke created!
      expect(onStrokeComplete).not.toHaveBeenCalled();
      expect(sm.activeStrokes.length).toBe(0);

      handler.destroy();
    });

    it('triggers PulseVoice with standard 50% reverb for dotted texture in live mode', async () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const pulseSpy = vi.spyOn(PulseVoice, 'trigger').mockImplementation(() => {});

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        getCurrentInstrument: () => 'amber',
        getCurrentStyle: () => 'dotted',
        onStrokeComplete: vi.fn(),
      });

      handler.setAppMode('live');

      const pointerDown = listeners['pointerdown'][0];
      await pointerDown({ clientX: 250, clientY: 250, button: 0 } as any);

      // Verify PulseVoice.trigger was called with reverb = 0.50 (50%)
      expect(pulseSpy).toHaveBeenCalled();
      const lastCall = pulseSpy.mock.calls[0];
      const reverbArg = lastCall[8]; // 9th argument is reverb
      expect(reverbArg).toBe(0.50);

      pulseSpy.mockRestore();
      handler.destroy();
    });

    it('triggers DrumSynth with standard 50% reverb for Onyx in live mode', async () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const kickSpy = vi.spyOn(DrumSynth, 'triggerKick').mockImplementation(() => {});
      const snareSpy = vi.spyOn(DrumSynth, 'triggerSnare').mockImplementation(() => {});

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        getCurrentInstrument: () => 'onyx',
        getCurrentStyle: () => 'solid',
        onStrokeComplete: vi.fn(),
      });

      handler.setAppMode('live');

      const pointerDown = listeners['pointerdown'][0];

      // Click in Kick zone (bottom of 600px height: y = 500)
      await pointerDown({ clientX: 200, clientY: 500, button: 0 } as any);
      expect(kickSpy).toHaveBeenCalled();
      const kickReverb = kickSpy.mock.calls[0][5]; // 6th argument is reverb
      expect(kickReverb).toBe(0.50);

      // Click in Snare zone (mid height: y = 330)
      await pointerDown({ clientX: 200, clientY: 330, button: 0 } as any);
      expect(snareSpy).toHaveBeenCalled();
      const snareReverb = snareSpy.mock.calls[0][5];
      expect(snareReverb).toBe(0.50);

      kickSpy.mockRestore();
      snareSpy.mockRestore();
      handler.destroy();
    });

    it('prunes trail points older than maxLifetimeMs', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        onStrokeComplete: vi.fn(),
      });

      handler.setAppMode('live');

      const now = 10000;
      // Manually simulate points at different timestamps
      (handler as any).liveTrailPoints = [
        { screenX: 10, screenY: 10, time: now - 1500 }, // 1.5s old (expired)
        { screenX: 20, screenY: 20, time: now - 800 },  // 800ms old (valid)
        { screenX: 30, screenY: 30, time: now - 100 },  // 100ms old (valid)
      ];

      handler.pruneLiveTrail(now, 1000);
      expect(handler.liveTrail.length).toBe(2);
      expect(handler.liveTrail[0].screenX).toBe(20);
      expect(handler.liveTrail[1].screenX).toBe(30);

      handler.clearLiveTrail();
      expect(handler.liveTrail.length).toBe(0);

      handler.destroy();
    });

    it('allows configuring live reverb, volume, release time, trail lifetime, and scale lock', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        onStrokeComplete: vi.fn(),
      });

      // Default values
      expect(handler.liveReverbSend).toBe(0.50);
      expect(handler.liveVolumeLevel).toBe(0.90);
      expect(handler.liveRelease).toBe(0.40);
      expect(handler.liveTrailLifetime).toBe(1000);
      expect(handler.isLiveSnapToScale).toBe(false);

      // Custom values
      handler.setLiveReverb(0.75);
      expect(handler.liveReverbSend).toBe(0.75);

      handler.setLiveVolume(0.60);
      expect(handler.liveVolumeLevel).toBe(0.60);

      handler.setLiveReleaseTime(1.5);
      expect(handler.liveRelease).toBe(1.5);

      handler.setLiveTrailLifetime(2000);
      expect(handler.liveTrailLifetime).toBe(2000);

      handler.setLiveSnapToScale(true);
      expect(handler.isLiveSnapToScale).toBe(true);

      // Out of bounds clamping
      handler.setLiveReverb(1.5);
      expect(handler.liveReverbSend).toBe(1.0);
      handler.setLiveVolume(-0.2);
      expect(handler.liveVolumeLevel).toBe(0.0);

      handler.destroy();
    });

    it('quantizes to discrete scale intervals when liveSnapToScale is true', async () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const discreteSpy = vi.spyOn(quantizer, 'quantizeDiscrete');
      const continuousSpy = vi.spyOn(quantizer, 'quantizeContinuous');

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        getCurrentInstrument: () => 'indigo',
        getCurrentStyle: () => 'solid',
        onStrokeComplete: vi.fn(),
      });

      handler.setAppMode('live');
      handler.setLiveSnapToScale(true);

      const pointerDown = listeners['pointerdown'][0];
      await pointerDown({ clientX: 200, clientY: 250, button: 0 } as any);

      expect(discreteSpy).toHaveBeenCalled();
      expect(continuousSpy).not.toHaveBeenCalled();

      discreteSpy.mockRestore();
      continuousSpy.mockRestore();
      handler.destroy();
    });

    it('uses configured live volume and reverb when triggering live voices', async () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const pulseSpy = vi.spyOn(PulseVoice, 'trigger').mockImplementation(() => {});

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        getCurrentInstrument: () => 'amber',
        getCurrentStyle: () => 'dotted',
        onStrokeComplete: vi.fn(),
      });

      handler.setAppMode('live');
      handler.setLiveReverb(0.82);
      handler.setLiveVolume(0.65);

      const pointerDown = listeners['pointerdown'][0];
      await pointerDown({ clientX: 250, clientY: 250, button: 0 } as any);

      expect(pulseSpy).toHaveBeenCalled();
      const lastCall = pulseSpy.mock.calls[0];
      expect(lastCall[2]).toBe(0.65); // volume
      expect(lastCall[8]).toBe(0.82); // reverb

      pulseSpy.mockRestore();
      handler.destroy();
    });

    it('creates single stationary note dot when drawShape is point', async () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const completeSpy = vi.fn();

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        getCurrentInstrument: () => 'amber',
        getCurrentStyle: () => 'solid',
        onStrokeComplete: completeSpy,
      });

      handler.setDrawShape('point');
      expect(handler.drawShape).toBe('point');

      const pointerDown = listeners['pointerdown'][0];
      const pointerUp = windowListeners['pointerup'][0];

      await pointerDown({ clientX: 300, clientY: 200, button: 0 } as any);
      pointerUp({ clientX: 300, clientY: 200 } as any);

      expect(completeSpy).toHaveBeenCalled();
      const [path, isPoint] = completeSpy.mock.calls[0];
      expect(isPoint).toBe(true);
      expect(path.segments.length).toBe(1);
      expect(path.segments[0].p0.x).toBe(300);
      expect(path.segments[0].p0.y).toBe(200);

      handler.destroy();
    });
  });

  describe('Per-Stroke Distortion and Tone Filter', () => {
    beforeEach(() => {
      vi.spyOn(soundEngine, 'isReady', 'get').mockReturnValue(false);
    });

    it('sets and undoes stroke distortion and filterCutoff correctly', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const stroke = sm.addStroke(dummyPath, 'solid', 'amber', 140, quantizer, 600, 1.0);

      expect(stroke.distortion ?? 0.0).toBe(0.0);
      expect(stroke.filterCutoff ?? 1.0).toBe(1.0);

      // Set distortion
      sm.setStrokeDistortion(stroke.id, 0.75);
      expect(stroke.distortion).toBe(0.75);

      // Undo distortion
      sm.undo();
      expect(stroke.distortion).toBe(0.0);

      // Redo distortion
      sm.redo();
      expect(stroke.distortion).toBe(0.75);

      // Set filter cutoff
      sm.setStrokeFilterCutoff(stroke.id, 0.40);
      expect(stroke.filterCutoff).toBe(0.40);

      // Undo filter cutoff
      sm.undo();
      expect(stroke.filterCutoff).toBe(1.0);

      // Redo filter cutoff
      sm.redo();
      expect(stroke.filterCutoff).toBe(0.40);
    });

    it('persists distortion, filterCutoff, and isPoint across export and import', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const stroke = sm.addStroke(
        dummyPath,
        'solid',
        'amber',
        140,
        quantizer,
        600,
        1.0,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        true,
        0.85,
        0.35
      );

      expect(stroke.isPoint).toBe(true);
      expect(stroke.distortion).toBe(0.85);
      expect(stroke.filterCutoff).toBe(0.35);

      const exported = sm.exportComposition();
      expect(exported.strokes[0].isPoint).toBe(true);
      expect(exported.strokes[0].distortion).toBe(0.85);
      expect(exported.strokes[0].filterCutoff).toBe(0.35);

      const sm2 = new StrokeManager();
      sm2.importComposition(exported, quantizer, 600, 800);
      const importedStroke = sm2.activeStrokes[0];
      expect(importedStroke.isPoint).toBe(true);
      expect(importedStroke.distortion).toBe(0.85);
      expect(importedStroke.filterCutoff).toBe(0.35);
    });

    it('dynamically updates stationary dot note frequency and playhead position when translated/moved', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const dotPath: SplinePath = {
        segments: [
          {
            p0: { x: 400, y: 500 },
            p1: { x: 400.1, y: 500 },
            p2: { x: 400.2, y: 500 },
            p3: { x: 400.3, y: 500 },
          },
        ],
        isClosed: false,
      };

      // Create a solid dot stroke at y = 500
      const dot = sm.addStroke(
        dotPath,
        'solid',
        'indigo',
        100,
        quantizer,
        600,
        1.0,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        true
      );

      expect(dot.isPoint).toBe(true);

      // Run update at initial position
      sm.update(0.016, 800, 600, quantizer);
      expect(dot.playhead.lastEval).toBeDefined();
      expect(dot.playhead.lastEval?.point.x).toBe(400);
      expect(dot.playhead.lastEval?.point.y).toBe(500);
      const initialFreq = dot.playhead.lastPitch?.frequency;
      expect(initialFreq).toBeGreaterThan(0);

      // Translate the dot upward (lower Y = higher pitch in canvas coordinates)
      sm.translateStroke(dot.id, 50, -250, true);

      expect(dot.path.segments[0].p0.x).toBe(450);
      expect(dot.path.segments[0].p0.y).toBe(250);
      expect(dot.playhead.lastEval?.point.x).toBe(450);
      expect(dot.playhead.lastEval?.point.y).toBe(250);

      // Run update after translation
      sm.update(0.016, 800, 600, quantizer);

      const movedFreq = dot.playhead.lastPitch?.frequency;
      expect(movedFreq).toBeGreaterThan(initialFreq!);

      // Translate back downward and verify pitch drops
      sm.translateStroke(dot.id, 0, 300, true);
      sm.update(0.016, 800, 600, quantizer);
      const lowerFreq = dot.playhead.lastPitch?.frequency;
      expect(lowerFreq).toBeLessThan(movedFreq!);

      // Test undoing the move restores original coordinates and frequency
      sm.undo();
      sm.undo();
      sm.update(0.016, 800, 600, quantizer);
      expect(dot.playhead.lastEval?.point.x).toBe(400);
      expect(dot.playhead.lastEval?.point.y).toBe(500);
      expect(dot.playhead.lastPitch?.frequency).toBeCloseTo(initialFreq!, 2);
    });

    it('updates stationary dot note triggering coordinates for dotted and onyx drum machines', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const dotPath: SplinePath = {
        segments: [
          {
            p0: { x: 300, y: 550 }, // lower area = Kick drum
            p1: { x: 300.1, y: 550 },
            p2: { x: 300.2, y: 550 },
            p3: { x: 300.3, y: 550 },
          },
        ],
        isClosed: false,
      };

      const drumDot = sm.addStroke(
        dotPath,
        'dotted',
        'onyx',
        100,
        quantizer,
        600,
        1.0,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        true
      );

      sm.update(0.016, 800, 600, quantizer);
      expect(drumDot.playhead.lastEval?.point.y).toBe(550);

      // Move drum dot to top area (y = 50, Hi-Hat zone)
      sm.translateStroke(drumDot.id, 0, -500, false);
      sm.update(0.016, 800, 600, quantizer);
      expect(drumDot.playhead.lastEval?.point.y).toBe(50);
    });
  });
});

