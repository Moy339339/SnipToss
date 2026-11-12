import { describe, expect, it } from "vitest";
import { placeBadges, type BadgeRequest } from "../src/handoffBadges";

// Copy as Images: number circles never cover each other (handoffBadges.ts)

const R = 20;
const FRAME = { w: 1600, h: 1000 };
const at = (x: number, y: number): BadgeRequest => ({ anchor: { x, y }, prefer: { x, y }, guard: 0 });
const pin = (x: number, y: number, guard = 7): BadgeRequest => ({ anchor: { x, y }, prefer: { x, y: y - R - guard - 1 }, guard });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** A small deterministic generator, so a failure can be reproduced */
function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

describe("placeBadges", () => {
  it("leaves a number on its mark when nothing is in the way", () => {
    const spots = placeBadges([at(400, 300), pin(900, 500)], R, FRAME);
    expect(spots[0]).toEqual({ x: 400, y: 300 });
    expect(spots[1]).toEqual({ x: 900, y: 500 - R - 8 });
    expect(spots.every((s) => !s.tail)).toBe(true);
  });

  it("keeps a number inside the frame when its mark is in a corner", () => {
    const [spot] = placeBadges([at(0, 0)], R, FRAME);
    expect(spot.x).toBeGreaterThanOrEqual(R);
    expect(spot.y).toBeGreaterThanOrEqual(R);
    expect(spot.tail).toBeUndefined();
  });

  it("moves the second of two numbers on the same spot aside and ties it back with a line", () => {
    const [a, b] = placeBadges([at(500, 500), at(500, 500)], R, FRAME);
    expect(a).toEqual({ x: 500, y: 500 });
    expect(dist(a, b)).toBeGreaterThanOrEqual(R * 2);
    expect(dist(a, b)).toBeLessThan(R * 4);
    expect(b.tail).toEqual({ x: 500, y: 500 });
  });

  it("never covers another note's pin", () => {
    // A rectangle whose corner is right on a pin
    const requests = [pin(600, 400), at(604, 398)];
    const spots = placeBadges(requests, R, FRAME);
    expect(dist(spots[1], requests[0].anchor)).toBeGreaterThanOrEqual(R + requests[0].guard);
    expect(dist(spots[0], spots[1])).toBeGreaterThanOrEqual(R * 2);
  });

  it("stays off the time label", () => {
    const label = { x: 10, y: 950, w: 160, h: 40 };
    const [spot] = placeBadges([at(60, 960)], R, FRAME, [label]);
    const dx = Math.max(label.x - spot.x, 0, spot.x - label.x - label.w);
    const dy = Math.max(label.y - spot.y, 0, spot.y - label.y - label.h);
    expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(R);
  });

  it("keeps every number apart and inside the frame for crowded layouts", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const next = random(seed);
      // 20 marks, most of them in three tight clusters
      const centers = [0, 1, 2].map(() => ({ x: 100 + next() * 1400, y: 100 + next() * 800 }));
      const requests = Array.from({ length: 20 }, (_, i) => {
        const c = centers[i % 4];
        const x = c ? c.x + (next() - 0.5) * 90 : next() * FRAME.w;
        const y = c ? c.y + (next() - 0.5) * 90 : next() * FRAME.h;
        return i % 2 ? pin(x, y) : at(x, y);
      });
      const spots = placeBadges(requests, R, FRAME);
      for (let i = 0; i < spots.length; i++) {
        expect(spots[i].x, `seed ${seed}`).toBeGreaterThanOrEqual(R);
        expect(spots[i].x, `seed ${seed}`).toBeLessThanOrEqual(FRAME.w - R);
        expect(spots[i].y, `seed ${seed}`).toBeGreaterThanOrEqual(R);
        expect(spots[i].y, `seed ${seed}`).toBeLessThanOrEqual(FRAME.h - R);
        for (let j = 0; j < i; j++) expect(dist(spots[i], spots[j]), `seed ${seed}: ${j} and ${i}`).toBeGreaterThanOrEqual(R * 2);
        for (const o of requests)
          if (o.guard > 0) expect(dist(spots[i], o.anchor), `seed ${seed}: pin under ${i}`).toBeGreaterThanOrEqual(R + o.guard - 0.01);
      }
    }
  });
});
