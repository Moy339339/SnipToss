import { describe, expect, it } from "vitest";
import {
  clipPolyline,
  clipRect,
  clipSegment,
  decimalsFor,
  parseMaterialFile,
  pathFromRuns,
  pathRuns,
  roundShape,
  SCHEMA,
  shapeHit,
  type Pt,
} from "../src/index.js";

const near = (a: Pt[], b: Pt[]) => {
  expect(a.length).toBe(b.length);
  a.forEach((p, i) => {
    expect(p[0]).toBeCloseTo(b[i][0], 9);
    expect(p[1]).toBeCloseTo(b[i][1], 9);
  });
};

describe("clipSegment", () => {
  it("a segment entirely inside the frame is returned unchanged", () => {
    near(clipSegment([0.2, 0.2], [0.8, 0.5])!, [
      [0.2, 0.2],
      [0.8, 0.5],
    ]);
  });
  it("entering from outside: the start moves onto the edge and the end stays", () => {
    near(clipSegment([-0.5, 0.5], [0.5, 0.5])!, [
      [0, 0.5],
      [0.5, 0.5],
    ]);
  });
  it("crossing the whole frame: both ends are clipped to the edges", () => {
    near(clipSegment([-1, -1], [2, 2])!, [
      [0, 0],
      [1, 1],
    ]);
  });
  it("a segment entirely outside (including one running parallel along an edge) returns undefined", () => {
    expect(clipSegment([-0.5, 0.2], [-0.1, 0.8])).toBeUndefined();
    expect(clipSegment([1.2, 0], [1.2, 1])).toBeUndefined();
    expect(clipSegment([-0.5, 1.5], [0.4, 2])).toBeUndefined();
  });
});

describe("clipPolyline", () => {
  it("a stroke starting outside the frame keeps only the part inside, with no line dragged along the edge", () => {
    const runs = clipPolyline([
      [-0.3, 0.2],
      [-0.2, 0.6],
      [0.1, 0.5],
      [0.3, 0.4],
    ]);
    expect(runs.length).toBe(1);
    // The entry point is on the left edge, followed by the original points
    expect(runs[0][0][0]).toBeCloseTo(0, 9);
    near(runs[0].slice(1), [
      [0.1, 0.5],
      [0.3, 0.4],
    ]);
  });
  it("leaving and coming back: split into two runs that are not connected", () => {
    const runs = clipPolyline([
      [0.3, 0.5],
      [0.1, 0.5],
      [-0.2, 0.5],
      [-0.2, 0.7],
      [0.2, 0.7],
    ]);
    expect(runs.length).toBe(2);
    near(runs[0], [
      [0.3, 0.5],
      [0.1, 0.5],
      [0, 0.5],
    ]);
    near(runs[1], [
      [0, 0.7],
      [0.2, 0.7],
    ]);
  });
  it("entirely outside: nothing is kept", () => {
    expect(
      clipPolyline([
        [-0.5, -0.5],
        [-0.2, -0.1],
        [1.5, -0.3],
      ]),
    ).toEqual([]);
  });
  it("entirely inside the frame: one whole run", () => {
    near(
      clipPolyline([
        [0.1, 0.1],
        [0.2, 0.3],
        [0.4, 0.2],
      ])[0],
      [
        [0.1, 0.1],
        [0.2, 0.3],
        [0.4, 0.2],
      ],
    );
  });
});

describe("clipRect", () => {
  it("is intersected with the frame", () => {
    const r = clipRect([-0.2, 0.3], [0.4, 1.4])!;
    expect([r.x, r.y, r.w, r.h].map((v) => +v.toFixed(9))).toEqual([0, 0.3, 0.4, 0.7]);
  });
  it("entirely outside returns undefined", () => {
    expect(clipRect([-0.5, 0.2], [-0.1, 0.6])).toBeUndefined();
  });
});

describe("freehand runs", () => {
  it("pathFromRuns / pathRuns round-trip; a single run gets no breaks", () => {
    const runs: Pt[][] = [
      [
        [0, 0.5],
        [0.2, 0.5],
      ],
      [
        [0, 0.7],
        [0.2, 0.7],
        [0.3, 0.8],
      ],
    ];
    const s = pathFromRuns(runs);
    expect(s.breaks).toEqual([2]);
    expect(pathRuns(s)).toEqual(runs);
    expect(pathFromRuns([runs[0]]).breaks).toBeUndefined();
  });
});

