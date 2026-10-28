// Reading notes files: samples of every version, validation and filling in, read-only for newer versions, unknown fields preserved
// (docs/adr/0006-format-versioning.md)

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isWritable, MaterialFileError, mergeMaterialFiles, parseMaterialFile, SCHEMA, serializeMaterialFile } from "../src/index.js";

const FORMATS = fileURLToPath(new URL("../../../tests/golden/formats/", import.meta.url));
const sample = (name: string) => readFileSync(FORMATS + name, "utf8");

/** The error object when parsing fails (the test fails if it does not) */
function failure(text: string): MaterialFileError {
  try {
    parseMaterialFile(text, "x.json");
  } catch (e) {
    expect(e).toBeInstanceOf(MaterialFileError);
    return e as MaterialFileError;
  }
  throw new Error("should have been unreadable, but it was read");
}

const minimal = (annotation: Record<string, unknown>, schema = SCHEMA) =>
  JSON.stringify({ schema, material: { path: "a.png", kind: "image" }, annotations: [annotation] });

/** Up to sniptoss/4 a note had a single anchor.shape: it becomes a shapes list with one item when read (ADR-0009) */
function upgraded(file: { annotations: { anchor?: Record<string, unknown> }[] }) {
  for (const a of file.annotations) {
    if (a.anchor?.shape === undefined) continue;
    const { shape, ...rest } = a.anchor;
    a.anchor = { ...rest, shapes: [shape] };
  }
  return file;
}

const ok = {
  id: "abc123",
  status: "open",
  category: "change",
  body: "改一下",
  anchor: {},
  author: "user",
  created_at: "",
  updated_at: "",
  replies: [],
};

describe("samples of every version (tests/golden/formats)", () => {
  const names = readdirSync(FORMATS).filter((n) => n.endsWith(".json"));

  it("every older version has a sample", () => {
    expect(names.sort()).toEqual(["pizhu-1.json", "pizhu-2.json", "pizhu-3.json", "sniptoss-4.json", "sniptoss-5.json"]);
  });

  for (const name of names) {
    it(`${name}: can be read, is upgraded to ${SCHEMA} when written back, and is identical except for schema and shape → shapes`, () => {
      const original = upgraded(JSON.parse(sample(name)));
      const file = parseMaterialFile(sample(name), name);
      expect(isWritable(file)).toBe(true);
      const written = JSON.parse(serializeMaterialFile(file));
      expect(written.schema).toBe(SCHEMA);
      expect({ ...written, schema: undefined }).toEqual({ ...original, schema: undefined });
    });
  }
});

describe("written files (docs/host-api.md: UTF-8 without BOM, 2-space indent, trailing newline)", () => {
  it("2-space indent, one trailing newline, no BOM at the start; non-ASCII text is written as is, not as \\u escapes", () => {
    const text = serializeMaterialFile(parseMaterialFile(minimal({ ...ok, body: "标题改粗" })));
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text.startsWith('{\n  "schema": ')).toBe(true);
    expect(text).toContain('\n      "body": "标题改粗"');
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    expect(text).not.toContain("\r");
  });
});

