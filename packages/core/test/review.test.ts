import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  emptyMaterialFile,
  formatTime,
  newAnnotationId,
  parseMaterialFile,
  removeAnnotation,
  MAX_SLUG,
  slugFor,
  upsertAnnotation,
  type Annotation,
} from "../src/index.js";
import * as core from "../src/index.js";
import { MaterialFileError, projectLanguage, reviewLanguage, serializeProject } from "../src/index.js";
import { en, renderReview, zh } from "./i18n.js";

const ANNOTATIONS = fileURLToPath(new URL("./fixture/.sniptoss/annotations/", import.meta.url));
const fixture = () =>
  readdirSync(ANNOTATIONS)
    .sort()
    .map((n) => parseMaterialFile(readFileSync(ANNOTATIONS + n, "utf8"), n));

describe("slugFor", () => {
  it("replaces path separators with __", () => {
    expect(slugFor("assets/hero.png")).toBe("assets__hero.png.json");
    expect(slugFor("assets\\sub\\a.mp4")).toBe("assets__sub__a.mp4.json");
  });

  it("a name that is too long (an item buried deep in the project): keeps the tail plus a path fingerprint, stays within MAX_SLUG, is the same for both separators, and different paths do not collide", () => {
    const deep = Array.from({ length: 6 }, (_, i) => `level-${i + 1}-${"x".repeat(40)}`).join("/");
    const name = slugFor(`${deep}/shot.png`);
    expect(name.length).toBeLessThanOrEqual(MAX_SLUG);
    expect(name).toMatch(/__shot\.png~[0-9a-f]{16}\.json$/);
    expect(slugFor(`${deep.replaceAll("/", "\\")}\\shot.png`)).toBe(name);
    expect(slugFor(`${deep}/shot2.png`)).not.toBe(name);
    expect(slugFor(`other/${deep}/shot.png`)).not.toBe(name); // same ending, different beginning
    const folder = slugFor(deep, "folder");
    expect(folder.length).toBeLessThanOrEqual(MAX_SLUG);
    expect(folder.endsWith("@folder.json")).toBe(true);
    // A name that just fits is unchanged (file names saved earlier stay the same)
    const fits = "a".repeat(MAX_SLUG - ".json".length);
    expect(slugFor(fits)).toBe(`${fits}.json`);
    // Does not cut in the middle of an emoji
    const emoji = slugFor(`${"x".repeat(200)}/${"🎨".repeat(80)}.png`);
    expect(() => encodeURIComponent(emoji)).not.toThrow(); // a lone surrogate half would throw
  });
});

describe("a note with several places in different colors (Beta 80, the color of each place)", () => {
  const material = { path: "a.png", kind: "image" as const, width: 1000, height: 500 };
  const note = (shapes: Annotation["anchor"]["shapes"], color?: string): Annotation => ({
    id: "c0l0r1",
    status: "open",
    category: "change",
    body: "橙色那处改成圆角，黄色那处去掉",
    anchor: { shapes },
    author: "",
    created_at: "",
    updated_at: "",
    ...(color ? { color } : {}),
    replies: [],
  });
  const p = (x: number, color?: string) => ({ type: "point" as const, x, y: 0.5, ...(color ? { color } : {}) });

  it("each place is prefixed with its color: presets by name (per language), anything else as the color value", () => {
    const a = note([p(0.1, "#ff6a3d"), p(0.9, "#FFC233"), p(0.5, "#123456")], "#ff6a3d");
    expect(core.describeWhere(a, material, zh)).toBe(
      "3 处：（橙色）位置 画面左侧居中（横 10%、纵 50%），x=100 y=250 px；（黄色）位置 画面右侧居中（横 90%、纵 50%），x=900 y=250 px；（#123456）位置 画面中央（横 50%、纵 50%），x=500 y=250 px",
    );
    expect(core.describeWhere(a, material, en)).toContain("3 places — (Orange) Point: middle left");
  });

  it("colors are not mentioned when they are all the same or when one place's color is unknown (it follows Settings)", () => {
    expect(core.describeWhere(note([p(0.1, "#ffc233"), p(0.9)], "#ffc233"), material, zh)).not.toContain("（黄色）");
    expect(core.describeWhere(note([p(0.1, "#ffc233"), p(0.9)]), material, zh)).not.toMatch(/（.+色）/);
    expect(core.describeWhere(note([p(0.1), p(0.9)]), material, zh)).toMatch(/^2 处：位置 /);
  });

  it("the color each place is drawn in: its own, else the whole note's", () => {
    expect(core.placeColors(note([p(0.1, "#ffc233"), p(0.9)], "#5b8cff"))).toEqual(["#ffc233", "#5b8cff"]);
    expect(core.placeColors(note([p(0.1), p(0.9)]))).toEqual([undefined, undefined]);
  });

  it("a place's color is kept when it is moved or its decimals are rounded", () => {
    expect(core.roundShape(p(0.123456789, "#ffc233"), 1000, 500)).toEqual({ type: "point", x: 0.1235, y: 0.5, color: "#ffc233" });
    expect(core.roundShape(p(0.1), 1000, 500)).toEqual({ type: "point", x: 0.1, y: 0.5 });
  });
});