describe("versions", () => {
  it.each(["pizhu/3", "sniptoss/4", "sniptoss/5"])("%s files are read and treated as the current version (sniptoss/5)", (schema) => {
    const f = parseMaterialFile(JSON.stringify({ schema, material: { path: "a.png", kind: "image", sha256: "x" }, annotations: [] }));
    expect(f.schema).toBe("sniptoss/5");
  });

  it("pizhu/1 files are read and treated as the current version", () => {
    const f = parseMaterialFile(
      JSON.stringify({ schema: "pizhu/1", material: { path: "a.png", kind: "image", sha256: "x" }, annotations: [] }),
    );
    expect(f.schema).toBe(SCHEMA);
  });
  it("an unknown version is an error", () => {
    expect(() => parseMaterialFile(JSON.stringify({ schema: "pizhu/9", material: {}, annotations: [] }))).toThrow(/pizhu\/9/);
  });
});

describe("roundShape: the stored decimals are enough to restore whole pixels", () => {
  it("4 decimals for sides under 10,000 px, one more for every extra digit", () => {
    expect(decimalsFor(1920)).toBe(4);
    expect(decimalsFor(9999)).toBe(4);
    expect(decimalsFor(10000)).toBe(5);
    expect(decimalsFor(123456)).toBe(6);
  });
  it.each([640, 1920, 9999, 10000, 16384, 43210, 120000])(
    "side %i: each whole pixel, stored and multiplied back, is itself again",
    (side) => {
      for (let px = 0; px <= side; px += Math.max(1, Math.floor(side / 997))) {
        const s = roundShape({ type: "point", x: px / side, y: px / side }, side, side);
        if (s.type !== "point") throw new Error("type");
        expect(Math.round(s.x * side)).toBe(px);
      }
    },
  );
  it("x follows the width and y the height: a wide panorama keeps more decimals for x and still 4 for y", () => {
    // 4 decimals would be 0.4116, which multiplies back to 12348, off by 1 pixel
    const s = roundShape({ type: "rect", x: 12347 / 30000, y: 0.123456789, w: 0.5, h: 0.25 }, 30000, 2000);
    expect(s).toEqual({ type: "rect", x: 0.41157, y: 0.1235, w: 0.5, h: 0.25 });
  });
});

describe("shapeHit: decides by screen distance whether a mark was hit", () => {
  // The frame is 1000 × 500 pixels on screen, and within 7 pixels counts as a hit
  const hit = (s: Parameters<typeof shapeHit>[0], x: number, y: number, filled = false) =>
    shapeHit(s, [x / 1000, y / 500], 1000, 500, 7, filled);
  const rect = { type: "rect", x: 0.1, y: 0.2, w: 0.4, h: 0.4 } as const; // on screen 100,100 – 500,300

  it("rectangle: within 7 pixels of either side of an edge counts, the inside does not; with filled the inside counts too", () => {
    expect(hit(rect, 300, 100)).toBe(true);
    expect(hit(rect, 300, 107)).toBe(true);
    expect(hit(rect, 300, 108)).toBe(false);
    expect(hit(rect, 93, 200)).toBe(true);
    expect(hit(rect, 503, 296)).toBe(true);
    expect(hit(rect, 300, 200)).toBe(false);
    expect(hit(rect, 300, 200, true)).toBe(true);
    expect(hit(rect, 600, 200, true)).toBe(false);
  });

  it("an arrow counts only along its segment, not beyond its ends", () => {
    const arrow = { type: "arrow", from: [0.1, 0.2], to: [0.5, 0.2] } as const; // 100,100 → 500,100
    expect(hit(arrow, 300, 105)).toBe(true);
    expect(hit(arrow, 505, 100)).toBe(true);
    expect(hit(arrow, 510, 100)).toBe(false);
  });

  it("freehand: the gap between two separate runs does not count", () => {
    const path = {
      type: "path",
      points: [
        [0.1, 0.2],
        [0.2, 0.2],
        [0.4, 0.2],
        [0.5, 0.2],
      ],
      breaks: [2],
    } as const;
    expect(hit(path, 150, 103)).toBe(true);
    expect(hit(path, 450, 97)).toBe(true);
    expect(hit(path, 300, 100)).toBe(false);
    expect(hit({ type: "path", points: [[0.3, 0.3]] }, 302, 151)).toBe(true);
  });

  it("points are not handled here (they are drawn as buttons)", () => {
    expect(hit({ type: "point", x: 0.3, y: 0.2 }, 300, 100)).toBe(false);
  });
});
