import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SoundEngine, type ReverbType } from '../src/audio/audioContext';

interface MockAudioParam {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  setTargetAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
}

interface MockNode {
  kind: string;
  id: number;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

interface MockGainNode extends MockNode {
  kind: 'GainNode';
  gain: MockAudioParam;
}

interface MockSplitterNode extends MockNode {
  kind: 'ChannelSplitterNode';
  numberOfOutputs: number;
}

interface MockMergerNode extends MockNode {
  kind: 'ChannelMergerNode';
  numberOfInputs: number;
}

interface MockBiquadFilterNode extends MockNode {
  kind: 'BiquadFilterNode';
  type: BiquadFilterType;
  frequency: MockAudioParam;
  Q: MockAudioParam;
  gain: MockAudioParam;
}

interface MockWaveShaperNode extends MockNode {
  kind: 'WaveShaperNode';
  curve: Float32Array | null;
  oversample: OverSampleType;
}

interface MockConvolverNode extends MockNode {
  kind: 'ConvolverNode';
  buffer: AudioBuffer | null;
}

interface MockDelayNode extends MockNode {
  kind: 'DelayNode';
  maxDelayTime: number;
  delayTime: MockAudioParam;
}

interface MockAnalyserNode extends MockNode {
  kind: 'AnalyserNode';
  fftSize: number;
  frequencyBinCount: number;
  smoothingTimeConstant: number;
  getByteFrequencyData: ReturnType<typeof vi.fn>;
}

interface MockConnection {
  source: MockNode;
  dest: MockNode;
  output: number;
  input: number;
}

function createMockParam(initialValue = 0): MockAudioParam {
  const param: MockAudioParam = {
    value: initialValue,
    setValueAtTime: vi.fn((val: number, _time: number) => {
      param.value = val;
    }),
    setTargetAtTime: vi.fn((val: number, _time: number, _tc: number) => {
      param.value = val;
    }),
    linearRampToValueAtTime: vi.fn((val: number, _time: number) => {
      param.value = val;
    }),
    exponentialRampToValueAtTime: vi.fn((val: number, _time: number) => {
      param.value = val;
    }),
    cancelScheduledValues: vi.fn(),
  };
  return param;
}

class MockBaseAudioContext {
  public sampleRate: number;
  public currentTime = 1.5;
  public state: AudioContextState = 'running';
  public onstatechange: (() => void) | null = null;
  public resume = vi.fn().mockResolvedValue(undefined);

  public gains: MockGainNode[] = [];
  public splitters: MockSplitterNode[] = [];
  public mergers: MockMergerNode[] = [];
  public filters: MockBiquadFilterNode[] = [];
  public shapers: MockWaveShaperNode[] = [];
  public convolvers: MockConvolverNode[] = [];
  public delays: MockDelayNode[] = [];
  public analysers: MockAnalyserNode[] = [];
  public connections: MockConnection[] = [];
  public destination: MockNode;

  private nextId = 1;

  constructor(sampleRate = 1000) {
    this.sampleRate = sampleRate;
    this.destination = this.makeNode('DestinationNode', {});
  }

  private makeNode<K extends string, E extends Record<string, unknown>>(
    kind: K,
    extra: E
  ): MockNode & { kind: K } & E {
    const node = {
      kind,
      id: this.nextId++,
      connect: vi.fn((dest: MockNode, output = 0, input = 0) => {
        this.connections.push({ source: node, dest, output, input });
        return dest;
      }),
      disconnect: vi.fn(),
      ...extra,
    } as MockNode & { kind: K } & E;
    return node;
  }

  public createGain(): MockGainNode {
    const node = this.makeNode('GainNode', {
      gain: createMockParam(1),
    });
    this.gains.push(node);
    return node;
  }

  public createChannelSplitter(numberOfOutputs = 2): MockSplitterNode {
    const node = this.makeNode('ChannelSplitterNode', {
      numberOfOutputs,
    });
    this.splitters.push(node);
    return node;
  }

  public createChannelMerger(numberOfInputs = 2): MockMergerNode {
    const node = this.makeNode('ChannelMergerNode', {
      numberOfInputs,
    });
    this.mergers.push(node);
    return node;
  }

  public createBiquadFilter(): MockBiquadFilterNode {
    const node = this.makeNode('BiquadFilterNode', {
      type: 'lowpass' as BiquadFilterType,
      frequency: createMockParam(350),
      Q: createMockParam(1),
      gain: createMockParam(0),
    });
    this.filters.push(node);
    return node;
  }

