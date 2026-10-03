import { SplinePath, ArcLengthLUT, Point2D, CurveEvaluation } from '../math/types';
import { DroneVoice, XAxisModulationMode } from '../audio/synthVoice';
import { PitchResult } from '../audio/scaleQuantizer';
import { WaveParams, WaveShapeType } from '../math/waveShape';

export type StrokeStyle = 'solid' | 'dotted' | 'striped';
export type TraversalMode = 'restart' | 'pingpong';
export type LoopQuantizeMode = 'freeform' | '1bar' | '2bars' | '4bars';
export type { XAxisModulationMode, WaveShapeType };

export interface StrokePlayhead {
  currentDistance: number;
  velocity: number; // pixels / second
  direction: number; // 1 or -1
  lastTriggerDistance: number;
  lastEval: CurveEvaluation | null;
  lastPitch: PitchResult | null;
  trail: Point2D[];
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
  waveParams?: WaveParams;
  loopQuantize?: LoopQuantizeMode;
  traversal?: TraversalMode;
}
