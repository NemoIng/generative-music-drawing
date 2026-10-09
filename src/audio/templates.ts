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
  initialScrollRatio?: number;
  strokes: (width: number, height: number, quantizer: ScaleQuantizer) => TemplateStrokeConfig[];
}

export const TEMPLATES: Record<string, MusicalTemplate> = {
  deepCosmicDrone: {
    id: 'deepCosmicDrone',
    name: 'Deep Cosmic Drone',
    tagline: 'Vast interstellar drone with resonant analog sub-bass, chorused cello fifths, and glass organ (24 BPM)',
    bpm: 24,
    scaleId: 'dorian',
    rootId: 'D2',
    spaceReverb: 0.80,
    octaveSpan: 4,
    xAxisModulation: 'panAndTone',
    breathingMode: 'deep',
    initialScrollRatio: 1.5,
    strokes: (w: number, h: number, _quantizer: ScaleQuantizer) => {
      const subBassY = h * 0.905;
      const celloY = h * 0.599;
      const organY = h * 0.285;
      const tineY = h * 0.461;

      return [
        // 1. Slate Analog Sub-Bass Drone (Sustained Bounce, 90s timer)
        {
          instrumentId: 'slate',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 90,
          volume: 0.90,
          reverb: 0.35,
          fluctuation: 0.06,
          points: [
            { x: w * 0.10, y: subBassY },
            { x: w * 0.30, y: subBassY - 10 },
            { x: w * 0.52, y: subBassY + 8 },
            { x: w * 0.72, y: subBassY - 6 },
            { x: w * 0.86, y: subBassY },
          ],
        },
        // 2. Indigo Bowed Cello Harmonic Fifth (Bounce, 75s timer, fifth harmonizer)
        {
          instrumentId: 'indigo',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 75,
          volume: 0.80,
          reverb: 0.45,
          fluctuation: 0.08,
          harmonizer: 'fifth',
          points: [
            { x: w * 0.12, y: celloY },
            { x: w * 0.35, y: celloY - 18 },
            { x: w * 0.60, y: celloY + 12 },
            { x: w * 0.84, y: celloY - 8 },
          ],
        },
        // 3. Spruce Pure Glass Organ Pad (Bounce, 80s timer)
        {
          instrumentId: 'spruce',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 80,
          volume: 0.70,
          reverb: 0.75,
          fluctuation: 0.05,
          points: [
            { x: w * 0.14, y: organY + 15 },
            { x: w * 0.38, y: organY - 20 },
            { x: w * 0.62, y: organY + 10 },
            { x: w * 0.82, y: organY - 12 },
          ],
        },
        // 4. Amber Resonant Wooden Tines (Dotted, Restart, 55s timer)
        {
          instrumentId: 'amber',
          style: 'dotted',
          traversal: 'restart',
          timingMode: 'timer',
          duration: 55,
          volume: 0.55,
          reverb: 0.60,
          fluctuation: 0.10,
          points: [
            { x: w * 0.16, y: tineY + 15 },
            { x: w * 0.36, y: tineY - 18 },
            { x: w * 0.56, y: tineY + 12 },
            { x: w * 0.76, y: tineY - 15 },
            { x: w * 0.85, y: tineY },
          ],
        },
      ];
    },
  },

  cathedralSolitude: {
    id: 'cathedralSolitude',
    name: 'Cathedral of Solitude',
    tagline: 'Sacred stone sanctuary with soaring glass organ, bowed acoustic cello, and luminous Lydian bells (30 BPM)',
    bpm: 30,
    scaleId: 'lydian',
    rootId: 'C2',
    spaceReverb: 0.85,
    octaveSpan: 4,
    xAxisModulation: 'panAndTone',
    breathingMode: 'deep',
    initialScrollRatio: 1.5,
    strokes: (w: number, h: number, _quantizer: ScaleQuantizer) => {
      const organRootY = h * 0.824;
      const celloY = h * 0.630;
      const harpY = h * 0.463;
      const bellY = h * 0.151;

      return [
        // 1. Spruce Glass Organ Foundation (Bounce, 80s timer)
        {
          instrumentId: 'spruce',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 80,
          volume: 0.85,
          reverb: 0.75,
          fluctuation: 0.04,
          points: [
            { x: w * 0.10, y: organRootY },
            { x: w * 0.32, y: organRootY - 14 },
            { x: w * 0.58, y: organRootY + 10 },
            { x: w * 0.86, y: organRootY },
          ],
        },
        // 2. Indigo Bowed Cello Sacred Choral Chant (Bounce, 65s timer, octave harmonizer)
        {
          instrumentId: 'indigo',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 65,
          volume: 0.75,
          reverb: 0.55,
          fluctuation: 0.07,
          harmonizer: 'octave',
          points: [
            { x: w * 0.12, y: celloY },
            { x: w * 0.36, y: celloY - 20 },
            { x: w * 0.62, y: celloY + 15 },
            { x: w * 0.84, y: celloY - 10 },
          ],
        },
        // 3. Rose Plucked Acoustic Harp Swell (Bounce, 55s timer)
        {
          instrumentId: 'rose',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 55,
          volume: 0.70,
          reverb: 0.80,
          fluctuation: 0.07,
          points: [
            { x: w * 0.14, y: harpY + 20 },
            { x: w * 0.35, y: harpY - 25 },
            { x: w * 0.56, y: harpY + 10 },
            { x: w * 0.75, y: harpY - 20 },
            { x: w * 0.85, y: harpY },
          ],
        },
        // 4. Violet Sanctuary Chimes (Dotted, Restart, 50s timer)
        {
          instrumentId: 'violet',
          style: 'dotted',
          traversal: 'restart',
          timingMode: 'timer',
          duration: 50,
          volume: 0.50,
          reverb: 0.90,
          fluctuation: 0.08,
          points: [
            { x: w * 0.18, y: bellY + 15 },
            { x: w * 0.38, y: bellY - 18 },
            { x: w * 0.60, y: bellY + 10 },
            { x: w * 0.80, y: bellY - 15 },
          ],
        },
      ];
    },
  },

  warmTapeDrift: {
    id: 'warmTapeDrift',
    name: 'Warm Tape Drift',
    tagline: 'Eno-style tape loop minimalism with detuned acoustic kalimba, warm cello bed, and gentle flutter (36 BPM)',
    bpm: 36,
    scaleId: 'majorPentatonic',
    rootId: 'G2',
    spaceReverb: 0.60,
    octaveSpan: 3,
    xAxisModulation: 'panAndTone',
    breathingMode: 'drift',
    initialScrollRatio: 1.3,
    strokes: (w: number, h: number, _quantizer: ScaleQuantizer) => {
      const celloY = h * 0.905;
      const kalimbaY = h * 0.683;
      const harpY = h * 0.292;
      const fluteY = h * 0.109;

      return [
        // 1. Indigo Bowed Cello Bass Foundation (Bounce, 70s timer)
        {
          instrumentId: 'indigo',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 70,
          volume: 0.85,
          reverb: 0.40,
          fluctuation: 0.08,
          points: [
            { x: w * 0.10, y: celloY },
            { x: w * 0.34, y: celloY + 10 },
            { x: w * 0.62, y: celloY - 12 },
            { x: w * 0.86, y: celloY },
          ],
        },
        // 2. Amber Acoustic Kalimba Detuned Drone Bed (Bounce, 60s timer)
        {
          instrumentId: 'amber',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 60,
          volume: 0.75,
          reverb: 0.55,
          fluctuation: 0.12,
          points: [
            { x: w * 0.12, y: kalimbaY + 15 },
            { x: w * 0.36, y: kalimbaY - 18 },
            { x: w * 0.60, y: kalimbaY + 12 },
            { x: w * 0.84, y: kalimbaY - 10 },
          ],
        },
        // 3. Rose Plucked Harp Tape Loop Plucks (Dotted, Restart, 45s timer)
        {
          instrumentId: 'rose',
          style: 'dotted',
          traversal: 'restart',
          timingMode: 'timer',
          duration: 45,
          volume: 0.65,
          reverb: 0.65,
          fluctuation: 0.08,
          points: [
            { x: w * 0.15, y: harpY + 18 },
            { x: w * 0.34, y: harpY - 15 },
            { x: w * 0.54, y: harpY + 12 },
            { x: w * 0.72, y: harpY - 20 },
            { x: w * 0.84, y: harpY },
          ],
        },
        // 4. Spruce Breathy Flute Floating Ribbon (Bounce, 50s timer)
        {
          instrumentId: 'spruce',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 50,
          volume: 0.60,
          reverb: 0.70,
          fluctuation: 0.06,
          points: [
            { x: w * 0.16, y: fluteY + 12 },
            { x: w * 0.40, y: fluteY - 18 },
            { x: w * 0.64, y: fluteY + 10 },
            { x: w * 0.82, y: fluteY - 12 },
          ],
        },
      ];
    },
  },

  zenGarden: {
    id: 'zenGarden',
    name: 'Zen Garden',
    tagline: 'Tranquil bamboo sanctuary with resonant singing bowls, wooden water drops, and plucked koto (42 BPM)',
    bpm: 42,
    scaleId: 'minorPentatonic',
    rootId: 'A2',
    spaceReverb: 0.70,
    octaveSpan: 4,
    xAxisModulation: 'panAndTone',
    breathingMode: 'gentle',
    initialScrollRatio: 1.25,
    strokes: (w: number, h: number, _quantizer: ScaleQuantizer) => {
      const bowlY = h * 0.869;
      const bambooDropsY = h * 0.521;
      const kotoY = h * 0.201;
      const chimeY = h * 0.052;

      return [
        // 1. Spruce Glass Organ Singing Bowl Drone (Bounce, 85s timer)
        {
          instrumentId: 'spruce',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 85,
          volume: 0.80,
          reverb: 0.70,
          fluctuation: 0.04,
          points: [
            { x: w * 0.10, y: bowlY },
            { x: w * 0.34, y: bowlY - 12 },
            { x: w * 0.60, y: bowlY + 15 },
            { x: w * 0.86, y: bowlY },
          ],
        },
        // 2. Amber Bamboo Water Drops & Temple Blocks (Dotted, Restart, 38s timer)
        {
          instrumentId: 'amber',
          style: 'dotted',
          traversal: 'restart',
          timingMode: 'timer',
          duration: 38,
          volume: 0.75,
          reverb: 0.50,
          fluctuation: 0.12,
          points: [
            { x: w * 0.14, y: bambooDropsY + 18 },
            { x: w * 0.34, y: bambooDropsY - 20 },
            { x: w * 0.52, y: bambooDropsY + 12 },
            { x: w * 0.70, y: bambooDropsY - 16 },
            { x: w * 0.84, y: bambooDropsY },
          ],
        },
        // 3. Rose Plucked Koto Pentatonic Phrase (Dotted, Restart, 46s timer)
        {
          instrumentId: 'rose',
          style: 'dotted',
          traversal: 'restart',
          timingMode: 'timer',
          duration: 46,
          volume: 0.65,
          reverb: 0.65,
          fluctuation: 0.08,
          points: [
            { x: w * 0.16, y: kotoY + 15 },
            { x: w * 0.36, y: kotoY - 18 },
            { x: w * 0.56, y: kotoY + 10 },
            { x: w * 0.74, y: kotoY - 20 },
            { x: w * 0.85, y: kotoY + 8 },
          ],
        },
        // 4. Violet Gentle Wind Chime Breeze (Dotted, Restart, 58s timer)
        {
          instrumentId: 'violet',
          style: 'dotted',
          traversal: 'restart',
          timingMode: 'timer',
          duration: 58,
          volume: 0.45,
          reverb: 0.85,
          fluctuation: 0.09,
          points: [
            { x: w * 0.20, y: chimeY + 10 },
            { x: w * 0.42, y: chimeY - 18 },
            { x: w * 0.64, y: chimeY + 8 },
            { x: w * 0.82, y: chimeY - 14 },
          ],
        },
      ];
    },
  },

  midnightPulse: {
    id: 'midnightPulse',
    name: 'Midnight Pulse',
    tagline: 'Cinematic nocturnal groove with 808 sub kick, warm backbeat clap, analog sub-bass, and night strings (52 BPM)',
    bpm: 52,
    scaleId: 'aeolian',
    rootId: 'D2',
    spaceReverb: 0.55,
    octaveSpan: 4,
    xAxisModulation: 'panAndTone',
    breathingMode: 'drift',
    initialScrollRatio: 1.5,
    strokes: (w: number, h: number, _quantizer: ScaleQuantizer) => {
      const kickY = h * 0.84;
      const clapY = h * 0.58;
      const bassY = h * 0.794;
      const stringY = h * 0.376;
      const organY = h * 0.101;

      return [
        // 1. Onyx 808 Sub-Bass Kick Pulse (Kick Zone >= 0.72)
        {
          instrumentId: 'onyx',
          style: 'striped',
          traversal: 'restart',
          timingMode: 'timer',
          duration: 32,
          volume: 0.95,
          reverb: 0.15,
          points: [
            { x: w * 0.10, y: kickY },
            { x: w * 0.34, y: kickY + 6 },
            { x: w * 0.58, y: kickY - 6 },
            { x: w * 0.86, y: kickY },
          ],
        },
        // 2. Onyx 808 Warm Ambient Snare/Clap Backbeat (Snare Zone 0.48 to 0.72)
        {
          instrumentId: 'onyx',
          style: 'striped',
          traversal: 'restart',
          timingMode: 'timer',
          duration: 48,
          volume: 0.70,
          reverb: 0.40,
          points: [
            { x: w * 0.14, y: clapY },
            { x: w * 0.38, y: clapY + 8 },
            { x: w * 0.62, y: clapY - 8 },
            { x: w * 0.84, y: clapY },
          ],
        },
        // 3. Slate Solar Analog Bassline (Solid, Bounce, 60s timer)
        {
          instrumentId: 'slate',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 60,
          volume: 0.85,
          reverb: 0.30,
          fluctuation: 0.07,
          points: [
            { x: w * 0.12, y: bassY },
            { x: w * 0.36, y: bassY - 14 },
            { x: w * 0.60, y: bassY + 10 },
            { x: w * 0.84, y: bassY - 8 },
          ],
        },
        // 4. Indigo Bowed Strings Nocturnal Chords (Solid, Bounce, 50s timer, fifth harmonizer)
        {
          instrumentId: 'indigo',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 50,
          volume: 0.75,
          reverb: 0.50,
          harmonizer: 'fifth',
          points: [
            { x: w * 0.14, y: stringY + 12 },
            { x: w * 0.38, y: stringY - 18 },
            { x: w * 0.62, y: stringY + 10 },
            { x: w * 0.82, y: stringY - 12 },
          ],
        },
        // 5. Spruce Ambient Glass Organ Night Melody (Solid, Bounce, 42s timer)
        {
          instrumentId: 'spruce',
          style: 'solid',
          traversal: 'bounce',
          timingMode: 'timer',
          duration: 42,
          volume: 0.65,
          reverb: 0.65,
          fluctuation: 0.05,
          points: [
            { x: w * 0.16, y: organY + 14 },
            { x: w * 0.40, y: organY - 18 },
            { x: w * 0.64, y: organY + 12 },
            { x: w * 0.84, y: organY - 14 },
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
