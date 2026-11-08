import { describe, expect, it } from "vitest";
import { BADGE_GAP, BADGE_OVERHANG, badgeWidth, layoutBadges, stackWidth, type BadgeNote } from "../src/trackBadges";

const note = (id: string, start: number, text = "1"): BadgeNote => ({ id, start, text });

/** Badge edges of a layout, to check that none overlap */
function edges(notes: BadgeNote[], duration: number, width: number) {
  const byId = new Map(notes.map((n) => [n.id, n]));
  return layoutBadges(notes, duration, width).map((g) => {
    const w = g.ids.length > 1 ? stackWidth(g.ids.length) : badgeWidth(byId.get(g.ids[0])!.text);
    return { left: g.x - w / 2, right: g.x + w / 2, ids: g.ids };
  });
}

describe("layoutBadges", () => {
  it("notes far apart each keep their own badge, centered where they start", () => {
    expect(layoutBadges([note("a", 10), note("b", 50), note("c", 90)], 100, 400)).toEqual([
      { x: 40, ids: ["a"] },
      { x: 200, ids: ["b"] },
      { x: 360, ids: ["c"] },
    ]);
  });

  it("badges that would overlap merge into one stack where the first starts, in time order", () => {
    expect(layoutBadges([note("b", 51), note("a", 50), note("c", 90)], 100, 400)).toEqual([
      { x: 200, ids: ["a", "b"] },
      { x: 360, ids: ["c"] },
    ]);
  });

  it("two badges exactly the gap apart stay separate; a hair closer, they merge", () => {
    const apart = (badgeWidth("1") + BADGE_GAP) / 4;
    expect(layoutBadges([note("a", 10), note("b", 10 + apart)], 100, 400)).toHaveLength(2);
    expect(layoutBadges([note("a", 10), note("b", 10 + apart - 0.01)], 100, 400)).toHaveLength(1);
  });

  it("a stack that grows wider swallows the badge before it once it reaches it", () => {
    // a alone; b, c, d close together a little to the right: the stack of three is wider than one badge and reaches a
    const notes = [note("a", 10), note("b", 16.6), note("c", 16.7), note("d", 16.8)];
    expect(layoutBadges(notes, 100, 400).map((g) => g.ids)).toEqual([["a", "b", "c", "d"]]);
  });

  it("whatever the count and the width, no two badges overlap and every note is in exactly one badge", () => {
    let s = 7;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (const n of [1, 5, 20, 50, 200, 1000]) {
      const notes = Array.from({ length: n }, (_, i) => note(`n${i}`, rnd() * 120, String((i % 120) + 1)));
      for (const width of [60, 300, 700, 1600]) {
        const e = edges(notes, 120, width);
        for (let i = 1; i < e.length; i++) expect(e[i].left).toBeGreaterThanOrEqual(e[i - 1].right + BADGE_GAP - 1e-9);
        if (e.length) expect(e[0].left).toBeGreaterThanOrEqual(-BADGE_OVERHANG - 1e-9);
        if (e.length) expect(e.at(-1)!.right).toBeLessThanOrEqual(width + BADGE_OVERHANG + 1e-9);
        expect(e.flatMap((g) => g.ids).sort()).toEqual(notes.map((x) => x.id).sort());
      }
    }
  });

  it("a badge at either end sticks out past the bar by at most the control bar's margin, so it is never cut off", () => {
    // 20 wide: its center is pulled in to 10 − 8 = 2 from each end
    expect(layoutBadges([note("a", 0), note("b", 100)], 100, 400)).toEqual([
      { x: 2, ids: ["a"] },
      { x: 398, ids: ["b"] },
    ]);
    expect(layoutBadges([note("a", -3), note("b", 500)], 100, 400).map((g) => g.x)).toEqual([2, 398]);
    // A stack at the end is wider, so it is pulled in further
    const stack = layoutBadges([note("a", 99.9), note("b", 100)], 100, 400);
    expect(stack).toEqual([{ x: 400 - stackWidth(2) / 2 + BADGE_OVERHANG, ids: ["a", "b"] }]);
  });

  it("the selected note keeps its own badge where it starts; neighbors that would touch it join the stack beside it", () => {
    // a, b, c close together: without a pin one stack; with b pinned, a stays left of it and c right of it
    const notes = [note("a", 50), note("b", 51), note("c", 52)];
    expect(layoutBadges(notes, 100, 400).map((g) => g.ids)).toEqual([["a", "b", "c"]]);
    const pinned = layoutBadges(notes, 100, 400, "b");
    expect(pinned.find((g) => g.ids.includes("b"))).toEqual({ x: 204, ids: ["b"] });
    expect(pinned.map((g) => g.ids)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("with a pinned note anywhere, still no overlaps, nothing off the bar, every note once", () => {
    let s = 11;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (const n of [2, 20, 200]) {
      const notes = Array.from({ length: n }, (_, i) => note(`n${i}`, rnd() * 120, String((i % 40) + 1)));
      notes.push(note("first", 0, "7"), note("last", 120, "8"));
      for (const width of [300, 700]) {
        for (const pin of ["first", "last", "n0", `n${n - 1}`]) {
          const byId = new Map(notes.map((x) => [x.id, x]));
          const e = layoutBadges(notes, 120, width, pin).map((g) => {
            const w = g.ids.length > 1 ? stackWidth(g.ids.length) : badgeWidth(byId.get(g.ids[0])!.text);
            return { left: g.x - w / 2, right: g.x + w / 2, ids: g.ids };
          });
          for (let i = 1; i < e.length; i++) expect(e[i].left).toBeGreaterThanOrEqual(e[i - 1].right + BADGE_GAP - 1e-9);
          expect(e[0].left).toBeGreaterThanOrEqual(-BADGE_OVERHANG - 1e-9);
          expect(e.at(-1)!.right).toBeLessThanOrEqual(width + BADGE_OVERHANG + 1e-9);
          expect(e.find((g) => g.ids.includes(pin))!.ids).toEqual([pin]);
          expect(e.flatMap((g) => g.ids).sort()).toEqual(notes.map((x) => x.id).sort());
        }
      }
    }
  });

  it("no duration or no width yet: nothing to lay out", () => {
    expect(layoutBadges([note("a", 1)], 0, 400)).toEqual([]);
    expect(layoutBadges([note("a", 1)], 100, 0)).toEqual([]);
  });
});
