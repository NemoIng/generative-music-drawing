import { SplinePath, CubicBezierSegment, Point2D } from '../math/types';
import { ScaleQuantizer } from '../audio/scaleQuantizer';
import { DrawnStroke, StrokeStyle, TraversalMode } from './types';

export type AssistedLineCount = 2 | 3 | 4 | 5;
export type AssistedInstrumentMode = 'same' | 'mixed';

export interface AssistedGenerationOptions {
  instrumentMode?: AssistedInstrumentMode;
}

export interface AssistedStrokeSpec {
  path: SplinePath;
  style: StrokeStyle;
  instrumentId: string;
  volumeMultiplier: number;
  reverbDelta?: number;
  traversal?: TraversalMode;
  isPoint?: boolean;
  initialPhaseRatio: number;
  initialDirection: 1 | -1;
}

interface CounterpointRecipe {
  degOffset: number;
  contourScale: number;
  desiredDx: number;
  volumeMultiplier: number;
  reverbDelta: number;
  traversal: TraversalMode;
}

const COMPLEMENTARY_INSTRUMENTS: Record<string, string[]> = {
  indigo: ['rose', 'spruce', 'amber', 'violet'],
  amber: ['spruce', 'indigo', 'rose', 'violet'],
  spruce: ['indigo', 'rose', 'violet', 'amber'],
  violet: ['indigo', 'spruce', 'rose', 'amber'],
  rose: ['indigo', 'spruce', 'amber', 'violet'],
  slate: ['indigo', 'amber', 'spruce', 'rose'],
  onyx: ['amber', 'slate', 'indigo', 'spruce'],
};

function resolveCompanionInstrument(
  primaryInstrumentId: string,
  companionIndex: number,
  mode: AssistedInstrumentMode
): string {
  if (mode !== 'mixed') {
    return primaryInstrumentId;
  }
  const palette = COMPLEMENTARY_INSTRUMENTS[primaryInstrumentId];
  return palette ? palette[companionIndex % palette.length] : primaryInstrumentId;
}

/**
 * Computes horizontal bounding span across all spline control points.
 */
function getPathXBounds(path: SplinePath): { minX: number; maxX: number; spanX: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const seg of path.segments) {
    for (const pt of [seg.p0, seg.p1, seg.p2, seg.p3]) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
    }
  }
  if (!isFinite(minX) || !isFinite(maxX)) {
    return { minX: 0, maxX: 0, spanX: 0 };
  }
  return { minX, maxX, spanX: maxX - minX };
}

/**
 * Computes a rigid horizontal offset keeping the entire spline inside visible canvas margins
 * while preserving exact curve geometry (never pinching control points individually).
 */
function computeSafeHorizontalShift(
  minX: number,
  maxX: number,
  desiredDx: number,
  canvasWidth: number
): number {
  const safeW = canvasWidth > 40 ? canvasWidth : 1200;
  const margin = 16;
  let dx = desiredDx;

  if (minX + dx < margin && maxX - dx <= safeW - margin) {
    dx = -dx;
  } else if (maxX + dx > safeW - margin && minX - dx >= margin) {
    dx = -dx;
  }

  const minAllowedDx = margin - minX;
  const maxAllowedDx = safeW - margin - maxX;
  if (minAllowedDx <= maxAllowedDx) {
    return Math.max(minAllowedDx, Math.min(maxAllowedDx, dx));
  }
  return 0;
}

/**
 * Converts a canvas/world Y coordinate into a continuous modal scale degree.
 */
function yToContinuousDegree(y: number, quantizer: ScaleQuantizer, canvasHeight: number): number {
  const effectiveH = quantizer.isScrollEnabled ? quantizer.getWorldHeight(canvasHeight) : canvasHeight;
  const u = quantizer.normalizeY(y, effectiveH);
  const freq = ScaleQuantizer.normalizedUToFrequency(u);
  return quantizer.frequencyToContinuousDegree(freq);
}

/**
 * Converts a continuous modal scale degree back into a canvas/world Y coordinate.
 */
