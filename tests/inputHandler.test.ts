import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InputHandler } from '../src/canvas/inputHandler';
import { StrokeManager } from '../src/engine/strokeManager';
import { ScaleQuantizer } from '../src/audio/scaleQuantizer';
import { soundEngine } from '../src/audio/audioContext';
import { SplinePath } from '../src/math/types';
import { PulseVoice } from '../src/audio/synthVoice';
import { DrumSynth } from '../src/audio/drumSynth';
import { getInstrument } from '../src/audio/instruments';

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

  it('selects Onyx drum strokes when clicked on canvas with scrolling enabled', async () => {
    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer();
    quantizer.setScrollEnabled(true);
    quantizer.setScrollY(600);

    // Onyx stroke in world space at y = 900 (which corresponds to screenY = 300)
    const drumPath: SplinePath = {
      segments: [
        {
          p0: { x: 50, y: 900 },
          p1: { x: 150, y: 900 },
          p2: { x: 250, y: 900 },
          p3: { x: 350, y: 900 },
        },
      ],
      isClosed: false,
    };
    const drumStroke = sm.addStroke(drumPath, 'striped', 'onyx', 140);

    const onSelectStroke = vi.fn();
    const handler = new InputHandler(mockCanvas, {
      strokeManager: sm,
      getQuantizer: () => quantizer,
      onStrokeComplete: vi.fn(),
      onSelectStroke,
    });

    // Click at screen position (100, 300) which corresponds to world position (100, 900)
    const pointerDown = listeners['pointerdown'][0];
    await pointerDown({ clientX: 100, clientY: 300, button: 0 } as any);

    expect(sm.selectedStrokeId).toBe(drumStroke.id);
    expect(onSelectStroke).toHaveBeenCalledWith(drumStroke.id);

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

    it('toggles selection with metaKey / ctrlKey and moves multiple strokes simultaneously', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        onStrokeComplete: vi.fn(),
        onSelectStroke: vi.fn(),
      });

      const pathA: SplinePath = {
        segments: [{ p0: { x: 50, y: 100 }, p1: { x: 100, y: 100 }, p2: { x: 150, y: 100 }, p3: { x: 200, y: 100 } }],
        isClosed: false,
      };
      const pathB: SplinePath = {
        segments: [{ p0: { x: 50, y: 300 }, p1: { x: 100, y: 300 }, p2: { x: 150, y: 300 }, p3: { x: 200, y: 300 } }],
        isClosed: false,
      };

      const sA = sm.addStroke(pathA, 'solid', 'indigo', 120);
      const sB = sm.addStroke(pathB, 'solid', 'amber', 120);

      // 1. Click stroke A without metaKey -> selects A
      listeners['pointerdown'][0]({ clientX: 100, clientY: 100, pointerId: 1, button: 0, metaKey: false });
      expect(sm.selectedStrokeIds).toEqual([sA.id]);
      expect(sm.selectedStrokeId).toBe(sA.id);

      // 2. Cmd+Click stroke B -> adds B to selection
      listeners['pointerdown'][0]({ clientX: 100, clientY: 300, pointerId: 1, button: 0, metaKey: true });
      expect(sm.selectedStrokeIds).toContain(sA.id);
      expect(sm.selectedStrokeIds).toContain(sB.id);
      expect(sm.selectedStrokeIds.length).toBe(2);
      expect(sm.selectedStrokeId).toBeNull(); // Inspector suppressed for multi-selection!

      // 3. Pointer move on stroke B by dx=20, dy=15
      windowListeners['pointermove'][0]({ clientX: 120, clientY: 315, pointerId: 1 });

      // Both strokes should be translated by dx=20, dy=15
      expect(sA.path.segments[0].p0.x).toBe(70);
      expect(sA.path.segments[0].p0.y).toBe(115);
      expect(sB.path.segments[0].p0.x).toBe(70);
      expect(sB.path.segments[0].p0.y).toBe(315);

      // 4. Pointer up commits move
      windowListeners['pointerup'][0]({ clientX: 120, clientY: 315, pointerId: 1 });

      // Undo should revert both strokes
      sm.undo();
      expect(sA.path.segments[0].p0.x).toBe(50);
      expect(sA.path.segments[0].p0.y).toBe(100);
      expect(sB.path.segments[0].p0.x).toBe(50);
      expect(sB.path.segments[0].p0.y).toBe(300);

      // 5. Clicking empty canvas clears selection
      listeners['pointerdown'][0]({ clientX: 500, clientY: 500, pointerId: 1, button: 0, metaKey: false });
      expect(sm.selectedStrokeIds).toEqual([]);
    });

    it('triggers onStrokeTranslateEnd callback when dragging strokes completes', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const onTranslateEnd = vi.fn();

      new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        onStrokeComplete: () => {},
        onStrokeTranslateEnd: onTranslateEnd,
      });

      const path: SplinePath = {
        segments: [{ p0: { x: 50, y: 100 }, p1: { x: 100, y: 100 }, p2: { x: 150, y: 100 }, p3: { x: 200, y: 100 } }],
        isClosed: false,
      };
      sm.addStroke(path, 'solid', 'indigo', 120);

      // Start drag
      listeners['pointerdown'][0]({ clientX: 100, clientY: 100, pointerId: 1, button: 0, metaKey: false });
      // Move drag
      windowListeners['pointermove'][0]({ clientX: 100, clientY: 150, pointerId: 1 });
      expect(onTranslateEnd).not.toHaveBeenCalled();

      // Release drag
      windowListeners['pointerup'][0]({ clientX: 100, clientY: 150, pointerId: 1 });
      expect(onTranslateEnd).toHaveBeenCalledTimes(1);
    });

    it('dispatches onStrokeRedraw instead of onStrokeComplete when redraw mode is armed', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const onStrokeComplete = vi.fn();
      const onStrokeRedraw = vi.fn();
      const onRedrawStateChange = vi.fn();

      const path: SplinePath = {
        segments: [{ p0: { x: 50, y: 100 }, p1: { x: 100, y: 100 }, p2: { x: 150, y: 100 }, p3: { x: 200, y: 100 } }],
        isClosed: false,
      };
      const stroke = sm.addStroke(path, 'solid', 'indigo', 120);
      sm.selectStroke(stroke.id);

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        onStrokeComplete,
        onStrokeRedraw,
        onRedrawStateChange,
      });

      // Arm redraw
      handler.armRedraw(stroke.id);
      expect(handler.isRedrawing).toBe(true);
      expect(onRedrawStateChange).toHaveBeenCalledWith(true);

      // Draw a new line
      listeners['pointerdown'][0]({ clientX: 300, clientY: 300, pointerId: 1, button: 0 });
      windowListeners['pointermove'][0]({ clientX: 350, clientY: 350, pointerId: 1 });
      windowListeners['pointermove'][0]({ clientX: 400, clientY: 400, pointerId: 1 });
      windowListeners['pointerup'][0]({ clientX: 400, clientY: 400, pointerId: 1 });

      expect(onStrokeRedraw).toHaveBeenCalledTimes(1);
      expect(onStrokeRedraw).toHaveBeenCalledWith(stroke.id, expect.any(Object));
      expect(onStrokeComplete).not.toHaveBeenCalled();
      expect(handler.isRedrawing).toBe(false);

      handler.destroy();
    });

    it('dispatches onStrokeRedraw when user draws while holding Option/Alt with a stroke selected', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const onStrokeComplete = vi.fn();
      const onStrokeRedraw = vi.fn();

      const path: SplinePath = {
        segments: [{ p0: { x: 50, y: 100 }, p1: { x: 100, y: 100 }, p2: { x: 150, y: 100 }, p3: { x: 200, y: 100 } }],
        isClosed: false,
      };
      const stroke = sm.addStroke(path, 'solid', 'indigo', 120);
      sm.selectStroke(stroke.id);

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        onStrokeComplete,
        onStrokeRedraw,
      });

      // Pointerdown with altKey: true
      listeners['pointerdown'][0]({ clientX: 200, clientY: 200, pointerId: 1, button: 0, altKey: true });
      expect(handler.isRedrawing).toBe(true);

      // Move and release
      windowListeners['pointermove'][0]({ clientX: 250, clientY: 250, pointerId: 1 });
      windowListeners['pointermove'][0]({ clientX: 300, clientY: 300, pointerId: 1 });
      windowListeners['pointerup'][0]({ clientX: 300, clientY: 300, pointerId: 1 });

      expect(onStrokeRedraw).toHaveBeenCalledTimes(1);
      expect(onStrokeRedraw).toHaveBeenCalledWith(stroke.id, expect.any(Object));
      expect(onStrokeComplete).not.toHaveBeenCalled();
      expect(handler.isRedrawing).toBe(false);

      handler.destroy();
    });

    it('reliably executes redraw when onSelectStroke callback is active (prevents pointermove deselection)', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const onStrokeComplete = vi.fn();
      const onStrokeRedraw = vi.fn((strokeId: string, path: SplinePath) => {
        sm.redrawStroke(strokeId, path);
      });
      const onSelectStroke = vi.fn((strokeId: string | null) => {
        if (!strokeId && handler.appMode !== 'redraw' && handler.isRedrawing) {
          handler.cancelRedraw();
        }
      });

      const initialPath: SplinePath = {
        segments: [{ p0: { x: 50, y: 100 }, p1: { x: 100, y: 100 }, p2: { x: 150, y: 100 }, p3: { x: 200, y: 100 } }],
        isClosed: false,
      };
      const stroke = sm.addStroke(initialPath, 'dotted', 'amber', 130);
      sm.selectStroke(stroke.id);

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        onStrokeComplete,
        onStrokeRedraw,
        onSelectStroke,
      });

      // Switch to redraw mode
      handler.setAppMode('redraw');
      expect(handler.appMode).toBe('redraw');
      expect(handler.isRedrawing).toBe(true);

      // User draws a replacement curve across canvas
      listeners['pointerdown'][0]({ clientX: 100, clientY: 200, pointerId: 1, button: 0 });
      windowListeners['pointermove'][0]({ clientX: 150, clientY: 220, pointerId: 1 });
      windowListeners['pointermove'][0]({ clientX: 200, clientY: 250, pointerId: 1 });
      windowListeners['pointermove'][0]({ clientX: 280, clientY: 300, pointerId: 1 });
      windowListeners['pointerup'][0]({ clientX: 280, clientY: 300, pointerId: 1 });

      // Must call onStrokeRedraw and NEVER create a new stroke
      expect(onStrokeRedraw).toHaveBeenCalledTimes(1);
      expect(onStrokeRedraw).toHaveBeenCalledWith(stroke.id, expect.any(Object));
      expect(onStrokeComplete).not.toHaveBeenCalled();

      // Stroke path must be replaced while preserving musical instrument and parameters
      expect(stroke.instrumentId).toBe('amber');
      expect(stroke.style).toBe('dotted');
      expect(stroke.path.segments[0].p0.x).toBe(100);

      handler.destroy();
    });

    it('auto-selects the latest stroke if none is selected when drawing in redraw mode', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const onStrokeComplete = vi.fn();
      const onStrokeRedraw = vi.fn();
      const onSelectStroke = vi.fn();

      sm.addStroke(dummyPath, 'solid', 'indigo', 120);
      const stroke2 = sm.addStroke(dummyPath, 'striped', 'rose', 140);
      sm.selectStroke(null); // No stroke selected initially

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        onStrokeComplete,
        onStrokeRedraw,
        onSelectStroke,
      });

      handler.setAppMode('redraw');
      // Pointerdown on canvas to draw replacement
      listeners['pointerdown'][0]({ clientX: 100, clientY: 200, pointerId: 1, button: 0 });
      windowListeners['pointermove'][0]({ clientX: 150, clientY: 250, pointerId: 1 });
      windowListeners['pointermove'][0]({ clientX: 200, clientY: 300, pointerId: 1 });
      windowListeners['pointerup'][0]({ clientX: 200, clientY: 300, pointerId: 1 });

      // Must have targeted stroke2 (latest stroke) and redrawn it
      expect(onStrokeRedraw).toHaveBeenCalledTimes(1);
      expect(onStrokeRedraw).toHaveBeenCalledWith(stroke2.id, expect.any(Object));
      expect(onStrokeComplete).not.toHaveBeenCalled();

      handler.destroy();
    });

    it('triggers onRedrawStart and exposes activeRedrawStrokeId during redraw gesture', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const onRedrawStart = vi.fn();
      const onStrokeRedraw = vi.fn();

      const stroke = sm.addStroke(dummyPath, 'solid', 'rose', 140);
      sm.selectStroke(stroke.id);

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        onStrokeComplete: vi.fn(),
        onStrokeRedraw,
        onRedrawStart,
      });

      handler.setAppMode('redraw');
      expect(handler.activeRedrawStrokeId).toBeNull();

      // Begin redraw gesture
      listeners['pointerdown'][0]({ clientX: 100, clientY: 200, pointerId: 1, button: 0 });
      expect(onRedrawStart).toHaveBeenCalledWith(stroke.id);
      expect(handler.activeRedrawStrokeId).toBe(stroke.id);

      // Complete gesture
      windowListeners['pointermove'][0]({ clientX: 150, clientY: 250, pointerId: 1 });
      windowListeners['pointerup'][0]({ clientX: 150, clientY: 250, pointerId: 1 });
      expect(onStrokeRedraw).toHaveBeenCalledWith(stroke.id, expect.any(Object));
      expect(handler.activeRedrawStrokeId).toBeNull();

      handler.destroy();
    });
  });

  describe('Wave 1 Regression Tests', () => {
    it('destroy() removes both touchstart and touchmove listeners using the registered handler reference', () => {
      const addSpy = vi.spyOn(mockCanvas, 'addEventListener');
      const removeSpy = vi.spyOn(mockCanvas, 'removeEventListener');
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        onStrokeComplete: vi.fn(),
      });

      expect(listeners['touchstart']).toHaveLength(1);
      expect(listeners['touchmove']).toHaveLength(1);
      const touchStartHandler = listeners['touchstart'][0];
      const touchMoveHandler = listeners['touchmove'][0];
      expect(touchStartHandler).toBe(touchMoveHandler);
      expect(addSpy).toHaveBeenCalledWith('touchstart', touchStartHandler, { passive: false });
      expect(addSpy).toHaveBeenCalledWith('touchmove', touchMoveHandler, { passive: false });

      handler.destroy();

      expect(listeners['touchstart']).toHaveLength(0);
      expect(listeners['touchmove']).toHaveLength(0);
      expect(removeSpy).toHaveBeenCalledWith('touchstart', touchStartHandler);
      expect(removeSpy).toHaveBeenCalledWith('touchmove', touchMoveHandler);
    });

    it('invokes onLiveTrigger callback on Live Play pointerdown', async () => {
      const pulseSpy = vi.spyOn(PulseVoice, 'trigger').mockImplementation(() => {});
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const onLiveTrigger = vi.fn();

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        getCurrentInstrument: () => 'amber',
        getCurrentStyle: () => 'dotted',
        onStrokeComplete: vi.fn(),
      });

      try {
        handler.onLiveTrigger = onLiveTrigger;
        handler.setAppMode('live');

        const pointerDown = listeners['pointerdown'][0];
        await pointerDown({ clientX: 250, clientY: 180, button: 0 } as any);

        expect(onLiveTrigger).toHaveBeenCalledTimes(1);
        expect(onLiveTrigger).toHaveBeenCalledWith(250, 180, getInstrument('amber').color);
      } finally {
        pulseSpy.mockRestore();
        handler.destroy();
      }
    });

    it('hover pointermove skips hitTest when e.target !== canvas or outside bounds, and runs when e.target === undefined inside bounds', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
      const hitTestSpy = vi.spyOn(sm, 'hitTest');

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        onStrokeComplete: vi.fn(),
      });

      try {
        const pointerMove = windowListeners['pointermove'][0];

        // 1. e.target is a different non-undefined element -> skips hitTest
        pointerMove({ clientX: 100, clientY: 100, target: { tagName: 'DIV' } } as any);
        expect(hitTestSpy).not.toHaveBeenCalled();
        expect(sm.hoveredStrokeId).toBeNull();

        // 2. Coordinates outside canvas bounds -> skips hitTest
        pointerMove({ clientX: -10, clientY: 100, target: mockCanvas } as any);
        pointerMove({ clientX: 850, clientY: 100, target: mockCanvas } as any);
        pointerMove({ clientX: 100, clientY: -5, target: mockCanvas } as any);
        pointerMove({ clientX: 100, clientY: 650, target: mockCanvas } as any);
        expect(hitTestSpy).not.toHaveBeenCalled();
        expect(sm.hoveredStrokeId).toBeNull();

        // 3. e.target === undefined inside bounds -> runs hitTest and highlights hovered stroke
        pointerMove({ clientX: 100, clientY: 100 } as any);
        expect(hitTestSpy).toHaveBeenCalledTimes(1);
        expect(sm.hoveredStrokeId).toBe(stroke.id);
        expect(mockCanvas.style.cursor).toBe('pointer');

        // 4. Moving onto an off-canvas target clears hovered state without calling hitTest again
        pointerMove({ clientX: 100, clientY: 100, target: { tagName: 'BUTTON' } } as any);
        expect(hitTestSpy).toHaveBeenCalledTimes(1);
        expect(sm.hoveredStrokeId).toBeNull();
      } finally {
        hitTestSpy.mockRestore();
        handler.destroy();
      }
    });
  });

  describe('Wave 1C Input Gestures: Marquee, Alt+Drag Duplicate, and Multi-Touch', () => {
    it('supports Cmd/Ctrl + Drag marquee selection exposing marqueeRect and invoking onMarqueeSelect with world coords', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      quantizer.setScrollEnabled(true);
      quantizer.setScrollY(100);

      const onMarqueeSelect = vi.fn();
      const onStrokeComplete = vi.fn();
      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        onStrokeComplete,
        onMarqueeSelect,
      });

      try {
        expect(handler.marqueeRect).toBeNull();

        // Cmd + Drag on empty canvas
        listeners['pointerdown'][0]({ clientX: 40, clientY: 50, pointerId: 1, button: 0, metaKey: true });
        expect(handler.marqueeRect).toEqual({ x1: 40, y1: 50, x2: 40, y2: 50 });

        windowListeners['pointermove'][0]({ clientX: 240, clientY: 250, pointerId: 1 });
        expect(handler.marqueeRect).toEqual({ x1: 40, y1: 50, x2: 240, y2: 250 });

        windowListeners['pointerup'][0]({ clientX: 240, clientY: 250, pointerId: 1 });
        expect(handler.marqueeRect).toBeNull();
        expect(onMarqueeSelect).toHaveBeenCalledTimes(1);
        expect(onMarqueeSelect).toHaveBeenCalledWith({
          x1: 40,
          y1: 150,
          x2: 240,
          y2: 350,
        });
        expect(onStrokeComplete).not.toHaveBeenCalled();

        // Ctrl + Drag also works identically
        listeners['pointerdown'][0]({ clientX: 10, clientY: 20, pointerId: 1, button: 0, ctrlKey: true });
        expect(handler.marqueeRect).toEqual({ x1: 10, y1: 20, x2: 10, y2: 20 });
        windowListeners['pointermove'][0]({ clientX: 110, clientY: 120, pointerId: 1 });
        expect(handler.marqueeRect).toEqual({ x1: 10, y1: 20, x2: 110, y2: 120 });
        windowListeners['pointerup'][0]({ clientX: 110, clientY: 120, pointerId: 1 });
        expect(handler.marqueeRect).toBeNull();
        expect(onMarqueeSelect).toHaveBeenCalledTimes(2);
        expect(onMarqueeSelect).toHaveBeenLastCalledWith({
          x1: 10,
          y1: 120,
          x2: 110,
          y2: 220,
        });
      } finally {
        handler.destroy();
      }
    });

    it('Alt/Option + Drag on a stroke invokes onDuplicateDragStart and drags the duplicate while Alt + empty drag still triggers onStrokeRedraw', () => {
      const sm = new StrokeManager({ isReady: false } as any);
      const quantizer = new ScaleQuantizer();
      const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 120);
      const origP0 = { ...stroke.path.segments[0].p0 };

      const onDuplicateDragStart = vi.fn((ids: string[]) =>
        sm.duplicateStrokes(ids, 0, 0, quantizer, 600).map((s) => s.id)
      );
      const onStrokeRedraw = vi.fn();
      const onStrokeComplete = vi.fn();

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        onStrokeComplete,
        onStrokeRedraw,
        onDuplicateDragStart,
      });

      try {
        // 1. Alt/Option + Drag directly ON a stroke -> duplicates and drags the duplicate
        listeners['pointerdown'][0]({ clientX: 100, clientY: 100, pointerId: 1, button: 0, altKey: true });
        expect(onDuplicateDragStart).toHaveBeenCalledTimes(1);
        expect(onDuplicateDragStart).toHaveBeenCalledWith([stroke.id]);
        expect(sm.activeStrokes).toHaveLength(2);

        const dupStroke = sm.activeStrokes[1];
        expect(dupStroke.id).not.toBe(stroke.id);

        windowListeners['pointermove'][0]({ clientX: 140, clientY: 160, pointerId: 1 });
        windowListeners['pointerup'][0]({ clientX: 140, clientY: 160, pointerId: 1 });

        expect(stroke.path.segments[0].p0).toEqual(origP0);
        expect(dupStroke.path.segments[0].p0).toEqual({ x: origP0.x + 40, y: origP0.y + 60 });
        expect(onStrokeRedraw).not.toHaveBeenCalled();
        expect(onStrokeComplete).not.toHaveBeenCalled();

        // 2. Clicking empty space with altKey: true when a stroke is selected still triggers onStrokeRedraw
        sm.selectStroke(stroke.id);
        listeners['pointerdown'][0]({ clientX: 400, clientY: 400, pointerId: 1, button: 0, altKey: true });
        windowListeners['pointermove'][0]({ clientX: 440, clientY: 420, pointerId: 1 });
        windowListeners['pointermove'][0]({ clientX: 480, clientY: 440, pointerId: 1 });
        windowListeners['pointerup'][0]({ clientX: 480, clientY: 440, pointerId: 1 });

        expect(onDuplicateDragStart).toHaveBeenCalledTimes(1);
        expect(onStrokeRedraw).toHaveBeenCalledTimes(1);
        expect(onStrokeRedraw).toHaveBeenCalledWith(stroke.id, expect.any(Object));
        expect(onStrokeComplete).not.toHaveBeenCalled();
      } finally {
        handler.destroy();
      }
    });

    it('handles two-finger touch pinch octave zoom and vertical scroll, and removes all touch listeners on destroy()', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const onPinchOctaveZoom = vi.fn();
      const onTwoFingerScrollY = vi.fn();
      const removeSpy = vi.spyOn(mockCanvas, 'removeEventListener');

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        onStrokeComplete: vi.fn(),
        onPinchOctaveZoom,
        onTwoFingerScrollY,
      });

      const preventStart = vi.fn();
      const preventMove = vi.fn();

      // Initial two-finger touch: distance = 100, midY = 200
      listeners['touchstart'][0]({
        type: 'touchstart',
        touches: [
          { clientX: 100, clientY: 200 },
          { clientX: 200, clientY: 200 },
        ],
        preventDefault: preventStart,
      });
      expect(preventStart).toHaveBeenCalledTimes(1);

      // Spread fingers to distance = 200 (scaleFactor = 2.0) and shift midpoint up to midY = 160 (deltaY = +40)
      listeners['touchmove'][0]({
        type: 'touchmove',
        touches: [
          { clientX: 50, clientY: 160 },
          { clientX: 250, clientY: 160 },
        ],
        preventDefault: preventMove,
      });
      expect(preventMove).toHaveBeenCalledTimes(1);
      expect(onPinchOctaveZoom).toHaveBeenCalledTimes(1);
      expect(onPinchOctaveZoom.mock.calls[0][0]).toBeCloseTo(2.0, 5);
      expect(onTwoFingerScrollY).toHaveBeenCalledTimes(1);
      expect(onTwoFingerScrollY.mock.calls[0][0]).toBeCloseTo(40, 5);

      // End touches
      listeners['touchend'][0]({ type: 'touchend', touches: [] });

      // Destroy removes all 4 touch event listeners cleanly
      handler.destroy();
      expect(listeners['touchstart']).toHaveLength(0);
      expect(listeners['touchmove']).toHaveLength(0);
      expect(listeners['touchend']).toHaveLength(0);
      expect(listeners['touchcancel']).toHaveLength(0);
      expect(removeSpy).toHaveBeenCalledWith('touchstart', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('touchmove', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('touchend', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('touchcancel', expect.any(Function));
    });
  });

  describe('Re-draw Mode Line Moving & Multi-Selection', () => {
    it('moves a line when dragged directly on the stroke in redraw mode, without triggering onStrokeRedraw', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const onStrokeComplete = vi.fn();
      const onStrokeRedraw = vi.fn();
      const onStrokeTranslateEnd = vi.fn();

      const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 120);
      sm.selectStroke(stroke.id);
      const origP0 = { ...stroke.path.segments[0].p0 };

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        onStrokeComplete,
        onStrokeRedraw,
        onStrokeTranslateEnd,
      });

      try {
        handler.setAppMode('redraw');

        // Hover directly on the stroke displays 'grab'
        windowListeners['pointermove'][0]({ clientX: 100, clientY: 100 });
        expect(mockCanvas.style.cursor).toBe('grab');

        // Grab and drag the stroke directly in redraw mode
        listeners['pointerdown'][0]({ clientX: 100, clientY: 100, pointerId: 1, button: 0 });
        windowListeners['pointermove'][0]({ clientX: 130, clientY: 145, pointerId: 1 });
        windowListeners['pointerup'][0]({ clientX: 130, clientY: 145, pointerId: 1 });

        expect(onStrokeRedraw).not.toHaveBeenCalled();
        expect(onStrokeComplete).not.toHaveBeenCalled();
        expect(onStrokeTranslateEnd).toHaveBeenCalledTimes(1);
        expect(stroke.path.segments[0].p0).toEqual({ x: origP0.x + 30, y: origP0.y + 45 });

        // Dragging on empty space in redraw mode still triggers onStrokeRedraw
        listeners['pointerdown'][0]({ clientX: 100, clientY: 400, pointerId: 1, button: 0 });
        windowListeners['pointermove'][0]({ clientX: 180, clientY: 420, pointerId: 1 });
        windowListeners['pointerup'][0]({ clientX: 180, clientY: 420, pointerId: 1 });
        expect(onStrokeRedraw).toHaveBeenCalledTimes(1);
        expect(onStrokeRedraw).toHaveBeenCalledWith(stroke.id, expect.any(Object));
      } finally {
        handler.destroy();
      }
    });

    it('supports Cmd/Ctrl+Click multi-select drag and Alt+Drag forced redraw over a stroke in redraw mode', () => {
      const sm = new StrokeManager();
      const quantizer = new ScaleQuantizer();
      const onStrokeRedraw = vi.fn();
      const onStrokeTranslateEnd = vi.fn();

      const path1: SplinePath = {
        segments: [{ p0: { x: 50, y: 100 }, p1: { x: 100, y: 100 }, p2: { x: 150, y: 100 }, p3: { x: 200, y: 100 } }],
        isClosed: false,
      };
      const stroke1 = sm.addStroke(path1, 'solid', 'indigo', 120);
      const path2: SplinePath = {
        segments: [{ p0: { x: 50, y: 220 }, p1: { x: 100, y: 220 }, p2: { x: 150, y: 220 }, p3: { x: 200, y: 220 } }],
        isClosed: false,
      };
      const stroke2 = sm.addStroke(path2, 'dotted', 'amber', 120);
      sm.selectStroke(stroke1.id);

      const handler = new InputHandler(mockCanvas, {
        strokeManager: sm,
        getQuantizer: () => quantizer,
        onStrokeComplete: vi.fn(),
        onStrokeRedraw,
        onStrokeTranslateEnd,
      });

      try {
        handler.setAppMode('redraw');

        // Cmd+Click stroke2 and drag -> both stroke1 and stroke2 move together
        listeners['pointerdown'][0]({ clientX: 100, clientY: 220, pointerId: 1, button: 0, metaKey: true });
        expect(sm.selectedStrokeIds).toEqual([stroke1.id, stroke2.id]);
        windowListeners['pointermove'][0]({ clientX: 120, clientY: 240, pointerId: 1 });
        windowListeners['pointerup'][0]({ clientX: 120, clientY: 240, pointerId: 1 });

        expect(onStrokeRedraw).not.toHaveBeenCalled();
        expect(onStrokeTranslateEnd).toHaveBeenCalledTimes(1);
        expect(stroke1.path.segments[0].p0.x).toBe(70);
        expect(stroke2.path.segments[0].p0.x).toBe(70);

        // Alt+Drag even directly over stroke2 forces redraw when selected
        sm.selectStroke(stroke2.id);
        listeners['pointerdown'][0]({ clientX: 120, clientY: 240, pointerId: 1, button: 0, altKey: true });
        windowListeners['pointermove'][0]({ clientX: 200, clientY: 260, pointerId: 1 });
        windowListeners['pointerup'][0]({ clientX: 200, clientY: 260, pointerId: 1 });

        expect(onStrokeRedraw).toHaveBeenCalledTimes(1);
        expect(onStrokeRedraw).toHaveBeenCalledWith(stroke2.id, expect.any(Object));
      } finally {
        handler.destroy();
      }
    });
  });
});

