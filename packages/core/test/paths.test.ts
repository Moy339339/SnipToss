import { describe, expect, it } from "vitest";
import { joinPath, pathSep, trimTrailingSeparators } from "../src/paths";

describe("pathSep", () => {
  it("Windows paths use backslashes: a drive letter, a share or any backslash", () => {
    expect(pathSep("E:\\proj")).toBe("\\");
    expect(pathSep("E:/proj")).toBe("\\");
    expect(pathSep("e:")).toBe("\\");
    expect(pathSep("\\\\srv\\share")).toBe("\\");
  });
  it("other paths use slashes", () => {
    expect(pathSep("/Users/alex/proj")).toBe("/");
    expect(pathSep("/")).toBe("/");
    expect(pathSep("//srv/share")).toBe("/");
  });
  it("an empty path counts as Windows", () => {
    expect(pathSep("")).toBe("\\");
  });
});

describe("trimTrailingSeparators", () => {
  it("drops every separator at the end, of either kind, and leaves the rest alone", () => {
    expect(trimTrailingSeparators("E:\\proj\\")).toBe("E:\\proj");
    expect(trimTrailingSeparators("/Users/alex/proj//")).toBe("/Users/alex/proj");
    expect(trimTrailingSeparators("E:\\proj/\\")).toBe("E:\\proj");
    expect(trimTrailingSeparators("\\\\srv\\share")).toBe("\\\\srv\\share");
    expect(trimTrailingSeparators("/")).toBe("");
    expect(trimTrailingSeparators("")).toBe("");
  });
  it("stays linear on a long run of separators that isn't at the end", () => {
    const path = "/".repeat(200_000) + "x";
    const start = performance.now();
    expect(trimTrailingSeparators(path)).toBe(path);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("joinPath", () => {
  it("the separator follows the notes folder; the relative path always comes in with forward slashes", () => {
    expect(joinPath("E:\\proj", "a/b.png")).toBe("E:\\proj\\a\\b.png");
    expect(joinPath("/Users/alex/proj", "a/b.png")).toBe("/Users/alex/proj/a/b.png");
  });
  it("a trailing separator on the notes folder is dropped; . and empty mean the notes folder itself", () => {
    expect(joinPath("E:\\proj\\", "a")).toBe("E:\\proj\\a");
    expect(joinPath("/Users/alex/proj/", "a")).toBe("/Users/alex/proj/a");
    expect(joinPath("/Users/alex/proj/", ".")).toBe("/Users/alex/proj");
    expect(joinPath("E:\\proj", "")).toBe("E:\\proj");
  });
});