function continuousDegreeToY(degree: number, quantizer: ScaleQuantizer, canvasHeight: number): number {
  const kFloor = Math.floor(degree);
  const frac = degree - kFloor;
  const semi1 = quantizer.getSemitonesForDegree(kFloor);
  const semi2 = quantizer.getSemitonesForDegree(kFloor + 1);
  const semi = semi1 + frac * (semi2 - semi1);
  const rootFreq = quantizer.getConfig().root.frequency;
  const freq = rootFreq * Math.pow(2, semi / 12);
  const clampedFreq = Math.max(ScaleQuantizer.MIN_FREQ * 1.03, Math.min(ScaleQuantizer.MAX_FREQ * 0.95, freq));
  const u = ScaleQuantizer.frequencyToNormalizedU(clampedFreq);
  return quantizer.isScrollEnabled
    ? quantizer.normalizedUToWorldY(u, canvasHeight)
    : quantizer.normalizedUToCanvasY(u, canvasHeight);
}

/**
 * Converts a target frequency (Hz) to canvas/world Y coordinate.
 */
function freqToY(freq: number, quantizer: ScaleQuantizer, canvasHeight: number): number {
  const clampedFreq = Math.max(ScaleQuantizer.MIN_FREQ * 1.03, Math.min(ScaleQuantizer.MAX_FREQ * 0.95, freq));
  const u = ScaleQuantizer.frequencyToNormalizedU(clampedFreq);
  return quantizer.isScrollEnabled
    ? quantizer.normalizedUToWorldY(u, canvasHeight)
    : quantizer.normalizedUToCanvasY(u, canvasHeight);
}

/**
 * Computes average Y across all control points of a spline path.
 */
function getMeanY(path: SplinePath): number {
  let sumY = 0;
  let count = 0;
  for (const seg of path.segments) {
    sumY += seg.p0.y + seg.p1.y + seg.p2.y + seg.p3.y;
    count += 4;
  }
  return count > 0 ? sumY / count : 0;
}

/**
 * Computes average continuous scale degree across all control points of a spline path.
 */
function getMeanDegree(path: SplinePath, quantizer: ScaleQuantizer, canvasHeight: number): number {
  let sumDeg = 0;
  let count = 0;
  for (const seg of path.segments) {
    sumDeg +=
      yToContinuousDegree(seg.p0.y, quantizer, canvasHeight) +
      yToContinuousDegree(seg.p1.y, quantizer, canvasHeight) +
      yToContinuousDegree(seg.p2.y, quantizer, canvasHeight) +
      yToContinuousDegree(seg.p3.y, quantizer, canvasHeight);
    count += 4;
  }
  return count > 0 ? sumDeg / count : 0;
}

/**
 * Builds a companion SplinePath by mapping each control point via transformFn,
 * preserving stationary dot micro-segment offsets when isPoint is true.
 */
function mapSplinePath(
  source: SplinePath,
  isPoint: boolean,
  transformPoint: (pt: Point2D) => Point2D
): SplinePath {
  if (isPoint && source.segments.length > 0) {
    const p0 = transformPoint(source.segments[0].p0);
    return {
      segments: [
        {
          p0: { x: p0.x, y: p0.y },
          p1: { x: p0.x + 0.1, y: p0.y },
          p2: { x: p0.x + 0.2, y: p0.y },
          p3: { x: p0.x + 0.3, y: p0.y },
        },
      ],
      isClosed: false,
    };
  }

  const segments: CubicBezierSegment[] = source.segments.map((seg) => ({
    p0: transformPoint(seg.p0),
    p1: transformPoint(seg.p1),
    p2: transformPoint(seg.p2),
    p3: transformPoint(seg.p3),
  }));

  return {
    segments,
    isClosed: source.isClosed,
  };
}

/**
 * Ensures a scale degree offset remains comfortably inside the playable frequency spectrum
 * by inverting its direction if it would saturate near 110 Hz or 8000 Hz boundaries.
 */
function fitDegreeOffsetInRange(
  meanDeg: number,
  degOffset: number,
  quantizer: ScaleQuantizer
): number {
  const targetFreq = quantizer.getFrequencyForDegree(Math.round(meanDeg + degOffset));
  if (targetFreq > ScaleQuantizer.MAX_FREQ * 0.85 && degOffset > 0) {
    return -degOffset;
  }
  if (targetFreq < ScaleQuantizer.MIN_FREQ * 1.15 && degOffset < 0) {
    return -degOffset;
  }
  return degOffset;
}

