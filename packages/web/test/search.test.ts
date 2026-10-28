import { describe, expect, it } from "vitest";
import { annotationMatches, hitRanges, searchTerms } from "../src/search";

const note = (body: string, ...replies: string[]) => ({ body, replies: replies.map((b) => ({ body: b })) });

describe("searchTerms", () => {
  it("splits on whitespace into lowercase terms; only whitespace = no search", () => {
    expect(searchTerms("  Logo  标题 ")).toEqual(["logo", "标题"]);
    expect(searchTerms("   ")).toEqual([]);
  });
});

describe("annotationMatches", () => {
  it("everything matches when there is no search", () => {
    expect(annotationMatches(note("随便"), [])).toBe(true);
  });
  it("searches both the note text and the replies; case-insensitive", () => {
    expect(annotationMatches(note("把 LOGO 放大"), ["logo"])).toBe(true);
    expect(annotationMatches(note("标题换粗体", "已改成思源黑体 Bold"), ["bold"])).toBe(true);
    expect(annotationMatches(note("标题换粗体"), ["水印"])).toBe(false);
  });
  it("every term must be present, and they may be split between the text and the replies", () => {
    expect(annotationMatches(note("标题换粗体", "改成黑体了"), ["标题", "黑体"])).toBe(true);
    expect(annotationMatches(note("标题换粗体"), ["标题", "水印"])).toBe(false);
  });
});

describe("hitRanges", () => {
  it("every hit is marked, and overlapping or adjacent ones merge into one range", () => {
    expect(hitRanges("logo 和 LOGO", ["logo"])).toEqual([
      [0, 4],
      [7, 11],
    ]);
    expect(hitRanges("abcdef", ["abc", "cde"])).toEqual([[0, 5]]);
    expect(hitRanges("abcdef", ["ab", "cd"])).toEqual([[0, 4]]);
  });
  it("no hit or no search: nothing is marked", () => {
    expect(hitRanges("标题", ["水印"])).toEqual([]);
    expect(hitRanges("标题", [])).toEqual([]);
  });
});