  public createWaveShaper(): MockWaveShaperNode {
    const node = this.makeNode('WaveShaperNode', {
      curve: null as Float32Array | null,
      oversample: 'none' as OverSampleType,
    });
    this.shapers.push(node);
    return node;
  }

  public createConvolver(): MockConvolverNode {
    const node = this.makeNode('ConvolverNode', {
      buffer: null as AudioBuffer | null,
    });
    this.convolvers.push(node);
    return node;
  }

  public createDelay(maxDelayTime = 1): MockDelayNode {
    const node = this.makeNode('DelayNode', {
      maxDelayTime,
      delayTime: createMockParam(0),
    });
    this.delays.push(node);
    return node;
  }

  public createAnalyser(): MockAnalyserNode {
    const node = this.makeNode('AnalyserNode', {
      fftSize: 2048,
      frequencyBinCount: 32,
      smoothingTimeConstant: 0.8,
      getByteFrequencyData: vi.fn((arr: Uint8Array) => {
        arr.fill(64);
      }),
    });
    this.analysers.push(node);
    return node;
  }

  public createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    const channelArrays = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (ch: number) => channelArrays[ch],
      copyFromChannel: vi.fn(),
      copyToChannel: vi.fn(),
    } as unknown as AudioBuffer;
  }
}

class FakeAudioContext extends MockBaseAudioContext {}
class FakeOfflineAudioContext extends MockBaseAudioContext {}

