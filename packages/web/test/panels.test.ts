import { describe, expect, it } from "vitest";
import { fitWidths, STAGE_MIN } from "../src/Panels";

// How wide each side panel actually gets (with both dragged to their widest they can exceed the window's minimum width, which would squeeze
// the canvas to zero width)

const open = (left: number, right: number) => ({ left: { width: left, collapsed: false }, right: { width: right, collapsed: false } });

describe("fitWidths", () => {
  it("fits: the saved widths are used", () => {
    expect(fitWidths(open(260, 320), 1400)).toEqual({ left: 260, right: 320 });
  });

  it("does not fit: both sides shrink in proportion to how much they exceed their minimum width, leaving STAGE_MIN for the canvas", () => {
    const w = fitWidths(open(520, 640), 960);
    expect(w.left + w.right + STAGE_MIN).toBeCloseTo(960);
    expect(w.left).toBeGreaterThanOrEqual(180);
    expect(w.right).toBeGreaterThanOrEqual(240);
  });

  it("a collapsed side takes no width and does not take part in shrinking", () => {
    const w = fitWidths({ left: { width: 520, collapsed: true }, right: { width: 640, collapsed: false } }, 900);
    expect(w).toEqual({ left: 0, right: 900 - STAGE_MIN });
  });

  it("both at their minimum width and still not fitting: they stay at the minimum", () => {
    expect(fitWidths(open(180, 240), 500)).toEqual({ left: 180, right: 240 });
  });

  it("the window width is not measured yet (0): the saved widths are used", () => {
    expect(fitWidths(open(520, 640), 0)).toEqual({ left: 520, right: 640 });
  });
});
