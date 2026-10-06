import { ScaleQuantizer } from './scaleQuantizer';
import { HarmonizerMode } from '../engine/types';

export type { HarmonizerMode };

export interface HarmonizerResult {
  frequencies: number[];
  gains: number[];
}

/**
 * Calculates harmonizer chord frequencies and voice gains based on the active modal scale.
 * All chord voicings (Octaves, Fifths, Triads, 7ths) adapt dynamically to the modal scale degrees,
 * ensuring 100% diatonic coherence without clashing or jarring transitions.
 */
export function getHarmonizerFrequencies(
  mode: HarmonizerMode | undefined,
  baseFreq: number,
  baseDegree: number,
  quantizer: ScaleQuantizer
): HarmonizerResult {
  if (!mode || mode === 'single' || !isFinite(baseFreq) || baseFreq <= 0) {
    return { frequencies: [baseFreq], gains: [1.0] };
  }

  const K = quantizer.getConfig().scale.intervals.length || 7;
  const kBase = Math.round(baseDegree);
  const semiBase = quantizer.getSemitonesForDegree(kBase);

  const getRatioForOffset = (stepOffset: number): number => {
    const semiOffset = quantizer.getSemitonesForDegree(kBase + stepOffset);
    return Math.pow(2, (semiOffset - semiBase) / 12);
  };

  switch (mode) {
    case 'octave': {
      // Clean octave stack (+12 semitones / 1 octave up)
      return {
        frequencies: [baseFreq, baseFreq * 2],
        gains: [0.72, 0.48],
      };
    }

    case 'subOctave': {
      // Sub-octave bass foundation (-12 semitones / 1 octave down)
      return {
        frequencies: [baseFreq, baseFreq * 0.5],
        gains: [0.72, 0.52],
      };
    }

    case 'dualOctave': {
      // Dual acoustic octave spread (-8vb, fundamental, +8va)
      return {
        frequencies: [baseFreq, baseFreq * 0.5, baseFreq * 2],
        gains: [0.60, 0.45, 0.38],
      };
    }

    case 'fifth': {
      // Modal perfect/diatonic fifth (+4 scale steps in 7-note scales, +3 in 5-note pentatonic)
      const fifthOffset = Math.round(K * (4 / 7));
      const rFifth = getRatioForOffset(fifthOffset);
      return {
        frequencies: [baseFreq, baseFreq * rFifth],
        gains: [0.65, 0.52],
      };
    }

    case 'triad': {
      // Modal triad: Root + 3rd + 5th (e.g. Dm in Dorian, Fmaj in Lydian)
      const thirdOffset = Math.round(K * (2 / 7));
      const fifthOffset = Math.round(K * (4 / 7));
      const rThird = getRatioForOffset(thirdOffset);
      const rFifth = getRatioForOffset(fifthOffset);
      return {
        frequencies: [baseFreq, baseFreq * rThird, baseFreq * rFifth],
        gains: [0.46, 0.36, 0.36],
      };
    }

    case 'seventh': {
      // Modal 7th chord: Root + 3rd + 5th + 7th (e.g. Dm7 in Dorian, Fmaj7 in Lydian)
      const thirdOffset = Math.round(K * (2 / 7));
      const fifthOffset = Math.round(K * (4 / 7));
      const seventhOffset = Math.round(K * (6 / 7));
      const rThird = getRatioForOffset(thirdOffset);
      const rFifth = getRatioForOffset(fifthOffset);
      const rSeventh = getRatioForOffset(seventhOffset);
      return {
        frequencies: [baseFreq, baseFreq * rThird, baseFreq * rFifth, baseFreq * rSeventh],
        gains: [0.38, 0.28, 0.28, 0.24],
      };
    }

    default:
      return { frequencies: [baseFreq], gains: [1.0] };
  }
}