describe('SoundEngine & Master Audio Graph', () => {
  let mockCtx: FakeAudioContext;
  let engine: SoundEngine;

  beforeEach(async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
    mockCtx = new FakeAudioContext(1000);
    engine = new SoundEngine();
    await engine.init(mockCtx as unknown as AudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('builds the complete master bus, FX buses, dynamics chain, and analyser graph', () => {
    expect(engine.isReady).toBe(true);
    expect(engine.masterOutputNode).not.toBeNull();

    // Expected node counts created by setupAudioGraph
    expect(mockCtx.splitters).toHaveLength(1);
    expect(mockCtx.mergers).toHaveLength(1);
    expect(mockCtx.filters).toHaveLength(1);
    expect(mockCtx.shapers).toHaveLength(2); // limiter + tapeShaperNode
    expect(mockCtx.convolvers).toHaveLength(1);
    expect(mockCtx.delays).toHaveLength(1);
    expect(mockCtx.analysers).toHaveLength(1);
    expect(mockCtx.gains.length).toBeGreaterThanOrEqual(13);

    const limiter = mockCtx.shapers[0];
    expect(limiter.oversample).toBe('2x');
    expect(limiter.curve).toBeInstanceOf(Float32Array);

    const tapeFilter = mockCtx.filters[0];
    expect(tapeFilter.type).toBe('lowshelf');
    expect(tapeFilter.frequency.value).toBe(180);
    expect(tapeFilter.gain.value).toBe(0);

    const delay = mockCtx.delays[0];
    expect(delay.maxDelayTime).toBe(2.0);
    expect(delay.delayTime.value).toBe(0.35);

    const convolver = mockCtx.convolvers[0];
    expect(convolver.buffer?.numberOfChannels).toBe(2);
    expect(convolver.buffer?.length).toBe(Math.floor(1000 * 4.2));

    const analyser = mockCtx.analysers[0];
    expect(analyser.fftSize).toBe(64);
    expect(analyser.smoothingTimeConstant).toBe(0.8);

    // Delay feedback loop
    const feedbackGain = mockCtx.gains.find(
      (g) =>
        mockCtx.connections.some((c) => c.source === delay && c.dest === g) &&
        mockCtx.connections.some((c) => c.source === g && c.dest === delay)
    );
    expect(feedbackGain).toBeDefined();
    expect(feedbackGain?.gain.value).toBe(0.38);

    // Merger -> Limiter -> Analyser -> MasterGain -> Destination
    const merger = mockCtx.mergers[0];
    const masterGain = mockCtx.gains[0];
    expect(mockCtx.connections).toContainEqual(
      expect.objectContaining({ source: merger, dest: limiter })
    );
    expect(mockCtx.connections).toContainEqual(
      expect.objectContaining({ source: limiter, dest: analyser })
    );
    expect(mockCtx.connections).toContainEqual(
      expect.objectContaining({ source: analyser, dest: masterGain })
    );
    expect(mockCtx.connections).toContainEqual(
      expect.objectContaining({ source: masterGain, dest: mockCtx.destination })
    );
  });

  describe('Master Mid/Side stereo matrix math', () => {
    /**
     * Numerically evaluates the recorded GainNode matrix from splitter outputs (inL, inR)
     * to merger inputs (outL, outR) using the live GainNode.gain.value values.
     */
    function evaluateMatrix(inL: number, inR: number): { outL: number; outR: number } {
      const splitter = mockCtx.splitters[0];
      const merger = mockCtx.mergers[0];

      const evalNodeOutput = (node: MockNode, outputIdx: number): number => {
        if (node === splitter) {
          return outputIdx === 0 ? inL : inR;
        }
        const incoming = mockCtx.connections.filter((c) => c.dest === node);
        const summedInput = incoming.reduce(
          (sum, conn) => sum + evalNodeOutput(conn.source, conn.output),
          0
        );
        if (node.kind === 'GainNode') {
          return summedInput * (node as MockGainNode).gain.value;
        }
        return summedInput;
      };

      const evalMergerInput = (inputIdx: number): number => {
        const incoming = mockCtx.connections.filter(
          (c) => c.dest === merger && c.input === inputIdx
        );
        return incoming.reduce(
          (sum, conn) => sum + evalNodeOutput(conn.source, conn.output),
          0
        );
      };

      return {
        outL: evalMergerInput(0),
        outR: evalMergerInput(1),
      };
    }

    it('sets sideInvert gain to -1.0 (not -0.5) for exact Mid/Side difference', () => {
      const splitter = mockCtx.splitters[0];

      const sideDiff = mockCtx.connections.find(
        (c) =>
          c.source === splitter &&
          c.output === 0 &&
          c.dest.kind === 'GainNode' &&
          mockCtx.connections.some(
            (sub) => sub.source.kind === 'GainNode' && sub.dest === c.dest
          )
      )?.dest as MockGainNode | undefined;

      expect(sideDiff).toBeDefined();
      expect(sideDiff?.gain.value).toBe(0.5);

      const sideInvertConn = mockCtx.connections.find(
        (c) =>
          c.source === splitter &&
          c.output === 1 &&
          c.dest.kind === 'GainNode' &&
          mockCtx.connections.some((toDiff) => toDiff.source === c.dest && toDiff.dest === sideDiff)
      );

      const sideInvert = sideInvertConn?.dest as MockGainNode | undefined;
      expect(sideInvert).toBeDefined();
      expect(sideInvert?.gain.value).toBe(-1.0);
      expect(sideInvert?.gain.value).not.toBe(-0.5);
    });

    it('produces perfectly symmetric outL === outR with zero left bias for mono input (1, 1) across widths 0.0, 1.0, and 2.0', () => {
      for (const width of [0.0, 1.0, 2.0]) {
        engine.setStereoWidth(width);
        const { outL, outR } = evaluateMatrix(1, 1);
        expect(outL).toBe(outR);
        expect(outL).toBeCloseTo(1.0, 10);
        expect(outR).toBeCloseTo(1.0, 10);
      }
    });

    it('has zero L/R crosstalk for pure left (1, 0) and pure right (0, 1) at unity stereoWidth = 1.0', () => {
      engine.setStereoWidth(1.0);

      const fromLeft = evaluateMatrix(1, 0);
      expect(fromLeft.outL).toBeCloseTo(1.0, 10);
      expect(fromLeft.outR).toBeCloseTo(0.0, 10);

      const fromRight = evaluateMatrix(0, 1);
      expect(fromRight.outL).toBeCloseTo(0.0, 10);
      expect(fromRight.outR).toBeCloseTo(1.0, 10);
    });

    it('scales pure side input (1, -1) cleanly with stereoWidth = 0.0, 1.0, and 2.0', () => {
      engine.setStereoWidth(0.0);
      const w0 = evaluateMatrix(1, -1);
      expect(w0.outL).toBeCloseTo(0.0, 10);
      expect(w0.outR).toBeCloseTo(0.0, 10);

      engine.setStereoWidth(1.0);
      const w1 = evaluateMatrix(1, -1);
      expect(w1.outL).toBeCloseTo(1.0, 10);
      expect(w1.outR).toBeCloseTo(-1.0, 10);

      engine.setStereoWidth(2.0);
      const w2 = evaluateMatrix(1, -1);
      expect(w2.outL).toBeCloseTo(2.0, 10);
      expect(w2.outR).toBeCloseTo(-2.0, 10);
    });
  });

  describe('Master FX setters and dynamics', () => {
    it('clamps and updates stereoWidth via widthSideGain', () => {
      const sideDiff = mockCtx.gains.find(
        (g) =>
          g.gain.value === 0.5 &&
          mockCtx.connections.some((c) => c.source === mockCtx.splitters[0] && c.dest === g) &&
          mockCtx.connections.some((c) => c.source.kind === 'GainNode' && c.dest === g)
      )!;
      const widthSideGain = mockCtx.connections.find((c) => c.source === sideDiff)?.dest as MockGainNode;

      engine.setStereoWidth(1.75);
      expect(engine.stereoWidth).toBe(1.75);
      expect(widthSideGain.gain.setTargetAtTime).toHaveBeenCalledWith(1.75, 1.5, 0.05);

      engine.setStereoWidth(-0.5);
      expect(engine.stereoWidth).toBe(0);

      engine.setStereoWidth(3.5);
      expect(engine.stereoWidth).toBe(2.0);
    });

    it('updates impulse buffer when switching across all 5 reverb types', () => {
      const convolver = mockCtx.convolvers[0];
      const expectedDurations: Record<ReverbType, number> = {
        cathedral: 4.2,
        shimmer: 3.8,
        hall: 2.4,
        plate: 1.8,
        chamber: 0.9,
      };

      const prevBuffers = new Set<AudioBuffer>();
      for (const [type, duration] of Object.entries(expectedDurations) as Array<[ReverbType, number]>) {
        engine.setReverbType(type);
        expect(engine.reverbType).toBe(type);
        expect(convolver.buffer).not.toBeNull();
        expect(convolver.buffer!.length).toBe(Math.floor(1000 * duration));
        prevBuffers.add(convolver.buffer!);
      }
      expect(prevBuffers.size).toBe(5);
    });

    it('updates tapeWarmth curve and lowshelf filter gain with clamping', () => {
      const tapeShaper = mockCtx.shapers[1];
      const tapeFilter = mockCtx.filters[0];

      engine.setTapeWarmth(0);
      expect(engine.tapeWarmth).toBe(0);
      const cleanCurve = tapeShaper.curve!;
      expect(cleanCurve[0]).toBeCloseTo(-1, 4);
      expect(cleanCurve[512]).toBeCloseTo(0, 4);

      engine.setTapeWarmth(0.8);
      expect(engine.tapeWarmth).toBe(0.8);
      const warmCurve = tapeShaper.curve!;
      expect(warmCurve).not.toBe(cleanCurve);
      // Warm saturation boosts mid-range samples above linear response
      expect(warmCurve[768]).toBeGreaterThan((768 - 512) / 512);
      expect(tapeFilter.gain.setTargetAtTime).toHaveBeenCalledWith(0.8 * 3.5, 1.5, 0.05);

      engine.setTapeWarmth(-1);
      expect(engine.tapeWarmth).toBe(0);
      engine.setTapeWarmth(4);
      expect(engine.tapeWarmth).toBe(1.0);
    });

    it('clamps duckingDepth and schedules sidechain envelope when enabled', () => {
      const duckingGain = mockCtx.connections.find(
        (c) => c.source === mockCtx.filters[0]
      )?.dest as MockGainNode;

      engine.setDuckingDepth(-0.5);
      expect(engine.duckingDepth).toBe(0);
      engine.triggerDucking(1.0, 0.28, 2.0);
      expect(duckingGain.gain.cancelScheduledValues).not.toHaveBeenCalled();

      engine.setDuckingDepth(1.8);
      expect(engine.duckingDepth).toBe(1.0);

      engine.setDuckingDepth(0.8);
      expect(engine.duckingDepth).toBe(0.8);
      engine.triggerDucking(1.0, 0.28, 2.0);

      const expectedTarget = Math.max(0.15, 1.0 - 0.8 * 0.75); // 0.4
      expect(duckingGain.gain.cancelScheduledValues).toHaveBeenCalledWith(2.0);
      expect(duckingGain.gain.setValueAtTime).toHaveBeenCalledWith(1.0, 2.0);
      expect(duckingGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(expectedTarget, 2.0 + 0.012);
      expect(duckingGain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(1.0, 2.0 + 0.28);
    });

    it('clamps and applies masterVolume, reverbMix, and delayMix', () => {
      const masterGain = mockCtx.gains[0];
      const delay = mockCtx.delays[0];
      const convolver = mockCtx.convolvers[0];
      const wetDelayGain = mockCtx.connections.find(
        (c) => c.source === delay && c.dest !== mockCtx.gains.find((g) => g.gain.value === 0.38)
      )?.dest as MockGainNode;
      const wetReverbGain = mockCtx.connections.find((c) => c.source === convolver)?.dest as MockGainNode;

      engine.setMasterVolume(0.82);
      expect(masterGain.gain.setTargetAtTime).toHaveBeenCalledWith(0.82, 1.5, 0.05);
      engine.setMasterVolume(1.5);
      expect(masterGain.gain.setTargetAtTime).toHaveBeenCalledWith(1.0, 1.5, 0.05);
      engine.setMasterVolume(-0.2);
      expect(masterGain.gain.setTargetAtTime).toHaveBeenCalledWith(0.0, 1.5, 0.05);

      engine.setReverbMix(0.55);
      expect(engine.reverbMix).toBe(0.55);
      expect(wetReverbGain.gain.setTargetAtTime).toHaveBeenCalledWith(0.55, 1.5, 0.05);
      engine.setReverbMix(2.0);
      expect(engine.reverbMix).toBe(1.0);

      engine.setDelayMix(0.41);
      expect(wetDelayGain.gain.setTargetAtTime).toHaveBeenCalledWith(0.41, 1.5, 0.05);
      engine.setDelayMix(-1.0);
      expect(wetDelayGain.gain.setTargetAtTime).toHaveBeenCalledWith(0.0, 1.5, 0.05);
    });
  });

  describe('createOfflineEngine', () => {
    it('clones all master FX and dynamics settings into an isolated offline graph', () => {
      engine.setMasterVolume(0.42);
      engine.setReverbMix(0.61);
      engine.setDelayMix(0.19);
      engine.setReverbType('shimmer');
      engine.setStereoWidth(1.65);
      engine.setTapeWarmth(0.75);
      engine.setDuckingDepth(0.55);

      const offlineCtx = new FakeOfflineAudioContext(1000);
      const offlineEngine = engine.createOfflineEngine(offlineCtx as unknown as OfflineAudioContext);

      expect(offlineEngine).not.toBe(engine);
      expect(offlineEngine.isReady).toBe(true);
      expect(offlineEngine.context).toBe(offlineCtx);
      expect(offlineEngine.reverbMix).toBe(0.61);
      expect(offlineEngine.reverbType).toBe('shimmer');
      expect(offlineEngine.stereoWidth).toBe(1.65);
      expect(offlineEngine.tapeWarmth).toBe(0.75);
      expect(offlineEngine.duckingDepth).toBe(0.55);

      // Verify offline nodes were configured directly during setupAudioGraph
      const offMasterGain = offlineCtx.gains[0];
      expect(offMasterGain.gain.value).toBe(0.42);

      const offDelay = offlineCtx.delays[0];
      const offWetDelayGain = offlineCtx.connections.find(
        (c) => c.source === offDelay && (c.dest as MockGainNode).gain.value !== 0.38
      )?.dest as MockGainNode;
      expect(offWetDelayGain.gain.value).toBe(0.19);

      const offConvolver = offlineCtx.convolvers[0];
      expect(offConvolver.buffer?.length).toBe(Math.floor(1000 * 3.8));
      const offWetReverbGain = offlineCtx.connections.find(
        (c) => c.source === offConvolver
      )?.dest as MockGainNode;
      expect(offWetReverbGain.gain.value).toBe(0.61);

      const offTapeFilter = offlineCtx.filters[0];
      expect(offTapeFilter.gain.value).toBeCloseTo(0.75 * 3.5, 6);

      const offSideDiff = offlineCtx.gains.find(
        (g) =>
          g.gain.value === 0.5 &&
          offlineCtx.connections.some((c) => c.source === offlineCtx.splitters[0] && c.dest === g) &&
          offlineCtx.connections.some((c) => c.source.kind === 'GainNode' && c.dest === g)
      )!;
      const offWidthSideGain = offlineCtx.connections.find(
        (c) => c.source === offSideDiff
      )?.dest as MockGainNode;
      expect(offWidthSideGain.gain.value).toBe(1.65);

      // Mutating offline engine does not mutate live engine
      offlineEngine.setStereoWidth(0.2);
      offlineEngine.setReverbType('chamber');
      expect(engine.stereoWidth).toBe(1.65);
      expect(engine.reverbType).toBe('shimmer');
    });
  });
});