describe("renderReview missing", () => {
  it("an item that is gone is marked as not found after its heading; the rest is unchanged", () => {
    const files = fixture();
    const md = renderReview(files, { missing: ["assets/hero.png"] });
    const heading = md.split("\n").find((l) => l.startsWith("## assets/hero.png"));
    expect(heading).toContain("（未找到该文件：可能已被删除、重命名或移动，请先确认其当前位置）");
    expect(md.split("\n").filter((l) => l.startsWith("## ") && l.includes("未找到该文件"))).toHaveLength(1);
  });
});

describe("renderReview earlier (written on an earlier version, ADR-0008)", () => {
  it("the end of the line says the snapshot is authoritative for the position; the rest is unchanged", () => {
    const files = fixture();
    const hero = files.find((f) => f.material.path === "assets/hero.png")!;
    const id = hero.annotations.find((a) => a.status === "open")!.id;
    const md = renderReview(files, { earlier: { "assets/hero.png": [id] } });
    const lines = md.split("\n");
    expect(lines.find((l) => l.startsWith(`### [${id}]`))?.endsWith("（写在旧版本上，位置以截图为准）")).toBe(true);
    expect(lines.filter((l) => l.includes("写在旧版本上"))).toHaveLength(1);
  });
});

describe("formatTime", () => {
  it("seconds → mm:ss.mmm", () => {
    expect(formatTime(0)).toBe("00:00.000");
    expect(formatTime(75.25)).toBe("01:15.250");
    expect(formatTime(3599.9994)).toBe("59:59.999");
    expect(formatTime(7140)).toBe("1:59:00.000");
    expect(formatTime(36000.5)).toBe("10:00:00.500");
    expect(formatTime(75.25, true)).toBe("0:01:15.250");
  });
});

describe("parseMaterialFile", () => {
  it("rejects an unknown schema", () => {
    expect(() => parseMaterialFile('{"schema":"pizhu/9"}', "x.json")).toThrow(/x\.json/);
  });
});

describe("newAnnotationId", () => {
  it("six lowercase letters or digits, avoiding existing ones", () => {
    let calls = 0;
    // The first 6 random numbers make aaaaaa (taken), and the next ones make bbbbbb
    const random = () => (calls++ < 6 ? 0 : 1 / 36 + 1e-9);
    expect(newAnnotationId(new Set(["aaaaaa"]), random)).toBe("bbbbbb");
    expect(newAnnotationId(new Set())).toMatch(/^[a-z0-9]{6}$/);
  });
});

describe("renderReview", () => {
  it("lists only open notes and converts coordinates to pixels", () => {
    const md = renderReview(fixture());
    expect(md).toContain("# 待处理批注（2 条）");
    expect(md).toContain("### [k3f9a2] 修改 · 区域 画面左上（横 12%–52%、纵 8%–18%），x=230 y=86 宽=768 高=108 px");
    expect(md).toContain("截图：.sniptoss/snapshots/k3f9a2.png");
    // The CLI writing REVIEW.md in a legacy project that has not been migrated: snapshot paths follow the actual directory name
    expect(renderReview(fixture(), { dataDir: ".pizhu" })).toContain("截图：.pizhu/snapshots/k3f9a2.png");
    expect(md).toContain("### [p0c7xe] 删除 · 00:12.500–00:15.000 · 位置 画面右下（横 90%、纵 90%），x=1152 y=648 px");
    expect(md).not.toContain("done01");
  });

  it("notes with several places: the line reads 2 places: …; …, the intro gains the sentence that the comment applies to every place, and without such notes it is left out (ADR-0009, same as the sample in the format document)", () => {
    const files = fixture();
    expect(renderReview(files)).not.toContain("标了几处的批注");
    const a = files.find((f) => f.material.path === "assets/hero.png")!.annotations.find((x) => x.id === "k3f9a2")!;
    a.anchor.shapes = [...a.anchor.shapes!, { type: "rect", x: 0.12, y: 0.62, w: 0.4, h: 0.1 }];
    const md = renderReview(files);
    expect(md).toContain("\n标了几处的批注，意见对每一处都适用。\n");
    expect(md).toContain(
      "### [k3f9a2] 修改 · 2 处：区域 画面左上（横 12%–52%、纵 8%–18%），x=230 y=86 宽=768 高=108 px；区域 画面左下（横 12%–52%、纵 62%–72%），x=230 y=670 宽=768 高=108 px",
    );
    expect(core.renderReview(files, en)).toContain(
      "### [k3f9a2] Change · 2 places — Region: top left of the frame (x 12%–52%, y 8%–18%), x=230 y=86 w=768 h=108 px; Region: bottom left of the frame (x 12%–52%, y 62%–72%), x=230 y=670 w=768 h=108 px",
    );
  });

  it("gives an empty-state message when there are no notes", () => {
    expect(renderReview([])).toContain("当前没有待处理的批注。");
  });
});

