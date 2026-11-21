import type { SplinePath, ArcLengthLUT } from '../math/types';
import type { WaveParams } from '../math/waveShape';
import type {
  DrawnStroke,
  StrokeStyle,
  TraversalMode,
  TimingMode,
  LoopQuantizeMode,
  SpeedMode,
  HarmonizerMode,
} from './types';

export type UndoAction =
  | { type: 'add'; stroke: DrawnStroke }
  | { type: 'batchAdd'; strokes: DrawnStroke[] }
  | { type: 'remove'; stroke: DrawnStroke; index: number }
  | { type: 'batchRemove'; strokes: DrawnStroke[] }
  | { type: 'move'; strokeId: string; dx: number; dy: number }
  | { type: 'multiMove'; moves: { strokeId: string; dx: number; dy: number }[] }
  | { type: 'revoice'; strokeId: string; oldInstrumentId: string; newInstrumentId: string }
  | { type: 'volume'; strokeId: string; oldVolume: number; newVolume: number }
  | { type: 'duration'; strokeId: string; oldDuration: number; newDuration: number }
  | { type: 'speed'; strokeId: string; oldSpeed: number; newSpeed: number }
  | {
      type: 'timingMode';
      strokeId: string;
      oldTimingMode: TimingMode;
      newTimingMode: TimingMode;
      oldSpeed?: number;
      newSpeed?: number;
      oldDuration?: number;
      newDuration?: number;
    }
  | {
      type: 'batchTimingMode';
      records: {
        strokeId: string;
        oldTimingMode: TimingMode;
        newTimingMode: TimingMode;
        oldSpeed?: number;
        newSpeed?: number;
        oldDuration?: number;
        newDuration?: number;
      }[];
    }
  | { type: 'speedMode'; strokeId: string; oldSpeedMode: SpeedMode; newSpeedMode: SpeedMode }
  | { type: 'style'; strokeId: string; oldStyle: StrokeStyle; newStyle: StrokeStyle }
  | { type: 'loopQuantize'; strokeId: string; oldLoopQuantize: LoopQuantizeMode; newLoopQuantize: LoopQuantizeMode }
  | { type: 'traversal'; strokeId: string; oldTraversal: TraversalMode; newTraversal: TraversalMode }
  | { type: 'harmonizer'; strokeId: string; oldHarmonizer: HarmonizerMode; newHarmonizer: HarmonizerMode }
  | { type: 'reverb'; strokeId: string; oldReverb: number; newReverb: number }
  | { type: 'fluctuation'; strokeId: string; oldFluctuation: number; newFluctuation: number }
  | { type: 'distortion'; strokeId: string; oldDistortion: number; newDistortion: number }
  | { type: 'filterCutoff'; strokeId: string; oldFilterCutoff: number; newFilterCutoff: number }
  | { type: 'lofi'; strokeId: string; oldLofi: number; newLofi: number }
  | { type: 'articulation'; strokeId: string; oldArticulation: number; newArticulation: number }
  | {
      type: 'reshape';
      strokeId: string;
      oldPath: SplinePath;
      oldLut: ArcLengthLUT;
      oldWaveParams?: WaveParams;
      newPath: SplinePath;
      newLut: ArcLengthLUT;
      newWaveParams?: WaveParams;
    }
  | {
      type: 'redraw';
      strokeId: string;
      oldPath: SplinePath;
      oldLut: ArcLengthLUT;
      newPath: SplinePath;
      newLut: ArcLengthLUT;
    }
  | {
      type: 'batchSpeed';
      records: {
        strokeId: string;
        oldSpeed: number;
        newSpeed: number;
        oldDuration: number;
        newDuration: number;
      }[];
    }
  | {
      type: 'batchVolume';
      records: {
        strokeId: string;
        oldVolume: number;
        newVolume: number;
      }[];
    };

/**
 * Maps any UndoAction variant to a concise human-readable label for history indicators.
 */
export function describeUndoAction(action: UndoAction): string {
  switch (action.type) {
    case 'add':
      return 'Draw Line';
    case 'batchAdd':
      return 'Add Lines';
    case 'remove':
      return 'Delete Line';
    case 'batchRemove':
      return 'Delete Lines';
    case 'move':
      return 'Move Line';
    case 'multiMove':
      return 'Move Lines';
    case 'revoice':
      return 'Instrument';
    case 'volume':
      return 'Volume';
    case 'duration':
      return 'Timer Duration';
    case 'speed':
      return 'Speed';
    case 'timingMode':
      return 'Timing Mode';
    case 'batchTimingMode':
      return 'Sync Lines Timing';
    case 'speedMode':
      return 'Timing Mode';
    case 'style':
      return 'Line Style';
    case 'loopQuantize':
      return 'Loop Quantize';
    case 'traversal':
      return 'Traversal';
    case 'harmonizer':
      return 'Voicing';
    case 'reverb':
      return 'Reverb';
    case 'fluctuation':
      return 'Fluctuation';
    case 'distortion':
      return 'Distortion';
    case 'filterCutoff':
      return 'Tone Filter';
    case 'lofi':
      return 'Lo-Fi Crunch';
    case 'articulation':
      return 'Gate / Decay';
    case 'reshape':
      return 'Wave Shape';
    case 'redraw':
      return 'Re-draw Line';
    case 'batchSpeed':
      return 'Lines Tempo';
    case 'batchVolume':
      return 'Lines Volume';
    default: {
      const _exhaustive: never = action;
      return String(_exhaustive);
    }
  }
}

/**
 * Bounded undo/redo stack that caps history depth to avoid unbounded memory growth.
 */
export class BoundedHistory<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  private readonly maxDepth: number;

  constructor(maxDepth: number = 150) {
    this.maxDepth = Math.max(1, maxDepth);
  }

  public push(item: T): void {
    this.undoStack.push(item);
    while (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  public undo(): T | undefined {
    const item = this.undoStack.pop();
    if (item === undefined) return undefined;
    this.redoStack.push(item);
    return item;
  }

  public redo(): T | undefined {
    const item = this.redoStack.pop();
    if (item === undefined) return undefined;
    this.undoStack.push(item);
    while (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    return item;
  }

  public clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public peekUndo(): T | undefined {
    return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1] : undefined;
  }

  public peekRedo(): T | undefined {
    return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1] : undefined;
  }

  public get undoSize(): number {
    return this.undoStack.length;
  }

  public get redoSize(): number {
    return this.redoStack.length;
  }

  public forEachAction(fn: (item: T) => void): void {
    for (const item of this.undoStack) {
      fn(item);
    }
    for (const item of this.redoStack) {
      fn(item);
    }
  }
}