/**
 * Generates complementary drum machine companions across kick, snare, tom, and hi-hat zones
 * with staggered playhead phase ratios and rigid horizontal spread.
 */
function generateOnyxCompanions(
  primaryStroke: DrawnStroke,
  totalLines: number,
  quantizer: ScaleQuantizer,
  canvasHeight: number,
  canvasWidth: number
): AssistedStrokeSpec[] {
  const numCompanions = totalLines - 1;
  const meanY = getMeanY(primaryStroke.path);
  const effectiveH = quantizer.isScrollEnabled ? quantizer.getWorldHeight(canvasHeight) : canvasHeight;
  const primaryPitch = quantizer.quantizeDiscrete(meanY, canvasHeight);
  const primaryFreq = primaryPitch.frequency;

  // Center frequencies inside Onyx 808 zones: Kick (<260), Snare/Clap (<650), Tom (<2200), Hi-Hat (>=2200)
  let targetFreqs: number[];
  if (primaryFreq < 260) {
    targetFreqs = [3200, 420, 1100, 210];
  } else if (primaryFreq < 650) {
    targetFreqs = [175, 3200, 1100, 520];
  } else if (primaryFreq < 2200) {
    targetFreqs = [175, 3200, 420, 1500];
  } else {
    targetFreqs = [175, 420, 1100, 4200];
  }

  const safeMeanY = Math.max(0, Math.min(effectiveH, meanY));
  const isPoint = !!primaryStroke.isPoint;
  const baseTraversal: TraversalMode =
    primaryStroke.traversal === 'bounce' || (primaryStroke.traversal as string) === 'pingpong'
      ? 'bounce'
      : 'restart';

  const { minX, maxX, spanX } = getPathXBounds(primaryStroke.path);
  const baseStepX = isPoint ? 56 : Math.max(44, Math.min(110, spanX * 0.28));
  const desiredOffsets = [baseStepX, -baseStepX, baseStepX * 1.75, -baseStepX * 1.75];

  const specs: AssistedStrokeSpec[] = [];
  for (let i = 0; i < numCompanions; i++) {
    const targetCenterY = freqToY(targetFreqs[i], quantizer, canvasHeight);
    const dx = computeSafeHorizontalShift(minX, maxX, desiredOffsets[i], canvasWidth);

    const path = mapSplinePath(primaryStroke.path, isPoint, (pt) => ({
      x: pt.x + dx,
      y: targetCenterY + (pt.y - safeMeanY) * 0.35,
    }));

    const initialPhaseRatio = (i + 1) / totalLines;
    const initialDirection: 1 | -1 = i % 2 === 1 && baseTraversal === 'bounce' ? -1 : 1;

    specs.push({
      path,
      style: primaryStroke.style,
      instrumentId: primaryStroke.instrumentId,
      volumeMultiplier: Math.max(0.65, 0.9 - i * 0.06),
      reverbDelta: i * 0.02,
      traversal: baseTraversal,
      isPoint,
      initialPhaseRatio,
      initialDirection,
    });
  }

  return specs;
}

/**
 * Generates diatonically quantized harmonic counterpoint companions (2 to 5 total lines)
 * with staggered playhead phases (1/N, 2/N, ...), shape-preserving X spread, and optional
 * complementary instrument orchestration ('same' vs 'mixed').
 */
