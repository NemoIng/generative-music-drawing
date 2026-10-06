import { SplinePath } from '../math/types';
import { StrokeStyle, TraversalMode, TimingMode, LoopQuantizeMode, SpeedMode, XAxisModulationMode, HarmonizerMode, BreathingMode } from '../engine/types';
import { fitSplineFromPoints } from '../math/curveFit';
import { ScaleQuantizer } from './scaleQuantizer';

export interface TemplateStrokeConfig {
  points: { x: number; y: number }[];
  style: StrokeStyle;
  instrumentId: string;
  traversal?: TraversalMode;
  duration?: number;
  speedMultiplier?: number;
  timingMode?: TimingMode;
  speedMode?: SpeedMode;
  volume?: number;
  reverb?: number;
  fluctuation?: number;
  loopQuantize?: LoopQuantizeMode;
  harmonizer?: HarmonizerMode;
}

export interface MusicalTemplate {
  id: string;
  name: string;
  tagline: string;
  bpm: number;
  scaleId: string;
  rootId: string;
  spaceReverb?: number;
  octaveSpan?: number;
  xAxisModulation?: XAxisModulationMode;
  progressionId?: string;
  breathingMode?: BreathingMode;
  strokes: (width: number, height: number, quantizer: ScaleQuantizer) => TemplateStrokeConfig[];
}

