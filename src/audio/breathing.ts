/**
 * Organic Timbral Breathing Engine (Option 3)
 * Provides macro resonant filter swells, staggered polyphonic amplitude ebbing and flowing,
 * and vintage analog pitch drift across drawn strokes without altering fundamental scale degrees.
 */

export type BreathingMode = 'off' | 'gentle' | 'deep' | 'drift';

export interface BreathingModulation {
  filterMultiplier: number; // Lowpass filter cutoff multiplier (0.4x to 1.6x)
  volumeMultiplier: number; // Amplitude ebb/flow multiplier (0.7x to 1.3x)
  detuneCents: number;      // Subtle tape flutter / analog pitch drift in cents (-4 to +4)
}

/**
 * Calculates organic timbral breathing for a specific stroke at time t.
 * Each stroke receives a unique deterministic phase offset phi derived from its ID,
 * ensuring strokes swell and filter-sweep asynchronously like an organic ensemble.
 */
export function calculateBreathing(
  mode: BreathingMode | undefined,
  timeSec: number,
  strokeId: string
): BreathingModulation {
  if (!mode || mode === 'off' || !isFinite(timeSec)) {
    return { filterMultiplier: 1.0, volumeMultiplier: 1.0, detuneCents: 0.0 };
  }

  // Derive unique deterministic phase offset phi in [0, 2pi) for each stroke
  let hash = 0;
  for (let i = 0; i < strokeId.length; i++) {
    hash = (hash * 31 + strokeId.charCodeAt(i)) & 0x7fffffff;
  }
  const phi = ((hash % 1000) / 1000) * Math.PI * 2;
  const t = timeSec;

  switch (mode) {
    case 'gentle': {
      // ~22 second gentle breathing wave with secondary harmonic
      const filterLfo =
        (Math.sin((2 * Math.PI * t) / 22 + phi) +
          0.3 * Math.sin((2 * Math.PI * t) / 14.2 + phi * 1.3)) /
        1.3;
      const volLfo = Math.cos((2 * Math.PI * t) / 22 + phi + Math.PI / 4);
      const pitchLfo = Math.sin((2 * Math.PI * t) / 11.5 + phi * 2.1);

      return {
        filterMultiplier: Math.max(0.45, 1.0 + 0.38 * filterLfo), // ~0.62x - 1.38x
        volumeMultiplier: Math.max(0.4, 1.0 + 0.18 * volLfo),     // ~0.82x - 1.18x
        detuneCents: 2.5 * pitchLfo,                              // +/- 2.5 cents
      };
    }

    case 'deep': {
      // ~34 second deep oceanic swell with dramatic overtone opening
      const filterLfo =
        (Math.sin((2 * Math.PI * t) / 34 + phi) +
          0.45 * Math.cos((2 * Math.PI * t) / 21 + phi * 1.6)) /
        1.45;
      const volLfo = Math.cos((2 * Math.PI * t) / 34 + phi + Math.PI / 6);
      const pitchLfo = Math.sin((2 * Math.PI * t) / 16.3 + phi * 2.7);

      return {
        filterMultiplier: Math.max(0.35, 1.0 + 0.62 * filterLfo), // ~0.38x - 1.62x
        volumeMultiplier: Math.max(0.3, 1.0 + 0.28 * volLfo),     // ~0.72x - 1.28x
        detuneCents: 4.0 * pitchLfo,                              // +/- 4.0 cents
      };
    }

    case 'drift': {
      // Asymmetric dual-rate tape loop phasing (23s & 37s prime periods)
      const filterLfo =
        Math.sin((2 * Math.PI * t) / 23 + phi) *
        Math.cos((2 * Math.PI * t) / 37 + phi * 0.7);
      const volLfo = Math.sin((2 * Math.PI * t) / 31 + phi);
      const pitchLfo = Math.sin((2 * Math.PI * t) / 9.4 + phi * 3.1);

      return {
        filterMultiplier: Math.max(0.4, 1.0 + 0.48 * filterLfo), // ~0.52x - 1.48x
        volumeMultiplier: Math.max(0.4, 1.0 + 0.22 * volLfo),    // ~0.78x - 1.22x
        detuneCents: 3.5 * pitchLfo,                             // +/- 3.5 cents
      };
    }

    default:
      return { filterMultiplier: 1.0, volumeMultiplier: 1.0, detuneCents: 0.0 };
  }
}

