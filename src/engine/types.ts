import { SplinePath, ArcLengthLUT, Point2D, CurveEvaluation } from '../math/types';
import { DroneVoice, XAxisModulationMode } from '../audio/synthVoice';
import { PitchResult } from '../audio/scaleQuantizer';
import { WaveParams, WaveShapeType } from '../math/waveShape';

import { BreathingMode } from '../audio/breathing';

export type StrokeStyle = 'solid' | 'dotted' | 'striped';
export type TraversalMode = 'restart' | 'bounce' | 'pingpong';
export type TimingMode = 'speed' | 'timer';
export type LoopQuantizeMode = 'freeform' | '1bar' | '2bars' | '4bars' | '8bars';
export type SpeedMode = 'speed' | 'timer' | 'bars';
export type HarmonizerMode = 'single' | 'octave' | 'subOctave' | 'dualOctave' | 'fifth' | 'triad' | 'seventh';
export type { XAxisModulationMode, WaveShapeType, BreathingMode };

export interface StrokePlayhead {
  currentDistance: number;
  velocity: number; // pixels / second
  direction: number; // 1 or -1
  lastTriggerDistance: number;
  lastEval: CurveEvaluation | null;
  lastPitch: PitchResult | null;
  trail: Point2D[];
  finished?: boolean;
  currentSwell?: number;
}

export interface DrawnStroke {
  id: string;
  color: string;
  instrumentId: string;
  style: StrokeStyle;
  path: SplinePath;
  lut: ArcLengthLUT;
  playhead: StrokePlayhead;
  droneVoice: DroneVoice | null;
  active: boolean;
  selected?: boolean;
  hovered?: boolean;
  muted?: boolean;
  soloed?: boolean;
  volume?: number; // 0.0 to 1.0 (default 1.0)
  reverb?: number; // 0.0 to 1.0 individual wet reverb send (default 0.40)
  fluctuation?: number; // 0.0 to 1.0 individual tone fluctuation / slight randomness from the line (default 0.0)
  duration?: number; // Duration in seconds when in timer mode (1 to 300s, default 30s)
  speedMultiplier?: number; // 0.1 to 4.0 (default 1.0, relative to BPM base speed)
  timingMode?: TimingMode; // 'speed' (default velocity multiplier) or 'timer' (fixed duration in seconds)
  speedMode?: SpeedMode; // Backward-compatibility alias
  waveParams?: WaveParams;
  loopQuantize?: LoopQuantizeMode;
  traversal?: TraversalMode;
  harmonizer?: HarmonizerMode;
}

export interface SavedComposition {
  version: 1;
  name: string;
  timestamp: number;
  bpm: number;
  scaleId?: string;
  rootId?: string;
  xAxisModulationMode?: XAxisModulationMode;
  spaceReverb?: number;
  octaveSpan?: number;
  progressionId?: string;
  breathingMode?: BreathingMode;
  scrollY?: number;
  strokes: Array<{
    id: string;
    instrumentId: string;
    style: StrokeStyle;
    loopQuantize?: LoopQuantizeMode;
    traversal?: TraversalMode;
    harmonizer?: HarmonizerMode;
    duration?: number;
    speedMultiplier?: number;
    timingMode?: TimingMode;
    speedMode?: SpeedMode;
    volume?: number;
    reverb?: number;
    fluctuation?: number;
    muted?: boolean;
    path: SplinePath;
    waveParams?: WaveParams;
  }>;
}