export const TEMPLATES: Record<string, MusicalTemplate> = {
  deepCosmicDrone: {
    id: 'deepCosmicDrone',
    name: 'Deep Cosmic Drone',
    tagline: 'Warm harmonic drone with slow breathing filter drifts and celestial chimes (24 BPM)',
    bpm: 24,
    scaleId: 'dorian',
    rootId: 'D3',
    spaceReverb: 0.75,
    octaveSpan: 4,
    xAxisModulation: 'panAndTone',
    breathingMode: 'deep',
    strokes: (w: number, h: number, _quantizer: ScaleQuantizer) => {
      const rootY = h * 0.78;
      const fifthY = h * 0.54;
      const midHighY = h * 0.34;
      const topY = h * 0.18;

      return [
        // 1. Deep Indigo Cello Bass Drone (Sustained Bounce traversal, 80s timer)
        {
          instrumentId: 'indigo',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 80,
          volume: 0.9,
          reverb: 0.35,
          fluctuation: 0.08,
          harmonizer: 'octave',
          points: [
            { x: w * 0.08, y: rootY },
            { x: w * 0.28, y: rootY - 14 },
            { x: w * 0.52, y: rootY + 12 },
            { x: w * 0.74, y: rootY - 8 },
            { x: w * 0.92, y: rootY },
          ],
        },
        // 2. Spruce Glass Organ Slow Drift (Bounce traversal, 90s timer)
        {
          instrumentId: 'spruce',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 90,
          volume: 0.75,
          reverb: 0.70,
          fluctuation: 0.05,
          points: [
            { x: w * 0.12, y: fifthY + 18 },
            { x: w * 0.34, y: fifthY - 25 },
            { x: w * 0.58, y: fifthY + 15 },
            { x: w * 0.88, y: fifthY - 20 },
          ],
        },
        // 3. Amber Warm Kalimba Modal Cascade (Restart traversal, 38s timer)
        {
          instrumentId: 'amber',
          style: 'dotted',
          traversal: 'restart',
          timingMode: 'timer',
          duration: 38,
          volume: 0.70,
          reverb: 0.55,
          fluctuation: 0.12,
          points: [
            { x: w * 0.16, y: midHighY + 30 },
            { x: w * 0.32, y: midHighY - 10 },
            { x: w * 0.48, y: midHighY + 20 },
            { x: w * 0.65, y: midHighY - 15 },
            { x: w * 0.84, y: midHighY + 10 },
          ],
        },
        // 4. Violet Music Box Celestial Chimes (Restart traversal, 48s timer)
        {
          instrumentId: 'violet',
          style: 'dotted',
          traversal: 'restart',
          timingMode: 'timer',
          duration: 48,
          volume: 0.65,
          reverb: 0.85,
          fluctuation: 0.10,
          points: [
            { x: w * 0.22, y: topY },
            { x: w * 0.42, y: topY - 25 },
            { x: w * 0.62, y: topY - 35 },
            { x: w * 0.82, y: topY - 15 },
          ],
        },
      ];
    },
  },

  cathedralSolitude: {
    id: 'cathedralSolitude',
    name: 'Cathedral of Solitude',
    tagline: 'Sacred acoustic space with Lydian modal interchange and crystalline shimmer (32 BPM)',
    bpm: 32,
    scaleId: 'lydian',
    rootId: 'C3',
    spaceReverb: 0.85,
    octaveSpan: 4,
    xAxisModulation: 'panAndTone',
    breathingMode: 'deep',
    strokes: (w: number, h: number, _quantizer: ScaleQuantizer) => {
      const rootY = h * 0.76;
      const midY = h * 0.50;
      const topY = h * 0.22;
      const counterY = h * 0.64;

      return [
        // 1. Spruce Glass Flute Foundation (Bounce, 75s timer)
        {
          instrumentId: 'spruce',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 75,
          volume: 0.85,
          reverb: 0.65,
          fluctuation: 0.05,
          points: [
            { x: w * 0.08, y: rootY },
            { x: w * 0.32, y: rootY - 16 },
            { x: w * 0.60, y: rootY + 12 },
            { x: w * 0.92, y: rootY },
          ],
        },
        // 2. Rose Warm Acoustic Harp Rising Swell (Bounce, 45s timer)
        {
          instrumentId: 'rose',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 45,
          volume: 0.75,
          reverb: 0.80,
          fluctuation: 0.08,
          points: [
            { x: w * 0.14, y: midY + 35 },
            { x: w * 0.32, y: midY - 10 },
            { x: w * 0.52, y: midY - 45 },
            { x: w * 0.72, y: midY - 20 },
            { x: w * 0.88, y: midY + 25 },
          ],
        },
        // 3. High Crystalline Violet Bells (Restart, 54s timer)
        {
          instrumentId: 'violet',
          style: 'dotted',
          traversal: 'restart',
          timingMode: 'timer',
          duration: 54,
          volume: 0.68,
          reverb: 0.90,
          fluctuation: 0.10,
          points: [
            { x: w * 0.18, y: topY + 20 },
            { x: w * 0.38, y: topY - 20 },
            { x: w * 0.58, y: topY + 12 },
            { x: w * 0.76, y: topY - 30 },
            { x: w * 0.88, y: topY },
          ],
        },
        // 4. Bowed Cello Mid-Bass Counter-Melody (Bounce, 65s timer)
        {
          instrumentId: 'indigo',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 65,
          volume: 0.65,
          reverb: 0.50,
          fluctuation: 0.07,
          points: [
            { x: w * 0.12, y: counterY },
            { x: w * 0.40, y: counterY - 25 },
            { x: w * 0.68, y: counterY + 15 },
            { x: w * 0.86, y: counterY - 10 },
          ],
        },
      ];
    },
  },

  warmTapeDrift: {
    id: 'warmTapeDrift',
    name: 'Warm Tape Drift',
    tagline: 'Eno-inspired modal drift with detuned fifths and slow pendulum movement (40 BPM)',
    bpm: 40,
    scaleId: 'dorian',
    rootId: 'D3',
    spaceReverb: 0.65,
    octaveSpan: 3,
    xAxisModulation: 'panAndTone',
    breathingMode: 'drift',
    strokes: (w: number, h: number, _quantizer: ScaleQuantizer) => {
      const rootY = h * 0.78;
      const fifthY = h * 0.50;
      const highY = h * 0.28;
      const floatY = h * 0.16;

      return [
        // 1. Slate Analog Moog Warm Bed (Bounce, 70s timer)
        {
          instrumentId: 'slate',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 70,
          volume: 0.85,
          reverb: 0.40,
          fluctuation: 0.09,
          points: [
            { x: w * 0.10, y: rootY },
            { x: w * 0.35, y: rootY + 10 },
            { x: w * 0.65, y: rootY - 12 },
            { x: w * 0.90, y: rootY },
          ],
        },
        // 2. Amber Kalimba Gentle Ostinato (Restart, 32s timer)
        {
          instrumentId: 'amber',
          style: 'dotted',
          traversal: 'restart',
          timingMode: 'timer',
          duration: 32,
          volume: 0.75,
          reverb: 0.55,
          fluctuation: 0.12,
          points: [
            { x: w * 0.15, y: fifthY + 20 },
            { x: w * 0.35, y: fifthY - 25 },
            { x: w * 0.55, y: fifthY + 15 },
            { x: w * 0.72, y: fifthY - 30 },
            { x: w * 0.88, y: fifthY },
          ],
        },
        // 3. Indigo Cello Counter-melody (Bounce, 45s timer)
        {
          instrumentId: 'indigo',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 45,
          volume: 0.70,
          reverb: 0.50,
          fluctuation: 0.08,
          points: [
            { x: w * 0.12, y: fifthY - 15 },
            { x: w * 0.38, y: highY + 20 },
            { x: w * 0.62, y: highY - 15 },
            { x: w * 0.85, y: highY + 25 },
          ],
        },
        // 4. Rose Acoustic Harp Floating Warmth (Bounce, 65s timer)
        {
          instrumentId: 'rose',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 65,
          volume: 0.60,
          reverb: 0.75,
          fluctuation: 0.06,
          points: [
            { x: w * 0.20, y: floatY + 15 },
            { x: w * 0.45, y: floatY - 25 },
            { x: w * 0.70, y: floatY + 10 },
            { x: w * 0.86, y: floatY - 20 },
          ],
        },
      ];
    },
  },

  zenMeadow: {
    id: 'zenMeadow',
    name: 'Zen Meadow',
    tagline: 'Meditative fifths with organic breathing drones and gentle water drop chimes (48 BPM)',
    bpm: 48,
    scaleId: 'majorPentatonic',
    rootId: 'C3',
    spaceReverb: 0.7,
    octaveSpan: 4,
    xAxisModulation: 'panAndTone',
    breathingMode: 'gentle',
    strokes: (w: number, h: number, _quantizer: ScaleQuantizer) => {
      const rootY = h * 0.76;
      const fifthY = h * 0.52;
      const highY = h * 0.30;
      const topY = h * 0.16;

      return [
        // 1. Spruce Glass Organ Root (Bounce, 75s timer)
        {
          instrumentId: 'spruce',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 75,
          volume: 0.80,
          reverb: 0.60,
          fluctuation: 0.05,
          points: [
            { x: w * 0.08, y: rootY },
            { x: w * 0.32, y: rootY - 12 },
            { x: w * 0.62, y: rootY + 15 },
            { x: w * 0.92, y: rootY },
          ],
        },
        // 2. Rose Acoustic Harp Meadow Wave (Bounce, 38s timer)
        {
          instrumentId: 'rose',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 38,
          volume: 0.75,
          reverb: 0.70,
          fluctuation: 0.08,
          points: [
            { x: w * 0.12, y: fifthY + 25 },
            { x: w * 0.32, y: fifthY - 15 },
            { x: w * 0.52, y: fifthY + 10 },
            { x: w * 0.72, y: highY + 15 },
            { x: w * 0.88, y: fifthY - 10 },
          ],
        },
        // 3. Amber Kalimba Pentatonic Drops (Restart, 26s timer)
        {
          instrumentId: 'amber',
          style: 'dotted',
          traversal: 'restart',
          timingMode: 'timer',
          duration: 26,
          volume: 0.72,
          reverb: 0.50,
          fluctuation: 0.12,
          points: [
            { x: w * 0.18, y: highY + 20 },
            { x: w * 0.36, y: highY - 12 },
            { x: w * 0.54, y: highY + 15 },
            { x: w * 0.72, y: highY - 25 },
            { x: w * 0.86, y: highY + 10 },
          ],
        },
        // 4. Violet Music Box Wind Sparkles (Restart, 44s timer)
        {
          instrumentId: 'violet',
          style: 'dotted',
          traversal: 'restart',
          timingMode: 'timer',
          duration: 44,
          volume: 0.55,
          reverb: 0.85,
          fluctuation: 0.10,
          points: [
            { x: w * 0.22, y: topY + 10 },
            { x: w * 0.44, y: topY - 25 },
            { x: w * 0.66, y: topY - 10 },
            { x: w * 0.84, y: topY - 20 },
          ],
        },
      ];
    },
  },

  ambientDawn: {
    id: 'ambientDawn',
    name: 'Ambient Dawn',
    tagline: 'Warm cello bass drone with kalimba melody and twinkling music box bells',
    bpm: 88,
    scaleId: 'dorian',
    rootId: 'D3',
    spaceReverb: 0.6,
    octaveSpan: 4,
    xAxisModulation: 'panAndTone',
    progressionId: 'ambientNeoRiemannian',
    strokes: (w: number, h: number, _quantizer: ScaleQuantizer) => {
      const rootY = h * 0.78;
      const fifthY = h * 0.56;
      const octaveY = h * 0.38;
      const highY = h * 0.18;

      return [
        // 1. Warm Indigo Cello Bass Drone (Solid, Bounce, 70s timer)
        {
          instrumentId: 'indigo',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 70,
          volume: 0.85,
          reverb: 0.35,
          fluctuation: 0.08,
          points: [
            { x: w * 0.10, y: rootY },
            { x: w * 0.35, y: rootY - 15 },
            { x: w * 0.65, y: rootY + 10 },
            { x: w * 0.90, y: rootY },
          ],
        },
        // 2. Mid Amber Kalimba Sunbeam Motif (Dotted Chimes, Restart, 32s timer)
        {
          instrumentId: 'amber',
          style: 'dotted',
          traversal: 'restart',
          timingMode: 'timer',
          duration: 32,
          volume: 0.75,
          reverb: 0.55,
          fluctuation: 0.12,
          points: [
            { x: w * 0.14, y: fifthY + 15 },
            { x: w * 0.32, y: fifthY - 25 },
            { x: w * 0.50, y: octaveY + 12 },
            { x: w * 0.70, y: octaveY - 20 },
            { x: w * 0.86, y: fifthY },
          ],
        },
        // 3. Glass Organ Horizon Pad (Solid, Bounce, 45s timer)
        {
          instrumentId: 'spruce',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 45,
          volume: 0.70,
          reverb: 0.65,
          fluctuation: 0.05,
          points: [
            { x: w * 0.16, y: fifthY - 15 },
            { x: w * 0.42, y: octaveY - 15 },
            { x: w * 0.68, y: octaveY + 20 },
            { x: w * 0.88, y: fifthY - 10 },
          ],
        },
        // 4. High Violet Music Box Shimmer (Dotted Bells, Restart, 24s timer)
        {
          instrumentId: 'violet',
          style: 'dotted',
          traversal: 'restart',
          timingMode: 'timer',
          duration: 24,
          volume: 0.60,
          reverb: 0.75,
          fluctuation: 0.10,
          points: [
            { x: w * 0.24, y: highY + 15 },
            { x: w * 0.46, y: highY - 25 },
            { x: w * 0.66, y: highY + 12 },
            { x: w * 0.84, y: highY - 15 },
          ],
        },
      ];
    },
  },

  minimalGroove: {
    id: 'minimalGroove',
    name: 'Minimal Groove',
    tagline: 'Locked 4-beat analog bassline with syncopated glass organ pulses',
    bpm: 112,
    scaleId: 'minorPentatonic',
    rootId: 'A2',
    spaceReverb: 0.35,
    octaveSpan: 3,
    strokes: (w: number, h: number, _quantizer: ScaleQuantizer) => {
      const rootY = h * 0.78;
      const thirdY = h * 0.54;
      const fifthY = h * 0.34;
      const highY = h * 0.18;

      return [
        // 1. Slate Analog Moog Bass Pulse (Striped, Root)
        {
          instrumentId: 'slate',
          style: 'striped',
          traversal: 'restart',
          speedMode: 'bars',
          loopQuantize: '2bars',
          volume: 0.90,
          reverb: 0.20,
          fluctuation: 0.06,
          points: [
            { x: w * 0.08, y: rootY },
            { x: w * 0.28, y: thirdY + 15 },
            { x: w * 0.48, y: rootY },
            { x: w * 0.68, y: thirdY + 10 },
            { x: w * 0.90, y: rootY },
          ],
        },
        // 2. Spruce Glass Flute Syncopated Arp (Dotted)
        {
          instrumentId: 'spruce',
          style: 'dotted',
          traversal: 'restart',
          speedMode: 'bars',
          loopQuantize: '2bars',
          volume: 0.80,
          reverb: 0.45,
          fluctuation: 0.05,
          points: [
            { x: w * 0.15, y: thirdY },
            { x: w * 0.35, y: fifthY - 10 },
            { x: w * 0.55, y: thirdY + 12 },
            { x: w * 0.75, y: fifthY - 20 },
            { x: w * 0.88, y: thirdY },
          ],
        },
        // 3. Rose Harp Sweeping Pad (Solid, Bounce)
        {
          instrumentId: 'rose',
          style: 'solid',
          traversal: 'bounce',
          speedMode: 'bars',
          loopQuantize: '4bars',
          volume: 0.70,
          reverb: 0.65,
          fluctuation: 0.08,
          points: [
            { x: w * 0.12, y: thirdY - 15 },
            { x: w * 0.40, y: fifthY - 30 },
            { x: w * 0.65, y: thirdY - 25 },
            { x: w * 0.88, y: fifthY - 10 },
          ],
        },
        // 4. Amber Kalimba High Accents (Dotted)
        {
          instrumentId: 'amber',
          style: 'dotted',
          traversal: 'restart',
          speedMode: 'bars',
          loopQuantize: '1bar',
          volume: 0.75,
          reverb: 0.40,
          fluctuation: 0.12,
          points: [
            { x: w * 0.20, y: highY + 20 },
            { x: w * 0.45, y: highY - 25 },
            { x: w * 0.70, y: highY + 15 },
            { x: w * 0.85, y: highY - 15 },
          ],
        },
      ];
    },
  },

  zenMeditation: {
    id: 'zenMeditation',
    name: 'Zen Meditation',
    tagline: 'Ethereal glass organ drone with floating acoustic harp waves',
    bpm: 54,
    scaleId: 'lydian',
    rootId: 'C3',
    spaceReverb: 0.75,
    octaveSpan: 4,
    progressionId: 'cathedralSwell',
    strokes: (w: number, h: number, _quantizer: ScaleQuantizer) => {
      const rootY = h * 0.76;
      const midY = h * 0.50;
      const topY = h * 0.20;
      const chantY = h * 0.62;

      return [
        // 1. Spruce Glass Organ Drone (Solid, Bounce, 80s timer)
        {
          instrumentId: 'spruce',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 80,
          volume: 0.85,
          reverb: 0.70,
          fluctuation: 0.05,
          points: [
            { x: w * 0.08, y: rootY },
            { x: w * 0.34, y: rootY - 15 },
            { x: w * 0.64, y: rootY + 12 },
            { x: w * 0.92, y: rootY },
          ],
        },
        // 2. Rose Acoustic Harp Floating Curve (Dotted, Restart, 36s timer)
        {
          instrumentId: 'rose',
          style: 'dotted',
          traversal: 'restart',
          timingMode: 'timer',
          duration: 36,
          volume: 0.75,
          reverb: 0.80,
          fluctuation: 0.08,
          points: [
            { x: w * 0.14, y: midY + 25 },
            { x: w * 0.36, y: topY + 20 },
            { x: w * 0.58, y: topY - 15 },
            { x: w * 0.78, y: midY },
            { x: w * 0.88, y: topY + 12 },
          ],
        },
        // 3. Indigo Bowed Cello Sacred Chant (Solid, Bounce, 42s timer)
        {
          instrumentId: 'indigo',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 42,
          volume: 0.70,
          reverb: 0.55,
          fluctuation: 0.07,
          points: [
            { x: w * 0.15, y: chantY + 15 },
            { x: w * 0.42, y: chantY - 25 },
            { x: w * 0.68, y: chantY + 10 },
            { x: w * 0.86, y: chantY - 20 },
          ],
        },
        // 4. Violet Celestial Music Box Shimmer (Dotted, Restart, 48s timer)
        {
          instrumentId: 'violet',
          style: 'dotted',
          traversal: 'restart',
          timingMode: 'timer',
          duration: 48,
          volume: 0.60,
          reverb: 0.85,
          fluctuation: 0.10,
          points: [
            { x: w * 0.22, y: topY },
            { x: w * 0.45, y: topY - 30 },
            { x: w * 0.68, y: topY - 12 },
            { x: w * 0.84, y: topY - 25 },
          ],
        },
      ];
    },
  },

  electro808: {
    id: 'electro808',
    name: 'Analog 808 Groove',
    tagline: 'Driving 808 kick, crisp snare, metallic hi-hat roll with acid bassline',
    bpm: 110,
    scaleId: 'minorPentatonic',
    rootId: 'A2',
    spaceReverb: 0.25,
    octaveSpan: 3,
    strokes: (w: number, h: number, _quantizer: ScaleQuantizer) => {
      const rootY = h * 0.76;
      const bassY = h * 0.62;
      const leadY = h * 0.28;

      return [
        // 1. 808 Kick Drum Line (Onyx, Dotted pulse in Kick zone)
        {
          instrumentId: 'onyx',
          style: 'dotted',
          traversal: 'restart',
          speedMode: 'bars',
          loopQuantize: '1bar',
          volume: 0.95,
          reverb: 0.15,
          points: [
            { x: w * 0.10, y: h * 0.84 },
            { x: w * 0.35, y: h * 0.86 },
            { x: w * 0.65, y: h * 0.83 },
            { x: w * 0.90, y: h * 0.85 },
          ],
        },
        // 2. 808 Snare & Clap Line (Onyx, Dotted pulse in Snare zone)
        {
          instrumentId: 'onyx',
          style: 'dotted',
          traversal: 'restart',
          speedMode: 'bars',
          loopQuantize: '2bars',
          volume: 0.90,
          reverb: 0.45,
          points: [
            { x: w * 0.15, y: h * 0.58 },
            { x: w * 0.40, y: h * 0.56 },
            { x: w * 0.65, y: h * 0.60 },
            { x: w * 0.85, y: h * 0.57 },
          ],
        },
        // 3. 808 Hi-Hat Line (Onyx, Striped 16th-note roll in Top Hat zone)
        {
          instrumentId: 'onyx',
          style: 'striped',
          traversal: 'restart',
          speedMode: 'bars',
          loopQuantize: '1bar',
          volume: 0.80,
          reverb: 0.35,
          points: [
            { x: w * 0.10, y: h * 0.16 },
            { x: w * 0.38, y: h * 0.14 },
            { x: w * 0.64, y: h * 0.17 },
            { x: w * 0.90, y: h * 0.15 },
          ],
        },
        // 4. Slate Analog 303 Acid Bassline (Slate, Dotted)
        {
          instrumentId: 'slate',
          style: 'dotted',
          traversal: 'restart',
          speedMode: 'bars',
          loopQuantize: '2bars',
          volume: 0.85,
          reverb: 0.25,
          fluctuation: 0.08,
          points: [
            { x: w * 0.12, y: rootY },
            { x: w * 0.34, y: bassY - 10 },
            { x: w * 0.52, y: rootY + 10 },
            { x: w * 0.70, y: bassY - 18 },
            { x: w * 0.88, y: rootY },
          ],
        },
        // 5. Violet Crystalline Synth Lead (Violet, Dotted)
        {
          instrumentId: 'violet',
          style: 'dotted',
          traversal: 'restart',
          speedMode: 'bars',
          loopQuantize: '4bars',
          volume: 0.75,
          reverb: 0.60,
          fluctuation: 0.10,
          points: [
            { x: w * 0.18, y: leadY + 15 },
            { x: w * 0.38, y: leadY - 25 },
            { x: w * 0.58, y: leadY + 18 },
            { x: w * 0.76, y: leadY - 30 },
            { x: w * 0.88, y: leadY - 10 },
          ],
        },
      ];
    },
  },
};

