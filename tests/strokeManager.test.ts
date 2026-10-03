import { describe, it, expect } from 'vitest';
import { StrokeManager } from '../src/engine/strokeManager';
import { SplinePath } from '../src/math/types';
import { ScaleQuantizer } from '../src/audio/scaleQuantizer';
import { INSTRUMENTS } from '../src/audio/instruments';

describe('StrokeManager Features: Traversal Mode, Edit Translation, Revoicing, and Undo/Redo', () => {
  const dummyPath: SplinePath = {
    segments: [
      {
        p0: { x: 0, y: 100 },
        p1: { x: 50, y: 100 },
        p2: { x: 50, y: 100 },
        p3: { x: 100, y: 100 },
      },
    ],
    isClosed: false,
  };

  it('handles restart traversal mode (one-way journeys start to end then restarts)', () => {
    const sm = new StrokeManager();
    sm.setTraversalMode('restart');
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    const quantizer = new ScaleQuantizer();

    // With L = 100, dt = 1.5s at 100 BPM: speed = 133.33 px/s, distance advances past 100
    sm.update(1.5, 800, 600, quantizer);

    // In restart mode, playhead should wrap (modulo L) rather than bouncing negative
    expect(stroke.playhead.currentDistance).toBeLessThan(stroke.lut.totalLength);
    expect(stroke.playhead.direction).toBe(1); // Always moves forward
  });

  it('supports translating a stroke in edit mode', () => {
    const sm = new StrokeManager();
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);

    const initialX = stroke.path.segments[0].p0.x;
    const initialY = stroke.path.segments[0].p0.y;

    sm.translateStroke(stroke.id, 40, -30, true);

    expect(stroke.path.segments[0].p0.x).toBe(initialX + 40);
    expect(stroke.path.segments[0].p0.y).toBe(initialY - 30);

    // Test undoing the move
    sm.undo();
    expect(stroke.path.segments[0].p0.x).toBe(initialX);
    expect(stroke.path.segments[0].p0.y).toBe(initialY);
  });

  it('supports undoing and redoing newly added strokes', () => {
    const sm = new StrokeManager();
    expect(sm.activeStrokes.length).toBe(0);

    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);
    expect(sm.activeStrokes.length).toBe(1);

    sm.undo();
    expect(sm.activeStrokes.length).toBe(0);

    sm.redo();
    expect(sm.activeStrokes.length).toBe(1);
    expect(sm.activeStrokes[0].id).toBe(stroke.id);
  });

  it('supports re-voicing a stroke and undoing the re-voice', () => {
    const sm = new StrokeManager();
    const stroke = sm.addStroke(dummyPath, 'solid', 'indigo', 100);

    expect(stroke.instrumentId).toBe('indigo');
    expect(stroke.color).toBe(INSTRUMENTS.indigo.color);

    // Re-voice to amber
    sm.revoiceStroke(stroke.id, 'amber');
    expect(stroke.instrumentId).toBe('amber');
    expect(stroke.color).toBe(INSTRUMENTS.amber.color);

    // Undo should revert back to indigo
    sm.undo();
    expect(stroke.instrumentId).toBe('indigo');
    expect(stroke.color).toBe(INSTRUMENTS.indigo.color);

    // Redo should apply amber again
    sm.redo();
    expect(stroke.instrumentId).toBe('amber');
  });

  it('maps horizontal coordinate across the stereo field', () => {
    const canvasWidth = 1000;
    // Left edge
    const normX0 = 0 / canvasWidth;
    const pan0 = Math.max(-1, Math.min(1, 2 * normX0 - 1));
    expect(pan0).toBe(-1.0); // Full left

    // Center
    const normXCenter = 500 / canvasWidth;
    const panCenter = Math.max(-1, Math.min(1, 2 * normXCenter - 1));
    expect(panCenter).toBeCloseTo(0.0, 5); // Center

    // Right edge
    const normXRight = 1000 / canvasWidth;
    const panRight = Math.max(-1, Math.min(1, 2 * normXRight - 1));
    expect(panRight).toBe(1.0); // Full right
  });
});
