import { soundEngine } from './audioContext';
import { StrokeManager } from '../engine/strokeManager';
import { ScaleQuantizer } from './scaleQuantizer';
import type { SavedComposition } from '../engine/types';
import {
  SimulationOptions,
  simulateCompositionToAudioBuffer,
  encodePcmToMp3Async,
  downloadBlob,
} from './mp3Export';

export interface StemExportResult {
  strokeId: string;
  instrumentId: string;
  index: number;
  filename: string;
  blob: Blob;
}

interface SwingAwareStrokeManager {
  swing?: number;
  setSwing?: (val: number) => void;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Encodes a rendered Web Audio AudioBuffer into a standard 16-bit PCM RIFF/WAVE Blob.
 */
export function encodeAudioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = Math.max(1, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate || 44100;
  const numFrames = buffer.length;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataByteLength = numFrames * blockAlign;

  const arrayBuffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(arrayBuffer);

  // RIFF chunk descriptor
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(view, 8, 'WAVE');

  // fmt sub-chunk
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM subchunk size
  view.setUint16(20, 1, true); // PCM format = 1
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      const int16 = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Simulates a composition offline and exports a lossless 16-bit WAV Blob.
 * Triggers automatic browser download if a filename is provided.
 */
export async function simulateAndExportWav(
  options: SimulationOptions,
  filename?: string
): Promise<Blob> {
  const buffer = await simulateCompositionToAudioBuffer(options);

  options.onProgress?.('Encoding lossless WAV audio...', 80);
  const wavBlob = encodeAudioBufferToWav(buffer);

  options.onProgress?.('Complete!', 100);
  if (filename) {
    downloadBlob(wavBlob, filename);
  }

  return wavBlob;
}

async function renderSingleStrokeStemBuffer(
  compData: SavedComposition,
  liveStroke: StrokeManager['activeStrokes'][number],
  options: SimulationOptions
): Promise<AudioBuffer> {
  const { durationSeconds, strokeManager, quantizer, canvasWidth, canvasHeight, sampleRate = 44100 } = options;
  const duration = Math.max(1, durationSeconds);
  const totalFrames = Math.ceil(sampleRate * duration);

  const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);
  const offlineEngine = soundEngine.createOfflineEngine(offlineCtx);
  const simManager = new StrokeManager(offlineEngine);

  const qConfig = quantizer.getConfig();
  const simQuantizer = new ScaleQuantizer({
    scale: qConfig.scale,
    root: qConfig.root,
    octaveSpan: qConfig.octaveSpan,
    chordDegrees: qConfig.chordDegrees ? [...qConfig.chordDegrees] : undefined,
  });
  simQuantizer.setScrollEnabled(quantizer.isScrollEnabled);
  simQuantizer.setScrollY(quantizer.scrollY);

  const swingSrc = strokeManager as unknown as SwingAwareStrokeManager;
  const swingDst = simManager as unknown as SwingAwareStrokeManager;
  if (typeof swingSrc.swing === 'number' && typeof swingDst.setSwing === 'function') {
    swingDst.setSwing(swingSrc.swing);
  }

  const savedStroke = compData.strokes.find((s) => s.id === liveStroke.id);
  const singleStrokeComp: SavedComposition = {
    ...compData,
    strokes: savedStroke ? [{ ...savedStroke, muted: false }] : [],
  };

  simManager.importComposition(singleStrokeComp, simQuantizer, canvasHeight, canvasWidth, {
    preserveIds: true,
    randomizePlayheads: false,
  });

  const simStroke = simManager.activeStrokes[0];
  if (simStroke) {
    simStroke.playhead.currentDistance = liveStroke.playhead.currentDistance;
    simStroke.playhead.lastTriggerDistance = liveStroke.playhead.lastTriggerDistance;
    simStroke.playhead.triggerDistanceAccum = liveStroke.playhead.triggerDistanceAccum;
    simStroke.playhead.direction = liveStroke.playhead.direction;
    simStroke.muted = false;
    simStroke.soloed = false;
  }

  simManager.activateAudioVoices();

  const dt = 0.02;
  const steps = Math.ceil(duration / dt);
  for (let step = 0; step < steps; step++) {
    simManager.update(dt, canvasWidth, canvasHeight, simQuantizer, step * dt);
  }

  return offlineCtx.startRendering();
}

/**
 * Renders and encodes each audible layer/stroke independently as its own WAV or MP3 stem.
 */
export async function simulateAndExportStems(
  options: SimulationOptions,
  format: 'wav' | 'mp3',
  baseFilename?: string
): Promise<StemExportResult[]> {
  const audibleStrokes = options.strokeManager.activeStrokes.filter((s) =>
    options.strokeManager.isStrokeAudible(s)
  );
  if (audibleStrokes.length === 0) {
    throw new Error('No audible layers to export.');
  }

  const { strokeManager, canvasWidth, canvasHeight, onProgress } = options;
  const compData = strokeManager.exportComposition(
    'Stem Export',
    undefined,
    undefined,
    canvasWidth,
    canvasHeight
  );

  const prefix = (baseFilename ?? 'composition').replace(/\.(wav|mp3)$/i, '');
  const total = audibleStrokes.length;
  const results: StemExportResult[] = [];

  for (let i = 0; i < total; i++) {
    const stroke = audibleStrokes[i];
    const stemNum = i + 1;
    const basePercent = Math.round((i / total) * 95);
    onProgress?.(`Rendering stem ${stemNum}/${total}...`, basePercent);

    const buffer = await renderSingleStrokeStemBuffer(compData, stroke, options);

    let blob: Blob;
    if (format === 'wav') {
      blob = encodeAudioBufferToWav(buffer);
    } else {
      const left = buffer.getChannelData(0);
      const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
      blob = await encodePcmToMp3Async(left, right, buffer.sampleRate, 192);
    }

    const safeInst = stroke.instrumentId.replace(/[^a-z0-9_-]/gi, '') || 'layer';
    const stemFilename = `${prefix}_stem-${String(stemNum).padStart(2, '0')}_${safeInst}.${format}`;

    if (baseFilename) {
      downloadBlob(blob, stemFilename);
    }

    results.push({
      strokeId: stroke.id,
      instrumentId: stroke.instrumentId,
      index: stemNum,
      filename: stemFilename,
      blob,
    });
  }

  onProgress?.('Complete!', 100);
  return results;
}
