export interface MusicalScale {
  id: string;
  name: string;
  intervals: number[]; // semitone offsets relative to root
}

export const SCALES: Record<string, MusicalScale> = {
  dorian: {
    id: 'dorian',
    name: 'Dorian',
    intervals: [0, 2, 3, 5, 7, 9, 10],
  },
  lydian: {
    id: 'lydian',
    name: 'Lydian',
    intervals: [0, 2, 4, 6, 7, 9, 11],
  },
  minorPentatonic: {
    id: 'minorPentatonic',
    name: 'Minor Pentatonic',
    intervals: [0, 3, 5, 7, 10],
  },
  majorPentatonic: {
    id: 'majorPentatonic',
    name: 'Major Pentatonic',
    intervals: [0, 2, 4, 7, 9],
  },
  aeolian: {
    id: 'aeolian',
    name: 'Aeolian (Natural Minor)',
    intervals: [0, 2, 3, 5, 7, 8, 10],
  },
};

export interface RootNote {
  name: string;
  frequency: number; // in Hz
  baseMidi: number;
}

export const ROOT_NOTES: Record<string, RootNote> = {
  D2: { name: 'D2', frequency: 73.416, baseMidi: 38 },
  E2: { name: 'E2', frequency: 82.407, baseMidi: 40 },
  F2: { name: 'F2', frequency: 87.307, baseMidi: 41 },
  G2: { name: 'G2', frequency: 97.999, baseMidi: 43 },
  A2: { name: 'A2', frequency: 110.000, baseMidi: 45 },
  C3: { name: 'C3', frequency: 130.813, baseMidi: 48 },
  D3: { name: 'D3', frequency: 146.832, baseMidi: 50 },
  E3: { name: 'E3', frequency: 164.814, baseMidi: 52 },
  F3: { name: 'F3', frequency: 174.614, baseMidi: 53 },
  G3: { name: 'G3', frequency: 195.998, baseMidi: 55 },
  A3: { name: 'A3', frequency: 220.000, baseMidi: 57 },
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Returns formatted note name (e.g. "D3", "G#4") from fractional or integer semitone offset and root MIDI.
 */
export function getNoteNameFromSemitones(baseMidi: number, semitones: number): string {
  const midi = Math.round(baseMidi + semitones);
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}
