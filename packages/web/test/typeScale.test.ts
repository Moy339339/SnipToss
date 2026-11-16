import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contentVars, TEXT_SIZES, typeVars } from "../src/typeScale";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const root = css.slice(css.indexOf(":root"), css.indexOf("color-scheme: dark"));
const token = (name: string) => Number(new RegExp(`${name}:\\s*(\\d+)px`).exec(root)?.[1]);

describe("type scale", () => {
  it("the styles are written at the default size: the default changes nothing", () => {
    for (const which of ["uiFontSize", "settingsFontSize"] as const) {
      expect(TEXT_SIZES[which].css).toBe(TEXT_SIZES[which].base);
      expect(typeVars(which, TEXT_SIZES[which].base)).toEqual({});
    }
    expect(contentVars(TEXT_SIZES.noteFontSize.base)).toEqual({});
    expect(token("--fs-body")).toBe(TEXT_SIZES.uiFontSize.css);
    expect(token("--fs-content")).toBe(TEXT_SIZES.noteFontSize.css);
  });

  it("the levels written in styles.css are the ones typeScale moves (Settings sets all of them at its default)", () => {
    const all = typeVars("settingsFontSize", TEXT_SIZES.settingsFontSize.base, true);
    for (const [name, value] of Object.entries(all)) expect(`${token(name)}px`, name).toBe(value);
  });

  it("every line height is even at every size, so text centers on whole pixels in the even-height controls (S1, S2)", () => {
    const lines = Object.keys(typeVars("uiFontSize", 14, true)).filter((n) => n.startsWith("--lh-"));
    expect(lines.length).toBeGreaterThan(5);
    for (let size = TEXT_SIZES.uiFontSize.min; size <= TEXT_SIZES.uiFontSize.max; size++) {
      const vars = typeVars("uiFontSize", size, true);
      for (const name of lines) expect(parseInt(vars[name]) % 2, `${name} at ${size}`).toBe(0);
    }
    for (let size = TEXT_SIZES.noteFontSize.min; size <= TEXT_SIZES.noteFontSize.max; size++) {
      const line = parseInt(contentVars(size)["--lh-content"] ?? `${token("--lh-content")}`);
      expect(line % 2, `note text at ${size}`).toBe(0);
      expect(line).toBeGreaterThanOrEqual(size + 8);
    }
  });

  it("each level moves with the size; captions never below 12 and digits never below 11 (G1)", () => {
    expect(typeVars("uiFontSize", 16)).toMatchObject({
      "--fs-body": "16px",
      "--lh-body": "22px",
      "--fs-caption": "14px",
      "--fs-title": "18px",
    });
    expect(typeVars("uiFontSize", 15)).toMatchObject({
      "--fs-body": "15px",
      "--lh-body": "22px",
      "--lh-caption": "18px",
      "--lh-note": "20px",
    });
    expect(typeVars("uiFontSize", 13)).toMatchObject({
      "--fs-body": "13px",
      "--lh-body": "20px",
      "--fs-caption": "12px",
      "--lh-caption": "16px",
      "--fs-micro": "11px",
    });
    expect(typeVars("uiFontSize", 12)).toMatchObject({ "--fs-body": "12px", "--fs-caption": "12px", "--fs-micro": "11px" });
  });

  it("two levels side by side differ by at least 2px at the default (12 / 14 / 16 / 20)", () => {
    const levels = ["--fs-caption", "--fs-body", "--fs-title", "--fs-heading"].map(token);
    expect(levels).toEqual([12, 14, 16, 20]);
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeGreaterThanOrEqual(2);
  });
});
