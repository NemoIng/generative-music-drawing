import { SplinePath, ArcLengthLUT, Point2D, CurveEvaluation } from '../math/types';
import { DroneVoice, XAxisModulationMode } from '../audio/synthVoice';
import { PitchResult } from '../audio/scaleQuantizer';

export type StrokeStyle = 'solid' | 'dotted' | 'striped';
export type TraversalMode = 'restart' | 'pingpong';
export type { XAxisModulationMode };

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
}