export function generateAssistedStrokes(
  primaryStroke: DrawnStroke,
  totalLines: AssistedLineCount,
  quantizer: ScaleQuantizer,
  canvasHeight: number,
  canvasWidth: number = 1200,
  options?: AssistedGenerationOptions
): AssistedStrokeSpec[] {
  const clampedTotal = Math.max(2, Math.min(5, Math.round(totalLines))) as AssistedLineCount;
  const numCompanions = clampedTotal - 1;
  const instrumentMode: AssistedInstrumentMode = options?.instrumentMode ?? 'same';

  if (!primaryStroke.path.segments || primaryStroke.path.segments.length === 0 || numCompanions <= 0) {
    return [];
  }

  const safeHeight = canvasHeight > 0 ? canvasHeight : 800;
  const safeWidth = canvasWidth > 0 ? canvasWidth : 1200;

  if (primaryStroke.instrumentId === 'onyx' && instrumentMode === 'same') {
    return generateOnyxCompanions(primaryStroke, clampedTotal, quantizer, safeHeight, safeWidth);
  }

  const K = quantizer.getConfig().scale.intervals.length || 7;
  const meanDeg = getMeanDegree(primaryStroke.path, quantizer, safeHeight);
  const meanFreq = quantizer.getFrequencyForDegree(Math.round(meanDeg));

  const thirdSteps = Math.max(1, Math.round(K * (2 / 7)));
  const fifthSteps = Math.max(2, Math.round(K * (4 / 7)));
  const sixthSteps = Math.max(3, Math.round(K * (5 / 7)));
  const octaveSteps = K;

  const dir = meanFreq > 1600 ? -1 : 1;
  const isPoint = !!primaryStroke.isPoint;
  const baseTraversal: TraversalMode =
    primaryStroke.traversal === 'bounce' || (primaryStroke.traversal as string) === 'pingpong'
      ? 'bounce'
      : 'restart';
  const altTraversal: TraversalMode = baseTraversal === 'bounce' ? 'restart' : 'bounce';

  const { minX, maxX, spanX } = getPathXBounds(primaryStroke.path);
  const baseStepX = isPoint ? 56 : Math.max(44, Math.min(110, spanX * 0.28));

  const recipes: CounterpointRecipe[] = [
    // Companion 1 (Total 2 lines): Diatonic Fifth parallel harmony
    {
      degOffset: fitDegreeOffsetInRange(meanDeg, dir * fifthSteps, quantizer),
      contourScale: 1.0,
      desiredDx: baseStepX,
      volumeMultiplier: 0.85,
      reverbDelta: 0.04,
      traversal: baseTraversal,
    },
    // Companion 2 (Total 3 lines): Octave or Sub-Octave acoustic anchor
    {
      degOffset: fitDegreeOffsetInRange(meanDeg, (meanFreq >= 260 ? -1 : 1) * octaveSteps, quantizer),
      contourScale: 0.9,
      desiredDx: -baseStepX,
      volumeMultiplier: 0.80,
      reverbDelta: 0.02,
      traversal: baseTraversal,
    },
    // Companion 3 (Total 4 lines): Contrary-motion Diatonic Third
    {
      degOffset: fitDegreeOffsetInRange(meanDeg, dir * thirdSteps, quantizer),
      contourScale: -0.65,
      desiredDx: baseStepX * 1.75,
      volumeMultiplier: 0.74,
      reverbDelta: 0.08,
      traversal: altTraversal,
    },
    // Companion 4 (Total 5 lines): Diatonic Sixth / Tenth celestial shimmer
    {
      degOffset: fitDegreeOffsetInRange(meanDeg, -dir * sixthSteps, quantizer),
      contourScale: 0.75,
      desiredDx: -baseStepX * 1.75,
      volumeMultiplier: 0.68,
      reverbDelta: 0.12,
      traversal: baseTraversal,
    },
  ];

  const specs: AssistedStrokeSpec[] = [];
  for (let i = 0; i < numCompanions; i++) {
    const recipe = recipes[i];
    const safeDx = computeSafeHorizontalShift(minX, maxX, recipe.desiredDx, safeWidth);
    const path = mapSplinePath(primaryStroke.path, isPoint, (pt) => {
      const deg = yToContinuousDegree(pt.y, quantizer, safeHeight);
      const newDeg = meanDeg + (deg - meanDeg) * recipe.contourScale + recipe.degOffset;
      return {
        x: pt.x + safeDx,
        y: continuousDegreeToY(newDeg, quantizer, safeHeight),
      };
    });

    const initialPhaseRatio = (i + 1) / clampedTotal;
    const initialDirection: 1 | -1 = i % 2 === 1 && recipe.traversal === 'bounce' ? -1 : 1;

    specs.push({
      path,
      style: primaryStroke.style,
      instrumentId: resolveCompanionInstrument(primaryStroke.instrumentId, i, instrumentMode),
      volumeMultiplier: recipe.volumeMultiplier,
      reverbDelta: recipe.reverbDelta,
      traversal: recipe.traversal,
      isPoint,
      initialPhaseRatio,
      initialDirection,
    });
  }

  return specs;
}
