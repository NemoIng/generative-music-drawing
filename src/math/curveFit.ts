import { Point2D, CubicBezierSegment, SplinePath } from './types';

/**
 * Simplifies a sequence of points by enforcing a minimum distance between successive points.
 */
export function decimatePoints(points: Point2D[], minDistance: number = 8): Point2D[] {
  if (points.length < 2) return [...points];

  const filtered: Point2D[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = filtered[filtered.length - 1];
    const curr = points[i];
    const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    if (dist >= minDistance) {
      filtered.push(curr);
    }
  }

  // Ensure last point is included if it wasn't
  const last = points[points.length - 1];
  const lastFiltered = filtered[filtered.length - 1];
  if (Math.hypot(last.x - lastFiltered.x, last.y - lastFiltered.y) > 2) {
    filtered.push(last);
  }

  return filtered;
}

/**
 * Applies Laplacian moving-average smoothing to an array of points,
 * preserving endpoints to prevent curve shrinkage or endpoint displacement.
 *
 * @param points Array of 2D points to smooth
 * @param iterations Number of smoothing passes (default 4)
 * @param weight Center weight vs neighbor weight (0.0 to 1.0, default 0.40)
 */
export function smoothPoints(points: Point2D[], iterations: number = 4, weight: number = 0.40): Point2D[] {
  if (points.length < 3) return points.map((p) => ({ ...p }));

  let pts = points.map((p) => ({ ...p }));
  const neighborWeight = (1 - weight) / 2;

  for (let iter = 0; iter < iterations; iter++) {
    const smoothed: Point2D[] = [{ ...pts[0] }];
    for (let i = 1; i < pts.length - 1; i++) {
      smoothed.push({
        x: pts[i].x * weight + (pts[i - 1].x + pts[i + 1].x) * neighborWeight,
        y: pts[i].y * weight + (pts[i - 1].y + pts[i + 1].y) * neighborWeight,
      });
    }
    smoothed.push({ ...pts[pts.length - 1] });
    pts = smoothed;
  }

  return pts;
}

/**
 * Converts a sequence of points into smooth cubic Bezier segments using Catmull-Rom
 * to Bezier conversion (with tension = 1/6 for smooth C1 continuity).
 *
 * @param rawPoints Array of sampled 2D points from user input
 * @param closeThreshold Max distance between start and end point to automatically close the loop
 * @param smooth Whether to apply automatic smoothing to eliminate hand tremor jitter
 */
export function fitSplineFromPoints(
  rawPoints: Point2D[],
  closeThreshold: number = 40,
  smooth: boolean = false
): SplinePath | null {
  let pointsToFit = rawPoints;
  if (smooth && rawPoints.length >= 3) {
    // 1. Initial decimation to normalize spatial point density (6px spacing)
    const normalized = decimatePoints(rawPoints, 6);

    // 2. Balanced 4-pass Laplacian smoothing: eliminates hand tremors without flattening subtle curves
    const smoothed = smoothPoints(normalized, 4, 0.40);

    // 3. Decimate to clean spline control point intervals (15px spacing)
    let totalDist = 0;
    for (let i = 1; i < smoothed.length; i++) {
      totalDist += Math.hypot(smoothed[i].x - smoothed[i - 1].x, smoothed[i].y - smoothed[i - 1].y);
    }
    const decimateDist = Math.min(15, Math.max(8, Math.floor(totalDist / 8)));
    const decimated = decimatePoints(smoothed, decimateDist);

    // 4. Gentle single relaxation pass to ensure flowing, kink-free Catmull-Rom tangents
    pointsToFit = smoothPoints(decimated, 1, 0.44);
  } else {
    pointsToFit = decimatePoints(rawPoints, 10);
  }
  const points = pointsToFit;
  if (points.length < 2) return null;

  // Determine if path forms a closed loop
  const pStart = points[0];
  const pEnd = points[points.length - 1];
  const endDist = Math.hypot(pEnd.x - pStart.x, pEnd.y - pStart.y);
  const isClosed = points.length >= 3 && endDist <= closeThreshold;

  const segments: CubicBezierSegment[] = [];
  const n = points.length;
  const tension = 1 / 6;

  if (isClosed) {
    // Snap end point to start point to make perfectly closed loop
    points[n - 1] = { x: pStart.x, y: pStart.y };

    for (let i = 0; i < n - 1; i++) {
      const p0 = points[(i - 1 + (n - 1)) % (n - 1)];
      const p1 = points[i];
      const p2 = points[(i + 1) % (n - 1)];
      const p3 = points[(i + 2) % (n - 1)];

      const cp1: Point2D = {
        x: p1.x + (p2.x - p0.x) * tension,
        y: p1.y + (p2.y - p0.y) * tension,
      };

      const cp2: Point2D = {
        x: p2.x - (p3.x - p1.x) * tension,
        y: p2.y - (p3.y - p1.y) * tension,
      };

      segments.push({
        p0: { ...p1 },
        p1: cp1,
        p2: cp2,
        p3: { ...p2 },
      });
    }
  } else {
    // Open path: duplicate endpoints for boundary tangents
    for (let i = 0; i < n - 1; i++) {
      const p0 = i === 0 ? points[0] : points[i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = i + 2 < n ? points[i + 2] : points[n - 1];

      const cp1: Point2D = {
        x: p1.x + (p2.x - p0.x) * tension,
        y: p1.y + (p2.y - p0.y) * tension,
      };

      const cp2: Point2D = {
        x: p2.x - (p3.x - p1.x) * tension,
        y: p2.y - (p3.y - p1.y) * tension,
      };

      segments.push({
        p0: { ...p1 },
        p1: cp1,
        p2: cp2,
        p3: { ...p2 },
      });
    }
  }

  return { segments, isClosed };
}
