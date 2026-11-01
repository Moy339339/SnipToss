import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isLightMark, MARK_COLOR_NAMES, MARK_COLORS } from "../src/index.js";

// Which mark colors get a dark number (tests/golden/light-colors.json): the capture overlay (app/Capture/ColorMath.cs) runs the same file
const GOLDEN = fileURLToPath(new URL("../../../tests/golden/light-colors.json", import.meta.url));
const { colors } = JSON.parse(readFileSync(GOLDEN, "utf8")) as { colors: Record<string, boolean> };

describe("mark colors", () => {
  it.each(Object.entries(colors))("%s light = %s", (color, light) => {
    expect(isLightMark(color)).toBe(light);
  });

  it("only white among the presets is light, and every preset has a name", () => {
    expect(MARK_COLORS.filter(isLightMark)).toEqual(["#ffffff"]);
    expect(MARK_COLOR_NAMES).toHaveLength(MARK_COLORS.length);
  });

  it("a malformed value is never light", () => {
    expect(isLightMark("white")).toBe(false);
    expect(isLightMark("#fff")).toBe(false);
  });
});
