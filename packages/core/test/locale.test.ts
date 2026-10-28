import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchLocale, projectLanguage, reviewLanguage, serializeProject } from "../src/locale.js";

// core's own language rules (the UI uses them through dist, and coverage only counts src, so the golden file is run here too)
const golden = JSON.parse(readFileSync(fileURLToPath(new URL("../../../tests/golden/locale.json", import.meta.url)), "utf8")) as {
  match: [string, string][];
};

describe("matchLocale: runs the same golden file as the shell and the UI (tests/golden/locale.json)", () => {
  it.each(golden.match)("%s → %s", (tag, expected) => expect(matchLocale(tag)).toBe(expected));
  it("empty or unsupported tags give English", () => {
    expect(matchLocale(undefined)).toBe("en");
    expect(matchLocale(null)).toBe("en");
    expect(matchLocale("")).toBe("en");
    expect(matchLocale("sw-KE")).toBe("en");
  });
});

describe('the REVIEW.md language recorded in project.json (format document, "Folder settings")', () => {
  it("only a recognized language counts; missing, broken or unrecognized gives undefined", () => {
    expect(projectLanguage('{ "language": "ja" }')).toBe("ja");
    expect(projectLanguage('{ "language": "xx" }')).toBeUndefined();
    expect(projectLanguage("{ 坏了")).toBeUndefined();
    expect(projectLanguage("null")).toBeUndefined();
    expect(projectLanguage("")).toBeUndefined();
    expect(projectLanguage(undefined)).toBeUndefined();
  });

  it("a recorded language is used and not written again; with none recorded, an existing REVIEW.md means Chinese and otherwise the current language; it is only written when the file is missing", () => {
    expect(reviewLanguage('{ "language": "fr" }', true, "en")).toEqual({ language: "fr", write: false });
    expect(reviewLanguage(null, true, "en")).toEqual({ language: "zh-CN", write: true });
    expect(reviewLanguage(undefined, false, "de")).toEqual({ language: "de", write: true });
    // A broken or unrecognized file is not overwritten (the user broke it by hand; leave it for them to see)
    expect(reviewLanguage("{ 坏了", false, "de")).toEqual({ language: "de", write: false });
    expect(reviewLanguage('{ "language": "xx" }', false, "ko")).toEqual({ language: "ko", write: false });
  });

  it("a newly created project.json: 2-space indent, trailing newline", () => {
    expect(serializeProject("en")).toBe('{\n  "language": "en"\n}\n');
  });
});
