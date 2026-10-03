export interface DroneParams {
  osc1Type: OscillatorType;
  osc2Type: OscillatorType;
  osc2IntervalRatio: number;
  subType: OscillatorType;
  filterType: BiquadFilterType;
  baseCutoffMultiplier: number;
  maxCutoff: number;
  baseQ: number;
  curvatureBrightness: number;
}

export interface PulseParams {
  dottedOscType: OscillatorType;
  dottedDecay: number; // in seconds
  dottedFilterQ: number;
  stripedOscType: OscillatorType;
  stripedDecay: number;
  stripedBandpassQ: number;
}

export interface InstrumentDefinition {
  id: string;
  name: string;
  color: string;
  icon: string;
  tagline: string;
  drone: DroneParams;
  pulse: PulseParams;
}

export const INSTRUMENTS: Record<string, InstrumentDefinition> = {
  indigo: {
    id: 'indigo',
    name: 'Bowed Strings & Cello',
    color: '#2563eb', // Vibrant indigo / sapphire
    icon: '🎻',
    tagline: 'Warm bowed cello drone, acoustic body resonance & pizzicato plucks',
    drone: {
      osc1Type: 'sawtooth',
      osc2Type: 'triangle',
      osc2IntervalRatio: 1.003, // Subtle chorus detune
      subType: 'sawtooth',
      filterType: 'lowpass',
      baseCutoffMultiplier: 2.1,
      maxCutoff: 2800,
      baseQ: 2.2,
      curvatureBrightness: 1400,
    },
    pulse: {
      dottedOscType: 'triangle',
      dottedDecay: 0.42,
      dottedFilterQ: 3.5,
      stripedOscType: 'sawtooth',
      stripedDecay: 0.08,
      stripedBandpassQ: 4.0,
    },
  },

  amber: {
    id: 'amber',
    name: 'Acoustic Kalimba & Wood',
    color: '#d97706', // Warm amber / terracotta
    icon: '🪵',
    tagline: 'Resonant wooden thumb piano, warm organic tines & temple block taps',
    drone: {
      osc1Type: 'triangle',
      osc2Type: 'sine',
      osc2IntervalRatio: 1.002,
      subType: 'triangle',
      filterType: 'lowpass',
      baseCutoffMultiplier: 1.8,
      maxCutoff: 2200,
      baseQ: 2.6,
      curvatureBrightness: 1100,
    },
    pulse: {
      dottedOscType: 'sine', // Snappy wooden tine
      dottedDecay: 0.36,
      dottedFilterQ: 3.2,
      stripedOscType: 'triangle',
      stripedDecay: 0.08,
      stripedBandpassQ: 5.5,
    },
  },

  spruce: {
    id: 'spruce',
    name: 'Glass Organ & Flute',
    color: '#059669', // Emerald / spruce jade
    icon: '🫧',
    tagline: 'Pure fifth-harmony glass organ, breathy flute air & droplet chimes',
    drone: {
      osc1Type: 'sine',
      osc2Type: 'sine',
      osc2IntervalRatio: 1.4983, // Perfect 5th overtone
      subType: 'sine',
      filterType: 'lowpass',
      baseCutoffMultiplier: 2.8,
      maxCutoff: 3600,
      baseQ: 1.8,
      curvatureBrightness: 1600,
    },
    pulse: {
      dottedOscType: 'triangle',
      dottedDecay: 0.52,
      dottedFilterQ: 4.8,
      stripedOscType: 'sine',
      stripedDecay: 0.12,
      stripedBandpassQ: 4.2,
    },
  },

  violet: {
    id: 'violet',
    name: 'Music Box & Bells',
    color: '#7c3aed', // Radiant amethyst / violet
    icon: '🔔',
    tagline: 'Sparkling clockwork music box, crystalline bells & celestial shimmer',
    drone: {
      osc1Type: 'sine',
      osc2Type: 'triangle',
      osc2IntervalRatio: 2.0, // Octave harmonic shimmer
      subType: 'sine',
      filterType: 'lowpass',
      baseCutoffMultiplier: 3.2,
      maxCutoff: 4200,
      baseQ: 3.0,
      curvatureBrightness: 2000,
    },
    pulse: {
      dottedOscType: 'sine', // Bell ping
      dottedDecay: 0.65,
      dottedFilterQ: 6.0,
      stripedOscType: 'triangle',
      stripedDecay: 0.14,
      stripedBandpassQ: 6.5,
    },
  },

  rose: {
    id: 'rose',
    name: 'Acoustic Harp & Koto',
    color: '#e11d48', // Coral rose
    icon: '🪕',
    tagline: 'Plucked acoustic harp transients, wooden soundboard decay & zither strums',
    drone: {
      osc1Type: 'triangle',
      osc2Type: 'sawtooth',
      osc2IntervalRatio: 1.004,
      subType: 'sine',
      filterType: 'lowpass',
      baseCutoffMultiplier: 2.4,
      maxCutoff: 3000,
      baseQ: 2.0,
      curvatureBrightness: 1300,
    },
    pulse: {
      dottedOscType: 'triangle',
      dottedDecay: 0.48,
      dottedFilterQ: 4.0,
      stripedOscType: 'sine',
      stripedDecay: 0.09,
      stripedBandpassQ: 4.8,
    },
  },

  slate: {
    id: 'slate',
    name: 'Analog Moog & Sub',
    color: '#334155', // Deep slate obsidian
    icon: '⚡',
    tagline: 'Vintage detuned saw/square oscillators, resonant 24dB ladder filter & 303 acid',
    drone: {
      osc1Type: 'sawtooth',
      osc2Type: 'sawtooth',
      osc2IntervalRatio: 1.006, // Thick analog chorus
      subType: 'sine',
      filterType: 'lowpass',
      baseCutoffMultiplier: 2.0,
      maxCutoff: 2900,
      baseQ: 4.2,
      curvatureBrightness: 2200,
    },
    pulse: {
      dottedOscType: 'sawtooth',
      dottedDecay: 0.28,
      dottedFilterQ: 5.0,
      stripedOscType: 'square',
      stripedDecay: 0.09,
      stripedBandpassQ: 6.2,
    },
  },
};

export const DEFAULT_INSTRUMENT = INSTRUMENTS.indigo;

export function getInstrument(id: string): InstrumentDefinition {
  return INSTRUMENTS[id] || DEFAULT_INSTRUMENT;
}
