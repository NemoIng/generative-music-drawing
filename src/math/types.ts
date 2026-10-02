export interface Point2D {
  x: number;
  y: number;
}

export interface CubicBezierSegment {
  p0: Point2D;
  p1: Point2D;
  p2: Point2D;
  p3: Point2D;
}

export interface SplinePath {
  segments: CubicBezierSegment[];
  isClosed: boolean;
}

export interface ArcLengthLUT {
  totalLength: number;
  isClosed: boolean;
  /** Cumulative s values corresponding to each sample */
  sValues: Float64Array;
  /** Segment index k for each sample */
  segmentIndices: Int32Array;
  /** Parameter t for each sample within segment k */
  tValues: Float64Array;
  /** Arc length of each individual segment */
  segmentLengths: Float64Array;
  /** Cumulative s where each segment starts */
  segmentStartS: Float64Array;
  /** Number of sub-intervals per segment */
  subdivisions: number;
}

export interface CurveEvaluation {
  point: Point2D;
  tangent: Point2D;
  speed: number;
  curvature: number;
  segmentIndex: number;
  t: number;
  s: number;
}
