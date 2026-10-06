import { Mp3Encoder } from '@breezystack/lamejs';
import { SoundEngine, soundEngine } from './audioContext';
import { StrokeManager } from '../engine/strokeManager';
import { ScaleQuantizer } from './scaleQuantizer';

/**
 * Converts Float32 audio samples in [-1.0, 1.0] to signed 16-bit PCM integer samples [-32768, 32767].
 * Clamps out-of-range values to prevent clipping overflow wraps.
 */
export function floatToInt16(float32: Float32Array): Int16Array {
  const len = float32.length;
  const int16 = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return int16;
}

/**
 * Encodes stereo Float32 PCM channels directly into an MP3 Blob using @breezystack/lamejs.
 * Runs 100% in-browser without external server dependencies.
 *
 * @param left Float32Array of left channel samples
 * @param right Float32Array of right channel samples
 * @param sampleRate Audio sample rate (default 44100 Hz)
 * @param kbps MP3 bitrate (default 192 kbps for high fidelity)
 * @param onProgress Optional progress callback (0 - 100)
 */
export function encodePcmToMp3(
  left: Float32Array,
  right: Float32Array,
  sampleRate = 44100,
  kbps = 192,
  onProgress?: (percent: number) => void
): Blob {
  const leftInt16 = floatToInt16(left);
  const rightInt16 = floatToInt16(right);
  const encoder = new Mp3Encoder(2, sampleRate, kbps);
  const mp3Chunks: Uint8Array[] = [];

  const sampleBlockSize = 1152;
  const totalSamples = leftInt16.length;

  for (let i = 0; i < totalSamples; i += sampleBlockSize) {
    const leftChunk = leftInt16.subarray(i, i + sampleBlockSize);
    const rightChunk = rightInt16.subarray(i, i + sampleBlockSize);
    const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3buf.length > 0) {
      mp3Chunks.push(new Uint8Array(mp3buf));
    }
    if (onProgress && i % (sampleBlockSize * 40) === 0) {
      onProgress(Math.round((i / totalSamples) * 100));
    }
  }

  const endBuf = encoder.flush();
  if (endBuf.length > 0) {
    mp3Chunks.push(new Uint8Array(endBuf));
  }
  if (onProgress) {
    onProgress(100);
  }

  return new Blob(mp3Chunks as BlobPart[], { type: 'audio/mp3' });
}

/**
 * Programmatically triggers a browser download for a Blob file.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}

/**
 * Live audio recorder that captures master bus audio in real-time
 * and converts directly to MP3 upon stopping.
 */
export class LiveRecorder {
  private _isRecording = false;
  private scriptNode: ScriptProcessorNode | null = null;
  private dummyGain: GainNode | null = null;
  private leftChunks: Float32Array[] = [];
  private rightChunks: Float32Array[] = [];
  private totalSamples = 0;
  private startTime = 0;
  private sampleRate = 44100;
  private timerInterval: number | null = null;

  public get recording(): boolean {
    return this._isRecording;
  }

  public get elapsedSeconds(): number {
    if (!this._isRecording) return 0;
    return (performance.now() - this.startTime) / 1000;
  }

  /**
   * Starts recording live audio output from the master bus.
   */
  public start(engine: SoundEngine = soundEngine, onTick?: (elapsedSec: number) => void): boolean {
    if (this._isRecording) return false;
    if (!engine.isReady || !engine.masterOutputNode) {
      throw new Error('Sound engine must be running before recording can start.');
    }

    const ctx = engine.context as AudioContext;
    this.sampleRate = ctx.sampleRate;
    this.leftChunks = [];
    this.rightChunks = [];
    this.totalSamples = 0;

    // Use standard ScriptProcessorNode for universal browser support without worklet CORS issues
    const bufferSize = 4096;
    this.scriptNode = ctx.createScriptProcessor(bufferSize, 2, 2);
    this.dummyGain = ctx.createGain();
    this.dummyGain.gain.setValueAtTime(0, 0);

    this.scriptNode.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this._isRecording) return;
      const inLeft = e.inputBuffer.getChannelData(0);
      const inRight = e.inputBuffer.getChannelData(1);
      this.leftChunks.push(new Float32Array(inLeft));
      this.rightChunks.push(new Float32Array(inRight));
      this.totalSamples += inLeft.length;
    };

    // Connect: masterGain -> scriptNode -> dummyGain(0.0) -> destination
    engine.masterOutputNode.connect(this.scriptNode);
    this.scriptNode.connect(this.dummyGain);
    this.dummyGain.connect(ctx.destination);

    this._isRecording = true;
    this.startTime = performance.now();

    if (onTick) {
      this.timerInterval = window.setInterval(() => {
        if (!this._isRecording) return;
        const elapsed = (performance.now() - this.startTime) / 1000;
        onTick(elapsed);
      }, 250);
    }

    return true;
  }

  /**
   * Stops recording, disconnects nodes, and converts captured audio straight to MP3.
   */
  public async stopAndExport(onProgress?: (percent: number) => void): Promise<Blob> {
    if (!this._isRecording) {
      throw new Error('LiveRecorder is not recording.');
    }

    this._isRecording = false;
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    if (this.scriptNode && this.dummyGain) {
      try {
        this.scriptNode.disconnect();
        this.dummyGain.disconnect();
      } catch {}
      this.scriptNode = null;
      this.dummyGain = null;
    }

    if (this.totalSamples === 0) {
      throw new Error('No audio data was captured.');
    }

    // Merge Float32 chunks into contiguous left and right arrays
    const left = new Float32Array(this.totalSamples);
    const right = new Float32Array(this.totalSamples);
    let offset = 0;
    for (let i = 0; i < this.leftChunks.length; i++) {
      left.set(this.leftChunks[i], offset);
      right.set(this.rightChunks[i], offset);
      offset += this.leftChunks[i].length;
    }

    this.leftChunks = [];
    this.rightChunks = [];

    return encodePcmToMp3(left, right, this.sampleRate, 192, onProgress);
  }

  /**
   * Cancels recording without encoding or exporting.
   */
  public cancel(): void {
    this._isRecording = false;
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.scriptNode && this.dummyGain) {
      try {
        this.scriptNode.disconnect();
        this.dummyGain.disconnect();
      } catch {}
      this.scriptNode = null;
      this.dummyGain = null;
    }
    this.leftChunks = [];
    this.rightChunks = [];
    this.totalSamples = 0;
  }
}

