import type { SavedComposition } from '../engine/types';

export type ABSlot = 'A' | 'B';

function cloneComposition(snapshot: SavedComposition): SavedComposition {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(snapshot);
    } catch {
      // Fallback to JSON clone if snapshot contains non-cloneable metadata
    }
  }
  return JSON.parse(JSON.stringify(snapshot)) as SavedComposition;
}

export class ABSnapshotManager {
  private slotA: SavedComposition | null = null;
  private slotB: SavedComposition | null = null;
  private activeSlot: ABSlot = 'B';

  public captureA(snapshot: SavedComposition): void {
    this.slotA = cloneComposition(snapshot);
    this.slotB = null;
    this.activeSlot = 'B';
  }

  public hasSnapshot(): boolean {
    return this.slotA !== null;
  }

  public getActiveSlot(): ABSlot {
    return this.activeSlot;
  }

  public toggle(
    currentLive: SavedComposition
  ): { slot: ABSlot; snapshot: SavedComposition } | null {
    if (!this.slotA) {
      return null;
    }

    if (this.activeSlot === 'B') {
      this.slotB = cloneComposition(currentLive);
      this.activeSlot = 'A';
      return {
        slot: 'A',
        snapshot: cloneComposition(this.slotA),
      };
    }

    if (!this.slotB) {
      return null;
    }

    this.slotA = cloneComposition(currentLive);
    this.activeSlot = 'B';
    return {
      slot: 'B',
      snapshot: cloneComposition(this.slotB),
    };
  }

  public clear(): void {
    this.slotA = null;
    this.slotB = null;
    this.activeSlot = 'B';
  }
}
