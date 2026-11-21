export type DrumZone = 'kick' | 'snare' | 'clap' | 'tom' | 'hihat';

export interface DrumZoneResolution {
  zone: DrumZone;
  label: string;
  tomFreq: number;
}

/**
 * Resolves Onyx 808 drum kit zone and tom tuning from physical canvas frequency (Hz).
 */
export function resolveDrumZone(frequency: number, isRoll: boolean = false): DrumZoneResolution {
  if (frequency < 260) {
    return { zone: 'kick', label: 'Kick', tomFreq: 120 };
  }
  if (frequency < 450) {
    return { zone: 'snare', label: 'Snare', tomFreq: 120 };
  }
  if (frequency < 650) {
    return isRoll
      ? { zone: 'clap', label: 'Clap', tomFreq: 120 }
      : { zone: 'snare', label: 'Snare', tomFreq: 120 };
  }
  if (frequency < 2200) {
    const tomFreq = Math.max(100, Math.min(220, 100 + ((frequency - 650) / 1550) * 120));
    return { zone: 'tom', label: 'Tom', tomFreq };
  }
  return { zone: 'hihat', label: 'Hi-Hat', tomFreq: 120 };
}