describe("renderReview options", () => {
  it("with includeResolved, resolved notes are listed at the end", () => {
    const md = renderReview(fixture(), { includeResolved: true });
    expect(md).toContain("# 已处理");
    expect(md).toContain("- [done01] 已改：右下角水印删掉");
  });
  it("unreadable notes files are listed right under the title, so an agent does not assume these are all the notes", () => {
    const bad = [{ file: ".sniptoss/annotations/a__x.png.json", reason: "不是合法的 JSON（Unexpected token）" }];
    const md = renderReview(fixture(), { unreadable: bad });
    const lines = md.split("\n");
    expect(lines[0]).toBe("# 待处理批注（2 条）");
    expect(lines[2]).toContain("有 1 份批注文件无法读取，其中的批注未列入下文，也未计入条数。");
    expect(lines[3]).toBe("> - .sniptoss/annotations/a__x.png.json：不是合法的 JSON（Unexpected token）");
    expect(renderReview([], { unreadable: bad })).toContain("可读取的批注文件中没有待处理的批注。");
    expect(renderReview(fixture())).not.toContain("无法读取");
  });
  it("the snapshot explanation does not hard-code a color (the mark color is a setting)", () => {
    expect(renderReview(fixture())).not.toContain("橙色");
  });
  it("does not tell the agent to run a command to mark notes Done afterwards (the notes stay as a record)", () => {
    expect(renderReview(fixture())).not.toContain("resolve");
  });
});

describe('REVIEW.md language (docs/annotation-format.md, "Folder settings")', () => {
  it("the whole REVIEW.md: one golden file in Chinese and one in English (the notes' own text is unchanged)", async () => {
    const bad = [{ file: ".sniptoss/annotations/a__x.png.json", reason: "x" }];
    await expect(renderReview(fixture(), { includeResolved: true, missing: ["assets/hero.png"] })).toMatchFileSnapshot(
      "../../../tests/golden/review/fixture.zh-CN.md",
    );
    await expect(
      core.renderReview(fixture(), en, { includeResolved: true, missing: ["assets/hero.png"], unreadable: bad }),
    ).toMatchFileSnapshot("../../../tests/golden/review/fixture.en.md");
  });

  it("the reason a file is unreadable follows the language (the category and the original detail are not translated)", () => {
    const e = new MaterialFileError("json", "Unexpected token", "a.json");
    expect(core.describeUnreadable(e, zh)).toBe("不是合法的 JSON（Unexpected token）");
    expect(core.describeUnreadable(e, en)).toBe("not valid JSON (Unexpected token)");
  });

  it("a language recorded in project.json is used; if none is recorded, an existing REVIEW.md (written by earlier versions, always Chinese) means Chinese, otherwise the current language, and it is to be recorded", () => {
    expect(reviewLanguage('{ "language": "en" }', true, "zh-CN")).toEqual({ language: "en", write: false });
    expect(reviewLanguage(null, true, "en")).toEqual({ language: "zh-CN", write: true });
    expect(reviewLanguage(null, false, "en")).toEqual({ language: "en", write: true });
    expect(reviewLanguage(undefined, false, "ja")).toEqual({ language: "ja", write: true });
  });

  it("a broken project.json or an unrecognized language: decided as if none were recorded, but not overwritten (a hand edit is kept)", () => {
    expect(reviewLanguage("{ not json", true, "en")).toEqual({ language: "zh-CN", write: false });
    expect(reviewLanguage('{ "language": "klingon" }', false, "en")).toEqual({ language: "en", write: false });
    expect(reviewLanguage('{ "language": 3 }', false, "en")).toEqual({ language: "en", write: false });
    expect(projectLanguage('{ "language": "pt-BR", "future": 1 }')).toBe("pt-BR");
  });

  it("a newly created project.json: UTF-8, 2-space indent, trailing newline", () => {
    expect(serializeProject("en")).toBe('{\n  "language": "en"\n}\n');
  });
});

describe("adding, removing and changing notes", () => {
  const a: Annotation = {
    id: "abc123",
    status: "open",
    category: "change",
    body: "改大",
    author: "user",
    anchor: { shapes: [{ type: "arrow", from: [0.1, 0.1], to: [0.5, 0.5] }] },
    created_at: "",
    updated_at: "",
    replies: [],
  };
  const m = { path: "a/b.png", kind: "image" as const, sha256: "", width: 1000, height: 500 };

  it("upsert appends and replaces, remove deletes, and neither changes the original object", () => {
    const empty = emptyMaterialFile(m);
    const one = upsertAnnotation(empty, a);
    expect(empty.annotations).toHaveLength(0);
    expect(upsertAnnotation(one, { ...a, body: "改小" }).annotations).toEqual([{ ...a, body: "改小" }]);
    expect(removeAnnotation(one, "abc123").annotations).toHaveLength(0);
  });
});
