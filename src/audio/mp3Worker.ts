import { Mp3Encoder } from '@breezystack/lamejs';

export interface Mp3WorkerRequest {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  kbps: number;
}

export type Mp3WorkerResponse =
  | { type: 'progress'; percent: number }
  | { type: 'done'; chunks: ArrayBuffer[] }
  | { type: 'error'; message: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent<Mp3WorkerRequest>) => void) | null;
  postMessage(message: Mp3WorkerResponse, transfer?: Transferable[]): void;
}

function floatToInt16(float32: Float32Array): Int16Array {
  const len = float32.length;
  const int16 = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return int16;
}

const workerSelf = self as unknown as WorkerScope;

workerSelf.onmessage = (event: MessageEvent<Mp3WorkerRequest>) => {
  try {
    const { left, right, sampleRate, kbps } = event.data;
    const leftInt16 = floatToInt16(left);
    const rightInt16 = floatToInt16(right);
    const encoder = new Mp3Encoder(2, sampleRate, kbps);
    const chunks: ArrayBuffer[] = [];

    const sampleBlockSize = 1152;
    const totalSamples = leftInt16.length;

    for (let i = 0; i < totalSamples; i += sampleBlockSize) {
      const leftChunk = leftInt16.subarray(i, i + sampleBlockSize);
      const rightChunk = rightInt16.subarray(i, i + sampleBlockSize);
      const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
      if (mp3buf.length > 0) {
        const copy = new Uint8Array(mp3buf.length);
        copy.set(mp3buf);
        chunks.push(copy.buffer);
      }
      if (totalSamples > 0 && i % (sampleBlockSize * 40) === 0) {
        workerSelf.postMessage({
          type: 'progress',
          percent: Math.round((i / totalSamples) * 100),
        });
      }
    }

    const endBuf = encoder.flush();
    if (endBuf.length > 0) {
      const copy = new Uint8Array(endBuf.length);
      copy.set(endBuf);
      chunks.push(copy.buffer);
    }

    workerSelf.postMessage({ type: 'progress', percent: 100 });
    workerSelf.postMessage({ type: 'done', chunks }, chunks);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    workerSelf.postMessage({ type: 'error', message });
  }
};