export interface SimulationOptions {
  durationSeconds: number;
  strokeManager: StrokeManager;
  quantizer: ScaleQuantizer;
  canvasWidth: number;
  canvasHeight: number;
  sampleRate?: number;
  onProgress?: (status: string, percent: number) => void;
}

/**
 * Simulates a composition faster-than-realtime using OfflineAudioContext.
 * Traverses all active strokes, breathing modulations, harmonizers, and drum triggers,
 * then renders directly into an AudioBuffer.
 */
export async function simulateCompositionToAudioBuffer(
  options: SimulationOptions
): Promise<AudioBuffer> {
  const {
    durationSeconds,
    strokeManager,
    quantizer,
    canvasWidth,
    canvasHeight,
    sampleRate = 44100,
    onProgress,
  } = options;

  const duration = Math.max(1, durationSeconds);
  const totalFrames = Math.ceil(sampleRate * duration);

  if (onProgress) onProgress('Initializing offline synthesis engine...', 5);

  const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);
  const offlineEngine = soundEngine.createOfflineEngine(offlineCtx);

  // Clone current composition into offline StrokeManager
  const compData = strokeManager.exportComposition('Offline Simulation', undefined, undefined, canvasWidth, canvasHeight);
  const simManager = new StrokeManager(offlineEngine);
  simManager.importComposition(compData, quantizer, canvasHeight, canvasWidth);

  // Synchronize initial playhead positions and mute/solo states with live manager
  const liveStrokes = strokeManager.activeStrokes;
  for (let i = 0; i < simManager.activeStrokes.length; i++) {
    const simS = simManager.activeStrokes[i];
    const liveS = liveStrokes.find((s) => s.id === simS.id) ?? liveStrokes[i];
    if (liveS) {
      simS.playhead.currentDistance = liveS.playhead.currentDistance;
      simS.playhead.direction = liveS.playhead.direction;
      simS.muted = liveS.muted;
      simS.soloed = liveS.soloed;
    }
  }

  simManager.activateAudioVoices();

  if (onProgress) onProgress('Simulating score and scheduling audio events...', 15);

  // Run timeline simulation at 50 FPS (dt = 0.02s) to schedule AudioParam events
  const dt = 0.02;
  const steps = Math.ceil(duration / dt);
  for (let step = 0; step < steps; step++) {
    const t = step * dt;
    simManager.update(dt, canvasWidth, canvasHeight, quantizer, t);
    if (onProgress && step % 100 === 0) {
      const p = 15 + Math.round((step / steps) * 40);
      onProgress(`Simulating score (${Math.round((step / steps) * 100)}%)...`, p);
    }
  }

  if (onProgress) onProgress('Rendering high-fidelity audio buffer...', 58);

  const renderedBuffer = await offlineCtx.startRendering();
  return renderedBuffer;
}

/**
 * Simulates a composition for the specified duration and converts straight to MP3.
 * Triggers automatic download if a filename is provided.
 */
export async function simulateAndExportMp3(
  options: SimulationOptions,
  filename?: string
): Promise<Blob> {
  const buffer = await simulateCompositionToAudioBuffer(options);

  if (options.onProgress) options.onProgress('Converting audio to MP3 format...', 75);

  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;

  const mp3Blob = encodePcmToMp3(
    left,
    right,
    buffer.sampleRate,
    192,
    (encPercent) => {
      if (options.onProgress) {
        const p = 75 + Math.round((encPercent / 100) * 24);
        options.onProgress(`Encoding MP3 (${encPercent}%)...`, p);
      }
    }
  );

  if (options.onProgress) options.onProgress('Complete!', 100);

  if (filename) {
    downloadBlob(mp3Blob, filename);
  }

  return mp3Blob;
}
