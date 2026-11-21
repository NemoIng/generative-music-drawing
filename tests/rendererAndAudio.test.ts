import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/math/arcLengthInverter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/math/arcLengthInverter')>();
  return {
    ...actual,
    evaluateAtDistance: vi.fn(actual.evaluateAtDistance),
  };
});

import { resolveDrumZone } from '../src/audio/drumMapping';
import { CanvasRenderer } from '../src/canvas/renderer';
import { evaluateAtDistance } from '../src/math/arcLengthInverter';
import { buildArcLengthLUT } from '../src/math/arcLengthTable';
import { ScaleQuantizer, type ScaleGuideline } from '../src/audio/scaleQuantizer';
import { SCALES, ROOT_NOTES } from '../src/audio/scales';
import { DroneVoice, PulseVoice } from '../src/audio/synthVoice';
import { DrumSynth } from '../src/audio/drumSynth';
import { INSTRUMENTS } from '../src/audio/instruments';
import { LiveRecorder, simulateCompositionToAudioBuffer } from '../src/audio/mp3Export';
import { SoundEngine } from '../src/audio/audioContext';
import { StrokeManager } from '../src/engine/strokeManager';
import type { DrawnStroke } from '../src/engine/types';
import type { SplinePath } from '../src/math/types';

function createHorizontalSpline(x0 = 100, x1 = 260, y = 200): SplinePath {
  const dx = (x1 - x0) / 3;
  return {
    isClosed: false,
    segments: [
      {
        p0: { x: x0, y },
        p1: { x: x0 + dx, y },
        p2: { x: x0 + 2 * dx, y },
        p3: { x: x1, y },
      },
    ],
  };
}

interface MockCanvas2DRecorder {
  ctx: CanvasRenderingContext2D;
  fillTextCalls: Array<{ text: string; x: number; y: number; fillStyle: string }>;
  fillCalls: Array<{ fillStyle: string }>;
  arcCalls: Array<{ x: number; y: number; radius: number }>;
}

function createMockCanvasAndCtx(): {
  canvas: HTMLCanvasElement;
  recorder: MockCanvas2DRecorder;
} {
  const fillTextCalls: MockCanvas2DRecorder['fillTextCalls'] = [];
  const fillCalls: MockCanvas2DRecorder['fillCalls'] = [];
  const arcCalls: MockCanvas2DRecorder['arcCalls'] = [];

  const mockCtx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
    globalAlpha: 1,
    shadowBlur: 0,
    shadowColor: 'transparent',
    shadowOffsetY: 0,
    font: '10px sans-serif',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    translate: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    roundRect: vi.fn(),
    setLineDash: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    arc: vi.fn((x: number, y: number, radius: number) => {
      arcCalls.push({ x, y, radius });
    }),
    fill: vi.fn(() => {
      fillCalls.push({ fillStyle: String(mockCtx.fillStyle) });
    }),
    fillText: vi.fn((text: string, x: number, y: number) => {
      fillTextCalls.push({ text, x, y, fillStyle: String(mockCtx.fillStyle) });
    }),
  };

  const canvas = {
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
    getContext: (id: string) => (id === '2d' ? mockCtx : null),
  } as unknown as HTMLCanvasElement;

  return {
    canvas,
    recorder: {
      ctx: mockCtx as unknown as CanvasRenderingContext2D,
      fillTextCalls,
      fillCalls,
      arcCalls,
    },
  };
}

interface TrackedParam {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  setTargetAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
}

function makeTrackedParam(initial = 0): TrackedParam {
  const param: TrackedParam = {
    value: initial,
    setValueAtTime: vi.fn((v: number) => {
      param.value = v;
    }),
    setTargetAtTime: vi.fn((v: number) => {
      param.value = v;
    }),
    linearRampToValueAtTime: vi.fn((v: number) => {
      param.value = v;
    }),
    exponentialRampToValueAtTime: vi.fn((v: number) => {
      param.value = v;
    }),
    cancelScheduledValues: vi.fn(),
  };
  return param;
}

interface TrackedAudioNode {
  kind: string;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  [key: string]: unknown;
}

