import { describe, it, expect, beforeEach } from 'vitest';
import { floatToInt16, encodePcmToMp3, LiveRecorder } from '../src/audio/mp3Export';
import { SoundEngine } from '../src/audio/audioContext';

describe('MP3 Export & Live Recording', () => {
  describe('floatToInt16', () => {
    it('converts normalized float values to 16-bit signed integer values', () => {
      const input = new Float32Array([0.0, 0.5, -0.5, 1.0, -1.0]);
      const result = floatToInt16(input);

      expect(result.length).toBe(5);
      expect(result[0]).toBe(0);
      expect(result[1]).toBeGreaterThan(16000);
      expect(result[2]).toBeLessThan(-16000);
      expect(result[3]).toBe(32767);
      expect(result[4]).toBe(-32768);
    });

    it('clamps values outside [-1.0, 1.0] to prevent overflow wraps', () => {
      const input = new Float32Array([1.5, 2.0, -1.5, -3.0]);
      const result = floatToInt16(input);

      expect(result[0]).toBe(32767);
      expect(result[1]).toBe(32767);
      expect(result[2]).toBe(-32768);
      expect(result[3]).toBe(-32768);
    });
  });

  describe('encodePcmToMp3', () => {
    it('encodes stereo PCM audio to a valid MP3 Blob', () => {
      const sampleRate = 44100;
      const numSamples = 4410; // 0.1s of audio
      const left = new Float32Array(numSamples);
      const right = new Float32Array(numSamples);

      // Generate a 440 Hz sine wave
      for (let i = 0; i < numSamples; i++) {
        const val = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
        left[i] = val;
        right[i] = val * 0.8;
      }

      let progressCalled = false;
      const blob = encodePcmToMp3(left, right, sampleRate, 192, (p) => {
        if (p > 0) progressCalled = true;
      });

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('audio/mp3');
      expect(blob.size).toBeGreaterThan(0);
      expect(progressCalled).toBe(true);
    });
  });

  describe('LiveRecorder lifecycle', () => {
    let recorder: LiveRecorder;

    beforeEach(() => {
      recorder = new LiveRecorder();
    });

    it('initializes with recording = false and elapsedSeconds = 0', () => {
      expect(recorder.recording).toBe(false);
      expect(recorder.elapsedSeconds).toBe(0);
    });

    it('throws error when starting if sound engine is not ready', () => {
      const engine = new SoundEngine();
      expect(() => recorder.start(engine)).toThrow('Sound engine must be running');
    });

    it('throws error if stopping when not recording', async () => {
      await expect(recorder.stopAndExport()).rejects.toThrow('LiveRecorder is not recording');
    });

    it('cancels gracefully without throwing', () => {
      expect(() => recorder.cancel()).not.toThrow();
      expect(recorder.recording).toBe(false);
    });
  });
});
