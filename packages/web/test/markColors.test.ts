import { describe, expect, it } from "vitest";
import type { Shape } from "@sniptoss/core";
import { noteColorOf, normalizePlaceColors, placeColorOf, recolorPlace } from "../src/markColors";

// Changing the color of one place of a note with several places (Beta 80, docs/annotation-format.md, the color of each place): what is
// saved is decided by normalizePlaceColors

const ORANGE = "#ff6a3d"; // the mark color in Settings (the default)
const YELLOW = "#ffc233";
const BLUE = "#5b8cff";
const p = (x: number, color?: string): Shape => ({ type: "point", x, y: 0.5, ...(color ? { color } : {}) });

describe("recolorPlace: changing the color of the nth place", () => {
  it("the places now differ in color: every place records a color (an unchanged one records what it was drawn in), the whole note records the first place's (nothing if that is the Settings color)", () => {
    expect(recolorPlace([p(0.1), p(0.5), p(0.9)], undefined, 1, YELLOW, ORANGE)).toEqual({
      shapes: [p(0.1, ORANGE), p(0.5, YELLOW), p(0.9, ORANGE)],
      color: undefined,
    });
    // The whole note was blue: the unchanged places record blue, and the whole note stays blue
    expect(recolorPlace([p(0.1), p(0.5)], BLUE, 1, YELLOW, ORANGE)).toEqual({ shapes: [p(0.1, BLUE), p(0.5, YELLOW)], color: BLUE });
  });

  it("after changing, the places are the same again: each place's color is dropped and the whole note records that color; if it is exactly the Settings color, the whole note records nothing either", () => {
    expect(recolorPlace([p(0.1, ORANGE), p(0.5, YELLOW)], undefined, 1, undefined, ORANGE)).toEqual({
      shapes: [p(0.1), p(0.5)],
      color: undefined,
    });
    expect(recolorPlace([p(0.1, YELLOW), p(0.5, ORANGE)], undefined, 1, YELLOW, ORANGE)).toEqual({
      shapes: [p(0.1), p(0.5)],
      color: YELLOW,
    });
  });

  it("a single place: it is the whole note's color", () => {
    expect(recolorPlace([p(0.1)], undefined, 0, YELLOW, ORANGE)).toEqual({ shapes: [p(0.1)], color: YELLOW });
  });
});

describe("normalizePlaceColors: tidying before saving", () => {
  it("no place records a color of its own: unchanged", () => {
    expect(normalizePlaceColors([p(0.1), p(0.5)], BLUE, ORANGE)).toEqual({ shapes: [p(0.1), p(0.5)], color: BLUE });
  });

  it("places drawn while the note box was open carry no color: the whole note's color is filled in", () => {
    expect(normalizePlaceColors([p(0.1, YELLOW), p(0.5, ORANGE), p(0.9)], undefined, ORANGE)).toEqual({
      shapes: [p(0.1, YELLOW), p(0.5, ORANGE), p(0.9, ORANGE)],
      color: YELLOW,
    });
  });

  it("after removing a place the rest are the same: folded into the whole note's color", () => {
    expect(normalizePlaceColors([p(0.1, YELLOW), p(0.9, YELLOW)], undefined, ORANGE)).toEqual({ shapes: [p(0.1), p(0.9)], color: YELLOW });
  });
});

describe("the color a mark is drawn in", () => {
  const a = { anchor: { shapes: [p(0.1, YELLOW), p(0.5)] }, color: BLUE };
  it("each place: its own → the whole note's → the Settings one", () => {
    expect(placeColorOf(a, 0, ORANGE)).toBe(YELLOW);
    expect(placeColorOf(a, 1, ORANGE)).toBe(BLUE);
    expect(placeColorOf({ anchor: { shapes: [p(0.1)] } }, 0, ORANGE)).toBe(ORANGE);
  });

  it("the whole note: only defined when the places are the same (the swatch in the menu is lit), otherwise undefined", () => {
    expect(noteColorOf(a, ORANGE)).toBeUndefined();
    expect(noteColorOf({ anchor: { shapes: [p(0.1), p(0.5)] }, color: BLUE }, ORANGE)).toBe(BLUE);
    expect(noteColorOf({ anchor: {} }, ORANGE)).toBe(ORANGE);
  });
});
