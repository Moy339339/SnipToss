// Copy as Images: where the number circles go on a frame that carries several notes (pure geometry, pixels of the drawn frame).
// Numbers that cover each other, or sit right next to another note's pin, are what an AI misreads; so no two circles may touch, and no
// circle may cover a pin. A circle that cannot stay at its mark moves the shortest way out and is tied back to the mark with a line.

export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BadgeRequest {
  /** The spot on the mark the number belongs to (a rectangle's corner, an arrow's tail, the pinned point) */
  anchor: Pt;
  /** Where the circle's center would go with nothing in the way */
  prefer: Pt;
  /** Radius around the anchor no circle may cover (a pin's dot); 0 = the circle may sit on it */
  guard: number;
}

export interface BadgeSpot extends Pt {
  /** Set when the circle ended up away from its mark: draw a line from the circle to here */
  tail?: Pt;
}

/** Directions tried on each ring, nearest to "up and to the left" first (the corner a number normally sits on) */
const ANGLES = [-135, -90, 180, -45, 0, 135, 90, 45, -112.5, -157.5, -67.5, 157.5, -22.5, 112.5, 22.5, 67.5].map(
  (d) => (d * Math.PI) / 180,
);

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance from a point to a box (0 inside) */
const toBox = (p: Pt, b: Box) => Math.hypot(Math.max(b.x - p.x, 0, p.x - b.x - b.w), Math.max(b.y - p.y, 0, p.y - b.y - b.h));

/**
 * Centers for circles of radius r, one per request and in the same order. Each takes the free spot nearest to its preferred one: inside
 * the frame, at least gap away from every circle placed before it, off the keepOut boxes (the time label) and off every guarded anchor.
 * With no free spot within reach (a frame packed solid) it stays at its preferred spot, clamped into the frame
 */
export function placeBadges(
  requests: readonly BadgeRequest[],
  r: number,
  frame: { w: number; h: number },
  keepOut: readonly Box[] = [],
  gap = Math.max(2, r * 0.15),
): BadgeSpot[] {
  const edge = r + 2;
  const inside = (p: Pt): Pt => ({
    x: Math.min(Math.max(p.x, edge), Math.max(edge, frame.w - edge)),
    y: Math.min(Math.max(p.y, edge), Math.max(edge, frame.h - edge)),
  });
  const placed: Pt[] = [];
  const free = (p: Pt) =>
    p.x >= edge - 0.5 &&
    p.y >= edge - 0.5 &&
    p.x <= frame.w - edge + 0.5 &&
    p.y <= frame.h - edge + 0.5 &&
    placed.every((q) => dist(p, q) >= r * 2 + gap) &&
    keepOut.every((b) => toBox(p, b) >= r + gap) &&
    requests.every((o) => o.guard <= 0 || dist(p, o.anchor) >= r + o.guard);
  return requests.map((req) => {
    const want = inside(req.prefer);
    let spot = free(want) ? want : undefined;
    const step = r * 0.5;
    for (let ring = 1; !spot && ring <= 28; ring++)
      for (const a of ANGLES) {
        const p = { x: want.x + Math.cos(a) * step * ring, y: want.y + Math.sin(a) * step * ring };
        if (free(p)) {
          spot = p;
          break;
        }
      }
    spot ??= want;
    placed.push(spot);
    // The mark's own spot lies outside the circle: without a line nobody could tell which mark the number belongs to
    // (a circle that was only pushed in from the frame's edge still sits on its mark)
    return dist(spot, inside(req.anchor)) > r + req.guard + gap + 1 ? { ...spot, tail: req.anchor } : spot;
  });
}
