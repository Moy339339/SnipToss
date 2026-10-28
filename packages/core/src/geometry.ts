// Mark geometry: clips away the part drawn outside the frame (a stroke may start outside, but only the part inside is kept); freehand paths
// are split into runs by breaks.
// Coordinates are all normalized; the frame is [0,1]×[0,1].

import type { Shape } from "./types.js";

export type Pt = [number, number];

/** The runs of a freehand path (split at breaks; without breaks it is a single run) */
export function pathRuns(s: Extract<Shape, { type: "path" }>): Pt[][] {
  const cuts = [0, ...(s.breaks ?? []).filter((i) => i > 0 && i < s.points.length), s.points.length];
  const runs: Pt[][] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const run = s.points.slice(cuts[i], cuts[i + 1]);
    if (run.length > 0) runs.push(run);
  }
  return runs;
}

/** Joins several runs into one freehand shape; a single run gets no breaks */
export function pathFromRuns(runs: Pt[][]): Extract<Shape, { type: "path" }> {
  const points: Pt[] = [];
  const breaks: number[] = [];
  for (const run of runs) {
    if (points.length > 0) breaks.push(points.length);
    points.push(...run);
  }
  return breaks.length ? { type: "path", points, breaks } : { type: "path", points };
}

/**
 * Clips a segment to the frame (Liang–Barsky). Returns undefined if the whole segment is outside.
 * Of the two returned endpoints, one that was already inside the frame is returned unchanged
 */
export function clipSegment(a: Pt, b: Pt): [Pt, Pt] | undefined {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  // The left, right, top and bottom edges in turn: p·t <= q
  const p = [-dx, dx, -dy, dy];
  const q = [a[0], 1 - a[0], a[1], 1 - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return undefined; // parallel to this edge and outside it
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return undefined;
  }
  const at = (t: number): Pt => [a[0] + dx * t, a[1] + dy * t];
  return [t0 === 0 ? a : at(t0), t1 === 1 ? b : at(t1)];
}

/** Clips a polyline to the frame: the part outside is dropped, and leaving then re-entering starts a new run */
export function clipPolyline(points: Pt[]): Pt[][] {
  const inside = (p: Pt) => p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1;
  const runs: Pt[][] = [];
  let run: Pt[] | undefined;
  if (points.length === 1 && inside(points[0])) return [[points[0]]];
  for (let i = 0; i + 1 < points.length; i++) {
    const seg = clipSegment(points[i], points[i + 1]);
    if (!seg) {
      run = undefined;
      continue;
    }
    const [s, e] = seg;
    if (!run || s !== points[i]) {
      // Entered from outside (or the previous segment already left): start a new run
      run = [s];
      runs.push(run);
    }
    run.push(e);
    if (e !== points[i + 1]) run = undefined; // this segment left the frame
  }
  return runs;
}

/** The rectangle spanned by two corner points, intersected with the frame. Returns undefined if nothing is left (or only a line) */
export function clipRect(a: Pt, b: Pt): Extract<Shape, { type: "rect" }> | undefined {
  const l = Math.max(0, Math.min(a[0], b[0]));
  const t = Math.max(0, Math.min(a[1], b[1]));
  const r = Math.min(1, Math.max(a[0], b[0]));
  const bt = Math.min(1, Math.max(a[1], b[1]));
  if (r <= l || bt <= t) return undefined;
  return { type: "rect", x: l, y: t, w: r - l, h: bt - t };
}

/**
 * Whether the point p (normalized coordinates) hits the mark: w and h are the frame's current size in screen pixels, and slop is how many pixels
 * from the line still count. Distances are measured on screen, so the mark is equally easy to hit at any zoom. A rectangle only counts by its edges,
 * or its inside too when filled (a selected rectangle can be dragged by its whole body);
 * points (pins) are drawn as buttons and are not handled here
 */
export function shapeHit(s: Shape, p: Pt, w: number, h: number, slop: number, filled = false): boolean {
  const near = (a: Pt, b: Pt) => segmentDist([p[0] * w, p[1] * h], [a[0] * w, a[1] * h], [b[0] * w, b[1] * h]) <= slop;
  switch (s.type) {
    case "rect": {
      const [l, t, r, b] = [s.x, s.y, s.x + s.w, s.y + s.h];
      if (filled && p[0] >= l && p[0] <= r && p[1] >= t && p[1] <= b) return true;
      return near([l, t], [r, t]) || near([r, t], [r, b]) || near([r, b], [l, b]) || near([l, b], [l, t]);
    }
    case "arrow":
      return near(s.from, s.to);
    case "path":
      return pathRuns(s).some((run) => run.some((q, i) => near(q, run[Math.min(i + 1, run.length - 1)])));
    default:
      return false;
  }
}

/** Distance from a point to a segment (all in the same pixel coordinates) */
function segmentDist(p: Pt, a: Pt, b: Pt): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

/**
 * How many decimals to store: enough that multiplying back by the side length and rounding gives the original whole pixel (error under 0.5 px).
 * 4 for sides under 10,000 px (keeps the JSON clean), plus one decimal for every extra digit; a fixed 4 would be off by 1 px for panoramas
 * and ultra-wide video
 */
export const decimalsFor = (side: number) => Math.max(4, String(Math.round(Math.abs(side))).length);

/** Rounds the decimals before saving: w and h are the item's pixel width and height. The mark's own color is kept */
export function roundShape(s: Shape, w: number, h: number): Shape {
  const kx = 10 ** decimalsFor(w);
  const ky = 10 ** decimalsFor(h);
  const rx = (v: number) => Math.round(v * kx) / kx;
  const ry = (v: number) => Math.round(v * ky) / ky;
  switch (s.type) {
    case "rect":
      return keepColor(s, { type: "rect", x: rx(s.x), y: ry(s.y), w: rx(s.w), h: ry(s.h) });
    case "point":
      return keepColor(s, { type: "point", x: rx(s.x), y: ry(s.y) });
    case "arrow":
      return keepColor(s, { type: "arrow", from: [rx(s.from[0]), ry(s.from[1])], to: [rx(s.to[0]), ry(s.to[1])] });
    case "path": {
      const points = s.points.map(([x, y]): Pt => [rx(x), ry(y)]);
      return keepColor(s, s.breaks?.length ? { type: "path", points, breaks: s.breaks } : { type: "path", points });
    }
    default:
      return s;
  }
}

/** Carries from's own color over to to (a shape derived from from by moving, rounding or dragging a handle) */
export const keepColor = (from: Shape, to: Shape): Shape => (from.color === undefined ? to : { ...to, color: from.color });
