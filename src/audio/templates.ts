import { SplinePath } from '../math/types';
import { StrokeStyle } from '../engine/types';
import { fitSplineFromPoints } from '../math/curveFit';
import { ScaleQuantizer } from './scaleQuantizer';

export interface TemplateStrokeConfig {
  points: { x: number; y: number }[];
  style: StrokeStyle;
  instrumentId: string;
}

export interface MusicalTemplate {
  id: string;
  name: string;
  tagline: string;
  bpm: number;
  scaleId: string;
  rootId: string;
  strokes: (width: number, height: number, quantizer: ScaleQuantizer) => TemplateStrokeConfig[];
}

export const TEMPLATES: Record<string, MusicalTemplate> = {
  ambientDawn: {
    id: 'ambientDawn',
    name: 'Ambient Dawn',
    tagline: 'Deep cello bass drone with kalimba melody and twinkling music box bells',
    bpm: 88,
    scaleId: 'dorian',
    rootId: 'D2',
    strokes: (w: number, h: number, quantizer: ScaleQuantizer) => {
      const guidelines = quantizer.getGuidelines(h);
      // Guidelines indices: 0 = highest, last = root (lowest)
      const rootY = guidelines[0]?.y ?? h * 0.88;
      const fifthY = guidelines[4]?.y ?? h * 0.65;
      const octaveY = guidelines[7]?.y ?? h * 0.45;
      const highY = guidelines[11]?.y ?? h * 0.25;

      return [
        // 1. Deep Indigo Cello Bass Drone (Solid, Root)
        {
          instrumentId: 'indigo',
          style: 'solid',
          points: [
            { x: w * 0.15, y: rootY },
            { x: w * 0.5, y: rootY },
            { x: w * 0.85, y: rootY },
          ],
        },
        // 2. Mid Amber Kalimba Gentle Motif (Dotted Chimes)
        {
          instrumentId: 'amber',
          style: 'dotted',
          points: [
            { x: w * 0.2, y: fifthY },
            { x: w * 0.35, y: fifthY - 20 },
            { x: w * 0.55, y: octaveY },
            { x: w * 0.75, y: fifthY },
          ],
        },
        // 3. High Violet Music Box Shimmer (Dotted Bells)
        {
          instrumentId: 'violet',
          style: 'dotted',
          points: [
            { x: w * 0.3, y: highY },
            { x: w * 0.5, y: highY - 15 },
            { x: w * 0.7, y: highY + 15 },
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
    rootId: 'D2',
    strokes: (w: number, h: number, quantizer: ScaleQuantizer) => {
      const guidelines = quantizer.getGuidelines(h);
      const rootY = guidelines[0]?.y ?? h * 0.88;
      const thirdY = guidelines[2]?.y ?? h * 0.65;
      const fifthY = guidelines[4]?.y ?? h * 0.45;

      return [
        // 1. Slate Analog Moog Bass Pulse (Striped, Root)
        {
          instrumentId: 'slate',
          style: 'striped',
          points: [
            { x: w * 0.1, y: rootY },
            { x: w * 0.5, y: rootY },
            { x: w * 0.9, y: rootY },
          ],
        },
        // 2. Spruce Glass Flute Syncopated Arp (Dotted)
        {
          instrumentId: 'spruce',
          style: 'dotted',
          points: [
            { x: w * 0.2, y: thirdY },
            { x: w * 0.4, y: fifthY },
            { x: w * 0.6, y: thirdY },
            { x: w * 0.8, y: fifthY },
          ],
        },
        // 3. Rose Harp Panning Wave (Solid)
        {
          instrumentId: 'rose',
          style: 'solid',
          points: [
            { x: w * 0.15, y: thirdY - 30 },
            { x: w * 0.5, y: fifthY - 40 },
            { x: w * 0.85, y: thirdY - 30 },
          ],
        },
      ];
    },
  },

  zenMeditation: {
    id: 'zenMeditation',
    name: 'Zen Meditation',
    tagline: 'Ethereal glass organ drone with floating acoustic harp waves',
    bpm: 72,
    scaleId: 'lydian',
    rootId: 'A2',
    strokes: (w: number, h: number, quantizer: ScaleQuantizer) => {
      const guidelines = quantizer.getGuidelines(h);
      const rootY = guidelines[0]?.y ?? h * 0.85;
      const midY = guidelines[4]?.y ?? h * 0.52;
      const topY = guidelines[8]?.y ?? h * 0.28;

      return [
        // 1. Spruce Glass Organ Drone (Solid, Root)
        {
          instrumentId: 'spruce',
          style: 'solid',
          points: [
            { x: w * 0.1, y: rootY },
            { x: w * 0.5, y: rootY },
            { x: w * 0.9, y: rootY },
          ],
        },
        // 2. Rose Acoustic Harp Floating Curve (Dotted)
        {
          instrumentId: 'rose',
          style: 'dotted',
          points: [
            { x: w * 0.18, y: midY },
            { x: w * 0.45, y: topY },
            { x: w * 0.82, y: midY },
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
    rootId: 'D2',
    strokes: (w: number, h: number, quantizer: ScaleQuantizer) => {
      const guidelines = quantizer.getGuidelines(h);
      const rootY = guidelines[0]?.y ?? h * 0.88;
      const bassY = guidelines[2]?.y ?? h * 0.76;
      const leadY = guidelines[5]?.y ?? h * 0.38;

      return [
        // 1. 808 Kick Drum Line (Onyx, Dotted 8th-note pulse in Kick zone)
        {
          instrumentId: 'onyx',
          style: 'dotted',
          points: [
            { x: w * 0.12, y: h * 0.84 },
            { x: w * 0.5, y: h * 0.84 },
            { x: w * 0.88, y: h * 0.84 },
          ],
        },
        // 2. 808 Snare & Clap Line (Onyx, Dotted pulse in Snare zone)
        {
          instrumentId: 'onyx',
          style: 'dotted',
          points: [
            { x: w * 0.2, y: h * 0.58 },
            { x: w * 0.5, y: h * 0.58 },
            { x: w * 0.8, y: h * 0.58 },
          ],
        },
        // 3. 808 Hi-Hat Line (Onyx, Striped 16th-note roll in Top Hat zone)
        {
          instrumentId: 'onyx',
          style: 'striped',
          points: [
            { x: w * 0.1, y: h * 0.16 },
            { x: w * 0.5, y: h * 0.16 },
            { x: w * 0.9, y: h * 0.16 },
          ],
        },
        // 4. Slate Analog 303 Sub-Bass Line (Slate, Dotted)
        {
          instrumentId: 'slate',
          style: 'dotted',
          points: [
            { x: w * 0.15, y: rootY },
            { x: w * 0.38, y: bassY },
            { x: w * 0.62, y: rootY },
            { x: w * 0.85, y: bassY },
          ],
        },
        // 5. Violet Crystalline Synth Lead (Violet, Dotted)
        {
          instrumentId: 'violet',
          style: 'dotted',
          points: [
            { x: w * 0.22, y: leadY },
            { x: w * 0.45, y: leadY - 24 },
            { x: w * 0.68, y: leadY + 18 },
            { x: w * 0.88, y: leadY },
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
): { path: SplinePath; style: StrokeStyle; instrumentId: string }[] {
  const template = TEMPLATES[templateId];
  if (!template) return [];

  const configs = template.strokes(width, height, quantizer);
  const result: { path: SplinePath; style: StrokeStyle; instrumentId: string }[] = [];

  for (const cfg of configs) {
    const spline = fitSplineFromPoints(cfg.points, 20);
    if (spline && spline.segments.length > 0) {
      result.push({
        path: spline,
        style: cfg.style,
        instrumentId: cfg.instrumentId,
      });
    }
  }

  return result;
}
