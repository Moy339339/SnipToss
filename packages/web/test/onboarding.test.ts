import { describe, expect, it } from "vitest";
import { placeNear, TOUR_STEPS } from "../src/onboarding";

// The tour's explanation cards and hints are placed beside their target (docs/design-rules.md: next to the thing they explain, never covering it)
const AREA = { left: 8, top: 8, right: 1272, bottom: 792 };
const SIZE = { w: 340, h: 160 };
const ORDER = ["below", "above", "left", "right"] as const;

describe("placeNear", () => {
  it("below if it fits, centered horizontally on the target", () => {
    // The toolbar is in the middle of the canvas column
    const tools = { left: 500, top: 40, right: 780, bottom: 72 };
    expect(placeNear(tools, SIZE, AREA, 12, [...ORDER])).toEqual({ x: 470, y: 84, side: "below" });
  });

  it("a target against the right edge of the window: horizontally pulled inside the window, not out of bounds", () => {
    const capture = { left: 1150, top: 2, right: 1260, bottom: 30 };
    const p = placeNear(capture, SIZE, AREA, 12, [...ORDER]);
    expect(p.side).toBe("below");
    expect(p.x + SIZE.w).toBe(AREA.right);
    expect(p.y).toBe(42);
  });

  it("neither above nor below fits (a full-height column like the notes panel): goes on the left, centered vertically on the target", () => {
    const panel = { left: 950, top: 34, right: 1280, bottom: 800 };
    const p = placeNear(panel, SIZE, AREA, 12, [...ORDER]);
    expect(p).toEqual({ x: 950 - 12 - 340, y: Math.round((34 + 800) / 2 - 80), side: "left" });
  });

  it("sides are tried in the order given: the hint goes above the copy button", () => {
    const dock = { left: 1040, top: 720, right: 1260, bottom: 748 };
    const p = placeNear(dock, { w: 300, h: 90 }, AREA, 8, ["above", "below"]);
    expect(p).toEqual({ x: 1272 - 300, y: 720 - 8 - 90, side: "above" });
  });

  it("no side fits: uses the first side and pulls it fully inside the window", () => {
    const huge = { left: 0, top: 0, right: 1280, bottom: 800 };
    const p = placeNear(huge, SIZE, AREA, 12, [...ORDER]);
    expect(p.side).toBe("below");
    expect(p.x).toBeGreaterThanOrEqual(AREA.left);
    expect(p.y + SIZE.h).toBe(AREA.bottom);
  });

  it("the position is rounded (never on a half pixel)", () => {
    const p = placeNear({ left: 100.3, top: 40.6, right: 201.1, bottom: 72.2 }, { w: 101, h: 50 }, AREA, 12, ["below"]);
    expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
  });
});

describe("tour", () => {
  it("only 3 steps (the tour stays short): drawing tools → notes panel → Screen Capture", () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(["tools", "panel", "capture"]);
  });
});