describe("validation", () => {
  it("not JSON: reason = json", () => {
    expect(failure("{ 坏了").reason).toBe("json");
  });

  it("unknown schema: reason = schema", () => {
    const e = failure(minimal(ok, "foo/1"));
    expect(e.reason).toBe("schema");
    expect(e.detail).toContain("foo/1");
  });

  it("wrong field: reason = invalid, and detail names the note and the field", () => {
    const e = failure(minimal({ ...ok, status: "done" }));
    expect(e.reason).toBe("invalid");
    expect(e.detail).toContain("annotations[0].status");
    expect(e.detail).toContain('"done"');
    expect(e.file).toBe("x.json");
  });

  it("a repeated id in one file: unreadable (merging and checking rely on ids)", () => {
    const text = JSON.stringify({ schema: SCHEMA, material: { path: "a.png", kind: "image" }, annotations: [ok, { ...ok }] });
    expect(failure(text).detail).toContain("annotations[1].id");
  });

  it.each([
    ["rect without h", { type: "rect", x: 0, y: 0, w: 1 }, "shapes[1].h"],
    ["an arrow point that is not [x, y]", { type: "arrow", from: [0, 0], to: [1] }, "shapes[1].to"],
    ["a freehand point that is not a number", { type: "path", points: [[0, "a"]] }, "shapes[1].points"],
    ["a coordinate that is null (what NaN is written as)", { type: "point", x: null, y: 0 }, "shapes[1].x"],
    ["not an object", "rect", "shapes[1]"],
  ])("shape: %s (names which place it is)", (_, shape, field) => {
    expect(failure(minimal({ ...ok, anchor: { shapes: [{ type: "point", x: 0, y: 0 }, shape] } })).detail).toContain(field);
  });

  it("shapes that is not an array: unreadable", () => {
    expect(failure(minimal({ ...ok, anchor: { shapes: { type: "point", x: 0, y: 0 } } })).detail).toContain("anchor.shapes");
  });

  it("an empty shapes array: counts as no position (dropped when written back)", () => {
    const a = parseMaterialFile(minimal({ ...ok, anchor: { shapes: [], time: { start: 1 } } })).annotations[0];
    expect(a.anchor).toEqual({ time: { start: 1 } });
  });

  it("the old form shape (sniptoss/4 and earlier): read as a shapes list with one item; a broken one is still unreadable", () => {
    const shape = { type: "rect", x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    expect(parseMaterialFile(minimal({ ...ok, anchor: { page: 2, shape } }, "sniptoss/4")).annotations[0].anchor).toEqual({
      page: 2,
      shapes: [shape],
    });
    expect(failure(minimal({ ...ok, anchor: { shape: { type: "rect", x: 0 } } }, "sniptoss/4")).detail).toContain("anchor.shape.y");
  });

  it("shape written in a sniptoss/5 file per the old documentation, with no shapes: accepted; with both, shapes wins and shape is kept as an unknown field", () => {
    const shape = { type: "point", x: 0.5, y: 0.5 };
    expect(parseMaterialFile(minimal({ ...ok, anchor: { shape } })).annotations[0].anchor).toEqual({ shapes: [shape] });
    const both = { shape, shapes: [{ type: "point", x: 0.1, y: 0.1 }] };
    expect(parseMaterialFile(minimal({ ...ok, anchor: both })).annotations[0].anchor).toEqual(both);
  });

  it("video time: start must be a number", () => {
    expect(failure(minimal({ ...ok, anchor: { time: { start: "00:12" } } })).detail).toContain("anchor.time");
  });

  it("shapes added later (an unknown type) are not an error and are kept as they are", () => {
    const file = parseMaterialFile(minimal({ ...ok, anchor: { shapes: [{ type: "ellipse", cx: 0.5 }] } }));
    expect(file.annotations[0].anchor.shapes).toEqual([{ type: "ellipse", cx: 0.5 }]);
  });

  it("anchor, replies, author and times left out in an agent's hand edit: filled in, not an error", () => {
    const file = parseMaterialFile(minimal({ id: "abc123", status: "resolved", category: "change", body: "改一下" }));
    expect(file.annotations[0]).toMatchObject({ anchor: {}, replies: [], author: "", created_at: "", updated_at: "" });
  });

  it('a malformed copied-out time: counts as never copied and the file is read as usual (it only drives the card\'s "copied" label)', () => {
    for (const bad of [123, "昨天", null]) {
      const a = parseMaterialFile(minimal({ ...ok, handed_off_at: bad })).annotations[0];
      expect("handed_off_at" in a).toBe(false);
    }
    expect(parseMaterialFile(minimal({ ...ok, handed_off_at: "2026-10-20T10:32:00Z" })).annotations[0].handed_off_at).toBe(
      "2026-10-20T10:32:00Z",
    );
  });

  it("a malformed item fingerprint (not a string): counts as not recorded and the file is read as usual (the version is decided by the old-note rules, ADR-0008)", () => {
    for (const bad of [123, null, { sha: "x" }]) {
      const a = parseMaterialFile(minimal({ ...ok, material_sha256: bad })).annotations[0];
      expect("material_sha256" in a).toBe(false);
    }
    const sha = "9f2c1b7e0d4a6c3f8b5e2d1a0c9f8e7d6b5a4c3f2e1d0c9b8a7f6e5d4c3b2a19";
    expect(parseMaterialFile(minimal({ ...ok, material_sha256: sha })).annotations[0].material_sha256).toBe(sha);
  });

  it("a malformed mark color (not #rrggbb): counts as not changed, the Settings color is used and the file is read as usual; either case is accepted (it is put into SVG)", () => {
    for (const bad of [123, null, "red", "#fff", "#12345g", '#123456" onload="x', "rgb(1,2,3)"]) {
      const a = parseMaterialFile(minimal({ ...ok, color: bad })).annotations[0];
      expect("color" in a).toBe(false);
    }
    expect(parseMaterialFile(minimal({ ...ok, color: "#5B8CFF" })).annotations[0].color).toBe("#5B8CFF");
  });

  it("a malformed color on one place (since Beta 80): that place counts as not changed and the file is read as usual; valid ones are kept", () => {
    const point = (color: unknown) => ({ type: "point", x: 0.5, y: 0.5, color });
    for (const bad of [123, null, "red", '#123456" onload="x']) {
      const a = parseMaterialFile(minimal({ ...ok, anchor: { shapes: [point(bad), point("#ffc233")] } })).annotations[0];
      expect("color" in a.anchor.shapes![0]).toBe(false);
      expect(a.anchor.shapes![1].color).toBe("#ffc233");
    }
  });

  it("a reply without author or time: filled with empty strings; without a body: unreadable", () => {
    expect(parseMaterialFile(minimal({ ...ok, replies: [{ body: "改好了" }] })).annotations[0].replies[0]).toEqual({
      body: "改好了",
      author: "",
      at: "",
    });
    expect(failure(minimal({ ...ok, replies: [{ author: "codex" }] })).detail).toContain("replies[0].body");
  });

  it("with too many problems only the first 5 are listed, followed by how many more there are", () => {
    const bad = Array.from({ length: 8 }, (_, i) => ({ ...ok, id: `id${i}`, status: "x" }));
    const e = failure(JSON.stringify({ schema: SCHEMA, material: { path: "a.png", kind: "image" }, annotations: bad }));
    expect(e.detail.split("; ")).toHaveLength(5);
    expect(e.detail).toContain("(+3)");
  });
});

describe("files written by a newer version (ADR-0006 item 4)", () => {
  it("sniptoss/6: can be read, keeps its schema, read-only", () => {
    const file = parseMaterialFile(minimal(ok, "sniptoss/6"));
    expect(file.schema).toBe("sniptoss/6");
    expect(isWritable(file)).toBe(false);
  });

  it("sniptoss/6 with a structure this version cannot understand: reason = newer (not invalid)", () => {
    expect(failure(minimal({ ...ok, status: "archived" }, "sniptoss/6")).reason).toBe("newer");
  });

  it("shape in sniptoss/6 is not converted to shapes as the old form (in a newer version it may mean something else; it is only read)", () => {
    const shape = { type: "point", x: 0.5, y: 0.5 };
    expect(parseMaterialFile(minimal({ ...ok, anchor: { shape } }, "sniptoss/6")).annotations[0].anchor).toEqual({ shape });
  });

  it("older versions and the current one are all writable", () => {
    expect(isWritable(parseMaterialFile(minimal(ok, "pizhu/1")))).toBe(true);
    expect(isWritable(parseMaterialFile(minimal(ok, "sniptoss/4")))).toBe(true);
    expect(isWritable(parseMaterialFile(minimal(ok)))).toBe(true);
  });
});

describe("unknown fields are preserved as they are (ADR-0006 item 3)", () => {
  const text = JSON.stringify({
    schema: SCHEMA,
    material: { path: "a.png", kind: "image", source: { from: "window" } },
    annotations: [{ ...ok, priority: 2, anchor: { element: { selector: "#a" } } }],
    meta: { tool: "other" },
  });

  it("read and written back: unknown fields on the file, item, note and anchor are all still there", () => {
    const back = JSON.parse(serializeMaterialFile(parseMaterialFile(text)));
    expect(back.meta).toEqual({ tool: "other" });
    expect(back.material.source).toEqual({ from: "window" });
    expect(back.annotations[0].priority).toBe(2);
    expect(back.annotations[0].anchor.element).toEqual({ selector: "#a" });
  });

  it("after merging with a change from elsewhere: unknown fields are still there", () => {
    const base = parseMaterialFile(text);
    const mine = { ...base, annotations: [{ ...base.annotations[0], status: "resolved" as const, updated_at: "2026-10-17T12:00:00Z" }] };
    const merged = JSON.parse(serializeMaterialFile(mergeMaterialFiles(base, mine, parseMaterialFile(text)).file));
    expect(merged.meta).toEqual({ tool: "other" });
    expect(merged.annotations[0]).toMatchObject({ status: "resolved", priority: 2 });
  });
});