function createVoiceAudioEnv() {
  const createdNodes: TrackedAudioNode[] = [];
  const oscillators: Array<TrackedAudioNode & { onended: (() => void) | null; type: OscillatorType }> = [];
  const bufferSources: Array<TrackedAudioNode & { onended: (() => void) | null; buffer: AudioBuffer | null }> = [];
  const gains: Array<TrackedAudioNode & { gain: TrackedParam }> = [];
  const filters: Array<TrackedAudioNode & { type: BiquadFilterType; frequency: TrackedParam; Q: TrackedParam }> = [];
  const panners: Array<TrackedAudioNode & { pan: TrackedParam }> = [];
  const connections: Array<{ source: TrackedAudioNode; dest: unknown }> = [];

  const track = <T extends Record<string, unknown>>(kind: string, extra: T): TrackedAudioNode & T => {
    const node = {
      kind,
      connect: vi.fn((dest: unknown) => {
        connections.push({ source: node, dest });
        return dest;
      }),
      disconnect: vi.fn(),
      ...extra,
    } as TrackedAudioNode & T;
    createdNodes.push(node);
    return node;
  };

  const mockCtx = {
    currentTime: 2.0,
    sampleRate: 44100,
    state: 'running',
    createOscillator: vi.fn(() => {
      const osc = track('OscillatorNode', {
        type: 'sine' as OscillatorType,
        frequency: makeTrackedParam(440),
        detune: makeTrackedParam(0),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
      });
      oscillators.push(osc);
      return osc;
    }),
    createGain: vi.fn(() => {
      const g = track('GainNode', { gain: makeTrackedParam(1) });
      gains.push(g);
      return g;
    }),
    createBiquadFilter: vi.fn(() => {
      const f = track('BiquadFilterNode', {
        type: 'lowpass' as BiquadFilterType,
        frequency: makeTrackedParam(1000),
        Q: makeTrackedParam(1),
        gain: makeTrackedParam(0),
      });
      filters.push(f);
      return f;
    }),
    createWaveShaper: vi.fn(() => track('WaveShaperNode', { curve: null, oversample: 'none' })),
    createStereoPanner: vi.fn(() => {
      const p = track('StereoPannerNode', { pan: makeTrackedParam(0) });
      panners.push(p);
      return p;
    }),
    createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    })),
    createBufferSource: vi.fn(() => {
      const bs = track('AudioBufferSourceNode', {
        buffer: null as AudioBuffer | null,
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
      });
      bufferSources.push(bs);
      return bs;
    }),
  } as unknown as AudioContext;

  const createdSends: Array<{
    reverbSendGain: TrackedAudioNode & { gain: TrackedParam };
    delaySendGain: TrackedAudioNode & { gain: TrackedParam };
  }> = [];

  const mockEngine = {
    isReady: true,
    context: mockCtx,
    connectVoice: vi.fn((_source: AudioNode) => {
      const reverbSendGain = track('SendGain', { gain: makeTrackedParam(0.4) });
      const delaySendGain = track('SendGain', { gain: makeTrackedParam(0.3) });
      createdSends.push({ reverbSendGain, delaySendGain });
      return {
        reverbSendGain: reverbSendGain as unknown as GainNode,
        delaySendGain: delaySendGain as unknown as GainNode,
      };
    }),
    triggerDucking: vi.fn(),
  } as unknown as SoundEngine;

  return {
    mockCtx,
    mockEngine,
    createdNodes,
    oscillators,
    bufferSources,
    gains,
    filters,
    panners,
    connections,
    createdSends,
  };
}

