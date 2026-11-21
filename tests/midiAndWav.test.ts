import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MidiController,
  freqToMidiNote,
  drumZoneToGmNote,
} from '../src/audio/midiController';
import {
  encodeAudioBufferToWav,
  simulateAndExportWav,
  simulateAndExportStems,
} from '../src/audio/wavExport';
import { SoundEngine } from '../src/audio/audioContext';
import { StrokeManager } from '../src/engine/strokeManager';
import { ScaleQuantizer } from '../src/audio/scaleQuantizer';
import type { SplinePath } from '../src/math/types';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function createHorizontalSpline(x0 = 60, x1 = 420, y = 240): SplinePath {
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

function readAscii(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(view.getUint8(offset + i));
  }
  return out;
}

interface MockParam {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  setTargetAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
}

function makeMockParam(initial = 0): MockParam {
  const param: MockParam = {
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

function createMockAudioBuffer(
  channels: number,
  length: number,
  sampleRate: number,
  channelData?: Float32Array[]
): AudioBuffer {
  const arrays =
    channelData ??
    Array.from({ length: channels }, (_, ch) => {
      const arr = new Float32Array(length);
      for (let i = 0; i < length; i++) {
        arr[i] = Math.sin((2 * Math.PI * (ch === 0 ? 440 : 554.37) * i) / sampleRate) * 0.4;
      }
      return arr;
    });

  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (ch: number) => arrays[ch] ?? arrays[0],
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer;
}

class MockOfflineAudioContext {
  public sampleRate: number;
  public length: number;
  public numberOfChannels: number;
  public currentTime = 0;
  public state = 'running';
  public destination = {};

  constructor(numberOfChannels = 2, length = 1000, sampleRate = 1000) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
  }

  public createGain = () => ({
    gain: makeMockParam(1),
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  public createWaveShaper = () => ({
    curve: null as Float32Array | null,
    oversample: 'none' as OverSampleType,
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  public createDelay = () => ({
    delayTime: makeMockParam(0),
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  public createConvolver = () => ({
    buffer: null as AudioBuffer | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  public createBiquadFilter = () => ({
    type: 'lowpass' as BiquadFilterType,
    frequency: makeMockParam(1000),
    Q: makeMockParam(1),
    gain: makeMockParam(0),
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  public createChannelSplitter = () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  public createChannelMerger = () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  public createAnalyser = () => ({
    fftSize: 64,
    frequencyBinCount: 32,
    smoothingTimeConstant: 0.8,
    getByteFrequencyData: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  public createOscillator = () => ({
    type: 'sine' as OscillatorType,
    frequency: makeMockParam(440),
    detune: makeMockParam(0),
    start: vi.fn(),
    stop: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    onended: null as (() => void) | null,
  });

  public createStereoPanner = () => ({
    pan: makeMockParam(0),
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  public createBuffer = (channels: number, length: number, sampleRate: number) =>
    createMockAudioBuffer(
      channels,
      length,
      sampleRate,
      Array.from({ length: channels }, () => new Float32Array(length))
    );

  public createBufferSource = () => ({
    buffer: null as AudioBuffer | null,
    start: vi.fn(),
    stop: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    onended: null as (() => void) | null,
  });

  public startRendering = vi.fn(async () =>
    createMockAudioBuffer(this.numberOfChannels, this.length, this.sampleRate)
  );
}

interface MockMidiOutput {
  id: string;
  name: string;
  manufacturer: string;
  send: ReturnType<typeof vi.fn>;
}

interface MockMidiInput {
  id: string;
  name: string;
  manufacturer: string;
  onmidimessage: ((event: MIDIMessageEvent) => void) | null;
}

describe('Web MIDI Controller & Lossless WAV / Stems Export', () => {
  let memoryStorage: Storage;

  beforeEach(() => {
    memoryStorage = createMemoryStorage();
    vi.stubGlobal('localStorage', memoryStorage);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('Web MIDI (src/audio/midiController.ts)', () => {
    it('freqToMidiNote maps A4 (440 Hz) to 69, C4 (261.63 Hz) to 60, and stays clamped in [0, 127]', () => {
      expect(freqToMidiNote(440)).toBe(69);
      expect(freqToMidiNote(261.63)).toBe(60);

      const lowNote = freqToMidiNote(0);
      const negNote = freqToMidiNote(-200);
      const highNote = freqToMidiNote(50000);

      expect(lowNote).toBeGreaterThanOrEqual(0);
      expect(lowNote).toBeLessThanOrEqual(127);
      expect(lowNote).toBe(15); // 20 Hz floor -> MIDI note 15
      expect(negNote).toBe(15);
      expect(highNote).toBe(127);
    });

    it('drumZoneToGmNote maps kick, snare, clap, hihat, and low/mid/high toms to GM percussion notes', () => {
      expect(drumZoneToGmNote('kick')).toBe(36);
      expect(drumZoneToGmNote('snare')).toBe(38);
      expect(drumZoneToGmNote('clap')).toBe(39);
      expect(drumZoneToGmNote('hihat')).toBe(42);

      // Low (< 140 Hz), Mid (140..179 Hz), High (>= 180 Hz)
      expect(drumZoneToGmNote('tom', 110)).toBe(45);
      expect(drumZoneToGmNote('tom')).toBe(45); // default 120 Hz
      expect(drumZoneToGmNote('tom', 150)).toBe(47);
      expect(drumZoneToGmNote('tom', 200)).toBe(48);
    });

    it('falls back cleanly when navigator.requestMIDIAccess is undefined', async () => {
      vi.stubGlobal('navigator', {});

      const ctrl = new MidiController();
      expect(ctrl.isSupported()).toBe(false);
      expect(ctrl.isEnabled()).toBe(false);

      const res = await ctrl.enable();
      expect(res).toEqual({ supported: false, outputs: [], inputs: [] });
      expect(ctrl.isEnabled()).toBe(false);
      expect(ctrl.getOutputs()).toEqual([]);
      expect(ctrl.getInputs()).toEqual([]);
    });

    describe('with mocked MIDIAccess output and input ports', () => {
      let mockOutput: MockMidiOutput;
      let mockInput: MockMidiInput;
      let mockAccess: {
        outputs: Map<string, MIDIOutput>;
        inputs: Map<string, MIDIInput>;
        onstatechange: (() => void) | null;
      };
      let ctrl: MidiController;

      beforeEach(async () => {
        vi.useFakeTimers();
        vi.spyOn(performance, 'now').mockImplementation(() => Date.now());

        mockOutput = {
          id: 'out-1',
          name: 'Virtual Synth Out',
          manufacturer: 'HarmonicTest',
          send: vi.fn(),
        };
        mockInput = {
          id: 'in-1',
          name: 'Virtual Controller In',
          manufacturer: 'HarmonicTest',
          onmidimessage: null,
        };

        mockAccess = {
          outputs: new Map([['out-1', mockOutput as unknown as MIDIOutput]]),
          inputs: new Map([['in-1', mockInput as unknown as MIDIInput]]),
          onstatechange: null,
        };

        vi.stubGlobal('navigator', {
          requestMIDIAccess: vi.fn().mockResolvedValue(mockAccess),
        });

        ctrl = new MidiController();
        expect(ctrl.isSupported()).toBe(true);
        const result = await ctrl.enable();
        expect(result.supported).toBe(true);
        expect(result.outputs).toHaveLength(1);
        expect(result.inputs).toHaveLength(1);
        expect(ctrl.isEnabled()).toBe(true);
      });

      it('sendPulseNote emits Note On, schedules Note Off via timers, and routes Onyx to channel index 9 (Ch 10) in auto mode', () => {
        ctrl.sendPulseNote('indigo', 440, 0.8, 120);

        expect(mockOutput.send).toHaveBeenCalledTimes(1);
        expect(mockOutput.send).toHaveBeenLastCalledWith([0x90 | 0, 69, 102]);

        vi.advanceTimersByTime(119);
        expect(mockOutput.send).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(1);
        expect(mockOutput.send).toHaveBeenCalledTimes(2);
        expect(mockOutput.send).toHaveBeenLastCalledWith([0x80 | 0, 69, 0]);

        mockOutput.send.mockClear();

        // Onyx in 'auto' mode -> channel index 9 (MIDI Ch 10), GM snare note 38
        ctrl.sendPulseNote('onyx', 440, 1.0, 80, true, 'snare');
        expect(mockOutput.send).toHaveBeenCalledTimes(1);
        expect(mockOutput.send).toHaveBeenLastCalledWith([0x90 | 9, 38, 127]);

        vi.advanceTimersByTime(80);
        expect(mockOutput.send).toHaveBeenCalledTimes(2);
        expect(mockOutput.send).toHaveBeenLastCalledWith([0x80 | 9, 38, 0]);
      });

      it('updateDroneNote switches pitches cleanly, throttles CC10/CC1/CC74 updates, and stopDroneNote / allNotesOff clear notes & CC 123', () => {
        // Ensure performance.now() is at least 40ms past initial lastCcTime=0
        vi.advanceTimersByTime(100);

        ctrl.updateDroneNote('drone-1', 'amber', 440, 0.8, 0.5, 0.0025, 0.75);
        expect(mockOutput.send.mock.calls).toEqual([
          [[0x90 | 1, 69, 102]],
          [[0xb0 | 1, 10, 64]],
          [[0xb0 | 1, 1, 64]],
          [[0xb0 | 1, 74, 95]],
        ]);

        // Within 40ms throttle window with same pitch -> no CC messages emitted
        mockOutput.send.mockClear();
        vi.advanceTimersByTime(20);
        ctrl.updateDroneNote('drone-1', 'amber', 440, 0.8, 0.9, 0.005, 0.25);
        expect(mockOutput.send).not.toHaveBeenCalled();

        // Past 40ms window with new pitch (C4 = 261.63 Hz -> note 60) -> Note Off old, Note On new, then CCs
        vi.advanceTimersByTime(25);
        ctrl.updateDroneNote('drone-1', 'amber', 261.63, 0.8, 1.0, 0.005, 0.0);
        expect(mockOutput.send.mock.calls).toEqual([
          [[0x80 | 1, 69, 0]],
          [[0x90 | 1, 60, 102]],
          [[0xb0 | 1, 10, 127]],
          [[0xb0 | 1, 1, 127]],
          [[0xb0 | 1, 74, 0]],
        ]);

        // stopDroneNote emits Note Off for the active drone note
        mockOutput.send.mockClear();
        ctrl.stopDroneNote('drone-1');
        expect(mockOutput.send.mock.calls).toEqual([[[0x80 | 1, 60, 0]]]);

        // Stopping an already stopped drone is a no-op
        mockOutput.send.mockClear();
        ctrl.stopDroneNote('drone-1');
        expect(mockOutput.send).not.toHaveBeenCalled();

        // Start a fresh drone and a pending pulse, then verify allNotesOff
        ctrl.updateDroneNote('drone-2', 'spruce', 440, 0.5, 0.2, 0, 0.5);
        ctrl.sendPulseNote('indigo', 261.63, 0.7, 500);
        mockOutput.send.mockClear();

        ctrl.allNotesOff();

        const calls = mockOutput.send.mock.calls.map((args) => args[0] as number[]);
        expect(calls).toContainEqual([0x80 | 0, 60, 0]);
        expect(calls).toContainEqual([0x80 | 2, 69, 0]);
        for (let ch = 0; ch < 16; ch++) {
          expect(calls).toContainEqual([0xb0 | ch, 123, 0]);
        }

        // Cancelled pending pulse timer must not fire Note Off later
        mockOutput.send.mockClear();
        vi.advanceTimersByTime(600);
        expect(mockOutput.send).not.toHaveBeenCalled();
      });

      it('handleMidiMessage dispatches default CCs and startMidiLearn learns & persists mappings in localStorage', () => {
        const onControlChange = vi.fn();
        ctrl.onControlChange = onControlChange;

        // Trigger default CC 1 ('reverb') via the attached virtual input port listener
        expect(mockInput.onmidimessage).not.toBeNull();
        mockInput.onmidimessage!({
          data: new Uint8Array([0xb0, 1, 64]),
        } as unknown as MIDIMessageEvent);

        expect(onControlChange).toHaveBeenCalledTimes(1);
        expect(onControlChange).toHaveBeenCalledWith('reverb', 64 / 127, 1);

        // Non-CC MIDI message (e.g. Note On) is ignored
        onControlChange.mockClear();
        ctrl.handleMidiMessage(new Uint8Array([0x90, 60, 100]));
        expect(onControlChange).not.toHaveBeenCalled();

        // Learn CC 21 -> 'swing'
        const onLearned = vi.fn();
        ctrl.startMidiLearn('swing', onLearned);
        expect(ctrl.getLearningTarget()).toBe('swing');

        ctrl.handleMidiMessage(new Uint8Array([0xb2, 21, 100]));

        expect(onLearned).toHaveBeenCalledTimes(1);
        expect(onLearned).toHaveBeenCalledWith(21, 'swing');
        expect(ctrl.getLearningTarget()).toBeNull();
        expect(onControlChange).not.toHaveBeenCalled();

        const storedRaw = memoryStorage.getItem('harmonic_midi_cc_map');
        expect(storedRaw).not.toBeNull();
        const storedMap = JSON.parse(storedRaw!) as Record<string, string>;
        expect(storedMap['21']).toBe('swing');
        expect(storedMap['15']).toBeUndefined();

        // Subsequent CC 21 dispatches 'swing'
        ctrl.handleMidiMessage(new Uint8Array([0xb0, 21, 127]));
        expect(onControlChange).toHaveBeenCalledTimes(1);
        expect(onControlChange).toHaveBeenCalledWith('swing', 1, 21);

        // A newly constructed MidiController loads the persisted CC mapping
        const reloaded = new MidiController();
        expect(reloaded.getCcMap()[21]).toBe('swing');
      });
    });
  });

  describe('Lossless WAV & Stems Export (src/audio/wavExport.ts)', () => {
    it('encodeAudioBufferToWav writes a valid 44-byte RIFF/WAVE PCM header and clamped 16-bit interleaved samples', async () => {
      const sampleRate = 44100;
      const numFrames = 4;
      const numChannels = 2;
      const left = new Float32Array([0.0, 1.0, -1.0, 1.5]);
      const right = new Float32Array([0.5, -0.5, -2.0, 0.0]);
      const buffer = createMockAudioBuffer(numChannels, numFrames, sampleRate, [left, right]);

      const blob = encodeAudioBufferToWav(buffer);
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('audio/wav');

      const dataByteLength = numFrames * numChannels * 2;
      expect(blob.size).toBe(44 + dataByteLength);

      const arrayBuf = await blob.arrayBuffer();
      const view = new DataView(arrayBuf);

      expect(readAscii(view, 0, 4)).toBe('RIFF');
      expect(view.getUint32(4, true)).toBe(36 + dataByteLength);
      expect(readAscii(view, 8, 4)).toBe('WAVE');
      expect(readAscii(view, 12, 4)).toBe('fmt ');
      expect(view.getUint32(16, true)).toBe(16);
      expect(view.getUint16(20, true)).toBe(1); // PCM format
      expect(view.getUint16(22, true)).toBe(numChannels);
      expect(view.getUint32(24, true)).toBe(sampleRate);
      expect(view.getUint32(28, true)).toBe(sampleRate * numChannels * 2);
      expect(view.getUint16(32, true)).toBe(numChannels * 2);
      expect(view.getUint16(34, true)).toBe(16);
      expect(readAscii(view, 36, 4)).toBe('data');
      expect(view.getUint32(40, true)).toBe(dataByteLength);

      const interleavedSamples = [
        view.getInt16(44, true), // L[0] = 0.0
        view.getInt16(46, true), // R[0] = 0.5
        view.getInt16(48, true), // L[1] = 1.0
        view.getInt16(50, true), // R[1] = -0.5
        view.getInt16(52, true), // L[2] = -1.0
        view.getInt16(54, true), // R[2] = -2.0 (clamped)
        view.getInt16(56, true), // L[3] = 1.5 (clamped)
        view.getInt16(58, true), // R[3] = 0.0
      ];

      expect(interleavedSamples).toEqual([
        0,
        Math.round(0.5 * 0x7fff),
        32767,
        Math.round(-0.5 * 0x8000),
        -32768,
        -32768,
        32767,
        0,
      ]);
    });

    it('simulateAndExportWav and simulateAndExportStems render WAV mixdown and per-audible-stroke stems with progress callbacks', async () => {
      vi.stubGlobal('AudioContext', MockOfflineAudioContext);
      vi.stubGlobal('OfflineAudioContext', MockOfflineAudioContext);

      const liveEngine = new SoundEngine();
      await liveEngine.init(new MockOfflineAudioContext(2, 1000, 1000) as unknown as AudioContext);

      const strokeManager = new StrokeManager(liveEngine);
      const quantizer = new ScaleQuantizer();

      const audibleIndigo = strokeManager.addStroke(
        createHorizontalSpline(50, 450, 260),
        'solid',
        'indigo',
        120,
        quantizer,
        600
      );
      const audibleAmber = strokeManager.addStroke(
        createHorizontalSpline(80, 480, 180),
        'dotted',
        'amber',
        120,
        quantizer,
        600
      );
      const mutedSpruce = strokeManager.addStroke(
        createHorizontalSpline(100, 500, 380),
        'solid',
        'spruce',
        120,
        quantizer,
        600
      );
      strokeManager.setStrokeMuted(mutedSpruce.id, true);

      const mixProgress = vi.fn();
      const mixBlob = await simulateAndExportWav({
        durationSeconds: 1,
        strokeManager,
        quantizer,
        canvasWidth: 800,
        canvasHeight: 600,
        sampleRate: 1000,
        onProgress: mixProgress,
      });

      expect(mixBlob).toBeInstanceOf(Blob);
      expect(mixBlob.type).toBe('audio/wav');
      expect(mixBlob.size).toBe(44 + 1000 * 2 * 2);

      const mixView = new DataView(await mixBlob.arrayBuffer());
      expect(readAscii(mixView, 0, 4)).toBe('RIFF');
      expect(readAscii(mixView, 8, 4)).toBe('WAVE');
      expect(mixProgress).toHaveBeenCalledWith('Encoding lossless WAV audio...', 80);
      expect(mixProgress).toHaveBeenCalledWith('Complete!', 100);

      const stemProgress = vi.fn();
      const stems = await simulateAndExportStems(
        {
          durationSeconds: 1,
          strokeManager,
          quantizer,
          canvasWidth: 800,
          canvasHeight: 600,
          sampleRate: 1000,
          onProgress: stemProgress,
        },
        'wav'
      );

      expect(stems).toHaveLength(2);
      expect(stems.map((s) => s.strokeId)).toEqual([audibleIndigo.id, audibleAmber.id]);
      expect(stems.map((s) => s.instrumentId)).toEqual(['indigo', 'amber']);
      expect(stems[0].filename).toBe('composition_stem-01_indigo.wav');
      expect(stems[1].filename).toBe('composition_stem-02_amber.wav');

      for (const stem of stems) {
        expect(stem.blob).toBeInstanceOf(Blob);
        expect(stem.blob.type).toBe('audio/wav');
        expect(stem.blob.size).toBe(44 + 1000 * 2 * 2);
        const view = new DataView(await stem.blob.arrayBuffer());
        expect(readAscii(view, 0, 4)).toBe('RIFF');
        expect(readAscii(view, 8, 4)).toBe('WAVE');
      }

      expect(stemProgress).toHaveBeenCalledWith('Rendering stem 1/2...', 0);
      expect(stemProgress).toHaveBeenCalledWith('Rendering stem 2/2...', 48);
      expect(stemProgress).toHaveBeenCalledWith('Complete!', 100);

      // Throws if no strokes are audible
      strokeManager.setStrokeMuted(audibleIndigo.id, true);
      strokeManager.setStrokeMuted(audibleAmber.id, true);
      await expect(
        simulateAndExportStems(
          {
            durationSeconds: 1,
            strokeManager,
            quantizer,
            canvasWidth: 800,
            canvasHeight: 600,
            sampleRate: 1000,
          },
          'wav'
        )
      ).rejects.toThrow('No audible layers to export.');
    });
  });
});
