import { describe, expect, it } from "vitest";
import { joinPath, pathSep } from "../src/paths";

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