describe('Renderer, DrumMapping, Audio Voices, and MP3 Export', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('resolveDrumZone', () => {
    it('maps all 5 frequency boundaries accurately including clap roll and clamped linear tom frequency', () => {
      expect(resolveDrumZone(110)).toEqual({ zone: 'kick', label: 'Kick', tomFreq: 120 });
      expect(resolveDrumZone(259.9)).toEqual({ zone: 'kick', label: 'Kick', tomFreq: 120 });

      expect(resolveDrumZone(260, false)).toEqual({ zone: 'snare', label: 'Snare', tomFreq: 120 });
      expect(resolveDrumZone(449.9, true)).toEqual({ zone: 'snare', label: 'Snare', tomFreq: 120 });

      expect(resolveDrumZone(450, false)).toEqual({ zone: 'snare', label: 'Snare', tomFreq: 120 });
      expect(resolveDrumZone(649.9, false)).toEqual({ zone: 'snare', label: 'Snare', tomFreq: 120 });
      expect(resolveDrumZone(450, true)).toEqual({ zone: 'clap', label: 'Clap', tomFreq: 120 });
      expect(resolveDrumZone(649.9, true)).toEqual({ zone: 'clap', label: 'Clap', tomFreq: 120 });

      const tomLow = resolveDrumZone(650);
      expect(tomLow.zone).toBe('tom');
      expect(tomLow.label).toBe('Tom');
      expect(tomLow.tomFreq).toBe(100);

      const tomMid = resolveDrumZone(650 + 1550 / 2);
      expect(tomMid.zone).toBe('tom');
      expect(tomMid.tomFreq).toBeCloseTo(160, 6);

      const tomHigh = resolveDrumZone(2199);
      expect(tomHigh.zone).toBe('tom');
      expect(tomHigh.tomFreq).toBeGreaterThanOrEqual(100);
      expect(tomHigh.tomFreq).toBeLessThanOrEqual(220);
      expect(tomHigh.tomFreq).toBeCloseTo(100 + ((2199 - 650) / 1550) * 120, 6);

      expect(resolveDrumZone(2200)).toEqual({ zone: 'hihat', label: 'Hi-Hat', tomFreq: 120 });
      expect(resolveDrumZone(5000)).toEqual({ zone: 'hihat', label: 'Hi-Hat', tomFreq: 120 });
    });
  });

  describe('CanvasRenderer', () => {
    beforeEach(() => {
      vi.stubGlobal('window', { devicePixelRatio: 1 });
    });

    it('uses isFifth accurately for pentatonic scales and negative scale degrees', () => {
      const { canvas, recorder } = createMockCanvasAndCtx();
      const renderer = new CanvasRenderer(canvas);

      const quantizer = new ScaleQuantizer({
        scale: SCALES.minorPentatonic,
        root: ROOT_NOTES.C3,
        octaveSpan: 4,
      });
      const guidelines = quantizer.getGuidelines(600);
      renderer.drawGuidelines(guidelines);

      const fifthLabels = recorder.fillTextCalls.filter((c) => c.text.includes('(5th)'));
      expect(fifthLabels.length).toBeGreaterThan(0);
      // In C minor pentatonic, the perfect 5th is G (not 4th index Bb)
      for (const call of fifthLabels) {
        expect(call.text).toMatch(/^G\d+ \(5th\)$/);
      }

      // Negative scale degrees: explicit isFifth overrides degree%7, undefined falls back to mod 7 === 4
      recorder.fillTextCalls.length = 0;
      const customGuidelines: ScaleGuideline[] = [
        {
          y: 100,
          screenY: 100,
          scaleDegree: -2,
          noteName: 'G2',
          frequency: 196,
          isRoot: false,
          isFifth: true,
        },
        {
          y: 200,
          screenY: 200,
          scaleDegree: -3,
          noteName: 'F2',
          frequency: 174,
          isRoot: false,
          isFifth: false,
        },
        {
          y: 300,
          screenY: 300,
          scaleDegree: -3,
          noteName: 'E2',
          frequency: 165,
          isRoot: false,
        },
      ];
      renderer.drawGuidelines(customGuidelines);

      const texts = recorder.fillTextCalls.map((c) => c.text);
      expect(texts).toContain('G2 (5th)');
      expect(texts).toContain('F2');
      expect(texts).not.toContain('F2 (5th)');
      expect(texts).toContain('E2 (5th)');
    });

    it('caches dotted fluctuation offsets across frames and draws dots in a single batched fill pass', () => {
      const { canvas, recorder } = createMockCanvasAndCtx();
      const renderer = new CanvasRenderer(canvas);

      const path = createHorizontalSpline(100, 260, 200);
      const lut = buildArcLengthLUT(path, 64);
      const stroke: DrawnStroke = {
        id: 'dotted-cached',
        color: '#2563eb',
        instrumentId: 'indigo',
        style: 'dotted',
        path,
        lut,
        active: true,
        fluctuation: 0.6,
        playhead: {
          currentDistance: 0,
          velocity: 60,
          direction: 1,
          lastTriggerDistance: 0,
          lastEval: null,
          lastPitch: null,
          trail: [],
        },
        droneVoice: null,
      };

      const evalSpy = vi.mocked(evaluateAtDistance);
      evalSpy.mockClear();

      // Frame 1: populates cache
      renderer.drawStroke(stroke);
      const expectedDots = Math.floor(lut.totalLength / 16) + 1;
      expect(evalSpy).toHaveBeenCalledTimes(expectedDots);
      expect(recorder.arcCalls).toHaveLength(expectedDots);
      expect(recorder.fillCalls).toHaveLength(1);

      // Frame 2: uses cache without calling evaluateAtDistance again
      evalSpy.mockClear();
      recorder.arcCalls.length = 0;
      recorder.fillCalls.length = 0;

      renderer.drawStroke(stroke);
      expect(evalSpy).not.toHaveBeenCalled();
      expect(recorder.arcCalls).toHaveLength(expectedDots);
      expect(recorder.fillCalls).toHaveLength(1);
    });

    it('changes playhead pitch badge fill between light and dark mode', () => {
      const { canvas, recorder } = createMockCanvasAndCtx();
      const renderer = new CanvasRenderer(canvas);
      const path = createHorizontalSpline(100, 300, 250);
      const lut = buildArcLengthLUT(path, 32);

      const stroke: DrawnStroke = {
        id: 'badge-stroke',
        color: '#2563eb',
        instrumentId: 'indigo',
        style: 'solid',
        path,
        lut,
        active: true,
        playhead: {
          currentDistance: 100,
          velocity: 60,
          direction: 1,
          lastTriggerDistance: 0,
          trail: [],
          lastEval: {
            point: { x: 200, y: 250 },
            tangent: { x: 1, y: 0 },
            speed: 1,
            curvature: 0,
            segmentIndex: 0,
            t: 0.5,
            s: 100,
          },
          lastPitch: {
            frequency: 440,
            semitones: 12,
            scaleDegree: 7,
            noteName: 'A4',
            isSnapped: true,
          },
        },
        droneVoice: null,
      };

      renderer.setDarkMode(false);
      renderer.drawPlayhead(stroke, 1000);
      expect(recorder.fillCalls.some((c) => c.fillStyle === 'rgba(255, 255, 255, 0.94)')).toBe(true);
      expect(recorder.fillTextCalls.some((c) => c.fillStyle === '#1c1917')).toBe(true);

      recorder.fillCalls.length = 0;
      recorder.fillTextCalls.length = 0;

      renderer.setDarkMode(true);
      renderer.drawPlayhead(stroke, 1000);
      expect(recorder.fillCalls.some((c) => c.fillStyle === 'rgba(15, 23, 42, 0.86)')).toBe(true);
      expect(recorder.fillTextCalls.some((c) => c.fillStyle === '#f8fafc')).toBe(true);
    });

    it('advances updateAndDrawParticles smoothly independent of frame delta (dtSec)', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      const simA = createMockCanvasAndCtx();
      const simB = createMockCanvasAndCtx();
      const rendererA = new CanvasRenderer(simA.canvas);
      const rendererB = new CanvasRenderer(simB.canvas);

      rendererA.spawnSparks(100, 100, '#2563eb', 1, 1.0);
      rendererB.spawnSparks(100, 100, '#2563eb', 1, 1.0);

      // Same total elapsed time (1/30 s): 2 frames at 60fps vs 1 frame at 30fps
      rendererA.updateAndDrawParticles(1 / 60);
      simA.recorder.arcCalls.length = 0;
      rendererA.updateAndDrawParticles(1 / 60);

      rendererB.updateAndDrawParticles(1 / 30);

      expect(simA.recorder.arcCalls).toHaveLength(1);
      expect(simB.recorder.arcCalls).toHaveLength(1);

      const sparkA = simA.recorder.arcCalls[0];
      const sparkB = simB.recorder.arcCalls[0];
      expect(sparkA.radius).toBeCloseTo(sparkB.radius, 5);
      expect(sparkA.x).toBeCloseTo(sparkB.x, 0);
      expect(sparkA.y).toBeCloseTo(sparkB.y, 1);

      // Exhaust lifetime (0.28 + 0.5 * 0.25 = 0.405s)
      simB.recorder.arcCalls.length = 0;
      rendererB.updateAndDrawParticles(0.5);
      expect(simB.recorder.arcCalls).toHaveLength(0);
    });

    it('caches static layers via renderStaticLayer and invalidates on key change or invalidateStaticCache()', () => {
      const { canvas, recorder } = createMockCanvasAndCtx();
      const offscreenCtx = {
        setTransform: vi.fn(),
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
      };
      const offscreenCanvas = {
        width: 0,
        height: 0,
        getContext: vi.fn((id: string) => (id === '2d' ? offscreenCtx : null)),
      };
      vi.stubGlobal('document', {
        createElement: vi.fn((tag: string) => (tag === 'canvas' ? offscreenCanvas : null)),
      });

      const renderer = new CanvasRenderer(canvas);
      const drawStatic = vi.fn();

      // 1. First render: cache miss -> runs drawStatic on offscreen ctx and blits to main canvas
      expect(renderer.renderStaticLayer('scene-v1', drawStatic)).toBe(true);
      expect(drawStatic).toHaveBeenCalledTimes(1);
      expect(renderer.staticCacheMisses).toBe(1);
      expect(renderer.staticCacheHits).toBe(0);
      expect((recorder.ctx as unknown as { drawImage: ReturnType<typeof vi.fn> }).drawImage).toHaveBeenCalledTimes(1);
      expect((recorder.ctx as unknown as { drawImage: ReturnType<typeof vi.fn> }).drawImage).toHaveBeenCalledWith(
        offscreenCanvas,
        0,
        0
      );

      // 2. Identical cache key: cache hit -> does NOT call drawStatic again, increments staticCacheHits
      expect(renderer.renderStaticLayer('scene-v1', drawStatic)).toBe(true);
      expect(drawStatic).toHaveBeenCalledTimes(1);
      expect(renderer.staticCacheMisses).toBe(1);
      expect(renderer.staticCacheHits).toBe(1);
      expect((recorder.ctx as unknown as { drawImage: ReturnType<typeof vi.fn> }).drawImage).toHaveBeenCalledTimes(2);

      // 3. Explicit invalidation forces redraw on next call
      renderer.invalidateStaticCache();
      expect(renderer.renderStaticLayer('scene-v1', drawStatic)).toBe(true);
      expect(drawStatic).toHaveBeenCalledTimes(2);
      expect(renderer.staticCacheMisses).toBe(2);
      expect(renderer.staticCacheHits).toBe(1);

      // 4. Changed cache key forces redraw
      expect(renderer.renderStaticLayer('scene-v2', drawStatic)).toBe(true);
      expect(drawStatic).toHaveBeenCalledTimes(3);
      expect(renderer.staticCacheMisses).toBe(3);
      expect(renderer.staticCacheHits).toBe(1);
    });

    it('bounds particle ring buffer pool past 140 sparks and renders beat grid, marquee, and empty-canvas hint without throwing', () => {
      const { canvas, recorder } = createMockCanvasAndCtx();
      const renderer = new CanvasRenderer(canvas);

      // Spawn > 140 sparks; ring buffer overwrites cleanly without growing
      renderer.spawnSparks(200, 150, '#2563eb', 220, 1.0);
      const pool = (renderer as unknown as { particlePool: unknown[] }).particlePool;
      expect(pool).toHaveLength(140);

      renderer.updateAndDrawParticles(1 / 60);
      expect(recorder.arcCalls).toHaveLength(140);

      recorder.arcCalls.length = 0;
      renderer.updateAndDrawParticles(1.0);
      expect(recorder.arcCalls).toHaveLength(0);

      // Draw beat grid, marquee selection, and empty canvas ghost hint in both light and dark modes
      for (const dark of [false, true]) {
        renderer.setDarkMode(dark);
        expect(() => {
          renderer.drawBeatGrid(0.25, true, 4);
          renderer.drawBeatGrid(0.25, false, 4);
          renderer.drawMarqueeSelection({ x1: 20, y1: 30, x2: 200, y2: 180 });
          renderer.drawMarqueeSelection(null);
          renderer.drawEmptyCanvasGhostHint(1000, true);
          renderer.drawEmptyCanvasGhostHint(1000, false);
        }).not.toThrow();
      }
      expect(recorder.fillTextCalls.some((c) => c.text.includes('marquee-select'))).toBe(true);
    });
  });

  describe('SoundEngine & PulseVoice', () => {
    it('SoundEngine.getBandEnergies() computes normalized [0, 1] band energies and reuses the same pre-allocated object reference', async () => {
      class MockAudioContext {}
      vi.stubGlobal('AudioContext', MockAudioContext);

      const uninitEngine = new SoundEngine();
      const emptyRef1 = uninitEngine.getBandEnergies();
      const emptyRef2 = uninitEngine.getBandEnergies();
      expect(emptyRef1).toEqual({ low: 0, mid: 0, high: 0, master: 0 });
      expect(emptyRef2).toBe(emptyRef1);

      let frameBins = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        frameBins[i] = i < 5 ? 255 : i < 16 ? 128 : 51;
      }

      const mockCtx = {
        sampleRate: 44100,
        currentTime: 0,
        destination: {},
        createGain: () => ({ gain: makeTrackedParam(1), connect: vi.fn(), disconnect: vi.fn() }),
        createWaveShaper: () => ({ curve: null, oversample: 'none', connect: vi.fn(), disconnect: vi.fn() }),
        createDelay: () => ({ delayTime: makeTrackedParam(0), connect: vi.fn(), disconnect: vi.fn() }),
        createConvolver: () => ({ buffer: null, connect: vi.fn(), disconnect: vi.fn() }),
        createBuffer: (channels: number, length: number, sampleRate: number) => ({
          numberOfChannels: channels,
          length,
          sampleRate,
          getChannelData: () => new Float32Array(length),
        }),
        createBiquadFilter: () => ({
          type: 'lowpass',
          frequency: makeTrackedParam(1000),
          Q: makeTrackedParam(1),
          gain: makeTrackedParam(0),
          connect: vi.fn(),
          disconnect: vi.fn(),
        }),
        createChannelSplitter: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
        createChannelMerger: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
        createAnalyser: () => ({
          fftSize: 64,
          frequencyBinCount: 32,
          smoothingTimeConstant: 0.8,
          getByteFrequencyData: (arr: Uint8Array) => {
            arr.set(frameBins);
          },
          connect: vi.fn(),
          disconnect: vi.fn(),
        }),
      } as unknown as AudioContext;

      const engine = new SoundEngine();
      await engine.init(mockCtx);

      const first = engine.getBandEnergies();
      expect(first.low).toBeCloseTo(1.0, 5);
      expect(first.mid).toBeCloseTo(128 / 255, 5);
      expect(first.high).toBeCloseTo(51 / 255, 5);
      expect(first.master).toBeCloseTo((5 * 255 + 11 * 128 + 16 * 51) / (32 * 255), 5);
      for (const val of [first.low, first.mid, first.high, first.master]) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
      }

      // Update frequency bins and verify exact same object reference is mutated and returned
      frameBins.fill(0);
      frameBins[0] = 255;
      frameBins[10] = 255;
      frameBins[20] = 255;

      const second = engine.getBandEnergies();
      expect(second).toBe(first);
      expect(second.low).toBeCloseTo(1 / 5, 5);
      expect(second.mid).toBeCloseTo(1 / 11, 5);
      expect(second.high).toBeCloseTo(1 / 16, 5);
      expect(second.master).toBeCloseTo(3 / 32, 5);
    });

    it('PulseVoice.trigger scales note stop and decay duration monotonically with trailing articulation (0.2 < 1.0 < 2.5)', () => {
      const triggerTiming = (articulation: number, isStriped: boolean) => {
        const env = createVoiceAudioEnv();
        PulseVoice.trigger(
          440,
          isStriped,
          0.8,
          INSTRUMENTS.indigo,
          400,
          800,
          'panAndTone',
          0,
          0.4,
          1.0,
          1.0,
          env.mockEngine,
          2.0,
          0,
          1.0,
          0,
          articulation
        );
        const stopAt = (env.oscillators[0].stop as ReturnType<typeof vi.fn>).mock.calls[0][0] as number;
        const decayEnd = env.gains[0].gain.exponentialRampToValueAtTime.mock.calls[0][1] as number;
        return { stopAt, decayEnd };
      };

      for (const isStriped of [false, true]) {
        const short = triggerTiming(0.2, isStriped);
        const normal = triggerTiming(1.0, isStriped);
        const long = triggerTiming(2.5, isStriped);

        expect(short.decayEnd).toBeLessThan(normal.decayEnd);
        expect(normal.decayEnd).toBeLessThan(long.decayEnd);
        expect(short.stopAt).toBeLessThan(normal.stopAt);
        expect(normal.stopAt).toBeLessThan(long.stopAt);
      }
    });
  });

  describe('DroneVoice & DrumSynth', () => {
    it('routes DroneVoice harmony voices through harmonyFilter', () => {
      const env = createVoiceAudioEnv();
      const voice = new DroneVoice(env.mockEngine);

      voice.start(220, INSTRUMENTS.indigo, 0.8, 0.4, 1.0);
      voice.updateDual(220, 220, 1, 0, 0, 400, 800, 'panAndTone', 0.8, [220, 330, 440], [1, 0.6, 0.5], undefined, 1.1);

      const masterGain = env.gains[0];
      const harmonyFilter = env.filters.find((f) =>
        env.connections.some((c) => c.source === f && c.dest === masterGain)
      );
      expect(harmonyFilter).toBeDefined();

      // The last two oscillators created are the two chord harmony oscillators
      const harmonyOscs = env.oscillators.slice(-2);
      expect(harmonyOscs).toHaveLength(2);
      for (const hOsc of harmonyOscs) {
        const gainConn = env.connections.find((c) => c.source === hOsc);
        expect(gainConn).toBeDefined();
        const hGain = gainConn!.dest as TrackedAudioNode;
        expect(
          env.connections.some((c) => c.source === hGain && c.dest === harmonyFilter)
        ).toBe(true);
        expect(
          env.connections.some((c) => c.source === hGain && c.dest === masterGain)
        ).toBe(false);
      }
    });

    it('preserves prior stereo pan and modulation across DroneVoice.setInstrument', () => {
      const env = createVoiceAudioEnv();
      const voice = new DroneVoice(env.mockEngine);

      voice.start(220, INSTRUMENTS.indigo, 0.8, 0.4, 1.0);
      voice.update(220, 0.002, 680, 800, 'panAndTone');

      const panner = env.panners[0];
      expect(panner.pan.setTargetAtTime).toHaveBeenLastCalledWith(0.7, 2.0, 0.04);

      panner.pan.setTargetAtTime.mockClear();
      voice.setInstrument(INSTRUMENTS.violet);

      expect(panner.pan.setTargetAtTime).toHaveBeenCalledTimes(1);
      const [restoredPan] = panner.pan.setTargetAtTime.mock.calls[0] as [number];
      expect(restoredPan).toBeCloseTo(0.7, 5);
      expect(restoredPan).not.toBe(-1);
    });

    it('disconnects captured DroneVoice nodes on onended without calling setTimeout', () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const env = createVoiceAudioEnv();
      const voice = new DroneVoice(env.mockEngine);

      voice.start(220, INSTRUMENTS.indigo, 0.8, 0.4, 1.0);
      voice.updateDual(220, 220, 1, 0, 0, 400, 800, 'panAndTone', 0.8, [220, 330], [1, 0.6], undefined, 1.1);

      setTimeoutSpy.mockClear();
      voice.stop(0.2, 2.5);

      expect(setTimeoutSpy).not.toHaveBeenCalled();

      const osc1A = env.oscillators[0];
      expect(typeof osc1A.onended).toBe('function');

      for (const node of env.createdNodes) {
        expect(node.disconnect).not.toHaveBeenCalled();
      }

      osc1A.onended!();
      expect(osc1A.onended).toBeNull();

      // Oscillators, filters, bank gains, master/shaper/tone/panner, sends, and harmony nodes all disconnected
      for (const osc of env.oscillators) {
        expect(osc.disconnect).toHaveBeenCalledTimes(1);
      }
      for (const f of env.filters) {
        expect(f.disconnect).toHaveBeenCalledTimes(1);
      }
      expect(env.panners[0].disconnect).toHaveBeenCalledTimes(1);
      expect(env.createdSends[0].reverbSendGain.disconnect).toHaveBeenCalledTimes(1);
      expect(env.createdSends[0].delaySendGain.disconnect).toHaveBeenCalledTimes(1);
    });

    it('caches Float32Array curves in DroneVoice.createDriveAndLofiCurve for identical parameters', () => {
      const curve1 = DroneVoice.createDriveAndLofiCurve(0.42, 0.25, 512);
      const curve2 = DroneVoice.createDriveAndLofiCurve(0.42, 0.25, 512);
      const curveDifferent = DroneVoice.createDriveAndLofiCurve(0.85, 0.25, 512);

      expect(curve1).toBe(curve2);
      expect(curve1).not.toBe(curveDifferent);
    });

    it('attaches onended cleanup on DrumSynth triggers disconnecting panner and send gains', () => {
      const triggers: Array<{
        name: string;
        fire: (engine: SoundEngine) => void;
        sourceKind: 'osc' | 'buffer';
      }> = [
        {
          name: 'kick',
          sourceKind: 'osc',
          fire: (engine) => DrumSynth.triggerKick(0.9, 200, 800, 'panAndTone', 0, 0.3, engine),
        },
        {
          name: 'snare',
          sourceKind: 'buffer',
          fire: (engine) => DrumSynth.triggerSnare(0.9, 300, 800, 'panAndTone', 0, 0.3, engine),
        },
        {
          name: 'hihat',
          sourceKind: 'buffer',
          fire: (engine) => DrumSynth.triggerHiHat(true, 0.8, 500, 800, 'panAndTone', 0, 0.2, engine),
        },
        {
          name: 'clap',
          sourceKind: 'buffer',
          fire: (engine) => DrumSynth.triggerClap(0.8, 400, 800, 'panAndTone', 0, 0.5, engine),
        },
        {
          name: 'tom',
          sourceKind: 'osc',
          fire: (engine) => DrumSynth.triggerTom(140, 0.85, 450, 800, 'panAndTone', 0, 0.3, engine),
        },
      ];

      for (const t of triggers) {
        const env = createVoiceAudioEnv();
        t.fire(env.mockEngine);

        const source =
          t.sourceKind === 'osc' ? env.oscillators[0] : env.bufferSources[0];
        const panner = env.panners[0];
        const { reverbSendGain, delaySendGain } = env.createdSends[0];

        expect(typeof source.onended).toBe('function');
        expect(panner.disconnect).not.toHaveBeenCalled();
        expect(reverbSendGain.disconnect).not.toHaveBeenCalled();
        expect(delaySendGain.disconnect).not.toHaveBeenCalled();

        source.onended!();

        expect(source.onended).toBeNull();
        expect(panner.disconnect).toHaveBeenCalledTimes(1);
        expect(reverbSendGain.disconnect).toHaveBeenCalledTimes(1);
        expect(delaySendGain.disconnect).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('mp3Export.ts', () => {
    it('falls back to ScriptProcessorNode when workletModuleLoaded is set and AudioWorkletNode constructor throws, and disconnectNodes cleans up sourceNode', async () => {
      const workletCtor = vi.fn(() => {
        throw new Error('AudioWorkletNode construction failed');
      });
      vi.stubGlobal('AudioWorkletNode', workletCtor);
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-worklet');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      const scriptNode = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        onaudioprocess: null as ((e: AudioProcessingEvent) => void) | null,
      };
      const dummyGain = {
        gain: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      const masterOutputNode = {
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      const mockCtx = {
        sampleRate: 44100,
        destination: { kind: 'destination' },
        audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
        createScriptProcessor: vi.fn(() => scriptNode),
        createGain: vi.fn(() => dummyGain),
      } as unknown as AudioContext;

      const mockEngine = {
        isReady: true,
        context: mockCtx,
        masterOutputNode: masterOutputNode as unknown as GainNode,
      } as unknown as SoundEngine;

      await LiveRecorder.preloadWorklet(mockCtx);

      const recorder = new LiveRecorder();
      const started = recorder.start(mockEngine);

      expect(started).toBe(true);
      expect(recorder.recording).toBe(true);
      expect(workletCtor).toHaveBeenCalledTimes(1);
      expect(mockCtx.createScriptProcessor).toHaveBeenCalledWith(4096, 2, 2);
      expect(masterOutputNode.connect).toHaveBeenCalledWith(scriptNode);
      expect(scriptNode.onaudioprocess).not.toBeNull();

      recorder.cancel();

      expect(recorder.recording).toBe(false);
      expect(masterOutputNode.disconnect).toHaveBeenCalledWith(scriptNode);
      expect(scriptNode.disconnect).toHaveBeenCalledTimes(1);
      expect(dummyGain.disconnect).toHaveBeenCalledTimes(1);
      expect(scriptNode.onaudioprocess).toBeNull();
    });

    it('disconnects sourceNode from workletNode cleanly when AudioWorkletNode succeeds', async () => {
      const workletNode = {
        port: { onmessage: null as ((e: MessageEvent) => void) | null },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      vi.stubGlobal(
        'AudioWorkletNode',
        vi.fn(() => workletNode)
      );
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-worklet');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      const dummyGain = {
        gain: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      const masterOutputNode = {
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      const mockCtx = {
        sampleRate: 44100,
        destination: { kind: 'destination' },
        audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
        createScriptProcessor: vi.fn(),
        createGain: vi.fn(() => dummyGain),
      } as unknown as AudioContext;

      const mockEngine = {
        isReady: true,
        context: mockCtx,
        masterOutputNode: masterOutputNode as unknown as GainNode,
      } as unknown as SoundEngine;

      await LiveRecorder.preloadWorklet(mockCtx);
      const recorder = new LiveRecorder();
      recorder.start(mockEngine);

      expect(masterOutputNode.connect).toHaveBeenCalledWith(workletNode);
      expect(workletNode.port.onmessage).not.toBeNull();

      recorder.cancel();

      expect(masterOutputNode.disconnect).toHaveBeenCalledWith(workletNode);
      expect(workletNode.disconnect).toHaveBeenCalledTimes(1);
      expect(dummyGain.disconnect).toHaveBeenCalledTimes(1);
      expect(workletNode.port.onmessage).toBeNull();
    });

    it('simulateCompositionToAudioBuffer preserves live stroke IDs and trigger accumulators', async () => {
      const renderedBuffer = {
        sampleRate: 1000,
        length: 1000,
        numberOfChannels: 2,
        duration: 1,
        getChannelData: () => new Float32Array(1000),
      } as unknown as AudioBuffer;

      class MockOfflineCtx {
        public sampleRate: number;
        public currentTime = 0;
        public state = 'running';
        public destination = {};

        constructor(_channels: number, _length: number, sampleRate: number) {
          this.sampleRate = sampleRate;
        }
        public createGain = () => ({
          gain: makeTrackedParam(1),
          connect: vi.fn(),
          disconnect: vi.fn(),
        });
        public createWaveShaper = () => ({
          curve: null,
          oversample: 'none',
          connect: vi.fn(),
          disconnect: vi.fn(),
        });
        public createDelay = () => ({
          delayTime: makeTrackedParam(0),
          connect: vi.fn(),
          disconnect: vi.fn(),
        });
        public createConvolver = () => ({
          buffer: null,
          connect: vi.fn(),
          disconnect: vi.fn(),
        });
        public createBiquadFilter = () => ({
          type: 'lowpass',
          frequency: makeTrackedParam(1000),
          Q: makeTrackedParam(1),
          gain: makeTrackedParam(0),
          connect: vi.fn(),
          disconnect: vi.fn(),
        });
        public createChannelSplitter = () => ({ connect: vi.fn(), disconnect: vi.fn() });
        public createChannelMerger = () => ({ connect: vi.fn(), disconnect: vi.fn() });
        public createAnalyser = () => ({
          fftSize: 64,
          frequencyBinCount: 32,
          smoothingTimeConstant: 0.8,
          getByteFrequencyData: vi.fn(),
          connect: vi.fn(),
          disconnect: vi.fn(),
        });
        public createOscillator = () => ({
          type: 'sine',
          frequency: makeTrackedParam(440),
          detune: makeTrackedParam(0),
          start: vi.fn(),
          stop: vi.fn(),
          connect: vi.fn(),
          disconnect: vi.fn(),
          onended: null,
        });
        public createStereoPanner = () => ({
          pan: makeTrackedParam(0),
          connect: vi.fn(),
          disconnect: vi.fn(),
        });
        public createBuffer = (channels: number, length: number, sampleRate: number) => ({
          numberOfChannels: channels,
          length,
          sampleRate,
          getChannelData: () => new Float32Array(length),
        });
        public createBufferSource = () => ({
          buffer: null,
          start: vi.fn(),
          stop: vi.fn(),
          connect: vi.fn(),
          disconnect: vi.fn(),
          onended: null,
        });
        public startRendering = vi.fn().mockResolvedValue(renderedBuffer);
      }

      vi.stubGlobal('AudioContext', MockOfflineCtx);
      vi.stubGlobal('OfflineAudioContext', MockOfflineCtx);

      const liveEngine = new SoundEngine();
      await liveEngine.init(new MockOfflineCtx(2, 1000, 1000) as unknown as AudioContext);

      const liveSm = new StrokeManager(liveEngine);
      const quantizer = new ScaleQuantizer();

      const solidStroke = liveSm.addStroke(
        createHorizontalSpline(50, 450, 300),
        'solid',
        'indigo',
        120,
        quantizer,
        600
      );
      solidStroke.playhead.currentDistance = 123.5;
      solidStroke.playhead.lastTriggerDistance = 100;
      solidStroke.playhead.triggerDistanceAccum = 23.75;
      solidStroke.playhead.direction = -1;
      solidStroke.muted = true;

      const dottedStroke = liveSm.addStroke(
        createHorizontalSpline(80, 480, 220),
        'dotted',
        'amber',
        120,
        quantizer,
        600
      );
      dottedStroke.playhead.currentDistance = 42.25;
      dottedStroke.playhead.lastTriggerDistance = 32;
      dottedStroke.playhead.triggerDistanceAccum = 18.5;
      dottedStroke.playhead.direction = 1;
      dottedStroke.soloed = true;

      const importSpy = vi.spyOn(StrokeManager.prototype, 'importComposition');

      const capturedPreLoop: Array<{
        id: string;
        currentDistance: number;
        lastTriggerDistance: number;
        triggerDistanceAccum: number | undefined;
        direction: number;
        muted: boolean | undefined;
        soloed: boolean | undefined;
      }> = [];

      const origActivate = StrokeManager.prototype.activateAudioVoices;
      vi.spyOn(StrokeManager.prototype, 'activateAudioVoices').mockImplementation(function (
        this: StrokeManager
      ) {
        for (const s of this.activeStrokes) {
          capturedPreLoop.push({
            id: s.id,
            currentDistance: s.playhead.currentDistance,
            lastTriggerDistance: s.playhead.lastTriggerDistance,
            triggerDistanceAccum: s.playhead.triggerDistanceAccum,
            direction: s.playhead.direction,
            muted: s.muted,
            soloed: s.soloed,
          });
        }
        return origActivate.call(this);
      });

      const result = await simulateCompositionToAudioBuffer({
        durationSeconds: 1,
        strokeManager: liveSm,
        quantizer,
        canvasWidth: 800,
        canvasHeight: 600,
        sampleRate: 1000,
      });

      expect(result).toBe(renderedBuffer);
      expect(importSpy).toHaveBeenCalledWith(
        expect.anything(),
        quantizer,
        600,
        800,
        { preserveIds: true, randomizePlayheads: false }
      );

      expect(capturedPreLoop).toEqual([
        {
          id: solidStroke.id,
          currentDistance: 123.5,
          lastTriggerDistance: 100,
          triggerDistanceAccum: 23.75,
          direction: -1,
          muted: true,
          soloed: false,
        },
        {
          id: dottedStroke.id,
          currentDistance: 42.25,
          lastTriggerDistance: 32,
          triggerDistanceAccum: 18.5,
          direction: 1,
          muted: false,
          soloed: true,
        },
      ]);

      // Live strokes remain untouched
      expect(solidStroke.playhead.currentDistance).toBe(123.5);
      expect(solidStroke.playhead.triggerDistanceAccum).toBe(23.75);
      expect(dottedStroke.playhead.currentDistance).toBe(42.25);
      expect(dottedStroke.playhead.triggerDistanceAccum).toBe(18.5);
    });
  });
});
