export type SoundPaletteId = 'celestial' | 'zen' | 'analog' | 'strings' | 'deepspace';

export interface SoundPalette {
  id: SoundPaletteId;
  name: string;
  tagline: string;
  drone: {
    osc1Type: OscillatorType;
    osc2Type: OscillatorType;
    osc2IntervalRatio: number; // Frequency multiple for osc2 (e.g., 1.003 for detune, 1.4983 for 5th)
    subType: OscillatorType;
    filterType: BiquadFilterType;
    baseCutoffMultiplier: number;
    maxCutoff: number;
    baseQ: number;
    curvatureBrightness: number;
  };
  pulse: {
    dottedOscType: OscillatorType;
    dottedDecay: number; // in seconds
    dottedFilterQ: number;
    stripedOscType: OscillatorType;
    stripedDecay: number;
    stripedBandpassQ: number;
  };
}

export const SOUND_PALETTES: Record<SoundPaletteId, SoundPalette> = {
  celestial: {
    id: 'celestial',
    name: 'Celestial Glass',
    tagline: 'Crystalline ambient pads, glass harp chimes & shimmering drops',
    drone: {
      osc1Type: 'sine',
      osc2Type: 'sine',
      osc2IntervalRatio: 1.4983, // Tuned to a perfect 5th for ethereal glass organ resonance
      subType: 'sine',
      filterType: 'lowpass',
      baseCutoffMultiplier: 2.8,
      maxCutoff: 3800,
      baseQ: 1.8,
      curvatureBrightness: 1600,
    },
    pulse: {
      dottedOscType: 'triangle',
      dottedDecay: 0.55,
      dottedFilterQ: 5.0,
      stripedOscType: 'sine',
      stripedDecay: 0.12,
      stripedBandpassQ: 4.5,
    },
  },

  zen: {
    id: 'zen',
    name: 'Zen Acoustic',
    tagline: 'Singing bowl warmth, wooden kalimba & bamboo temple pulses',
    drone: {
      osc1Type: 'triangle',
      osc2Type: 'sine',
      osc2IntervalRatio: 1.002, // Gentle organic beating
      subType: 'triangle',
      filterType: 'lowpass',
      baseCutoffMultiplier: 1.8,
      maxCutoff: 2400,
      baseQ: 2.5,
      curvatureBrightness: 1200,
    },
    pulse: {
      dottedOscType: 'sine', // Warm woody kalimba tine
      dottedDecay: 0.35,
      dottedFilterQ: 3.0,
      stripedOscType: 'triangle',
      stripedDecay: 0.08,
      stripedBandpassQ: 5.5,
    },
  },

  analog: {
    id: 'analog',
    name: 'Analog Modular',
    tagline: 'Vintage Moog-style saw pad, snappy plucks & acid resonance',
    drone: {
      osc1Type: 'sawtooth',
      osc2Type: 'sawtooth',
      osc2IntervalRatio: 1.005, // Rich analog chorus detune
      subType: 'sine',
      filterType: 'lowpass',
      baseCutoffMultiplier: 2.2,
      maxCutoff: 3200,
      baseQ: 4.0,
      curvatureBrightness: 2200,
    },
    pulse: {
      dottedOscType: 'sawtooth',
      dottedDecay: 0.28,
      dottedFilterQ: 4.5,
      stripedOscType: 'square',
      stripedDecay: 0.09,
      stripedBandpassQ: 6.0,
    },
  },

  strings: {
    id: 'strings',
    name: 'Physical Strings',
    tagline: 'Bowed cello drones, acoustic harp plucks & pizzicato taps',
    drone: {
      osc1Type: 'sawtooth',
      osc2Type: 'triangle',
      osc2IntervalRatio: 1.003,
      subType: 'sawtooth',
      filterType: 'lowpass',
      baseCutoffMultiplier: 2.0,
      maxCutoff: 2800,
      baseQ: 2.2,
      curvatureBrightness: 1400,
    },
    pulse: {
      dottedOscType: 'triangle',
      dottedDecay: 0.45,
      dottedFilterQ: 3.5,
      stripedOscType: 'sine',
      stripedDecay: 0.07,
      stripedBandpassQ: 3.0,
    },
  },

  deepspace: {
    id: 'deepspace',
    name: 'Deep Space',
    tagline: 'Sub-bass cosmic drone, sonar pings & galactic FM bursts',
    drone: {
      osc1Type: 'sine',
      osc2Type: 'triangle',
      osc2IntervalRatio: 2.0, // Octave harmonic
      subType: 'sine',
      filterType: 'lowpass',
      baseCutoffMultiplier: 1.5,
      maxCutoff: 1800,
      baseQ: 5.0,
      curvatureBrightness: 1500,
    },
    pulse: {
      dottedOscType: 'sine',
      dottedDecay: 0.7,
      dottedFilterQ: 6.0,
      stripedOscType: 'sawtooth',
      stripedDecay: 0.15,
      stripedBandpassQ: 7.0,
    },
  },
};
