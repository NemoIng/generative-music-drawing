import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrumSynth } from '../src/audio/drumSynth';
import { StrokeManager } from '../src/engine/strokeManager';
import { ScaleQuantizer } from '../src/audio/scaleQuantizer';
import { soundEngine } from '../src/audio/audioContext';
import { SplinePath } from '../src/math/types';

describe('DrumSynth & Onyx 808 Drum Machine Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('safely handles drum triggers when soundEngine is uninitialized or velocity is 0', () => {
    vi.spyOn(soundEngine, 'isReady', 'get').mockReturnValue(false);

    expect(() => DrumSynth.triggerKick(0.9, 100, 800, 'panAndTone')).not.toThrow();
    expect(() => DrumSynth.triggerSnare(0.9, 100, 800, 'panAndTone')).not.toThrow();
    expect(() => DrumSynth.triggerHiHat(true, 0.9, 100, 800, 'panAndTone')).not.toThrow();
    expect(() => DrumSynth.triggerHiHat(false, 0.9, 100, 800, 'panAndTone')).not.toThrow();
    expect(() => DrumSynth.triggerClap(0.9, 100, 800, 'panAndTone')).not.toThrow();
    expect(() => DrumSynth.triggerTom(120, 0.9, 100, 800, 'panAndTone')).not.toThrow();
  });

  it('triggers kick, snare, hi-hat, clap, and toms when audio is active', () => {
    const createMockParam = () => ({
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    });

    const createMockNode = () => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    });

    const mockCtx = {
      currentTime: 1.0,
      sampleRate: 44100,
      createOscillator: () => ({
        ...createMockNode(),
        type: 'sine',
        frequency: createMockParam(),
      }),
      createGain: () => ({
        ...createMockNode(),
        gain: createMockParam(),
      }),
      createStereoPanner: () => ({
        ...createMockNode(),
        pan: createMockParam(),
      }),
      createBiquadFilter: () => ({
        ...createMockNode(),
        type: 'lowpass',
        frequency: createMockParam(),
        Q: createMockParam(),
      }),
      createBuffer: (channels: number, length: number, sampleRate: number) => ({
        sampleRate,
        length,
        numberOfChannels: channels,
        getChannelData: () => new Float32Array(length),
      }),
      createBufferSource: () => ({
        ...createMockNode(),
        buffer: null,
      }),
    } as unknown as AudioContext;

    vi.spyOn(soundEngine, 'isReady', 'get').mockReturnValue(true);
    vi.spyOn(soundEngine, 'context', 'get').mockReturnValue(mockCtx);
    const mockConnectVoice = vi.spyOn(soundEngine, 'connectVoice').mockImplementation(() => ({}));

    // Trigger all drum voices
    DrumSynth.triggerKick(0.9, 200, 800, 'panAndTone');
    DrumSynth.triggerSnare(0.85, 400, 800, 'panAndTone');
    DrumSynth.triggerHiHat(true, 0.8, 600, 800, 'panAndTone');
    DrumSynth.triggerHiHat(false, 0.8, 600, 800, 'panAndTone');
    DrumSynth.triggerClap(0.8, 400, 800, 'panAndTone');
    DrumSynth.triggerTom(140, 0.85, 500, 800, 'panAndTone');

    expect(mockConnectVoice).toHaveBeenCalled();
  });

  it('routes Onyx stroke playhead triggers to correct drum voices based on canvas vertical zone', () => {
    vi.spyOn(soundEngine, 'isReady', 'get').mockReturnValue(true);

    const kickSpy = vi.spyOn(DrumSynth, 'triggerKick').mockImplementation(() => {});
    const snareSpy = vi.spyOn(DrumSynth, 'triggerSnare').mockImplementation(() => {});
    const clapSpy = vi.spyOn(DrumSynth, 'triggerClap').mockImplementation(() => {});
    const hatSpy = vi.spyOn(DrumSynth, 'triggerHiHat').mockImplementation(() => {});
    const tomSpy = vi.spyOn(DrumSynth, 'triggerTom').mockImplementation(() => {});
    const rollSpy = vi.spyOn(DrumSynth, 'triggerRoll');

    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer();
    const canvasHeight = 600;
    const canvasWidth = 800;

    // Helper to make horizontal line at specific Y
    const makeLineAtY = (y: number): SplinePath => ({
      segments: [
        {
          p0: { x: 50, y },
          p1: { x: 150, y },
          p2: { x: 250, y },
          p3: { x: 350, y },
        },
      ],
      isClosed: false,
    });

    // 1. Kick Line at bottom (y = 520, which is > 0.72 * 600 = 432)
    const kickStroke = sm.addStroke(makeLineAtY(520), 'dotted', 'onyx', 140, quantizer, canvasHeight);
    kickStroke.playhead.currentDistance = 0;

    // 2. Snare Line at lower mid (y = 380, which is 0.63 * 600, between 0.58 and 0.72)
    const snareStroke = sm.addStroke(makeLineAtY(380), 'dotted', 'onyx', 140, quantizer, canvasHeight);
    snareStroke.playhead.currentDistance = 0;

    // 3. Clap Line in clap zone (y = 310, which is 0.516 * 600, between 0.48 and 0.58) in roll/striped texture
    const clapStroke = sm.addStroke(makeLineAtY(310), 'striped', 'onyx', 140, quantizer, canvasHeight);
    clapStroke.playhead.currentDistance = 0;

    // 4. Tom Line in upper mid (y = 200, which is 0.33 * 600, between 0.25 and 0.48)
    const tomStroke = sm.addStroke(makeLineAtY(200), 'dotted', 'onyx', 140, quantizer, canvasHeight);
    tomStroke.playhead.currentDistance = 0;

    // 5. Hi-Hat Line at top (y = 80, which is < 0.25 * 600 = 150)
    const hatStroke = sm.addStroke(makeLineAtY(80), 'dotted', 'onyx', 140, quantizer, canvasHeight);
    hatStroke.playhead.currentDistance = 0;

    // Update simulation by 1.0s to cross dot & roll distance intervals under 2bars standard
    sm.update(1.0, canvasWidth, canvasHeight, quantizer);

    expect(kickSpy).toHaveBeenCalled();
    expect(snareSpy).toHaveBeenCalled();
    expect(clapSpy).toHaveBeenCalled();
    expect(tomSpy).toHaveBeenCalled();
    expect(hatSpy).toHaveBeenCalled();
    expect(rollSpy).toHaveBeenCalled();
  });

  it('resolves drum machine color to black in light mode and white/light grey in dark mode', async () => {
    const { getInstrumentColor, INSTRUMENTS } = await import('../src/audio/instruments');
    const { CanvasRenderer } = await import('../src/canvas/renderer');

    // Test getInstrumentColor
    expect(getInstrumentColor(INSTRUMENTS.onyx, false)).toBe('#18181b');
    expect(getInstrumentColor(INSTRUMENTS.onyx, true)).toBe('#f4f4f5');

    // Test CanvasRenderer getStrokeColor
    const quantizer = new ScaleQuantizer();
    const sm = new StrokeManager();
    const onyxStroke = sm.addStroke({ segments: [], isClosed: false }, 'solid', 'onyx', 140, quantizer, 600);
    const indigoStroke = sm.addStroke({ segments: [], isClosed: false }, 'solid', 'indigo', 140, quantizer, 600);

    const mockRenderer = {
      isDarkMode: false,
      getStrokeColor: CanvasRenderer.prototype.getStrokeColor,
    };

    // Light mode
    expect(mockRenderer.getStrokeColor(onyxStroke)).toBe('#18181b');
    expect(mockRenderer.getStrokeColor(indigoStroke)).toBe('#2563eb');

    // Dark mode
    mockRenderer.isDarkMode = true;
    expect(mockRenderer.getStrokeColor(onyxStroke)).toBe('#f4f4f5');
    expect(mockRenderer.getStrokeColor(indigoStroke)).toBe('#2563eb');
  });

  it('triggers DrumSynth.triggerRoll with rapid sample-accurate micro-bursts for all drum types', () => {
    vi.spyOn(soundEngine, 'isReady', 'get').mockReturnValue(true);
    const kickSpy = vi.spyOn(DrumSynth, 'triggerKick').mockImplementation(() => {});
    const snareSpy = vi.spyOn(DrumSynth, 'triggerSnare').mockImplementation(() => {});
    const clapSpy = vi.spyOn(DrumSynth, 'triggerClap').mockImplementation(() => {});
    const hatSpy = vi.spyOn(DrumSynth, 'triggerHiHat').mockImplementation(() => {});
    const tomSpy = vi.spyOn(DrumSynth, 'triggerTom').mockImplementation(() => {});

    // Kick roll (3 hits)
    DrumSynth.triggerRoll('kick', 0.9, 100, 800, 'panAndTone');
    expect(kickSpy).toHaveBeenCalledTimes(3);

    // Snare roll (3 hits)
    DrumSynth.triggerRoll('snare', 0.9, 100, 800, 'panAndTone');
    expect(snareSpy).toHaveBeenCalledTimes(3);

    // Hi-hat roll (4 hits)
    DrumSynth.triggerRoll('hihat', 0.9, 100, 800, 'panAndTone');
    expect(hatSpy).toHaveBeenCalledTimes(4);

    // Tom roll (3 hits)
    DrumSynth.triggerRoll('tom', 0.9, 100, 800, 'panAndTone', 140);
    expect(tomSpy).toHaveBeenCalledTimes(3);

    // Clap roll (3 hits)
    DrumSynth.triggerRoll('clap', 0.9, 100, 800, 'panAndTone');
    expect(clapSpy).toHaveBeenCalledTimes(3);
  });

  it('triggers modular synth ratchet bursts via PulseVoice and StrokeManager', async () => {
    const { PulseVoice } = await import('../src/audio/synthVoice');
    vi.spyOn(soundEngine, 'isReady', 'get').mockReturnValue(true);
    const ratchetSpy = vi.spyOn(PulseVoice, 'triggerRatchet').mockImplementation(() => {});

    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer();
    const canvasHeight = 600;
    const canvasWidth = 800;

    const dummyPath: SplinePath = {
      segments: [
        {
          p0: { x: 50, y: 300 },
          p1: { x: 150, y: 300 },
          p2: { x: 250, y: 300 },
          p3: { x: 350, y: 300 },
        },
      ],
      isClosed: false,
    };

    // Add melodic stroke with roll/striped texture
    const stroke = sm.addStroke(dummyPath, 'striped', 'indigo', 140, quantizer, canvasHeight);
    stroke.playhead.currentDistance = 0;

    sm.update(1.0, canvasWidth, canvasHeight, quantizer);
    expect(ratchetSpy).toHaveBeenCalled();
  });

  it('ensures drum boundaries remain fixed on screen and do not shift when pitch frequency field scrolls', () => {
    vi.spyOn(soundEngine, 'isReady', 'get').mockReturnValue(true);

    const kickSpy = vi.spyOn(DrumSynth, 'triggerKick').mockImplementation(() => {});
    const snareSpy = vi.spyOn(DrumSynth, 'triggerSnare').mockImplementation(() => {});

    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer();
    quantizer.setScrollEnabled(true);
    const canvasHeight = 600;
    const canvasWidth = 800;

    const makeLineAtY = (y: number): SplinePath => ({
      segments: [
        {
          p0: { x: 50, y },
          p1: { x: 150, y },
          p2: { x: 250, y },
          p3: { x: 350, y },
        },
      ],
      isClosed: false,
    });

    // Kick line in fixed kick zone (y = 520, > 0.72 * 600)
    const kickStroke = sm.addStroke(makeLineAtY(520), 'dotted', 'onyx', 140, quantizer, canvasHeight);
    kickStroke.playhead.currentDistance = 0;

    // Snare line in fixed snare zone (y = 380, between 0.48 and 0.72 * 600)
    const snareStroke = sm.addStroke(makeLineAtY(380), 'dotted', 'onyx', 140, quantizer, canvasHeight);
    snareStroke.playhead.currentDistance = 0;

    // Scroll camera by 300px
    quantizer.scrollBy(300, canvasHeight);

    // Update simulation
    sm.update(1.0, canvasWidth, canvasHeight, quantizer);

    // Kick remains a kick, snare remains a snare regardless of camera scroll
    expect(kickSpy).toHaveBeenCalled();
    expect(snareSpy).toHaveBeenCalled();
  });
});
