import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrumSynth } from '../src/audio/drumSynth';
import { StrokeManager } from '../src/engine/strokeManager';
import { ScaleQuantizer } from '../src/audio/scaleQuantizer';
import { soundEngine } from '../src/audio/audioContext';
import { buildTemplateStrokes } from '../src/audio/templates';
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
    const mockConnectVoice = vi.spyOn(soundEngine, 'connectVoice').mockImplementation(() => {});

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

    // 2. Snare Line at lower mid (y = 360, which is 0.60 * 600, between 0.48 and 0.72)
    const snareStroke = sm.addStroke(makeLineAtY(360), 'dotted', 'onyx', 140, quantizer, canvasHeight);
    snareStroke.playhead.currentDistance = 0;

    // 3. Clap Line at lower mid in striped texture
    const clapStroke = sm.addStroke(makeLineAtY(360), 'striped', 'onyx', 140, quantizer, canvasHeight);
    clapStroke.playhead.currentDistance = 0;

    // 4. Tom Line in upper mid (y = 200, which is 0.33 * 600, between 0.25 and 0.48)
    const tomStroke = sm.addStroke(makeLineAtY(200), 'dotted', 'onyx', 140, quantizer, canvasHeight);
    tomStroke.playhead.currentDistance = 0;

    // 5. Hi-Hat Line at top (y = 80, which is < 0.25 * 600 = 150)
    const hatStroke = sm.addStroke(makeLineAtY(80), 'dotted', 'onyx', 140, quantizer, canvasHeight);
    hatStroke.playhead.currentDistance = 0;

    // Update simulation by 0.5s to cross dot & stripe distance intervals
    sm.update(0.5, canvasWidth, canvasHeight, quantizer);

    expect(kickSpy).toHaveBeenCalled();
    expect(snareSpy).toHaveBeenCalled();
    expect(clapSpy).toHaveBeenCalled();
    expect(tomSpy).toHaveBeenCalled();
    expect(hatSpy).toHaveBeenCalled();
  });

  it('builds the Analog 808 Groove template with 5 synchronized tracks', () => {
    const quantizer = new ScaleQuantizer();
    const strokes = buildTemplateStrokes('electro808', 1000, 700, quantizer);

    expect(strokes.length).toBe(5);

    // Verify drum tracks exist in the template
    const onyxTracks = strokes.filter((s) => s.instrumentId === 'onyx');
    expect(onyxTracks.length).toBe(3);

    // Verify synth tracks exist (slate bass & violet lead)
    const slateTracks = strokes.filter((s) => s.instrumentId === 'slate');
    expect(slateTracks.length).toBe(1);

    const violetTracks = strokes.filter((s) => s.instrumentId === 'violet');
    expect(violetTracks.length).toBe(1);
  });
});
