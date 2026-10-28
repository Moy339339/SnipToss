import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type Shape } from "../src/index.js";
import { describeShape } from "./i18n.js";

// The golden file for the position wording given to AI (tests/golden/where.zh-CN.json): the capture overlay (app/ShapeText.cs) runs the
// same file, and the two must match word for word.
// When the wording changes: change the reference implementation here first, then regenerate the golden file (the expected values are
// computed by describeShape), and change the C# side until it passes
const GOLDEN = fileURLToPath(new URL("../../../tests/golden/where.zh-CN.json", import.meta.url));
const cases = JSON.parse(readFileSync(GOLDEN, "utf8")) as {
  name: string;
  shape: Shape;
  size: { width: number; height: number } | null;
  text: string;
}[];

describe("position wording for AI: golden file", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    expect(describeShape(c.shape, c.size ?? undefined)).toBe(c.text);
  });
});