/**
 * Builds fitted spline paths from a template configuration.
 */
export function buildTemplateStrokes(
  templateId: string,
  width: number,
  height: number,
  quantizer: ScaleQuantizer
): {
  path: SplinePath;
  style: StrokeStyle;
  instrumentId: string;
  traversal?: TraversalMode;
  duration?: number;
  speedMultiplier?: number;
  timingMode?: TimingMode;
  speedMode?: SpeedMode;
  volume?: number;
  reverb?: number;
  fluctuation?: number;
  loopQuantize?: LoopQuantizeMode;
  harmonizer?: HarmonizerMode;
}[] {
  const template = TEMPLATES[templateId];
  if (!template) return [];

  const configs = template.strokes(width, height, quantizer);
  const result: {
    path: SplinePath;
    style: StrokeStyle;
    instrumentId: string;
    traversal?: TraversalMode;
    duration?: number;
    speedMultiplier?: number;
    timingMode?: TimingMode;
    speedMode?: SpeedMode;
    volume?: number;
    reverb?: number;
    fluctuation?: number;
    loopQuantize?: LoopQuantizeMode;
    harmonizer?: HarmonizerMode;
  }[] = [];

  for (const cfg of configs) {
    const spline = fitSplineFromPoints(cfg.points, 20);
    if (spline && spline.segments.length > 0) {
      result.push({
        path: spline,
        style: cfg.style,
        instrumentId: cfg.instrumentId,
        traversal: cfg.traversal,
        duration: cfg.duration,
        speedMultiplier: cfg.speedMultiplier,
        timingMode: cfg.timingMode ?? (cfg.speedMode === 'timer' ? 'timer' : 'speed'),
        speedMode: cfg.speedMode,
        volume: cfg.volume,
        reverb: cfg.reverb,
        fluctuation: cfg.fluctuation,
        loopQuantize: cfg.loopQuantize,
        harmonizer: cfg.harmonizer,
      });
    }
  }

  return result;
}
